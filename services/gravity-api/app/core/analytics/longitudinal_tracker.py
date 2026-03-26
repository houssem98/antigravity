"""
Longitudinal Tracker
====================
Tracks financial metrics and sentiment across multiple time periods
to address the Fin-RATE benchmark's 14.35% accuracy drop on cross-period tasks.

Key capabilities:
  - Metric trend extraction: pull a named metric across N periods
  - Anomaly detection: flag statistical outliers (>2σ from trend)
  - YoY / QoQ delta computation with percentage change
  - Trend narrative generation (LLM or rule-based)
  - Guidance vs actuals tracking
  - Redis caching for metric series

Design principle: the tracker NEVER calls an LLM for the metric values themselves
(those come from deterministic RatioEngine / TimescaleDB). LLM is only used for
narrative generation, and only optionally.
"""

from __future__ import annotations

import json
import math
import time
from dataclasses import dataclass, field
from typing import Optional

import structlog

logger = structlog.get_logger()

_CACHE_PREFIX = "longitudinal:"
_CACHE_TTL = 3600  # 1 hour


# ── Data Classes ───────────────────────────────────────────────────────────────

@dataclass
class PeriodDataPoint:
    """A single data point for one period."""
    period: str                     # e.g. "Q3 2024", "FY2023"
    value: float | None
    currency: str = "USD"
    unit: str = ""
    is_guidance: bool = False
    source_document_id: str = ""
    filing_date: str = ""
    yoy_change: float | None = None
    qoq_change: float | None = None
    is_anomaly: bool = False
    anomaly_z_score: float | None = None


@dataclass
class MetricSeries:
    """Time series for a single metric across multiple periods."""
    ticker: str
    metric_name: str
    display_name: str
    unit: str
    data_points: list[PeriodDataPoint] = field(default_factory=list)

    # Computed statistics
    mean: float | None = None
    std_dev: float | None = None
    cagr: float | None = None           # Compound Annual Growth Rate
    trend_direction: str = ""           # "up" | "down" | "flat" | "volatile"
    trend_confidence: float = 0.0       # 0.0–1.0

    def values(self) -> list[float]:
        return [p.value for p in self.data_points if p.value is not None]

    def periods(self) -> list[str]:
        return [p.period for p in self.data_points if p.value is not None]


@dataclass
class LongitudinalProfile:
    """Full longitudinal analysis for a ticker across metrics and periods."""
    ticker: str
    company_name: str
    periods_analyzed: list[str]
    metrics: dict[str, MetricSeries] = field(default_factory=dict)
    cross_metric_insights: list[str] = field(default_factory=list)
    narrative: str = ""
    latency_ms: float = 0.0


@dataclass
class GuidanceActualsTracker:
    """Tracks management guidance vs. actual results."""
    ticker: str
    metric: str
    period: str
    guidance_value: float | None = None
    guidance_range_low: float | None = None
    guidance_range_high: float | None = None
    actual_value: float | None = None
    beat_miss: str = ""             # "beat" | "miss" | "in_line" | "unknown"
    beat_miss_pct: float | None = None
    guidance_source_doc: str = ""
    actual_source_doc: str = ""


# ── Longitudinal Tracker ───────────────────────────────────────────────────────

