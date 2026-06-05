"""
Gravity Search — LLM Council (Karpathy-style ensemble)

For the highest-stakes financial answers (contradiction detection, investment
thesis) a single model is risky. The council queries several frontier models,
has them anonymously peer-rank each other's answers, then a chairman synthesizes
the final, citation-grounded answer.

Pattern (https://github.com/karpathy/llm-council):
  Stage 1  Dispatch   — all members answer the same prompt in parallel.
  Stage 2  Peer review — each member ranks the *anonymized* answers (no self-bias).
  Stage 3  Synthesis  — the chairman fuses answers + rankings into one answer.

This is expensive (~N+1 model calls), so it is gated to the ~8% of queries that
justify it (see complexity routing). Members/chairman are pulled from the
existing LLMRouter, so missing API keys degrade gracefully: with fewer than two
live members the council falls back to a single chairman call.
"""

from __future__ import annotations

import asyncio
import structlog
from dataclasses import dataclass, field

from app.llm.base import LLMMessage, LLMConfig

logger = structlog.get_logger()

# Default council. Order is cosmetic; identities are anonymized in peer review.
DEFAULT_MEMBERS = ["gpt5", "claude_opus", "gemini_pro"]
DEFAULT_CHAIRMAN = "claude_opus"  # top FinanceReasoning accuracy + token-efficient


@dataclass
class CouncilMemberAnswer:
    model_key: str
    answer: str
    error: str | None = None


@dataclass
class CouncilResult:
    final_answer: str
    chairman: str
    member_answers: list[CouncilMemberAnswer] = field(default_factory=list)
    rankings: list[str] = field(default_factory=list)  # raw ranking texts
    members_used: list[str] = field(default_factory=list)


class LLMCouncil:
    def __init__(
        self,
        router,
        members: list[str] | None = None,
        chairman: str | None = None,
    ):
        self._router = router
        self._members = members or DEFAULT_MEMBERS
        self._chairman = chairman or DEFAULT_CHAIRMAN

    def _live(self, keys: list[str]) -> list[str]:
        live = []
        for k in keys:
            try:
                self._router.get_client(k)
                live.append(k)
            except Exception:
                continue
        return live

    async def deliberate(self, question: str, context: str) -> CouncilResult:
        """Run the 3-stage council. `context` is the retrieved, cited evidence."""
        members = self._live(self._members)
        chairman = self._chairman if self._live([self._chairman]) else (members[0] if members else None)

        if not members or chairman is None:
            raise RuntimeError("No council members available (no LLM keys live)")

        # ── Stage 1: parallel answers ──────────────────────────────────────
        answers = await asyncio.gather(
            *[self._answer(k, question, context) for k in members]
        )
        valid = [a for a in answers if a.error is None and a.answer.strip()]

        # Degenerate case: <2 valid answers → just use the chairman directly.
        if len(valid) < 2:
            if valid:
                final = valid[0].answer
            else:
                final = (await self._answer(chairman, question, context)).answer
            return CouncilResult(
                final_answer=final, chairman=chairman,
                member_answers=answers, members_used=members,
            )

        # ── Stage 2: anonymized peer review ────────────────────────────────
        labeled = {f"Answer {chr(65 + i)}": a for i, a in enumerate(valid)}
        rankings = await asyncio.gather(
            *[self._rank(a.model_key, question, labeled) for a in valid]
        )

        # ── Stage 3: chairman synthesis ────────────────────────────────────
        final = await self._synthesize(chairman, question, context, labeled, rankings)
        return CouncilResult(
            final_answer=final,
            chairman=chairman,
            member_answers=answers,
            rankings=rankings,
            members_used=members,
        )

    async def _answer(self, model_key: str, question: str, context: str) -> CouncilMemberAnswer:
        try:
            client = self._router.get_client(model_key)
            resp = await client.generate(
                messages=[LLMMessage(role="user", content=(
                    "You are a financial analyst. Answer the question using ONLY the "
                    "evidence below. Cite specific figures. If the evidence is "
                    "insufficient or sources conflict, say so explicitly.\n\n"
                    f"EVIDENCE:\n{context}\n\nQUESTION: {question}"
                ))],
                config=LLMConfig(temperature=0.1, max_tokens=2000),
            )
            return CouncilMemberAnswer(model_key=model_key, answer=resp.content)
        except Exception as e:
            logger.warning("council_member_failed", model=model_key, error=str(e)[:200])
            return CouncilMemberAnswer(model_key=model_key, answer="", error=str(e))

    async def _rank(self, model_key: str, question: str, labeled: dict[str, CouncilMemberAnswer]) -> str:
        block = "\n\n".join(f"{label}:\n{a.answer}" for label, a in labeled.items())
        try:
            client = self._router.get_client(model_key)
            resp = await client.generate(
                messages=[LLMMessage(role="user", content=(
                    "Below are anonymized answers to a financial question. Rank them "
                    "from best to worst by factual accuracy, correct use of the cited "
                    "figures, and analytical insight. Give the ranking (e.g. 'B > A > C') "
                    "and one sentence of justification per answer.\n\n"
                    f"QUESTION: {question}\n\n{block}"
                ))],
                config=LLMConfig(temperature=0.0, max_tokens=600),
            )
            return resp.content
        except Exception as e:
            logger.warning("council_rank_failed", model=model_key, error=str(e)[:200])
            return ""

    async def _synthesize(
        self, chairman: str, question: str, context: str,
        labeled: dict[str, CouncilMemberAnswer], rankings: list[str],
    ) -> str:
        answers_block = "\n\n".join(f"{label}:\n{a.answer}" for label, a in labeled.items())
        rankings_block = "\n\n".join(r for r in rankings if r)
        client = self._router.get_client(chairman)
        resp = await client.generate(
            messages=[LLMMessage(role="user", content=(
                "You are the chairman of a financial research council. Using the "
                "council's answers and their peer rankings, write the single best "
                "final answer. Resolve disagreements by deferring to the evidence; "
                "when sources genuinely conflict, surface the conflict explicitly. "
                "Cite specific figures.\n\n"
                f"EVIDENCE:\n{context}\n\nQUESTION: {question}\n\n"
                f"COUNCIL ANSWERS:\n{answers_block}\n\n"
                f"PEER RANKINGS:\n{rankings_block}"
            ))],
            config=LLMConfig(temperature=0.1, max_tokens=2500),
        )
        return resp.content
