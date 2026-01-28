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

function mustReplace(regex, replacement, label) {
  const before = s;
  s = s.replace(regex, replacement);
  if (s === before) {
    console.error("❌ Patch failed:", label);
    process.exit(1);
  }
  console.log("✅", label);
}

/* ---------------------------
 * 1) Prevent multiple submits: reset per round with key
 * -------------------------- */
mustReplace(
  /\{phase === "submit"\s*&&\s*<SubmitPanel\s+onSubmit=\{onSubmit\}\s*\/>\s*\}/,
  `{phase === "submit" && <SubmitPanel key={roundId} onSubmit={onSubmit} />}`,
  "SubmitPanel keyed by roundId"
);

/* ---------------------------
 * 2) SubmitPanel: button label + submitted state (disable)
 * -------------------------- */
mustReplace(
  /function SubmitPanel\(\{ onSubmit \}\)\s*\{\s*\n\s*const \[text, setText\] = useState\(""\);\s*\n\s*const max = 240;/,
  `function SubmitPanel({ onSubmit }) {
  const [text, setText] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const max = 240;

  function doSubmit() {
    const t = text.trim();
    if (!t || submitted) return;
    setSubmitted(true);
    onSubmit(t);
  }`,
  "SubmitPanel submitted-state + doSubmit()"
);

mustReplace(
  /<Button onClick=\{\(\) => onSubmit\(text\)\} variant=\{text\.trim\(\) \? "primary" : "disabled"\} disabled=\{!text\.trim\(\)\}>\s*\n\s*Submit Theory\s*\n\s*<\/Button>/,
  `<Button
          onClick={doSubmit}
          variant={text.trim() && !submitted ? "primary" : "disabled"}
          disabled={!text.trim() || submitted}
        >
          {submitted ? "Submitted" : "Submit Guess"}
        </Button>`,
  "Submit button label + disable after submit"
);

/* ---------------------------
 * 3) Leaderboard: deliberating spinner + timeout hint
 * -------------------------- */
mustReplace(
  /function Leaderboard\(\{ match, roundId, members = \[\] \}\) \{\s*\n\s*const lb = match\.leaderboard\?\.\[roundId\] \|\| \[\];\s*\n\s*const byWallet = new Map\(\(members \|\| \[\]\)\.map\(\(m\) => \[\(m\.wallet \|\| ""\)\.toLowerCase\(\), m\.displayName \|\| ""\]\)\);\s*\n\s*const nameOf = \(w\) => byWallet\.get\(\(w \|\| ""\)\.toLowerCase\(\)\) \|\| "";/,
  `function Leaderboard({ match, roundId, members = [] }) {
  const lb = match.leaderboard?.[roundId] || [];
  const phase = match?.phase;

  // During verdict/challenge, judge may still be deliberating
  const showPending =
    (phase === "verdict" || phase === "challenge_window") && lb.length === 0;

  // Re-render while pending so timeout hint can appear
  const [, bump] = useState(0);
  useEffect(() => {
    if (!showPending) return;
    const t = setInterval(() => bump((x) => x + 1), 600);
    return () => clearInterval(t);
  }, [showPending]);

  const late =
    !!match?.phaseEndsAtMs && Date.now() > Number(match.phaseEndsAtMs) + 6000;

  if (phase === "completed") return null;

  const byWallet = new Map(
    (members || []).map((m) => [(m.wallet || "").toLowerCase(), m.displayName || ""])
  );
  const nameOf = (w) => byWallet.get((w || "").toLowerCase()) || "";`,
  "Leaderboard pending-state + timeout hint logic"
);

mustReplace(
  /\{lb\.length === 0 \? \(\s*\n\s*<div className="mt-2 text-sm text-white\/70">No scores yet\.<\/div>\s*\n\s*\) : \(/,
  `{showPending ? (
        <div className="mt-3 rounded-xl border border-white/10 bg-black/30 p-3">
          <div className="flex items-center gap-2 text-sm text-white/75">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border border-white/20 border-t-white/70" />
            <span>The judge is deliberating…</span>
          </div>
          <div className="mt-2 text-xs text-white/55">
            This usually resolves in a few seconds.
            {late ? (
              <span className="text-white/70"> If it keeps spinning, refresh once.</span>
            ) : null}
          </div>
        </div>
      ) : lb.length === 0 ? (
        <div className="mt-2 text-sm text-white/70">No scores yet.</div>
      ) : (`,
  "Leaderboard UI: spinner + timeout hint"
);

fs.writeFileSync(file, s);
console.log("✅ wrote", file);
NODE

echo "✅ Patch applied."
echo "Next:"
echo "  npm run dev"
