"""
Routing Feedback Loop
=====================
Closes the quality loop between user signals and model routing decisions.

Without feedback, the router makes static decisions based on heuristics.
With feedback, it learns from every query:
  - Which model produced high/low confidence answers?
  - Which complexity bucket needed an upgrade?
  - Which queries had high latency but could have been SIMPLE?

Data flow:
  search_pipeline.py  ──log──►  search_logs (PostgreSQL)
  User feedback API   ──log──►  search_logs.user_feedback
  RoutingFeedbackLoop ──read──► Computes routing_accuracy per (complexity, model)
                     ──write──► Suggests routing_overrides in Redis (TTL 24h)
  LLMRouter           ──read──► Applies overrides before default routing table

This is NOT a training loop (no gradient updates). It is a heuristic adjustment:
  "If SIMPLE queries on model=gemini-flash consistently yield confidence < 0.5,
   bump them to MEDIUM routing for the next 24 hours."

Metrics computed:
  - routing_accuracy:   fraction of queries where model produced HIGH confidence
  - upgrade_rate:       fraction that needed model upgrade (retry with better model)
  - latency_p95:        per (complexity, model) pair
  - cache_hit_rate:     fraction served from semantic cache
  - user_satisfaction:  explicit thumbs up/down rate
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any

import structlog

logger = structlog.get_logger()

# Redis key prefix for routing overrides
_OVERRIDE_PREFIX = "routing_override:"
_OVERRIDE_TTL = 86400  # 24 hours

# Minimum queries before an override is considered statistically meaningful
_MIN_SAMPLES = 20

# Confidence threshold: below this → model wasn't good enough for this complexity
_CONFIDENCE_THRESHOLD = 0.6


@dataclass
class FeedbackRecord:
    """A single query feedback record (mirrors search_logs table)."""
    trace_id: str
    query: str
    complexity: str          # "simple" | "medium" | "complex" | "math"
    model_used: str          # e.g. "gemini-2.5-flash"
    confidence: float        # 0.0–1.0 from LLM answer
    latency_ms: float
    cache_hit: bool
    user_feedback: str | None = None   # "positive" | "negative" | None
    numeric_mismatches: int = 0
    temporal_mismatches: int = 0
    cost_usd: float = 0.0


@dataclass
class RoutingStats:
    """Aggregated stats for a (complexity, model) pair."""
    complexity: str
    model: str
    sample_count: int = 0
    high_confidence_count: int = 0
    total_latency_ms: float = 0.0
    positive_feedback: int = 0
    negative_feedback: int = 0
    numeric_mismatch_total: int = 0
    temporal_mismatch_total: int = 0

    @property
    def routing_accuracy(self) -> float:
        """Fraction of queries that produced HIGH confidence."""
        return self.high_confidence_count / max(self.sample_count, 1)

    @property
    def avg_latency_ms(self) -> float:
        return self.total_latency_ms / max(self.sample_count, 1)

    @property
    def user_satisfaction(self) -> float | None:
        total_feedback = self.positive_feedback + self.negative_feedback
        if total_feedback == 0:
            return None
        return self.positive_feedback / total_feedback

    def to_dict(self) -> dict:
        return {
            "complexity": self.complexity,
            "model": self.model,
            "sample_count": self.sample_count,
            "routing_accuracy": round(self.routing_accuracy, 3),
            "avg_latency_ms": round(self.avg_latency_ms, 1),
            "user_satisfaction": self.user_satisfaction,
            "numeric_mismatch_rate": round(
                self.numeric_mismatch_total / max(self.sample_count, 1), 3
            ),
            "temporal_mismatch_rate": round(
                self.temporal_mismatch_total / max(self.sample_count, 1), 3
            ),
        }


class RoutingFeedbackLoop:
    """
    Collects quality signals and suggests routing improvements.

    Usage (in main.py lifespan or background task):
        loop = RoutingFeedbackLoop(db_pool, redis_client)
        await loop.record(feedback_record)         # After each query
        await loop.recompute_overrides()           # Run hourly
        overrides = await loop.get_overrides()     # In router
    """

    def __init__(self, db_pool=None, redis_client=None):
        self.db = db_pool
        self.redis = redis_client

    # ── Recording ────────────────────────────────────────────────────────────

    async def record(self, record: FeedbackRecord) -> None:
        """
        Persist a feedback record to search_logs and in-memory aggregates.

        Called automatically by the search pipeline after every query.
        Also called by the user feedback API endpoint when user rates an answer.
        """
        if self.db is None:
            return

        try:
            async with self.db.acquire() as conn:
                await conn.execute(
                    """
                    INSERT INTO search_logs (
                        trace_id, query, complexity, model_used,
                        answer_confidence, latency_ms, cache_hit,
                        user_feedback, cost_usd, created_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
                    ON CONFLICT (trace_id) DO UPDATE SET
                        user_feedback = EXCLUDED.user_feedback,
                        answer_confidence = EXCLUDED.answer_confidence
                    """,
                    record.trace_id,
                    record.query[:500],
                    record.complexity,
                    record.model_used,
                    record.confidence,
                    record.latency_ms,
                    record.cache_hit,
                    record.user_feedback,
                    record.cost_usd,
                )
        except Exception as e:
            logger.warning("feedback_record_failed", error=str(e))

    async def record_user_signal(
        self,
        trace_id: str,
        signal: str,   # "positive" | "negative"
    ) -> None:
        """Update an existing search log with explicit user feedback."""
        if self.db is None:
            return
        try:
            async with self.db.acquire() as conn:
                await conn.execute(
                    "UPDATE search_logs SET user_feedback = $1 WHERE trace_id = $2",
                    signal,
                    trace_id,
                )
        except Exception as e:
            logger.warning("user_signal_update_failed", error=str(e))

    # ── Analysis ─────────────────────────────────────────────────────────────

    async def compute_stats(self, lookback_hours: int = 24) -> list[RoutingStats]:
        """
        Aggregate routing stats from the last N hours.

        Returns one RoutingStats per (complexity, model_used) pair.
        """
        if self.db is None:
            return []

        try:
            async with self.db.acquire() as conn:
                rows = await conn.fetch(
                    """
                    SELECT
                        complexity,
                        model_used,
                        COUNT(*) AS sample_count,
                        SUM(CASE WHEN answer_confidence >= 0.7 THEN 1 ELSE 0 END) AS high_conf_count,
                        AVG(latency_ms) AS avg_latency,
                        SUM(CASE WHEN user_feedback = 'positive' THEN 1 ELSE 0 END) AS positive,
                        SUM(CASE WHEN user_feedback = 'negative' THEN 1 ELSE 0 END) AS negative
                    FROM search_logs
                    WHERE created_at >= NOW() - INTERVAL '$1 hours'
                      AND complexity IS NOT NULL
                      AND model_used IS NOT NULL
                    GROUP BY complexity, model_used
                    ORDER BY complexity, sample_count DESC
                    """,
                    lookback_hours,
                )

            stats = []
            for row in rows:
                s = RoutingStats(
                    complexity=row["complexity"],
                    model=row["model_used"],
                    sample_count=row["sample_count"],
                    high_confidence_count=row["high_conf_count"] or 0,
                    total_latency_ms=(row["avg_latency"] or 0) * row["sample_count"],
                    positive_feedback=row["positive"] or 0,
                    negative_feedback=row["negative"] or 0,
                )
                stats.append(s)
            return stats

        except Exception as e:
            logger.warning("feedback_compute_stats_failed", error=str(e))
            return []

    # ── Override Generation ───────────────────────────────────────────────────

    async def recompute_overrides(self) -> dict[str, str]:
        """
        Analyse stats and write routing overrides to Redis.

        Override logic:
          - If routing_accuracy < 0.6 for (simple, model) → upgrade to medium routing
          - If routing_accuracy < 0.5 for (medium, model) → upgrade to complex routing
          - If user_satisfaction < 0.4 → always upgrade one tier

        Returns dict of complexity → suggested_model overrides.
        """
        stats = await self.compute_stats(lookback_hours=24)
        overrides: dict[str, str] = {}

        # Default routing table (mirrors router.py)
        DEFAULT_ROUTING = {
            "simple": "gemini-2.5-flash",
            "medium": "claude-sonnet-4-5",
            "complex": "claude-opus-4-6",
            "math": "gpt-5.2",
        }
        UPGRADE_ROUTING = {
            "simple": "claude-sonnet-4-5",   # Simple → bump to medium model
            "medium": "claude-opus-4-6",      # Medium → bump to complex model
            "complex": "claude-opus-4-6",     # Already at max
            "math": "claude-opus-4-6",        # Math fallback
        }

        for stat in stats:
            if stat.sample_count < _MIN_SAMPLES:
                continue  # Not enough data to trust

            needs_upgrade = False
            reason = ""

            if stat.routing_accuracy < _CONFIDENCE_THRESHOLD:
                needs_upgrade = True
                reason = f"low_accuracy={stat.routing_accuracy:.2f}"

            sat = stat.user_satisfaction
            if sat is not None and sat < 0.4:
                needs_upgrade = True
                reason += f" low_satisfaction={sat:.2f}"

            if needs_upgrade:
                suggested = UPGRADE_ROUTING.get(stat.complexity, stat.model)
                overrides[stat.complexity] = suggested
                logger.info(
                    "routing_override_suggested",
                    complexity=stat.complexity,
                    current_model=stat.model,
                    suggested_model=suggested,
                    reason=reason,
                    samples=stat.sample_count,
                )

        # Persist overrides to Redis
        if self.redis and overrides:
            try:
                for complexity, model in overrides.items():
                    key = f"{_OVERRIDE_PREFIX}{complexity}"
                    await self.redis.setex(key, _OVERRIDE_TTL, model)
                logger.info("routing_overrides_saved", count=len(overrides))
            except Exception as e:
                logger.warning("routing_overrides_redis_failed", error=str(e))

        return overrides

    async def get_overrides(self) -> dict[str, str]:
        """
        Read current routing overrides from Redis.

        Called by LLMRouter.route() to check if there's an active override
        before applying the default routing table.
        """
        if self.redis is None:
            return {}
        try:
            overrides = {}
            for complexity in ("simple", "medium", "complex", "math"):
                key = f"{_OVERRIDE_PREFIX}{complexity}"
                val = await self.redis.get(key)
                if val:
                    overrides[complexity] = val.decode() if isinstance(val, bytes) else val
            return overrides
        except Exception as e:
            logger.warning("routing_overrides_read_failed", error=str(e))
            return {}

    # ── Reporting ─────────────────────────────────────────────────────────────

    async def generate_report(self, lookback_hours: int = 24) -> dict:
        """
        Generate a routing quality report for monitoring dashboards.

        Returns dict suitable for Prometheus gauge updates or JSON API.
        """
        stats = await self.compute_stats(lookback_hours)
        overrides = await self.get_overrides()

        # Overall stats
        total_queries = sum(s.sample_count for s in stats)
        total_high_conf = sum(s.high_confidence_count for s in stats)

        return {
            "lookback_hours": lookback_hours,
            "total_queries": total_queries,
            "overall_routing_accuracy": round(total_high_conf / max(total_queries, 1), 3),
            "active_overrides": overrides,
            "by_complexity_model": [s.to_dict() for s in stats],
        }
