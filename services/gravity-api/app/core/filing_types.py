"""
Canonical registry of SEC filing types the ingestion pipeline supports.

Single source of truth so users can pick which filings to ingest/search, the UI
can render a selector, and the API can validate requests. `parsing` describes how
the pipeline treats each form (structured XML, section-aware narrative, or plain
narrative). `default` marks the types ingested when a caller doesn't specify any.
"""

from __future__ import annotations

from dataclasses import dataclass, asdict


@dataclass(frozen=True)
class FilingType:
    code: str          # EDGAR form code, e.g. "10-K"
    label: str         # human label for the UI
    category: str      # grouping for the UI selector
    description: str
    parsing: str       # "section" | "narrative" | "structured"
    default: bool = False


# Ordered for display. Defaults = the high-signal fundamentals most users want.
SUPPORTED_FILING_TYPES: list[FilingType] = [
    FilingType("10-K", "Annual report (10-K)", "Periodic",
               "Audited annual report: business, risk factors, MD&A, financials.",
               "section", default=True),
    FilingType("10-Q", "Quarterly report (10-Q)", "Periodic",
               "Unaudited quarterly financials + MD&A.", "section", default=True),
    FilingType("8-K", "Current report (8-K)", "Periodic",
               "Material events: earnings, M&A, leadership, guidance changes.",
               "narrative", default=True),
    FilingType("DEF 14A", "Proxy statement (DEF 14A)", "Governance",
               "Executive compensation, board, shareholder proposals.",
               "narrative"),
    FilingType("S-1", "IPO registration (S-1)", "Registration",
               "Initial public offering registration + prospectus.", "narrative"),
    FilingType("20-F", "Foreign annual report (20-F)", "Foreign",
               "Annual report for foreign private issuers (10-K equivalent).",
               "section"),
    FilingType("6-K", "Foreign current report (6-K)", "Foreign",
               "Interim reports for foreign private issuers.", "narrative"),
    FilingType("40-F", "Canadian annual report (40-F)", "Foreign",
               "Annual report for Canadian issuers under MJDS.", "section"),
    FilingType("13F-HR", "Institutional holdings (13F-HR)", "Ownership",
               "Quarterly holdings of institutional investment managers.",
               "structured"),
    FilingType("SC 13D", "Activist stake (SC 13D)", "Ownership",
               "Beneficial ownership >5% with intent (activist).", "structured"),
    FilingType("SC 13G", "Passive stake (SC 13G)", "Ownership",
               "Passive beneficial ownership >5%.", "structured"),
    FilingType("4", "Insider transaction (Form 4)", "Ownership",
               "Insider buys/sells of company securities.", "structured"),
]

_BY_CODE = {f.code.upper(): f for f in SUPPORTED_FILING_TYPES}

DEFAULT_FILING_TYPES: list[str] = [f.code for f in SUPPORTED_FILING_TYPES if f.default]


def is_supported(code: str) -> bool:
    return code.upper().strip() in _BY_CODE


def normalize_filing_types(codes: list[str] | None) -> tuple[list[str], list[str]]:
    """
    Split a requested list into (supported, unknown), preserving order and
    de-duplicating. Empty/None input returns the defaults.
    """
    if not codes:
        return list(DEFAULT_FILING_TYPES), []
    supported, unknown, seen = [], [], set()
    for raw in codes:
        c = raw.upper().strip()
        if not c or c in seen:
            continue
        seen.add(c)
        (supported if c in _BY_CODE else unknown).append(c)
    return (supported or list(DEFAULT_FILING_TYPES)), unknown


def registry_payload() -> list[dict]:
    """Serializable list for the GET /v1/documents/filing-types endpoint."""
    return [asdict(f) for f in SUPPORTED_FILING_TYPES]
