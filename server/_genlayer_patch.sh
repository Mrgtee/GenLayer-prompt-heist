#!/usr/bin/env bash
set -euo pipefail

ROOT="$HOME/dev/prompt-heist"
SERVER="$ROOT/server"

cd "$SERVER"
echo "==> Working in: $SERVER"

# -------------------------
# Backups
# -------------------------
ts="$(date +%Y%m%d_%H%M%S)"
for f in index.js genlayerJudge.mjs .env; do
  if [ -f "$f" ]; then
    cp -a "$f" "$f.bak.$ts"
    echo "✅ backup: $f -> $f.bak.$ts"
  fi
done

# -------------------------
# Step 3: write minimal .env
# -------------------------
cat > .env <<EOF
PORT=3001

# GenLayer Studio Network (studionet)
GENLAYER_NETWORK=studionet
GENLAYER_RPC=https://studio.genlayer.com/api

# Prompt Heist Judge contract (FINAL – agreed)
GENLAYER_JUDGE_ADDRESS=0xEFE91eCB598ada8f7fc08E6735606073BBb4D59a

# Local GenLayer project directory (must contain package.json)
GENLAYER_PROJECT_DIR=$ROOT/genlayer
EOF

echo "✅ wrote server/.env"

# -------------------------
# Step 2: patch server/index.js to load .env reliably (ESM-safe)
# -------------------------
node <<'NODE'
import fs from "fs";

const file = "index.js";
if (!fs.existsSync(file)) {
  console.error("❌ server/index.js not found in current directory");
  process.exit(1);
}

let s = fs.readFileSync(file, "utf8");

const hasDotenvImport = /import\s+dotenv\s+from\s+["']dotenv["']\s*;?/.test(s);
const hasDotenvConfig = /dotenv\.config\(\{\s*path:\s*new\s+URL\(\s*["']\.\/\.env["']\s*,\s*import\.meta\.url\s*\)\s*\}\s*\)\s*;?/.test(s);

// Insert dotenv import after last top import
if (!hasDotenvImport) {
  const lines = s.split("\n");
  let lastImportIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*import\s+/.test(lines[i])) lastImportIdx = i;
    else if (lastImportIdx !== -1) break;
  }
  if (lastImportIdx === -1) {
    lines.unshift(`import dotenv from "dotenv";`);
  } else {
    lines.splice(lastImportIdx + 1, 0, `import dotenv from "dotenv";`);
  }
  s = lines.join("\n");
}

if (!hasDotenvConfig) {
  const lines = s.split("\n");
  const dotenvIdx = lines.findIndex((l) => /import\s+dotenv\s+from\s+["']dotenv["']/.test(l));
  const configLine = `dotenv.config({ path: new URL("./.env", import.meta.url) });`;

  if (dotenvIdx === -1) {
    lines.unshift(`import dotenv from "dotenv";`);
    lines.splice(1, 0, configLine);
  } else {
    // Put config right after dotenv import
    const alreadyNear = lines.slice(dotenvIdx, dotenvIdx + 6).some((l) => l.includes('dotenv.config({ path: new URL("./.env", import.meta.url) })'));
    if (!alreadyNear) lines.splice(dotenvIdx + 1, 0, configLine);
  }

  s = lines.join("\n");
}

fs.writeFileSync(file, s);
console.log("✅ patched server/index.js to load .env (dotenv)");
NODE

# -------------------------
# Step 4: overwrite server/genlayerJudge.mjs (npx-based caller)
# -------------------------
cat > genlayerJudge.mjs <<'EOF'
import { execFile } from "node:child_process";
import dotenv from "dotenv";

dotenv.config({ path: new URL("./.env", import.meta.url) });

const RPC = process.env.GENLAYER_RPC;
const ADDR = process.env.GENLAYER_JUDGE_ADDRESS;
const CWD = process.env.GENLAYER_PROJECT_DIR;

if (!RPC || !ADDR || !CWD) {
  throw new Error("Missing GENLAYER_RPC / GENLAYER_JUDGE_ADDRESS / GENLAYER_PROJECT_DIR in server/.env");
}

function execFileP(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { ...opts }, (err, stdout, stderr) => {
      if (err) {
        const msg = (stderr || stdout || err.message || "").toString();
        return reject(new Error(msg));
      }
      resolve({ stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}

// Extract the last JSON object printed by the CLI.
function parseJsonLoose(txt) {
  const s = (txt || "").trim();
  const start = s.lastIndexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON found in genlayer output:\n" + s);
  }
  return JSON.parse(s.slice(start, end + 1));
}

export async function judgeGuess({ guess, secret }) {
  const cliArgs = [
    "-y",
    "genlayer@0.33.0",
    "call",
    "--rpc",
    RPC,
    ADDR,
    "score_guess",
    "--args",
    String(guess ?? ""),
    String(secret ?? ""),
  ];

  const { stdout, stderr } = await execFileP("npx", cliArgs, {
    cwd: CWD,
    timeout: 90_000,
  });

  const out = (stdout + "\n" + stderr).trim();
  const j = parseJsonLoose(out);

  const score = Number(j.score ?? 0);
  const reasoning = String(j.reasoning ?? "");
  const xpDelta = Number(j.xpDelta ?? score ?? 0);

  return {
    score: Number.isFinite(score) ? score : 0,
    reasoning,
    xpDelta: Number.isFinite(xpDelta) ? xpDelta : 0,
  };
}
EOF

echo "✅ wrote server/genlayerJudge.mjs"

# -------------------------
# Sanity checks
# -------------------------
echo ""
echo "==> ENV sanity check:"
node - <<'NODE'
import dotenv from "dotenv";
dotenv.config({ path: "./.env" });
console.log({
  GENLAYER_RPC: process.env.GENLAYER_RPC,
  GENLAYER_JUDGE_ADDRESS: process.env.GENLAYER_JUDGE_ADDRESS,
  GENLAYER_PROJECT_DIR: process.env.GENLAYER_PROJECT_DIR,
});
NODE

echo ""
echo "==> Quick judge test:"
node - <<'NODE'
import { judgeGuess } from "./genlayerJudge.mjs";
const res = await judgeGuess({ guess: "a", secret: "b" });
console.log(res);
NODE

echo ""
echo "✅ Done. If the judge test worked, next step is wiring MatchEngine to call judgeGuess()."
