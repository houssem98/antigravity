"""P1-b: live fusion (authority_aware_rrf) must apply per-channel weights.

It previously called plain reciprocal_rank_fusion, so the channel weights in
weighted_rrf (structured=1.2, tree_nav=1.1, ...) were never applied on the live
path. Exact-fact channels should outrank generic prose at equal rank.
"""

from app.core.retrieval.fusion import (
    authority_aware_rrf,
    DEFAULT_CHANNEL_WEIGHTS,
    RetrievalResult,
)


def _mk(cid, score=0.5, quality=5):
    r = RetrievalResult.__new__(RetrievalResult)
    r.chunk_id = cid
    r.score = score
    r.rrf_score = 0.0
    r.source_quality = quality
    r.source_channels = []
    r.document_type = ""
    r.document_title = ""
    return r


def test_structured_outranks_dense_at_equal_rank():
    # Same rank (0) + same authority -> weight breaks the tie toward structured.
    out = authority_aware_rrf({"structured": [_mk("S")], "dense": [_mk("D")]})
    assert [r.chunk_id for r in out][0] == "S"


def test_tree_nav_outranks_dense_at_equal_rank():
    out = authority_aware_rrf({"tree_nav": [_mk("T")], "dense": [_mk("D")]})
    assert [r.chunk_id for r in out][0] == "T"


def test_weights_present():
    assert DEFAULT_CHANNEL_WEIGHTS["structured"] > DEFAULT_CHANNEL_WEIGHTS["dense"]
    assert DEFAULT_CHANNEL_WEIGHTS["tree_nav"] > DEFAULT_CHANNEL_WEIGHTS["dense"]
