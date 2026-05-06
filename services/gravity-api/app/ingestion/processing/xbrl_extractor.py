"""
Gravity Search — XBRL / iXBRL Extractor
Parses XBRL and inline XBRL (iXBRL) from SEC EDGAR filings to extract
machine-readable financial facts with full taxonomy context.

Why XBRL matters for FinanceBench:
  - SEC mandates XBRL for all financial statement line items
  - XBRL tags carry the *exact* GAAP concept (us-gaap:Revenues, not "Revenue")
  - Eliminates parsing ambiguity: "$391,035M" is definitively Total Revenues
  - Provides period context (instant vs duration), entity CIK, decimals precision
  - Expected ~15% improvement on FinanceBench numeric questions

Two extraction modes:
  iXBRL  — inline XBRL embedded in the HTML filing (most modern 10-K/10-Q)
           Uses BeautifulSoup to find ix:nonNumeric / ix:nonFraction tags
  XBRL   — standalone .xml instance document
           Uses xml.etree.ElementTree to parse <context> + <fact> elements

Output: list[XBRLFact] objects, each carrying:
  concept, value, unit, period_start, period_end (or instant), decimals,
  context_id, entity_name, entity_cik, label

Integration point:
    pipeline.ingest_bytes()
      → document_processor.process()
      → xbrl_extractor.extract_from_html(html_text) OR extract_from_xml(xml_text)
      → XBRLFact list → table_indexer.index_xbrl_facts()
"""

from __future__ import annotations

import re
import structlog
from dataclasses import dataclass, field
from typing import Any
from xml.etree import ElementTree as ET

logger = structlog.get_logger()

# XBRL namespaces used in SEC filings
_NS = {
    "ix": "http://www.xbrl.org/2013/inlineXBRL",
    "xbrli": "http://www.xbrl.org/2003/instance",
    "dei": "http://xbrl.sec.gov/dei/2023",
    "us-gaap": "http://fasb.org/us-gaap/2023",
    "link": "http://www.xbrl.org/2003/linkbase",
    "xlink": "http://www.w3.org/1999/xlink",
}

# US-GAAP concepts that map to our FinancialRow model (metric name → XBRL concept)
_GAAP_CONCEPT_MAP: dict[str, str] = {
    "revenue": "Revenues",
    "net_income": "NetIncomeLoss",
    "gross_profit": "GrossProfit",
    "operating_income": "OperatingIncomeLoss",
    "ebitda": "EarningsBeforeInterestTaxesDepreciationAndAmortization",
    "total_assets": "Assets",
    "total_liabilities": "Liabilities",
    "stockholders_equity": "StockholdersEquity",
    "cash": "CashAndCashEquivalentsAtCarryingValue",
    "long_term_debt": "LongTermDebt",
    "eps_basic": "EarningsPerShareBasic",
    "eps_diluted": "EarningsPerShareDiluted",
    "shares_outstanding": "CommonStockSharesOutstanding",
    "capex": "PaymentsToAcquirePropertyPlantAndEquipment",
    "operating_cash_flow": "NetCashProvidedByUsedInOperatingActivities",
    "free_cash_flow": "FreeCashFlow",
    "research_and_development": "ResearchAndDevelopmentExpense",
    "selling_general_administrative": "SellingGeneralAndAdministrativeExpense",
    "cost_of_revenue": "CostOfRevenue",
    "income_tax": "IncomeTaxExpenseBenefit",
}

# Reverse map: XBRL local-name → friendly metric name
_XBRL_TO_METRIC: dict[str, str] = {v: k for k, v in _GAAP_CONCEPT_MAP.items()}

# Scale multipliers by XBRL decimals attribute
_SCALE_MAP = {
    "-6": ("M", 1_000_000),
    "-3": ("K", 1_000),
    "0": ("", 1),
    "2": ("", 0.01),   # percentage
}

# iXBRL numeric tag names
_IX_NUMERIC_TAGS = frozenset(["ix:nonfraction", "ix:nonfraction"])

# Period pattern for matching year/quarter strings
_PERIOD_RE = re.compile(
    r"(?:FY|Q[1-4])?\s*20\d{2}(?:\s*[-–]\s*(?:FY|Q[1-4])?\s*20\d{2})?",
    re.IGNORECASE,
)


