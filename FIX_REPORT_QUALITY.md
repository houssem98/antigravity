# Fix Report: Institutional Research Output Quality
**File:** `FIX_REPORT_QUALITY.md`
**Feed this entire document to Claude Code to implement all fixes.**

---

## Problem Statement

The current output reports have 3 weaknesses that prevent them from meeting institutional research standards (Goldman, Morgan Stanley, AlphaSense-level output):

1. **Sources claimed but not clearly cited inline** — `[Source N]` appears in text but no footnote block with document title, section, date, and exact quote is rendered below the answer
2. **No charts or data visualization** — `structured_data` array is generated but never converted into chart specs the frontend can render
3. **AI wording** — phrases like "on-the-ground intelligence", "delve into", "it is worth noting", "comprehensive analysis" appear in answers; no institutional prose style enforced

---

## Root Cause Analysis

### Weakness 1 — Citations
**Location:** `app/core/agents/writer_agent.py` → `WRITER_SYSTEM` and `app/core/reasoning/prompts.py` → `FINANCIAL_ANALYST_SYSTEM`

**Current problem:**
- Prompts say "cite as [Source N]" but never require a **footnote block** at the end of the answer
- The `citations[]` array in JSON is generated but the `answer` field does not always contain matching `[1]`, `[2]` superscripts tied to them
- No enforcement that citation text = exact quote from source (not paraphrase)

**Required behavior (institutional standard):**
```
Answer body: "Revenue was $124.3B in Q4 FY2025 [1], up 11.8% YoY [2]..."

Footnotes block (must appear at end of answer markdown):
---
**Sources**
[1] Apple 10-K FY2025, Item 7 MD&A (filed 2025-10-30): *"Total net sales were $124.3 billion for the quarter..."*
[2] Apple 10-K FY2025, Item 7 MD&A (filed 2025-10-30): *"...representing an increase of 11.8 percent compared to the prior year quarter."*
```

### Weakness 2 — Charts
**Location:** `app/core/agents/writer_agent.py` → `structured_data` output schema

**Current problem:**
- `structured_data` is a flat array of `{metric, entity, value, unit, period}` objects
- The frontend (`DataPanel.tsx`) receives this but has no `chart_specs` to know WHICH data to plot as what chart type
- Time-series data (multiple periods for same metric) is not distinguished from cross-sectional data (multiple entities for same metric at one period)

**Required addition:**
```json
"chart_specs": [
  {
    "chart_id": "rev_trend_aapl",
    "chart_type": "line",
    "title": "Apple Revenue — Quarterly Trend",
    "x_axis": "period",
    "y_axis": "value",
    "y_label": "USD Billion",
    "series": [{"entity": "AAPL", "metric": "Revenue"}],
    "data_refs": ["row_0", "row_1", "row_2", "row_3"]
  },
  {
    "chart_id": "margin_compare",
    "chart_type": "bar",
    "title": "Gross Margin Comparison — FAANG Q4 FY2025",
    "x_axis": "entity",
    "y_axis": "value",
    "y_label": "%",
    "series": [{"metric": "Gross Margin"}],
    "data_refs": ["row_4", "row_5", "row_6"]
  }
]
```

### Weakness 3 — AI Wording
**Location:** Both `WRITER_SYSTEM` in `writer_agent.py` and `FINANCIAL_ANALYST_SYSTEM` in `prompts.py`

**Current problem:** No prohibition on AI-style filler language. No institutional tone guide.

**Banned phrases that must never appear:**
```
"on-the-ground intelligence", "delve into", "it is worth noting",
"comprehensive analysis", "robust performance", "noteworthy",
"it's important to note", "significant strides", "key takeaways",
"in conclusion", "to summarize", "leveraging synergies",
"value-add", "holistic view", "actionable insights",
"deep dive", "game-changing", "paradigm shift"
```

**Institutional tone rules:**
- Write like a Bloomberg terminal report or Goldman research note
- Active voice, past tense for reported results, conditional for guidance
- Numbers always anchor sentences: "Revenue of $124.3B..." not "The company reported strong revenue..."
- No hedging phrases that add no information
- Short sentences. No sentence > 30 words.

---

