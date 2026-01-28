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

function mustReplace(from, to, label) {
  if (!s.includes(from)) {
    console.error("❌ Patch failed at:", label);
    console.error("Missing exact snippet:\n" + from);
    process.exit(1);
  }
  s = s.replace(from, to);
  console.log("✅", label);
}

/* -------------------------
   1) Verdict: show “deliberating” instead of “No scores yet”
-------------------------- */
mustReplace(
  `        {lb.length === 0 ? (
          <div className="mt-2 text-sm text-white/70">No scores yet.</div>
        ) : (`,
  `        {lb.length === 0 ? (
          <div className="mt-2 text-sm text-white/70">
            {match?.phase === "verdict" ? "The judge is deliberating. Stand by…" : "No scores yet."}
          </div>
        ) : (`,
  "Leaderboard empty-state -> deliberating during verdict"
);

/* -------------------------
   2) Completed: show final leaderboard in Match view too
-------------------------- */
mustReplace(
  `{phase === "completed" && <HintPanel title="Case Closed" text="Match completed. Next: aggregate XP + final leaderboard." />}`,
  `{phase === "completed" && (
            <>
              <HintPanel title="Case Closed" text="Match completed. Final XP is below." />
              <FinalLeaderboard match={match} />
            </>
          )}`,
  "Match completed -> include FinalLeaderboard"
);

fs.writeFileSync(file, s);
console.log("✅ patched", file);
NODE

echo ""
echo "Next:"
echo "  npm run dev"
