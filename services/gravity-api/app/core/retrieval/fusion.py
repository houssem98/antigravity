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


# Source authority scores per roadmap §6.1 Layer 3
_SOURCE_QUALITY: dict[str, int] = {
    "10-K": 10,
    "10-Q": 10,
    "8-K": 10,
    "DEF 14A": 10,
    "S-1": 10,
    "earnings_transcript": 9,
    "earnings transcript": 9,
    "broker_report": 7,
    "analyst_report": 7,
    "news": 5,
    "press_release": 6,
}

def get_source_quality(document_type: str, document_title: str = "") -> int:
    """Return authority score 1–10 based on source type."""
    dt = document_type.lower() if document_type else ""
    title = document_title.lower()
    for key, score in _SOURCE_QUALITY.items():
        if key.lower() in dt or key.lower() in title:
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
        # Auto-compute authority score from document type if not explicitly set
        if self.source_quality == 5 and (self.document_type or self.document_title):
            self.source_quality = get_source_quality(self.document_type, self.document_title)


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
