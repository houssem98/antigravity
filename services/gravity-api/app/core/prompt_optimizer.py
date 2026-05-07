"""
Gravity Search — DSPy-style Prompt Optimizer (MIPROv2-inspired)

Optimizes prompts for high-volume sub-agents (KPI extractor, 10-K section
extractor, footnote linker) using few-shot example selection and
bootstrap compilation — without the full DSPy runtime dependency.

Architecture (matches DSPy MIPROv2):
  1. BootstrapFewShot  — run the module on training examples, collect
                         correct traces as few-shot demonstrations
  2. InstructionProposal — LLM generates candidate instruction prefixes
                           conditioned on the task and demo traces
  3. GridSearch         — evaluate each (instruction, demos) combination
                           on a dev set, pick highest-scoring config
  4. Compile            — write the winning prompt to a JSON artifact

Usage (offline, run once per task):
    optimizer = PromptOptimizer(llm_client=client, task="kpi_extractor")
    result = await optimizer.compile(
        train_examples=FINANCEBENCH_KPI_TRAIN,
        dev_examples=FINANCEBENCH_KPI_DEV,
        metric=exact_match_metric,
        n_candidates=8,
        max_demos=4,
    )
    result.save("prompts/kpi_extractor_optimized.json")

The compiled JSON artifact is then loaded at runtime:
    KPIExtractor.load_prompt("prompts/kpi_extractor_optimized.json")
"""

from __future__ import annotations

import json
import asyncio
import hashlib
from dataclasses import dataclass, field, asdict
from typing import Any, Callable, Optional
import structlog

logger = structlog.get_logger()


# ─── Types ────────────────────────────────────────────────────────────────────

@dataclass
class Example:
    """A labeled input/output pair for training/evaluation."""
    inputs: dict[str, Any]        # e.g. {"passage": "...", "filing_type": "10-K"}
    expected: Any                  # ground-truth output (str, dict, list)
    metadata: dict[str, Any] = field(default_factory=dict)  # ticker, source, etc.


@dataclass
class Trace:
    """A recorded LLM call — inputs, prompt used, raw output, parsed output."""
    inputs: dict[str, Any]
    prompt: str
    raw_output: str
    parsed_output: Any
    score: float                   # metric score on this example (0–1)
    latency_ms: float = 0.0


@dataclass
class CompiledPrompt:
    """Optimized prompt artifact — saved/loaded as JSON."""
    task: str
    instruction: str
    demos: list[dict]              # few-shot examples (inputs + expected)
    score: float                   # dev-set metric score
    n_candidates_tried: int
    optimizer_version: str = "miprov2_lite"
    metadata: dict = field(default_factory=dict)

    def save(self, path: str) -> None:
        with open(path, "w") as f:
            json.dump(asdict(self), f, indent=2)

    @classmethod
    def load(cls, path: str) -> "CompiledPrompt":
        with open(path) as f:
            data = json.load(f)
        return cls(**data)

    def render(self, inputs: dict[str, Any]) -> str:
        """Render the full prompt with instruction, few-shot demos, and live inputs."""
        parts = [self.instruction, ""]
        for i, demo in enumerate(self.demos, 1):
            parts.append(f"Example {i}:")
            for k, v in demo.get("inputs", {}).items():
                parts.append(f"  {k}: {v}")
            parts.append(f"  output: {json.dumps(demo.get('expected', ''))}")
            parts.append("")
        parts.append("Now answer:")
        for k, v in inputs.items():
            parts.append(f"  {k}: {v}")
        parts.append("  output:")
        return "\n".join(parts)


# ─── Metric helpers ───────────────────────────────────────────────────────────

def exact_match_metric(predicted: Any, expected: Any) -> float:
    """1.0 if outputs match exactly (after normalization), else 0.0."""
    def _norm(x: Any) -> str:
        return json.dumps(x, sort_keys=True) if not isinstance(x, str) else x.strip().lower()
    return 1.0 if _norm(predicted) == _norm(expected) else 0.0


def f1_set_metric(predicted: Any, expected: Any) -> float:
    """Token-level F1 between predicted and expected strings."""
    def _tokens(x: Any) -> set[str]:
        s = json.dumps(x) if not isinstance(x, str) else x
        return set(s.lower().split())
    p_toks = _tokens(predicted)
    e_toks = _tokens(expected)
    if not p_toks and not e_toks:
        return 1.0
    if not p_toks or not e_toks:
        return 0.0
    tp = len(p_toks & e_toks)
    precision = tp / len(p_toks)
    recall = tp / len(e_toks)
    if precision + recall == 0:
        return 0.0
    return 2 * precision * recall / (precision + recall)


