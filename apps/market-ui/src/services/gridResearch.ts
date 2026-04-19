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

export interface GridPrompt {
    id: string;
    label: string;                 // column header
    prompt: string;                // the templated instruction; `{ticker}` is substituted
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
    modelUsed?: ResearchModelId;
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
}

export async function runGridCell(
    def: GridDef,
    ticker: string,
    promptId: string,
    deps: CellRunnerDeps,
    signal?: AbortSignal,
): Promise<GridCell> {
    const prompt = def.prompts.find(p => p.id === promptId);
    if (!prompt) {
        return {
            ticker, promptId,
            status: 'error',
            error: `Unknown prompt id: ${promptId}`,
        };
    }

    const resolved = resolvePrompt(prompt, ticker);
    const started = Date.now();

    try {
        // Optional web context (ignored on failure — cell should still answer).
        let citations: Citation[] = [];
        if (deps.searchWeb) {
            try {
                citations = await deps.searchWeb(`${ticker} ${prompt.label}`, signal);
            } catch { /* soft-fail */ }
        }

        const contextBlock = citations.length
            ? `\n\nContext (cite by [n]):\n${citations.map(c => `[${c.id}] ${c.title}: ${c.url}`).join('\n')}\n\n`
            : '';

        const fullPrompt = `You are a sell-side equity analyst. Answer concisely (under 150 words) with citations like [1].${contextBlock}Question: ${resolved}`;

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

    let cursor = 0;
    const workers: Promise<void>[] = [];
    for (let w = 0; w < Math.min(concurrency, ids.length); w += 1) {
        workers.push((async () => {
            while (cursor < ids.length) {
                if (options.signal?.aborted) return;
                const idx = cursor;
                cursor += 1;
                const { ticker, promptId } = ids[idx];
                current = updateCell(current, ticker, promptId, { status: 'running' });
                const cell = await runGridCell(state.def, ticker, promptId, deps, options.signal);
                current = updateCell(current, ticker, promptId, cell);
                options.onCellUpdate?.(current, cell);
            }
        })());
    }
    await Promise.all(workers);
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
    return rows.map(r => r.map(csvEscape).join(',')).join('\r\n');
}
