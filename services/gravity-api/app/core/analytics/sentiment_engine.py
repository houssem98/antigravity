"""
Earnings Sentiment Engine
=========================
Sentence-level sentiment scoring optimized for financial language.

Key features:
  - Financial-domain vocabulary (not general NLP sentiment)
  - Sentence-level granularity with topic tagging
  - Speaker detection (CEO, CFO, Analyst, etc.)
  - Delta scoring: current period vs. prior period comparison
  - Redis caching with 24h TTL
  - Explainable outputs (which words drove the score)

Scoring approach:
  1. Rule-based lexicon pass (fast, <1ms per sentence)
  2. Contextual modifier detection (hedging, negation, intensifiers)
  3. LLM refinement for ambiguous sentences (optional, off by default)

Score range: -1.0 (extremely negative) to +1.0 (extremely positive)
Neutral: -0.1 to +0.1
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from typing import Optional

import structlog

logger = structlog.get_logger()

_CACHE_PREFIX = "sentiment:"
_CACHE_TTL = 86400  # 24 hours


# ── Lexicon ────────────────────────────────────────────────────────────────────

POSITIVE_TERMS = {
    # Growth
    "growth": 0.4, "grew": 0.4, "growing": 0.4, "increase": 0.3, "increased": 0.3,
    "expansion": 0.4, "expanding": 0.3, "accelerating": 0.5, "record": 0.5,
    "strong": 0.4, "stronger": 0.4, "strongest": 0.6, "robust": 0.4, "solid": 0.3,
    "outperform": 0.5, "outperformed": 0.5, "exceeded": 0.5, "surpassed": 0.5,
    "beat": 0.4, "beats": 0.4, "above": 0.2, "better": 0.3, "best": 0.5,
    "momentum": 0.4, "strength": 0.4, "inflection": 0.3,
    # Profitability
    "margin": 0.2, "profitable": 0.5, "profitability": 0.4, "efficiency": 0.3,
    "leverage": 0.2, "synergies": 0.3, "cost savings": 0.4, "productivity": 0.3,
    # Financial health
    "cash generation": 0.5, "free cash flow": 0.4, "shareholder value": 0.3,
    "dividend": 0.3, "buyback": 0.3, "repurchase": 0.3, "deleveraging": 0.3,
    "investment grade": 0.4, "upgraded": 0.4, "upgrade": 0.3,
    # Strategic
    "opportunity": 0.3, "pipeline": 0.3, "backlog": 0.3, "win": 0.4,
    "contract": 0.2, "partnership": 0.3, "strategic": 0.2, "innovation": 0.3,
    "leading": 0.3, "leadership": 0.3, "advantage": 0.3, "differentiated": 0.4,
    "confident": 0.4, "confidence": 0.4, "optimistic": 0.4, "optimism": 0.4,
    "positive": 0.3, "pleased": 0.3, "excited": 0.4, "enthusiastic": 0.4,
    "milestone": 0.3, "breakthrough": 0.5, "launch": 0.3, "expand": 0.3,
    "demand": 0.3, "adoption": 0.3, "penetration": 0.2, "market share": 0.4,
}

NEGATIVE_TERMS = {
    # Financial stress
    "decline": -0.4, "declining": -0.4, "decreased": -0.3, "decrease": -0.3,
    "miss": -0.4, "missed": -0.4, "shortfall": -0.5, "below": -0.2,
    "loss": -0.4, "losses": -0.4, "impairment": -0.5, "write-down": -0.5,
    "writedown": -0.5, "write-off": -0.4, "writeoff": -0.4,
    "headwind": -0.4, "headwinds": -0.4, "pressure": -0.3, "pressures": -0.3,
    "challenging": -0.3, "challenges": -0.3, "difficult": -0.3, "difficulty": -0.3,
    "weakness": -0.4, "weak": -0.3, "weaker": -0.3, "softer": -0.3, "soft": -0.2,
    "deteriorat": -0.4, "erosion": -0.4, "compress": -0.3, "compression": -0.3,
    # Risk
    "risk": -0.2, "risks": -0.2, "uncertainty": -0.3, "uncertain": -0.3,
    "volatile": -0.3, "volatility": -0.3, "concern": -0.3, "concerns": -0.3,
    "cautious": -0.3, "caution": -0.3, "conservative": -0.2, "prudent": -0.1,
    "exposure": -0.2, "litigation": -0.4, "regulatory": -0.2, "investigation": -0.4,
    "probe": -0.4, "fine": -0.3, "penalty": -0.4, "sanction": -0.4,
    # Macro
    "recession": -0.5, "inflation": -0.3, "tariff": -0.3, "tariffs": -0.3,
    "currency": -0.2, "fx": -0.1, "slowdown": -0.4, "downturn": -0.5,
    "macro": -0.2, "softness": -0.3, "decelerate": -0.4, "deceleration": -0.4,
    # Operations
    "disruption": -0.4, "disruptions": -0.4, "delay": -0.3, "delayed": -0.3,
    "shortage": -0.4, "supply chain": -0.2, "inventory": -0.1, "excess": -0.2,
    "layoff": -0.5, "layoffs": -0.5, "restructur": -0.3, "reduction": -0.2,
    "discontinu": -0.3, "divest": -0.2, "divestiture": -0.2,
    "debt": -0.2, "leverage": -0.2, "covenant": -0.3, "refinanc": -0.2,
}

INTENSIFIERS = {
    "significantly": 1.5, "substantially": 1.4, "materially": 1.4,
    "sharply": 1.5, "dramatically": 1.6, "markedly": 1.3,
    "rapidly": 1.3, "notably": 1.2, "considerably": 1.3,
    "exceptionally": 1.5, "extraordinary": 1.5, "unprecedented": 1.6,
    "very": 1.3, "extremely": 1.5, "highly": 1.3, "well": 1.2,
}

HEDGES = {
    "expect": 0.7, "expects": 0.7, "anticipated": 0.7, "anticipate": 0.7,
    "believe": 0.7, "believes": 0.7, "think": 0.7, "thinks": 0.7,
    "may": 0.6, "might": 0.6, "could": 0.6, "should": 0.8,
    "potentially": 0.7, "possibly": 0.6, "approximately": 0.9,
    "roughly": 0.9, "around": 0.9, "about": 0.9,
    "if": 0.7, "assuming": 0.7, "subject to": 0.7,
}

NEGATIONS = {
    "not", "no", "never", "neither", "nor", "without", "lack", "lacking",
    "absent", "unable", "failed", "fail", "cannot", "can't", "won't",
    "didn't", "don't", "doesn't", "hasn't", "haven't", "hadn't",
}

# Topic keyword mapping
TOPIC_KEYWORDS = {
    "revenue": ["revenue", "sales", "top line", "net sales", "bookings", "billings"],
    "margins": ["margin", "gross profit", "ebitda", "operating income", "profitability"],
    "guidance": ["guide", "guidance", "outlook", "forecast", "expect", "target"],
    "capex": ["capex", "capital expenditure", "investment", "spending"],
    "ai": ["ai", "artificial intelligence", "machine learning", "gpu", "llm", "model"],
    "macro": ["macro", "economy", "gdp", "recession", "inflation", "interest rate"],
    "competition": ["competition", "competitive", "market share", "competitor"],
    "supply_chain": ["supply chain", "supplier", "inventory", "shortage", "logistics"],
    "hiring": ["hiring", "headcount", "workforce", "employee", "talent", "layoff"],
    "m_and_a": ["acquisition", "merger", "divest", "deal", "transaction"],
    "debt": ["debt", "leverage", "credit", "balance sheet", "liquidity"],
    "dividend": ["dividend", "buyback", "repurchase", "shareholder return"],
}

SPEAKER_PATTERNS = {
    "ceo": re.compile(r'\b(?:CEO|Chief Executive|president and CEO|co-CEO)\b', re.IGNORECASE),
    "cfo": re.compile(r'\b(?:CFO|Chief Financial|finance chief)\b', re.IGNORECASE),
    "coo": re.compile(r'\b(?:COO|Chief Operating)\b', re.IGNORECASE),
    "analyst": re.compile(r'\b(?:analyst|analyst from|at \w+ capital|at \w+ securities)\b', re.IGNORECASE),
    "operator": re.compile(r'\b(?:operator|coordinator|moderator)\b', re.IGNORECASE),
}


# ── Data Classes ───────────────────────────────────────────────────────────────

@dataclass
class SentenceSentiment:
    """Sentiment result for a single sentence."""
    text: str
    score: float                    # -1.0 to +1.0
    magnitude: float                # 0.0 to 1.0 (strength of signal)
    label: str                      # positive | neutral | negative
    topics: list[str] = field(default_factory=list)
    speaker: str = ""
    positive_terms: list[str] = field(default_factory=list)
    negative_terms: list[str] = field(default_factory=list)
    is_forward_looking: bool = False
    confidence: float = 0.8


@dataclass
class DocumentSentiment:
    """Aggregated sentiment for a full document (earnings call, filing section)."""
    document_id: str
    ticker: str
    period: str                     # e.g. "Q3 2024", "FY2023"
    document_type: str              # earnings_transcript, 10-K, 8-K

    overall_score: float            # -1.0 to +1.0
    overall_label: str              # positive | neutral | negative
    magnitude: float

    # By speaker
    ceo_score: float | None = None
    cfo_score: float | None = None
    analyst_score: float | None = None

    # By topic
    topic_scores: dict[str, float] = field(default_factory=dict)

    # Time-segmented (call transcript)
    prepared_remarks_score: float | None = None
    qa_session_score: float | None = None

    # Detail
    sentence_sentiments: list[SentenceSentiment] = field(default_factory=list)
    key_positive_quotes: list[str] = field(default_factory=list)
    key_negative_quotes: list[str] = field(default_factory=list)
    forward_looking_score: float | None = None

    latency_ms: float = 0.0


@dataclass
class SentimentDelta:
    """Delta between current and prior period sentiment."""
    ticker: str
    current_period: str
    prior_period: str
    overall_delta: float            # current - prior
    topic_deltas: dict[str, float] = field(default_factory=dict)
    ceo_delta: float | None = None
    narrative: str = ""             # LLM-generated change summary


# ── Sentiment Engine ───────────────────────────────────────────────────────────

class SentimentEngine:
    """
    Financial earnings sentiment engine.
    Sentence-level scoring with topic tagging, speaker detection, and delta tracking.
    """

    def __init__(self, redis_client=None, llm_client=None):
        self.redis = redis_client
        self.llm = llm_client       # optional — only for delta narratives

    # ── Public API ─────────────────────────────────────────────────────────────

    async def score_document(
        self,
        document_id: str,
        ticker: str,
        period: str,
        document_type: str,
        text: str,
    ) -> DocumentSentiment:
        """Score a full document (earnings transcript, 10-K section, 8-K)."""
        # Check cache
        cached = await self._load_cache(document_id)
        if cached:
            return cached

        start = time.time()
        sentences = self._split_sentences(text)
        section = self._detect_section(text)

        sentence_results: list[SentenceSentiment] = []
        speaker = ""
        prepared_scores: list[float] = []
        qa_scores: list[float] = []
        in_qa = False

        for sent in sentences:
            # Detect speaker transitions
            new_speaker = self._detect_speaker(sent)
            if new_speaker:
                speaker = new_speaker
            if re.search(r'\bQ&A\b|\bquestion.and.answer\b|\bquestions?\b', sent, re.I):
                in_qa = True

            result = self._score_sentence(sent, speaker)
            sentence_results.append(result)

            if in_qa:
                qa_scores.append(result.score)
            else:
                prepared_scores.append(result.score)

        doc = self._aggregate(
            document_id=document_id,
            ticker=ticker,
            period=period,
            document_type=document_type,
            sentence_results=sentence_results,
            prepared_scores=prepared_scores,
            qa_scores=qa_scores,
        )
        doc.latency_ms = (time.time() - start) * 1000

        await self._store_cache(document_id, doc)
        logger.info(
            "sentiment_scored",
            ticker=ticker,
            period=period,
            score=round(doc.overall_score, 3),
            sentences=len(sentence_results),
            latency_ms=round(doc.latency_ms, 1),
        )
        return doc

    async def compute_delta(
        self,
        ticker: str,
        current_doc_id: str,
        prior_doc_id: str,
        current_period: str,
        prior_period: str,
    ) -> SentimentDelta:
        """Compute sentiment change between two periods."""
        current = await self._load_cache(current_doc_id)
        prior = await self._load_cache(prior_doc_id)

        if not current or not prior:
            return SentimentDelta(
                ticker=ticker,
                current_period=current_period,
                prior_period=prior_period,
                overall_delta=0.0,
            )

        delta = SentimentDelta(
            ticker=ticker,
            current_period=current_period,
            prior_period=prior_period,
            overall_delta=round(current.overall_score - prior.overall_score, 3),
        )

        # Topic deltas
        all_topics = set(current.topic_scores) | set(prior.topic_scores)
        for topic in all_topics:
            curr_t = current.topic_scores.get(topic, 0.0)
            prior_t = prior.topic_scores.get(topic, 0.0)
            delta.topic_deltas[topic] = round(curr_t - prior_t, 3)

        # CEO delta
        if current.ceo_score is not None and prior.ceo_score is not None:
            delta.ceo_delta = round(current.ceo_score - prior.ceo_score, 3)

        # Generate narrative via LLM if available
        if self.llm:
            delta.narrative = await self._generate_delta_narrative(delta, current, prior)
        else:
            delta.narrative = self._simple_delta_narrative(delta)

        return delta

    def score_sentence_sync(self, text: str, speaker: str = "") -> SentenceSentiment:
        """Synchronous single sentence scoring (no async needed)."""
        return self._score_sentence(text, speaker)

    # ── Core Scoring ───────────────────────────────────────────────────────────

    def _score_sentence(self, text: str, speaker: str = "") -> SentenceSentiment:
        text_lower = text.lower()
        words = re.findall(r'\b\w+\b', text_lower)

        score = 0.0
        matched_positive: list[str] = []
        matched_negative: list[str] = []

        # Check for negation context (look-behind window of 3 words)
        for i, word in enumerate(words):
            window_start = max(0, i - 3)
            window = words[window_start:i]
            negated = any(w in NEGATIONS for w in window)

            if word in POSITIVE_TERMS:
                term_score = POSITIVE_TERMS[word]
                if negated:
                    term_score = -term_score * 0.5
                    matched_negative.append(word)
                else:
                    matched_positive.append(word)
                # Apply intensifier from preceding window
                intensifier = max((INTENSIFIERS.get(w, 1.0) for w in window), default=1.0)
                score += term_score * intensifier

            elif word in NEGATIVE_TERMS:
                term_score = NEGATIVE_TERMS[word]
                if negated:
                    term_score = -term_score * 0.5
                    matched_positive.append(word)
                else:
                    matched_negative.append(word)
                intensifier = max((INTENSIFIERS.get(w, 1.0) for w in window), default=1.0)
                score += term_score * intensifier

        # Apply hedging: forward-looking sentences are modulated
        hedge_factor = 1.0
        is_forward_looking = False
        for hedge, factor in HEDGES.items():
            if hedge in text_lower:
                hedge_factor = min(hedge_factor, factor)
                is_forward_looking = True

        score *= hedge_factor

        # Clamp to [-1, 1]
        score = max(-1.0, min(1.0, score))
        magnitude = abs(score)

        # Label
        if score > 0.1:
            label = "positive"
        elif score < -0.1:
            label = "negative"
        else:
            label = "neutral"

        # Topic detection
        topics = []
        for topic, keywords in TOPIC_KEYWORDS.items():
            if any(kw in text_lower for kw in keywords):
                topics.append(topic)

        # Speaker detection
        detected_speaker = self._detect_speaker(text) or speaker

        return SentenceSentiment(
            text=text,
            score=round(score, 4),
            magnitude=round(magnitude, 4),
            label=label,
            topics=topics,
            speaker=detected_speaker,
            positive_terms=matched_positive[:5],
            negative_terms=matched_negative[:5],
            is_forward_looking=is_forward_looking,
        )

    def _aggregate(
        self,
        document_id: str,
        ticker: str,
        period: str,
        document_type: str,
        sentence_results: list[SentenceSentiment],
        prepared_scores: list[float],
        qa_scores: list[float],
    ) -> DocumentSentiment:
        if not sentence_results:
            return DocumentSentiment(
                document_id=document_id,
                ticker=ticker,
                period=period,
                document_type=document_type,
                overall_score=0.0,
                overall_label="neutral",
                magnitude=0.0,
            )

        all_scores = [s.score for s in sentence_results]
        overall = sum(all_scores) / len(all_scores)
        magnitude = sum(abs(s) for s in all_scores) / len(all_scores)

        # Topic aggregation
        topic_scores: dict[str, list[float]] = {}
        ceo_scores: list[float] = []
        cfo_scores: list[float] = []
        analyst_scores: list[float] = []
        forward_scores: list[float] = []

        key_positive: list[str] = []
        key_negative: list[str] = []

        for s in sentence_results:
            for topic in s.topics:
                topic_scores.setdefault(topic, []).append(s.score)
            if s.speaker == "ceo":
                ceo_scores.append(s.score)
            elif s.speaker == "cfo":
                cfo_scores.append(s.score)
            elif s.speaker == "analyst":
                analyst_scores.append(s.score)
            if s.is_forward_looking:
                forward_scores.append(s.score)
            if s.score > 0.5 and len(key_positive) < 3:
                key_positive.append(s.text[:150])
            elif s.score < -0.5 and len(key_negative) < 3:
                key_negative.append(s.text[:150])

        return DocumentSentiment(
            document_id=document_id,
            ticker=ticker,
            period=period,
            document_type=document_type,
            overall_score=round(overall, 4),
            overall_label="positive" if overall > 0.1 else "negative" if overall < -0.1 else "neutral",
            magnitude=round(magnitude, 4),
            ceo_score=round(sum(ceo_scores) / len(ceo_scores), 4) if ceo_scores else None,
            cfo_score=round(sum(cfo_scores) / len(cfo_scores), 4) if cfo_scores else None,
            analyst_score=round(sum(analyst_scores) / len(analyst_scores), 4) if analyst_scores else None,
            topic_scores={t: round(sum(v) / len(v), 4) for t, v in topic_scores.items()},
            prepared_remarks_score=round(sum(prepared_scores) / len(prepared_scores), 4) if prepared_scores else None,
            qa_session_score=round(sum(qa_scores) / len(qa_scores), 4) if qa_scores else None,
            sentence_sentiments=sentence_results,
            key_positive_quotes=key_positive,
            key_negative_quotes=key_negative,
            forward_looking_score=round(sum(forward_scores) / len(forward_scores), 4) if forward_scores else None,
        )

    # ── Helpers ────────────────────────────────────────────────────────────────

    def _split_sentences(self, text: str) -> list[str]:
        """Simple sentence splitter (no spaCy dependency)."""
        # Split on period/exclamation/question followed by space and capital
        parts = re.split(r'(?<=[.!?])\s+(?=[A-Z])', text)
        return [p.strip() for p in parts if len(p.strip()) > 20]

    def _detect_speaker(self, text: str) -> str:
        for speaker, pattern in SPEAKER_PATTERNS.items():
            if pattern.search(text):
                return speaker
        return ""

    def _detect_section(self, text: str) -> str:
        if re.search(r'Q&A|question.and.answer|open for questions', text, re.I):
            return "transcript"
        if re.search(r'risk factor|item 1a', text, re.I):
            return "10k_risks"
        if re.search(r"management.s discussion|MD&A|item 7", text, re.I):
            return "mda"
        return "unknown"

    def _simple_delta_narrative(self, delta: SentimentDelta) -> str:
        direction = "improved" if delta.overall_delta > 0 else "declined"
        magnitude = "significantly" if abs(delta.overall_delta) > 0.2 else "slightly"
        return (
            f"{delta.ticker} sentiment {magnitude} {direction} from {delta.prior_period} "
            f"to {delta.current_period} (delta: {delta.overall_delta:+.3f})."
        )

    async def _generate_delta_narrative(
        self,
        delta: SentimentDelta,
        current: DocumentSentiment,
        prior: DocumentSentiment,
    ) -> str:
        """Use LLM to generate a nuanced delta narrative."""
        try:
            top_changes = sorted(
                delta.topic_deltas.items(),
                key=lambda x: abs(x[1]),
                reverse=True,
            )[:3]
            change_summary = ", ".join(f"{t}: {v:+.2f}" for t, v in top_changes)

            prompt = (
                f"Summarize the sentiment change for {delta.ticker} earnings calls in 1-2 sentences:\n"
                f"Prior period ({delta.prior_period}): score={prior.overall_score:.2f}\n"
                f"Current period ({delta.current_period}): score={current.overall_score:.2f}\n"
                f"Overall delta: {delta.overall_delta:+.3f}\n"
                f"Biggest topic changes: {change_summary}\n"
                f"Key positive quotes: {current.key_positive_quotes[:1]}\n"
                f"Key negative quotes: {current.key_negative_quotes[:1]}"
            )

            response = await self.llm.complete(
                messages=[{"role": "user", "content": prompt}],
                max_tokens=100,
                temperature=0.3,
            )
            return response.content if hasattr(response, 'content') else str(response)
        except Exception as e:
            logger.warning("delta_narrative_failed", error=str(e))
            return self._simple_delta_narrative(delta)

    # ── Cache ──────────────────────────────────────────────────────────────────

    async def _load_cache(self, document_id: str) -> DocumentSentiment | None:
        if not self.redis:
            return None
        try:
            key = f"{_CACHE_PREFIX}{document_id}"
            raw = await self.redis.get(key)
            if raw:
                data = json.loads(raw)
                return self._deserialize(data)
        except Exception as e:
            logger.warning("sentiment_cache_load_failed", error=str(e))
        return None

    async def _store_cache(self, document_id: str, doc: DocumentSentiment) -> None:
        if not self.redis:
            return
        try:
            key = f"{_CACHE_PREFIX}{document_id}"
            data = self._serialize(doc)
            await self.redis.setex(key, _CACHE_TTL, json.dumps(data, ensure_ascii=False))
        except Exception as e:
            logger.warning("sentiment_cache_store_failed", error=str(e))

    def _serialize(self, doc: DocumentSentiment) -> dict:
        return {
            "document_id": doc.document_id,
            "ticker": doc.ticker,
            "period": doc.period,
            "document_type": doc.document_type,
            "overall_score": doc.overall_score,
            "overall_label": doc.overall_label,
            "magnitude": doc.magnitude,
            "ceo_score": doc.ceo_score,
            "cfo_score": doc.cfo_score,
            "analyst_score": doc.analyst_score,
            "topic_scores": doc.topic_scores,
            "prepared_remarks_score": doc.prepared_remarks_score,
            "qa_session_score": doc.qa_session_score,
            "key_positive_quotes": doc.key_positive_quotes,
            "key_negative_quotes": doc.key_negative_quotes,
            "forward_looking_score": doc.forward_looking_score,
            "latency_ms": doc.latency_ms,
            # Skip sentence_sentiments for storage efficiency
        }

    def _deserialize(self, data: dict) -> DocumentSentiment:
        return DocumentSentiment(
            document_id=data["document_id"],
            ticker=data["ticker"],
            period=data["period"],
            document_type=data["document_type"],
            overall_score=data["overall_score"],
            overall_label=data["overall_label"],
            magnitude=data["magnitude"],
            ceo_score=data.get("ceo_score"),
            cfo_score=data.get("cfo_score"),
            analyst_score=data.get("analyst_score"),
            topic_scores=data.get("topic_scores", {}),
            prepared_remarks_score=data.get("prepared_remarks_score"),
            qa_session_score=data.get("qa_session_score"),
            key_positive_quotes=data.get("key_positive_quotes", []),
            key_negative_quotes=data.get("key_negative_quotes", []),
            forward_looking_score=data.get("forward_looking_score"),
            latency_ms=data.get("latency_ms", 0.0),
        )
