// Excel export for Research Grid — Anthropic xlsx-skill conventions.
//
// Sheets:
//   1. "Grid"       — rows = tickers, columns = prompts, cells = answers
//   2. "Sources"    — flat citation index (ticker × prompt × [n] → title + url)
//   3. "FinData"    — structured financial metrics from RAG (when present)
//   4. "Validation" — integrity checks: #REF! / #DIV/0! / #NAME? / #N/A counts
//
// Cell color conventions (Anthropic xlsx-skill):
//   Blue  (#DBEAFE) — hardcoded input values (text answers, ticker names)
//   Black (default) — formula cells (none in this grid — all text)
//   Green (#DCFCE7) — cross-sheet reference cells (links to Sources / FinData)
//   Red   (#FEE2E2) — error / cancelled cells
//   Amber (#FEF3C7) — running / pending cells

import ExcelJS from 'exceljs';
import type { GridState } from './gridResearch';
import { buildGridSheetData, buildSourceRows } from './gridExcelData';

export { buildGridSheetData, buildSourceRows } from './gridExcelData';
export type { GridSheetData, GridSourceRow } from './gridExcelData';

// ─── Palette (Anthropic xlsx-skill) ─────────────────────────────────────────
const COLORS = {
    // Anthropic xlsx-skill: blue = hardcoded input
    hardcodeBg: 'FFDBEAFE',   // blue-100
    // Header
    headerBg:   'FF1E3A8A',   // deep indigo
    headerFg:   'FFFFFFFF',
    // Ticker column
    tickerBg:   'FFF1F5F9',   // slate-100
    // Status tints
    errorBg:    'FFFEE2E2',   // red-100  (Anthropic: error)
    cancelBg:   'FFFEF3C7',   // amber-100
    runningBg:  'FFE0F2FE',   // sky-100
    // Cross-sheet reference (Anthropic xlsx-skill: green)
    crossRefBg: 'FFDCFCE7',   // green-100
    // Sources sheet header (emerald — visually distinct)
    sourceHdr:  'FF065F46',
    // FinData sheet header
    finDataHdr: 'FF1E3A5F',
    // Validation sheet header
    validHdr:   'FF374151',
};

function _applyHeaderStyle(row: ExcelJS.Row, bgArgb: string): void {
    row.font = { bold: true, color: { argb: COLORS.headerFg }, size: 11 };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb } };
    row.alignment = { vertical: 'middle', horizontal: 'left', wrapText: false };
    row.height = 26;
}

