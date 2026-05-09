"""
Gravity Search — Daloopa-style KPI Extractor

Extracts segment-level and per-unit KPIs from SEC 10-K/10-Q filings:
  - Revenue by segment (Cloud, Hardware, Services, etc.)
  - Units / subscribers / MAU / DAU
  - ASP (average selling price)
  - Gross margin by segment
  - Operating income by segment
  - Key operating metrics (retention, churn, NRR, ARPU, etc.)

Every extracted value is hyperlinked to its source passage (Daloopa-style)
via a (passage_id, page, section) triple so analysts can verify.

Architecture:
  1. RetrievalStep   — fetch relevant passages from Qdrant (KPI-targeted queries)
  2. ExtractionStep  — LLM structured extraction with JSON schema
  3. NormalizationStep — unit canonicalization + scale resolution
  4. DeduplicationStep — merge overlapping extractions, keep highest-confidence
"""

from __future__ import annotations

import re
import json
import asyncio
from dataclasses import dataclass, field, asdict
from typing import Optional
import structlog

logger = structlog.get_logger()

# ─── Data model ───────────────────────────────────────────────────────────────

@dataclass
class KPIValue:
    metric: str           # canonical metric name (e.g. "revenue_cloud")
    label: str            # display label (e.g. "Cloud Revenue")
    value: float
    unit: str             # "USD_millions" | "USD_billions" | "units_thousands" | "percent" | "ratio" | "count"
    period: str           # "Q3 2024" | "FY2023" | "TTM"
    segment: str          # "Cloud" | "Hardware" | "Services" | "Total" | ...
    confidence: float     # 0–1
    # Provenance
    passage_id: str = ""
    section: str = ""     # "MD&A" | "Segment Results" | "Consolidated Statements"
    filing_type: str = "" # "10-K" | "10-Q" | "8-K"
    filing_date: str = ""
    raw_text: str = ""    # the sentence the value was extracted from


@dataclass
class KPITable:
    ticker: str
    company_name: str
    extracted_at: str
    kpis: list[KPIValue] = field(default_factory=list)
    extraction_model: str = ""
    passages_scanned: int = 0
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)

    def by_segment(self) -> dict[str, list[KPIValue]]:
        out: dict[str, list[KPIValue]] = {}
        for k in self.kpis:
            out.setdefault(k.segment, []).append(k)
        return out

    def by_metric(self) -> dict[str, list[KPIValue]]:
        out: dict[str, list[KPIValue]] = {}
        for k in self.kpis:
            out.setdefault(k.metric, []).append(k)
        return out

    def format_for_prompt(self, max_kpis: int = 30) -> str:
        """Format KPI table as markdown for LLM injection."""
        if not self.kpis:
            return ""
        lines = [f"## {self.company_name} ({self.ticker}) — Extracted KPIs\n"]
        shown = self.kpis[:max_kpis]
        for k in shown:
            lines.append(
                f"- **{k.label}** ({k.segment}, {k.period}): "
                f"{_fmt_value(k.value, k.unit)} [conf={k.confidence:.0%}]"
            )
        if len(self.kpis) > max_kpis:
            lines.append(f"_...and {len(self.kpis) - max_kpis} more KPIs_")
        return "\n".join(lines)


# ─── Unit normalization ───────────────────────────────────────────────────────

_SCALE = {
    "trillion": 1_000_000,  # → millions
    "trillions": 1_000_000,
    "billion": 1_000,       # → millions
    "billions": 1_000,
    "million": 1,
    "millions": 1,
    "thousand": 0.001,      # → millions (rare for revenue)
    "thousands": 0.001,
}

_UNIT_ALIASES = {
    "usd": "USD_millions",
    "dollar": "USD_millions",
    "dollars": "USD_millions",
    "%": "percent",
    "percent": "percent",
    "percentage": "percent",
    "units": "units_thousands",
    "subscribers": "count",
    "users": "count",
    "mau": "count",
    "dau": "count",
    "x": "ratio",
    "times": "ratio",
}

def _normalize_unit(raw: str) -> str:
    raw = raw.strip().lower()
    return _UNIT_ALIASES.get(raw, raw or "unknown")

def _apply_scale(value: float, scale_word: str) -> tuple[float, str]:
    """Convert a raw value + scale word to millions + canonical unit."""
    multiplier = _SCALE.get(scale_word.lower(), 1.0)
    return value * multiplier, "USD_millions"

def _fmt_value(value: float, unit: str) -> str:
    if unit == "USD_millions":
        if value >= 1000:
            return f"${value/1000:.1f}B"
        return f"${value:.0f}M"
    if unit == "percent":
        return f"{value:.1f}%"
    if unit == "ratio":
        return f"{value:.2f}x"
    if unit == "count":
        return f"{value:,.0f}"
    return f"{value:,.2f} {unit}"


