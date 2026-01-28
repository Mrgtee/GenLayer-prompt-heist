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

// 1) Ensure SubmitPanel has submitted state + handler (idempotent-ish)
if (!s.includes("const [submitted, setSubmitted] = useState(false);")) {
  // Insert submitted state right after `const [text, setText] = useState("");`
  s = s.replace(
    /function SubmitPanel\(\{ onSubmit \}\)\s*\{\s*\n\s*const \[text, setText\] = useState\(""\);\s*\n/,
    (m) => m + `  const [submitted, setSubmitted] = useState(false);\n`
  );
}

// 2) Add a doSubmit wrapper if not present
if (!s.includes("function doSubmit()")) {
  s = s.replace(
    /function SubmitPanel\(\{ onSubmit \}\)\s*\{\s*([\s\S]*?)\n\s*return\s*\(/,
    (match, body) => {
      // put doSubmit before return
      return match.replace(
        "\n    return (",
        `\n  function doSubmit() {\n    if (submitted) return;\n    const t = (text || "").trim();\n    if (!t) return;\n    setSubmitted(true);\n    onSubmit(t);\n  }\n\n  return (`
      );
    }
  );
}

// 3) Ensure textarea disables after submit
s = s.replace(
  /<textarea([\s\S]*?)\s+placeholder="e\.g\. pixel art cat astronaut, neon city, playful vibe\.\.\."\s*\/>/,
  (m) => {
    if (m.includes("disabled={submitted}")) return m;
    return m.replace(/rows=\{3\}\s*\n/, (x) => x + `        disabled={submitted}\n`);
  }
);

// 4) Replace the button line to use doSubmit + labels
// Find the button in SubmitPanel
const btnRe = /<Button\s+onClick=\{\(\)\s*=>\s*onSubmit\(text\)\}\s+variant=\{text\.trim\(\)\s*\?\s*"primary"\s*:\s*"disabled"\}\s+disabled=\{!text\.trim\(\)\}\>\s*([\s\S]*?)\s*<\/Button>/m;

if (btnRe.test(s)) {
  s = s.replace(
    btnRe,
    `<Button
          onClick={doSubmit}
          variant={!submitted && text.trim() ? "primary" : "disabled"}
          disabled={submitted || !text.trim()}
        >
          {submitted ? "Submitted ✓" : "Submit guess"}
        </Button>`
  );
} else {
  // If button already partially patched, just force label + disable logic by direct string replace
  s = s.replace(/Submit Theory/g, "Submit guess");
}

// 5) Ensure SubmitPanel is keyed by roundId (so it resets each round)
// This is safe to apply even if already done
s = s.replace(
  /\{phase === "submit" && <SubmitPanel onSubmit=\{onSubmit\} \/>}/g,
  `{phase === "submit" && <SubmitPanel key={roundId} onSubmit={onSubmit} />}`
);

fs.writeFileSync(file, s);
console.log("✅ Submit button updated: Submit guess -> Submitted ✓ (prevents double submits).");
NODE

echo "✅ Done. Now run:"
echo "  npm run dev"
