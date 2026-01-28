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
const original = s;

// 1) Leaderboard empty-state: show deliberating during verdict
// Replace ONLY the empty-state div content, leaving structure intact.
{
  const re = /(\{lb\.length\s*===\s*0\s*\?\s*\(\s*<div\s+className="mt-2\s+text-sm\s+text-white\/70">\s*)(No scores yet\.)\s*(<\/div>\s*\)\s*:\s*\()/m;

  if (!re.test(s)) {
    console.error("❌ Could not find the Leaderboard empty-state 'No scores yet.' block to patch.");
    process.exit(1);
  }

  s = s.replace(re, `$1{match?.phase === "verdict" ? "The judge is deliberating. Stand by…" : "No scores yet."}$3`);
  console.log("✅ patched Leaderboard empty-state (verdict -> deliberating)");
}

// 2) Completed phase: show FinalLeaderboard in Match view too
{
  const re = /\{phase\s*===\s*"completed"\s*&&\s*<HintPanel\s+title="Case Closed"\s+text="Match completed\.\s*Next:\s*aggregate XP \+ final leaderboard\."\s*\/>\s*\}/m;

  if (!re.test(s)) {
    console.error("❌ Could not find the Match completed HintPanel line to patch.");
    process.exit(1);
  }

  s = s.replace(
    re,
    `{phase === "completed" && (
          <>
            <HintPanel title="Case Closed" text="Match completed. Final XP is below." />
            <FinalLeaderboard match={match} />
          </>
        )}`
  );
  console.log("✅ patched Match completed view (added FinalLeaderboard)");
}

if (s === original) {
  console.error("❌ No changes were made (unexpected).");
  process.exit(1);
}

fs.writeFileSync(file, s);
console.log("✅ wrote", file);
NODE

echo ""
echo "Next:"
echo "  npm run dev"