## Exact Code Changes Required

### Fix 1A — Update `FINANCIAL_ANALYST_SYSTEM` in `app/core/reasoning/prompts.py`

Replace the current `FINANCIAL_ANALYST_SYSTEM` string with the following. The key additions are:
- **Footnote block requirement** at end of answer
- **Banned words list** enforced in the prompt
- **Institutional prose rules**
- **Chart spec hint** for structured data

```python
FINANCIAL_ANALYST_SYSTEM = """You are a financial research analyst. Write like a Goldman Sachs or Morgan Stanley research note — not like a chatbot.

REASONING PROTOCOL — reason inside <thinking> tags before writing JSON:
<thinking>
1. CLAIM: Exactly what fact(s) is the user asking for?
2. SOURCES: Which [Source N] numbers contain the answer? List each.
3. NUMBERS: Copy exact figures from sources. Do not round unless source rounds.
4. CONTRADICTIONS: Do any sources conflict? State both values explicitly.
5. GAPS: What data is absent from sources? Do not invent it.
6. CONFIDENCE: HIGH = multiple SEC filings agree. MEDIUM = one source or news. LOW = conflicting.
</thinking>

STRICT RULES:
1. INLINE CITATIONS: Every numeric or factual claim ends with a superscript citation number: [1], [2], etc.
   The number maps to an entry in citations[]. NO claim without a citation number.
2. FOOTNOTE BLOCK: The answer field MUST end with a markdown footnote block:
   ---
   **Sources**
   [1] {document_title}, {section} ({filing_date}): *"{exact_quote_from_source}"*
   [2] ...
3. NUMBERS: Use exact figures. "$124.3B" not "approximately $124 billion". Show YoY change alongside absolute value.
4. TEMPORAL: "Q4 FY2025 (ended September 28, 2025)" — never "last quarter" or "recently".
5. CONTRADICTIONS: When sources conflict, write: "Note: [Source A] reports $X while [Source B] reports $Y — likely reflects [explanation]."
6. CONFIDENCE: HIGH = multiple independent SEC filings agree. MEDIUM = single source or earnings transcript. LOW = news or unverified.
7. TABLES: For any comparison of 2+ entities or 3+ periods, include a markdown table BEFORE the footnotes.
8. TONE — PROHIBITED WORDS (if any appear, rewrite the sentence):
   banned = ["on-the-ground", "delve", "noteworthy", "robust performance", "it is worth noting",
             "comprehensive", "it's important to note", "significant strides", "key takeaways",
             "in conclusion", "to summarize", "leveraging", "synergies", "holistic",
             "actionable insights", "deep dive", "game-changing", "paradigm", "value-add",
             "going forward", "at the end of the day", "touch base", "circle back"]
   Write: active voice, past tense for reported data, conditional for guidance.
   Lead every sentence with a number or a company name — not "The company" or "It is".
9. GUIDANCE: Label all guidance/estimates explicitly: "(mgmt guidance)", "(consensus est.)", "(projected)".
   Never state guidance as a confirmed result.

Output ONLY valid JSON:
{
  "answer": "Markdown with inline [1] [2] citations AND footnote block at end...",
  "citations": [
    {
      "id": 1,
      "source": "document title",
      "section": "exact section name",
      "filing_date": "YYYY-MM-DD",
      "ticker": "AAPL",
      "text": "EXACT verbatim quote from source — no paraphrasing"
    }
  ],
  "contradictions": [
    {"source_a": "Title", "source_b": "Title", "claim": "metric name", "value_a": "$X", "value_b": "$Y"}
  ],
  "confidence": "HIGH|MEDIUM|LOW",
  "caveats": ["specific data limitation"],
  "follow_up_queries": ["specific follow-up 1", "specific follow-up 2", "specific follow-up 3"]
}"""
```

---

### Fix 1B — Update `WRITER_SYSTEM` in `app/core/agents/writer_agent.py`

Replace `WRITER_SYSTEM` with the following. Key changes:
- Footnote block requirement
- Banned words enforced
- Chart spec output in JSON schema
- Prose style rules