@dataclass
class XBRLContext:
    """Represents a single <context> element from an XBRL instance document."""
    context_id: str
    entity_cik: str = ""
    entity_name: str = ""
    period_type: str = "duration"  # "duration" or "instant"
    period_start: str = ""
    period_end: str = ""
    instant: str = ""
    segment_label: str = ""  # For segment-level contexts (e.g., "North America")


@dataclass
class XBRLFact:
    """A single XBRL financial fact, ready for indexing."""
    concept: str             # Full qualified name, e.g. "us-gaap:Revenues"
    local_name: str          # Just the local part, e.g. "Revenues"
    metric_name: str         # Friendly name, e.g. "revenue"
    value: float | None      # Parsed numeric value (in native units)
    value_str: str           # Original string value
    unit: str                # "USD", "shares", "pure", etc.
    scale_suffix: str        # "M", "K", or ""
    decimals: str            # Raw XBRL decimals attribute ("-6", "-3", "0", etc.)
    period_start: str        # ISO date or ""
    period_end: str          # ISO date (end of duration or instant)
    period_label: str        # Human-readable: "FY2024", "Q3 2024", "2024-09-28"
    context_id: str
    entity_cik: str
    entity_name: str
    segment_label: str = ""

    def to_sentence(self, ticker: str = "", company: str = "") -> str:
        """Convert to a natural-language sentence suitable for embedding."""
        who = company or ticker or self.entity_name or "Unknown"
        period = self.period_label or self.period_end
        scale_str = self.scale_suffix
        if self.unit == "USD":
            val_str = f"${self.value:,.1f}{scale_str}" if self.value is not None else self.value_str
        elif self.unit in ("shares",):
            val_str = f"{self.value:,.0f}{scale_str} shares" if self.value is not None else self.value_str
        else:
            val_str = self.value_str
        label = self.metric_name.replace("_", " ").title()
        return f"{who} {period} {label} [{self.local_name}]: {val_str}"


