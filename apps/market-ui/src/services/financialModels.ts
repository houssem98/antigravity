// Financial-Modeling Automation — plan §7 Phase 2
//
// "Excel export via openpyxl + Anthropic xlsx-skill conventions; DCF, Comps,
//  LBO templates; cell-anchored citations in notes."
//
// Build three institutional Excel templates on top of the exceljs runtime
// that market-ui already ships. Each generator returns an ExcelJS.Workbook
// with formulas wired, named ranges set, and input cells highlighted so the
// analyst knows which cells to type into.
//
// Design notes:
//   - Templates are SKELETONS, not auto-populated. Populating DCF/Comps/LBO
//     inputs from the research report would require structured financial-
//     data ingestion (Visible Alpha / Polygon / Daloopa) — Phase 2+ work.
//     Shipping the template now unblocks analysts who want the structure.
//   - Every template honors the same sheet convention:
//       Summary    — top-level outputs (per-share value, IRR, multiples)
//       Inputs     — highlighted input cells (yellow fill)
//       Model      — the full model grid with formulas
//       Notes      — cell-anchored analyst commentary, suitable for citations
//   - Tests verify structure (sheet names, cell refs, key formulas) without
//     actually rendering the xlsx bytes — the ExcelJS.Workbook is the
//     assertion target.

import ExcelJS from 'exceljs';

// ─── Shared styling ───────────────────────────────────────────────────────
const INPUT_FILL: ExcelJS.FillPattern = {
    type: 'pattern', pattern: 'solid',
    fgColor: { argb: 'FFFFEB3B' },   // soft yellow — analyst types here
};
const CALC_FILL: ExcelJS.FillPattern = {
    type: 'pattern', pattern: 'solid',
    fgColor: { argb: 'FFF5F5F5' },   // neutral gray — read-only formula cells
};
const HEADER_FILL: ExcelJS.FillPattern = {
    type: 'pattern', pattern: 'solid',
    fgColor: { argb: 'FF1F2937' },   // dark — header rows
};
const HEADER_FONT: Partial<ExcelJS.Font> = { color: { argb: 'FFFFFFFF' }, bold: true };

function styleHeaderRow(row: ExcelJS.Row) {
    row.eachCell(c => { c.fill = HEADER_FILL; c.font = HEADER_FONT; });
}

function styleInputCell(cell: ExcelJS.Cell) {
    cell.fill = INPUT_FILL;
    cell.font = { bold: true };
}

function styleCalcCell(cell: ExcelJS.Cell) {
    cell.fill = CALC_FILL;
    cell.font = { italic: true };
}

// ─── DCF Template ─────────────────────────────────────────────────────────
// 5-year explicit projection + terminal value (Gordon growth OR exit multiple).
// Inputs: initial revenue, growth %, operating margin %, tax, capex %, WACC,
// terminal growth. Outputs: unlevered FCF → PV sum → EV → equity value.

export interface DCFTemplateOptions {
    companyName?: string;
    ticker?: string;
    currency?: string;                // default 'USD'
    projectionYears?: number;         // default 5
    basePrice?: number;               // current stock price for implied-return calc
    sharesOutstanding?: number;       // for per-share value
}

