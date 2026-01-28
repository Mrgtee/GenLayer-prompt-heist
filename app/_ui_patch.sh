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

function mustReplace(pattern, replacer, label) {
  const before = s;
  s = s.replace(pattern, replacer);
  if (s === before) {
    console.error("❌ Patch failed at:", label);
    process.exit(1);
  }
}

/**
 * 1) FinalLeaderboard: "Rounds: -" -> show actual rounds
 * Match regardless of whitespace.
 */
mustReplace(
  /<span className="text-white\/50 font-mono">Rounds:<\/span>\s*\{p\.roundsPlayed\s*\?\?\s*"-"\s*\}/m,
  `<span className="text-white/50 font-mono">Rounds:</span> {rounds}`,
  "FinalLeaderboard roundsPlayed -> rounds"
);

/**
 * 2) Leaderboard empty state: during verdict, show "Scoring…"
 */
mustReplace(
  /\{lb\.length\s*===\s*0\s*\?\s*\(\s*<div className="mt-2 text-sm text-white\/70">No scores yet\.<\/div>\s*\)\s*:\s*\(/m,
  `{lb.length === 0 ? (
        <div className="mt-2 text-sm text-white/70">
          {match?.phase === "verdict" ? "Scoring…" : "No scores yet."}
        </div>
      ) : (`,
  "Leaderboard empty state verdict -> Scoring…"
);

/**
 * 3) Leaderboard reasoning: never render blank.
 * Match any className around the Why label; replace only the `{x.reasoning}` expression.
 */
mustReplace(
  /(<span[^>]*>\s*Why:\s*<\/span>\s*)\{x\.reasoning\}/m,
  `$1{x.reasoning || (match?.phase === "verdict" ? "Judge is finalizing reasoning…" : "—")}`,
  "Leaderboard reasoning fallback"
);

/**
 * 4) Defensive fallback for unknown phase (prevents accidental empty state)
 * Insert right after the "completed" HintPanel line.
 */
mustReplace(
  /\{phase === "completed"\s*&&\s*<HintPanel\s+title="Case Closed"\s+text="Match completed\. Next: aggregate XP \+ final leaderboard\."\s*\/>\s*\}/m,
  `{phase === "completed" && <HintPanel title="Case Closed" text="Match completed. Next: aggregate XP + final leaderboard." />}
        {!["reveal","submit","verdict","challenge_window","challenge_vote","completed"].includes(phase) && (
          <HintPanel title="Processing" text="The judge is deliberating. Stand by." />
        )}`,
  "GameCard unknown phase fallback"
);

fs.writeFileSync(file, s);
console.log("✅ Patched src/App.jsx");
NODE

echo ""
echo "✅ Done."
echo "Next:"
echo "  npm run dev"
