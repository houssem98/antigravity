"""
Gravity Search — Critic Agent
Evaluates quality of extracted data and decides whether to loop back to Planner.

Checks:
  - Coverage: are all sub-questions answered?
  - Citation density: does every claim have a source?
  - Confidence: are confidence scores high enough?
  - Contradictions: are there conflicting data points?

If quality < threshold → returns CriticFeedback with retry guidance.
Max retries enforced by AgentContext.max_iterations.
"""

from __future__ import annotations

import json
import time
import structlog

from app.llm.base import BaseLLMClient, LLMConfig, LLMMessage
from app.core.agents.agent_base import BaseAgent, AgentContext, CriticFeedback
from app.core.reasoning.financial_rubric import RubricEvaluator

logger = structlog.get_logger()

QUALITY_THRESHOLD = 0.7

CRITIC_SYSTEM = """You are a quality assurance agent for financial research.
Your task: evaluate whether the extracted data adequately answers the original
research question, and identify any gaps or issues.

Evaluate these dimensions:
1. COVERAGE: Are ALL sub-questions fully answered? List any unanswered ones.
2. CITATION DENSITY: Does every fact have a source? Flag unsupported claims.
3. CONFIDENCE: Are the confidence scores appropriate? Flag any questionable ones.
4. CONTRADICTIONS: Do any extracted facts conflict with each other?
5. COMPLETENESS: Are there obvious follow-up data points that should have been extracted?
6. SOURCE DIVERSITY: Are facts sourced from multiple independent sources, or all from
   a single company's own filings (inherent bias risk)?

Respond with ONLY valid JSON:
{
  "quality_score": 0.0 to 1.0,
  "reasoning": "Brief explanation of the score",
  "coverage_gaps": ["sub-question or topic not adequately covered"],
  "unsupported_claims": ["claim without proper source backing"],
  "contradictions": ["description of conflicting data points"],
  "source_diversity_warning": "null or warning if all facts from single source/company",
  "retry_guidance": "If quality < 0.7, specific instructions for what to search for next"
}"""


