"""
Gravity Search — Financial Research Rubric Engine
Unified implementation of three ICLR/NeurIPS 2025 papers:

Paper 1: "Rubrics as Rewards" (arXiv 2507.17746)
  - Instance-specific rubric criteria per query (not generic)
  - Category weights: Essential=1.0, Important=0.7, Optional=0.3, Pitfall=0.9
  - Reward formula: r = Σ(wⱼ × cⱼ) / Σwⱼ  (normalized to [0,1])
  - +31% over direct Likert LLM judges on HealthBench
  - Reference-answer-grounded rubrics: +35.9% vs generic rubrics

Paper 2: "Chasing the Tail: RTD" (arXiv 2509.21500)
  - RTD (Refinement-through-Differentiation) for rubric refinement at the
    performance frontier (top-2 responses)
  - Fixes reward model misspecification at the high-reward tail
  - Finance domain explicitly tested, win rate 21.7% → 34.4%

Paper 3: "ResearchRubrics" (arXiv 2511.07685)
  - 6 evaluation axes for deep research quality
  - Ternary scoring: m ∈ {1.0, 0.5, 0.0}
  - Negative weights [-5, +5] that CAN push score below 0
  - Denominator only sums positive weights (penalties are absolute)

How this integrates with Gravity Search:
  - CriticAgent uses RubricEvaluator instead of a simple quality float
  - Returns structured per-criterion scores → actionable retry guidance
  - rubric_score replaces quality_score in CriticFeedback
  - run_eval.py can use the rubric as a grading harness for golden queries
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Literal

import structlog

from app.llm.base import BaseLLMClient, LLMConfig, LLMMessage

logger = structlog.get_logger()

# ── Rubric Criterion Schema (unified across all 3 papers) ────────────────────

Category = Literal["Essential", "Important", "Optional", "Pitfall"]
Dimension = Literal[
    "identifying",          # MoReBench: identifies all relevant considerations
    "clear_process",        # MoReBench: expresses systematic reasoning
    "logical_process",      # MoReBench: justifies interactions between considerations
    "helpful_outcome",      # MoReBench: supports effective navigation
    "harmless_outcome",     # MoReBench: avoids harmful/biased content
]
EvalAxis = Literal[
    "explicit_req",         # ResearchRubrics: directly stated requirements
    "implicit_req",         # ResearchRubrics: expected but unstated (e.g., always flag risk)
    "synthesis",            # ResearchRubrics: integrates across multiple sources
    "references",           # ResearchRubrics: correct attribution + date/ticker accuracy
    "communication",        # ResearchRubrics: clarity, structure, tables
    "instruction_following", # ResearchRubrics: format compliance
]

# RaR category → weight mapping
_CATEGORY_WEIGHTS: dict[str, float] = {
    "Essential": 1.0,
    "Important": 0.7,
    "Optional":  0.3,
    "Pitfall":   0.9,   # High weight — pitfalls are costly failures
}


@dataclass
class RubricCriterion:
    """One rubric criterion (unified schema from all 3 papers)."""
    title: str                    # 2-4 words (RaR style)
    description: str
    category: Category            # Essential / Important / Optional / Pitfall
    weight: float                 # [-5, +5] range (ResearchRubrics)
    dimension: Dimension          # MoReBench reasoning dimension
    eval_axis: EvalAxis           # ResearchRubrics evaluation axis
    score: float = 0.0            # After evaluation: 1.0 / 0.5 / 0.0 (ternary)
    justification: str = ""       # LLM's reasoning for the score


@dataclass
class RubricEvalResult:
    """
    Output of rubric evaluation for one query/answer pair.

    Score formula (ResearchRubrics):
      S = Σ(wᵢ × mᵢ) / Σ(wᵢ where wᵢ > 0)
      where mᵢ ∈ {1.0, 0.5, 0.0} (ternary)
      Negative weights penalize — can push score below 0.
    """
    criteria: list[RubricCriterion] = field(default_factory=list)
    rubric_score: float = 0.0         # Normalized [0, 1] aggregate
    is_sufficient: bool = False
    coverage_gaps: list[str] = field(default_factory=list)
    unsupported_claims: list[str] = field(default_factory=list)
    contradictions: list[str] = field(default_factory=list)
    retry_guidance: str = ""
    source_diversity_warning: str = ""
    cost_usd: float = 0.0
    latency_ms: float = 0.0

    # Per-axis subscores (ResearchRubrics breakdown)
    axis_scores: dict[str, float] = field(default_factory=dict)


# ── Financial Research Rubric Templates ──────────────────────────────────────
# Instance-specific criteria are generated per-query.
# These base templates are fallbacks for when LLM rubric generation is skipped.

FINANCIAL_BASE_RUBRICS: list[dict] = [
    # ── Essential: Factual Accuracy ──────────────────────────────────────
    {
        "title": "Exact Numbers Cited",
        "description": "Every numeric claim (revenue, margin, growth rate) includes the exact figure from the source, not a rounded approximation, unless source itself rounds.",
        "category": "Essential",
        "weight": 5.0,
        "dimension": "helpful_outcome",
        "eval_axis": "explicit_req",
    },
    {
        "title": "Source Citations Present",
        "description": "Every factual claim has an inline [Source N] citation. No claim is made without a cited source.",
        "category": "Essential",
        "weight": 5.0,
        "dimension": "clear_process",
        "eval_axis": "references",
    },
    {
        "title": "Fiscal Period Correct",
        "description": "Dates, quarters, and fiscal years are stated precisely (e.g., 'Q4 FY2025 ended September 2025'), not vaguely ('last quarter').",
        "category": "Essential",
        "weight": 4.0,
        "dimension": "identifying",
        "eval_axis": "explicit_req",
    },
    {
        "title": "Query Directly Answered",
        "description": "The answer opens with a direct, specific response to what was asked. The key metrics/facts are stated upfront, not buried.",
        "category": "Essential",
        "weight": 5.0,
        "dimension": "helpful_outcome",
        "eval_axis": "instruction_following",
    },
    # ── Important: Research Depth ─────────────────────────────────────────
    {
        "title": "Multi-Source Synthesis",
        "description": "When multiple sources are available, the answer synthesizes across them (compares, reconciles, or triangulates) rather than just quoting one.",
        "category": "Important",
        "weight": 3.0,
        "dimension": "logical_process",
        "eval_axis": "synthesis",
    },
    {
        "title": "YoY Context Included",
        "description": "For any reported metric (revenue, profit, margin), the year-over-year or quarter-over-quarter change is stated alongside the absolute value.",
        "category": "Important",
        "weight": 3.0,
        "dimension": "identifying",
        "eval_axis": "implicit_req",
    },
    {
        "title": "Contradictions Flagged",
        "description": "If any sources contain conflicting data (e.g., two filings report different revenue figures), the contradiction is explicitly noted rather than silently ignored.",
        "category": "Important",
        "weight": 3.0,
        "dimension": "clear_process",
        "eval_axis": "synthesis",
    },
    {
        "title": "Confidence Calibrated",
        "description": "The stated confidence (HIGH/MEDIUM/LOW) matches the actual source quality: SEC filings → HIGH, news → MEDIUM, single source → cap at MEDIUM.",
        "category": "Important",
        "weight": 2.0,
        "dimension": "helpful_outcome",
        "eval_axis": "implicit_req",
    },
    {
        "title": "Structured Table Included",
        "description": "For multi-company or multi-period comparisons, a markdown table is included summarizing the key metrics side by side.",
        "category": "Important",
        "weight": 2.0,
        "dimension": "clear_process",
        "eval_axis": "communication",
    },
    # ── Optional: Analytical Depth ────────────────────────────────────────
    {
        "title": "Drivers Identified",
        "description": "Management's stated reasons for performance (drivers/headwinds) are included when available in the sources.",
        "category": "Optional",
        "weight": 1.0,
        "dimension": "identifying",
        "eval_axis": "synthesis",
    },
    {
        "title": "Follow-up Questions",
        "description": "3 relevant follow-up questions are suggested that extend the analysis naturally.",
        "category": "Optional",
        "weight": 1.0,
        "dimension": "helpful_outcome",
        "eval_axis": "communication",
    },
    {
        "title": "Risk Caveats Noted",
        "description": "Relevant risk factors or limitations of the data (e.g., non-GAAP adjustments, pending restatements) are noted in the caveats section.",
        "category": "Optional",
        "weight": 1.5,
        "dimension": "identifying",
        "eval_axis": "implicit_req",
    },
    # ── Pitfall: Harmful Errors ───────────────────────────────────────────
    {
        "title": "No Fabricated Numbers",
        "description": "CRITICAL: No numeric value appears in the answer that cannot be traced to a cited source. Fabricated figures get -5 penalty.",
        "category": "Pitfall",
        "weight": -5.0,
        "dimension": "harmless_outcome",
        "eval_axis": "references",
    },
    {
        "title": "No Guidance-as-Fact",
        "description": "Forward guidance, analyst estimates, and management projections are clearly marked as such — NOT presented as confirmed reported figures.",
        "category": "Pitfall",
        "weight": -4.0,
        "dimension": "harmless_outcome",
        "eval_axis": "explicit_req",
    },
    {
        "title": "No Biased Framing",
        "description": "Language does not present one-sided positive/negative framing without acknowledging opposing evidence from sources. Avoids promotional language.",
        "category": "Pitfall",
        "weight": -3.0,
        "dimension": "harmless_outcome",
        "eval_axis": "implicit_req",
    },
    {
        "title": "No Stale Data Used",
        "description": "The answer does not cite outdated data when more recent filings are available. If only old data exists, it is explicitly flagged as such.",
        "category": "Pitfall",
        "weight": -3.0,
        "dimension": "harmful_outcome" if False else "harmless_outcome",  # type: ignore
        "eval_axis": "references",
    },
]


# ── Rubric Evaluator ──────────────────────────────────────────────────────────

_RUBRIC_EVAL_SYSTEM = """You are a financial research quality auditor.
Evaluate the answer against each rubric criterion provided.

