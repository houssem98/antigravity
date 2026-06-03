"""
Headroom compression — shrink verbose LLM contexts before generation.

Routes message lists through the headroom-proxy Fly app, which crushes
redundant JSON / logs / RAG chunks ~90% while preserving the user prompt.
Cuts input-token cost on Gemini / Anthropic for SEC-filing-heavy contexts.

Gated by HEADROOM_ENABLED=true. Fails open: any error returns the original
messages unchanged, so a proxy outage never breaks generation.

Env:
  HEADROOM_ENABLED      "true" to turn on (default off)
  HEADROOM_URL          proxy base, default http://headroom-proxy.internal:8787
  HEADROOM_MIN_TOKENS   skip compression below this size (default 1500)
  HEADROOM_TIMEOUT_S    request timeout (default 8)
"""
from __future__ import annotations

import os
from typing import TYPE_CHECKING

import httpx
import structlog

if TYPE_CHECKING:
    from app.llm.base import LLMMessage

logger = structlog.get_logger()


def _enabled() -> bool:
    return os.getenv("HEADROOM_ENABLED", "").lower() == "true"


def _rough_token_count(messages: list["LLMMessage"]) -> int:
    # ~4 chars/token heuristic; only used to decide whether to bother calling.
    chars = sum(len(m.content or "") for m in messages)
    return chars // 4


async def compress_messages(
    messages: list["LLMMessage"],
    model: str,
) -> list["LLMMessage"]:
    """
    Compress a message list via headroom-proxy. Returns compressed messages,
    or the originals unchanged on any failure / when disabled / when small.
    """
    if not _enabled() or not messages:
        return messages

    min_tokens = int(os.getenv("HEADROOM_MIN_TOKENS", "1500"))
    if _rough_token_count(messages) < min_tokens:
        return messages

    base = os.getenv("HEADROOM_URL", "http://headroom-proxy.internal:8787").rstrip("/")
    timeout = float(os.getenv("HEADROOM_TIMEOUT_S", "8"))

    from app.llm.base import LLMMessage  # local import to avoid cycle

    payload = {
        "model": model,
        "messages": [{"role": m.role, "content": m.content} for m in messages],
    }
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.post(f"{base}/v1/compress", json=payload)
            if r.status_code != 200:
                logger.warning("headroom_compress_non200", status=r.status_code)
                return messages
            data = r.json()
    except Exception as e:
        logger.warning("headroom_compress_failed", error=str(e))
        return messages

    out = data.get("messages")
    if not isinstance(out, list) or not out:
        return messages

    before = data.get("tokens_before")
    after = data.get("tokens_after")
    if isinstance(before, int) and isinstance(after, int) and after < before:
        logger.info(
            "headroom_compressed",
            tokens_before=before,
            tokens_after=after,
            saved=before - after,
            model=model,
        )

    return [LLMMessage(role=m.get("role", "user"), content=m.get("content", "")) for m in out]
