# { "Depends": "py-genlayer:test" }
from genlayer import gl

class PromptHeistJudge(gl.Contract):
    # No persistent state needed for MVP judge

    def __init__(self):
        # Required so schema loads cleanly in Studio
        pass

    @gl.public.view
    def score_guess(self, guess: str, secret: str):
        g = (guess or "").lower().strip()
        s = (secret or "").lower().strip()

        if not g or not s:
            return {"score": 0, "reasoning": "Empty input.", "xpDelta": 0}

        gt = set([t for t in "".join([c if c.isalnum() else " " for c in g]).split() if t])
        st = set([t for t in "".join([c if c.isalnum() else " " for c in s]).split() if t])

        inter = len(gt.intersection(st))
        union = max(1, len(gt.union(st)))
        jaccard = inter / union

        raw = int(max(0, min(100, round(jaccard * 100))))

        if raw >= 85:
            reasoning = "Strong match on subject and style."
        elif raw >= 70:
            reasoning = "Good alignment, missing a few key cues."
        elif raw >= 55:
            reasoning = "Some overlap, but differs in core details."
        elif raw >= 35:
            reasoning = "Partial overlap; main tone differs."
        else:
            reasoning = "Low similarity."

        return {"score": raw, "reasoning": reasoning, "xpDelta": raw}