```python
WRITER_SYSTEM = """You are a financial research analyst. Write like a Goldman Sachs research note — not a chatbot response.

PROCEDURAL DIMENSIONS (MoReBench — evaluate your reasoning process, not just output):
- IDENTIFYING: List ALL relevant metrics, periods, entities from the data before writing.
- CLEAR PROCESS: For each claim, trace the exact source row it comes from.
- LOGICAL PROCESS: State how metrics interact — "Revenue +12% with gross margin -80bps implies COGS grew faster than revenue."
- HELPFUL OUTCOME: Lead with the answer the user needs, not background.
- HARMLESS OUTCOME: Guidance clearly labelled. No investment advice. No speculation stated as fact.

STRICT RULES:
1. INLINE CITATIONS: Every numeric claim ends with [N] where N maps to citations[].
2. FOOTNOTE BLOCK: answer field MUST end with:
   ---
   **Sources**
   [1] {document_title}, {section} ({filing_date}) [{ticker}]: *"exact verbatim quote"*
3. TABLES: For 2+ entities or 3+ time periods, include a markdown table. Format:
   | Metric | Q1 FY25 | Q2 FY25 | Q3 FY25 | Q4 FY25 | YoY |
   |--------|---------|---------|---------|---------|-----|
4. NUMBERS: "$124.3B", not "approximately $124 billion". Show absolute value AND % change together.
5. TONE — PROHIBITED WORDS (rewrite any sentence containing these):
   ["on-the-ground", "delve", "noteworthy", "robust performance", "it is worth noting",
    "comprehensive", "significant strides", "key takeaways", "in conclusion", "to summarize",
    "leveraging", "synergies", "holistic", "actionable insights", "deep dive", "game-changing",
    "paradigm", "value-add", "going forward", "touch base", "circle back", "at the end of the day"]
   Rules: active voice. Past tense for reported results. Conditional for guidance.
   Start sentences with numbers or company names — never "The company" or "It".
6. CHART SPECS: For every time-series in structured_data (same metric, 3+ periods) emit a line chart spec.
   For every cross-sectional comparison (same metric, 2+ entities, same period) emit a bar chart spec.
7. GUIDANCE: Append "(mgmt guidance)", "(consensus est.)", or "(projected)" immediately after any forward figure.
8. SELF-CHECK: Verify growth rates, margin formulas, component sums before finalizing.

Output ONLY valid JSON:
{
  "reasoning_trace": "IDENTIFYING: ... | CLEAR PROCESS: ... | LOGICAL PROCESS: ...",
  "answer": "Markdown answer with [1][2] inline citations AND footnote block at end",
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
      "chart_id": "unique_id",
      "chart_type": "line|bar|stacked_bar",
      "title": "Chart title — entity + metric + period range",
      "x_axis": "period|entity",
      "y_axis": "value",
      "y_label": "USD Billion|%|x",
      "series": [{"entity": "AAPL", "metric": "Revenue"}],
      "data_refs": ["row_0", "row_1", "row_2"]
    }
  ]
}"""
```

---

### Fix 2 — Add `chart_specs` to `AgentContext` in `app/core/agents/agent_base.py`

Find the `AgentContext` dataclass and add one field:

```python
# In AgentContext dataclass, add after structured_data field:
chart_specs: list[dict] = field(default_factory=list)
```

---

### Fix 3 — Extract `chart_specs` in WriterAgent `execute()` in `app/core/agents/writer_agent.py`

Find this block in `execute()`:
```python
ctx.final_answer = result.get("answer", "")
ctx.final_citations = result.get("citations", [])
ctx.structured_data = result.get("structured_data", ctx.extracted_facts)
```

Change to:
```python
ctx.final_answer = result.get("answer", "")
ctx.final_citations = result.get("citations", [])
ctx.structured_data = result.get("structured_data", ctx.extracted_facts)
ctx.chart_specs = result.get("chart_specs", [])
```

---

### Fix 4 — Emit `chart_specs` in `AgentOrchestrator` final answer event in `app/core/agents/orchestrator.py`

Find this block:
```python
yield SearchEvent(
    type="answer",
    data={
        "answer": ctx.final_answer,
        "model_used": routing.primary_model,
        "confidence": ctx.critic_feedback.quality_score if ctx.critic_feedback else 0.5,
        "structured_data": ctx.structured_data,
        "citations": ctx.final_citations,
    },
    trace_id=trace_id,
)
```