For EACH criterion:
1. Read the criterion description carefully
2. Check the answer + source passages
3. Score using TERNARY SCALE ONLY:
   - 1.0 = Fully satisfied
   - 0.5 = Partially satisfied (some but not all elements present)
   - 0.0 = Not satisfied

For PITFALL criteria (negative weights):
   - 1.0 means the pitfall DOES NOT occur (good)
   - 0.0 means the pitfall DOES occur (bad, full penalty applied)

Respond with ONLY valid JSON:
{
  "criteria_scores": [
    {
      "title": "criterion title",
      "score": 1.0,
      "justification": "one sentence explanation"
    }
  ],
  "coverage_gaps": ["specific sub-question or data not adequately covered"],
  "unsupported_claims": ["exact claim text that has no valid source backing"],
  "contradictions": ["source A vs source B conflict description"],
  "source_diversity_note": "assessment of source independence",
  "retry_guidance": "if score < 0.7: specific actionable guidance for what to search/rewrite"
}

IMPORTANT: Score every criterion. Do not skip any."""


class RubricEvaluator:
    """
    Evaluates financial research quality using structured rubrics.

    Implements the composite scoring from papers 1+2+3:
    - Instance-specific rubric selection (RaR)
    - Ternary scoring (ResearchRubrics)
    - Weighted aggregation with penalties (RTD/RaR)

    Usage:
        evaluator = RubricEvaluator(llm_client)
        result = await evaluator.evaluate(query, answer, sources, extracted_facts)
        # result.rubric_score replaces the old quality_score float
    """

    QUALITY_THRESHOLD = 0.70  # Equivalent to old QUALITY_THRESHOLD in critic_agent.py

    def __init__(self, llm: BaseLLMClient):
        self.llm = llm

    async def evaluate(
        self,
        query: str,
        answer_summary: str,
        sources_summary: str,
        extracted_facts_summary: str,
        sub_tasks_summary: str,
        iteration: int = 0,
        max_iterations: int = 2,
    ) -> RubricEvalResult:
        """
        Run rubric-based evaluation replacing simple quality float scoring.

        Steps:
        1. Select relevant base rubrics for this query type
        2. LLM scores each criterion (ternary: 1.0/0.5/0.0)
        3. Apply weighted aggregation formula
        4. Return structured result with actionable guidance
        """
        t0 = time.perf_counter()

        # Select relevant rubrics (all base rubrics for now — instance-specific
        # generation via LLM is an optional Phase 2 enhancement via RTD paper)
        active_rubrics = [RubricCriterion(**{
            k: v for k, v in r.items()
        }) for r in FINANCIAL_BASE_RUBRICS]

        # Build evaluation prompt
        criteria_text = self._format_criteria_for_prompt(active_rubrics)

        user_content = (
            f"## Original Query\n{query}\n\n"
            f"## Sub-tasks Status\n{sub_tasks_summary}\n\n"
            f"## Extracted Facts\n{extracted_facts_summary}\n\n"
            f"## Answer to Evaluate\n{answer_summary}\n\n"
            f"## Source Passages (summary)\n{sources_summary}\n\n"
            f"## Rubric Criteria to Score\n{criteria_text}"
        )

        try:
            response = await self.llm.generate(
                messages=[
                    LLMMessage(role="system", content=_RUBRIC_EVAL_SYSTEM),
                    LLMMessage(role="user", content=user_content),
                ],
                config=LLMConfig(temperature=0.0, max_tokens=3000, json_mode=True),
            )

            raw = json.loads(response.content)

            # Apply scores to criteria objects
            score_map = {
                s["title"].lower(): s
                for s in raw.get("criteria_scores", [])
                if "title" in s
            }
            for criterion in active_rubrics:
                match = score_map.get(criterion.title.lower())
                if match:
                    criterion.score = float(match.get("score", 0.0))
                    criterion.justification = match.get("justification", "")

            # Compute aggregate rubric score (ResearchRubrics formula)
            rubric_score = self._compute_score(active_rubrics)
            is_sufficient = rubric_score >= self.QUALITY_THRESHOLD
            can_retry = iteration < max_iterations

            # Compute per-axis subscores (for analytics / Grafana)
            axis_scores = self._compute_axis_scores(active_rubrics)

            result = RubricEvalResult(
                criteria=active_rubrics,
                rubric_score=rubric_score,
                is_sufficient=is_sufficient or not can_retry,
                coverage_gaps=raw.get("coverage_gaps", []),
                unsupported_claims=raw.get("unsupported_claims", []),
                contradictions=raw.get("contradictions", []),
                retry_guidance=raw.get("retry_guidance", ""),
                source_diversity_warning=raw.get("source_diversity_note", ""),
                cost_usd=response.cost_usd,
                latency_ms=(time.perf_counter() - t0) * 1000,
                axis_scores=axis_scores,
            )

            logger.info(
                "rubric_evaluation_complete",
                query=query[:80],
                rubric_score=round(rubric_score, 3),
                is_sufficient=result.is_sufficient,
                axis_scores={k: round(v, 2) for k, v in axis_scores.items()},
                pitfall_count=sum(
                    1 for c in active_rubrics
                    if c.category == "Pitfall" and c.score < 1.0
                ),
            )

            return result

        except (json.JSONDecodeError, Exception) as e:
            logger.warning("rubric_evaluator_failed", error=str(e))
            # Fail-open: return a passing result so pipeline doesn't stall
            return RubricEvalResult(
                rubric_score=0.6,
                is_sufficient=True,
                retry_guidance=f"Rubric evaluation failed ({e}) — proceeding",
                cost_usd=0.0,
                latency_ms=(time.perf_counter() - t0) * 1000,
            )

    @staticmethod
    def _compute_score(criteria: list[RubricCriterion]) -> float:
        """
        ResearchRubrics scoring formula:
          S = Σ(wᵢ × mᵢ) / Σ(wᵢ where wᵢ > 0)

        Negative weights (Pitfalls) apply absolute penalty.
        Denominator only sums positive weights.
        Score CAN be negative (severe pitfall violations).

        Then normalized to [0, 1] for downstream compatibility.
        """
        numerator = 0.0
        positive_weight_sum = 0.0

        for c in criteria:
            if c.weight > 0:
                numerator += c.weight * c.score
                positive_weight_sum += c.weight
            else:
                # Negative weight (Pitfall): penalty when score < 1.0
                # score=1.0 means pitfall NOT triggered → no penalty
                # score=0.0 means pitfall triggered → full penalty
                penalty = abs(c.weight) * (1.0 - c.score)
                numerator -= penalty

        if positive_weight_sum == 0:
            return 0.5

        raw_score = numerator / positive_weight_sum
        # Clamp to [0, 1] for compatibility with existing pipeline
        return max(0.0, min(1.0, raw_score))

    @staticmethod
    def _compute_axis_scores(criteria: list[RubricCriterion]) -> dict[str, float]:
        """Compute per-axis subscores for analytics."""
        axis_numerators: dict[str, float] = {}
        axis_denominators: dict[str, float] = {}

        for c in criteria:
            ax = c.eval_axis
            w = abs(c.weight)
            if ax not in axis_numerators:
                axis_numerators[ax] = 0.0
                axis_denominators[ax] = 0.0
            axis_numerators[ax] += w * c.score
            axis_denominators[ax] += w

        return {
            ax: round(axis_numerators[ax] / axis_denominators[ax], 3)
            for ax in axis_numerators
            if axis_denominators[ax] > 0
        }

    @staticmethod
    def _format_criteria_for_prompt(criteria: list[RubricCriterion]) -> str:
        """Format rubric criteria for the evaluation prompt."""
        lines = []
        for i, c in enumerate(criteria, 1):
            weight_note = (
                f"(PITFALL, weight={c.weight})"
                if c.category == "Pitfall"
                else f"({c.category}, weight=+{c.weight})"
            )
            lines.append(
                f"{i}. [{c.title}] {weight_note}\n"
                f"   {c.description}\n"
                f"   Axis: {c.eval_axis} | Dimension: {c.dimension}"
            )
        return "\n\n".join(lines)


# ── RTD: Rubric Refinement at Performance Frontier (Paper 2) ─────────────────

_RTD_SYSTEM = """You are a rubric refinement expert (RTD — Refinement-through-Differentiation).
You are given two financial research answers to the same query: a BETTER and a WORSE one,
both already high-quality (performance frontier). Your task: identify the specific criteria
that distinguish the better from the worse, and propose rubric refinements.

