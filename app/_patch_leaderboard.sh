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

// Locate the Leaderboard function boundaries
const start = s.indexOf("function Leaderboard(");
if (start === -1) {
  console.error("❌ Could not find `function Leaderboard(` in src/App.jsx");
  process.exit(1);
}

// Find the end of the function by counting braces starting from the first "{"
const braceStart = s.indexOf("{", start);
if (braceStart === -1) {
  console.error("❌ Could not find opening `{` for Leaderboard() in src/App.jsx");
  process.exit(1);
}

let i = braceStart;
let depth = 0;
let inStr = false;
let strCh = "";
let inLineComment = false;
let inBlockComment = false;

for (; i < s.length; i++) {
  const ch = s[i];
  const next = s[i + 1];

  // handle comments
  if (inLineComment) {
    if (ch === "\n") inLineComment = false;
    continue;
  }
  if (inBlockComment) {
    if (ch === "*" && next === "/") {
      inBlockComment = false;
      i++;
    }
    continue;
  }

  // start comments (only when not in string)
  if (!inStr && ch === "/" && next === "/") {
    inLineComment = true;
    i++;
    continue;
  }
  if (!inStr && ch === "/" && next === "*") {
    inBlockComment = true;
    i++;
    continue;
  }

  // handle strings
  if (inStr) {
    if (ch === "\\" ) { i++; continue; } // escape
    if (ch === strCh) { inStr = false; strCh = ""; }
    continue;
  } else {
    if (ch === "'" || ch === '"' || ch === "`") {
      inStr = true;
      strCh = ch;
      continue;
    }
  }

  // count braces
  if (ch === "{") depth++;
  if (ch === "}") {
    depth--;
    if (depth === 0) {
      i++; // include this closing brace
      break;
    }
  }
}

if (depth !== 0) {
  console.error("❌ Could not safely parse Leaderboard() block (brace mismatch).");
  process.exit(1);
}

const end = i;

// New Leaderboard function (replaces the old one)
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

s = s.slice(0, start) + replacement + s.slice(end);
fs.writeFileSync(file, s, "utf8");
console.log("✅ Patched Leaderboard() successfully");
NODE

echo "✅ Done. Now run: npm run dev (or restart if already running)."
