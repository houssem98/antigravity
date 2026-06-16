"""
GravityIndex tree-nav retrieval channel — vectorless, reasoning-based.

Instead of cosine-matching chunks, an LLM reads the filing's TOC-like node tree
(titles + 1-line summaries) and *navigates* to the node(s) that hold the answer —
the PageIndex/Mafin paradigm, owned in-house. Fetches those nodes' chunk text from
Qdrant and returns them as RetrievalResult, fused alongside dense + XBRL.

Gated by settings.tree_nav_enabled. Self-noops when no tree exists for the ticker.
"""

from __future__ import annotations

import json
import re
import structlog

from app.core.retrieval.fusion import RetrievalResult

logger = structlog.get_logger()

_NAV_PROMPT = """You are navigating a SEC filing to answer a question.
Below is the filing's section outline (each line: node_id | section title | summary).
Return ONLY a JSON array of the 1-3 node_ids whose section most likely contains the
answer. Example: ["n5","n8"]

QUESTION: {query}

OUTLINE:
{outline}

JSON array of node_ids:"""


class TreeNavSearch:
    CHANNEL = "tree_nav"

    def __init__(self, llm_client=None, top_docs: int = 2, top_nodes: int = 3):
        self.llm = llm_client
        self.top_docs = top_docs
        self.top_nodes = top_nodes

    @staticmethod
    def _tickers(entities, filters):
        out = []
        for src in (entities or {}).get("companies", []) or []:
            if isinstance(src, dict) and src.get("ticker"):
                out.append(str(src["ticker"]).upper())
        for t in (filters or {}).get("companies", []) or []:
            if t:
                out.append(str(t).upper())
        return list(dict.fromkeys(out))

    async def search(self, query, entities=None, filters=None, top_k=None):
        from app.config import settings
        if not getattr(settings, "tree_nav_enabled", False):
            return []
        tickers = self._tickers(entities, filters)
        if not tickers:
            return []
        try:
            from app.db import supabase_rest
            if not supabase_rest.configured():
                return []

            # candidate trees: ticker + (the asked period if present)
            flt = {"ticker": f"eq.{tickers[0]}" if len(tickers) == 1
                   else "in.(" + ",".join(tickers) + ")"}
            ym = re.search(r"((?:19|20)\d{2})", query or "")
            if ym:
                flt["period"] = f"eq.FY{ym.group(1)}"
            trees = await supabase_rest.sb_select("doc_trees", flt, limit=self.top_docs)
            if not trees and ym:  # period miss → any filing for the ticker
                trees = await supabase_rest.sb_select(
                    "doc_trees", {"ticker": flt["ticker"]}, limit=self.top_docs)
            if not trees:
                return []

            results: list[RetrievalResult] = []
            for t in trees:
                results.extend(await self._navigate(query, t))
            logger.info("tree_nav_search", tickers=tickers, trees=len(trees), results=len(results))
            return results
        except Exception as e:
            logger.warning("tree_nav_failed", error=str(e)[:160])
            return []

    async def _navigate(self, query, tree_row) -> list[RetrievalResult]:
        nodes = tree_row.get("tree") or []
        if not nodes:
            return []
        outline = "\n".join(
            f"{n.get('node_id')} | {n.get('title','')} | {(n.get('summary','') or '')[:120]}"
            for n in nodes
        )
        node_ids = await self._pick_nodes(query, outline, nodes)
        chosen = [n for n in nodes if n.get("node_id") in node_ids][: self.top_nodes]
        if not chosen:
            chosen = nodes[: self.top_nodes]  # fallback: first sections

        # fetch chunk text for the chosen nodes from Qdrant
        chunk_ids: list[str] = []
        for n in chosen:
            chunk_ids.extend(n.get("chunk_ids", [])[:8])
        texts = await self._fetch_chunks(chunk_ids)

        out: list[RetrievalResult] = []
        for n in chosen:
            for cid in n.get("chunk_ids", [])[:8]:
                txt = texts.get(cid)
                if not txt:
                    continue
                out.append(RetrievalResult(
                    chunk_id=cid,
                    document_id=tree_row.get("doc_id", ""),
                    text=txt,
                    score=4.0,  # navigated-to content ranks high (reasoning-selected)
                    metadata={"source_channel": self.CHANNEL, "node": n.get("title")},
                    ticker=tree_row.get("ticker", ""),
                    document_title=f"{tree_row.get('ticker','')} {tree_row.get('filing_type','')} — {n.get('title','')}",
                    section=n.get("title", ""),
                    filing_date=tree_row.get("filing_date", "") or "",
                ))
        return out

    async def _pick_nodes(self, query, outline, nodes) -> list[str]:
        """LLM navigation → list of node_ids. Falls back to keyword overlap."""
        if self.llm is not None:
            try:
                from app.llm.base import LLMMessage, LLMConfig
                resp = await self.llm.generate(
                    messages=[LLMMessage(role="user",
                                         content=_NAV_PROMPT.format(query=query, outline=outline[:6000]))],
                    config=LLMConfig(temperature=0.0, max_tokens=40),
                )
                m = re.search(r"\[[^\]]*\]", resp.content or "")
                if m:
                    ids = json.loads(m.group(0))
                    if isinstance(ids, list) and ids:
                        return [str(i) for i in ids]
            except Exception as e:
                logger.debug("tree_nav_llm_pick_failed", error=str(e)[:120])
        # deterministic fallback: section-title/summary keyword overlap with query
        q = set(re.findall(r"[a-z]{4,}", (query or "").lower()))
        scored = []
        for n in nodes:
            text = (n.get("title", "") + " " + n.get("summary", "")).lower()
            scored.append((len(q & set(re.findall(r"[a-z]{4,}", text))), n.get("node_id")))
        scored.sort(reverse=True)
        return [nid for s, nid in scored[: self.top_nodes] if s > 0] or [nodes[0].get("node_id")]

    async def _fetch_chunks(self, chunk_ids: list[str]) -> dict[str, str]:
        if not chunk_ids:
            return {}
        try:
            from app.db.qdrant import qdrant_client, collection_for_org
            points = await qdrant_client.retrieve(
                collection_name=collection_for_org(None),
                ids=list(dict.fromkeys(chunk_ids)),
                with_payload=True, with_vectors=False,
            )
            return {str((p.payload or {}).get("chunk_id") or p.id): (p.payload or {}).get("text", "")
                    for p in points}
        except Exception as e:
            logger.debug("tree_nav_fetch_failed", error=str(e)[:120])
            return {}


def build_tree_nav_search(llm_client=None):
    return TreeNavSearch(llm_client=llm_client)