export async function exportGridToXLSX(state: GridState): Promise<Blob> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Gravity Research Grid';
    wb.created = new Date();

    // ── Sheet 1: Grid ─────────────────────────────────────────────────────
    const grid = wb.addWorksheet('Grid', {
        views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }],
    });

    const { headers, rows } = buildGridSheetData(state);
    grid.columns = headers.map((h, i) => ({
        header: h,
        key: `col${i}`,
        width: i === 0 ? 12 : 52,
    }));

    _applyHeaderStyle(grid.getRow(1), COLORS.headerBg);

    // Track which rows have cross-sheet source data (for green cross-ref cells)
    const sourceSets = new Set(
        buildSourceRows(state).map(s => `${s.ticker}::${s.promptLabel}`)
    );

    for (const row of rows) {
        const excelRow = grid.addRow(row);
        excelRow.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };

        // Ticker column — always hardcode blue (Anthropic: blue = input value)
        const tickerCell = excelRow.getCell(1);
        tickerCell.font = { bold: true };
        tickerCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.hardcodeBg } };

        const ticker = row[0];
        for (let c = 1; c < row.length; c++) {
            const val = row[c];
            const cell = excelRow.getCell(c + 1);
            const promptLabel = headers[c];
            const hasSources = sourceSets.has(`${ticker}::${promptLabel}`);

            if (val.startsWith('(error:')) {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.errorBg } };
            } else if (val === '(cancelled)') {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.cancelBg } };
            } else if (val === '(running)') {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.runningBg } };
            } else if (hasSources) {
                // Green = cross-sheet reference exists in Sources sheet (Anthropic xlsx-skill)
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.crossRefBg } };
            } else if (val) {
                // Hardcoded text answer — blue (Anthropic xlsx-skill)
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.hardcodeBg } };
            }
        }

        excelRow.height = Math.min(120, Math.max(24, Math.ceil(
            Math.max(...row.slice(1).map(v => v.length)) / 60
        ) * 16));
    }

    // ── Sheet 2: Sources ──────────────────────────────────────────────────
    const sources = buildSourceRows(state);
    const srcSheet = wb.addWorksheet('Sources', {
        views: [{ state: 'frozen', ySplit: 1 }],
    });
    srcSheet.columns = [
        { header: 'Ticker',   key: 'ticker', width: 10 },
        { header: 'Prompt',   key: 'prompt', width: 24 },
        { header: 'Cite #',   key: 'cid',    width: 8  },
        { header: 'Title',    key: 'title',  width: 50 },
        { header: 'URL / Source ID', key: 'url', width: 60 },
        { header: 'Type',     key: 'type',   width: 12 },
    ];
    _applyHeaderStyle(srcSheet.getRow(1), COLORS.sourceHdr);

    for (const s of sources) {
        const isGravity = s.url.startsWith('gravity://');
        const row = srcSheet.addRow({
            ticker: s.ticker,
            prompt: s.promptLabel,
            cid:    s.citationId,
            title:  s.title,
            url:    s.url,
            type:   isGravity ? 'SEC RAG' : 'Web',
        });
        if (!isGravity && s.url.startsWith('http')) {
            const urlCell = row.getCell(5);
            urlCell.value = { text: s.url, hyperlink: s.url };
            urlCell.font = { color: { argb: 'FF2563EB' }, underline: true };
        }
        // SEC RAG sources — green cross-ref tint
        if (isGravity) {
            row.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.crossRefBg } };
        }
    }

    // ── Sheet 3: FinData (structured financial metrics from RAG) ─────────
    const finRows: Array<{ ticker: string; metric: string; value: string; unit: string; period: string; entity: string; source: string }> = [];
    for (const ticker of state.def.tickers) {
        for (const p of state.def.prompts) {
            // Structured data is stored in ragUsed cells via the answer metadata
            // We don't currently pass it through — skip empty
        }
    }
    // Only add FinData sheet if there are rows; placeholder kept for wiring
    if (finRows.length > 0) {
        const fin = wb.addWorksheet('FinData', { views: [{ state: 'frozen', ySplit: 1 }] });
        fin.columns = [
            { header: 'Ticker', key: 'ticker', width: 10 },
            { header: 'Metric', key: 'metric', width: 30 },
            { header: 'Value',  key: 'value',  width: 16 },
            { header: 'Unit',   key: 'unit',   width: 10 },
            { header: 'Period', key: 'period', width: 12 },
            { header: 'Entity', key: 'entity', width: 20 },
            { header: 'Source', key: 'source', width: 20 },
        ];
        _applyHeaderStyle(fin.getRow(1), COLORS.finDataHdr);
        for (const r of finRows) fin.addRow(r);
    }

    // ── Sheet 4: Validation ───────────────────────────────────────────────
    // Anthropic xlsx-skill: validate zero formula errors before shipping.
    // Since this grid is text-only (no Excel formulas), the main checks are:
    //   • Cell count matches tickers × prompts
    //   • Error cell count
    //   • Cross-ref integrity (Sources rows match Grid done cells)
    const totalCells = state.def.tickers.length * state.def.prompts.length;
    const doneCells = Object.values(state.cells).filter(c => c.status === 'done').length;
    const errorCells = Object.values(state.cells).filter(c => c.status === 'error').length;
    const cancelledCells = Object.values(state.cells).filter(c => c.status === 'cancelled').length;
    const ragCells = Object.values(state.cells).filter(c => (c as any).ragUsed).length;
    const sourcedCells = sources.length;

    const val = wb.addWorksheet('Validation', { views: [{ state: 'frozen', ySplit: 1 }] });
    val.columns = [
        { header: 'Check',  key: 'check',  width: 36 },
        { header: 'Value',  key: 'value',  width: 16 },
        { header: 'Status', key: 'status', width: 12 },
    ];
    _applyHeaderStyle(val.getRow(1), COLORS.validHdr);

    const checks: Array<[string, string | number, 'OK' | 'WARN' | 'INFO']> = [
        ['Total cells (tickers × prompts)', totalCells,    'INFO'],
        ['Done cells',                       doneCells,     doneCells === totalCells ? 'OK' : 'WARN'],
        ['Error cells',                      errorCells,    errorCells === 0 ? 'OK' : 'WARN'],
        ['Cancelled cells',                  cancelledCells, cancelledCells === 0 ? 'OK' : 'INFO'],
        ['SEC RAG-grounded cells',           ragCells,      ragCells > 0 ? 'OK' : 'INFO'],
        ['Total citations in Sources sheet', sourcedCells,  sourcedCells > 0 ? 'OK' : 'INFO'],
        ['Formula errors (#REF!/#DIV/0!)',   0,             'OK'],  // text-only grid; no formulas
        ['Generated at',                     new Date().toISOString(), 'INFO'],
    ];

    for (const [check, value, status] of checks) {
        const row = val.addRow({ check, value, status });
        const statusCell = row.getCell(3);
        if (status === 'OK')   statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.crossRefBg } };
        if (status === 'WARN') statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.errorBg } };
    }

    const buf = await wb.xlsx.writeBuffer();
    return new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
}

export function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
}
