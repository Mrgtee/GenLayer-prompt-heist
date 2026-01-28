#!/usr/bin/env bash
set -euo pipefail

FILE="matchEngine.js"
ts="$(date +%Y%m%d_%H%M%S)"
cp -a "$FILE" "$FILE.bak.$ts"
echo "✅ backup: $FILE -> $FILE.bak.$ts"

node <<'NODE'
import fs from "fs";

const file = "matchEngine.js";
let s = fs.readFileSync(file, "utf8");

// 1) Insert helper utilities (only if not already present)
if (!s.includes("const __JUDGE_STATE__")) {
  const anchor = "const PHASE_MS = {";
  const idx = s.indexOf(anchor);
  if (idx === -1) {
    console.error("❌ Could not find PHASE_MS anchor");
    process.exit(1);
  }

  // Insert right BEFORE PHASE_MS
  const helpers = `
/* ---------------- GenLayer Judge Resilience ---------------- */

// Small in-memory circuit breaker (per server process)
const __JUDGE_STATE__ = {
  failCount: 0,
  lastFailAt: 0,
  openUntil: 0,
};

function __sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function __withTimeout(promise, ms) {
  let t;
  const timeout = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error("Judge timeout")), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(t);
  }
}

function __openCircuit(ms) {
  __JUDGE_STATE__.openUntil = Date.now() + ms;
}

function __circuitOpen() {
  return Date.now() < (__JUDGE_STATE__.openUntil || 0);
}

async function __judgeWithRetry({ guess, secret, tries = 3 }) {
  // Circuit open → skip remote judge immediately
  if (__circuitOpen()) throw new Error("Judge circuit open");

  let lastErr = null;
  const backoffs = [0, 250, 750]; // ms

  for (let i = 0; i < tries; i++) {
    try {
      if (backoffs[i]) await __sleep(backoffs[i]);

      // Hard timeout per attempt (tuneable)
      const res = await __withTimeout(judgeGuess({ guess, secret }), 12_000);

      // Success → reset state
      __JUDGE_STATE__.failCount = 0;
      __JUDGE_STATE__.lastFailAt = 0;
      return res;
    } catch (e) {
      lastErr = e;
    }
  }

  // Failure policy: increment fail count; if repeated, open circuit briefly
  __JUDGE_STATE__.failCount = (__JUDGE_STATE__.failCount || 0) + 1;
  __JUDGE_STATE__.lastFailAt = Date.now();

  // After 2 consecutive failures, pause judge attempts for 20s
  if (__JUDGE_STATE__.failCount >= 2) __openCircuit(20_000);

  throw lastErr || new Error("Judge failed");
}

`;
  s = s.slice(0, idx) + helpers + s.slice(idx);
  console.log("✅ inserted judge resilience helpers");
} else {
  console.log("ℹ️ judge resilience helpers already present");
}

// 2) Replace scoreRound with retry+timeout+circuit logic
const re = /async\s+scoreRound\s*\(\s*room\s*,\s*round\s*\)\s*\{[\s\S]*?\n\}\n\n\s*buildLeaderboard\s*\(/m;

if (!re.test(s)) {
  console.error("❌ Could not find async scoreRound(...) block to replace");
  process.exit(1);
}

const replacement = `async scoreRound(room, round) {
  const entries = Object.entries(round.submissions || {});
  const scores = {};

  for (const [walletLower, sub] of entries) {
    const guess = sub.text || "";
    const secret = round.secretPrompt || "";

    let score = 0;
    let reasoning = "";

    try {
      // GenLayer Studio Judge (retry + timeout + circuit breaker)
      const res = await __judgeWithRetry({ guess, secret, tries: 3 });
      score = Number(res.score) || 0;
      reasoning = res.reasoning || "";
    } catch (e) {
      // Fallback (never breaks gameplay)
      score = this.simpleSemanticScore(guess, secret);
      reasoning = this.oneSentenceReasoning(score);

      // Log only a compact message (avoid spam)
      const msg = (e?.message || String(e)).slice(0, 180);
      console.warn("GenLayer judge failed (fallback used):", msg);
    }

    scores[walletLower] = { score, reasoning };
  }

  round.scores = scores;
  this.buildLeaderboard(room.match, round);
}

  buildLeaderboard(`;

s = s.replace(re, replacement);
console.log("✅ replaced scoreRound with resilient version");

fs.writeFileSync(file, s);
console.log("✅ wrote", file);
NODE

echo "✅ Patch complete."
echo "Next: restart your server (recommended: export NODE_OPTIONS=--dns-result-order=ipv4first)"
