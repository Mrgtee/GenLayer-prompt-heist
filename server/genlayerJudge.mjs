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

  let res;
try {
  res = await client.readContract({
    address: ADDR,
    functionName: "score_guess",
    args: [String(guess ?? ""), String(secret ?? "")],
  });
} catch (e) {
  console.error("readContract failed:", e?.message || String(e));
  // viem/genlayer-js sometimes nests useful detail:
  console.error("readContract detail:", e?.cause?.message || e?.details || "");
  throw e;
}

  // Helper to read from Map or object/tuple shapes
  const get = (k, i) => {
    if (res instanceof Map) {
      if (res.has(k)) return res.get(k);
      // some SDKs might use numeric keys as strings
      if (res.has(String(i))) return res.get(String(i));
      return undefined;
    }
    return res?.[k] ?? res?.[i] ?? res?.result?.[k] ?? res?.result?.[i];
  };

  const rawScore = get("score", 0) ?? 0;
  const rawReasoning = get("reasoning", 1) ?? "";
  const rawXpDelta = get("xpDelta", 2) ?? rawScore ?? 0;

  const scoreNum = typeof rawScore === "bigint" ? Number(rawScore) : Number(rawScore);
  const xpNum = typeof rawXpDelta === "bigint" ? Number(rawXpDelta) : Number(rawXpDelta);
  const reasoning = String(rawReasoning ?? "").trim();

  const guessStr = String(guess ?? "").trim();
  const secretStr = String(secret ?? "").trim();

  // If we have inputs but the judge response is empty/unusable, force fallback
  if (guessStr && secretStr && (!Number.isFinite(scoreNum) || (scoreNum === 0 && !reasoning))) {
    throw new Error("GenLayer judge returned empty result (0 score, no reasoning)");
  }

  return {
    score: Number.isFinite(scoreNum) ? scoreNum : 0,
    reasoning,
    xpDelta: Number.isFinite(xpNum) ? xpNum : 0,
  };
}
