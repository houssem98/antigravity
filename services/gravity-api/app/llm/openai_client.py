"""
Gravity Search — OpenAI GPT Client
Supports GPT-5.2 (Thinking mode), GPT-4o, GPT-oss-20b.
"""

import time
from typing import AsyncIterator

import openai
import structlog

from app.config import settings
from app.llm.base import BaseLLMClient, LLMConfig, LLMMessage, LLMResponse, ModelProvider

logger = structlog.get_logger()

PRICING = {
    "gpt-5.2": {"input": 1.75, "output": 14.00},
    "gpt-5-mini": {"input": 0.25, "output": 2.00},
    "gpt-4o": {"input": 2.50, "output": 10.00},
    "gpt-oss-20b": {"input": 0.08, "output": 0.35},
}


class OpenAIClient(BaseLLMClient):
    provider = ModelProvider.OPENAI

    def __init__(self, model_id: str = "gpt-5.2"):
        self.model_id = model_id
        self.client = openai.AsyncOpenAI(api_key=settings.openai_api_key)

    async def generate(
        self,
        messages: list[LLMMessage],
        config: LLMConfig | None = None,
    ) -> LLMResponse:
        config = config or LLMConfig()
        api_messages = [{"role": m.role, "content": m.content} for m in messages]

        kwargs = {
            "model": self.model_id,
            "messages": api_messages,
            "max_completion_tokens": config.max_tokens,
            "temperature": config.temperature,
            "top_p": config.top_p,
        }
        if config.json_mode:
            kwargs["response_format"] = {"type": "json_object"}

        start = time.perf_counter()
        response = await self.client.chat.completions.create(**kwargs)
        latency_ms = (time.perf_counter() - start) * 1000

        choice = response.choices[0]
        content = choice.message.content or ""
        usage = response.usage
        input_tokens = usage.prompt_tokens if usage else 0
        output_tokens = usage.completion_tokens if usage else 0

        logger.info(
            "openai_generate",
            model=self.model_id,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            latency_ms=round(latency_ms, 1),
        )

        return LLMResponse(
            content=content,
            model=self.model_id,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            latency_ms=latency_ms,
            cost_usd=self._estimate_cost(input_tokens, output_tokens),
        )

    async def generate_stream(
        self,
        messages: list[LLMMessage],
        config: LLMConfig | None = None,
    ) -> AsyncIterator[str]:
        config = config or LLMConfig()
        api_messages = [{"role": m.role, "content": m.content} for m in messages]

        stream = await self.client.chat.completions.create(
            model=self.model_id,
            messages=api_messages,
            max_completion_tokens=config.max_tokens,
            temperature=config.temperature,
            stream=True,
        )

        async for chunk in stream:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content

    def _estimate_cost(self, input_tokens: int, output_tokens: int) -> float:
        prices = PRICING.get(self.model_id, {"input": 1.75, "output": 14.00})
        return (input_tokens * prices["input"] + output_tokens * prices["output"]) / 1_000_000
