"""
Gravity Search -- Proposition Extractor (ALiiCE)
Decomposes generated answers into atomic claims and maps each claim
to a specific supporting passage sentence.

Based on: ALiiCE (EMNLP 2023) -- Evaluating Positional Fine-grained
Citation Generation. Improves citation precision from chunk-level
("Source 3") to sentence-level ("Apple 10-K Item 8, para 2, sentence 4").

Two-phase pipeline:
  1. Decompose: LLM splits the answer into atomic propositions
     (one verifiable fact per proposition)
  2. Attribute: For each proposition, find the best-matching passage
     sentence via NLI entailment (numeric pre-check + FinBERT)

Output: list of AttributedProposition objects, each with:
  - The atomic claim text
  - The supporting passage (chunk_id + sentence offset)
  - Entailment confidence

Integration: Called from CitationValidator after Stage 7 NLI check.
"""

from __future__ import annotations

import re
import asyncio
import structlog
from dataclasses import dataclass, field

logger = structlog.get_logger()


@dataclass
class AttributedProposition:
    """A single atomic claim with its supporting evidence."""
    claim: str                          # "Apple's FY2024 revenue was $391B"
    chunk_id: str = ""                  # supporting chunk
    supporting_sentence: str = ""       # exact sentence from the chunk
    sentence_offset: int = -1           # sentence index within chunk
    entailment_score: int = 0           # 1 = entailed, 0 = not
    method: str = "nli"                 # "numeric" | "finbert" | "llm"
    confidence: float = 0.0            # 0.0–1.0


