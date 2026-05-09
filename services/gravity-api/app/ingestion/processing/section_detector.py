"""
Gravity Search — SEC Filing Section Detector
Identifies standard 10-K/10-Q sections and earnings call segments
within document text. Returns a list of Section objects for the chunker.
"""

import re
import structlog

from app.ingestion.processing.chunker import Section

logger = structlog.get_logger()

# ── 10-K / 10-Q Standard Section Headers ──────────────────────────────────

SEC_10K_SECTIONS = {
    "item 1": "Business",
    "item 1a": "Risk Factors",
    "item 1b": "Unresolved Staff Comments",
    "item 2": "Properties",
    "item 3": "Legal Proceedings",
    "item 4": "Mine Safety Disclosures",
    "item 5": "Market for Registrant's Common Equity",
    "item 6": "Selected Financial Data",
    "item 7": "Management's Discussion and Analysis",
    "item 7a": "Quantitative and Qualitative Disclosures About Market Risk",
    "item 8": "Financial Statements and Supplementary Data",
    "item 9": "Changes in and Disagreements with Accountants",
    "item 9a": "Controls and Procedures",
    "item 10": "Directors, Executive Officers and Corporate Governance",
    "item 11": "Executive Compensation",
    "item 12": "Security Ownership",
    "item 13": "Certain Relationships and Related Transactions",
    "item 14": "Principal Accountant Fees and Services",
}

# Match "ITEM 1A", "Item 1A.", "ITEM 1A —", etc.
SEC_ITEM_PATTERN = re.compile(
    r"(?:^|\n)\s*(ITEM\s+\d+[A-Z]?\.?\s*(?:[-—]\s*)?[A-Z][A-Z\s,'&\-]{2,60})",
    re.IGNORECASE | re.MULTILINE,
)

# Capture the item number/letter alone (used to derive canonical item_id).
SEC_ITEM_NUMBER_RE = re.compile(r"ITEM\s+(\d+)([A-Z]?)", re.IGNORECASE)

# Footnote / Note references in financial statements:
#   "Note 1. Summary of Significant Accounting Policies"
#   "NOTE 7 — Income Taxes"
SEC_NOTE_PATTERN = re.compile(
    r"(?:^|\n)\s*(NOTE\s+\d+[A-Z]?\.?\s*(?:[-—]\s*)?[A-Z][A-Za-z0-9\s,'&\-]{2,80})",
    re.IGNORECASE | re.MULTILINE,
)
SEC_NOTE_NUMBER_RE = re.compile(r"NOTE\s+(\d+)([A-Z]?)", re.IGNORECASE)

# Earnings call section markers
EARNINGS_SECTION_PATTERNS = {
    "Prepared Remarks": re.compile(
        r"(?:prepared\s+remarks|operator\s+instructions|opening\s+remarks|company\s+overview)",
        re.IGNORECASE,
    ),
    "Q&A Session": re.compile(
        r"(?:question[\s-]and[\s-]answer|q&a\s+session|questions?\s+and\s+answers?|operator.*questions?)",
        re.IGNORECASE,
    ),
}


class SectionDetector:
    """
    Splits a document into named sections for hierarchical chunking.

    For SEC filings: detects Item headers (Item 1A, Item 7, etc.)
    For earnings calls: detects Prepared Remarks vs Q&A
    For unstructured: returns a single "Full Document" section
    """

    def detect_sections(
        self,
        text: str,
        filing_type: str = "",
    ) -> list[Section]:
        """
        Detect sections in document text.

        Args:
            text: Full document text
            filing_type: e.g., "10-K", "10-Q", "earnings_transcript"

        Returns:
            List of Section objects with name and text content.
        """
        ft = filing_type.lower()

        if "earnings_transcript" in ft or "transcript" in ft:
            sections = self._detect_earnings_sections(text)
        elif "10-k" in ft or "10-q" in ft or "8-k" in ft:
            sections = self._detect_sec_sections(text)
        else:
            # Try SEC detection first, fall back to full document
            sections = self._detect_sec_sections(text)
            if len(sections) <= 1:
                sections = [Section(name="Full Document", text=text)]

        if not sections:
            sections = [Section(name="Full Document", text=text)]

        logger.info(
            "sections_detected",
            filing_type=filing_type,
            count=len(sections),
            names=[s.name for s in sections[:5]],
        )
        return sections

    def _detect_sec_sections(self, text: str) -> list[Section]:
        """Detect SEC Item sections + Note refs in financial statements."""
        item_matches = list(SEC_ITEM_PATTERN.finditer(text))
        note_matches = list(SEC_NOTE_PATTERN.finditer(text))

        if not item_matches and not note_matches:
            return [Section(name="Full Document", text=text)]

        sections: list[Section] = []

        # ── Item sections ─────────────────────────────────────────────
        for i, match in enumerate(item_matches):
            start = match.start()
            end = item_matches[i + 1].start() if i + 1 < len(item_matches) else len(text)

            header_text = match.group(1).strip()
            # Normalize: "ITEM 1A. RISK FACTORS" / "Item 1A — Risk Factors" → "item 1a"
            num_for_key = SEC_ITEM_NUMBER_RE.search(header_text)
            if num_for_key:
                item_key = f"item {num_for_key.group(1)}{(num_for_key.group(2) or '').lower()}"
            else:
                item_key = re.sub(r"\s+", " ", re.sub(r"[-—].*$", "", header_text)).strip().lower()
            friendly_name = SEC_10K_SECTIONS.get(item_key, header_text)

            # Canonical id: "item_1a", "item_7", etc. — stable across header variants.
            item_id = ""
            num_match = SEC_ITEM_NUMBER_RE.search(header_text)
            if num_match:
                num, letter = num_match.group(1), (num_match.group(2) or "").lower()
                item_id = f"item_{num}{letter}"

            section_text = text[start:end].strip()
            if len(section_text) > 50:
                sections.append(Section(name=friendly_name, text=section_text, item_id=item_id))

        # ── Note refs (only collected if found inside Item 8 region) ──
        # Notes typically live inside Item 8 (Financial Statements). We add them
        # as their own sections so retrieval can target "Note 7" directly.
        for i, match in enumerate(note_matches):
            start = match.start()
            end = note_matches[i + 1].start() if i + 1 < len(note_matches) else len(text)
            note_text = text[start:end].strip()
            if len(note_text) < 80:
                continue
            header = match.group(1).strip()
            num_match = SEC_NOTE_NUMBER_RE.search(header)
            if num_match:
                note_id = f"note_{num_match.group(1)}{(num_match.group(2) or '').lower()}"
            else:
                note_id = ""
            # Cap note length to keep chunker happy on accidentally-greedy matches.
            sections.append(Section(name=header[:120], text=note_text[:20000], item_id=note_id))

        return sections

    def _detect_earnings_sections(self, text: str) -> list[Section]:
        """Detect Prepared Remarks vs Q&A sections in earnings transcripts."""
        sections = []

        boundaries = []
        for section_name, pattern in EARNINGS_SECTION_PATTERNS.items():
            match = pattern.search(text)
            if match:
                boundaries.append((match.start(), section_name))

        if not boundaries:
            return [Section(name="Earnings Call Transcript", text=text)]

        # Sort by position
        boundaries.sort(key=lambda x: x[0])

        for i, (start, name) in enumerate(boundaries):
            end = boundaries[i + 1][0] if i + 1 < len(boundaries) else len(text)
            section_text = text[start:end].strip()
            if len(section_text) > 50:
                sections.append(Section(name=name, text=section_text))

        return sections or [Section(name="Earnings Call Transcript", text=text)]
