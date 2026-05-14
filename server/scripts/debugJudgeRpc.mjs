import "dotenv/config";
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const RPC = process.env.GENLAYER_RPC || "https://studio.genlayer.com/api";
const ADDR = process.env.GENLAYER_JUDGE_ADDRESS;
const CALLER =
  process.env.GENLAYER_CALLER ||
  "0x0000000000000000000000000000000000000000";

if (!ADDR) {
  throw new Error("GENLAYER_JUDGE_ADDRESS is required");
}

const functionName = process.argv[2] || "score_guess";
const args =
  functionName === "review_verdict"
    ? [
        "neon fish detective in a rainy cyberpunk alley",
        "cinematic digital painting of a neon koi detective in a rainy cyberpunk alley, reflective pavement, magenta signs, moody rim lighting, wide angle",
        55,
        "The guess matched only some details.",
        "The room believes the judge missed the subject and mood.",
      ]
    : [
        "cinematic neon koi detective in a rainy cyberpunk alley with reflective pavement and moody magenta lighting",
        "cinematic digital painting of a neon koi detective in a rainy cyberpunk alley, reflective pavement, magenta signs, moody rim lighting, wide angle",
      ];

const client = createClient({
  chain: studionet,
  endpoint: RPC,
  account: CALLER,
});

const response = await client.simulateWriteContract({
  address: ADDR,
  functionName,
  args,
  transactionHashVariant: "latest-nonfinal",
});

console.log(response);
