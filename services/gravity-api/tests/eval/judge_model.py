"""
Anthropic-backed judge model for deepeval metrics.

Usage:
    from tests.eval.judge_model import AnthropicJudge
    metric = AnswerRelevancyMetric(threshold=0.7, model=AnthropicJudge())
"""

import os
from typing import Optional
from deepeval.models.base_model import DeepEvalBaseLLM


class AnthropicJudge(DeepEvalBaseLLM):
    """Wraps claude-sonnet-4-6 as a deepeval judge LLM."""

    def __init__(self, model_id: str = "claude-sonnet-4-6", max_tokens: int = 4096):
        self.model_id = model_id
        self.max_tokens = max_tokens

    def load_model(self):
        import anthropic
        return anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    def generate(self, prompt: str, schema: Optional[type] = None) -> str:
        import anthropic
        client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
        response = client.messages.create(
            model=self.model_id,
            max_tokens=self.max_tokens,
            messages=[{"role": "user", "content": prompt}],
        )
        return response.content[0].text

    async def a_generate(self, prompt: str, schema: Optional[type] = None) -> str:
        import anthropic
        client = anthropic.AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
        response = await client.messages.create(
            model=self.model_id,
            max_tokens=self.max_tokens,
            messages=[{"role": "user", "content": prompt}],
        )
        return response.content[0].text

    def get_model_name(self) -> str:
        return f"anthropic/{self.model_id}"
