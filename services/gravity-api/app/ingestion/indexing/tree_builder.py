"""
GravityIndex tree builder — turns a filing's chunks into a hierarchical node tree
for reasoning-based (vectorless) navigation.

Reuses the chunks already indexed in Qdrant (no re-parsing): scroll a document's
chunks, group by section, emit one node per section with a short summary + the
chunk_ids whose text it covers. The LLM later navigates this outline to the exact
section instead of cosine-matching chunks. Stored in Supabase `doc_trees`.
"""

from __future__ import annotations

import structlog

logger = structlog.get_logger()

# Canonical 10-K/10-Q section ordering so the tree reads like the filing's TOC.
_SECTION_ORDER = [
    "business", "risk factors", "properties", "legal proceedings",
    "selected financial data", "management's discussion", "md&a",
    "quantitative and qualitative", "financial statements",
    "consolidated statements of operations", "consolidated balance sheets",
    "consolidated statements of cash flows", "consolidated statements of income",
    "notes to", "controls and procedures",
]


def _order_key(section: str) -> int:
    s = (section or "").lower()
    for i, name in enumerate(_SECTION_ORDER):
        if name in s:
            return i
    return len(_SECTION_ORDER)


async def _scroll_doc_chunks(document_id: str, collection: str) -> list[dict]:
    from app.db.qdrant import qdrant_client
    from qdrant_client import models as qm
    out: list[dict] = []
    offset = None
    flt = qm.Filter(must=[qm.FieldCondition(key="document_id", match=qm.MatchValue(value=document_id))])
    while True:
        points, offset = await qdrant_client.scroll(
            collection_name=collection, scroll_filter=flt,
            limit=500, offset=offset, with_payload=True, with_vectors=False,
        )
        for p in points:
            out.append(p.payload or {})
        if offset is None or not points:
            break
    return out


def _build_tree_from_chunks(chunks: list[dict]) -> list[dict]:
    """Group chunks by section → ordered list of section nodes."""
    by_section: dict[str, list[dict]] = {}
    for c in chunks:
        if c.get("chunk_level") not in (2, None):
            continue
        sec = (c.get("section") or "Document").strip() or "Document"
        by_section.setdefault(sec, []).append(c)

    nodes: list[dict] = []
    for i, sec in enumerate(sorted(by_section, key=lambda s: (_order_key(s), s))):
        cs = by_section[sec]
        # cheap deterministic summary = first ~180 chars of the section's first chunk
        first_text = next((c.get("text", "") for c in cs if c.get("text")), "")
        summary = " ".join(first_text.split())[:180]
        pages = sorted({c.get("page") for c in cs if c.get("page") is not None})
        nodes.append({
            "node_id": f"n{i}",
            "title": sec,
            "level": 1,
            "section": sec,
            "summary": summary,
            "chunk_ids": [c.get("chunk_id") for c in cs if c.get("chunk_id")][:40],
            "pages": [pages[0], pages[-1]] if pages else None,
        })
    return nodes


async def build_tree_for_document(document_id: str, ticker: str = "", company: str = "",
                                  filing_type: str = "", filing_date: str = "",
                                  period: str = "", collection: str | None = None) -> int:
    """Build + store one filing's tree. Returns node count (0 on failure)."""
    from app.db import supabase_rest
    from app.db.qdrant import collection_for_org
    collection = collection or collection_for_org(None)

    chunks = await _scroll_doc_chunks(document_id, collection)
    if not chunks:
        logger.info("tree_builder_no_chunks", document_id=document_id)
        return 0

    meta = chunks[0]
    nodes = _build_tree_from_chunks(chunks)
    if not nodes:
        return 0

    row = {
        "doc_id": document_id,
        "ticker": (ticker or meta.get("ticker", "") or "").upper(),
        "company": company or meta.get("company_name", "") or "",
        "filing_type": filing_type or meta.get("filing_type", "") or "",
        "filing_date": filing_date or meta.get("filing_date") or None,
        "period": period or "",
        "tree": nodes,
        "node_count": len(nodes),
    }
    n = await supabase_rest.sb_insert("doc_trees", [row], on_conflict="doc_id")
    logger.info("tree_built", document_id=document_id, ticker=row["ticker"], nodes=len(nodes), written=n)
    return len(nodes) if n else 0


async def build_trees_for_ticker(ticker: str, collection: str | None = None) -> int:
    """Discover a ticker's filings in Qdrant and build a tree for each."""
    from app.db.qdrant import qdrant_client, collection_for_org
    from qdrant_client import models as qm
    collection = collection or collection_for_org(None)

    # find distinct document_ids for the ticker
    flt = qm.Filter(must=[qm.FieldCondition(key="ticker", match=qm.MatchValue(value=ticker.upper()))])
    doc_ids: set[str] = set()
    offset = None
    while True:
        points, offset = await qdrant_client.scroll(
            collection_name=collection, scroll_filter=flt,
            limit=500, offset=offset, with_payload=True, with_vectors=False,
        )
        for p in points:
            did = (p.payload or {}).get("document_id")
            if did:
                doc_ids.add(did)
        if offset is None or not points:
            break

    total = 0
    for did in doc_ids:
        total += await build_tree_for_document(did, ticker=ticker, collection=collection)
    logger.info("trees_built_for_ticker", ticker=ticker, docs=len(doc_ids), nodes=total)
    return total
