#!/usr/bin/env bash
set -euo pipefail

FILE="src/App.jsx"

echo "==> Looking for latest backup..."
LATEST_BAK="$(ls -1t ${FILE}.bak.* 2>/dev/null | head -n 1 || true)"

if [ -z "${LATEST_BAK}" ]; then
  echo "❌ No backup found at ${FILE}.bak.*"
  exit 1
fi

echo "✅ Restoring from: ${LATEST_BAK}"
cp -a "${LATEST_BAK}" "${FILE}"

echo "==> Patching Leaderboard() safely (marker-based)..."
node <<'NODE'
import fs from "fs";

const file = "src/App.jsx";
let s = fs.readFileSync(file, "utf8");

const startNeedle = "function Leaderboard(";
const endNeedle = "function Votes(";

const start = s.indexOf(startNeedle);
const end = s.indexOf(endNeedle);

if (start === -1) {
  console.error("❌ Could not find:", startNeedle);
  process.exit(1);
}
if (end === -1 || end <= start) {
  console.error("❌ Could not find end marker:", endNeedle);
  process.exit(1);
}

// keep everything before Leaderboard, replace Leaderboard block, keep Votes+ after
const before = s.slice(0, start);
const after = s.slice(end);

const replacement = `function Leaderboard({ match, roundId, members = [] }) {
  const lb = match.leaderboard?.[roundId] || [];
  const phase = match.phase;

  // During verdict/challenge, judge may still be deliberating
  const showPending =
    (phase === "verdict" || phase === "challenge_window") && lb.length === 0;

  // After match completion, hide Round leaderboard (Final + Global should remain)
  if (phase === "completed") return null;

  const byWallet = new Map(
    (members || []).map((m) => [(m.wallet || "").toLowerCase(), m.displayName || ""])
  );
  const nameOf = (w) => byWallet.get((w || "").toLowerCase()) || "";

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="text-xs text-white/55 font-mono">RULING</div>
      <div className="mt-1 text-sm font-semibold">Leaderboard (Round)</div>

      {showPending && (
        <div className="mt-3 text-sm text-white/70">The judge is deliberating…</div>
      )}

      {!showPending && lb.length === 0 && (
        <div className="mt-2 text-sm text-white/70">No scores yet.</div>
      )}

      {lb.length > 0 && (
        <ol className="mt-3 space-y-2">
          {lb.map((x, idx) => (
            <li
              key={x.wallet}
              className="flex items-start justify-between gap-3 rounded-xl border border-white/10 bg-black/30 p-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-white/60 font-mono">#{idx + 1}</span>
                  <span className="text-sm font-semibold">
                    {nameOf(x.wallet) || x.displayName || shortAddr(x.wallet)}
                  </span>
                  <Badge
                    label={\`\${x.score}/100\`}
                    tone={x.score >= 80 ? "good" : x.score >= 60 ? "muted" : "warn"}
                  />
                </div>
                <div className="mt-1 text-xs text-white/70 leading-relaxed">
                  <span className="text-white/50 font-mono">Why:</span>{" "}
                  {x.reasoning || x.why || "Judging based on prompt similarity and intent."}
                </div>
              </div>
              <ScoreBar score={x.score} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

`;

fs.writeFileSync(file, before + replacement + after, "utf8");
console.log("✅ Leaderboard() patched cleanly (between Leaderboard and Votes).");
NODE

echo "✅ Done. Restart dev server:"
echo "   npm run dev"
