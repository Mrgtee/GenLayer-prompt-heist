import "dotenv/config";
import { judgeGuess, reviewVerdict } from "../genlayerJudge.mjs";

const secret =
  "cinematic digital painting of a neon koi detective in a rainy cyberpunk alley, reflective pavement, magenta signs, moody rim lighting, wide angle";

const cases = [
  {
    label: "Exact-ish",
    guess:
      "cinematic neon koi detective in a rainy cyberpunk alley with reflective pavement and moody magenta lighting",
  },
  {
    label: "Close paraphrase",
    guess:
      "a detective fish in a wet futuristic alley, neon signs, dramatic digital art lighting",
  },
  {
    label: "Weak",
    guess: "a happy dog in a sunny park",
  },
];

for (const item of cases) {
  console.log(`\n${item.label}:`);
  console.log(await judgeGuess({ guess: item.guess, secret }));
}

console.log("\nReview:");
console.log(
  await reviewVerdict({
    guess: "neon fish detective in a rainy cyberpunk alley",
    secret,
    originalScore: 55,
    originalReasoning: "The guess matched only some details.",
    challengeReason: "The room believes the judge missed the subject and mood.",
  })
);
