"""
TurboQuant Retrieval Channel — pyturboquant compressed ANN index
Channel 7 in the hybrid retrieval architecture.

TurboQuant (github.com/jorgebmann/pyturboquant) implements Google's TurboQuant
algorithm: 4-bit vector quantization that achieves ~7.8× storage compression
with only ~2.1% nDCG@10 quality drop vs. full-precision fp32.

At 10M chunks (voyage-finance-2, 1024-dim):
  fp32  : ~40 GB RAM
  4-bit : ~5 GB RAM

Role in Gravity Search:
  - Maintains an in-memory compressed ANN index seeded from Qdrant vectors
  - Acts as a fast, memory-efficient supplement to the Qdrant dense channel
  - Particularly useful when the Qdrant instance is remote and latency matters
  - Persists the compressed index to disk for fast restarts

Config:
  TURBO_QUANT_ENABLED    — "true" to activate (default false)
  TURBO_QUANT_BITS       — quantization bits 2–8 (default 4)
  TURBO_QUANT_INDEX_PATH — disk snapshot path (default data/turbo_quant.idx)
  TURBO_QUANT_TOP_K      — results per query (default 50)
"""

from __future__ import annotations

import asyncio
import os
import time
from pathlib import Path
from typing import Any, Optional

import structlog

from app.core.retrieval.fusion import RetrievalResult
from app.config import settings

logger = structlog.get_logger()

# ─── Payload store — maps internal integer index → document metadata ──────────
# Populated in parallel with the TurboQuant index during ingestion.

_payload_store: list[dict] = []   # index_i → {chunk_id, document_id, text, metadata, ...}


