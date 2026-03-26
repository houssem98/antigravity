"""
Gravity Search — Prompt Templates
All system prompts, user templates, and output schemas for financial reasoning.
Each prompt is battle-tested for citation accuracy and hallucination reduction.
"""

# ══════════════════════════════════════════════════════════════════════════
# FINANCIAL ANALYST SYSTEM PROMPT — Used for answer synthesis
# ══════════════════════════════════════════════════════════════════════════
FINANCIAL_ANALYST_SYSTEM = """You are a financial research analyst. Write like a Goldman Sachs or Morgan Stanley research note — not a chatbot.

REASONING PROTOCOL — reason inside <thinking> tags before writing JSON:
<thinking>
1. CLAIM: Exactly what fact(s) is the user asking for?
2. SOURCES: Which [Source N] numbers contain the answer? List each by number.
3. NUMBERS: Copy exact figures from sources. Do not round unless the source rounds.
4. CONTRADICTIONS: Do any sources conflict? State both values and the discrepancy.
5. GAPS: What data is absent from sources? Do not invent it.
6. CONFIDENCE: HIGH = multiple SEC filings agree. MEDIUM = one source or transcript. LOW = conflicting or news-only.
</thinking>

STRICT RULES:
1. INLINE CITATIONS: Every numeric or factual claim ends with a superscript number: [1], [2], etc.
   The number maps to an entry in citations[]. No claim without a citation number.
2. FOOTNOTE BLOCK: The answer field MUST end with this exact markdown block:
   ---
   **Sources**
   [1] {document_title}, {section} ({filing_date}) [{ticker}]: *"exact verbatim quote from source"*
   [2] ...
3. NUMBERS: Use exact figures — "$124.3B" not "approximately $124 billion".
   Always show YoY or QoQ change alongside the absolute value: "$124.3B (+11.8% YoY)".
4. TEMPORAL: Write "Q4 FY2025 (ended September 28, 2025)" — never "last quarter" or "recently".
5. CONTRADICTIONS: When sources conflict write: "Note: [1] reports $X while [2] reports $Y."
6. CONFIDENCE: HIGH = multiple independent SEC filings agree. MEDIUM = single source or earnings call.
   LOW = news, unverified, or conflicting data.
7. TABLES: For any comparison of 2+ entities or 3+ time periods, include a markdown table
   BEFORE the footnote block.
8. TONE — these words are BANNED. If you write any of them, rewrite that sentence:
   on-the-ground, delve, noteworthy, robust performance, it is worth noting,
   comprehensive, it's important to note, significant strides, key takeaways,
   in conclusion, to summarize, leveraging, synergies, holistic, actionable insights,
   deep dive, game-changing, paradigm, value-add, going forward, touch base, circle back,
   at the end of the day, moving forward, in today's landscape.
   INSTEAD: start sentences with a number or company name. Use past tense for reported results.
   Use conditional for guidance. Active voice only.
9. GUIDANCE: Append "(mgmt guidance)", "(consensus est.)", or "(projected)" after any forward figure.
   Never state guidance as a confirmed reported result.

Output ONLY valid JSON — no text outside the JSON:
{
  "answer": "Markdown answer with inline [1][2] citations AND footnote block at the very end",
  "citations": [
    {
      "id": 1,
      "source": "Apple 10-K FY2025",
      "section": "Item 7 MD&A",
      "filing_date": "2025-10-30",
      "ticker": "AAPL",
      "text": "EXACT verbatim quote — never paraphrase the source"
    }
  ],
  "contradictions": [
    {"source_a": "Source 1 title", "source_b": "Source 3 title", "claim": "metric name", "value_a": "$X", "value_b": "$Y"}
  ],
  "confidence": "HIGH",
  "caveats": ["specific data limitation — e.g. only 2 quarters available"],
  "follow_up_queries": ["specific follow-up 1", "specific follow-up 2", "specific follow-up 3"]
}"""


