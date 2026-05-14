import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { addXp } from "./db.js";
import { judgeGuess, reviewVerdict } from "./genlayerJudge.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function nowMs() {
  return Date.now();
}

function uid(prefix = "") {
  return prefix + crypto.randomBytes(8).toString("hex");
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function safeErrorMessage(error) {
  const raw = error?.message || String(error || "unknown error");
  return raw.slice(0, 180);
}

function envMs(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

function loadCasesFromDisk() {
  const p = path.join(__dirname, "cases.json");
  const raw = fs.readFileSync(p, "utf8");
  const arr = JSON.parse(raw);

  if (!Array.isArray(arr) || arr.length < 5) {
    throw new Error("cases.json must be an array with at least 5 items");
  }

  const seen = new Set();
  for (const c of arr) {
    if (!c?.id || !c?.imageUrl || !c?.secretPrompt) {
      throw new Error("Each case must have { id, imageUrl, secretPrompt }");
    }
    if (seen.has(c.id)) throw new Error(`Duplicate case id: ${c.id}`);
    seen.add(c.id);
  }

  return arr;
}

const __JUDGE_STATE__ = {
  failCount: 0,
  lastFailAt: 0,
  openUntil: 0,
};

function __sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function __withTimeout(promise, ms) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("Judge timeout")), ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function __openCircuit(ms) {
  __JUDGE_STATE__.openUntil = Date.now() + ms;
}

function __circuitOpen() {
  return Date.now() < (__JUDGE_STATE__.openUntil || 0);
}

async function __judgeWithRetry(callJudge, tries = 3) {
  if (__circuitOpen()) throw new Error("Judge circuit open");

  let lastErr = null;
  const backoffs = [0, 750, 2000];

  for (let i = 0; i < tries; i++) {
    try {
      if (backoffs[i]) await __sleep(backoffs[i]);
      const res = await __withTimeout(callJudge(), 35_000);
      __JUDGE_STATE__.failCount = 0;
      __JUDGE_STATE__.lastFailAt = 0;
      return res;
    } catch (e) {
      lastErr = e;
    }
  }

  __JUDGE_STATE__.failCount += 1;
  __JUDGE_STATE__.lastFailAt = Date.now();
  if (__JUDGE_STATE__.failCount >= 2) __openCircuit(30_000);

  throw lastErr || new Error("Judge failed");
}

const PHASE_MS = {
  reveal: envMs("PHASE_REVEAL_MS", 12_000),
  submit: envMs("PHASE_SUBMIT_MS", 45_000),
  verdict: envMs("PHASE_VERDICT_MS", 8_000),
  challenge_window: envMs("PHASE_CHALLENGE_WINDOW_MS", 25_000),
  challenge_vote: envMs("PHASE_CHALLENGE_VOTE_MS", 25_000),
  challenge_result: envMs("PHASE_CHALLENGE_RESULT_MS", 5_000),
};

const CHALLENGE_REASONS = {
  too_harsh: "The room believes the original score was too harsh.",
  missed_style: "The room believes the judge missed important style or mood details.",
  missed_subject: "The room believes the judge missed a correct subject or scene match.",
};

export class MatchEngine {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
  }

  ensureRoom(roomId) {
    const rid = (roomId || "").trim() || "genlayer";
    let room = this.rooms.get(rid);
    if (!room) {
      room = {
        roomId: rid,
        host: null,
        members: [],
        match: null,
        timers: { phaseTimeout: null },
      };
      this.rooms.set(rid, room);
    }
    return room;
  }

  getRoom(roomId) {
    const rid = (roomId || "").trim() || "genlayer";
    return this.rooms.get(rid) || null;
  }

  publicRoundState(round) {
    const submissions = {};
    for (const [wallet, sub] of Object.entries(round.submissions || {})) {
      submissions[wallet] = {
        submitted: true,
        submittedAtMs: sub.submittedAtMs,
      };
    }

    return {
      roundId: round.roundId,
      caseId: round.caseId,
      imageUrl: round.imageUrl,
      submissions,
    };
  }

  publicMatchState(match) {
    if (!match) return null;
    const { rounds, ...rest } = match;
    return {
      ...rest,
      judgeError: rest.judgeError
        ? {
            type: rest.judgeError.type,
            message: rest.judgeError.message,
            atMs: rest.judgeError.atMs,
          }
        : null,
      rounds: (rounds || []).map((round) => this.publicRoundState(round)),
    };
  }

  publicRoomState(room) {
    return {
      roomId: room.roomId,
      host: room.host,
      members: room.members,
      match: this.publicMatchState(room.match),
    };
  }

  emitRoomState(room) {
    this.io.to(room.roomId).emit("room:state", this.publicRoomState(room));
  }

  clearTimers(room) {
    if (room.timers?.phaseTimeout) {
      clearTimeout(room.timers.phaseTimeout);
      room.timers.phaseTimeout = null;
    }
  }

  scheduleNextPhase(room) {
    this.clearTimers(room);
    const match = room.match;
    if (!match?.phaseEndsAtMs) return;

    const delay = Math.max(0, match.phaseEndsAtMs - nowMs());
    room.timers.phaseTimeout = setTimeout(() => {
      try {
        this.advancePhase(room.roomId);
      } catch (e) {
        console.error("advancePhase error:", e);
        this.setJudgeError(room, "engine", e);
      }
    }, delay);
  }

  isMember(room, wallet) {
    const w = (wallet || "").toLowerCase();
    return room.members.some((m) => m.wallet.toLowerCase() === w);
  }

  isHost(room, wallet) {
    return !!room.host && room.host.toLowerCase() === (wallet || "").toLowerCase();
  }

  updateDisplayName({ wallet, displayName }) {
    const w = (wallet || "").toLowerCase();
    const nextName = (displayName || "").trim();
    if (!w || !nextName) return;

    for (const room of this.rooms.values()) {
      const member = room.members.find((m) => m.wallet.toLowerCase() === w);
      if (!member || member.displayName === nextName) continue;
      member.displayName = nextName;
      this.emitRoomState(room);
    }
  }

  joinRoom({ socket, roomId, wallet, displayName }) {
    const room = this.ensureRoom(roomId);
    const w = (wallet || "").toLowerCase();

    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet || "")) throw new Error("Invalid wallet");

    socket.join(room.roomId);
    socket.data.roomId = room.roomId;

    const existing = room.members.find((m) => m.wallet.toLowerCase() === w);
    if (!existing) {
      room.members.push({
        wallet,
        displayName: (displayName || "").trim() || `player_${wallet.slice(2, 6)}`,
      });
    } else if (displayName && displayName.trim() && displayName !== existing.displayName) {
      existing.displayName = displayName.trim();
    }

    if (!room.host) room.host = wallet;

    this.emitRoomState(room);
    return room;
  }

  leaveRoom({ socket, roomId, wallet }) {
    const room = this.getRoom(roomId);
    if (!room) return;

    const w = (wallet || "").toLowerCase();
    socket.leave(room.roomId);

    room.members = room.members.filter((m) => m.wallet.toLowerCase() !== w);
    if (room.host && room.host.toLowerCase() === w) {
      room.host = room.members[0]?.wallet || null;
    }

    if (room.members.length === 0) {
      this.stopMatch(room);
      this.rooms.delete(room.roomId);
      return;
    }

    this.emitRoomState(room);
  }

  startMatch({ roomId, wallet, rounds = 3 }) {
    const room = this.getRoom(roomId);
    if (!room) throw new Error("Room not found");
    if (!this.isHost(room, wallet)) throw new Error("Only host can start match");

    if (room.match && room.match.phase !== "completed") {
      throw new Error("Match already running");
    }

    const chosen = this.pickCases(loadCasesFromDisk(), rounds);

    room.match = {
      matchId: uid("match_"),
      phase: "reveal",
      isJudging: false,
      startedAtMs: nowMs(),
      currentRoundIndex: 0,
      rounds: chosen.map((c) => ({
        roundId: uid("round_"),
        caseId: c.id,
        imageUrl: c.imageUrl,
        secretPrompt: c.secretPrompt,
        submissions: {},
        scores: {},
      })),
      leaderboard: {},
      challenge: null,
      finalLeaderboard: [],
      judgeError: null,
      xpPersisted: false,
      phaseEndsAtMs: nowMs() + PHASE_MS.reveal,
    };

    this.emitRoomState(room);
    this.scheduleNextPhase(room);
  }

  stopMatch(room) {
    this.clearTimers(room);
    if (room.match) {
      room.match.phase = "completed";
      room.match.phaseEndsAtMs = null;
      room.match.isJudging = false;
    }
  }

  advancePhase(roomId) {
    const room = this.getRoom(roomId);
    if (!room?.match) return;

    const match = room.match;
    const phase = match.phase;
    const round = match.rounds[match.currentRoundIndex];

    if (!round) return this.finishMatch(room);

    if (phase === "reveal") {
      match.phase = "submit";
      match.phaseEndsAtMs = nowMs() + PHASE_MS.submit;
      this.emitRoomState(room);
      return this.scheduleNextPhase(room);
    }

    if (phase === "submit") {
      return this.beginRoundScoring(room);
    }

    if (phase === "verdict") {
      match.phase = "challenge_window";
      match.phaseEndsAtMs = nowMs() + PHASE_MS.challenge_window;
      match.challenge = null;
      this.emitRoomState(room);
      return this.scheduleNextPhase(room);
    }

    if (phase === "challenge_window") {
      if (!match.challenge) return this.nextRoundOrFinish(room);
      match.phase = "challenge_vote";
      match.phaseEndsAtMs = match.challenge.endsAtMs || nowMs() + PHASE_MS.challenge_vote;
      this.emitRoomState(room);
      return this.scheduleNextPhase(room);
    }

    if (phase === "challenge_vote") {
      return this.beginChallengeResolution(room);
    }

    if (phase === "challenge_result") {
      return this.nextRoundOrFinish(room);
    }
  }

  beginRoundScoring(room) {
    const match = room.match;
    const round = match.rounds[match.currentRoundIndex];
    if (!round) return this.finishMatch(room);

    this.clearTimers(room);
    match.phase = "verdict";
    match.isJudging = true;
    match.judgeError = null;
    match.phaseEndsAtMs = null;
    this.emitRoomState(room);

    this.scoreRound(room, round)
      .then(() => {
        match.isJudging = false;
        match.phaseEndsAtMs = nowMs() + PHASE_MS.verdict;
        this.emitRoomState(room);
        this.scheduleNextPhase(room);
      })
      .catch((e) => {
        console.error("scoreRound failed:", e);
        this.setJudgeError(room, "score_round", e);
      });
  }

  retryJudge({ roomId, wallet }) {
    const room = this.getRoom(roomId);
    if (!room?.match) throw new Error("Room or match not found");
    if (!this.isHost(room, wallet)) throw new Error("Only host can retry judging");
    if (room.match.phase !== "judge_error") throw new Error("No judge error to retry");

    if (room.match.judgeError?.type === "challenge_review") {
      return this.beginChallengeReview(room);
    }
    return this.beginRoundScoring(room);
  }

  setJudgeError(room, type, error) {
    this.clearTimers(room);
    const match = room.match;
    if (!match) return;

    match.phase = "judge_error";
    match.isJudging = false;
    match.phaseEndsAtMs = null;
    match.judgeError = {
      type,
      message: "GenLayer did not return a consensus verdict. The host can retry.",
      detail: safeErrorMessage(error),
      atMs: nowMs(),
    };

    this.emitRoomState(room);
  }

  nextRoundOrFinish(room) {
    const match = room.match;
    if (!match) return;

    const nextIndex = match.currentRoundIndex + 1;
    if (nextIndex >= match.rounds.length) return this.finishMatch(room);

    match.currentRoundIndex = nextIndex;
    match.phase = "reveal";
    match.phaseEndsAtMs = nowMs() + PHASE_MS.reveal;
    match.challenge = null;
    match.judgeError = null;
    match.isJudging = false;

    this.emitRoomState(room);
    this.scheduleNextPhase(room);
  }

  finishMatch(room) {
    this.clearTimers(room);
    if (!room.match) return;

    room.match.phase = "completed";
    room.match.phaseEndsAtMs = null;
    room.match.isJudging = false;
    this.buildFinalLeaderboardAndPersist(room);
    this.emitRoomState(room);
  }

  buildFinalLeaderboardAndPersist(room) {
    const match = room.match;
    if (!match) return;
    if (match.xpPersisted) return;

    const totals = new Map();
    for (const r of match.rounds || []) {
      for (const [walletLower, s] of Object.entries(r.scores || {})) {
        const xp = Number(s.xpDelta ?? s.score) || 0;
        totals.set(walletLower, (totals.get(walletLower) || 0) + xp);
      }
    }

    const finalLeaderboard = [];
    for (const [walletLower, totalXp] of totals.entries()) {
      const member = room.members.find((m) => m.wallet.toLowerCase() === walletLower);
      const displayName = member?.displayName || `player_${walletLower.slice(2, 6)}`;
      const wallet = member?.wallet || walletLower;
      const roundedXp = Math.max(0, Math.round(totalXp));

      finalLeaderboard.push({ wallet, displayName, totalXp: roundedXp });

      try {
        addXp({ wallet, deltaXp: roundedXp, displayName });
      } catch (e) {
        console.error("addXp failed:", e);
      }
    }

    finalLeaderboard.sort((a, b) => b.totalXp - a.totalXp);
    match.finalLeaderboard = finalLeaderboard;
    match.xpPersisted = true;
  }

  submit({ roomId, wallet, roundId, text }) {
    const room = this.getRoom(roomId);
    if (!room?.match || !this.isMember(room, wallet)) return;

    const match = room.match;
    if (match.phase !== "submit") return;

    const round = match.rounds.find((r) => r.roundId === roundId);
    if (!round) return;

    const t = (text || "").trim();
    if (!t) return;

    round.submissions[(wallet || "").toLowerCase()] = {
      text: t.slice(0, 240),
      submittedAtMs: nowMs(),
    };
    this.emitRoomState(room);
  }

  createChallenge({ roomId, wallet, roundId, reasonCode = "too_harsh" }) {
    const room = this.getRoom(roomId);
    if (!room?.match || !this.isMember(room, wallet)) return;

    const match = room.match;
    const currentRound = match.rounds[match.currentRoundIndex];
    if (match.phase !== "challenge_window" || !currentRound) return;
    if (currentRound.roundId !== roundId) return;
    if (match.challenge) return;

    match.challenge = {
      roundId,
      createdBy: wallet,
      reasonCode,
      votes: {},
      endsAtMs: nowMs() + PHASE_MS.challenge_vote,
    };

    match.phase = "challenge_vote";
    match.phaseEndsAtMs = match.challenge.endsAtMs;
    this.emitRoomState(room);
    this.scheduleNextPhase(room);
  }

  voteChallenge({ roomId, wallet, voteYes }) {
    const room = this.getRoom(roomId);
    if (!room?.match || !this.isMember(room, wallet)) return;

    const match = room.match;
    if (match.phase !== "challenge_vote" || !match.challenge) return;

    match.challenge.votes[(wallet || "").toLowerCase()] = !!voteYes;
    this.emitRoomState(room);
  }

  countChallengeVotes(challenge) {
    const votes = Object.values(challenge?.votes || {});
    const yes = votes.filter(Boolean).length;
    const no = votes.length - yes;
    return { yes, no, overturn: yes > no && votes.length > 0 };
  }

  beginChallengeResolution(room) {
    const match = room.match;
    const ch = match?.challenge;
    if (!ch) return this.nextRoundOrFinish(room);

    const counts = this.countChallengeVotes(ch);
    if (!counts.overturn) {
      match.challenge = {
        ...ch,
        resolved: true,
        result: "upheld",
        yes: counts.yes,
        no: counts.no,
      };
      match.phase = "challenge_result";
      match.phaseEndsAtMs = nowMs() + PHASE_MS.challenge_result;
      this.emitRoomState(room);
      return this.scheduleNextPhase(room);
    }

    return this.beginChallengeReview(room);
  }

  beginChallengeReview(room) {
    const match = room.match;
    const ch = match?.challenge;
    if (!ch) return this.nextRoundOrFinish(room);

    this.clearTimers(room);
    match.phase = "challenge_review";
    match.isJudging = true;
    match.judgeError = null;
    match.phaseEndsAtMs = null;
    this.emitRoomState(room);

    const counts = this.countChallengeVotes(ch);
    this.reviewChallengedRound(room, counts)
      .then(() => {
        match.isJudging = false;
        match.phase = "challenge_result";
        match.phaseEndsAtMs = nowMs() + PHASE_MS.challenge_result;
        this.emitRoomState(room);
        this.scheduleNextPhase(room);
      })
      .catch((e) => {
        console.error("challenge review failed:", e);
        this.setJudgeError(room, "challenge_review", e);
      });
  }

  async reviewChallengedRound(room, counts) {
    const match = room.match;
    const ch = match.challenge;
    const round = match.rounds.find((r) => r.roundId === ch.roundId);
    if (!round) throw new Error("Challenge round not found");

    const challengeReason = CHALLENGE_REASONS[ch.reasonCode] || CHALLENGE_REASONS.too_harsh;
    let adjusted = 0;

    for (const [walletLower, scoreData] of Object.entries(round.scores || {})) {
      const sub = round.submissions?.[walletLower];
      if (!sub?.text) continue;

      const review = await __judgeWithRetry(() => reviewVerdict({
        guess: sub.text,
        secret: round.secretPrompt,
        originalScore: scoreData.score,
        originalReasoning: scoreData.reasoning,
        challengeReason,
      }));

      if (review.action === "adjust" && review.score !== scoreData.score) {
        adjusted += 1;
        round.scores[walletLower] = {
          score: clamp(review.score, 0, 100),
          xpDelta: clamp(review.score, 0, 100),
          reasoning: `Challenge adjusted: ${review.reasoning}`,
        };
      } else {
        round.scores[walletLower] = {
          ...scoreData,
          reasoning: `Challenge upheld: ${review.reasoning}`,
        };
      }
    }

    this.buildLeaderboard(match, round);
    match.challenge = {
      ...ch,
      resolved: true,
      result: adjusted > 0 ? "adjusted" : "upheld_after_review",
      adjusted,
      yes: counts.yes,
      no: counts.no,
    };
  }

  async scoreRound(room, round) {
    const entries = Object.entries(round.submissions || {});
    const scores = {};

    for (const [walletLower, sub] of entries) {
      const guess = sub.text || "";
      const secret = round.secretPrompt || "";

      const res = await __judgeWithRetry(() => judgeGuess({ guess, secret }));
      scores[walletLower] = {
        score: clamp(res.score, 0, 100),
        xpDelta: Math.max(0, Math.round(Number(res.xpDelta ?? res.score) || 0)),
        reasoning: res.reasoning,
      };
    }

    round.scores = scores;
    this.buildLeaderboard(room.match, round);
  }

  buildLeaderboard(match, round) {
    const list = Object.entries(round.scores || {}).map(([walletLower, s]) => ({
      wallet: walletLower,
      score: s.score,
      xpDelta: s.xpDelta,
      reasoning: s.reasoning,
    }));

    list.sort((a, b) => b.score - a.score);
    match.leaderboard = match.leaderboard || {};
    match.leaderboard[round.roundId] = list;
  }

  pickCases(cases, n) {
    const count = clamp(Number(n || 3), 1, 10);
    const shuffled = shuffle(cases);
    const selected = shuffled.slice(0, count);
    while (selected.length < count) selected.push(...shuffled);
    return selected.slice(0, count);
  }
}
