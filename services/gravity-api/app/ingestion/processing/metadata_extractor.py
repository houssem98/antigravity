"""
Gravity Search — Document Metadata Extractor
Extracts ticker, company name, filing type, filing date, and fiscal period
from document text using regex patterns with optional LLM fallback.
"""

import re
import structlog
from datetime import date, datetime

from app.ingestion.processing.chunker import DocumentMetadata

logger = structlog.get_logger()

# ── Regex Patterns ─────────────────────────────────────────────────────────

FILING_TYPE_PATTERNS = {
    "10-K": re.compile(r"\bform\s+10-?k\b|\bannual\s+report\b", re.IGNORECASE),
    "10-Q": re.compile(r"\bform\s+10-?q\b|\bquarterly\s+report\b", re.IGNORECASE),
    "8-K": re.compile(r"\bform\s+8-?k\b|\bcurrent\s+report\b", re.IGNORECASE),
    "DEF 14A": re.compile(r"\bdef\s+14a\b|\bproxy\s+statement\b", re.IGNORECASE),
    "S-1": re.compile(r"\bform\s+s-?1\b|\bregistration\s+statement\b", re.IGNORECASE),
    "earnings_transcript": re.compile(
        r"\bearnings\s+(?:conference\s+)?call\b|\btranscript\b", re.IGNORECASE
    ),
}

# Ticker in parentheses: "Apple Inc. (AAPL)" or "Ticker: AAPL"
TICKER_PATTERN = re.compile(
    r"(?:\((?:Nasdaq|NYSE|NASDAQ|NYSE Arca|OTC):\s*([A-Z]{1,5})\)|"
    r"Ticker(?:\s+Symbol)?:\s*([A-Z]{1,5})|"
    r"\(([A-Z]{1,5})\))",
    re.IGNORECASE,
)

# Date patterns: "October 30, 2025", "2025-10-30", "10/30/2025"
DATE_PATTERNS = [
    re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b"),
    re.compile(r"\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b", re.IGNORECASE),
    re.compile(r"\b(\d{1,2})/(\d{1,2})/(\d{4})\b"),
]

FISCAL_YEAR_PATTERN = re.compile(r"\bfiscal\s+year\s+(\d{4})\b|\bfy\s*(\d{4})\b", re.IGNORECASE)
FISCAL_QUARTER_PATTERN = re.compile(r"\b(?:first|second|third|fourth|q[1-4])\s+quarter\b|\bq([1-4])\s+(?:fy)?\s*(\d{4})\b", re.IGNORECASE)

MONTH_MAP = {
    "january": 1, "february": 2, "march": 3, "april": 4,
    "may": 5, "june": 6, "july": 7, "august": 8,
    "september": 9, "october": 10, "november": 11, "december": 12,
}


