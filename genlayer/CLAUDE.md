# CLAUDE.md

Guidance for coding agents working in the Prompt Heist GenLayer project.

## Quick Commands

```bash
npm run deploy          # Deploy Prompt Heist judge via GenLayer CLI
genlayer network        # Select studionet, localnet, or testnet
```

## Architecture

```text
contracts/              # Python intelligent contracts
deploy/                 # TypeScript deployment script
```

The active intelligent contract is `contracts/prompt_heist_judge.py`.

## Contract Behavior

Prompt Heist uses GenLayer for subjective LLM judgment:

- `score_guess(guess, secret)` scores semantic similarity from 0 to 100 and returns an XP delta.
- `review_verdict(...)` re-reviews a challenged score and returns whether the original score should be adjusted.
- LLM calls must remain inside `gl.eq_principle.prompt_non_comparative(...)`.
- Do not reintroduce deterministic keyword checks or local scoring shortcuts in the contract.

## Deployment Workflow

1. Ensure GenLayer Studio or the selected network is available.
2. Select the target network with `genlayer network`.
3. Deploy with `npm run deploy`.
4. Copy the deployed address into the backend as `GENLAYER_JUDGE_ADDRESS`.

## GenLayer Technical Reference

When unsure, check the official references:

| Resource | URL |
|----------|-----|
| SDK API | https://sdk.genlayer.com/main/_static/ai/api.txt |
| Full Documentation | https://docs.genlayer.com/full-documentation.txt |
| Main Docs | https://docs.genlayer.com/ |
| GenLayerJS SDK | https://docs.genlayer.com/api-references/genlayer-js |

## LLM Access

```python
gl.nondet.exec_prompt(prompt: str) -> str
gl.nondet.exec_prompt(prompt: str, response_format="json") -> dict
```

## Equivalence Principle

Use `gl.eq_principle.prompt_non_comparative(...)` for subjective assessments that can be evaluated against explicit criteria.
