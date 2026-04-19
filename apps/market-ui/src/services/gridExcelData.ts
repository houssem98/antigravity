// Pure data shaping for Excel export — kept separate from gridExcel.ts so
// unit tests and Node-bundled eval harness don't drag in exceljs (which is
// Node-only and uses dynamic requires that trip up esbuild's ESM bundler).

import type { GridState } from './gridResearch';
import { cellKey } from './gridResearch';

export interface GridSheetData {
    headers: string[];
    rows: string[][];
}

export interface GridSourceRow {
    ticker: string;
    promptLabel: string;
    citationId: number;
    title: string;
    url: string;
}

// Mirrors toCSV cell-status handling so CSV and XLSX stay in sync.
export function buildGridSheetData(state: GridState): GridSheetData {
    const headers = ['Ticker', ...state.def.prompts.map(p => p.label)];
    const rows: string[][] = [];
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
    return { headers, rows };
}

// Flattens all citations across cells into a sourcebook sheet.
export function buildSourceRows(state: GridState): GridSourceRow[] {
    const out: GridSourceRow[] = [];
    for (const ticker of state.def.tickers) {
        for (const p of state.def.prompts) {
            const cell = state.cells[cellKey(ticker, p.id)];
            if (!cell?.citations?.length) continue;
            for (const c of cell.citations) {
                out.push({
                    ticker,
                    promptLabel: p.label,
                    citationId: c.id,
                    title: c.title,
                    url: c.url,
                });
            }
        }
    }
    return out;
}
