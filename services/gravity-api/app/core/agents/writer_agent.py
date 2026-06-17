"""
Gravity Search — Writer Agent
Synthesizes the final answer from extracted facts and narratives.

Supports both:
  - QA mode: concise cited answer
  - Deep Research mode: institutional-grade report with tables

Every claim is hyperlinked to its source passage (existing citation system).
Structured data output is produced alongside the narrative.
"""

from __future__ import annotations

import json
import time
import structlog

from app.llm.base import BaseLLMClient, LLMConfig, LLMMessage
from app.core.agents.agent_base import BaseAgent, AgentContext
from app.core.safety.propensity_checker import get_safety_checker
from app.core.reasoning.prompts import strip_ai_wording
from app.core.finance.financial_skills import get_skills_loader

logger = structlog.get_logger()


WRITER_SYSTEM = """You are a financial research analyst. Write like a Goldman Sachs research note — not a chatbot.

PROCEDURAL DIMENSIONS (follow in order before writing):
- IDENTIFYING: List ALL relevant metrics, periods, entities from the data.
- CLEAR PROCESS: For each claim, name the exact source row it comes from.
- LOGICAL PROCESS: State how metrics interact — e.g. "Revenue +12% with gross margin -80bps implies COGS grew faster than revenue."
- HELPFUL OUTCOME: Lead with the direct answer the user needs — not background.
- HARMLESS OUTCOME: Label guidance explicitly. No investment advice. No speculation stated as fact.

STRICT OUTPUT RULES:
1. INLINE CITATIONS: Every numeric claim ends with [N] mapping to citations[].
   No number without a citation. Example: "Revenue was $124.3B (+11.8% YoY) [1]."
2. FOOTNOTE BLOCK: answer field MUST end with this exact block — no exceptions:
   ---
   **Sources**
   [1] {document_title}, {section} ({filing_date}) [{ticker}]: *"exact verbatim quote"*
3. TABLES: For 2+ entities OR 3+ time periods, include a markdown table BEFORE the footnote block:
   | Metric | Period A | Period B | Change |
   |--------|----------|----------|--------|
4. NUMBERS: "$124.3B" not "approximately $124 billion". Show absolute AND % change: "$124.3B (+11.8% YoY)".
5. TONE — BANNED WORDS (rewrite any sentence containing these):
   on-the-ground, delve, noteworthy, robust performance, it is worth noting,
   comprehensive, significant strides, key takeaways, in conclusion, to summarize,
   leveraging, synergies, holistic, actionable insights, deep dive, game-changing,
   paradigm, value-add, going forward, touch base, at the end of the day, moving forward.
   Write: active voice, past tense for reported data, conditional for guidance.
   Start sentences with a number or company name — never "The company" or "It".
6. CHART SPECS: For time-series (same metric+entity, 3+ periods) emit a line chart.
   For cross-sectional comparisons (same metric, 2+ entities, 1 period) emit a bar chart.
7. GUIDANCE: Append "(mgmt guidance)", "(consensus est.)", or "(projected)" after any forward figure.
8. SELF-CHECK: Verify growth rates, margin formulas, component sums before writing answer.

Output ONLY valid JSON:
{
  "reasoning_trace": "IDENTIFYING: ... | CLEAR PROCESS: ... | LOGICAL PROCESS: ...",
  "answer": "Markdown with [1][2] inline citations AND footnote block at the very end",
  "citations": [
    {
      "citation_number": 1,
      "source_id": "src_1",
      "document_title": "Apple 10-K FY2025",
      "section": "Item 7 MD&A",
      "filing_date": "2025-10-30",
      "ticker": "AAPL",
      "text": "EXACT verbatim quote — never paraphrase"
    }
  ],
  "self_check": [
    {"claim": "Revenue grew 11.8%", "verified": true, "check": "124.3/111.2 - 1 = 11.8%"}
  ],
  "confidence": "HIGH|MEDIUM|LOW",
  "structured_data": [
    {
      "row_id": "row_0",
      "metric": "Revenue",
      "entity": "AAPL",
      "value": 124.3,
      "unit": "USD Billion",
      "period": "Q4 FY2025",
      "source_id": "src_1"
    }
  ],
  "chart_specs": [
    {
      "chart_id": "unique_snake_case_id",
      "chart_type": "line|bar|stacked_bar",
      "title": "Entity — Metric (Period Range)",
      "x_axis": "period|entity",
      "y_axis": "value",
      "y_label": "USD Billion|%|x",
      "series": [{"entity": "AAPL", "metric": "Revenue"}],
      "data_refs": ["row_0", "row_1", "row_2"]
    }
  ]
}"""


