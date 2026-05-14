import { io } from "socket.io-client";
import { privateKeyToAccount } from "viem/accounts";

const SERVER_URL = process.env.SERVER_URL || process.env.VITE_SERVER_URL || "http://localhost:3001";
const TIMEOUT_MS = Number(process.env.ROOM_TEST_TIMEOUT_MS || 120_000);
const roomId = `smoke_${Date.now()}`;

const hostAccount = privateKeyToAccount(
  "0x59c6995e998f97a5a0044976f7d4f1a6f1e9d8bfa4f68d9e3f4d6b6d4f5a6b71"
);
const guestAccount = privateKeyToAccount(
  "0x8b3a350cf5c34c9194ca3a9d8b450b74f92d64f82416d3d9d8b7f3a6d6e7f8c1"
);

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(label, fn, timeoutMs = TIMEOUT_MS, stepMs = 150) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = fn();
    if (value) return value;
    await wait(stepMs);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function createClient(label) {
  const socket = io(SERVER_URL, {
    transports: ["websocket", "polling"],
    forceNew: true,
    reconnection: false,
  });

  const state = {
    label,
    room: null,
    joined: false,
    errors: [],
  };

  socket.on("room:state", (room) => {
    state.room = room;
  });

  socket.on("room:joined", () => {
    state.joined = true;
  });

  socket.on("app:error", (error) => {
    state.errors.push(error?.message || String(error));
  });

  return { socket, state };
}

function joinMessage(targetRoomId, timestamp) {
  return `Join Prompt Heist room ${targetRoomId} at ${timestamp}`;
}

async function signedJoinPayload(account) {
  const timestamp = Math.floor(Date.now() / 1000);
  return {
    roomId,
    wallet: account.address,
    timestamp,
    signature: await account.signMessage({ message: joinMessage(roomId, timestamp) }),
  };
}

async function connectSocket(client) {
  await waitFor(`${client.state.label} socket connect`, () => client.socket.connected);
}

async function main() {
  const host = createClient("host");
  const guest = createClient("guest");

  try {
    await Promise.all([connectSocket(host), connectSocket(guest)]);

    host.socket.emit("room:join", await signedJoinPayload(hostAccount));
    guest.socket.emit("room:join", await signedJoinPayload(guestAccount));

    await waitFor("both clients joined", () => host.state.joined && guest.state.joined);
    const joinedRoom = await waitFor(
      "room roster",
      () => host.state.room && host.state.room.members?.length === 2 && host.state.room
    );

    console.log("Joined room:", joinedRoom.roomId);
    console.log("Members:", joinedRoom.members.map((m) => m.wallet));

    host.socket.emit("match:start", { roomId });

    const revealState = await waitFor(
      "match reveal phase",
      () => host.state.room?.match?.phase === "reveal" && host.state.room
    );
    const roundId = revealState.match.rounds[0]?.roundId;
    if (!roundId) throw new Error("Missing roundId after starting match");

    await waitFor("submit phase", () => host.state.room?.match?.phase === "submit");

    host.socket.emit("round:submit", {
      roomId,
      roundId,
      text: "cinematic neon koi detective in a rainy cyberpunk alley with reflective pavement and moody magenta lighting",
    });
    guest.socket.emit("round:submit", {
      roomId,
      roundId,
      text: "a happy dog in a sunny park",
    });

    await waitFor(
      "two submissions recorded",
      () => Object.keys(host.state.room?.match?.rounds?.[0]?.submissions || {}).length === 2
    );

    const scoredRoom = await waitFor(
      "scored round or judge error",
      () => {
        const match = host.state.room?.match;
        if (!match) return false;
        if (match.phase === "judge_error") return match;
        if (match.leaderboard?.[roundId]?.length === 2) return match;
        return false;
      },
      TIMEOUT_MS
    );

    if (scoredRoom.phase === "judge_error") {
      throw new Error(scoredRoom.judgeError?.message || "Judge error during smoke test");
    }

    console.log("Leaderboard:", scoredRoom.leaderboard[roundId]);
    console.log("Smoke test passed.");
  } finally {
    host.socket.disconnect();
    guest.socket.disconnect();
  }
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exitCode = 1;
});