class CriticAgent(BaseAgent):
    """Evaluates research quality and decides whether to loop."""

    name = "Critic"

    def __init__(self, llm: BaseLLMClient):
        self.llm = llm
        # Rubric evaluator: replaces simple LLM quality float
        # Papers 1+2+3: RaR + RTD + ResearchRubrics
        self._rubric_evaluator = RubricEvaluator(llm)

    async def execute(self, ctx: AgentContext) -> AgentContext:
        """Evaluate quality of extracted data."""
        t0 = time.perf_counter()

        # Build summary of what we have
        facts_summary = self._summarize_facts(ctx)
        subtask_summary = self._summarize_subtasks(ctx)

        # Source diversity analysis (deterministic, no LLM needed)
        diversity_note = self._analyze_source_diversity(ctx)

        user_content = (
            f"Original query: {ctx.query}\n\n"
            f"Sub-tasks and their status:\n{subtask_summary}\n\n"
            f"Extracted facts ({len(ctx.extracted_facts)} total):\n{facts_summary}\n\n"
            f"Source diversity analysis:\n{diversity_note}\n\n"
            f"Narratives:\n{json.dumps(ctx.query_plan.get('_narratives', []), indent=2, default=str)}"
        )

        # ── Rubric-Based Evaluation (Papers 1+2+3) ───────────────────
        # Replaces simple quality float with structured rubric scoring.
        # RaR (arXiv 2507.17746): instance-specific rubric criteria
        # RTD (arXiv 2509.21500): performance-frontier refinement
        # ResearchRubrics (arXiv 2511.07685): 6-axis evaluation, ternary scoring
        rubric_result = await self._rubric_evaluator.evaluate(
            query=ctx.query,
            answer_summary=ctx.query_plan.get("_answer_draft", facts_summary[:1000]),
            sources_summary=self._summarize_sources(ctx),
            extracted_facts_summary=facts_summary,
            sub_tasks_summary=subtask_summary,
            iteration=ctx.iteration,
            max_iterations=ctx.max_iterations,
        )
        ctx.total_cost_usd += rubric_result.cost_usd

        quality = rubric_result.rubric_score
        is_sufficient = rubric_result.is_sufficient
        can_retry = ctx.iteration < ctx.max_iterations

        # Dead-end detection: penalize if facts haven't changed since last iteration
        if ctx.iteration > 0 and self._is_dead_end(ctx):
            logger.info(
                "critic_dead_end_detected",
                iteration=ctx.iteration,
                rubric_score=quality,
            )
            is_sufficient = True
            rubric_result.retry_guidance = (
                "Dead-end detected: no new information found vs. prior iteration. "
                "Proceeding with current data to avoid infinite loop."
            )

        ctx.critic_feedback = CriticFeedback(
            quality_score=quality,
            is_sufficient=is_sufficient or not can_retry,
            coverage_gaps=rubric_result.coverage_gaps,
            unsupported_claims=rubric_result.unsupported_claims,
            contradiction_flags=rubric_result.contradictions,
            retry_guidance=rubric_result.retry_guidance,
        )

        # Attach source diversity and rubric axis scores to feedback
        if rubric_result.source_diversity_warning:
            ctx.critic_feedback.contradiction_flags.append(
                f"[SOURCE DIVERSITY] {rubric_result.source_diversity_warning}"
            )

        # Store axis scores for Writer to use (e.g., flag weak synthesis axis)
        ctx.query_plan["_rubric_axis_scores"] = rubric_result.axis_scores
        ctx.query_plan["_rubric_score"] = quality

        elapsed = (time.perf_counter() - t0) * 1000

        # Log pitfall violations (most important for debugging)
        pitfall_violations = [
            c for c in rubric_result.criteria
            if c.category == "Pitfall" and c.score < 1.0
        ]

        if is_sufficient:
            ctx.add_trace(
                self.name, "approved",
                f"Rubric {quality:.2f} ≥ {QUALITY_THRESHOLD} | "
                f"axes={rubric_result.axis_scores} | "
                f"pitfalls={len(pitfall_violations)} — proceeding to Writer",
                duration_ms=elapsed,
            )
        elif can_retry:
            ctx.add_trace(
                self.name, "retry_requested",
                f"Rubric {quality:.2f} < {QUALITY_THRESHOLD} | "
                f"gaps: {rubric_result.coverage_gaps[:2]}",
                duration_ms=elapsed,
            )
        else:
            ctx.add_trace(
                self.name, "max_retries",
                f"Rubric {quality:.2f} but max iterations ({ctx.max_iterations}) reached — proceeding anyway",
                duration_ms=elapsed,
            )

        return ctx

    def _summarize_facts(self, ctx: AgentContext) -> str:
        """Build a concise summary of extracted facts for the LLM."""
        if not ctx.extracted_facts:
            return "No facts extracted yet."

        lines = []
        for i, fact in enumerate(ctx.extracted_facts[:30], 1):  # Cap at 30
            entity = fact.get("entity", "")
            metric = fact.get("metric", "")
            value = fact.get("value", "")
            unit = fact.get("unit", "")
            period = fact.get("period", "")
            conf = fact.get("confidence", "?")
            src = fact.get("source_id", "?")
            lines.append(
                f"  {i}. {entity} | {metric}: {value} {unit} | {period} | "
                f"conf={conf} | src={src}"
            )
        return "\n".join(lines)

    def _summarize_sources(self, ctx: AgentContext) -> str:
        """Compact source summary for rubric evaluation prompt."""
        lines = []
        src_idx = 1
        for st in ctx.sub_tasks:
            for p in ctx.retrieved_passages.get(st.id, [])[:3]:
                lines.append(
                    f"[Source {src_idx}] {p.document_title} ({getattr(p, 'filing_date', '')})"
                    f" [{getattr(p, 'ticker', '')}]"
                )
                src_idx += 1
        return "\n".join(lines) if lines else "No sources retrieved."

    def _analyze_source_diversity(self, ctx: AgentContext) -> str:
        """
        Deterministic source diversity check — no LLM needed.
        Research: "All facts from one company's own 10-K = inherent bias" (FActScore paper).
        Returns a diversity summary string to include in the critic prompt.
        """
        if not ctx.extracted_facts:
            return "No facts extracted yet."

        # Count unique source IDs and tickers
        source_ids = set()
        tickers = set()
        for fact in ctx.extracted_facts:
            sid = fact.get("source_id")
            if sid:
                source_ids.add(sid)
            ticker = fact.get("ticker") or fact.get("entity")
            if ticker:
                tickers.add(ticker)

        lines = [
            f"Unique source documents: {len(source_ids)}",
            f"Unique companies/tickers: {len(tickers)}",
        ]

        if len(source_ids) <= 1:
            lines.append(
                "WARNING: All facts from a single source document — "
                "high bias risk. Confidence should be MEDIUM or lower."
            )
        elif len(tickers) == 1 and len(source_ids) < 3:
            lines.append(
                "CAUTION: Facts only from one company's own filings — "
                "no independent corroboration. Note this limitation in answer."
            )
        else:
            lines.append("Diversity: adequate — multiple independent sources present.")

        return "\n".join(lines)

    def _is_dead_end(self, ctx: AgentContext) -> bool:
        """
        Dead-end detection: checks if the current iteration produced no new
        unique facts compared to what was already in the context.
        Research: CoRAG / IRCoT — "stop if no new information" criterion.
        """
        if not hasattr(ctx, "_prev_fact_fingerprint"):
            return False

        # Compute fingerprint of current facts
        current_fingerprint = frozenset(
            (f.get("metric", ""), str(f.get("value", "")), f.get("period", ""))
            for f in ctx.extracted_facts
        )
        prev_fingerprint = ctx._prev_fact_fingerprint  # type: ignore[attr-defined]

        new_facts = current_fingerprint - prev_fingerprint
        is_dead_end = len(new_facts) == 0

        if is_dead_end:
            logger.info(
                "dead_end_no_new_facts",
                total_facts=len(ctx.extracted_facts),
                iteration=ctx.iteration,
            )

        return is_dead_end

    def _summarize_subtasks(self, ctx: AgentContext) -> str:
        """Summarize sub-tasks and whether they have results."""
        lines = []
        for st in ctx.sub_tasks:
            passages = ctx.retrieved_passages.get(st.id, [])
            facts = [f for f in ctx.extracted_facts if f.get("sub_task_id") == st.id]
            status = "✅" if facts else ("📄" if passages else "❌")
            lines.append(
                f"  {status} [{st.id}] {st.question} — "
                f"{len(passages)} passages, {len(facts)} facts"
            )
        return "\n".join(lines)
