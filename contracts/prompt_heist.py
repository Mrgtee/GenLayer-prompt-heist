# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import gl
import json


class Contract(gl.Contract):
    def __init__(self):
        pass

    @gl.public.write
    def score_guess(self, guess: str, secret: str) -> str:
        clean_guess = str(guess or "").strip()
        clean_secret = str(secret or "").strip()

        if not clean_guess or not clean_secret:
            return json.dumps(
                {"score": 0, "reasoning": "Empty guess or target prompt.", "xpDelta": 0},
                sort_keys=True,
            )

        task = """
You are the Prompt Heist judge.

Use the supplied secret prompt and player guess to score how semantically close
the guess is to the secret prompt for an image generation prompt.

Return valid JSON only with exactly these keys:
- score
- reasoning
- xpDelta
"""

        criteria = """
score must be an integer from 0 to 100.
xpDelta must be an integer from 0 to 100 and should usually match score.
reasoning must be one concise sentence and must not reveal the full secret prompt.
Judge semantic similarity across subject, style, setting, mood, lighting,
composition, and important details.
Do not rely on exact word overlap.
Paraphrases and synonyms can be strong matches.
Penalize keyword spam, contradictions, generic guesses, and invented core details.
The output must be valid JSON only.
"""

        def score_with_llm() -> str:
            prompt = f"""
You are the Prompt Heist judge. A player is trying to reverse-engineer the
hidden image-generation prompt from the final image.

Secret prompt:
{clean_secret}

Player guess:
{clean_guess}

Return only JSON with exactly these keys:
- score: integer from 0 to 100
- reasoning: one concise sentence explaining the score without revealing the full secret prompt
- xpDelta: integer from 0 to 100, usually matching score

Score semantic similarity, not exact token matching. Reward correct subject,
visual style, setting, composition, lighting, mood, and important details.
Penalize keyword spam, generic guesses, contradictions, and invented core
details. A strong paraphrase can score highly even if wording differs.
"""
            result = gl.nondet.exec_prompt(prompt, response_format="json")
            if isinstance(result, str):
                return result
            return json.dumps(result, sort_keys=True)

        return gl.eq_principle.prompt_non_comparative(
            score_with_llm,
            task=task,
            criteria=criteria,
        )

    @gl.public.write
    def review_verdict(
        self,
        guess: str,
        secret: str,
        original_score: int,
        original_reasoning: str,
        challenge_reason: str,
    ) -> str:
        clean_guess = str(guess or "").strip()
        clean_secret = str(secret or "").strip()
        clean_reason = str(challenge_reason or "The room believes the score was too harsh.").strip()
        try:
            prior_score = int(original_score)
        except Exception:
            prior_score = 0
        if prior_score < 0:
            prior_score = 0
        if prior_score > 100:
            prior_score = 100
        prior_reasoning = str(original_reasoning or "").strip()

        if not clean_guess or not clean_secret:
            return json.dumps(
                {
                    "score": prior_score,
                    "reasoning": prior_reasoning or "The original verdict is upheld because inputs were incomplete.",
                    "action": "uphold",
                },
                sort_keys=True,
            )

        task = """
You are reviewing a challenged Prompt Heist verdict.

Use the supplied secret prompt, player guess, original score, original
reasoning, and challenge reason to decide whether the original verdict should
be upheld or adjusted.

Return valid JSON only with exactly these keys:
- action
- score
- reasoning
"""

        criteria = """
action must be either uphold or adjust.
score must be an integer from 0 to 100.
reasoning must be one concise sentence and must not reveal the full secret prompt.
Adjust only when the original score clearly missed semantic similarity or
unfairly ignored subject, style, setting, mood, composition, lighting, or
important details.
Do not reward vague keyword lists or contradictory guesses.
The output must be valid JSON only.
"""

        def review_with_llm() -> str:
            prompt = f"""
You are reviewing a challenged Prompt Heist verdict.

Secret prompt:
{clean_secret}

Player guess:
{clean_guess}

Original score: {prior_score}
Original reasoning: {prior_reasoning}
Challenge reason: {clean_reason}

Return only JSON with exactly these keys:
- action: "uphold" or "adjust"
- score: integer from 0 to 100
- reasoning: one concise sentence explaining the review without revealing the full secret prompt

Adjust only when the original verdict is materially unfair under the game
criteria. Otherwise uphold it.
"""
            result = gl.nondet.exec_prompt(prompt, response_format="json")
            if isinstance(result, str):
                return result
            return json.dumps(result, sort_keys=True)

        return gl.eq_principle.prompt_non_comparative(
            review_with_llm,
            task=task,
            criteria=criteria,
        )
