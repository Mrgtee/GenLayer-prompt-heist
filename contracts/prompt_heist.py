# { "Depends": "py-genlayer:test" }

import genlayer as gl

class Contract(gl.Contract):
    greeting: str

    def __init__(self):
        self.greeting = "Prompt Heist contract is live"

    @gl.public.view
    def hello(self) -> str:
        return self.greeting

    @gl.public.write
    def set_greeting(self, g: str):
        self.greeting = g
