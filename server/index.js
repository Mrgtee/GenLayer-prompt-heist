import "dotenv/config";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";
import { z } from "zod";
import { recoverMessageAddress } from "viem";
import { topPlayers, upsertPlayer } from "./db.js";
import { MatchEngine } from "./matchEngine.js";

dotenv.config({ path: new URL("./.env", import.meta.url) });

const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const PORT = Number(process.env.PORT || 3001);
const SIGNATURE_MAX_AGE_SECONDS = 10 * 60;

const app = express();
app.use(cors({
  origin: CORS_ORIGIN,
  credentials: true,
}));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: CORS_ORIGIN,
    credentials: true,
  },
});

const engine = new MatchEngine(io);
const users = new Map();

const WalletSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const RoomIdSchema = z.string().trim().min(1).max(48).regex(/^[a-zA-Z0-9_-]+$/);

const NameSchema = z.object({
  wallet: WalletSchema,
  displayName: z.string().min(1).max(20).regex(/^[a-zA-Z0-9_]+$/),
  timestamp: z.number().int().positive(),
  signature: z.string().min(10),
});

const JoinSchema = z.object({
  roomId: RoomIdSchema.optional().default("genlayer"),
  wallet: WalletSchema,
  timestamp: z.number().int().positive(),
  signature: z.string().min(10),
});

const RoomSchema = z.object({
  roomId: RoomIdSchema.optional().default("genlayer"),
});

const SubmitSchema = RoomSchema.extend({
  roundId: z.string().min(1).max(80),
  text: z.string().min(1).max(240),
});

const ChallengeCreateSchema = RoomSchema.extend({
  roundId: z.string().min(1).max(80),
  reasonCode: z.enum(["too_harsh", "missed_style", "missed_subject"]).optional(),
});

const ChallengeVoteSchema = RoomSchema.extend({
  voteYes: z.boolean(),
});

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function assertFreshTimestamp(timestamp) {
  if (Math.abs(nowSeconds() - timestamp) > SIGNATURE_MAX_AGE_SECONDS) {
    throw new Error("Signature timestamp is too old");
  }
}

function joinMessage(roomId, timestamp) {
  return `Join Prompt Heist room ${roomId} at ${timestamp}`;
}

function nameMessage(displayName, timestamp) {
  return `Set display name to ${displayName} at ${timestamp}`;
}

function emitError(socket, error) {
  socket.emit("app:error", { message: error?.message || String(error) });
}

function requireWallet(socket) {
  const wallet = socket.data.wallet;
  if (!wallet) throw new Error("Join a room with a signed wallet session first");
  return wallet;
}

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/api/leaderboard/global", (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 25)));
    const rows = topPlayers(limit);
    return res.json({
      ok: true,
      players: rows.map((p) => ({
        wallet: p.wallet,
        displayName: p.displayName,
        xp: p.totalXp,
        updatedAt: (p.updatedAt || 0) * 1000,
      })),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

app.post("/api/profile/display-name", async (req, res) => {
  const parsed = NameSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  const { wallet, displayName, timestamp, signature } = parsed.data;
  try {
    assertFreshTimestamp(timestamp);
    const recovered = await recoverMessageAddress({
      message: nameMessage(displayName, timestamp),
      signature,
    });

    if (recovered.toLowerCase() !== wallet.toLowerCase()) {
      return res.status(401).json({ ok: false, error: "Signature does not match wallet" });
    }

    users.set(wallet.toLowerCase(), { displayName, updatedAt: Date.now() });
    upsertPlayer({ wallet, displayName });
    engine.updateDisplayName({ wallet, displayName });

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

io.on("connection", (socket) => {
  socket.on("room:join", async (payload) => {
    try {
      const parsed = JoinSchema.safeParse(payload || {});
      if (!parsed.success) throw new Error("Invalid join payload");

      const { roomId, wallet, timestamp, signature } = parsed.data;
      assertFreshTimestamp(timestamp);

      const recovered = await recoverMessageAddress({
        message: joinMessage(roomId, timestamp),
        signature,
      });

      if (recovered.toLowerCase() !== wallet.toLowerCase()) {
        throw new Error("Join signature does not match wallet");
      }

      socket.data.wallet = wallet;
      socket.data.roomId = roomId;

      const u = users.get(wallet.toLowerCase());
      const room = engine.joinRoom({
        socket,
        roomId,
        wallet,
        displayName: u?.displayName,
      });
      socket.emit("room:joined", { roomId: room.roomId, wallet });
    } catch (e) {
      emitError(socket, e);
    }
  });

  socket.on("room:leave", (payload) => {
    try {
      const parsed = RoomSchema.safeParse(payload || {});
      if (!parsed.success) throw new Error("Invalid room payload");

      const wallet = requireWallet(socket);
      const roomId = parsed.data.roomId || socket.data.roomId || "genlayer";
      engine.leaveRoom({ socket, roomId, wallet });
      socket.data.roomId = null;
    } catch (e) {
      emitError(socket, e);
    }
  });

  socket.on("match:start", (payload) => {
    try {
      const parsed = RoomSchema.safeParse(payload || {});
      if (!parsed.success) throw new Error("Invalid room payload");

      engine.startMatch({
        roomId: parsed.data.roomId,
        wallet: requireWallet(socket),
        rounds: 3,
      });
    } catch (e) {
      emitError(socket, e);
    }
  });

  socket.on("round:submit", (payload) => {
    try {
      const parsed = SubmitSchema.safeParse(payload || {});
      if (!parsed.success) throw new Error("Invalid submission payload");

      engine.submit({
        roomId: parsed.data.roomId,
        wallet: requireWallet(socket),
        roundId: parsed.data.roundId,
        text: parsed.data.text,
      });
    } catch (e) {
      emitError(socket, e);
    }
  });

  socket.on("round:retry-judge", (payload) => {
    try {
      const parsed = RoomSchema.safeParse(payload || {});
      if (!parsed.success) throw new Error("Invalid room payload");

      engine.retryJudge({
        roomId: parsed.data.roomId,
        wallet: requireWallet(socket),
      });
    } catch (e) {
      emitError(socket, e);
    }
  });

  socket.on("challenge:create", (payload) => {
    try {
      const parsed = ChallengeCreateSchema.safeParse(payload || {});
      if (!parsed.success) throw new Error("Invalid challenge payload");

      engine.createChallenge({
        roomId: parsed.data.roomId,
        wallet: requireWallet(socket),
        roundId: parsed.data.roundId,
        reasonCode: parsed.data.reasonCode || "too_harsh",
      });
    } catch (e) {
      emitError(socket, e);
    }
  });

  socket.on("challenge:vote", (payload) => {
    try {
      const parsed = ChallengeVoteSchema.safeParse(payload || {});
      if (!parsed.success) throw new Error("Invalid vote payload");

      engine.voteChallenge({
        roomId: parsed.data.roomId,
        wallet: requireWallet(socket),
        voteYes: parsed.data.voteYes,
      });
    } catch (e) {
      emitError(socket, e);
    }
  });

  socket.on("disconnect", () => {
    const wallet = socket.data.wallet;
    const roomId = socket.data.roomId;
    if (wallet && roomId) {
      engine.leaveRoom({ socket, roomId, wallet });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
