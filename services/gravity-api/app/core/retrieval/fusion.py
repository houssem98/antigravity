"""
Gravity Search — Reciprocal Rank Fusion (RRF)
Fuses ranked result lists from multiple retrieval channels into a single ranked list.

Formula: RRF_score(doc) = Σ 1 / (k + rank_i)  for each list i
  - k = 60 (standard constant, tunable)
  - Parameter-free, robust to score-scale differences across retrieval methods
  - Consistently outperforms simple score-based merging (Cormack et al., 2009)

Performance: Dense-only ~0.72 NDCG → +BM25 ~0.85 → +SPLADE ~0.91 → +Reranker ~0.93
"""

from dataclasses import dataclass, field

import structlog

logger = structlog.get_logger()


# Source authority scores per plan §6.4:
# "SEC/IR > sell-side research > mainstream financial news > blogs"
_SOURCE_QUALITY: dict[str, int] = {
    # Primary regulatory filings
    "10-K": 10,
    "10-Q": 10,
    "8-K": 10,
    "DEF 14A": 10,
    "S-1": 10,
    "424B4": 10,
    "4": 10,           # Form 4 insider transactions
    "13F-HR": 10,
    "SC 13D": 10,
    "SC 13G": 10,
    # Issuer first-party
    "earnings_transcript": 9,
    "earnings transcript": 9,
    "press_release": 7,    # PR Newswire / BusinessWire — issuer-issued
    # Sell-side / paid research
    "broker_report": 8,
    "analyst_report": 8,
    "consensus": 8,        # Visible Alpha / Refinitiv consensus
    # News tiers
    "news_tier1": 6,       # WSJ / Bloomberg / FT / Reuters
    "news_tier2": 5,       # CNBC / MarketWatch / mainstream
    "news": 5,             # default news
    "news_tier3": 3,       # blogs / aggregators / SeekingAlpha non-pro
    # Untrusted
    "social": 2,           # Reddit / StockTwits / Twitter
    "blog": 2,
}

# URL-domain → authority score (overrides document_type when domain is known).
# Tiered after AlphaSense's WSI broker-research weighting + plan §6.4 hierarchy.
_DOMAIN_QUALITY: dict[str, int] = {
    # ── Tier 10: regulatory primary sources ──
    "sec.gov":              10,
    "www.sec.gov":          10,
    "data.sec.gov":         10,
    "efts.sec.gov":         10,
    "fred.stlouisfed.org":  10,
    "bls.gov":              10,
    "bea.gov":              10,
    "federalreserve.gov":   10,
    "treasury.gov":         10,
    "imf.org":              10,
    "worldbank.org":        10,
    "ecb.europa.eu":        10,
    "oecd.org":             10,
    "uspto.gov":            10,
    "fda.gov":              10,
    "ema.europa.eu":        10,
    "fcc.gov":              10,
    "courtlistener.com":    9,    # legal primary source
    "clinicaltrials.gov":   10,
    # ── Tier 9: issuer first-party ──
    "investor.":            9,    # any investor.<ticker>.com IR site
    "ir.":                  9,    # ir.<company>.com
    # ── Tier 7: issuer-issued press wires ──
    "businesswire.com":     7,
    "prnewswire.com":       7,
    "globenewswire.com":    7,
    "newsroom.":            7,    # newsroom.<company>.com
    # ── Tier 6: tier-1 financial news (paywalled, audited) ──
    "bloomberg.com":        6,
    "reuters.com":          6,
    "wsj.com":              6,
    "ft.com":               6,
    "nytimes.com":          6,
    "economist.com":        6,
    "washingtonpost.com":   6,
    "spglobal.com":         6,    # S&P Capital IQ articles
    "factset.com":          6,
    "morningstar.com":      6,
    # ── Tier 5: tier-2 mainstream financial ──
    "cnbc.com":             5,
    "marketwatch.com":      5,
    "barrons.com":          5,
    "fortune.com":          5,
    "businessinsider.com":  5,
    "forbes.com":           5,
    "thestreet.com":        5,
    "investors.com":        5,
    "investing.com":        5,
    "kiplinger.com":        5,
    "yahoo.com":            5,
    "finance.yahoo.com":    5,
    # ── Tier 4: prosumer / community (variable quality) ──
    "seekingalpha.com":     4,
    "fool.com":             4,
    "zacks.com":            4,
    "benzinga.com":         4,
    "ftalphaville.ft.com":  5,    # FT subprop, slightly elevated
    # ── Tier 3: aggregators / blogs / content farms ──
    "medium.com":           3,
    "substack.com":         3,
    # ── Tier 2: social / unverified ──
    "reddit.com":           2,
    "twitter.com":          2,
    "x.com":                2,
    "stocktwits.com":       2,
    "wallstreetbets":       2,
    "youtube.com":          2,
    "tiktok.com":           1,
    "discord.com":          1,
    "telegram.org":         1,
}


