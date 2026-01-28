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

/* ---------------------------------------------
   1) Key SubmitPanel by roundId (reset per round)
---------------------------------------------- */
{
  const re = /\{phase\s*===\s*"submit"\s*&&\s*<SubmitPanel([^>]*)\/>\s*\}/m;

  const m = s.match(re);
  if (!m) {
    // If you already keyed it, or the JSX is slightly different,
    // try a more permissive match:
    const re2 = /\{phase\s*===\s*"submit"\s*&&\s*<SubmitPanel([\s\S]*?)\/>\s*\}/m;
    const m2 = s.match(re2);
    if (!m2) die('Could not find the "{phase === \\"submit\\" && <SubmitPanel .../>}" line in GameCard.');
    const attrs = m2[1];
    if (/\bkey\s*=/.test(attrs)) {
      console.log("ℹ️ SubmitPanel already has a key prop (ok).");
    } else {
      s = s.replace(re2, (full, attrs2) => `{phase === "submit" && <SubmitPanel key={roundId}${attrs2} />}`);
      console.log("✅ Keyed SubmitPanel by roundId (permissive match).");
    }
  } else {
    const attrs = m[1];
    if (/\bkey\s*=/.test(attrs)) {
      console.log("ℹ️ SubmitPanel already has a key prop (ok).");
    } else {
      s = s.replace(re, `{phase === "submit" && <SubmitPanel key={roundId}$1 />}`);
      console.log("✅ Keyed SubmitPanel by roundId.");
    }
  }
}

/* ---------------------------------------------------
   2) Patch SubmitPanel to prevent multiple submits
      - Button: "Submit guess" -> "Submitted"
      - Disable after submit
      - Avoid undefined doSubmit
---------------------------------------------------- */
{
  const start = s.indexOf("function SubmitPanel");
  if (start === -1) die("Could not find function SubmitPanel in App.jsx");

  // find end of SubmitPanel by next "function " after it
  const nextFn = s.indexOf("\nfunction ", start + 1);
  const end = nextFn === -1 ? s.length : nextFn;

  const head = s.slice(0, start);
  let block = s.slice(start, end);
  const tail = s.slice(end);

  // Ensure submitted state exists
  if (!block.includes("const [submitted, setSubmitted]")) {
    const anchor = `const [text, setText] = useState("");`;
    const idx = block.indexOf(anchor);
    if (idx === -1) die("SubmitPanel: could not find text state line to inject submitted state.");
    block =
      block.slice(0, idx + anchor.length) +
      `\n  const [submitted, setSubmitted] = useState(false);` +
      block.slice(idx + anchor.length);
    console.log("✅ Added submitted state to SubmitPanel.");
  } else {
    console.log("ℹ️ SubmitPanel already has submitted state.");
  }

  // Replace the submit button container content (robust)
  const btnWrapRe =
    /<div className="mt-3 flex justify-end">[\s\S]*?<\/div>\s*<\/div>\s*\);\s*\}/m;

  if (!btnWrapRe.test(block)) {
    die('SubmitPanel: could not find the submit button wrapper (<div className="mt-3 flex justify-end"> ... ).');
  }

  block = block.replace(btnWrapRe, () => {
    return `<div className="mt-3 flex justify-end">
        <Button
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
        </Button>
      </div>
    </div>
  );
}`;
  });

  s = head + block + tail;
  console.log("✅ Patched SubmitPanel button UX (no double-click, label change).");
}

fs.writeFileSync(file, s);
console.log("✅ wrote", file);
NODE

echo "✅ Done. Restart Vite now."
