// Grid Research — Hebbia Matrix / AlphaSense Generative Grid analogue.
// Rows = tickers or documents. Columns = analyst prompt templates.
// Each cell = one cited answer. Cells run independently, in parallel,
// with per-cell status/error isolation so one failure doesn't tank the grid.
//
// This module owns:
//   • the data model (GridDef, GridState, GridCell)
//   • pure state transitions (initialize, updateCell, allCellIds)
//   • the cell runner signature (runGridCell) — impure but mockable
//
// It does NOT own React rendering or persistence; those live in stores + pages.

import type { Citation, ResearchModelId } from './deepResearchService';
import { queryGravityRAG, formatRAGSourcesForPrompt, type GravityRAGResult } from './gravitySearchService';

export interface GridPrompt {
    id: string;
    label: string;                 // column header
    prompt: string;                // the templated instruction; `{ticker}` is substituted
    synthesis?: boolean;           // if true, this cell compares all tickers (no {ticker} substitution)
}

export interface GridDef {
    id: string;
    name: string;
    tickers: string[];
    prompts: GridPrompt[];
}

export type CellStatus = 'pending' | 'running' | 'done' | 'error' | 'cancelled';

export interface GridCell {
    ticker: string;
    promptId: string;
    status: CellStatus;
    answer?: string;
    citations?: Citation[];
    error?: string;
    durationMs?: number;
    modelUsed?: ResearchModelId | string;
    ragUsed?: boolean;
}

export interface GridState {
    def: GridDef;
    cells: Record<string, GridCell>;   // keyed by cellKey(ticker, promptId)
    startedAt?: string;
    completedAt?: string;
}

export function cellKey(ticker: string, promptId: string): string {
    return `${ticker}::${promptId}`;
}

export function initializeGrid(def: GridDef): GridState {
    const cells: Record<string, GridCell> = {};
    for (const ticker of def.tickers) {
        for (const p of def.prompts) {
            cells[cellKey(ticker, p.id)] = {
                ticker,
                promptId: p.id,
                status: 'pending',
            };
        }
    }
    // Initialize synthesis cells (for "ALL" ticker)
    for (const p of def.prompts) {
        if (p.synthesis) {
            cells[cellKey('ALL', p.id)] = {
                ticker: 'ALL',
                promptId: p.id,
                status: 'pending',
            };
        }
    }
    return { def, cells };
}

export function updateCell(
    state: GridState,
    ticker: string,
    promptId: string,
    patch: Partial<GridCell>,
): GridState {
    const k = cellKey(ticker, promptId);
    const existing = state.cells[k];
    if (!existing) return state;
    return {
        ...state,
        cells: { ...state.cells, [k]: { ...existing, ...patch } },
    };
}

export function allCellIds(def: GridDef): Array<{ ticker: string; promptId: string }> {
    const out: Array<{ ticker: string; promptId: string }> = [];
    for (const ticker of def.tickers) {
        for (const p of def.prompts) {
            out.push({ ticker, promptId: p.id });
        }
    }
    return out;
}

export function gridProgress(state: GridState): { done: number; total: number; failed: number } {
    const values = Object.values(state.cells);
    return {
        total: values.length,
        done: values.filter(c => c.status === 'done').length,
        failed: values.filter(c => c.status === 'error').length,
    };
}

export function resolvePrompt(prompt: GridPrompt, ticker: string): string {
    return prompt.prompt.replace(/\{ticker\}/g, ticker);
}

// ─── Cell runner ─────────────────────────────────────────────────────────────
// One LLM call per cell (not the full deep-research pipeline). Keeps per-cell
// latency to a few seconds so a 10×5 grid finishes in under a minute.

export interface CellRunnerDeps {
    callLLM: (prompt: string, signal?: AbortSignal) => Promise<{ text: string; model: ResearchModelId }>;
    searchWeb?: (query: string, signal?: AbortSignal) => Promise<Citation[]>;
    searchGravity?: (query: string, ticker: string, signal?: AbortSignal) => Promise<GravityRAGResult>;
}

