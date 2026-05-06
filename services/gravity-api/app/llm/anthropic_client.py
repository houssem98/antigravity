"""
Gravity Search — Anthropic Claude Client
Supports Claude Sonnet 4.5, Opus 4.6 with streaming & prompt caching.
"""

import time
from typing import AsyncIterator

import anthropic
import structlog

from app.config import settings
from app.llm.base import BaseLLMClient, LLMConfig, LLMMessage, LLMResponse, ModelProvider

logger = structlog.get_logger()

# Pricing per 1M tokens (Feb 2026)
PRICING = {
    "claude-haiku-4-5-20251001": {"input": 0.80,  "output": 4.00},
    "claude-sonnet-4-6":         {"input": 3.00,  "output": 15.00},
    "claude-opus-4-7":           {"input": 15.00, "output": 75.00},
}


class AnthropicClient(BaseLLMClient):
    provider = ModelProvider.ANTHROPIC

    def __init__(self, model_id: str = "claude-sonnet-4-6"):
        self.model_id = model_id
        self.client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)

    async def generate(
        self,
        messages: list[LLMMessage],
        config: LLMConfig | None = None,
    ) -> LLMResponse:
        config = config or LLMConfig()
        system_msg = ""
        api_messages = []

        for msg in messages:
            if msg.role == "system":
                system_msg = msg.content
            else:
                api_messages.append({"role": msg.role, "content": msg.content})

        start = time.perf_counter()
        response = await self.client.messages.create(
            model=self.model_id,
            system=system_msg,
            messages=api_messages,
            max_tokens=config.max_tokens,
            temperature=config.temperature,
            top_p=config.top_p,
            stop_sequences=config.stop_sequences or anthropic.NOT_GIVEN,
        )
        latency_ms = (time.perf_counter() - start) * 1000

        input_tokens = response.usage.input_tokens
        output_tokens = response.usage.output_tokens
        content = response.content[0].text if response.content else ""

        logger.info(
            "anthropic_generate",
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
        system_msg = ""
        api_messages = []

        for msg in messages:
            if msg.role == "system":
                system_msg = msg.content
            else:
                api_messages.append({"role": msg.role, "content": msg.content})

        async with self.client.messages.stream(
            model=self.model_id,
            system=system_msg,
            messages=api_messages,
            max_tokens=config.max_tokens,
            temperature=config.temperature,
        ) as stream:
            async for text in stream.text_stream:
                yield text

    def _estimate_cost(self, input_tokens: int, output_tokens: int) -> float:
        prices = PRICING.get(self.model_id, {"input": 3.00, "output": 15.00})
        return (input_tokens * prices["input"] + output_tokens * prices["output"]) / 1_000_000
