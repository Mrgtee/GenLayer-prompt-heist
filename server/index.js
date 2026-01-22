import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import { z } from 'zod';
import { recoverMessageAddress } from 'viem';

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = Number(process.env.PORT || 3001);

// --------------------
// In-memory MVP storage
// --------------------
/**
 * For MVP we keep state in memory.
 * For production, move to Postgres/Redis.
 */
const users = new Map(); // wallet -> { displayName, updatedAt }
const rooms = new Map(); // roomId -> { host, members: Map(wallet->{displayName}), state }
const matches = new Map(); // roomId -> { rounds, currentRoundIndex, phase, phaseEndsAt, submissions, leaderboard, challenge }

const NameSchema = z.object({
  wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  displayName: z.string().min(1).max(20).regex(/^[a-zA-Z0-9_]+$/),
  timestamp: z.number().int().positive(),
  signature: z.string().min(10)
});

app.get('/health', (_req, res) => res.json({ ok: true }));

/**
 * POST /api/profile/display-name
 * Body: { wallet, displayName, timestamp, signature }
 *
 * The client signs:
 *   "Set display name to <displayName> at <timestamp>"
 */
app.post('/api/profile/display-name', async (req, res) => {
  const parsed = NameSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  const { wallet, displayName, timestamp, signature } = parsed.data;
  const message = `Set display name to ${displayName} at ${timestamp}`;

  try {
    const recovered = await recoverMessageAddress({ message, signature });
    if (recovered.toLowerCase() !== wallet.toLowerCase()) {
      return res.status(401).json({ ok: false, error: 'Signature does not match wallet' });
    }

    users.set(wallet.toLowerCase(), { displayName, updatedAt: Date.now() });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

// --------------------
// Socket.IO (Rooms + Match State)
// --------------------
function getOrCreateRoom(roomId, hostWallet) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      host: hostWallet,
      members: new Map(),
      createdAt: Date.now()
    });
  }
  return rooms.get(roomId);
}

function nowMs() { return Date.now(); }

function emitRoomState(roomId) {
  const room = rooms.get(roomId);
  const match = matches.get(roomId);
  const members = [...(room?.members ?? new Map()).entries()].map(([wallet, m]) => ({ wallet, displayName: m.displayName }));
  io.to(roomId).emit('room:state', {
    roomId,
    host: room?.host ?? null,
    members,
    match: match ?? null
  });
}

function startMatch(roomId) {
  // MVP content: hardcoded 3 rounds (replace with weekly pack file on disk)
  const rounds = [
    {
      roundId: 'r1',
      imageUrl: 'https://picsum.photos/seed/genlayer1/800/500',
      schemaHint: { theme: 'Cyberpunk Animals' }
    },
    {
      roundId: 'r2',
      imageUrl: 'https://picsum.photos/seed/genlayer2/800/500',
      schemaHint: { theme: 'Cyberpunk Animals' }
    },
    {
      roundId: 'r3',
      imageUrl: 'https://picsum.photos/seed/genlayer3/800/500',
      schemaHint: { theme: 'Cyberpunk Animals' }
    }
  ];

  const match = {
    rounds,
    currentRoundIndex: 0,
    phase: 'reveal', // reveal -> submit -> verdict -> challenge(optional) -> next
    phaseEndsAt: nowMs() + 30_000,
    submissions: {}, // roundId -> { wallet -> text }
    leaderboard: {}, // roundId -> array of {wallet, score, reasoning}
    challenge: null  // { roundId, createdAt, endsAt, votes: {wallet: boolean}, reasonCode }
  };

  matches.set(roomId, match);
  schedulePhaseTick(roomId);
  emitRoomState(roomId);
}