class WriterAgent(BaseAgent):
    """Synthesizes the final answer from extracted facts."""

    name = "Writer"

    def __init__(self, llm: BaseLLMClient):
        self.llm = llm

    async def execute(self, ctx: AgentContext) -> AgentContext:
        """Produce the final synthesized answer."""
        t0 = time.perf_counter()

        # Build context for the writer
        facts_block = self._format_facts(ctx)
        narratives_block = self._format_narratives(ctx)
        sources_block = self._format_sources(ctx)

        # ── Inject financial skills methodology ──────────────────
        skill_context = self._load_skill_context(ctx)
        system_prompt = WRITER_SYSTEM
        if skill_context:
            system_prompt = WRITER_SYSTEM + skill_context
            ctx.add_trace(
                self.name, "skill_injection",
                f"Injected {len(skill_context)} chars of financial methodology",
            )

        user_content = (
            f"## Original Query\n{ctx.query}\n\n"
            f"## Sub-task Narratives\n{narratives_block}\n\n"
            f"## Extracted Structured Data\n{facts_block}\n\n"
            f"## Source Passages\n{sources_block}"
        )

        response = await self.llm.generate(
            messages=[
                LLMMessage(role="system", content=system_prompt),
                LLMMessage(role="user", content=user_content),
            ],
            config=LLMConfig(temperature=0.1, max_tokens=4096, json_mode=True),
        )
        ctx.total_cost_usd += response.cost_usd

        try:
            result = json.loads(response.content)

            ctx.final_answer = result.get("answer", "")
            ctx.final_citations = result.get("citations", [])
            ctx.structured_data = result.get("structured_data", ctx.extracted_facts)
            ctx.chart_specs = result.get("chart_specs", [])

            # Never return empty: json_mode sometimes yields valid JSON with an empty
            # "answer" (the model put everything in reasoning, or truncated). Retry once
            # WITHOUT json_mode so the prose answer is the whole response.
            if not (ctx.final_answer or "").strip():
                logger.warning("writer_empty_answer_retry", query=ctx.query[:60])
                _retry = await self.llm.generate(
                    messages=[
                        LLMMessage(role="system", content=system_prompt),
                        LLMMessage(role="user", content=user_content
                                   + "\n\nWrite the answer as clean markdown prose with inline [n] citations. Do NOT wrap it in JSON."),
                    ],
                    config=LLMConfig(temperature=0.2, max_tokens=4096),
                )
                ctx.total_cost_usd += _retry.cost_usd
                if (_retry.content or "").strip():
                    ctx.final_answer = _retry.content.strip()

            # ── AI Wording Check ─────────────────────────────────────
            _, ai_phrases = strip_ai_wording(ctx.final_answer)
            if ai_phrases:
                logger.warning(
                    "ai_wording_detected",
                    phrases=ai_phrases[:5],
                    query=ctx.query[:60],
                )
                ctx.add_trace(
                    self.name, "ai_wording_warning",
                    f"Banned phrases found: {ai_phrases[:3]}",
                )

            confidence = result.get("confidence", "MEDIUM")

            # ── PropensityBench Safety Check (Paper 5) ───────────────
            # Rule-based latent safety scan: investment advice, overconfidence,
            # forward-guidance-as-fact, PII, uncited numeric claims.
            safety_checker = get_safety_checker()
            safety_result = await safety_checker.check(
                answer=ctx.final_answer,
                query=ctx.query,
                extracted_facts=ctx.extracted_facts,
                use_llm_check=False,  # Rule-based only in agentic mode (fast)
            )

            if not safety_result.is_safe:
                # Downgrade confidence and append safety warnings to answer
                if confidence == "HIGH":
                    confidence = "MEDIUM"
                for warning in safety_result.sanitized_warnings:
                    ctx.final_answer += f"\n\n{warning}"
                ctx.add_trace(
                    self.name, "safety_flag",
                    f"PropensityBench: {safety_result.critical_count} critical, "
                    f"{safety_result.high_count} high-severity issues detected",
                )
            elif safety_result.issues:
                ctx.add_trace(
                    self.name, "safety_advisory",
                    f"PropensityBench: {len(safety_result.issues)} advisory issues",
                )

            elapsed = (time.perf_counter() - t0) * 1000
            ctx.add_trace(
                self.name, "synthesized",
                f"Answer: {len(ctx.final_answer)} chars | "
                f"{len(ctx.final_citations)} citations | "
                f"confidence={confidence} | "
                f"safety={'OK' if safety_result.is_safe else 'FLAGGED'}",
                duration_ms=elapsed,
            )

        except (json.JSONDecodeError, KeyError) as e:
            logger.warning("writer_parse_failed", error=str(e))
            # Fallback: use the raw response as the answer
            ctx.final_answer = response.content
            ctx.final_citations = []
            ctx.structured_data = ctx.extracted_facts
            ctx.add_trace(self.name, "fallback", f"JSON parse failed: {e}")

        return ctx

    async def execute_streaming(self, ctx: AgentContext):
        """
        Stream the answer token-by-token. Yields individual tokens.

        Use this when the caller wants progressive rendering (WebSocket streaming).
        After streaming completes, ctx.final_answer is populated.
        """
        t0 = time.perf_counter()

        facts_block = self._format_facts(ctx)
        narratives_block = self._format_narratives(ctx)
        sources_block = self._format_sources(ctx)

        # For streaming we use a simpler prompt that outputs markdown directly
        streaming_system = (
            "You are a senior financial research analyst at Antigravity.\n"
            "Synthesize a comprehensive answer from the extracted data.\n\n"
            "Rules:\n"
            "1. Cite every claim as [Source N].\n"
            "2. Only use provided data — never fabricate.\n"
            "3. Lead with the answer, then evidence, then caveats.\n"
            "4. Include markdown tables for comparisons.\n"
            "5. End with confidence: HIGH / MEDIUM / LOW.\n"
            "6. Respond in clean markdown (NOT JSON)."
        )

        # ── Inject financial skills methodology for streaming ────
        skill_context = self._load_skill_context(ctx)
        if skill_context:
            streaming_system += skill_context

        user_content = (
            f"## Query\n{ctx.query}\n\n"
            f"## Narratives\n{narratives_block}\n\n"
            f"## Data\n{facts_block}\n\n"
            f"## Sources\n{sources_block}"
        )

        full_answer = ""
        async for token in self.llm.generate_stream(
            messages=[
                LLMMessage(role="system", content=streaming_system),
                LLMMessage(role="user", content=user_content),
            ],
            config=LLMConfig(temperature=0.1, max_tokens=4096),
        ):
            full_answer += token
            yield token

        ctx.final_answer = full_answer
        ctx.structured_data = ctx.extracted_facts

        elapsed = (time.perf_counter() - t0) * 1000
        ctx.add_trace(
            self.name, "streamed",
            f"Answer: {len(full_answer)} chars (streaming)",
            duration_ms=elapsed,
        )

    @staticmethod
    def _load_skill_context(ctx: AgentContext) -> str:
        """Load relevant financial methodology skills based on query content."""
        try:
            loader = get_skills_loader()
            intent = ctx.query_plan.get("intent") or ctx.query_plan.get("category")
            skill_context = loader.build_skill_context(
                query=ctx.query,
                intent=intent,
                max_chars=3000,
            )
            return skill_context
        except Exception as e:
            logger.warning("skill_context_load_failed", error=str(e))
            return ""

    def _format_facts(self, ctx: AgentContext) -> str:
        """Format extracted facts as a readable table for the LLM."""
        if not ctx.extracted_facts:
            return "No structured data extracted."

        lines = ["| # | Entity | Metric | Value | Unit | Period | Source | Conf |",
                  "|---|--------|--------|-------|------|--------|--------|------|"]
        for i, f in enumerate(ctx.extracted_facts[:40], 1):
            lines.append(
                f"| {i} | {f.get('entity', '')} | {f.get('metric', '')} | "
                f"{f.get('value', '')} | {f.get('unit', '')} | {f.get('period', '')} | "
                f"{f.get('source_id', '')} | {f.get('confidence', '')} |"
            )
        return "\n".join(lines)

    def _format_narratives(self, ctx: AgentContext) -> str:
        """Format sub-task narratives."""
        narratives = ctx.query_plan.get("_narratives", [])
        if not narratives:
            return "No narratives available."

        lines = []
        for n in narratives:
            lines.append(f"**{n.get('question', '')}**\n{n.get('narrative', '')}\n")
        return "\n".join(lines)

    def _format_sources(self, ctx: AgentContext) -> str:
        """Format source passages for the writer."""
        parts = []
        src_idx = 1
        for st in ctx.sub_tasks:
            passages = ctx.retrieved_passages.get(st.id, [])
            for p in passages[:5]:  # Top 5 per sub-task
                header = f"[Source {src_idx}] {p.document_title}"
                if hasattr(p, "ticker") and p.ticker:
                    header += f" ({p.ticker})"
                if hasattr(p, "section") and p.section:
                    header += f" — {p.section}"
                if hasattr(p, "filing_date") and p.filing_date:
                    header += f" [{p.filing_date}]"
                parts.append(f"{header}\n{p.text[:800]}")
                src_idx += 1
        return "\n\n---\n\n".join(parts) if parts else "No source passages available."