def numeric_within_pct_metric(pct: float = 0.05) -> Callable:
    """Returns a metric that scores 1.0 if numeric values are within pct% of each other."""
    def _metric(predicted: Any, expected: Any) -> float:
        try:
            p = float(str(predicted).replace(",", "").replace("$", "").replace("%", ""))
            e = float(str(expected).replace(",", "").replace("$", "").replace("%", ""))
            if e == 0:
                return 1.0 if p == 0 else 0.0
            return 1.0 if abs(p - e) / abs(e) <= pct else 0.0
        except (ValueError, TypeError):
            return exact_match_metric(predicted, expected)
    return _metric


# ─── Instruction Proposer ─────────────────────────────────────────────────────

_INSTRUCTION_PROPOSER_PROMPT = """You are a prompt engineer. Given a task description and example traces,
generate {n} distinct instruction prefixes that would help an LLM perform this task accurately.

Task: {task}
Example inputs: {example_inputs}
Example expected outputs: {example_outputs}
Common failure modes observed: {failure_modes}

Generate exactly {n} instruction variants. Each should:
- Be 1-3 sentences
- Be specific to this task
- Vary in approach (some prescriptive, some exemplar-based, some constraint-focused)

Return as a JSON array of strings:
["instruction 1", "instruction 2", ...]"""


async def _propose_instructions(
    llm_client,
    task: str,
    examples: list[Example],
    failure_traces: list[Trace],
    n: int = 8,
) -> list[str]:
    """Use LLM to generate candidate instruction prefixes."""
    example_inputs = json.dumps([e.inputs for e in examples[:3]], indent=2)
    example_outputs = json.dumps([e.expected for e in examples[:3]], indent=2)
    failure_modes = "; ".join(
        f"predicted {t.parsed_output!r} instead of {t.inputs.get('expected', '?')!r}"
        for t in failure_traces[:3]
    ) or "none observed yet"

    prompt = _INSTRUCTION_PROPOSER_PROMPT.format(
        task=task,
        example_inputs=example_inputs[:1000],
        example_outputs=example_outputs[:500],
        failure_modes=failure_modes[:500],
        n=n,
    )
    try:
        response = await llm_client.complete(prompt, max_tokens=1024)
        m = __import__("re").search(r"\[[\s\S]*?\]", response)
        if m:
            return json.loads(m.group(0))
    except Exception as e:
        logger.warning("instruction_proposer_failed", error=str(e))

    # Fallback: hardcoded generic instructions
    return [
        f"Extract the requested information from the {task} input accurately and completely.",
        f"You are a financial data expert. Carefully analyze the input and extract {task} with high precision.",
        f"Extract all relevant {task} fields. Be thorough, include units and periods.",
        f"Parse the financial text and return structured {task} data in the exact format requested.",
    ][:n]


# ─── Bootstrap Few-Shot ───────────────────────────────────────────────────────

async def _bootstrap_demos(
    llm_client,
    examples: list[Example],
    base_prompt_template: str,
    metric: Callable,
    max_demos: int = 4,
    concurrency: int = 8,
) -> list[dict]:
    """
    Run the module on training examples, collect correct traces as few-shot demos.
    Returns the top `max_demos` examples by metric score.
    """
    sem = asyncio.Semaphore(concurrency)

    async def _run_one(ex: Example) -> Optional[Trace]:
        async with sem:
            prompt = base_prompt_template.format(**ex.inputs)
            t0 = asyncio.get_event_loop().time()
            try:
                raw = await llm_client.complete(prompt, max_tokens=1024)
                latency_ms = (asyncio.get_event_loop().time() - t0) * 1000
                # Try to parse as JSON
                try:
                    parsed = json.loads(raw)
                except (json.JSONDecodeError, ValueError):
                    parsed = raw.strip()
                score = metric(parsed, ex.expected)
                return Trace(
                    inputs=ex.inputs,
                    prompt=prompt,
                    raw_output=raw,
                    parsed_output=parsed,
                    score=score,
                    latency_ms=latency_ms,
                )
            except Exception as e:
                logger.debug("bootstrap_trace_failed", error=str(e))
                return None

    traces = await asyncio.gather(*[_run_one(ex) for ex in examples])
    good_traces = [t for t in traces if t is not None and t.score >= 0.8]
    good_traces.sort(key=lambda t: t.score, reverse=True)

    return [
        {"inputs": t.inputs, "expected": ex.expected}
        for t, ex in zip(good_traces[:max_demos], examples[:max_demos])
        if t is not None
    ]


# ─── Main Optimizer ───────────────────────────────────────────────────────────

