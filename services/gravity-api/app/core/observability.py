"""
Gravity Search -- Observability (Langfuse)
Structured trace emission for every search query.

Captures per-stage latency, token counts, model routing, retrieval
channel hit rates, NLI citation recall, and cost — all in one trace
per query that Langfuse can render as a waterfall.

Design principles:
  - Zero latency impact: all Langfuse calls are fire-and-forget via
    asyncio.create_task(); the search pipeline never awaits them.
  - Graceful degradation: if langfuse isn't installed or the key is
    missing, every method is a no-op. The pipeline never fails because
    of observability.
  - Structured spans mirror the 10-stage pipeline exactly.

Setup:
  pip install langfuse
  Set in .env:
    LANGFUSE_PUBLIC_KEY=pk-lf-...
    LANGFUSE_SECRET_KEY=sk-lf-...
    LANGFUSE_HOST=https://cloud.langfuse.com   # or self-hosted URL

Usage (in search_pipeline.py):
    from app.core.observability import get_tracer
    tracer = get_tracer()
    trace = tracer.start_trace(trace_id, query, user_id)
    tracer.record_stage(trace, "retrieval", latency_ms=82.3, passages=24)
    tracer.record_generation(trace, model="claude-haiku", tokens_in=1200,
                             tokens_out=450, cost_usd=0.00012)
    tracer.finish_trace(trace, confidence="HIGH", nli_recall=0.91)
"""

from __future__ import annotations

import asyncio
import os
import time
import structlog
from dataclasses import dataclass, field
from typing import Any

logger = structlog.get_logger()

# ── Langfuse client (lazy singleton) ─────────────────────────────────────────

_langfuse = None
_langfuse_tried = False


def _get_langfuse():
    global _langfuse, _langfuse_tried
    if _langfuse_tried:
        return _langfuse
    _langfuse_tried = True
    try:
        from langfuse import Langfuse
        public_key = os.getenv("LANGFUSE_PUBLIC_KEY", "")
        secret_key = os.getenv("LANGFUSE_SECRET_KEY", "")
        host = os.getenv("LANGFUSE_HOST", "https://cloud.langfuse.com")
        if not public_key or not secret_key:
            logger.info("langfuse_disabled", reason="LANGFUSE_PUBLIC_KEY/SECRET_KEY not set")
            return None
        _langfuse = Langfuse(
            public_key=public_key,
            secret_key=secret_key,
            host=host,
            enabled=True,
        )
        logger.info("langfuse_connected", host=host)
    except ImportError:
        logger.info("langfuse_not_installed", hint="pip install langfuse")
    except Exception as e:
        logger.warning("langfuse_init_failed", error=str(e))
    return _langfuse


# ── Trace handle ──────────────────────────────────────────────────────────────

@dataclass
class TraceHandle:
    trace_id: str
    query: str
    _trace: Any = field(default=None, repr=False)
    _spans: dict[str, Any] = field(default_factory=dict, repr=False)
    _start: float = field(default_factory=time.perf_counter, repr=False)


# ── Tracer ────────────────────────────────────────────────────────────────────

