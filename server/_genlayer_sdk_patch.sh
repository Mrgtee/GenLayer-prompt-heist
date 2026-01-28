#!/usr/bin/env bash
set -euo pipefail

SERVER="$(pwd)"
ts="$(date +%Y%m%d_%H%M%S)"

echo "==> Working in: $SERVER"

# -------------------------
# Backups
# -------------------------
for f in index.js genlayerJudge.mjs .env package.json package-lock.json; do
  if [ -f "$f" ]; then
    cp -a "$f" "$f.bak.$ts"
    echo "✅ backup: $f -> $f.bak.$ts"
  fi
done

# -------------------------
# Step 2: install deps (SDK path, no CLI)
# -------------------------
npm i genlayer-js dotenv

# -------------------------
# Step 3: ensure index.js loads .env early
# - If your index.js already loads dotenv, we leave it.
# - Otherwise, we insert:
#   import dotenv from "dotenv";
#   dotenv.config({ path: new URL("./.env", import.meta.url).pathname });
# -------------------------
node <<'NODE'
import fs from "fs";

const file = "index.js";
let s = fs.readFileSync(file, "utf8");

const hasDotenvImport =
  s.includes('import dotenv from "dotenv"') || s.includes("import dotenv from 'dotenv'");
const hasDotenvConfig =
  s.includes("dotenv.config(") || s.includes("dotenv.config({");

if (!hasDotenvImport) {
  // insert after first import line (or at top)
  const lines = s.split("\n");
  let insertAt = 0;
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    if (lines[i].startsWith("import ")) insertAt = i + 1;
  }
  lines.splice(insertAt, 0, 'import dotenv from "dotenv";');
  s = lines.join("\n");
}

if (!hasDotenvConfig) {
  // place config right after dotenv import
  const re = /import dotenv from ["']dotenv["'];\s*/;
  s = s.replace(
    re,
    (m) =>
      m +
      'dotenv.config({ path: new URL("./.env", import.meta.url).pathname });\n'
  );
}

fs.writeFileSync(file, s);
console.log("✅ patched index.js to load .env via dotenv (if it was missing)");
NODE

# -------------------------
# Step 4: rewrite genlayerJudge.mjs to use genlayer-js (SDK)
# -------------------------
cat > genlayerJudge.mjs <<'EOF'
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

// Reads from .env (loaded by index.js when running the server)
// For ad-hoc tests, use: node -e "import('dotenv/config'); ..."
const RPC = process.env.GENLAYER_RPC || "https://studio.genlayer.com/api";
const ADDR =
  process.env.GENLAYER_JUDGE_ADDRESS ||
  "0xEFE91eCB598ada8f7fc08E6735606073BBb4D59a";

// read-only calls still need an "account" field in the SDK client.
// This is NOT a private key. Any valid address string is fine for reads.
const CALLER =
  process.env.GENLAYER_CALLER ||
  "0x0000000000000000000000000000000000000000";

const client = createClient({
  chain: studionet,
  endpoint: RPC,
  account: CALLER,
});

// Some setups want this initialized before interactions.
// Safe to call once; if not needed, it still won’t break anything.
let initPromise = null;
async function ensureInit() {
  if (!initPromise) initPromise = client.initializeConsensusSmartContract();
  return initPromise;
}

export async function judgeGuess({ guess, secret }) {
  await ensureInit();

  const res = await client.readContract({
    address: ADDR,
    functionName: "score_guess",
    args: [String(guess ?? ""), String(secret ?? "")],
  });

  // res is expected to be an object like: { score, reasoning, xpDelta }
  const score = Number(res?.score ?? 0);
  const reasoning = String(res?.reasoning ?? "");
  const xpDelta = Number(res?.xpDelta ?? score ?? 0);

  return {
    score: Number.isFinite(score) ? score : 0,
    reasoning,
    xpDelta: Number.isFinite(xpDelta) ? xpDelta : 0,
  };
}
EOF

echo ""
echo "==> ENV sanity check:"
node -e "import('dotenv/config'); console.log({GENLAYER_RPC:process.env.GENLAYER_RPC, GENLAYER_JUDGE_ADDRESS:process.env.GENLAYER_JUDGE_ADDRESS});"

echo ""
echo "==> Quick SDK judge test (should print score/reasoning/xpDelta):"
node -e "import('dotenv/config'); import('./genlayerJudge.mjs').then(m=>m.judgeGuess({guess:'a',secret:'b'})).then(console.log).catch(e=>{console.error('ERROR:', e.message); process.exit(1);})"

echo ""
echo "✅ Done."
echo "Next: restart your server:"
echo "  node index.js"