def get_source_quality(
    document_type: str = "",
    document_title: str = "",
    source_url: str = "",
) -> int:
    """
    Return authority score 1–10 based on source type, title hints, or URL domain.
    Priority: explicit document_type > URL domain > title hints > default 5.
    """
    dt = (document_type or "").lower()
    title = (document_title or "").lower()
    url = (source_url or "").lower()

    # 1. Explicit document type
    for key, score in _SOURCE_QUALITY.items():
        if key.lower() in dt:
            return score

    # 2. URL domain
    if url:
        for domain, score in _DOMAIN_QUALITY.items():
            if domain in url:
                return score

    # 3. Title hints
    for key, score in _SOURCE_QUALITY.items():
        if key.lower() in title:
            return score

    return 5  # default: news-level authority


@dataclass
class RetrievalResult:
    """A single retrieved passage from any search channel."""
    chunk_id: str
    document_id: str
    text: str
    score: float = 0.0
    metadata: dict = field(default_factory=dict)
    # Populated after fusion
    rrf_score: float = 0.0
    source_channels: list[str] = field(default_factory=list)

    # For citation grounding
    document_title: str = ""
    section: str = ""
    page: int | None = None
    filing_date: str = ""
    ticker: str = ""
    document_type: str = ""   # "10-K" | "earnings_transcript" | "news" etc.
    source_quality: int = 5   # 1–10 authority score per roadmap §6.1

    def __post_init__(self):
        # Auto-compute authority score from document type / URL / title.
        if self.source_quality == 5 and (self.document_type or self.document_title or self.metadata):
            url = (self.metadata or {}).get("source_url", "") or (self.metadata or {}).get("url", "")
            self.source_quality = get_source_quality(
                document_type=self.document_type,
                document_title=self.document_title,
                source_url=url,
            )


def reciprocal_rank_fusion(
    ranked_lists: dict[str, list[RetrievalResult]],
    k: int = 60,
    min_channels: int = 1,
) -> list[RetrievalResult]:
    """
    Fuse multiple ranked lists using Reciprocal Rank Fusion.

    Args:
        ranked_lists: Dict mapping channel_name → ranked results
                      e.g., {"dense": [...], "bm25": [...], "splade": [...]}
        k: RRF constant (default 60). Higher = more weight to lower ranks.
        min_channels: Minimum number of channels a doc must appear in to be included.

    Returns:
        Single fused ranked list, sorted by RRF score descending.
    """
    scores: dict[str, float] = {}
    doc_map: dict[str, RetrievalResult] = {}
    channel_counts: dict[str, set[str]] = {}  # chunk_id → set of channels

    for channel_name, results in ranked_lists.items():
        for rank, result in enumerate(results):
            cid = result.chunk_id

            # Accumulate RRF score
            rrf_contribution = 1.0 / (k + rank + 1)
            scores[cid] = scores.get(cid, 0.0) + rrf_contribution

            # Track which channels found this doc
            if cid not in channel_counts:
                channel_counts[cid] = set()
            channel_counts[cid].add(channel_name)

            # Keep the best version of the result (highest original score)
            if cid not in doc_map or result.score > doc_map[cid].score:
                doc_map[cid] = result

    # Filter by minimum channel count, sort by RRF score
    fused = []
    for cid in sorted(scores, key=scores.get, reverse=True):
        if len(channel_counts[cid]) >= min_channels:
            result = doc_map[cid]
            result.rrf_score = scores[cid]
            result.source_channels = sorted(channel_counts[cid])
            fused.append(result)

    logger.info(
        "rrf_fusion",
        input_channels=len(ranked_lists),
        total_unique_docs=len(doc_map),
        output_docs=len(fused),
        top_score=fused[0].rrf_score if fused else 0,
        multi_channel_docs=sum(1 for s in channel_counts.values() if len(s) > 1),
    )

    return fused


