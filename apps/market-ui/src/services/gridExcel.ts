// Excel export for Research Grid.
// Two sheets:
//   1. "Grid"    — rows = tickers, columns = prompts, cells = answers
//   2. "Sources" — flat citation index (ticker × prompt × [n] → title + url)
//
// Keys cleanly into the existing CSV export (toCSV) — same data, richer formatting.

import ExcelJS from 'exceljs';
import type { GridState } from './gridResearch';
import { buildGridSheetData, buildSourceRows } from './gridExcelData';

export { buildGridSheetData, buildSourceRows } from './gridExcelData';
export type { GridSheetData, GridSourceRow } from './gridExcelData';

// ─── Workbook builder ────────────────────────────────────────────────────────
// Palette follows the Anthropic spreadsheet convention adapted for text-only
// grids: header = brand navy w/ white bold; ticker column = subtle fill to key
// the eye; status markers (running/error/cancelled) get distinct tints so
// failed cells pop when scanning a 50-row grid.

const COLORS = {
    headerBg:   'FF1E3A8A',   // deep indigo
    headerFg:   'FFFFFFFF',
    tickerBg:   'FFF1F5F9',   // slate-100
    errorBg:    'FFFEE2E2',   // red-100
    cancelBg:   'FFFEF3C7',   // amber-100
    runningBg:  'FFE0F2FE',   // sky-100
    sourceHdr:  'FF065F46',   // emerald-800 (distinct from main sheet)
};

export async function exportGridToXLSX(state: GridState): Promise<Blob> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Market UI — Research Grid';
    wb.created = new Date();

    // ── Grid sheet ───────────────────────────────────────────────────────
    const grid = wb.addWorksheet('Grid', {
        views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }],
    });

    const { headers, rows } = buildGridSheetData(state);

    grid.columns = headers.map((h, i) => ({
        header: h,
        key: `col${i}`,
        width: i === 0 ? 12 : 48,
    }));

    // Header styling
    const headerRow = grid.getRow(1);
    headerRow.font = { bold: true, color: { argb: COLORS.headerFg }, size: 11 };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerBg } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    headerRow.height = 28;

    // Data rows
    for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        const excelRow = grid.addRow(row);
        excelRow.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };

        // Ticker column fill
        const tickerCell = excelRow.getCell(1);
        tickerCell.font = { bold: true };
        tickerCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.tickerBg } };

        // Status-aware tints — read per cell
        for (let c = 1; c < row.length; c++) {
            const val = row[c];
            const cell = excelRow.getCell(c + 1);
            if (val.startsWith('(error:')) {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.errorBg } };
            } else if (val === '(cancelled)') {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.cancelBg } };
            } else if (val === '(running)') {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.runningBg } };
            }
        }

        // Row height grows with content — exceljs auto-fits when wrapText is on,
        // but set a generous floor so even short answers stay readable.
        excelRow.height = Math.min(120, Math.max(24, Math.ceil(
            Math.max(...row.slice(1).map(v => v.length)) / 60
        ) * 16));
    }

    // ── Sources sheet ────────────────────────────────────────────────────
    const sources = buildSourceRows(state);
    if (sources.length > 0) {
        const src = wb.addWorksheet('Sources', {
            views: [{ state: 'frozen', ySplit: 1 }],
        });
        src.columns = [
            { header: 'Ticker',   key: 'ticker', width: 10 },
            { header: 'Prompt',   key: 'prompt', width: 24 },
            { header: 'Cite #',   key: 'cid',    width: 8  },
            { header: 'Title',    key: 'title',  width: 50 },
            { header: 'URL',      key: 'url',    width: 60 },
        ];
        const hdr = src.getRow(1);
        hdr.font = { bold: true, color: { argb: COLORS.headerFg } };
        hdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.sourceHdr } };
        hdr.height = 24;

        for (const s of sources) {
            const row = src.addRow({
                ticker: s.ticker,
                prompt: s.promptLabel,
                cid:    s.citationId,
                title:  s.title,
                url:    s.url,
            });
            if (s.url) {
                const urlCell = row.getCell(5);
                urlCell.value = { text: s.url, hyperlink: s.url };
                urlCell.font = { color: { argb: 'FF2563EB' }, underline: true };
            }
        }
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
