// Query Expansion — HyDE + step-back (plan §6.2)
//
// "Query understanding: LlamaIndex-style RouterQueryEngine over
//  {simple lookup, decomposition, HyDE, step-back}; budget router on
//  cheap model (Haiku / Flash-Lite)."
//
// We already have decomposition via the Chief Analyst blueprint. This
// module adds the other two strategies:
//
//   HyDE (Hypothetical Document Embedding) — given a terse query like
//     "AAPL Q4 revenue", ask the LLM to write a 1-paragraph hypothetical
//     answer in the voice of an analyst report. The expansion better
//     matches the language of source documents than the raw query, which
//     improves dense-retrieval recall on terse / acronym-heavy queries.
//     Source: Gao et al. (2022), arXiv:2212.10496.
//
//   Step-back prompting — given an over-specific query, ask the LLM to
//     produce a more abstract / general version of the question. Then
//     retrieve using BOTH (specific + abstract). Helps when the literal
//     query has fewer than 3 strong matches.
//     Source: Zheng et al. (2024), arXiv:2310.06117.
//
// Both strategies are pure prompt-engineering — no model fine-tuning, no
// new infra. Cheap-tier LLM (Haiku / Gemini Flash-Lite) is fine.

// ─── HyDE ──────────────────────────────────────────────────────────────────

const HYDE_MAX_CHARS = 800;

export function buildHyDEPrompt(query: string): string {
    return `You are a senior equity-research analyst. A junior analyst has asked the following question. Write a SHORT hypothetical answer (4–6 sentences, ~150–200 words) in the voice of a polished sell-side note. Use specific-sounding numbers and named entities even though they are placeholders — the answer will be used as a SEARCH TARGET, not published. Never preface with "Here is" or any meta-commentary; output only the answer paragraph.

Question: "${query}"`;
}

// Strip preambles + clamp the LLM's hypothetical-answer output. Common
// failure modes: "Sure, here is...", "I cannot...", chain-of-thought
// fragments. We aggressively trim the start until we hit a normal
// sentence opener.
export function parseHyDEResponse(raw: string): string {
    if (!raw) return '';
    let out = raw.trim();
    // Drop common LLM preambles. Stop the in-between match at the colon
    // so the regex doesn't greedily consume the entire answer.
    out = out.replace(/^(?:sure|here\s+is|here's|certainly|of\s+course|hypothetical\s+answer)[^:\n]{0,80}[:\.]\s*/i, '');
    // Strip surrounding quotes.
    out = out.replace(/^["']/, '').replace(/["']$/, '');
    // Drop refusal-shaped responses.
    if (/^(?:i\s+cannot|i'?m\s+sorry|as\s+an\s+ai)/i.test(out)) return '';
    if (out.length > HYDE_MAX_CHARS) out = out.slice(0, HYDE_MAX_CHARS - 1) + '…';
    return out.trim();
}

export interface QueryExpansionOptions {
    callLLM?: (prompt: string) => Promise<string>;
}

export async function generateHyDE(
    query: string,
    opts: QueryExpansionOptions = {},
): Promise<string> {
    const q = (query || '').trim();
    if (!q) return '';
    if (!opts.callLLM) {
        throw new Error('generateHyDE: callLLM required (no default provided to avoid circular deps)');
    }
    let raw = '';
    try { raw = await opts.callLLM(buildHyDEPrompt(q)); }
    catch { return ''; }
    return parseHyDEResponse(raw);
}

// ─── Step-back ────────────────────────────────────────────────────────────

const STEPBACK_MAX_CHARS = 200;

export function buildStepBackPrompt(query: string): string {
    return `You are a research methodologist. Produce a STEP-BACK version of the question below — a more general / abstract version that captures the underlying topic without the specific quarter, ticker, or metric. Output ONLY the rephrased question, no preamble.

Examples:
  Q: "What was AAPL's iPhone revenue in Q4 2025 vs Q4 2024 and what is the implied YoY growth?"
  Step-back: "Apple's iPhone revenue trends over recent quarters."

  Q: "How did NVDA gross margin change between Q1 FY26 and Q2 FY26 and what does management attribute it to?"
  Step-back: "NVIDIA gross margin trajectory and management drivers."

Now produce the step-back for:
"${query}"`;
}

// Step-back parser: similar pre-amble strip, but enforce that the result
// is a single sentence ending with a period or question mark — that's
// what the prompt asks for. Reject multi-paragraph or refusal-shaped
// outputs.
export function parseStepBackResponse(raw: string): string {
    if (!raw) return '';
    let out = raw.trim();
    out = out.replace(/^(?:step-?back\s*[:\.]?\s*)/i, '');
    out = out.replace(/^["']/, '').replace(/["']$/, '');
    if (/^(?:i\s+cannot|i'?m\s+sorry|as\s+an\s+ai)/i.test(out)) return '';
    // Take only the first paragraph.
    out = out.split(/\n{2,}/)[0].trim();
    // Take only the first sentence to keep the "abstract version" tight.
    const firstSentenceEnd = out.search(/[.!?]\s+(?=[A-Z(])/);
    if (firstSentenceEnd > 0) out = out.slice(0, firstSentenceEnd + 1).trim();
    if (out.length > STEPBACK_MAX_CHARS) out = out.slice(0, STEPBACK_MAX_CHARS - 1) + '…';
    return out;
}

export async function generateStepBack(
    query: string,
    opts: QueryExpansionOptions = {},
): Promise<string> {
    const q = (query || '').trim();
    if (!q) return '';
    if (!opts.callLLM) {
        throw new Error('generateStepBack: callLLM required (no default provided to avoid circular deps)');
    }
    let raw = '';
    try { raw = await opts.callLLM(buildStepBackPrompt(q)); }
    catch { return ''; }
    return parseStepBackResponse(raw);
}

// ─── Unified expander ─────────────────────────────────────────────────────
// Run both strategies in parallel. Returns the original query plus the
// non-empty expansions. Callers can feed the resulting array into
// search-multiple-queries to widen retrieval.

export interface ExpandedQuerySet {
    original: string;
    hyde: string;            // empty when generation failed
    stepBack: string;        // empty when generation failed
    all: string[];           // [original, hyde, stepBack] minus empties
}

export async function expandQuery(
    query: string,
    opts: QueryExpansionOptions = {},
): Promise<ExpandedQuerySet> {
    const original = (query || '').trim();
    if (!original) return { original, hyde: '', stepBack: '', all: [] };
    const [hydeR, stepR] = await Promise.allSettled([
        generateHyDE(original, opts),
        generateStepBack(original, opts),
    ]);
    const hyde = hydeR.status === 'fulfilled' ? hydeR.value : '';
    const stepBack = stepR.status === 'fulfilled' ? stepR.value : '';
    const all = [original, hyde, stepBack].filter(s => s.length > 0);
    return { original, hyde, stepBack, all };
}