# ─── Extraction prompt ────────────────────────────────────────────────────────

_EXTRACTION_PROMPT = """You are a financial data extraction engine. Extract ALL numeric KPIs from the passage below.

For each value, output a JSON object with:
- metric: snake_case canonical name (e.g. "revenue_cloud", "gross_margin_services", "subscribers_total")
- label: human-readable label (e.g. "Cloud Revenue", "Services Gross Margin")
- value: the numeric value as a float
- unit: one of "USD_millions" | "USD_billions" | "percent" | "count" | "ratio" | "units_thousands" | "other"
- period: the time period (e.g. "Q3 2024", "FY2023", "TTM")
- segment: business segment (e.g. "Cloud", "Hardware", "Services", "Total", "Advertising")
- confidence: 0.0–1.0 (1.0 = explicit number in text; 0.7 = derived/implied)

Rules:
- Extract revenue, gross profit, operating income, margins, units sold, subscribers, MAU/DAU, ARPU, ASP, NRR, churn, retention
- Segment-level values are more valuable than totals — extract both
- If a value mentions "billion" or "million", normalize to the right unit field
- If a period is not stated, use "unspecified"
- If a segment is not stated, use "Total"
- Do NOT invent values — only extract what is explicitly stated

Return a JSON array. Example:
[
  {{"metric": "revenue_cloud", "label": "Cloud Revenue", "value": 24.1, "unit": "USD_billions", "period": "Q3 2024", "segment": "Cloud", "confidence": 1.0}},
  {{"metric": "operating_margin_total", "label": "Operating Margin", "value": 28.5, "unit": "percent", "period": "Q3 2024", "segment": "Total", "confidence": 1.0}}
]

PASSAGE (filing: {filing_type}, section: {section}):
{passage_text}

Return ONLY the JSON array, no explanation."""


# ─── KPI Extractor ────────────────────────────────────────────────────────────

class KPIExtractor:
    """
    Extracts segment-level KPIs from SEC filing passages.

    Usage:
        extractor = KPIExtractor(llm_client=fast_client)
        table = await extractor.extract(ticker="AAPL", passages=[...])
        print(table.format_for_prompt())
    """

    # Sections most likely to contain KPI tables
    _KPI_SECTION_KEYWORDS = [
        "segment", "revenue", "operating income", "gross profit", "margin",
        "subscribers", "users", "units sold", "average selling price", "arpu",
        "net revenue retention", "churn", "active", "kpi", "key metrics",
        "results of operations", "management's discussion",
    ]

    def __init__(self, llm_client=None, model: str = ""):
        self._client = llm_client
        self._model = model

    async def extract(
        self,
        ticker: str,
        passages: list[dict],
        company_name: str = "",
        max_passages: int = 20,
    ) -> KPITable:
        """
        Extract KPIs from a list of passage dicts.

        Passage dict shape: {id, text, metadata: {section, filing_type, filing_date, ...}}
        """
        from datetime import datetime, timezone

        table = KPITable(
            ticker=ticker,
            company_name=company_name or ticker,
            extracted_at=datetime.now(timezone.utc).isoformat(),
            extraction_model=self._model or "rule_based",
        )

        # Filter to KPI-relevant passages
        relevant = _filter_kpi_passages(passages, max_passages)
        table.passages_scanned = len(relevant)

        if not relevant:
            table.warnings.append("no_kpi_passages_found")
            return table

        if self._client is None:
            # Rule-based extraction only (no LLM)
            for p in relevant:
                kpis = _regex_extract(p)
                table.kpis.extend(kpis)
        else:
            # LLM extraction in parallel (max 5 concurrent)
            sem = asyncio.Semaphore(5)
            results = await asyncio.gather(
                *[self._extract_passage(p, sem) for p in relevant],
                return_exceptions=True,
            )
            for r in results:
                if isinstance(r, list):
                    table.kpis.extend(r)
                elif isinstance(r, Exception):
                    table.warnings.append(f"extraction_error: {r}")

        # Deduplicate: keep highest-confidence per (metric, segment, period)
        table.kpis = _deduplicate(table.kpis)
        # Sort: by period desc, then confidence desc
        table.kpis.sort(key=lambda k: (k.period, -k.confidence), reverse=True)

        logger.info(
            "kpi_extracted",
            ticker=ticker,
            passages=table.passages_scanned,
            kpis=len(table.kpis),
        )
        return table

    async def _extract_passage(
        self, passage: dict, sem: asyncio.Semaphore
    ) -> list[KPIValue]:
        async with sem:
            meta = passage.get("metadata", {})
            prompt = _EXTRACTION_PROMPT.format(
                filing_type=meta.get("filing_type", "SEC"),
                section=meta.get("section", "unknown"),
                passage_text=passage.get("text", "")[:4000],
            )
            try:
                response = await self._client.complete(prompt, max_tokens=2048)
                raw_json = _extract_json_array(response)
                if not raw_json:
                    return _regex_extract(passage)

                items = json.loads(raw_json)
                kpis = []
                for item in items:
                    try:
                        kpis.append(KPIValue(
                            metric=item.get("metric", ""),
                            label=item.get("label", ""),
                            value=float(item.get("value", 0)),
                            unit=_normalize_unit(item.get("unit", "")),
                            period=item.get("period", "unspecified"),
                            segment=item.get("segment", "Total"),
                            confidence=float(item.get("confidence", 0.8)),
                            passage_id=passage.get("id", ""),
                            section=meta.get("section", ""),
                            filing_type=meta.get("filing_type", ""),
                            filing_date=meta.get("filing_date", ""),
                            raw_text=passage.get("text", "")[:200],
                        ))
                    except (ValueError, KeyError):
                        continue
                return kpis
            except Exception as e:
                logger.debug("kpi_llm_failed", error=str(e))
                return _regex_extract(passage)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _filter_kpi_passages(passages: list[dict], max_n: int) -> list[dict]:
    """Score passages by KPI-keyword density; keep top N."""
    keywords = KPIExtractor._KPI_SECTION_KEYWORDS

    def _score(p: dict) -> float:
        text = (p.get("text", "") + " " + p.get("metadata", {}).get("section", "")).lower()
        return sum(1 for kw in keywords if kw in text)

    scored = sorted(passages, key=_score, reverse=True)
    # Keep only passages with at least one keyword hit
    return [p for p in scored[:max_n] if _score(p) > 0]