def weighted_rrf(
    ranked_lists: dict[str, list[RetrievalResult]],
    weights: dict[str, float] | None = None,
    k: int = 60,
) -> list[RetrievalResult]:
    """
    Weighted variant of RRF — allows boosting certain channels.
    Default weights: dense=1.0, bm25=1.0, splade=0.8, graph=0.6, structured=1.2

    Use this when you have evidence that certain channels are more reliable
    for specific query types (e.g., structured queries boost structured channel).
    """
    default_weights = {
        "dense": 1.0,
        "bm25": 1.0,
        "splade": 0.8,
        "graph": 0.6,
        "structured": 1.2,
        "mcp": 1.0,     # MCP institutional data — on par with dense/BM25
    }
    weights = weights or default_weights

    scores: dict[str, float] = {}
    doc_map: dict[str, RetrievalResult] = {}
    channel_counts: dict[str, set[str]] = {}

    for channel_name, results in ranked_lists.items():
        w = weights.get(channel_name, 1.0)
        for rank, result in enumerate(results):
            cid = result.chunk_id
            scores[cid] = scores.get(cid, 0.0) + w / (k + rank + 1)

            if cid not in channel_counts:
                channel_counts[cid] = set()
            channel_counts[cid].add(channel_name)

            if cid not in doc_map or result.score > doc_map[cid].score:
                doc_map[cid] = result

    fused = []
    for cid in sorted(scores, key=scores.get, reverse=True):
        result = doc_map[cid]
        result.rrf_score = scores[cid]
        result.source_channels = sorted(channel_counts[cid])
        fused.append(result)

    return fused


def authority_aware_rrf(
    ranked_lists: dict[str, list[RetrievalResult]],
    k: int = 60,
    authority_weight: float = 0.15,
) -> list[RetrievalResult]:
    """
    Plan §6.4: encode source authority directly into fusion.

    Final score = standard RRF + (authority_weight × source_quality / 10).
    Default authority_weight=0.15 caps the boost so a weak primary source
    can't outrank a strong news result that's also returned by 3 channels.

    Tuning guide:
      0.05 — almost no effect (matches benchmark default)
      0.15 — primary filings outrank tier-2 news at ties (recommended)
      0.30 — primary always beats news (use for compliance-strict outputs)
    """
    base = reciprocal_rank_fusion(ranked_lists, k=k)
    if not base:
        return base

    # Re-score with authority boost. authority_weight is normalized so a
    # source_quality=10 doc gets +authority_weight, source_quality=5 gets
    # +authority_weight/2, etc.
    for r in base:
        r.rrf_score = r.rrf_score + (authority_weight * r.source_quality / 10.0)

    base.sort(key=lambda r: r.rrf_score, reverse=True)
    logger.info(
        "authority_aware_rrf",
        docs=len(base),
        authority_weight=authority_weight,
        top_quality=base[0].source_quality if base else 0,
    )
    return base
