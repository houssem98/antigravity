// ─── Gravity RAG Search Service ──────────────────────────────────────────────
// Calls the backend Gravity API to get RAG-powered results from local databases
// (Qdrant, Elasticsearch, Neo4j, PostgreSQL).
//
// Graceful degradation: if the backend is unavailable (Docker not running),
// returns empty results so Deep Research still works web-only.
// ─────────────────────────────────────────────────────────────────────────────

const GRAVITY_API_URL = import.meta.env.VITE_GRAVITY_API_URL || 'http://localhost:8000';
const RAG_TIMEOUT_MS = 45_000; // 45s — agentic pipeline needs up to 40s

export interface GravityRAGSource {
    id: string;
    title: string;
    section: string;
    text: string;
    ticker: string;
    date: string;
    document_type: string;
    source_quality: number;
    score: number;
}

export interface GravityRAGResult {
    available: boolean;          // Whether the backend responded
    answer: string;              // Synthesized answer from RAG pipeline
    sources: GravityRAGSource[]; // Retrieved & reranked passages
    structured_data: Array<{     // Extracted financial metrics
        metric: string;
        value: string;
        unit?: string;
        period?: string;
        entity?: string;
        source_id?: string;
    }>;
    citations: Array<{
        citation_number: number;
        source_id: string;
        document_title: string;
        text: string;
    }>;
    confidence: string;
    latency_ms: number;
}

const EMPTY_RESULT: GravityRAGResult = {
    available: false,
    answer: '',
    sources: [],
    structured_data: [],
    citations: [],
    confidence: 'NONE',
    latency_ms: 0,
};

/**
 * Query the Gravity RAG backend for local database results.
 * 
 * Runs the full agentic pipeline: Query Understanding → Planner → Reader 
 * (5-channel retrieval) → Extractor → Critic → Verifier → Writer.
 * 
 * Returns empty result on ANY failure (timeout, connection refused, 500, etc.)
 * so that Deep Research can always proceed with web-only sources.
 */
export interface GravityRAGFilters {
    document_types?: string[];
    companies?: string[];
    date_range?: { from?: string; to?: string };
}

export async function queryGravityRAG(query: string, filters?: GravityRAGFilters): Promise<GravityRAGResult> {
    const t0 = performance.now();

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), RAG_TIMEOUT_MS);

        const response = await fetch(`${GRAVITY_API_URL}/v1/search`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': 'deep-research-internal',
            },
            body: JSON.stringify({
                query,
                filters: filters && Object.keys(filters).length > 0 ? filters : undefined,
                options: { reasoning_depth: 'fast', stream: false },
            }),
            signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
            console.warn(`[GravityRAG] Backend returned ${response.status}`);
            return EMPTY_RESULT;
        }

        const data = await response.json();
        const latency = Math.round(performance.now() - t0);

        return {
            available: true,
            answer: data.answer || '',
            sources: (data.sources || []).map((s: any) => ({
                id: s.id || s.chunk_id || '',
                title: s.title || s.document_title || '',
                section: s.section || '',
                text: s.text || '',
                ticker: s.ticker || '',
                date: s.date || s.filing_date || '',
                document_type: s.document_type || '',
                source_quality: s.source_quality || 5,
                score: s.score || 0,
            })),
            structured_data: data.structured_data || [],
            citations: data.citations || [],
            confidence: data.confidence || 'MEDIUM',
            latency_ms: latency,
        };
    } catch (error: any) {
        const isTimeout = error?.name === 'AbortError';
        console.warn(
            `[GravityRAG] ${isTimeout ? 'Timed out' : 'Unavailable'}: ${error?.message || error}`
        );
        return EMPTY_RESULT;
    }
}

/**
 * Format RAG sources as text blocks for Gemini prompt injection.
 * These are placed BEFORE web sources to give them higher priority.
 */
export function formatRAGSourcesForPrompt(ragResult: GravityRAGResult): string {
    if (!ragResult.available || ragResult.sources.length === 0) return '';

    const blocks = ragResult.sources.slice(0, 10).map((s, i) => {
        const header = [
            `[RAG-${i + 1}]`,
            s.title && `"${s.title}"`,
            s.ticker && `(${s.ticker})`,
            s.section && `— ${s.section}`,
            s.date && `[${s.date}]`,
            `Authority: ${s.source_quality}/10`,
        ].filter(Boolean).join(' ');

        return `${header}\n${s.text}`;
    });

    return `=== LOCAL DATABASE SOURCES (verified SEC filings) ===\n\n${blocks.join('\n\n---\n\n')}`;
}

/**
 * Format RAG structured data as a markdown table for report prompts.
 */
export function formatRAGStructuredData(ragResult: GravityRAGResult): string {
    if (!ragResult.available || ragResult.structured_data.length === 0) return '';

    const rows = ragResult.structured_data.slice(0, 20).map(d =>
        `| ${d.metric || '-'} | ${d.value || '-'} | ${d.unit || '-'} | ${d.period || '-'} | ${d.entity || '-'} |`
    );

    return [
        'RAG FINANCIAL DATA (from indexed SEC filings):',
        '',
        '| Metric | Value | Unit | Period | Entity |',
        '|--------|-------|------|--------|--------|',
        ...rows,
    ].join('\n');
}