class LongitudinalTracker:
    """
    Tracks financial metrics across time periods.
    Integrates with RatioEngine for deterministic metric values.
    """

    def __init__(self, db_pool=None, redis_client=None, llm_client=None, ratio_engine=None):
        self.db = db_pool
        self.redis = redis_client
        self.llm = llm_client
        self.ratio_engine = ratio_engine

    # ── Public API ─────────────────────────────────────────────────────────────

    async def get_metric_series(
        self,
        ticker: str,
        metric_name: str,
        periods: list[str],
    ) -> MetricSeries:
        """
        Pull a metric across multiple periods.
        Periods format: ["Q1 2023", "Q2 2023", "Q3 2023", "Q4 2023", "Q1 2024", ...]
        """
        cache_key = f"{ticker}:{metric_name}:{','.join(periods[:3])}"
        cached = await self._load_cache(cache_key)
        if cached:
            return cached

        data_points = []
        for period in periods:
            value = await self._fetch_metric(ticker, metric_name, period)
            data_points.append(PeriodDataPoint(
                period=period,
                value=value,
                unit=self._get_metric_unit(metric_name),
            ))

        series = MetricSeries(
            ticker=ticker,
            metric_name=metric_name,
            display_name=self._format_metric_name(metric_name),
            unit=self._get_metric_unit(metric_name),
            data_points=data_points,
        )

        self._compute_statistics(series)
        self._compute_changes(series)
        self._detect_anomalies(series)

        await self._store_cache(cache_key, series)
        return series

    async def get_profile(
        self,
        ticker: str,
        company_name: str,
        metrics: list[str],
        periods: list[str],
        generate_narrative: bool = True,
    ) -> LongitudinalProfile:
        """Build a full longitudinal profile for a ticker."""
        start = time.time()
        profile = LongitudinalProfile(
            ticker=ticker,
            company_name=company_name,
            periods_analyzed=periods,
        )

        # Fetch all metric series in parallel
        import asyncio
        series_results = await asyncio.gather(
            *[self.get_metric_series(ticker, m, periods) for m in metrics],
            return_exceptions=True,
        )

        for i, result in enumerate(series_results):
            if isinstance(result, MetricSeries):
                profile.metrics[metrics[i]] = result
            else:
                logger.warning("metric_series_failed", metric=metrics[i], error=str(result))

        # Cross-metric insights
        profile.cross_metric_insights = self._compute_cross_metric_insights(profile)

        # Narrative
        if generate_narrative:
            if self.llm:
                profile.narrative = await self._generate_narrative(profile)
            else:
                profile.narrative = self._rule_based_narrative(profile)

        profile.latency_ms = (time.time() - start) * 1000
        logger.info(
            "longitudinal_profile_built",
            ticker=ticker,
            metrics=len(profile.metrics),
            periods=len(periods),
            latency_ms=round(profile.latency_ms, 1),
        )
        return profile

    async def track_guidance_vs_actuals(
        self,
        ticker: str,
        metric: str,
        periods: list[str],
    ) -> list[GuidanceActualsTracker]:
        """Compare management guidance to actual results."""
        results = []
        for period in periods:
            guidance = await self._fetch_guidance(ticker, metric, period)
            actual = await self._fetch_metric(ticker, metric, period)

            tracker = GuidanceActualsTracker(
                ticker=ticker,
                metric=metric,
                period=period,
                guidance_value=guidance.get("value") if guidance else None,
                guidance_range_low=guidance.get("range_low") if guidance else None,
                guidance_range_high=guidance.get("range_high") if guidance else None,
                actual_value=actual,
            )

            if tracker.guidance_value is not None and tracker.actual_value is not None:
                diff = tracker.actual_value - tracker.guidance_value
                tracker.beat_miss_pct = (diff / abs(tracker.guidance_value)) * 100 if tracker.guidance_value != 0 else 0
                if tracker.beat_miss_pct > 2:
                    tracker.beat_miss = "beat"
                elif tracker.beat_miss_pct < -2:
                    tracker.beat_miss = "miss"
                else:
                    tracker.beat_miss = "in_line"

            results.append(tracker)
        return results

    def compare_periods(
        self,
        series: MetricSeries,
        period_a: str,
        period_b: str,
    ) -> dict:
        """Compare two specific periods within a series."""
        dp_a = next((p for p in series.data_points if p.period == period_a), None)
        dp_b = next((p for p in series.data_points if p.period == period_b), None)

        if not dp_a or not dp_b or dp_a.value is None or dp_b.value is None:
            return {"error": f"Data not available for one or both periods"}

        delta = dp_b.value - dp_a.value
        pct_change = (delta / abs(dp_a.value)) * 100 if dp_a.value != 0 else 0

        return {
            "metric": series.metric_name,
            "period_a": {"period": period_a, "value": dp_a.value, "unit": series.unit},
            "period_b": {"period": period_b, "value": dp_b.value, "unit": series.unit},
            "delta": round(delta, 4),
            "pct_change": round(pct_change, 2),
            "direction": "up" if delta > 0 else "down" if delta < 0 else "flat",
        }

    # ── Statistical Methods ────────────────────────────────────────────────────

    def _compute_statistics(self, series: MetricSeries) -> None:
        values = series.values()
        if len(values) < 2:
            return

        series.mean = sum(values) / len(values)
        variance = sum((v - series.mean) ** 2 for v in values) / len(values)
        series.std_dev = math.sqrt(variance)

        # CAGR: from first to last value
        first, last = values[0], values[-1]
        n_years = len(values) / 4  # assuming quarterly data
        if first > 0 and last > 0 and n_years > 0:
            try:
                series.cagr = round((last / first) ** (1 / n_years) - 1, 4)
            except (ValueError, ZeroDivisionError):
                pass

        # Trend direction via linear regression slope
        n = len(values)
        x_mean = (n - 1) / 2
        slope_num = sum((i - x_mean) * (v - series.mean) for i, v in enumerate(values))
        slope_den = sum((i - x_mean) ** 2 for i in range(n))
        slope = slope_num / slope_den if slope_den != 0 else 0

        # Normalize slope relative to mean
        normalized_slope = slope / abs(series.mean) if series.mean and series.mean != 0 else 0

        if abs(normalized_slope) < 0.02:
            series.trend_direction = "flat"
        elif normalized_slope > 0:
            series.trend_direction = "up"
        else:
            series.trend_direction = "down"

        # Trend confidence: lower std_dev relative to slope = more confident
        if series.std_dev and abs(slope) > 0:
            series.trend_confidence = round(min(1.0, abs(slope) / (series.std_dev + 1e-9)), 3)

    def _compute_changes(self, series: MetricSeries) -> None:
        """Compute YoY (4-period lag) and QoQ (1-period lag) changes."""
        points = series.data_points
        for i, dp in enumerate(points):
            if dp.value is None:
                continue
            # QoQ: compare to previous period
            if i >= 1 and points[i - 1].value is not None:
                prev = points[i - 1].value
                dp.qoq_change = round(((dp.value - prev) / abs(prev)) * 100, 2) if prev != 0 else None

            # YoY: compare to 4 periods ago
            if i >= 4 and points[i - 4].value is not None:
                prior_year = points[i - 4].value
                dp.yoy_change = round(((dp.value - prior_year) / abs(prior_year)) * 100, 2) if prior_year != 0 else None

    def _detect_anomalies(self, series: MetricSeries) -> None:
        """Flag data points >2σ from the mean."""
        if series.mean is None or series.std_dev is None or series.std_dev == 0:
            return

        for dp in series.data_points:
            if dp.value is None:
                continue
            z_score = (dp.value - series.mean) / series.std_dev
            dp.anomaly_z_score = round(z_score, 3)
            dp.is_anomaly = abs(z_score) > 2.0

    def _compute_cross_metric_insights(self, profile: LongitudinalProfile) -> list[str]:
        """Rule-based cross-metric correlation insights."""
        insights = []
        metrics = profile.metrics

        # Revenue vs margin divergence
        if "revenue" in metrics and "gross_margin" in metrics:
            rev_series = metrics["revenue"]
            margin_series = metrics["gross_margin"]
            if rev_series.trend_direction == "up" and margin_series.trend_direction == "down":
                insights.append(
                    f"{profile.ticker}: Revenue growing while gross margins declining — "
                    "potential pricing pressure or rising COGS."
                )
            elif rev_series.trend_direction == "up" and margin_series.trend_direction == "up":
                insights.append(
                    f"{profile.ticker}: Both revenue and margins expanding — strong operating leverage."
                )

        # FCF vs net income divergence
        if "free_cash_flow" in metrics and "net_income" in metrics:
            fcf = metrics["free_cash_flow"]
            ni = metrics["net_income"]
            if fcf.trend_direction != ni.trend_direction:
                insights.append(
                    f"{profile.ticker}: FCF and net income trends diverging — "
                    "check accruals and working capital movements."
                )

        # Debt trend
        if "total_debt" in metrics:
            debt = metrics["total_debt"]
            if debt.trend_direction == "up" and debt.cagr and debt.cagr > 0.15:
                insights.append(
                    f"{profile.ticker}: Total debt growing at {debt.cagr:.1%} CAGR — "
                    "monitor leverage trajectory."
                )

        return insights

    # ── Narrative Generation ───────────────────────────────────────────────────

    def _rule_based_narrative(self, profile: LongitudinalProfile) -> str:
        lines = [f"{profile.company_name} ({profile.ticker}) — Longitudinal Analysis"]
        lines.append(f"Periods: {', '.join(profile.periods_analyzed[:4])}...")

        for name, series in list(profile.metrics.items())[:5]:
            if not series.values():
                continue
            latest = series.data_points[-1] if series.data_points else None
            if latest and latest.value is not None:
                trend_str = f"trending {series.trend_direction}"
                cagr_str = f", CAGR {series.cagr:.1%}" if series.cagr else ""
                lines.append(
                    f"  {series.display_name}: {latest.value:,.1f} {series.unit} "
                    f"({trend_str}{cagr_str})"
                )

        if profile.cross_metric_insights:
            lines.append("\nKey Insights:")
            for insight in profile.cross_metric_insights:
                lines.append(f"  • {insight}")

        return "\n".join(lines)

    async def _generate_narrative(self, profile: LongitudinalProfile) -> str:
        """Generate a nuanced narrative using the LLM."""
        try:
            summary_lines = []
            for name, series in list(profile.metrics.items())[:6]:
                vals = series.values()
                if not vals:
                    continue
                summary_lines.append(
                    f"{series.display_name}: {vals[-1]:,.1f} {series.unit}, "
                    f"trend={series.trend_direction}, "
                    f"CAGR={series.cagr:.1%}" if series.cagr else f"{series.display_name}: {vals[-1]:,.1f} {series.unit}"
                )

            prompt = (
                f"Write a 2-3 sentence financial summary for {profile.company_name} ({profile.ticker}) "
                f"based on {len(profile.periods_analyzed)} periods of data:\n"
                + "\n".join(summary_lines)
                + "\n\nInsights: " + "; ".join(profile.cross_metric_insights[:2])
                + "\n\nBe concise and factual. Focus on trajectory and key risks."
            )

            response = await self.llm.complete(
                messages=[{"role": "user", "content": prompt}],
                max_tokens=150,
                temperature=0.2,
            )
            return response.content if hasattr(response, 'content') else str(response)
        except Exception as e:
            logger.warning("longitudinal_narrative_failed", error=str(e))
            return self._rule_based_narrative(profile)

    # ── Data Fetching ──────────────────────────────────────────────────────────

    async def _fetch_metric(self, ticker: str, metric_name: str, period: str) -> float | None:
        """Fetch a single metric value from RatioEngine or TimescaleDB."""
        if self.ratio_engine:
            try:
                output = await self.ratio_engine.compute_from_query(
                    ticker=ticker,
                    query=metric_name,
                    period=period,
                )
                if output and output.ratios:
                    first_val = next(iter(output.ratios.values()))
                    if isinstance(first_val, (int, float)):
                        return float(first_val)
            except Exception:
                pass

        if self.db:
            try:
                fiscal_year, fiscal_quarter = self._parse_period(period)
                async with self.db.acquire() as conn:
                    row = await conn.fetchrow(
                        """
                        SELECT value FROM financial_statements
                        WHERE ticker = $1
                          AND metric_name = $2
                          AND fiscal_year = $3
                          AND (fiscal_quarter = $4 OR ($4 IS NULL AND fiscal_quarter = 'FY'))
                        ORDER BY filing_date DESC
                        LIMIT 1
                        """,
                        ticker, metric_name, fiscal_year, fiscal_quarter,
                    )
                    if row:
                        return float(row["value"])
            except Exception as e:
                logger.warning("metric_db_fetch_failed", error=str(e))

        return None

    async def _fetch_guidance(self, ticker: str, metric: str, period: str) -> dict | None:
        """Fetch management guidance for a metric from consensus_estimates table."""
        if not self.db:
            return None
        try:
            async with self.db.acquire() as conn:
                row = await conn.fetchrow(
                    """
                    SELECT estimate_value, actual_value
                    FROM consensus_estimates
                    WHERE ticker = $1 AND metric_name = $2 AND period = $3
                    ORDER BY estimate_date DESC
                    LIMIT 1
                    """,
                    ticker, metric, period,
                )
                if row:
                    return {"value": row["estimate_value"]}
        except Exception as e:
            logger.warning("guidance_fetch_failed", error=str(e))
        return None

    # ── Utilities ──────────────────────────────────────────────────────────────

    def _parse_period(self, period: str) -> tuple[int | None, str | None]:
        """Parse "Q3 2024" → (2024, "Q3") or "FY2023" → (2023, "FY")."""
        import re
        m = re.match(r'([FQ][Y1-4])\s*(\d{4})', period, re.IGNORECASE)
        if m:
            qualifier, year = m.group(1).upper(), int(m.group(2))
            if qualifier == "FY":
                return year, "FY"
            return year, qualifier
        m = re.match(r'(\d{4})', period)
        if m:
            return int(m.group(1)), "FY"
        return None, None

    def _format_metric_name(self, metric_name: str) -> str:
        return metric_name.replace("_", " ").title()

    def _get_metric_unit(self, metric_name: str) -> str:
        pct_metrics = {"gross_margin", "operating_margin", "net_margin", "ebitda_margin",
                       "fcf_margin", "roa", "roe", "roce"}
        ratio_metrics = {"pe_ratio", "pb_ratio", "ev_ebitda", "ev_revenue", "peg_ratio",
                         "current_ratio", "quick_ratio", "debt_equity"}
        if metric_name in pct_metrics:
            return "%"
        if metric_name in ratio_metrics:
            return "x"
        return "USD M"

    # ── Cache ──────────────────────────────────────────────────────────────────

    async def _load_cache(self, key: str) -> MetricSeries | None:
        if not self.redis:
            return None
        try:
            raw = await self.redis.get(f"{_CACHE_PREFIX}{key}")
            if raw:
                data = json.loads(raw)
                return self._deserialize_series(data)
        except Exception:
            pass
        return None

    async def _store_cache(self, key: str, series: MetricSeries) -> None:
        if not self.redis:
            return
        try:
            data = self._serialize_series(series)
            await self.redis.setex(f"{_CACHE_PREFIX}{key}", _CACHE_TTL, json.dumps(data))
        except Exception:
            pass

    def _serialize_series(self, series: MetricSeries) -> dict:
        return {
            "ticker": series.ticker,
            "metric_name": series.metric_name,
            "display_name": series.display_name,
            "unit": series.unit,
            "mean": series.mean,
            "std_dev": series.std_dev,
            "cagr": series.cagr,
            "trend_direction": series.trend_direction,
            "trend_confidence": series.trend_confidence,
            "data_points": [
                {
                    "period": dp.period,
                    "value": dp.value,
                    "unit": dp.unit,
                    "is_guidance": dp.is_guidance,
                    "yoy_change": dp.yoy_change,
                    "qoq_change": dp.qoq_change,
                    "is_anomaly": dp.is_anomaly,
                    "anomaly_z_score": dp.anomaly_z_score,
                }
                for dp in series.data_points
            ],
        }

    def _deserialize_series(self, data: dict) -> MetricSeries:
        series = MetricSeries(
            ticker=data["ticker"],
            metric_name=data["metric_name"],
            display_name=data["display_name"],
            unit=data["unit"],
            mean=data.get("mean"),
            std_dev=data.get("std_dev"),
            cagr=data.get("cagr"),
            trend_direction=data.get("trend_direction", ""),
            trend_confidence=data.get("trend_confidence", 0.0),
        )
        for dp_data in data.get("data_points", []):
            series.data_points.append(PeriodDataPoint(
                period=dp_data["period"],
                value=dp_data.get("value"),
                unit=dp_data.get("unit", ""),
                is_guidance=dp_data.get("is_guidance", False),
                yoy_change=dp_data.get("yoy_change"),
                qoq_change=dp_data.get("qoq_change"),
                is_anomaly=dp_data.get("is_anomaly", False),
                anomaly_z_score=dp_data.get("anomaly_z_score"),
            ))
        return series
