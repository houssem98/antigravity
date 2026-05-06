"""
Gravity Search — Groq Client
Groq runs open-source models (Llama 3.3 70B, Mixtral) at ~200 tok/s.
Free tier: 14,400 req/day. OpenAI-compatible API.
"""

import time
from typing import AsyncIterator

import openai
import structlog

from app.config import settings
from app.llm.base import BaseLLMClient, LLMConfig, LLMMessage, LLMResponse, ModelProvider

logger = structlog.get_logger()

PRICING = {
    "llama-3.3-70b-versatile": {"input": 0.59, "output": 0.79},
    "llama-3.1-8b-instant":    {"input": 0.05, "output": 0.08},
    "mixtral-8x7b-32768":      {"input": 0.24, "output": 0.24},
}


class GroqClient(BaseLLMClient):
    provider = ModelProvider.OPENAI  # OpenAI-compatible wire format

    def __init__(self, model_id: str = "llama-3.3-70b-versatile"):
        self.model_id = model_id
        self.client = openai.AsyncOpenAI(
            api_key=settings.groq_api_key,
            base_url="https://api.groq.com/openai/v1",
        )

    async def generate(self, messages: list[LLMMessage], config: LLMConfig | None = None) -> LLMResponse:
        config = config or LLMConfig()
        api_msgs = [{"role": m.role, "content": m.content} for m in messages]
        start = time.perf_counter()
        response = await self.client.chat.completions.create(
            model=self.model_id,
            messages=api_msgs,
            max_tokens=config.max_tokens,
            temperature=config.temperature,
        )
        latency_ms = (time.perf_counter() - start) * 1000
        content = response.choices[0].message.content or ""
        usage = response.usage
        inp = usage.prompt_tokens if usage else 0
        out = usage.completion_tokens if usage else 0
        logger.info("groq_generate", model=self.model_id, input_tokens=inp,
                    output_tokens=out, latency_ms=round(latency_ms, 1))
        return LLMResponse(content=content, model=self.model_id, input_tokens=inp,
                           output_tokens=out, latency_ms=latency_ms,
                           cost_usd=self._estimate_cost(inp, out))

    async def generate_stream(self, messages: list[LLMMessage], config: LLMConfig | None = None) -> AsyncIterator[str]:
        config = config or LLMConfig()
        api_msgs = [{"role": m.role, "content": m.content} for m in messages]
        stream = await self.client.chat.completions.create(
            model=self.model_id,
            messages=api_msgs,
            max_tokens=config.max_tokens,
            temperature=config.temperature,
            stream=True,
        )
        async for chunk in stream:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content

    def _estimate_cost(self, input_tokens: int, output_tokens: int) -> float:
        p = PRICING.get(self.model_id, {"input": 0.59, "output": 0.79})
        return (input_tokens * p["input"] + output_tokens * p["output"]) / 1_000_000
