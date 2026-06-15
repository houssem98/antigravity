"""
Gravity Search — Google Gemini Client
Supports Gemini 2.5 Flash (fast/cheap), Gemini 3 Pro (multimodal, grounding).
"""

import asyncio
import time
from typing import AsyncIterator

import structlog

from app.config import settings
from app.llm.base import BaseLLMClient, LLMConfig, LLMMessage, LLMResponse, ModelProvider

logger = structlog.get_logger()


async def _retry_with_backoff(coro, max_retries=3, base_delay=1):
    """Retry on 429 (rate limit) with exponential backoff."""
    for attempt in range(max_retries):
        try:
            return await coro
        except Exception as e:
            error_str = str(e)
            is_429 = "429" in error_str or "Too Many Requests" in error_str
            is_last = attempt == max_retries - 1

            if not is_429 or is_last:
                raise

            # Extract retry delay from error if available
            delay = base_delay * (2 ** attempt)
            if "retryDelay" in error_str:
                try:
                    import re
                    match = re.search(r'"retryDelay":"(\d+)s"', error_str)
                    if match:
                        delay = int(match.group(1))
                except:
                    pass

            logger.warning(
                "gemini_rate_limit_retry",
                attempt=attempt + 1,
                max_retries=max_retries,
                delay_seconds=delay,
            )
            await asyncio.sleep(delay)

PRICING = {
    "gemini-2.0-flash": {"input": 0.10, "output": 0.40},
    "gemini-1.5-pro": {"input": 1.25, "output": 5.00},
}


class GoogleClient(BaseLLMClient):
    provider = ModelProvider.GOOGLE

    def __init__(self, model_id: str = "gemini-2.5-flash"):
        self.model_id = model_id
        self._client = None

    def _get_client(self):
        if self._client is None:
            from google import genai
            self._client = genai.Client(api_key=settings.google_api_key)
        return self._client

    async def generate(
        self,
        messages: list[LLMMessage],
        config: LLMConfig | None = None,
    ) -> LLMResponse:
        from google.genai import types
        from app.llm.headroom import compress_messages
        config = config or LLMConfig()
        client = self._get_client()

        messages = await compress_messages(messages, self.model_id)

        system_instruction = None
        contents = []
        for msg in messages:
            if msg.role == "system":
                system_instruction = msg.content
            else:
                contents.append(types.Content(
                    role="user" if msg.role == "user" else "model",
                    parts=[types.Part(text=msg.content)],
                ))

        gen_config = types.GenerateContentConfig(
            temperature=config.temperature,
            max_output_tokens=config.max_tokens,
            top_p=config.top_p,
            system_instruction=system_instruction,
        )
        if config.json_mode:
            gen_config.response_mime_type = "application/json"

        start = time.perf_counter()
        response = await _retry_with_backoff(
            client.aio.models.generate_content(
                model=self.model_id,
                contents=contents,
                config=gen_config,
            )
        )
        latency_ms = (time.perf_counter() - start) * 1000

        content = response.text or ""
        input_tokens = getattr(response.usage_metadata, "prompt_token_count", 0) or 0
        output_tokens = getattr(response.usage_metadata, "candidates_token_count", 0) or 0

        logger.info(
            "google_generate",
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
        from google.genai import types
        config = config or LLMConfig()
        client = self._get_client()

        system_instruction = None
        contents = []
        for msg in messages:
            if msg.role == "system":
                system_instruction = msg.content
            else:
                contents.append(types.Content(
                    role="user" if msg.role == "user" else "model",
                    parts=[types.Part(text=msg.content)],
                ))

        gen_config = types.GenerateContentConfig(
            temperature=config.temperature,
            max_output_tokens=config.max_tokens,
            system_instruction=system_instruction,
        )

        for attempt in range(3):
            try:
                async for chunk in await client.aio.models.generate_content_stream(
                    model=self.model_id,
                    contents=contents,
                    config=gen_config,
                ):
                    if chunk.text:
                        yield chunk.text
                return
            except Exception as e:
                error_str = str(e)
                is_429 = "429" in error_str or "Too Many Requests" in error_str
                is_last = attempt == 2

                if not is_429 or is_last:
                    raise

                delay = 1 * (2 ** attempt)
                if "retryDelay" in error_str:
                    try:
                        import re
                        match = re.search(r'"retryDelay":"(\d+)s"', error_str)
                        if match:
                            delay = int(match.group(1))
                    except:
                        pass

                logger.warning(
                    "gemini_stream_rate_limit_retry",
                    attempt=attempt + 1,
                    delay_seconds=delay,
                )
                await asyncio.sleep(delay)

    def _estimate_cost(self, input_tokens: int, output_tokens: int) -> float:
        prices = PRICING.get(self.model_id, {"input": 0.15, "output": 0.60})
        return (input_tokens * prices["input"] + output_tokens * prices["output"]) / 1_000_000