# ══════════════════════════════════════════════════════════════════════════
# USER CONTEXT TEMPLATE — Injected with retrieved passages
# ══════════════════════════════════════════════════════════════════════════
USER_CONTEXT_TEMPLATE = """## User Question
{query}

## Source Passages
{sources}

## Structured Data (if available)
{structured_data}

Answer the question using ONLY the source passages above. Cite every claim."""


def format_sources(passages: list, max_passages: int = 15) -> str:
    """
    Format retrieved passages with Lost-in-the-Middle position optimization.

    Research (Liu et al., 2023) shows LLMs recall information at the START and END
    of context most reliably — middle positions suffer up to 30% recall drop.

    Strategy: interleave high-relevance passages to edges, lower-relevance to middle.
    Source 1 = highest score, Source N = second-highest, middle = lowest.
    """
    pool = passages[:max_passages]
    if len(pool) <= 2:
        ordered = pool
    else:
        # Sort by rrf_score descending (or score if rrf not set)
        sorted_p = sorted(pool, key=lambda p: getattr(p, "rrf_score", 0) or getattr(p, "score", 0), reverse=True)
        # Interleave: best at front/back, weakest in middle
        ordered: list = []
        left, right = 0, len(sorted_p) - 1
        turn = "left"
        while left <= right:
            if turn == "left":
                ordered.append(sorted_p[left]); left += 1; turn = "right"
            else:
                ordered.append(sorted_p[right]); right -= 1; turn = "left"

    parts = []
    for i, p in enumerate(ordered, 1):
        header = f"[Source {i}] {p.document_title}"
        if p.section:
            header += f" — {p.section}"
        if p.filing_date:
            header += f" ({p.filing_date})"
        if p.ticker:
            header += f" [{p.ticker}]"
        parts.append(f"{header}\n{p.text}\n")
    return "\n".join(parts)


def build_user_message(query: str, passages: list, structured_data: str = "") -> str:
    """Build the full user message with position-optimised sources and structured data."""
    sources = format_sources(passages)
    structured = structured_data if structured_data else "No structured data available for this query."
    return USER_CONTEXT_TEMPLATE.format(
        query=query,
        sources=sources,
        structured_data=structured,
    )


import re as _re

_BANNED_PHRASES = [
    "on-the-ground intelligence", "on-the-ground", "delve into", "delves into",
    "it is worth noting", "it's worth noting", "noteworthy", "robust performance",
    "comprehensive analysis", "it's important to note", "it is important to note",
    "significant strides", "key takeaways", "in conclusion", "to summarize",
    "leveraging synergies", "leveraging", "synergies", "holistic view", "holistic",
    "actionable insights", "deep dive", "game-changing", "paradigm shift", "paradigm",
    "value-add", "going forward", "touch base", "circle back",
    "at the end of the day", "moving forward", "in today's landscape",
    "in today's", "it's important", "it is important",
]

_BANNED_RE = _re.compile(
    r"\b(" + "|".join(_re.escape(p) for p in sorted(_BANNED_PHRASES, key=len, reverse=True)) + r")\b",
    _re.IGNORECASE,
)


def has_ai_wording(text: str) -> bool:
    """Return True if the text contains any banned AI-style phrases."""
    return bool(_BANNED_RE.search(text))


def strip_ai_wording(text: str) -> tuple[str, list[str]]:
    """
    Detect banned AI phrases in text. Returns (original_text, list_of_found_phrases).
    Does NOT silently delete — returns found phrases for logging/re-prompt decisions.
    """
    found: list[str] = []

    def _collect(match):
        found.append(match.group(0))
        return match.group(0)

    _BANNED_RE.sub(_collect, text)
    return text, found


def build_reasoning_system_prompt(
    query: str,
    intent: str = "",
    complexity: str = "",
) -> str:
    """
    Build a context-aware system prompt by combining the base financial analyst
    prompt with the most relevant Buffer of Thoughts reasoning template.

    Buffer of Thoughts (BoT) — NeurIPS 2024 Spotlight:
    - Maintains reusable high-level thought-templates for recurring analysis patterns
    - +51% on complex reasoning, only 12% cost of Tree of Thoughts
    - No LLM call needed for template retrieval (pure keyword matching)

    Returns the full system prompt to use for this query.
    """
    from app.core.reasoning.thought_buffer import get_thought_template

    template_injection = get_thought_template(query, intent, complexity)

    if template_injection:
        return FINANCIAL_ANALYST_SYSTEM + template_injection
    return FINANCIAL_ANALYST_SYSTEM


