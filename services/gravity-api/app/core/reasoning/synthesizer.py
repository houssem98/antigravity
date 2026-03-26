"""
Gravity Search — Answer Synthesizer
Wraps the LLM call + prompt assembly into a single reusable class.
Called by SearchPipeline in Stage 6 as a clean abstraction over raw LLM calls.
"""

import json
import structlog
from typing import AsyncIterator

from app.core.reasoning.prompts import FINANCIAL_ANALYST_SYSTEM, build_user_message
from app.core.retrieval.fusion import RetrievalResult
from app.llm.base import BaseLLMClient, LLMConfig, LLMMessage

logger = structlog.get_logger()


class AnswerSynthesizer:
    """
    Generates cited financial answers from retrieved passages.

    Supports:
    - Streaming (yields tokens one by one for progressive rendering)
    - Non-streaming (returns complete JSON response with answer + citations)

    The LLM is prompted via FINANCIAL_ANALYST_SYSTEM to return structured JSON:
      {
        "answer": "...[1]...",
        "citations": [{"id": 1, "source": "...", "section": "...", "text": "..."}],
        "confidence": "HIGH" | "MEDIUM" | "LOW",
        "caveats": [...],
        "follow_up_queries": [...]
      }
    """

    def __init__(self, llm_client: BaseLLMClient):
        self.llm = llm_client

    async def synthesize_stream(
        self,
        query: str,
        passages: list[RetrievalResult],
        structured_data: str = "",
    ) -> AsyncIterator[str]:
        """
        Stream tokens from the LLM as they arrive.
        Use this for WebSocket progressive rendering.

        Yields individual string tokens.
        """
        system_msg = LLMMessage(role="system", content=FINANCIAL_ANALYST_SYSTEM)
        user_msg = LLMMessage(
            role="user",
            content=build_user_message(query, passages, structured_data),
        )

        logger.info(
            "synthesizer_streaming",
            passages_count=len(passages),
            has_structured_data=bool(structured_data),
        )

        async for token in self.llm.generate_stream(
            messages=[system_msg, user_msg],
            config=LLMConfig(temperature=0.1, max_tokens=4096),
        ):
            yield token

    async def synthesize(
        self,
        query: str,
        passages: list[RetrievalResult],
        structured_data: str = "",
    ) -> dict:
        """
        Non-streaming: returns parsed JSON response with answer + citations.
        Use this when you need the complete response before doing anything with it.

        Returns dict matching the FINANCIAL_ANALYST_SYSTEM JSON schema:
          {
            "answer": str,
            "citations": list[dict],
            "confidence": "HIGH" | "MEDIUM" | "LOW",
            "caveats": list[str],
            "follow_up_queries": list[str],
          }
        """
        system_msg = LLMMessage(role="system", content=FINANCIAL_ANALYST_SYSTEM)
        user_msg = LLMMessage(
            role="user",
            content=build_user_message(query, passages, structured_data),
        )

        logger.info(
            "synthesizer_generating",
            passages_count=len(passages),
            has_structured_data=bool(structured_data),
        )

        response = await self.llm.generate(
            messages=[system_msg, user_msg],
            config=LLMConfig(temperature=0.1, max_tokens=4096, json_mode=True),
        )

        try:
            result = json.loads(response.content)
            logger.info(
                "synthesizer_complete",
                confidence=result.get("confidence"),
                citation_count=len(result.get("citations", [])),
                cost_usd=response.cost_usd,
            )
            return result
        except json.JSONDecodeError:
            # Fallback: return raw content if JSON parsing fails
            logger.warning("synthesizer_json_parse_failed", content_preview=response.content[:200])
            return {
                "answer": response.content,
                "citations": [],
                "confidence": "MEDIUM",
                "caveats": ["Response format could not be parsed as structured JSON."],
                "follow_up_queries": [],
            }