_NUMERIC_RE = re.compile(
    r"(?P<label>[A-Za-z][A-Za-z\s/&]+?)\s+"
    r"(?:of\s+)?\$?(?P<value>[\d,]+(?:\.\d+)?)\s*"
    r"(?P<scale>trillion|billion|million|thousand)?\s*"
    r"(?P<unit>dollars?|usd|%|percent)?\s*"
    r"(?:for\s+(?P<period>Q[1-4]\s+\d{4}|FY\s?\d{4}|\d{4}))?",
    re.IGNORECASE,
)

def _regex_extract(passage: dict) -> list[KPIValue]:
    """Fallback regex extraction — lower confidence than LLM."""
    text = passage.get("text", "")
    meta = passage.get("metadata", {})
    kpis = []

    # Simple pattern: "$X.X billion" or "X% margin" or "X million units"
    for m in re.finditer(
        r"\$?([\d,]+(?:\.\d+)?)\s*(trillion|billion|million|thousand|%|percent)?\s*"
        r"(?:in\s+)?([A-Za-z][A-Za-z\s]{2,30}?)(?:\s+(?:revenue|income|margin|units|subscribers|users))?",
        text, re.IGNORECASE,
    ):
        try:
            raw_val = float(m.group(1).replace(",", ""))
            scale = m.group(2) or ""
            label_hint = m.group(3).strip()
            if not label_hint or raw_val == 0:
                continue
            val, unit = _apply_scale(raw_val, scale) if scale in _SCALE else (raw_val, _normalize_unit(scale))
            kpis.append(KPIValue(
                metric=re.sub(r"\s+", "_", label_hint.lower()),
                label=label_hint.title(),
                value=val,
                unit=unit,
                period=meta.get("period", "unspecified"),
                segment="Total",
                confidence=0.5,
                passage_id=passage.get("id", ""),
                section=meta.get("section", ""),
                filing_type=meta.get("filing_type", ""),
                filing_date=meta.get("filing_date", ""),
                raw_text=text[:200],
            ))
        except (ValueError, IndexError):
            continue

    return kpis[:10]  # cap regex results per passage


def _extract_json_array(text: str) -> Optional[str]:
    """Extract the first JSON array from LLM output."""
    m = re.search(r"\[[\s\S]*?\]", text)
    return m.group(0) if m else None


def _deduplicate(kpis: list[KPIValue]) -> list[KPIValue]:
    """Keep highest-confidence value per (metric, segment, period) triple."""
    best: dict[tuple, KPIValue] = {}
    for k in kpis:
        key = (k.metric, k.segment.lower(), k.period)
        if key not in best or k.confidence > best[key].confidence:
            best[key] = k
    return list(best.values())