class XBRLExtractor:
    """
    Extracts XBRL financial facts from SEC EDGAR filings.

    Supports:
      - iXBRL (inline) from 10-K/10-Q HTML filings
      - Standalone XBRL XML instance documents

    Usage:
        extractor = XBRLExtractor()
        facts = extractor.extract_from_html(html_content)
        # or
        facts = extractor.extract_from_xml(xml_content)
    """

    def extract_from_html(self, html_content: str, entity_name: str = "", entity_cik: str = "") -> list[XBRLFact]:
        """
        Extract facts from an iXBRL-embedded HTML filing.
        Searches for ix:nonFraction tags and maps them to XBRLFact objects.
        """
        try:
            from bs4 import BeautifulSoup
        except ImportError:
            logger.warning("xbrl_bs4_not_available", hint="pip install beautifulsoup4")
            return []

        try:
            soup = BeautifulSoup(html_content, "lxml")
        except Exception:
            soup = BeautifulSoup(html_content, "html.parser")

        facts: list[XBRLFact] = []
        seen_context_values: dict[str, str] = {}

        # Find all ix:nonFraction elements (numeric XBRL facts)
        numeric_tags = soup.find_all(["ix:nonfraction", "ix:nonFraction"])
        if not numeric_tags:
            # Try case-insensitive variant
            numeric_tags = [t for t in soup.find_all(True) if t.name and t.name.lower() in ("ix:nonfraction",)]

        for tag in numeric_tags:
            try:
                fact = self._parse_ix_tag(tag, entity_name, entity_cik, seen_context_values)
                if fact is not None:
                    facts.append(fact)
            except Exception as e:
                logger.debug("xbrl_tag_parse_failed", error=str(e))

        logger.info(
            "xbrl_ixbrl_extracted",
            entity=entity_name,
            facts_count=len(facts),
            html_size_kb=len(html_content) // 1024,
        )
        return facts

    def _parse_ix_tag(
        self,
        tag: Any,
        entity_name: str,
        entity_cik: str,
        seen: dict[str, str],
    ) -> XBRLFact | None:
        """Parse a single ix:nonFraction tag into an XBRLFact."""
        name_attr = tag.get("name", "")
        if not name_attr:
            return None

        # Parse concept: "us-gaap:Revenues" → namespace="us-gaap", local="Revenues"
        if ":" in name_attr:
            ns_prefix, local_name = name_attr.split(":", 1)
        else:
            ns_prefix, local_name = "", name_attr

        metric_name = _XBRL_TO_METRIC.get(local_name, "")
        if not metric_name:
            return None  # Skip non-financial or unmapped concepts

        raw_value = tag.get_text(strip=True).replace(",", "").replace("(", "-").replace(")", "")
        decimals = tag.get("decimals", "0")
        unit_ref = tag.get("unitref", tag.get("unitRef", "USD"))
        context_ref = tag.get("contextref", tag.get("contextRef", ""))
        scale = tag.get("scale", "")
        format_attr = tag.get("format", "")

        # Resolve scale from iXBRL scale attribute or decimals
        value, scale_suffix = self._parse_value(raw_value, decimals, scale)

        # Determine period from context ref (stored as a simple label in iXBRL)
        period_label = self._infer_period_from_context_ref(context_ref)

        unit = self._normalize_unit(unit_ref)

        return XBRLFact(
            concept=name_attr,
            local_name=local_name,
            metric_name=metric_name,
            value=value,
            value_str=raw_value,
            unit=unit,
            scale_suffix=scale_suffix,
            decimals=decimals,
            period_start="",
            period_end="",
            period_label=period_label,
            context_id=context_ref,
            entity_cik=entity_cik,
            entity_name=entity_name,
            segment_label="",
        )

    def extract_from_xml(self, xml_content: str, entity_name: str = "", entity_cik: str = "") -> list[XBRLFact]:
        """
        Extract facts from a standalone XBRL XML instance document.
        Parses <context> elements for period/entity info, then matches facts.
        """
        try:
            root = ET.fromstring(xml_content)
        except ET.ParseError as e:
            logger.warning("xbrl_xml_parse_failed", error=str(e))
            return []

        # Build context map from <xbrli:context> elements
        contexts: dict[str, XBRLContext] = {}
        for ctx_el in root.iter("{http://www.xbrl.org/2003/instance}context"):
            ctx = self._parse_context_element(ctx_el)
            if ctx:
                contexts[ctx.context_id] = ctx

        # Extract entity info from first context if not provided
        if not entity_name or not entity_cik:
            for ctx in contexts.values():
                entity_name = entity_name or ctx.entity_name
                entity_cik = entity_cik or ctx.entity_cik
                if entity_name and entity_cik:
                    break

        facts: list[XBRLFact] = []

        # Iterate over all child elements of root to find financial facts
        for elem in root:
            tag = elem.tag
            if tag.startswith("{"):
                ns_uri, local_name = tag[1:].split("}", 1)
            else:
                ns_uri, local_name = "", tag

            # Skip structural elements
            if local_name in ("context", "unit", "schemaRef"):
                continue
            if ns_uri in ("http://www.xbrl.org/2003/instance", "http://www.xbrl.org/2003/linkbase"):
                continue

            metric_name = _XBRL_TO_METRIC.get(local_name, "")
            if not metric_name:
                continue

            context_ref = elem.get("contextRef", "")
            decimals = elem.get("decimals", "0")
            unit_ref = elem.get("unitRef", "USD")
            raw_value = (elem.text or "").strip().replace(",", "")

            if not raw_value:
                continue

            ctx = contexts.get(context_ref, XBRLContext(context_id=context_ref))
            value, scale_suffix = self._parse_value(raw_value, decimals, "")
            period_label = self._build_period_label(ctx)
            unit = self._normalize_unit(unit_ref)

            ns_prefix = self._uri_to_prefix(ns_uri)
            concept = f"{ns_prefix}:{local_name}" if ns_prefix else local_name

            facts.append(XBRLFact(
                concept=concept,
                local_name=local_name,
                metric_name=metric_name,
                value=value,
                value_str=raw_value,
                unit=unit,
                scale_suffix=scale_suffix,
                decimals=decimals,
                period_start=ctx.period_start,
                period_end=ctx.period_end or ctx.instant,
                period_label=period_label,
                context_id=context_ref,
                entity_cik=ctx.entity_cik or entity_cik,
                entity_name=ctx.entity_name or entity_name,
                segment_label=ctx.segment_label,
            ))

        logger.info(
            "xbrl_xml_extracted",
            entity=entity_name,
            facts_count=len(facts),
            contexts_parsed=len(contexts),
        )
        return facts

    def _parse_context_element(self, ctx_el: ET.Element) -> XBRLContext | None:
        """Parse an xbrli:context element."""
        ctx_id = ctx_el.get("id", "")
        if not ctx_id:
            return None

        ctx = XBRLContext(context_id=ctx_id)

        # Entity
        entity_el = ctx_el.find("{http://www.xbrl.org/2003/instance}entity")
        if entity_el is not None:
            id_el = entity_el.find("{http://www.xbrl.org/2003/instance}identifier")
            if id_el is not None:
                ctx.entity_cik = (id_el.text or "").strip()
            seg_el = entity_el.find("{http://www.xbrl.org/2003/instance}segment")
            if seg_el is not None:
                # Extract segment label from xbrldi:explicitMember
                for member in seg_el.iter():
                    text = (member.text or "").strip()
                    if text and "Member" not in text:
                        ctx.segment_label = text
                        break

        # Period
        period_el = ctx_el.find("{http://www.xbrl.org/2003/instance}period")
        if period_el is not None:
            instant_el = period_el.find("{http://www.xbrl.org/2003/instance}instant")
            start_el = period_el.find("{http://www.xbrl.org/2003/instance}startDate")
            end_el = period_el.find("{http://www.xbrl.org/2003/instance}endDate")

            if instant_el is not None:
                ctx.period_type = "instant"
                ctx.instant = (instant_el.text or "").strip()
            elif start_el is not None and end_el is not None:
                ctx.period_type = "duration"
                ctx.period_start = (start_el.text or "").strip()
                ctx.period_end = (end_el.text or "").strip()

        return ctx

    def _parse_value(self, raw: str, decimals: str, scale: str) -> tuple[float | None, str]:
        """Parse raw string value, apply scale, return (float, scale_suffix)."""
        try:
            val = float(raw.replace(",", ""))
        except (ValueError, TypeError):
            return None, ""

        # iXBRL explicit scale attribute (e.g., scale="6" means multiply by 10^6)
        if scale:
            try:
                val = val * (10 ** int(scale))
                scale_suffix = "M" if int(scale) >= 6 else ("K" if int(scale) >= 3 else "")
                return val, scale_suffix
            except (ValueError, TypeError):
                pass

        # Derive display scale from decimals (negative = millions/thousands in SEC filings)
        scale_str = str(decimals)
        if scale_str in _SCALE_MAP:
            suffix, multiplier = _SCALE_MAP[scale_str]
        else:
            suffix, multiplier = "", 1

        return val / multiplier if multiplier != 1 else val, suffix

    def _normalize_unit(self, unit_ref: str) -> str:
        """Normalize XBRL unit references."""
        if not unit_ref:
            return "USD"
        unit_ref_lower = unit_ref.lower()
        if "share" in unit_ref_lower:
            return "shares"
        if "pure" in unit_ref_lower:
            return "pure"
        return "USD"

    def _infer_period_from_context_ref(self, context_ref: str) -> str:
        """Infer a human-readable period label from a context ref string."""
        # Context refs like "FY2024", "Q3_2024", "D2024Q1", etc.
        if not context_ref:
            return ""
        # Try to extract a year pattern
        year_match = re.search(r"20\d{2}", context_ref)
        year = year_match.group(0) if year_match else ""
        quarter_match = re.search(r"Q([1-4])", context_ref, re.IGNORECASE)
        quarter = f"Q{quarter_match.group(1)}" if quarter_match else ""
        if quarter and year:
            return f"{quarter} {year}"
        if year:
            return f"FY{year}"
        return context_ref[:20]

    def _build_period_label(self, ctx: XBRLContext) -> str:
        """Build a human-readable period label from an XBRLContext."""
        if ctx.period_type == "instant":
            return ctx.instant
        if ctx.period_end:
            # Convert "2024-09-28" → "FY2024" or keep as-is
            year_match = re.search(r"(\d{4})", ctx.period_end)
            if year_match:
                year = year_match.group(1)
                # Duration of ~1 year → FY, duration of ~3 months → quarter
                if ctx.period_start:
                    try:
                        from datetime import date
                        start = date.fromisoformat(ctx.period_start)
                        end = date.fromisoformat(ctx.period_end)
                        days = (end - start).days
                        if days > 300:
                            return f"FY{year}"
                        # Approximate quarter
                        month = end.month
                        q = (month - 1) // 3 + 1
                        return f"Q{q} {year}"
                    except (ValueError, ImportError):
                        pass
                return year
            return ctx.period_end
        return ctx.instant or ""

    def _uri_to_prefix(self, uri: str) -> str:
        """Map namespace URI to a known prefix."""
        for prefix, ns_uri in _NS.items():
            if uri == ns_uri:
                return prefix
        if "fasb.org/us-gaap" in uri:
            return "us-gaap"
        if "xbrl.sec.gov/dei" in uri:
            return "dei"
        return ""