class GravityTracer:
    """
    Thin wrapper around Langfuse that emits structured traces for every
    search query. All public methods are safe to call even when Langfuse
    is unavailable — they silently return None.
    """

    def start_trace(
        self,
        trace_id: str,
        query: str,
        user_id: str = "",
        session_id: str = "",
        metadata: dict | None = None,
    ) -> TraceHandle:
        """Create a new Langfuse trace for a search query."""
        handle = TraceHandle(trace_id=trace_id, query=query)
        lf = _get_langfuse()
        if lf is None:
            return handle
        try:
            handle._trace = lf.trace(
                id=trace_id,
                name="gravity_search",
                input={"query": query},
                user_id=user_id or None,
                session_id=session_id or None,
                metadata=metadata or {},
                tags=["gravity-search"],
            )
        except Exception as e:
            logger.warning("langfuse_trace_start_failed", error=str(e))
        return handle

    def record_stage(
        self,
        handle: TraceHandle,
        stage: str,
        latency_ms: float = 0.0,
        **kwargs: Any,
    ) -> None:
        """Record a pipeline stage span (understanding, retrieval, reranking, etc.)"""
        if handle._trace is None:
            return
        try:
            span = handle._trace.span(
                name=stage,
                metadata={"latency_ms": round(latency_ms, 1), **kwargs},
            )
            span.end()
            handle._spans[stage] = span
        except Exception as e:
            logger.warning("langfuse_span_failed", stage=stage, error=str(e))

    def record_generation(
        self,
        handle: TraceHandle,
        model: str,
        tokens_in: int = 0,
        tokens_out: int = 0,
        cost_usd: float = 0.0,
        stage: str = "generation",
        prompt: str = "",
        completion: str = "",
    ) -> None:
        """Record an LLM generation (model, tokens, cost)."""
        if handle._trace is None:
            return
        try:
            gen = handle._trace.generation(
                name=stage,
                model=model,
                usage={
                    "input": tokens_in,
                    "output": tokens_out,
                    "total": tokens_in + tokens_out,
                    "unit": "TOKENS",
                },
                metadata={"cost_usd": cost_usd},
                input=prompt[:500] if prompt else None,
                output=completion[:500] if completion else None,
            )
            gen.end()
        except Exception as e:
            logger.warning("langfuse_generation_failed", model=model, error=str(e))

    def record_retrieval(
        self,
        handle: TraceHandle,
        channels: list[str],
        total_retrieved: int,
        after_rerank: int,
        latency_ms: float,
        nli_recall: float | None = None,
    ) -> None:
        """Record retrieval metadata as a structured span."""
        self.record_stage(
            handle,
            stage="retrieval",
            latency_ms=latency_ms,
            channels=channels,
            total_retrieved=total_retrieved,
            after_rerank=after_rerank,
            nli_recall=round(nli_recall, 4) if nli_recall is not None else None,
        )

    def finish_trace(
        self,
        handle: TraceHandle,
        confidence: str = "MEDIUM",
        nli_recall: float | None = None,
        alce_recall: float | None = None,
        numeric_mismatches: int = 0,
        model_used: str = "",
        total_cost_usd: float = 0.0,
        output: str = "",
    ) -> None:
        """Finalize the trace with output and quality scores."""
        if handle._trace is None:
            return
        try:
            e2e_ms = round((time.perf_counter() - handle._start) * 1000, 1)
            handle._trace.update(
                output={"answer_preview": output[:300]} if output else None,
                metadata={
                    "e2e_ms": e2e_ms,
                    "confidence": confidence,
                    "nli_citation_recall": nli_recall,
                    "alce_citation_recall": alce_recall,
                    "numeric_mismatches": numeric_mismatches,
                    "model_used": model_used,
                    "total_cost_usd": round(total_cost_usd, 6),
                },
            )
            # Score quality in Langfuse for regression gating
            lf = _get_langfuse()
            if lf and handle.trace_id:
                _conf_map = {"HIGH": 1.0, "MEDIUM": 0.6, "LOW": 0.2}
                lf.score(
                    trace_id=handle.trace_id,
                    name="confidence",
                    value=_conf_map.get(confidence, 0.6),
                )
                if nli_recall is not None:
                    lf.score(
                        trace_id=handle.trace_id,
                        name="nli_citation_recall",
                        value=nli_recall,
                    )
                if numeric_mismatches == 0:
                    lf.score(
                        trace_id=handle.trace_id,
                        name="numeric_accuracy",
                        value=1.0,
                    )
        except Exception as e:
            logger.warning("langfuse_finish_failed", error=str(e))

    def flush(self) -> None:
        """Flush pending Langfuse events (call on app shutdown)."""
        lf = _get_langfuse()
        if lf:
            try:
                lf.flush()
            except Exception:
                pass


# ── Singleton ─────────────────────────────────────────────────────────────────

_tracer: GravityTracer | None = None


def get_tracer() -> GravityTracer:
    global _tracer
    if _tracer is None:
        _tracer = GravityTracer()
    return _tracer
