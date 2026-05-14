import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const RPC = process.env.GENLAYER_RPC || "https://studio.genlayer.com/api";
const ADDR = process.env.GENLAYER_JUDGE_ADDRESS;
const CALLER =
  process.env.GENLAYER_CALLER ||
  "0x0000000000000000000000000000000000000000";

if (!ADDR) {
  console.warn("GENLAYER_JUDGE_ADDRESS is not set; judging calls will fail until configured.");
}

const client = createClient({
  chain: studionet,
  endpoint: RPC,
  account: CALLER,
});

function parseMaybeJson(value) {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text) return value;

  const candidates = [text];
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end >= start) candidates.push(text.slice(start, end + 1));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next shape
    }
  }
  return value;
}

function readField(res, key, index) {
  const parsed = parseMaybeJson(res);

  if (parsed instanceof Map) {
    if (parsed.has(key)) return parseMaybeJson(parsed.get(key));
    if (parsed.has(String(index))) return parseMaybeJson(parsed.get(String(index)));
    if (parsed.has(index)) return parseMaybeJson(parsed.get(index));
    return undefined;
  }

  if (Array.isArray(parsed)) return parseMaybeJson(parsed[index]);
  if (parsed && typeof parsed === "object") {
    return parseMaybeJson(
      parsed[key] ??
      parsed[index] ??
      parsed.result?.[key] ??
      parsed.result?.[index]
    );
  }

  return undefined;
}

function numberField(res, key, index, fallback = 0) {
  const raw = readField(res, key, index);
  const value = typeof raw === "bigint" ? Number(raw) : Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function stringField(res, key, index, fallback = "") {
  const raw = readField(res, key, index);
  return String(raw ?? fallback).trim();
}

function normalizeScoreResult(res) {
  const score = numberField(res, "score", 0, 0);
  const reasoning = stringField(res, "reasoning", 1, "");
  const xpDelta = numberField(res, "xpDelta", 2, score);

  if (!Number.isFinite(score) || !reasoning) {
    throw new Error("GenLayer judge returned an invalid score result");
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    reasoning,
    xpDelta: Math.max(0, Math.round(xpDelta)),
  };
}

function normalizeReviewResult(res, originalScore = 0) {
  const action = stringField(res, "action", 2, "uphold").toLowerCase();
  const score = numberField(res, "score", 0, originalScore);
  const reasoning = stringField(res, "reasoning", 1, "");

  if (!reasoning) {
    throw new Error("GenLayer judge returned an invalid review result");
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    reasoning,
    action: action === "adjust" ? "adjust" : "uphold",
  };
}

async function callJudge(functionName, args) {
  if (!ADDR) throw new Error("GENLAYER_JUDGE_ADDRESS is required");

  try {
    return await client.simulateWriteContract({
      address: ADDR,
      functionName,
      args,
      transactionHashVariant: "latest-nonfinal",
    });
  } catch (e) {
    console.error(`${functionName} failed:`, e?.message || String(e));
    console.error(`${functionName} detail:`, e?.cause?.message || e?.details || "");
    throw e;
  }
}

export async function judgeGuess({ guess, secret }) {
  const res = await callJudge("score_guess", [
    String(guess ?? ""),
    String(secret ?? ""),
  ]);
  return normalizeScoreResult(res);
}

export async function reviewVerdict({
  guess,
  secret,
  originalScore,
  originalReasoning,
  challengeReason,
}) {
  const res = await callJudge("review_verdict", [
    String(guess ?? ""),
    String(secret ?? ""),
    Math.max(0, Math.min(100, Math.round(Number(originalScore) || 0))),
    String(originalReasoning ?? ""),
    String(challengeReason ?? ""),
  ]);
  return normalizeReviewResult(res, originalScore);
}