function schedulePhaseTick(roomId) {
  const tick = () => {
    const match = matches.get(roomId);
    if (!match) return;

    const { phase, phaseEndsAt } = match;
    if (nowMs() < phaseEndsAt) {
      setTimeout(tick, 250);
      return;
    }

    // Phase transitions
    const currentRound = match.rounds[match.currentRoundIndex];
    if (!currentRound) {
      match.phase = 'completed';
      emitRoomState(roomId);
      return;
    }

    if (phase === 'reveal') {
      match.phase = 'submit';
      match.phaseEndsAt = nowMs() + 75_000;
      emitRoomState(roomId);
      setTimeout(tick, 250);
      return;
    }

    if (phase === 'submit') {
      match.phase = 'verdict';
      match.phaseEndsAt = nowMs() + 20_000; // UI breathing room while we "score"
      // TODO: call GenLayer IC score_round here
      // For MVP scaffolding, we create a mock leaderboard.
      const roundId = currentRound.roundId;
      const subs = match.submissions[roundId] || {};
      const scored = Object.entries(subs).map(([wallet, text]) => ({
        wallet,
        score: Math.min(100, 40 + text.length % 61),
        reasoning: 'Mock judge: scored by length; replace with IC reasoning.'
      })).sort((a, b) => b.score - a.score);
      match.leaderboard[roundId] = scored;

      emitRoomState(roomId);
      setTimeout(tick, 250);
      return;
    }

    if (phase === 'verdict') {
      // Open a short window where someone may initiate a challenge.
      match.phase = 'challenge_window';
      match.phaseEndsAt = nowMs() + 20_000;
      emitRoomState(roomId);
      setTimeout(tick, 250);
      return;
    }

    if (phase === 'challenge_window') {
      // If no challenge triggered, advance to next round reveal
      if (!match.challenge) {
        match.currentRoundIndex += 1;
        match.phase = 'reveal';
        match.phaseEndsAt = nowMs() + 30_000;
        emitRoomState(roomId);
        setTimeout(tick, 250);
        return;
      } else {
        // challenge already created, go to full voting
        match.phase = 'challenge_vote';
        match.phaseEndsAt = match.challenge.endsAt;
        emitRoomState(roomId);
        setTimeout(tick, 250);
        return;
      }
    }

    if (phase === 'challenge_vote') {
      // TODO: call GenLayer IC resolve_challenge here based on votes
      // MVP: if YES votes > NO votes, add +3 to everyone (example)
      const ch = match.challenge;
      const votes = ch?.votes || {};
      let yes = 0, no = 0;
      for (const v of Object.values(votes)) (v ? yes++ : no++);
      const passed = yes > no;

      const roundId = ch.roundId;
      if (passed) {
        const lb = match.leaderboard[roundId] || [];
        match.leaderboard[roundId] = lb.map(x => ({ ...x, score: Math.min(100, x.score + 3), reasoning: x.reasoning + ' (+3 via mock democracy)' }))
          .sort((a, b) => b.score - a.score);
      }

      match.challenge = null;
      match.currentRoundIndex += 1;
      match.phase = 'reveal';
      match.phaseEndsAt = nowMs() + 30_000;
      emitRoomState(roomId);
      setTimeout(tick, 250);
      return;
    }

    // fallback
    setTimeout(tick, 250);
  };

  setTimeout(tick, 250);
}

io.on('connection', (socket) => {
  socket.on('room:join', ({ roomId, wallet }) => {
    if (!roomId || !wallet) return;
    const room = getOrCreateRoom(roomId, wallet);
    const cached = users.get(wallet.toLowerCase());
    const displayName = cached?.displayName || `player_${wallet.slice(2, 6)}`;

    room.members.set(wallet.toLowerCase(), { displayName });
    socket.join(roomId);
    emitRoomState(roomId);
  });

  socket.on('room:leave', ({ roomId, wallet }) => {
    const room = rooms.get(roomId);
    if (room) room.members.delete(wallet.toLowerCase());
    socket.leave(roomId);
    emitRoomState(roomId);
  });

  socket.on('match:start', ({ roomId, wallet }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    if (room.host.toLowerCase() !== wallet.toLowerCase()) return;
    startMatch(roomId);
  });

  socket.on('round:submit', ({ roomId, wallet, roundId, text }) => {
    const match = matches.get(roomId);
    if (!match || match.phase !== 'submit') return;
    match.submissions[roundId] = match.submissions[roundId] || {};
    match.submissions[roundId][wallet.toLowerCase()] = String(text || '').slice(0, 240);
    emitRoomState(roomId);
  });

  socket.on('challenge:create', ({ roomId, wallet, roundId, reasonCode }) => {
    const match = matches.get(roomId);
    if (!match || match.phase !== 'challenge_window') return;
    if (match.challenge) return;

    match.challenge = {
      roundId,
      reasonCode: reasonCode || 'too_harsh',
      createdAt: nowMs(),
      endsAt: nowMs() + 120_000,
      votes: {}
    };
    match.phase = 'challenge_vote';
    match.phaseEndsAt = match.challenge.endsAt;
    emitRoomState(roomId);
  });

  socket.on('challenge:vote', ({ roomId, wallet, voteYes }) => {
    const match = matches.get(roomId);
    if (!match || match.phase !== 'challenge_vote' || !match.challenge) return;
    match.challenge.votes[wallet.toLowerCase()] = !!voteYes;
    emitRoomState(roomId);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