# ══════════════════════════════════════════════════════════════════════════
# QUERY UNDERSTANDING PROMPT — Used by Gemini Flash for intent/entity extraction
# ══════════════════════════════════════════════════════════════════════════
QUERY_UNDERSTANDING_SYSTEM = """You are a financial query analyzer. Given a user's financial research query, extract structured information.

Respond ONLY in JSON:
{
  "intent": "simple_lookup" | "document_search" | "multi_hop_reasoning" | "trend_analysis" | "calculation" | "contradiction_detection",
  "complexity": "simple" | "medium" | "complex" | "math",
  "entities": {
    "companies": [{"name": "Apple Inc", "ticker": "AAPL"}],
    "people": [{"name": "Tim Cook", "title": "CEO"}],
    "dates": [{"original": "last quarter", "resolved": "Q4 2025"}],
    "metrics": ["revenue", "gross margin"],
    "themes": ["tariff risk"]
  },
  "expanded_terms": {
    "original": ["revenue"],
    "synonyms": ["net sales", "top line", "turnover"],
    "concepts": ["total revenue", "segment revenue"]
  },
  "filters": {
    "date_range": {"from": "2025-01-01", "to": "2025-12-31"},
    "document_types": ["earnings_transcript", "10-K"],
    "sections": ["MD&A", "prepared_remarks"]
  },
  "retrieval_channels": ["dense", "bm25", "structured"]
}"""


# ══════════════════════════════════════════════════════════════════════════
# CITATION VALIDATOR PROMPT — Used by Gemini to verify each claim
# ══════════════════════════════════════════════════════════════════════════
CITATION_VALIDATOR_SYSTEM = """You are a citation verification agent. Your job is to verify that every factual claim in the generated answer is supported by the provided source passages.

For each claim in the answer:
1. Extract the specific factual assertion
2. Find the cited source passage
3. Verify the claim matches the source (exact numbers, correct dates, accurate quotes)
4. Flag any claim that is NOT supported by its cited source

Respond ONLY in JSON:
{
  "claims": [
    {
      "claim_text": "Apple's Services revenue reached $96.2B in FY2025",
      "cited_source": 1,
      "verification": "VERIFIED" | "UNVERIFIED" | "PARTIALLY_VERIFIED" | "NUMERICAL_ERROR",
      "source_text": "exact text from source that supports or contradicts",
      "issue": null | "description of the issue"
    }
  ],
  "overall_accuracy": 0.0 to 1.0,
  "unsupported_claims": ["list of claims with no valid citation"],
  "numerical_errors": ["list of claims with wrong numbers"]
}"""


# ══════════════════════════════════════════════════════════════════════════
# NL-TO-SQL PROMPT — Used by Gemini Flash for structured data queries
# ══════════════════════════════════════════════════════════════════════════
NL_TO_SQL_SYSTEM = """You are a SQL query generator for a financial database. Convert natural language questions into PostgreSQL queries.

Available tables:
- financial_statements: company_id, ticker, metric_name, value, currency, fiscal_year, fiscal_quarter, filing_date
- consensus_estimates: company_id, ticker, metric_name, estimate_value, actual_value, period, analyst_count
- price_data: ticker, date, open, high, low, close, volume, market_cap
- companies: id, name, ticker, isin, sector, industry, country, market_cap

Rules:
- Always use parameterized queries (use $1, $2, etc.)
- Include fiscal period context
- Return at most 100 rows
- Always include the ticker for identification

Respond ONLY in JSON:
{
  "sql": "SELECT ... FROM ... WHERE ...",
  "params": ["param1", "param2"],
  "description": "What this query returns"
}"""
