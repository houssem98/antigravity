"""
Gravity Search — Fallback Embedder (resilience)

Wraps an ordered list of embedder providers and transparently fails over when
one is unavailable (rate-limited, out of credit, network error). Mirrors the
LLM router's multi-provider failover so a single embedding provider outage can
never take the product down.

Design:
  - Providers are tried in priority order; the first that succeeds wins.
  - A per-provider circuit breaker opens for COOLDOWN_S after a failure, so a
    dead provider isn't retried on every call (avoids latency + error spam).
  - The last provider that succeeded is tried first next time, which keeps the
    vectors written to a collection consistent (all providers output the same
    settings.embedding_dimensions, so cosine scoring stays valid either way).
  - Providers are constructed lazily; a missing API key just skips that provider
    instead of crashing startup.

All providers MUST output the same dimensionality (settings.embedding_dimensions).
"""

import time
import structlog
from typing import Callable

logger = structlog.get_logger()

COOLDOWN_S = 120.0  # how long a failed provider is skipped before retry


class FallbackEmbedder:
    """Ordered embedder chain with per-provider circuit breaking."""

    def __init__(self, providers: list[tuple[str, Callable]]):
        """
        Args:
            providers: ordered list of (name, factory). factory() returns an
                       embedder exposing embed_query / embed_documents, and is
                       only invoked on first use.
        """
        self._specs = providers
        self._instances: dict[str, object] = {}
        self._open_until: dict[str, float] = {}  # name -> epoch when circuit closes
        self._preferred: str | None = None
        self.dimensions = None  # set lazily from first live provider

    def _order(self) -> list[tuple[str, Callable]]:
        """Preferred (last-good) provider first, then declared order."""
        if not self._preferred:
            return self._specs
        pref = [s for s in self._specs if s[0] == self._preferred]
        rest = [s for s in self._specs if s[0] != self._preferred]
        return pref + rest

    def _get(self, name: str, factory: Callable) -> object | None:
        if name in self._instances:
            return self._instances[name]
        try:
            inst = factory()
            self._instances[name] = inst
            if self.dimensions is None:
                self.dimensions = getattr(inst, "dimensions", None)
            return inst
        except Exception as e:
            logger.warning("embedder_init_failed", provider=name, error=str(e))
            self._open_until[name] = time.time() + COOLDOWN_S
            return None

    def _available(self, name: str) -> bool:
        return time.time() >= self._open_until.get(name, 0.0)

    async def _run(self, method: str, *args, **kwargs):
        last_err: Exception | None = None
        tried = 0
        for name, factory in self._order():
            if not self._available(name):
                continue
            inst = self._get(name, factory)
            if inst is None:
                continue
            tried += 1
            try:
                result = await getattr(inst, method)(*args, **kwargs)
                if self._preferred != name:
                    logger.info("embedder_active", provider=name, method=method)
                    self._preferred = name
                return result
            except Exception as e:
                last_err = e
                self._open_until[name] = time.time() + COOLDOWN_S
                logger.warning(
                    "embedder_provider_failed",
                    provider=name, method=method,
                    cooldown_s=COOLDOWN_S, error=str(e)[:200],
                )
                if self._preferred == name:
                    self._preferred = None
                continue
        raise RuntimeError(
            f"All embedding providers failed ({tried} tried). Last error: {last_err}"
        )

    async def embed_query(self, query: str) -> list[float]:
        return await self._run("embed_query", query)

    async def embed_documents(self, texts: list[str], batch_size: int = 128) -> list[list[float]]:
        return await self._run("embed_documents", texts, batch_size=batch_size)