class PropositionExtractor:
    """
    Decomposes answers into atomic claims and attributes each to a passage.

    Usage:
        extractor = PropositionExtractor(llm_client=fast_client)
        props = await extractor.extract_and_attribute(answer, passages)
        # → list[AttributedProposition]
    """

    def __init__(self, llm_client=None):
        self._llm = llm_client
        self._nli = None  # lazy-load FinanceNLIJudge

    def _get_nli(self):
        if self._nli is None:
            try:
                from app.core.reasoning.nli_judge import FinanceNLIJudge
                self._nli = FinanceNLIJudge()
            except Exception as e:
                logger.warning("nli_judge_import_failed", error=str(e))
        return self._nli

    async def extract_and_attribute(
        self,
        answer: str,
        passages: list,  # list[RetrievalResult]
        max_propositions: int = 12,
    ) -> list[AttributedProposition]:
        """
        Full ALiiCE pipeline: decompose answer → attribute each claim.

        Args:
            answer:           Generated answer text (plain text or JSON answer field)
            passages:         Top retrieved passages (RetrievalResult objects)
            max_propositions: Cap to avoid latency blowup (default 12)

        Returns:
            list[AttributedProposition] ordered by answer position
        """
        # Step 1: Decompose into atomic propositions
        propositions = await self._decompose(answer, max_propositions)
        if not propositions:
            return []

        # Step 2: Split each passage into sentences for fine-grained attribution
        passage_sentences = self._split_passages(passages)

        # Step 3: Attribute each proposition to the best passage sentence
        tasks = [
            self._attribute_one(prop, passage_sentences)
            for prop in propositions
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        attributed = []
        for r in results:
            if isinstance(r, AttributedProposition):
                attributed.append(r)
            elif isinstance(r, Exception):
                logger.warning("proposition_attribution_failed", error=str(r))

        logger.info(
            "propositions_attributed",
            total=len(propositions),
            attributed=sum(1 for p in attributed if p.entailment_score == 1),
            unattributed=sum(1 for p in attributed if p.entailment_score == 0),
        )
        return attributed

    # ── Step 1: Decompose ─────────────────────────────────────────────────

    async def _decompose(self, answer: str, max_props: int) -> list[str]:
        """
        Split answer into atomic propositions using rule-based extraction
        or LLM decomposition (when LLM client is available).

        Rule-based handles simple answers well; LLM handles complex
        multi-sentence answers with implicit claims.
        """
        # Always try rule-based first (fast, $0)
        rule_props = self._rule_based_decompose(answer)

        if rule_props and len(rule_props) >= 2:
            return rule_props[:max_props]

        if not self._llm:
            return rule_props[:max_props]

        # LLM decomposition for complex answers
        try:
            return await self._llm_decompose(answer, max_props)
        except Exception as e:
            logger.warning("llm_decompose_failed", error=str(e))
            return rule_props[:max_props]

    def _rule_based_decompose(self, text: str) -> list[str]:
        """
        Split on sentence boundaries, keeping only factual sentences.
        Filters out hedges, disclaimers, and meta-commentary.
        """
        # Split on sentence boundaries
        sentences = re.split(r'(?<=[.!?])\s+(?=[A-Z\$\d])', text.strip())

        factual = []
        _SKIP = re.compile(
            r"^(however|note that|importantly|as mentioned|in conclusion|"
            r"overall|in summary|please note|it is worth|this suggests|"
            r"based on the|according to the provided)",
            re.IGNORECASE,
        )
        _NUM_OR_ENTITY = re.compile(
            r"\$[\d,]+|[\d,]+\s*(?:million|billion|percent|%)|"
            r"\b(?:revenue|income|profit|loss|margin|eps|ebitda|cash|debt|"
            r"assets|equity|ratio|growth|decline|increased|decreased)\b",
            re.IGNORECASE,
        )

        for s in sentences:
            s = s.strip()
            if len(s) < 20:
                continue
            if _SKIP.match(s):
                continue
            # Keep sentences with financial content
            if _NUM_OR_ENTITY.search(s):
                factual.append(s)

        return factual

    async def _llm_decompose(self, answer: str, max_props: int) -> list[str]:
        """Use LLM to decompose answer into atomic propositions."""
        from app.llm.base import LLMConfig, LLMMessage

        prompt = (
            f"Decompose the following financial answer into {max_props} or fewer "
            f"atomic factual claims. Each claim must be:\n"
            f"- Self-contained (understandable without other claims)\n"
            f"- Verifiable against a financial document\n"
            f"- A single fact (not a compound claim)\n\n"
            f"Output one claim per line, no numbering, no bullets.\n\n"
            f"Answer:\n{answer[:2000]}\n\nAtomic claims:"
        )

        resp = await self._llm.generate(
            messages=[LLMMessage(role="user", content=prompt)],
            config=LLMConfig(temperature=0.0, max_tokens=600),
        )

        lines = [l.strip().lstrip("•-*0123456789.) ") for l in resp.content.splitlines()]
        return [l for l in lines if len(l) > 15][:max_props]

    # ── Step 2: Split passages into sentences ─────────────────────────────

    def _split_passages(self, passages: list) -> list[dict]:
        """
        Split each passage into sentences for fine-grained attribution.

        Returns list of {"chunk_id", "sentence", "offset", "passage_text"} dicts.
        """
        sentence_records = []
        for p in passages:
            text = getattr(p, "text", "") or ""
            chunk_id = getattr(p, "chunk_id", "") or ""
            sentences = re.split(r'(?<=[.!?])\s+', text)
            for i, s in enumerate(sentences):
                s = s.strip()
                if len(s) > 20:
                    sentence_records.append({
                        "chunk_id": chunk_id,
                        "sentence": s,
                        "offset": i,
                        "passage_text": text,
                    })
        return sentence_records

    # ── Step 3: Attribute one proposition ────────────────────────────────

    async def _attribute_one(
        self,
        claim: str,
        sentence_records: list[dict],
    ) -> AttributedProposition:
        """Find the best-matching sentence for a single claim via NLI."""
        nli = self._get_nli()
        if not nli or not sentence_records:
            return AttributedProposition(claim=claim)

        # Score each sentence against the claim
        # Batch in groups of 10 to limit concurrency
        best: AttributedProposition | None = None

        for rec in sentence_records:
            result = await nli.score(rec["sentence"], claim)
            if result.entails:
                prop = AttributedProposition(
                    claim=claim,
                    chunk_id=rec["chunk_id"],
                    supporting_sentence=rec["sentence"],
                    sentence_offset=rec["offset"],
                    entailment_score=1,
                    method=result.method,
                    confidence=1.0,
                )
                best = prop
                break  # Take first entailing sentence (passages are ranked)

        if best is None:
            best = AttributedProposition(claim=claim, entailment_score=0)

        return best

    # ── Utility: citation recall metric ──────────────────────────────────

    @staticmethod
    def citation_recall(props: list[AttributedProposition]) -> float:
        """Fraction of propositions with a supporting sentence."""
        if not props:
            return 0.0
        return sum(1 for p in props if p.entailment_score == 1) / len(props)

    @staticmethod
    def format_citations(props: list[AttributedProposition]) -> list[dict]:
        """
        Convert attributed propositions to structured citation list
        compatible with the search pipeline's `citations_out` format.
        """
        citations = []
        seen_chunks: set[str] = set()
        for p in props:
            if p.chunk_id and p.chunk_id not in seen_chunks:
                seen_chunks.add(p.chunk_id)
                citations.append({
                    "chunk_id": p.chunk_id,
                    "claim": p.claim[:200],
                    "sentence": p.supporting_sentence[:300],
                    "entailed": bool(p.entailment_score),
                    "method": p.method,
                })
        return citations