export async function runGridCell(
    def: GridDef,
    ticker: string,
    promptId: string,
    deps: CellRunnerDeps,
    signal?: AbortSignal,
    state?: GridState,  // for synthesis cells: need all ticker answers
): Promise<GridCell> {
    const prompt = def.prompts.find(p => p.id === promptId);
    if (!prompt) {
        return {
            ticker, promptId,
            status: 'error',
            error: `Unknown prompt id: ${promptId}`,
        };
    }

    const started = Date.now();

    // ── Synthesis cells: compare all tickers ────────────────────────────
    if (prompt.synthesis && state) {
        try {
            // Collect answers from ALL non-synthesis prompts across all tickers
            const tickerAnswers: Record<string, string> = {};
            const nonSynthesisPrompts = def.prompts.filter(p => !p.synthesis);

            for (const t of def.tickers) {
                const answers: string[] = [];
                for (const p of nonSynthesisPrompts) {
                    const cell = state.cells[cellKey(t, p.id)];
                    if (cell?.status === 'done' && cell.answer) {
                        answers.push(`**${p.label}:** ${cell.answer}`);
                    }
                }
                if (answers.length > 0) {
                    tickerAnswers[t] = answers.join('\n\n');
                }
            }

            if (Object.keys(tickerAnswers).length === 0) {
                return {
                    ticker,
                    promptId,
                    status: 'error',
                    error: 'No completed cells to synthesize',
                    durationMs: Date.now() - started,
                };
            }

            const synthesisPrompt = `You are a sell-side equity analyst. Below is comprehensive research for each ticker:\n\n${Object.entries(tickerAnswers)
                .map(([t, ans]) => `## ${t}\n${ans}`)
                .join('\n\n---\n\n')}\n\nTask: ${prompt.prompt}`;

            const { text, model } = await deps.callLLM(synthesisPrompt, signal);
            return {
                ticker,
                promptId,
                status: 'done',
                answer: text,
                durationMs: Date.now() - started,
                modelUsed: model,
            };
        } catch (e: any) {
            if (signal?.aborted) {
                return { ticker, promptId, status: 'cancelled', durationMs: Date.now() - started };
            }
            return {
                ticker, promptId,
                status: 'error',
                error: e?.message ?? 'Unknown error',
                durationMs: Date.now() - started,
            };
        }
    }

    // ── Regular per-ticker cells ───────────────────────────────────────
    const resolved = resolvePrompt(prompt, ticker);

    try {
        // ── RAG retrieval (primary) ────────────────────────────────────────
        let ragResult: GravityRAGResult | null = null;
        if (deps.searchGravity) {
            try {
                ragResult = await deps.searchGravity(`${ticker} ${resolved}`, ticker, signal);
            } catch { /* soft-fail */ }
        }

        // If RAG returned a grounded answer, use it directly — no LLM call needed.
        if (ragResult?.available && ragResult.answer) {
            const ragCitations: Citation[] = ragResult.sources.map((s, i) => ({
                id: i + 1,
                title: [s.title, s.ticker && `(${s.ticker})`, s.date && `[${s.date}]`].filter(Boolean).join(' '),
                url: `gravity://source/${s.id}`,
                source: 'gravity',
                publishedDate: s.date || undefined,
            }));
            return {
                ticker, promptId,
                status: 'done',
                answer: ragResult.answer,
                citations: ragCitations,
                durationMs: Date.now() - started,
                modelUsed: 'gravity-rag',
                ragUsed: true,
            };
        }

        // ── Optional web context (fallback when RAG unavailable) ──────────
        let citations: Citation[] = [];
        if (deps.searchWeb) {
            try {
                citations = await deps.searchWeb(`${ticker} ${prompt.label}`, signal);
            } catch { /* soft-fail */ }
        }

        // Inject RAG context even when it has no answer (sources still useful)
        const ragBlock = ragResult ? formatRAGSourcesForPrompt(ragResult) : '';
        const webBlock = citations.length
            ? `\n\nWeb context (cite by [n]):\n${citations.map(c => `[${c.id}] ${c.title}: ${c.url}`).join('\n')}\n\n`
            : '';
        const contextBlock = [ragBlock, webBlock].filter(Boolean).join('\n\n');

        const fullPrompt = `You are a sell-side equity analyst. Answer concisely (under 150 words) with citations like [1].${contextBlock ? '\n\n' + contextBlock : ''}Question: ${resolved}`;

        const { text, model } = await deps.callLLM(fullPrompt, signal);

        return {
            ticker, promptId,
            status: 'done',
            answer: text,
            citations,
            durationMs: Date.now() - started,
            modelUsed: model,
        };
    } catch (e: any) {
        if (signal?.aborted || /abort/i.test(e?.name ?? '')) {
            return { ticker, promptId, status: 'cancelled', durationMs: Date.now() - started };
        }
        return {
            ticker, promptId,
            status: 'error',
            error: e?.message || String(e),
            durationMs: Date.now() - started,
        };
    }
}

