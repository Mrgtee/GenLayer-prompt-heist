#!/usr/bin/env bash
set -euo pipefail

FILE="src/App.jsx"
ts="$(date +%Y%m%d_%H%M%S)"
cp -a "$FILE" "$FILE.bak.$ts"
echo "✅ backup: $FILE -> $FILE.bak.$ts"

node <<'NODE'
import fs from "fs";

const file = "src/App.jsx";
let s = fs.readFileSync(file, "utf8");

function fail(msg) {
  console.error("❌", msg);
  process.exit(1);
}

/**
 * Patch Leaderboard() to:
 * - detect match.isJudging during verdict/challenge_window
 * - show spinner + hint instead of 0/100 rows
 */
const reLeaderboard = /function\s+Leaderboard\s*\(\{\s*match\s*,\s*roundId\s*,\s*members\s*=\s*\[\]\s*\}\)\s*\{\s*\n\s*const\s+lb\s*=\s*match\.leaderboard\?\.\[roundId\]\s*\|\|\s*\[\]\s*;\s*\n/s;

if (!reLeaderboard.test(s)) {
  fail("Could not find Leaderboard() header with `const lb = match.leaderboard?.[roundId] || [];`");
}

s = s.replace(reLeaderboard, (m) => {
  return m + `  const phase = match?.phase;
  const isJudging = !!match?.isJudging;

  // If we're in verdict (or appeal window) and judging is still running,
  // show a deliberate state instead of rendering 0/100.
  const showDeliberating =
    isJudging && (phase === "verdict" || phase === "challenge_window" || phase === "challenge_vote");
`;
});

// Insert spinner JSX right before the lb empty-state block.
// We’ll locate the "No scores yet" block and wrap it with deliberating UI.
const reNoScoresBlock = /\{\s*lb\.length\s*===\s*0\s*\?\s*\(\s*\n\s*<div className="mt-2 text-sm text-white\/70">No scores yet\.<\/div>\s*\n\s*\)\s*:\s*\(/m;

if (!reNoScoresBlock.test(s)) {
  fail('Could not find the "No scores yet." empty-state block inside Leaderboard().');
}

s = s.replace(reNoScoresBlock, `{showDeliberating ? (
        <div className="mt-3 flex items-center gap-3 text-sm text-white/70">
          <span className="inline-block h-4 w-4 rounded-full border-2 border-white/20 border-t-white/70 animate-spin" />
          <span>
            Judge is deliberating…
            <span className="text-white/50"> If it takes too long, wait a moment and it will update automatically.</span>
          </span>
        </div>
      ) : lb.length === 0 ? (
        <div className="mt-2 text-sm text-white/70">No scores yet.</div>
      ) : (`);

// Also avoid showing "Why:" empty line when deliberating or when reasoning is missing
const reWhyLine = /<span className="text-white\/50 font-mono">Why:<\/span>\s*\{x\.reasoning\s*\|\|\s*x\.why\s*\|\|\s*""\}/m;
if (reWhyLine.test(s)) {
  s = s.replace(reWhyLine, `<span className="text-white/50 font-mono">Why:</span> {x.reasoning || x.why || "—"}`);
}

fs.writeFileSync(file, s, "utf8");
console.log("✅ patched Leaderboard deliberating spinner");
NODE

echo "✅ Done. Restart the app dev server."