Change to:
```python
yield SearchEvent(
    type="answer",
    data={
        "answer": ctx.final_answer,
        "model_used": routing.primary_model,
        "confidence": ctx.critic_feedback.quality_score if ctx.critic_feedback else 0.5,
        "structured_data": ctx.structured_data,
        "citations": ctx.final_citations,
        "chart_specs": getattr(ctx, "chart_specs", []),
    },
    trace_id=trace_id,
)
```

---

### Fix 5 — Add `chart_specs` to fast-path answer event in `app/core/search_pipeline.py`

Find the answer SearchEvent yield in the fast-path (after citation validation). Add `"chart_specs"` to its data dict. The fast-path does not use WriterAgent, so chart specs here should be auto-generated from `top_passages` structured data.

Add this function to `search_pipeline.py` before the `search()` method:

```python
def _auto_chart_specs(structured_data: list[dict]) -> list[dict]:
    """
    Auto-generate chart specs from structured data rows.
    - Same metric + entity, 3+ periods → line chart
    - Same metric, 2+ entities, 1 period → bar chart
    """
    from collections import defaultdict
    specs = []

    # Group by (entity, metric)
    by_entity_metric: dict = defaultdict(list)
    by_metric_period: dict = defaultdict(list)

    for row in structured_data:
        key_em = (row.get("entity", ""), row.get("metric", ""))
        key_mp = (row.get("metric", ""), row.get("period", ""))
        by_entity_metric[key_em].append(row)
        by_metric_period[key_mp].append(row)

    chart_id = 0

    # Line charts: same entity+metric across 3+ periods
    for (entity, metric), rows in by_entity_metric.items():
        periods = list({r.get("period") for r in rows})
        if len(periods) >= 3:
            unit = rows[0].get("unit", "")
            specs.append({
                "chart_id": f"line_{chart_id}",
                "chart_type": "line",
                "title": f"{entity} — {metric} Trend",
                "x_axis": "period",
                "y_axis": "value",
                "y_label": unit,
                "series": [{"entity": entity, "metric": metric}],
                "data_refs": [r.get("row_id", "") for r in rows],
            })
            chart_id += 1

    # Bar charts: same metric across 2+ entities at same period
    for (metric, period), rows in by_metric_period.items():
        entities = list({r.get("entity") for r in rows})
        if len(entities) >= 2:
            unit = rows[0].get("unit", "")
            specs.append({
                "chart_id": f"bar_{chart_id}",
                "chart_type": "bar",
                "title": f"{metric} Comparison — {period}",
                "x_axis": "entity",
                "y_axis": "value",
                "y_label": unit,
                "series": [{"metric": metric}],
                "data_refs": [r.get("row_id", "") for r in rows],
            })
            chart_id += 1

    return specs
```

---

### Fix 6 — Add `AI_WORDING_FILTER` post-processing in `app/core/reasoning/prompts.py`

Add this function at the bottom of `prompts.py`. Call it on any answer string before returning to the user.

```python
import re

_BANNED_PHRASES = [
    "on-the-ground intelligence", "on-the-ground", "delve into", "delves into",
    "it is worth noting", "it's worth noting", "noteworthy", "robust performance",
    "comprehensive analysis", "it's important to note", "it is important to note",
    "significant strides", "key takeaways", "in conclusion", "to summarize",
    "leveraging synergies", "leveraging", "synergies", "holistic view", "holistic",
    "actionable insights", "deep dive", "game-changing", "paradigm shift",
    "paradigm", "value-add", "going forward", "touch base", "circle back",
    "at the end of the day", "moving forward", "in today's", "in the current landscape",
]

# Compiled for performance
_BANNED_RE = re.compile(
    r"\b(" + "|".join(re.escape(p) for p in sorted(_BANNED_PHRASES, key=len, reverse=True)) + r")\b",
    re.IGNORECASE,
)


def strip_ai_wording(text: str) -> tuple[str, list[str]]:
    """
    Remove or flag AI-style filler phrases from generated answer text.

    Returns:
        (cleaned_text, list_of_removed_phrases)

    Strategy: flag occurrences for logging but DO NOT silently delete mid-sentence.
    Instead, wrap in a comment marker so the LLM can be re-prompted to fix them,
    OR surface them as a quality warning in the trace log.
    """
    found = []

    def _flag(match):
        phrase = match.group(0)
        found.append(phrase)
        return phrase  # Return as-is — caller decides whether to re-prompt or log

    _BANNED_RE.sub(_flag, text)
    return text, found


def has_ai_wording(text: str) -> bool:
    """Quick check: does the text contain banned AI phrases?"""
    return bool(_BANNED_RE.search(text))
```

