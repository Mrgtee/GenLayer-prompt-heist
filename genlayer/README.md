# Prompt Heist GenLayer Contract

This folder contains the GenLayer deployment project for Prompt Heist.

The active contract is `contracts/prompt_heist_judge.py`. It exposes:

- `score_guess(guess: str, secret: str)` returning `{ score, reasoning, xpDelta }`
- `review_verdict(guess, secret, original_score, original_reasoning, challenge_reason)` returning `{ score, reasoning, action }`

Both methods use `gl.nondet.exec_prompt(..., response_format="json")` wrapped by `gl.eq_principle.prompt_non_comparative(...)` so GenLayer produces and validates subjective LLM judgments against explicit criteria.

## Requirements

- GenLayer CLI
- Access to GenLayer Studio or a local GenLayer network

Install or update the CLI:

```bash
npm install -g genlayer
```

## Deploy

```bash
npm install
genlayer network
npm run deploy
```

The deploy script is `deploy/deployScript.ts` and points at `contracts/prompt_heist_judge.py`.

Latest deployed judge:

```text
0xcB2ddaD43A0D0F990c8bfEe714fa395591860e91
```

After any new deployment, set the backend `GENLAYER_JUDGE_ADDRESS` to the new contract address.

## Validate

Before resubmission, validate the contract with GenLayer tooling and call:

- `score_guess` with exact, close, weak, and empty guesses
- `review_verdict` with an original score/reasoning plus a player challenge reason

The old sample boilerplate and duplicate frontend have been removed from this project path.