export function buildDCFWorkbook(opts: DCFTemplateOptions = {}): ExcelJS.Workbook {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'market-ui deep-research';
    wb.created = new Date();

    const years = opts.projectionYears ?? 5;
    const company = opts.companyName || opts.ticker || 'Target';
    const currency = opts.currency || 'USD';

    // ── Inputs sheet ──────────────────────────────────────────────────
    const inputs = wb.addWorksheet('Inputs');
    inputs.columns = [
        { header: 'Input', key: 'label', width: 36 },
        { header: 'Value', key: 'value', width: 18 },
        { header: 'Unit', key: 'unit', width: 14 },
    ];
    styleHeaderRow(inputs.getRow(1));

    const addInput = (label: string, value: number | string, unit: string, key: string) => {
        const row = inputs.addRow({ label, value, unit });
        row.getCell('value').name = key;
        styleInputCell(row.getCell('value'));
    };

    addInput('Base-year revenue', 100_000, `${currency} mn`, 'BaseRevenue');
    addInput('Revenue growth (Y1)', 0.10, '%', 'Growth1');
    addInput('Revenue growth (Y2)', 0.08, '%', 'Growth2');
    addInput('Revenue growth (Y3)', 0.06, '%', 'Growth3');
    addInput('Revenue growth (Y4)', 0.05, '%', 'Growth4');
    addInput('Revenue growth (Y5)', 0.04, '%', 'Growth5');
    addInput('Operating margin (steady state)', 0.20, '%', 'OpMargin');
    addInput('Tax rate', 0.21, '%', 'TaxRate');
    addInput('Capex % of revenue', 0.05, '%', 'CapexPct');
    addInput('D&A % of revenue', 0.04, '%', 'DAPct');
    addInput('Change in working capital % of revenue', 0.02, '%', 'WCPct');
    addInput('WACC', 0.09, '%', 'WACC');
    addInput('Terminal growth rate', 0.025, '%', 'TerminalGrowth');
    addInput('Net debt', 5_000, `${currency} mn`, 'NetDebt');
    addInput('Shares outstanding', opts.sharesOutstanding ?? 1_000, 'mn shares', 'Shares');

    // ── Model sheet ───────────────────────────────────────────────────
    const model = wb.addWorksheet('Model');
    // Column A = labels; B..F = Y1..Y5
    const yearHeaders = ['Line item'];
    for (let i = 1; i <= years; i++) yearHeaders.push(`Year ${i}`);
    model.addRow(yearHeaders);
    styleHeaderRow(model.getRow(1));

    // Revenue row: Y1 = BaseRevenue * (1 + Growth1), Y2 = Y1 * (1 + Growth2), ...
    const revRow = model.addRow(['Revenue']);
    for (let i = 0; i < years; i++) {
        const col = String.fromCharCode('B'.charCodeAt(0) + i);
        const prev = i === 0 ? 'BaseRevenue' : `${String.fromCharCode('B'.charCodeAt(0) + i - 1)}2`;
        const growthRef = `Growth${i + 1}`;
        const cell = model.getCell(`${col}2`);
        cell.value = { formula: `${prev}*(1+${growthRef})`, result: 0 };
        styleCalcCell(cell);
    }

    // Operating income
    model.addRow(['Operating income']);
    for (let i = 0; i < years; i++) {
        const col = String.fromCharCode('B'.charCodeAt(0) + i);
        const cell = model.getCell(`${col}3`);
        cell.value = { formula: `${col}2*OpMargin`, result: 0 };
        styleCalcCell(cell);
    }

    // NOPAT
    model.addRow(['NOPAT']);
    for (let i = 0; i < years; i++) {
        const col = String.fromCharCode('B'.charCodeAt(0) + i);
        const cell = model.getCell(`${col}4`);
        cell.value = { formula: `${col}3*(1-TaxRate)`, result: 0 };
        styleCalcCell(cell);
    }

    // D&A
    model.addRow(['+ D&A']);
    for (let i = 0; i < years; i++) {
        const col = String.fromCharCode('B'.charCodeAt(0) + i);
        const cell = model.getCell(`${col}5`);
        cell.value = { formula: `${col}2*DAPct`, result: 0 };
        styleCalcCell(cell);
    }

    // Capex
    model.addRow(['− Capex']);
    for (let i = 0; i < years; i++) {
        const col = String.fromCharCode('B'.charCodeAt(0) + i);
        const cell = model.getCell(`${col}6`);
        cell.value = { formula: `-${col}2*CapexPct`, result: 0 };
        styleCalcCell(cell);
    }

    // ΔWC
    model.addRow(['− ΔWorking capital']);
    for (let i = 0; i < years; i++) {
        const col = String.fromCharCode('B'.charCodeAt(0) + i);
        const cell = model.getCell(`${col}7`);
        cell.value = { formula: `-${col}2*WCPct`, result: 0 };
        styleCalcCell(cell);
    }

    // Unlevered FCF
    model.addRow(['Unlevered FCF']);
    for (let i = 0; i < years; i++) {
        const col = String.fromCharCode('B'.charCodeAt(0) + i);
        const cell = model.getCell(`${col}8`);
        cell.value = { formula: `${col}4+${col}5+${col}6+${col}7`, result: 0 };
        styleCalcCell(cell);
        cell.font = { ...(cell.font ?? {}), bold: true };
    }

    // Discount factor
    model.addRow(['Discount factor']);
    for (let i = 0; i < years; i++) {
        const col = String.fromCharCode('B'.charCodeAt(0) + i);
        const cell = model.getCell(`${col}9`);
        cell.value = { formula: `1/((1+WACC)^${i + 1})`, result: 0 };
        styleCalcCell(cell);
    }

    // PV of FCF
    model.addRow(['PV of FCF']);
    for (let i = 0; i < years; i++) {
        const col = String.fromCharCode('B'.charCodeAt(0) + i);
        const cell = model.getCell(`${col}10`);
        cell.value = { formula: `${col}8*${col}9`, result: 0 };
        styleCalcCell(cell);
    }

    // ── Summary sheet ─────────────────────────────────────────────────
    const summary = wb.addWorksheet('Summary');
    summary.columns = [
        { header: `${company} DCF Summary`, key: 'label', width: 36 },
        { header: 'Value', key: 'value', width: 18 },
    ];
    styleHeaderRow(summary.getRow(1));
    const lastCol = String.fromCharCode('B'.charCodeAt(0) + years - 1);
    summary.addRow({ label: 'Sum of PV(FCF)', value: { formula: `SUM(Model!B10:${lastCol}10)`, result: 0 } });
    summary.addRow({ label: 'Terminal value (Gordon growth)',
        value: { formula: `Model!${lastCol}8*(1+TerminalGrowth)/(WACC-TerminalGrowth)`, result: 0 } });
    summary.addRow({ label: 'PV of terminal value',
        value: { formula: `B3*Model!${lastCol}9`, result: 0 } });
    summary.addRow({ label: 'Enterprise value', value: { formula: `B2+B4`, result: 0 } });
    summary.addRow({ label: '− Net debt', value: { formula: `-NetDebt`, result: 0 } });
    summary.addRow({ label: 'Equity value', value: { formula: `B5+B6`, result: 0 } });
    summary.addRow({ label: 'Per-share value', value: { formula: `B7/Shares`, result: 0 } });
    if (opts.basePrice) {
        summary.addRow({ label: 'Current stock price', value: opts.basePrice });
        summary.addRow({ label: 'Implied return', value: { formula: `B8/B9-1`, result: 0 } });
    }
    for (let r = 2; r <= summary.rowCount; r++) {
        styleCalcCell(summary.getCell(`B${r}`));
    }
    summary.getCell('B7').font = { bold: true };
    summary.getCell('B8').font = { bold: true };

    // ── Notes sheet — cell-anchored analyst commentary ────────────────
    const notes = wb.addWorksheet('Notes');
    notes.columns = [
        { header: 'Cell', key: 'cell', width: 20 },
        { header: 'Note', key: 'note', width: 80 },
        { header: 'Citation', key: 'citation', width: 40 },
    ];
    styleHeaderRow(notes.getRow(1));
    notes.addRow({ cell: 'Inputs!B1 (BaseRevenue)', note: 'TTM or last-FY revenue', citation: '' });
    notes.addRow({ cell: 'Inputs!B7 (OpMargin)', note: 'Steady-state operating margin assumption', citation: '' });
    notes.addRow({ cell: 'Inputs!B12 (WACC)', note: 'Blended cost of capital; default 9%', citation: '' });
    notes.addRow({ cell: 'Inputs!B13 (TerminalGrowth)', note: 'Perpetual growth ≤ long-run nominal GDP', citation: '' });
    notes.addRow({ cell: 'Summary!B8', note: 'Intrinsic per-share value', citation: '' });

    return wb;
}