class MetadataExtractor:
    """
    Extracts structured metadata from document text.

    Two-tier approach:
    1. Fast regex patterns (no API call)
    2. Optional LLM fallback via Gemini Flash for ambiguous documents
    """

    def __init__(self, llm_client=None):
        self.llm = llm_client  # Optional: GoogleClient for fallback

    async def extract(
        self,
        text: str,
        filename: str = "",
        document_id: str = "",
    ) -> DocumentMetadata:
        """
        Extract metadata from document text.

        Returns DocumentMetadata compatible with HierarchicalChunker.
        """
        # Use first 5000 chars for pattern matching (headers contain metadata)
        sample = text[:5000]

        ticker = self._extract_ticker(sample)
        filing_type = self._extract_filing_type(sample, filename)
        filing_date = self._extract_date(sample)
        fiscal_year = self._extract_fiscal_year(sample)
        fiscal_quarter = self._extract_fiscal_quarter(sample)
        company_name = self._extract_company_name(sample, ticker)

        # LLM fallback for ambiguous documents (no ticker found)
        if not ticker and self.llm:
            try:
                ticker, company_name, filing_type = await self._llm_extract(sample[:2000])
            except Exception as e:
                logger.warning("metadata_llm_fallback_failed", error=str(e))

        doc_id = document_id or f"doc_{ticker}_{filing_date}".replace(" ", "_")

        metadata = DocumentMetadata(
            document_id=doc_id,
            ticker=ticker,
            company_name=company_name,
            filing_type=filing_type,
            filing_date=filing_date,
            fiscal_year=fiscal_year,
            fiscal_quarter=fiscal_quarter,
        )

        logger.info(
            "metadata_extracted",
            ticker=ticker,
            filing_type=filing_type,
            filing_date=filing_date,
        )
        return metadata

    def _extract_ticker(self, text: str) -> str:
        match = TICKER_PATTERN.search(text)
        if match:
            for group in match.groups():
                if group and group.isupper() and 1 <= len(group) <= 5:
                    return group
        return ""

    def _extract_filing_type(self, text: str, filename: str = "") -> str:
        combined = filename + " " + text
        for filing_type, pattern in FILING_TYPE_PATTERNS.items():
            if pattern.search(combined):
                return filing_type
        return "document"

    def _extract_date(self, text: str) -> str:
        """Best-effort filing date from document text.

        Collects every date-like match and returns the latest one that is
        *plausible* as a filing date — within the EDGAR era and on or before
        today. This rejects future dates lifted from the body (lease terms,
        debt maturities, contract end dates) that previously produced
        impossible filing_dates like 2031-12-31.
        """
        today = date.today()
        floor = date(1994, 1, 1)  # EDGAR full-text era
        candidates: list[date] = []

        for m in DATE_PATTERNS[0].finditer(text):  # YYYY-MM-DD
            try:
                candidates.append(date(int(m.group(1)), int(m.group(2)), int(m.group(3))))
            except ValueError:
                pass
        for m in DATE_PATTERNS[1].finditer(text):  # Month DD, YYYY
            month = MONTH_MAP.get(m.group(1).lower(), 0)
            try:
                candidates.append(date(int(m.group(3)), month, int(m.group(2))))
            except ValueError:
                pass
        for m in DATE_PATTERNS[2].finditer(text):  # MM/DD/YYYY
            try:
                candidates.append(date(int(m.group(3)), int(m.group(1)), int(m.group(2))))
            except ValueError:
                pass

        plausible = [d for d in candidates if floor <= d <= today]
        if plausible:
            return max(plausible).isoformat()
        return today.isoformat()

    def _extract_fiscal_year(self, text: str) -> str:
        m = FISCAL_YEAR_PATTERN.search(text)
        if m:
            return m.group(1) or m.group(2) or ""
        return ""

    def _extract_fiscal_quarter(self, text: str) -> str:
        m = FISCAL_QUARTER_PATTERN.search(text)
        if m:
            q_map = {"first": "Q1", "second": "Q2", "third": "Q3", "fourth": "Q4"}
            if m.group(1):
                return f"Q{m.group(1)}"
            for word, qtr in q_map.items():
                if word in (m.group(0) or "").lower():
                    return qtr
        return ""

    def _extract_company_name(self, text: str, ticker: str) -> str:
        # Look for "Company Name (TICKER)" pattern
        if ticker:
            pattern = re.compile(
                rf"([A-Z][A-Za-z\s,\.&]+?)\s*\(\s*(?:Nasdaq|NYSE|NASDAQ)?:?\s*{re.escape(ticker)}\s*\)",
                re.IGNORECASE,
            )
            m = pattern.search(text)
            if m:
                return m.group(1).strip()
        return ""

    async def _llm_extract(self, text: str) -> tuple[str, str, str]:
        """Use Gemini Flash to extract ticker, company name, and filing type."""
        from app.llm.base import LLMConfig, LLMMessage
        import json

        prompt = f"""Extract from this financial document text:
1. ticker_symbol (e.g., AAPL, MSFT) or empty string
2. company_name (full legal name) or empty string
3. filing_type (10-K, 10-Q, 8-K, earnings_transcript, or document)

Respond ONLY with JSON: {{"ticker": "...", "company_name": "...", "filing_type": "..."}}

Text:
{text[:1500]}"""

        response = await self.llm.generate(
            messages=[LLMMessage(role="user", content=prompt)],
            config=LLMConfig(temperature=0.0, max_tokens=100, json_mode=True),
        )
        data = json.loads(response.content)
        return (
            data.get("ticker", ""),
            data.get("company_name", ""),
            data.get("filing_type", "document"),
        )