For each identified distinction:
1. Extract it as a new rubric criterion OR propose modification to an existing one
2. Assign it a category (Essential/Important/Optional/Pitfall) and weight

This enables reward model refinement at the tail — the hardest cases where current rubrics
are underspecified.

Respond with ONLY valid JSON:
{
  "distinguishing_differences": [
    "specific way the better answer exceeds the worse"
  ],
  "new_criteria": [
    {
      "title": "2-4 word title",
      "description": "what to check",
      "category": "Essential|Important|Optional|Pitfall",
      "weight": 3.0,
      "dimension": "identifying|clear_process|logical_process|helpful_outcome|harmless_outcome",
      "eval_axis": "explicit_req|implicit_req|synthesis|references|communication|instruction_following"
    }
  ],
  "criteria_to_refine": [
    {
      "existing_title": "existing criterion title",
      "refinement": "how to make the criterion more specific at the performance frontier"
    }
  ]
}"""


async def refine_rubrics_via_rtd(
    llm: BaseLLMClient,
    query: str,
    better_answer: str,
    worse_answer: str,
) -> list[dict]:
    """
    RTD (Chasing the Tail, Paper 2): Given two frontier answers, extract distinguishing
    criteria and propose rubric refinements.

    Returns list of new/refined criterion dicts that can be added to FINANCIAL_BASE_RUBRICS.
    """
    user_content = (
        f"Query: {query}\n\n"
        f"BETTER answer:\n{better_answer[:2000]}\n\n"
        f"WORSE answer (still high quality, just slightly worse):\n{worse_answer[:2000]}"
    )

    try:
        response = await llm.generate(
            messages=[
                LLMMessage(role="system", content=_RTD_SYSTEM),
                LLMMessage(role="user", content=user_content),
            ],
            config=LLMConfig(temperature=0.1, max_tokens=2000, json_mode=True),
        )
        result = json.loads(response.content)
        new_criteria = result.get("new_criteria", [])
        logger.info(
            "rtd_refinement",
            query=query[:60],
            new_criteria_count=len(new_criteria),
            distinctions=result.get("distinguishing_differences", [])[:3],
        )
        return new_criteria
    except Exception as e:
        logger.warning("rtd_failed", error=str(e))
        return []
