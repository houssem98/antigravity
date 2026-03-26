"""
Gravity Search — SPLADE Sparse Vector Encoder
Generates learned sparse representations for hybrid search.
Falls back to a simple TF-IDF-like representation if SPLADE model unavailable.
"""

import asyncio
import structlog
logger = structlog.get_logger()


class SpladeEncoder:
    """SPLADE learned sparse vector encoder."""

    def __init__(self, model_name: str = "naver/splade-cocondenser-ensembledistil"):
        self.model_name = model_name
        self._model = None
        self._tokenizer = None

    def _load_model(self):
        """Lazy-load the SPLADE model."""
        if self._model is None:
            try:
                from transformers import AutoTokenizer, AutoModelForMaskedLM
                import torch
                self._tokenizer = AutoTokenizer.from_pretrained(self.model_name)
                self._model = AutoModelForMaskedLM.from_pretrained(self.model_name)
                self._model.eval()
                logger.info("splade_model_loaded", model=self.model_name)
            except Exception as e:
                logger.warning("splade_model_load_failed", error=str(e))

    async def _ensure_loaded(self):
        """Load model in a thread pool so the async event loop is not blocked."""
        if self._model is None:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, self._load_model)

    async def encode_query(self, query: str) -> dict:
        """Encode a query into a sparse vector {indices: [...], values: [...]}."""
        await self._ensure_loaded()
        if self._model is None:
            return self._fallback_encode(query)

        import torch
        tokens = self._tokenizer(query, return_tensors="pt", truncation=True, max_length=256)
        with torch.no_grad():
            output = self._model(**tokens)
        logits = output.logits
        sparse = torch.max(torch.log1p(torch.relu(logits)), dim=1).values.squeeze()

        # Extract non-zero entries
        nonzero = sparse.nonzero().squeeze().tolist()
        if isinstance(nonzero, int):
            nonzero = [nonzero]
        values = [float(sparse[idx]) for idx in nonzero]

        return {"indices": nonzero, "values": values}

    async def encode_document(self, text: str) -> dict:
        """Encode a document chunk into a sparse vector."""
        return await self.encode_query(text)  # Same logic for documents

    def _fallback_encode(self, text: str) -> dict:
        """Simple term-frequency fallback when SPLADE model unavailable."""
        from collections import Counter
        tokens = text.lower().split()
        counts = Counter(tokens)
        # Use hash-based indices to map tokens to sparse vector positions
        indices = [hash(t) % 30000 for t in counts.keys()]
        values = [float(c) for c in counts.values()]
        return {"indices": indices, "values": values}
