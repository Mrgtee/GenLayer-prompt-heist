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

function die(msg) {
  console.error("❌", msg);
  process.exit(1);
}

// Locate SubmitPanel block
const start = s.indexOf("function SubmitPanel({ onSubmit })");
if (start === -1) die("Could not find: function SubmitPanel({ onSubmit })");

const afterStart = s.slice(start);
const endRel = afterStart.indexOf("function Leaderboard");
if (endRel === -1) die("Could not find end of SubmitPanel (next function Leaderboard)");

const submitPanelBlock = afterStart.slice(0, endRel);
const rest = afterStart.slice(endRel);

// If doSubmit is missing, inject it after state declarations.
let fixed = submitPanelBlock;

// Ensure submitted state exists
if (!fixed.includes("const [submitted, setSubmitted]")) {
  fixed = fixed.replace(
    /const \[text, setText\] = useState\(""\);\s*\n/,
    (m) => m + `  const [submitted, setSubmitted] = useState(false);\n`
  );
}

// Ensure doSubmit exists inside SubmitPanel (not outside)
if (!fixed.includes("function doSubmit()") && !fixed.includes("const doSubmit")) {
  // Insert doSubmit right after max const (or after submitted state if max isn't present yet)
  if (fixed.includes("const max = 240;")) {
    fixed = fixed.replace(
      /const max = 240;\s*\n/,
      (m) =>
        m +
        `\n  function doSubmit() {\n` +
        `    if (submitted) return;\n` +
        `    const t = (text || "").trim();\n` +
        `    if (!t) return;\n` +
        `    setSubmitted(true);\n` +
        `    onSubmit(t);\n` +
        `  }\n\n`
    );
  } else {
    // fallback insert before return (
    fixed = fixed.replace(
      /\n\s*return\s*\(/,
      `\n\n  function doSubmit() {\n` +
        `    if (submitted) return;\n` +
        `    const t = (text || "").trim();\n` +
        `    if (!t) return;\n` +
        `    setSubmitted(true);\n` +
        `    onSubmit(t);\n` +
        `  }\n\n  return (`
    );
  }
}

// Make textarea disabled after submit
fixed = fixed.replace(
  /<textarea\s*\n([\s\S]*?)\n\s*\/>/m,
  (m) => {
    if (m.includes("disabled={submitted}")) return m;
    return m.replace(/rows=\{3\}\s*\n/, (x) => x + `        disabled={submitted}\n`);
  }
);

// Replace the submit button chunk in SubmitPanel with safe version.
// We’ll match the existing Button that calls onSubmit(...) OR doSubmit(...) and replace it.
fixed = fixed.replace(
  /<Button[\s\S]*?>[\s\S]*?<\/Button>/m,
  (m) => {
    // Only replace the button that is inside SubmitPanel footer.
    // We'll detect it by presence of "Submit" text or onSubmit/text usage.
    const looksLikeSubmit =
      m.includes("Submit") || m.includes("onSubmit") || m.includes("text.trim") || m.includes("doSubmit");
    if (!looksLikeSubmit) return m;

    return `<Button
          onClick={doSubmit}
          variant={!submitted && text.trim() ? "primary" : "disabled"}
          disabled={submitted || !text.trim()}
        >
          {submitted ? "Submitted ✓" : "Submit guess"}
        </Button>`;
  }
);

// Ensure submit panel is keyed by roundId (reset each round)
s = s.replace(
  /\{phase === "submit" && <SubmitPanel[^>]*onSubmit=\{onSubmit\}[^>]*\/>\}/g,
  `{phase === "submit" && <SubmitPanel key={roundId} onSubmit={onSubmit} />}`
);

// Rebuild file
const newS = s.slice(0, start) + fixed + rest;
fs.writeFileSync(file, newS);

console.log("✅ Fixed SubmitPanel: ensured doSubmit exists + Submit guess / Submitted ✓ behavior.");
NODE

echo "✅ Done. Restart Vite:"
echo "  npm run dev"