// Run the whole grid with bounded concurrency. Emits updated state after each
// cell completes so the UI can render progressively.
export async function runGrid(
    state: GridState,
    deps: CellRunnerDeps,
    options: {
        concurrency?: number;
        signal?: AbortSignal;
        onCellUpdate?: (state: GridState, cell: GridCell) => void;
    } = {},
): Promise<GridState> {
    const concurrency = options.concurrency ?? 4;
    const ids = allCellIds(state.def);
    let current: GridState = { ...state, startedAt: state.startedAt ?? new Date().toISOString() };

    // Separate regular cells from synthesis cells
    const regularIds = ids.filter(id => !state.def.prompts.find(p => p.id === id.promptId)?.synthesis);
    const synthesisCells = state.def.prompts.filter(p => p.synthesis);

    // ── Run regular cells in parallel ──────────────────────────────────
    let cursor = 0;
    const workers: Promise<void>[] = [];
    for (let w = 0; w < Math.min(concurrency, regularIds.length); w += 1) {
        workers.push((async () => {
            while (cursor < regularIds.length) {
                if (options.signal?.aborted) return;
                const idx = cursor;
                cursor += 1;
                const { ticker, promptId } = regularIds[idx];
                current = updateCell(current, ticker, promptId, { status: 'running' });
                const cell = await runGridCell(state.def, ticker, promptId, deps, options.signal);
                current = updateCell(current, ticker, promptId, cell);
                options.onCellUpdate?.(current, cell);
            }
        })());
    }
    await Promise.all(workers);

    // ── Run synthesis cells sequentially ───────────────────────────────
    for (const synthPrompt of synthesisCells) {
        if (options.signal?.aborted) break;
        // Synthesis cell: ticker represents "all tickers"
        const ticker = 'ALL';
        current = updateCell(current, ticker, synthPrompt.id, { status: 'running' });
        const cell = await runGridCell(state.def, ticker, synthPrompt.id, deps, options.signal, current);
        current = updateCell(current, ticker, synthPrompt.id, cell);
        options.onCellUpdate?.(current, cell);
    }

    return { ...current, completedAt: new Date().toISOString() };
}

// ─── Seed prompts ────────────────────────────────────────────────────────────
// Typical analyst workflow: one ticker × these 6 questions answers ~80% of
// quick triage on a watchlist.

export const SEED_GRID_PROMPTS: GridPrompt[] = [
    { id: 'thesis',    label: 'Thesis',       prompt: 'What is the core investment thesis for {ticker}? State the bull and bear case in one sentence each.' },
    { id: 'moat',      label: 'Moat',         prompt: 'What is {ticker}\'s competitive moat? How durable is it?' },
    { id: 'catalysts', label: 'Catalysts',    prompt: 'What are the top 3 near-term catalysts (next 6 months) for {ticker}?' },
    { id: 'risks',     label: 'Risks',        prompt: 'What are the top 3 downside risks for {ticker}? Quantify where possible.' },
    { id: 'valuation', label: 'Valuation',    prompt: 'What is {ticker}\'s current valuation vs peers and historical average? Flag any dislocations.' },
    { id: 'preview',   label: 'Next Print',   prompt: 'What are consensus expectations for {ticker}\'s next earnings print? Where could it surprise?' },
    { id: 'synthesis', label: '🔍 Comparison', prompt: 'Synthesize the individual theses across all tickers. Rank them by conviction. Which has the strongest near-term edge? Most durable moat? Biggest risk?', synthesis: true },
];

// ─── CSV Export ──────────────────────────────────────────────────────────────
// RFC-4180: wrap fields that contain comma / quote / newline in double quotes;
// escape embedded quotes by doubling them. Empty strings are allowed.

function csvEscape(value: unknown): string {
    const s = value == null ? '' : String(value);
    if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

export function toCSV(state: GridState): string {
    const header = ['ticker', ...state.def.prompts.map(p => p.label)];
    const rows: string[][] = [header];

    // Regular ticker rows
    for (const ticker of state.def.tickers) {
        const row: string[] = [ticker];
        for (const p of state.def.prompts) {
            const cell = state.cells[cellKey(ticker, p.id)];
            if (!cell || cell.status === 'pending') row.push('');
            else if (cell.status === 'running') row.push('(running)');
            else if (cell.status === 'error') row.push(`(error: ${cell.error ?? 'unknown'})`);
            else if (cell.status === 'cancelled') row.push('(cancelled)');
            else row.push(cell.answer ?? '');
        }
        rows.push(row);
    }

    // Synthesis row (if any synthesis cells exist)
    const synthesisCells = state.def.prompts.filter(p => p.synthesis);
    if (synthesisCells.length > 0) {
        const synthRow: string[] = ['[COMPARISON]'];
        for (const p of state.def.prompts) {
            const cell = state.cells[cellKey('ALL', p.id)];
            if (!cell || cell.status === 'pending') synthRow.push('');
            else if (cell.status === 'running') synthRow.push('(running)');
            else if (cell.status === 'error') synthRow.push(`(error: ${cell.error ?? 'unknown'})`);
            else if (cell.status === 'cancelled') synthRow.push('(cancelled)');
            else synthRow.push(cell.answer ?? '');
        }
        rows.push(synthRow);
    }

    return rows.map(r => r.map(csvEscape).join(',')).join('\r\n');
}