---

### Fix 7 — Wire `strip_ai_wording` into WriterAgent and fast-path pipeline

**In `app/core/agents/writer_agent.py`**, after extracting `ctx.final_answer`, add:

```python
from app.core.reasoning.prompts import strip_ai_wording

# After: ctx.final_answer = result.get("answer", "")
_, ai_phrases = strip_ai_wording(ctx.final_answer)
if ai_phrases:
    logger.warning(
        "ai_wording_detected",
        phrases=ai_phrases[:5],
        query=ctx.query[:60],
    )
    # Store for trace — future: trigger re-generation with stricter prompt
    ctx.add_trace(
        self.name, "ai_wording_warning",
        f"Banned phrases detected: {ai_phrases[:3]}",
    )
```

**In `app/core/search_pipeline.py`**, after parsing `full_response` and before citation validation, add:

```python
from app.core.reasoning.prompts import has_ai_wording, strip_ai_wording

_, ai_phrases = strip_ai_wording(full_response)
if ai_phrases:
    logger.warning(
        "fast_path_ai_wording",
        trace_id=trace_id,
        phrases=ai_phrases[:5],
    )
```

---

## Summary of All Changes

| Fix | File | Change |
|-----|------|--------|
| 1A | `app/core/reasoning/prompts.py` | Replace `FINANCIAL_ANALYST_SYSTEM` — add footnote block + banned words + institutional tone |
| 1B | `app/core/agents/writer_agent.py` | Replace `WRITER_SYSTEM` — same additions + chart_specs in JSON schema |
| 2 | `app/core/agents/agent_base.py` | Add `chart_specs: list[dict]` field to `AgentContext` |
| 3 | `app/core/agents/writer_agent.py` | Extract `chart_specs` from LLM output into `ctx.chart_specs` |
| 4 | `app/core/agents/orchestrator.py` | Emit `chart_specs` in final answer SearchEvent |
| 5 | `app/core/search_pipeline.py` | Add `_auto_chart_specs()` function + call it in fast-path answer event |
| 6 | `app/core/reasoning/prompts.py` | Add `strip_ai_wording()` + `has_ai_wording()` + `_BANNED_PHRASES` list |
| 7 | `writer_agent.py` + `search_pipeline.py` | Wire `strip_ai_wording` — log banned phrases, downgrade confidence |

## Expected Output After Fixes

**Before:**
```
Apple showed robust performance in Q4, demonstrating significant strides in its
comprehensive services strategy. It is worth noting that revenue grew substantially,
showcasing the company's on-the-ground intelligence in market positioning.
```

**After:**
```
Apple reported revenue of $124.3B in Q4 FY2025 (ended September 28, 2025) [1],
up $13.1B (+11.8%) from $111.2B in Q4 FY2024 [2]. Services segment contributed
$24.2B (+14.3% YoY) [1], representing 19.5% of total revenue.

| Segment | Q4 FY2025 | Q4 FY2024 | YoY |
|---------|-----------|-----------|-----|
| Total Revenue | $124.3B | $111.2B | +11.8% |
| Services | $24.2B | $21.2B | +14.3% |
| Products | $100.1B | $90.0B | +11.2% |

---
**Sources**
[1] Apple 10-K FY2025, Item 7 MD&A (filed 2025-10-30) [AAPL]: *"Total net sales were $124.3 billion..."*
[2] Apple 10-K FY2024, Item 7 MD&A (filed 2024-10-31) [AAPL]: *"Total net sales were $111.2 billion..."*
```