class TurboQuantSearch:
    """
    Retrieval channel 7: compressed in-memory ANN search via TurboQuant.

    Life-cycle:
      1. On startup, call build() to seed from Qdrant (or load from disk snapshot).
      2. Call add_vectors() during ingestion as new chunks arrive.
      3. search() runs in-memory k-NN against the compressed index.
    """

    CHANNEL = "turbo_quant"

    def __init__(self, bits: int = 4, index_path: Optional[Path] = None):
        self.bits       = bits
        self.index_path = index_path or Path(settings.turbo_quant_index_path)
        self._index     = None   # pyturboquant.search.TurboQuantIndex
        self._dim:  int = settings.embedding_dimensions
        self._ready     = False

    # ── Public search API ─────────────────────────────────────────────────

    async def search(
        self,
        query_vector: list[float],
        top_k: int | None = None,
    ) -> list[RetrievalResult]:
        if not self._ready or self._index is None:
            return []

        top_k = top_k or settings.turbo_quant_top_k
        t0    = time.perf_counter()

        try:
            import torch  # type: ignore
            q = torch.tensor([query_vector], dtype=torch.float32)
            loop    = asyncio.get_event_loop()
            indices, distances = await loop.run_in_executor(
                None,
                lambda: self._index.search(q, k=top_k, metric="ip"),
            )
            results: list[RetrievalResult] = []
            for rank, (idx, dist) in enumerate(
                zip(indices[0].tolist(), distances[0].tolist())
            ):
                if idx < 0 or idx >= len(_payload_store):
                    continue
                payload = _payload_store[idx]
                results.append(RetrievalResult(
                    chunk_id       = payload.get("chunk_id", str(idx)),
                    document_id    = payload.get("document_id", ""),
                    text           = payload.get("text", ""),
                    score          = float(dist),
                    document_title = payload.get("document_title", ""),
                    section        = payload.get("section", ""),
                    page           = payload.get("page"),
                    metadata       = {**payload.get("metadata", {}), "source_channel": self.CHANNEL},
                    source_channels=[self.CHANNEL],
                ))

            elapsed = (time.perf_counter() - t0) * 1000
            logger.debug("turbo_quant_search", results=len(results), ms=round(elapsed, 1))
            return results
        except Exception as exc:
            logger.warning("turbo_quant_search_failed", error=str(exc))
            return []

    # Convenience wrapper that embeds the query text first (used by orchestrator)
    async def search_text(
        self,
        query:    str,
        embedder,
        filters:  dict | None = None,
        top_k:    int  | None = None,
    ) -> list[RetrievalResult]:
        if not self._ready:
            return []
        try:
            query_vector = await embedder.embed_query(query)
            results      = await self.search(query_vector, top_k)
            return self._apply_filters(results, filters)
        except Exception as exc:
            logger.warning("turbo_quant_embed_failed", error=str(exc))
            return []

    # ── Index building ────────────────────────────────────────────────────

    async def build_from_qdrant(
        self,
        batch_size:     int = 1000,
        max_vectors:    int | None = None,
    ) -> int:
        """
        Seed the TurboQuant index from all vectors currently in Qdrant.
        Returns count of vectors loaded.
        """
        try:
            from pyturboquant.search import TurboQuantIndex  # type: ignore
            import torch
        except ImportError:
            logger.warning("turbo_quant_import_failed",
                           hint="pip install pyturboquant torch")
            return 0

        logger.info("turbo_quant_building", source="qdrant")
        self._index = TurboQuantIndex(dim=self._dim, bits=self.bits, metric="ip")
        _payload_store.clear()

        try:
            from qdrant_client import QdrantClient
            from app.db.qdrant import qdrant_client, DENSE_VECTOR_NAME
            from app.config import settings as cfg

            scroll_offset = None
            total = 0

            while True:
                results, scroll_offset = qdrant_client.scroll(
                    collection_name=cfg.qdrant_collection,
                    offset=scroll_offset,
                    limit=batch_size,
                    with_vectors=[DENSE_VECTOR_NAME],
                    with_payload=True,
                )
                if not results:
                    break

                vectors = []
                for point in results:
                    vec_data = point.vector
                    if isinstance(vec_data, dict):
                        vec = vec_data.get(DENSE_VECTOR_NAME)
                    else:
                        vec = vec_data
                    if vec is None:
                        continue
                    payload = point.payload or {}
                    vectors.append(vec)
                    _payload_store.append({
                        "chunk_id":      payload.get("chunk_id", str(point.id)),
                        "document_id":   payload.get("document_id", ""),
                        "text":          payload.get("text", ""),
                        "document_title":payload.get("document_title", ""),
                        "section":       payload.get("section", ""),
                        "page":          payload.get("page"),
                        "metadata":      {k: v for k, v in payload.items()
                                         if k not in ("text",)},
                    })

                if vectors:
                    t = torch.tensor(vectors, dtype=torch.float32)
                    self._index.add(t)
                    total += len(vectors)
                    logger.debug("turbo_quant_loaded", total=total)

                if max_vectors and total >= max_vectors:
                    break
                if scroll_offset is None:
                    break

            self._ready = total > 0
            if self._ready:
                await self._save()
            logger.info("turbo_quant_built", vectors=total, bits=self.bits)
            return total

        except Exception as exc:
            logger.error("turbo_quant_build_failed", error=str(exc))
            return 0

    def add_vectors(self, vectors: list[list[float]], payloads: list[dict]) -> None:
        """Incrementally add new vectors during ingestion (non-blocking)."""
        if not self._ready or self._index is None:
            return
        try:
            import torch  # type: ignore
            t = torch.tensor(vectors, dtype=torch.float32)
            self._index.add(t)
            _payload_store.extend(payloads)
        except Exception as exc:
            logger.warning("turbo_quant_add_failed", error=str(exc))

    # ── Persistence ───────────────────────────────────────────────────────

    async def load(self) -> bool:
        """Load compressed index from disk. Returns True on success."""
        path = self.index_path
        payload_path = path.with_suffix(".payloads.json")
        if not path.exists() or not payload_path.exists():
            return False
        try:
            from pyturboquant.search import TurboQuantIndex  # type: ignore
            import json
            loop = asyncio.get_event_loop()
            self._index = await loop.run_in_executor(
                None,
                lambda: TurboQuantIndex.load(str(path)),
            )
            _payload_store.clear()
            _payload_store.extend(json.loads(payload_path.read_text()))
            self._ready = True
            logger.info("turbo_quant_loaded", path=str(path), vectors=len(_payload_store))
            return True
        except Exception as exc:
            logger.warning("turbo_quant_load_failed", path=str(path), error=str(exc))
            return False

    async def _save(self) -> None:
        """Persist index and payload store to disk."""
        try:
            import json
            self.index_path.parent.mkdir(parents=True, exist_ok=True)
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None,
                lambda: self._index.save(str(self.index_path)),
            )
            self.index_path.with_suffix(".payloads.json").write_text(
                json.dumps(_payload_store, ensure_ascii=False)
            )
            logger.info("turbo_quant_saved", path=str(self.index_path))
        except Exception as exc:
            logger.warning("turbo_quant_save_failed", error=str(exc))

    # ── Filter helper ─────────────────────────────────────────────────────

    @staticmethod
    def _apply_filters(
        results: list[RetrievalResult], filters: dict | None
    ) -> list[RetrievalResult]:
        if not filters:
            return results
        ticker      = (filters.get("ticker") or "").upper()
        filing_type = (filters.get("document_type") or "").upper()
        out = []
        for r in results:
            meta = r.metadata or {}
            if ticker and ticker not in str(meta.get("ticker", "")).upper():
                continue
            if filing_type and filing_type not in str(meta.get("filing_type", "")).upper():
                continue
            out.append(r)
        return out or results  # if filter eliminates everything, return unfiltered

    # ── Status ────────────────────────────────────────────────────────────

    @property
    def ready(self) -> bool:
        return self._ready

    def stats(self) -> dict:
        return {
            "ready":   self._ready,
            "vectors": len(_payload_store),
            "bits":    self.bits,
            "dim":     self._dim,
        }


# ─── Factory ─────────────────────────────────────────────────────────────────

def build_turbo_quant_search() -> Optional[TurboQuantSearch]:
    """Build TurboQuantSearch if enabled in config; return None otherwise."""
    if not settings.turbo_quant_enabled:
        logger.debug("turbo_quant_disabled")
        return None
    searcher = TurboQuantSearch(
        bits       = settings.turbo_quant_bits,
        index_path = Path(settings.turbo_quant_index_path),
    )
    logger.info("turbo_quant_search_created", bits=settings.turbo_quant_bits)
    return searcher