// ─── Comps Template ───────────────────────────────────────────────────────
// Peer comparison grid: 5 rows for peer companies, calculated EV/EBITDA,
// EV/Sales, P/E; mean / median / target rows at the bottom.

export interface CompsTemplateOptions {
    companyName?: string;
    ticker?: string;
    peers?: string[];          // up to 6 tickers; defaults to 5 empty rows
}

export function buildCompsWorkbook(opts: CompsTemplateOptions = {}): ExcelJS.Workbook {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'market-ui deep-research';
    wb.created = new Date();

    const peers = (opts.peers && opts.peers.length > 0) ? opts.peers.slice(0, 6) : ['', '', '', '', ''];
    const target = opts.ticker || opts.companyName || 'TARGET';

    const sheet = wb.addWorksheet('Comps');
    sheet.columns = [
        { header: 'Ticker', key: 'ticker', width: 14 },
        { header: 'Price', key: 'price', width: 12 },
        { header: 'Shares (mn)', key: 'shares', width: 14 },
        { header: 'Market cap', key: 'mcap', width: 16 },
        { header: 'Net debt', key: 'netDebt', width: 14 },
        { header: 'EV', key: 'ev', width: 14 },
        { header: 'Revenue', key: 'revenue', width: 14 },
        { header: 'EBITDA', key: 'ebitda', width: 14 },
        { header: 'EPS', key: 'eps', width: 10 },
        { header: 'EV / Sales', key: 'evSales', width: 12 },
        { header: 'EV / EBITDA', key: 'evEbitda', width: 12 },
        { header: 'P / E', key: 'pe', width: 12 },
    ];
    styleHeaderRow(sheet.getRow(1));

    // Target + peer rows
    const allTickers = [target, ...peers];
    for (let i = 0; i < allTickers.length; i++) {
        const rowIdx = i + 2;
        const r = sheet.addRow({ ticker: allTickers[i] });
        // Highlight the input columns (B–I = price, shares, debt, revenue, ebitda, eps)
        styleInputCell(r.getCell('price'));
        styleInputCell(r.getCell('shares'));
        styleInputCell(r.getCell('netDebt'));
        styleInputCell(r.getCell('revenue'));
        styleInputCell(r.getCell('ebitda'));
        styleInputCell(r.getCell('eps'));
        // Calculated: market cap, EV, multiples
        r.getCell('mcap').value = { formula: `B${rowIdx}*C${rowIdx}`, result: 0 };
        r.getCell('ev').value = { formula: `D${rowIdx}+E${rowIdx}`, result: 0 };
        r.getCell('evSales').value = { formula: `IFERROR(F${rowIdx}/G${rowIdx},"")`, result: 0 };
        r.getCell('evEbitda').value = { formula: `IFERROR(F${rowIdx}/H${rowIdx},"")`, result: 0 };
        r.getCell('pe').value = { formula: `IFERROR(B${rowIdx}/I${rowIdx},"")`, result: 0 };
        styleCalcCell(r.getCell('mcap'));
        styleCalcCell(r.getCell('ev'));
        styleCalcCell(r.getCell('evSales'));
        styleCalcCell(r.getCell('evEbitda'));
        styleCalcCell(r.getCell('pe'));
    }

    // Aggregates over peer rows (rows 3..N, skipping the target row at 2)
    const firstPeer = 3;
    const lastPeer = 2 + peers.length;
    const meanRow = sheet.addRow({
        ticker: 'Mean (peers)',
        evSales: { formula: `AVERAGE(J${firstPeer}:J${lastPeer})` },
        evEbitda: { formula: `AVERAGE(K${firstPeer}:K${lastPeer})` },
        pe: { formula: `AVERAGE(L${firstPeer}:L${lastPeer})` },
    });
    const medianRow = sheet.addRow({
        ticker: 'Median (peers)',
        evSales: { formula: `MEDIAN(J${firstPeer}:J${lastPeer})` },
        evEbitda: { formula: `MEDIAN(K${firstPeer}:K${lastPeer})` },
        pe: { formula: `MEDIAN(L${firstPeer}:L${lastPeer})` },
    });
    meanRow.eachCell(c => { c.font = { bold: true }; });
    medianRow.eachCell(c => { c.font = { bold: true }; });

    // Implied valuation for the target using peer median
    const implied = wb.addWorksheet('Implied');
    implied.columns = [
        { header: 'Metric', key: 'metric', width: 28 },
        { header: 'Target value', key: 'tVal', width: 18 },
        { header: 'Peer median', key: 'pMed', width: 18 },
        { header: 'Implied EV', key: 'impliedEv', width: 18 },
    ];
    styleHeaderRow(implied.getRow(1));
    // EV/Sales implied EV
    const rEvS = implied.addRow({
        metric: 'EV / Sales',
        tVal: { formula: `Comps!G2` },
        pMed: { formula: `Comps!J${lastPeer + 2}` },
        impliedEv: { formula: `B2*C2` },
    });
    const rEvEb = implied.addRow({
        metric: 'EV / EBITDA',
        tVal: { formula: `Comps!H2` },
        pMed: { formula: `Comps!K${lastPeer + 2}` },
        impliedEv: { formula: `B3*C3` },
    });
    const rPE = implied.addRow({
        metric: 'P / E (implied price)',
        tVal: { formula: `Comps!I2` },
        pMed: { formula: `Comps!L${lastPeer + 2}` },
        impliedEv: { formula: `B4*C4` },
    });
    [rEvS, rEvEb, rPE].forEach(r => {
        styleCalcCell(r.getCell('tVal'));
        styleCalcCell(r.getCell('pMed'));
        styleCalcCell(r.getCell('impliedEv'));
    });

    return wb;
}