class PromptOptimizer:
    """
    MIPROv2-inspired few-shot prompt optimizer.

    compile() runs:
      1. Bootstrap few-shot demos from training set
      2. Propose N instruction candidates via LLM
      3. Grid-search (instruction × demo-set) on dev set
      4. Return best CompiledPrompt
    """

    def __init__(self, llm_client, task: str):
        self._client = llm_client
        self.task = task

    async def compile(
        self,
        train_examples: list[Example],
        dev_examples: list[Example],
        base_prompt_template: str,
        metric: Callable = exact_match_metric,
        n_candidates: int = 8,
        max_demos: int = 4,
        concurrency: int = 4,
    ) -> CompiledPrompt:
        """
        Compile an optimized prompt artifact.

        Args:
            train_examples:       Labeled training examples for bootstrapping
            dev_examples:         Held-out dev examples for evaluation
            base_prompt_template: Starting prompt with {input_key} placeholders
            metric:               Scoring function (predicted, expected) → float
            n_candidates:         Number of instruction variants to try
            max_demos:            Max few-shot examples in final prompt
            concurrency:          Parallel LLM calls during evaluation
        """
        logger.info("prompt_optimizer_start", task=self.task, train=len(train_examples), dev=len(dev_examples))

        # Step 1: Bootstrap few-shot demos
        logger.info("bootstrapping_demos")
        demos = await _bootstrap_demos(
            self._client, train_examples, base_prompt_template,
            metric, max_demos, concurrency,
        )
        logger.info("bootstrap_done", good_demos=len(demos))

        # Step 2: Propose instruction candidates
        failure_traces: list[Trace] = []  # populated after first eval round
        instructions = await _propose_instructions(
            self._client, self.task, train_examples[:5],
            failure_traces, n=n_candidates,
        )
        logger.info("instructions_proposed", count=len(instructions))

        # Step 3: Grid-search (instruction × demo subsets) on dev set
        best_score = -1.0
        best_instruction = instructions[0] if instructions else ""
        best_demos = demos

        sem = asyncio.Semaphore(concurrency)

        async def _eval_config(instruction: str, demo_set: list[dict]) -> float:
            candidate = CompiledPrompt(
                task=self.task,
                instruction=instruction,
                demos=demo_set,
                score=0.0,
                n_candidates_tried=n_candidates,
            )
            scores = await asyncio.gather(
                *[self._eval_one(candidate, ex, metric, sem) for ex in dev_examples],
                return_exceptions=True,
            )
            valid = [s for s in scores if isinstance(s, float)]
            return sum(valid) / len(valid) if valid else 0.0

        # Evaluate all instructions with the bootstrapped demos
        eval_tasks = [_eval_config(inst, demos) for inst in instructions]
        scores = await asyncio.gather(*eval_tasks, return_exceptions=True)

        for inst, score in zip(instructions, scores):
            if isinstance(score, float) and score > best_score:
                best_score = score
                best_instruction = inst

        logger.info(
            "grid_search_done",
            best_score=round(best_score, 4),
            instruction_preview=best_instruction[:80],
        )

        return CompiledPrompt(
            task=self.task,
            instruction=best_instruction,
            demos=best_demos,
            score=best_score,
            n_candidates_tried=n_candidates,
            metadata={
                "train_size": len(train_examples),
                "dev_size": len(dev_examples),
                "metric": metric.__name__ if hasattr(metric, "__name__") else str(metric),
            },
        )

    async def _eval_one(
        self,
        candidate: CompiledPrompt,
        example: Example,
        metric: Callable,
        sem: asyncio.Semaphore,
    ) -> float:
        async with sem:
            prompt = candidate.render(example.inputs)
            try:
                raw = await self._client.complete(prompt, max_tokens=512)
                try:
                    parsed = json.loads(raw)
                except (json.JSONDecodeError, ValueError):
                    parsed = raw.strip()
                return metric(parsed, example.expected)
            except Exception:
                return 0.0


# ─── Task-specific prompt templates ───────────────────────────────────────────
# These are the starting-point templates that get optimized by compile().
# After running the optimizer, load the compiled artifact instead.

KPI_EXTRACTOR_BASE_PROMPT = """Extract all numeric KPIs from this SEC filing passage.
Return a JSON array of objects with fields: metric, label, value, unit, period, segment, confidence.

Passage (filing: {filing_type}, section: {section}):
{passage_text}

Return ONLY the JSON array."""

SECTION_EXTRACTOR_BASE_PROMPT = """Extract the '{section_name}' section from this SEC 10-K filing text.
Return the extracted section as plain text, preserving all numbers and financial data.

Filing text:
{filing_text}

Return ONLY the extracted section text."""

FOOTNOTE_LINKER_BASE_PROMPT = """Given this financial statement and its footnotes, link each
footnote reference in the statement to its full footnote text.
Return a JSON object mapping reference numbers to footnote text.

Financial statement:
{statement_text}

Footnotes:
{footnotes_text}

Return ONLY the JSON mapping."""

TASK_PROMPTS: dict[str, str] = {
    "kpi_extractor":      KPI_EXTRACTOR_BASE_PROMPT,
    "section_extractor":  SECTION_EXTRACTOR_BASE_PROMPT,
    "footnote_linker":    FOOTNOTE_LINKER_BASE_PROMPT,
}
