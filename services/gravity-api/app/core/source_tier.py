"""
Source trust tiers — the spine of multi-source answering (RESEARCH_ASSISTANT_ROADMAP §0).

Every retrieved fact carries a source_type. This module maps source_type → a trust
TIER (1 = most authoritative) so the answer layer can: (a) prefer higher tiers when
sources conflict, (b) label each cited fact, (c) never let a news headline override a
10-K. One canonical mapping used by retrieval, fusion, and the prompt builder.

Tiers (highest → lowest authority):
  1  xbrl        SEC XBRL exact fact          regulated, audited
  2  filing      SEC filing prose (10-K/Q/8-K) regulated
  3  transcript  earnings-call transcript      primary — the company's own words
  4  estimate    analyst estimate / rating     third-party projection (label "(est.)")
  5  quote       live price / quote            real-time fact, time-stamped
  6  news        news / press / blog           unverified, recency-only
"""

from __future__ import annotations

# Canonical source_type → (tier, human label)
_TIER: dict[str, tuple[int, str]] = {
    "xbrl":       (1, "SEC XBRL exact fact"),
    "filing":     (2, "SEC filing"),
    "transcript": (3, "earnings-call transcript"),
    "estimate":   (4, "analyst estimate"),
    "quote":      (5, "live market quote"),
    "news":       (6, "news"),
}

# Map the free-form document_type values already in the corpus onto a source_type.
_DOCTYPE_TO_SOURCE: dict[str, str] = {
    "10-k": "filing", "10-q": "filing", "8-k": "filing", "20-f": "filing",
    "40-f": "filing", "6-k": "filing", "def 14a": "filing", "s-1": "filing",
    "earnings_transcript": "transcript", "transcript": "transcript",
    "earnings_call": "transcript",
    "analyst_estimate": "estimate", "estimate": "estimate", "rating": "estimate",
    "quote": "quote", "price": "quote",
    "news": "news", "press_release": "news", "article": "news",
}

DEFAULT_TIER = 6  # unknown → treat as least authoritative, never override a filing


def source_type_for(document_type: str = "", chunk_id: str = "", text: str = "") -> str:
    """Best-effort source_type from the signals a RetrievalResult already carries."""
    dt = (document_type or "").strip().lower()
    if dt in _DOCTYPE_TO_SOURCE:
        return _DOCTYPE_TO_SOURCE[dt]
    # XBRL exact facts are tagged in their text + chunk_id (structured_search).
    t = text or ""
    if chunk_id.startswith("fin_") or t.startswith("[EXACT FILING FIGURE]") or t.startswith("[Financial Fact]"):
        return "xbrl"
    if dt:
        # partial match (e.g. "form 10-k (annual report)")
        for key, src in _DOCTYPE_TO_SOURCE.items():
            if key in dt:
                return src
    return "filing"  # default: corpus is SEC filings today


def tier_of(source_type: str) -> int:
    return _TIER.get((source_type or "").lower(), (DEFAULT_TIER, ""))[0]


def label_of(source_type: str) -> str:
    return _TIER.get((source_type or "").lower(), (DEFAULT_TIER, "source"))[1]


def tier_for_result(r) -> int:
    """Trust tier for a RetrievalResult-like object (duck-typed)."""
    st = source_type_for(
        document_type=getattr(r, "document_type", "") or "",
        chunk_id=str(getattr(r, "chunk_id", "") or ""),
        text=getattr(r, "text", "") or "",
    )
    return tier_of(st)
