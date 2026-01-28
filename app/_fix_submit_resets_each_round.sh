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

function assertHas(str, label) {
  if (!s.includes(str)) {
    console.error("❌ Missing snippet for:", label);
    console.error(str);
    process.exit(1);
  }
}

function replaceOnce(from, to, label) {
  assertHas(from, label);
  s = s.replace(from, to);
  console.log("✅", label);
}

/**
 * 1) Ensure SubmitPanel remounts every round (resets internal state)
 */
replaceOnce(
  `{phase === "submit" && <SubmitPanel onSubmit={onSubmit} />}`,
  `{phase === "submit" && <SubmitPanel key={roundId} onSubmit={onSubmit} />}`,
  "Key SubmitPanel by roundId"
);

/**
 * 2) Fix SubmitPanel implementation:
 *    - button text "Submit guess"
 *    - prevent double click
 *    - ensure we send the text BEFORE we set submitted=true or clear anything
 *
 * We patch only the button block inside SubmitPanel.
 */
const buttonBlockRe = /<Button\s+onClick=\{\(\)\s*=>\s*onSubmit\(text\)\}\s+variant=\{text\.trim\(\)\s*\?\s*"primary"\s*:\s*"disabled"\}\s+disabled=\{!text\.trim\(\)\}>\s*Submit\s+Theory\s*<\/Button>/m;

if (!buttonBlockRe.test(s)) {
  console.error("❌ Could not find the Submit button block to patch inside SubmitPanel.");
  console.error("Search for the existing: onSubmit(text) ... Submit Theory");
  process.exit(1);
}

s = s.replace(
  buttonBlockRe,
  `<Button
          onClick={() => {
            const payload = text.trim();
            if (!payload || submitted) return;
            setSubmitted(true);
            onSubmit(payload);
          }}
          variant={submitted ? "disabled" : text.trim() ? "primary" : "disabled"}
          disabled={submitted || !text.trim()}
        >
          {submitted ? "Submitted" : "Submit guess"}
        </Button>`
);

console.log("✅ Submit button: label + submitted state + prevents double-click");

/**
 * 3) Ensure SubmitPanel has submitted state declared.
 * If your previous patch already added it, we leave it alone.
 * If not present, we inject it right after `const [text, setText] = useState("");`
 */
if (!s.includes("const [submitted, setSubmitted] = useState(false);")) {
  const anchor = `const [text, setText] = useState("");`;
  const idx = s.indexOf(anchor);
  if (idx === -1) {
    console.error("❌ Could not find SubmitPanel text state anchor to inject submitted state.");
    process.exit(1);
  }
  s =
    s.slice(0, idx + anchor.length) +
    `\n  const [submitted, setSubmitted] = useState(false);` +
    s.slice(idx + anchor.length);
  console.log("✅ Injected submitted state into SubmitPanel");
} else {
  console.log("ℹ️ SubmitPanel already has submitted state");
}

fs.writeFileSync(file, s);
console.log("✅ wrote", file);
NODE

echo "✅ Done. Now restart Vite."