// ─── LBO Template ─────────────────────────────────────────────────────────
// Simplified LBO returns calc: entry multiple × TTM EBITDA → purchase price;
// debt structure fractions; exit multiple × exit-year EBITDA → exit equity;
// IRR + MoIC over hold period.

export interface LBOTemplateOptions {
    companyName?: string;
    ticker?: string;
    holdYears?: number;        // default 5
}

export function buildLBOWorkbook(opts: LBOTemplateOptions = {}): ExcelJS.Workbook {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'market-ui deep-research';
    wb.created = new Date();

    const hold = opts.holdYears ?? 5;

    // ── Inputs sheet ──────────────────────────────────────────────────
    const inputs = wb.addWorksheet('Inputs');
    inputs.columns = [
        { header: 'Input', key: 'label', width: 40 },
        { header: 'Value', key: 'value', width: 18 },
        { header: 'Unit', key: 'unit', width: 12 },
    ];
    styleHeaderRow(inputs.getRow(1));
    const addInp = (label: string, value: number, unit: string, key: string) => {
        const row = inputs.addRow({ label, value, unit });
        row.getCell('value').name = key;
        styleInputCell(row.getCell('value'));
    };
    addInp('TTM EBITDA', 100, 'USD mn', 'EBITDA0');
    addInp('Entry multiple (x EBITDA)', 10, 'x', 'EntryMult');
    addInp('Exit multiple (x EBITDA)', 10, 'x', 'ExitMult');
    addInp('EBITDA growth (CAGR)', 0.08, '%', 'EBITDAGrowth');
    addInp('Total debt at close', 600, 'USD mn', 'InitialDebt');
    addInp('Debt paydown (Y1-Y5 total)', 300, 'USD mn', 'DebtPaydown');
    addInp('Hold period (years)', hold, 'years', 'HoldYears');

    // ── Returns sheet ─────────────────────────────────────────────────
    const returns = wb.addWorksheet('Returns');
    returns.columns = [
        { header: 'Line item', key: 'label', width: 36 },
        { header: 'Value', key: 'value', width: 18 },
    ];
    styleHeaderRow(returns.getRow(1));
    returns.addRow({ label: 'Purchase price (EV)',
        value: { formula: 'EBITDA0*EntryMult' } });
    returns.addRow({ label: '− Debt financing',
        value: { formula: '-InitialDebt' } });
    returns.addRow({ label: 'Sponsor equity check',
        value: { formula: 'B2+B3' } });
    returns.addRow({ label: `Exit-year EBITDA (Y${hold})`,
        value: { formula: `EBITDA0*((1+EBITDAGrowth)^HoldYears)` } });
    returns.addRow({ label: 'Exit enterprise value',
        value: { formula: 'B5*ExitMult' } });
    returns.addRow({ label: '− Exit-year debt',
        value: { formula: '-(InitialDebt-DebtPaydown)' } });
    returns.addRow({ label: 'Exit equity value',
        value: { formula: 'B6+B7' } });
    returns.addRow({ label: 'MoIC (multiple on invested capital)',
        value: { formula: 'B8/B4' } });
    returns.addRow({ label: 'IRR (approximate)',
        value: { formula: '(B8/B4)^(1/HoldYears)-1' } });
    for (let r = 2; r <= returns.rowCount; r++) {
        styleCalcCell(returns.getCell(`B${r}`));
    }
    returns.getCell('B9').font = { bold: true };
    returns.getCell('B10').font = { bold: true };

    return wb;
}

// ─── Download helper (UI integration) ─────────────────────────────────────
export async function downloadWorkbook(wb: ExcelJS.Workbook, filename: string): Promise<void> {
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
