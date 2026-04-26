/**
 * FRED (Federal Reserve Economic Data) Service
 * Free API — no key required for basic series. Key unlocks higher rate limits.
 * Docs: https://fred.stlouisfed.org/docs/api/fred/
 *
 * Used by Deep Research Stage 2 to inject macro context into every report:
 *   GDP growth, CPI inflation, Fed Funds Rate, unemployment, 10Y yield,
 *   credit spreads, dollar index — the macro backbone any analyst needs.
 */

const FRED_BASE = 'https://api.stlouisfed.org/fred';
// FRED API key: use a real key in .env (VITE_FRED_API_KEY) for production rate limits.
// The public demo key works but is heavily rate-limited (max ~120 req/min shared).
const FRED_API_KEY = import.meta.env.VITE_FRED_API_KEY || 'abcdefghijklmnopqrstuvwxyz123456';

// ─── Key macro series ────────────────────────────────────────────────────────

export const MACRO_SERIES: Record<string, { id: string; label: string; unit: string }> = {
    gdp:           { id: 'GDP',      label: 'US Real GDP',              unit: 'Billions USD (SAAR)' },
    gdp_growth:    { id: 'A191RL1Q225SBEA', label: 'Real GDP Growth',   unit: '% QoQ SAAR' },
    cpi:           { id: 'CPIAUCSL', label: 'CPI (All Urban)',           unit: 'Index 1982-84=100' },
    cpi_yoy:       { id: 'CPIAUCSL', label: 'CPI YoY Inflation',         unit: '%' },
    core_pce:      { id: 'PCEPILFE', label: 'Core PCE Deflator',         unit: 'Index 2017=100' },
    fed_funds:     { id: 'FEDFUNDS', label: 'Fed Funds Rate',            unit: '%' },
    unemployment:  { id: 'UNRATE',   label: 'Unemployment Rate',         unit: '%' },
    treasury_10y:  { id: 'GS10',     label: '10-Year Treasury Yield',    unit: '%' },
    treasury_2y:   { id: 'GS2',      label: '2-Year Treasury Yield',     unit: '%' },
    treasury_3m:   { id: 'TB3MS',    label: '3-Month T-Bill Rate',       unit: '%' },
    yield_spread:  { id: 'T10Y2Y',   label: '10Y-2Y Yield Spread',       unit: 'bps' },
    credit_spread_hy: { id: 'BAMLH0A0HYM2', label: 'HY Credit Spread',  unit: 'bps' },
    credit_spread_ig: { id: 'BAMLC0A0CM',   label: 'IG Credit Spread',   unit: 'bps' },
    dollar_index:  { id: 'DTWEXBGS', label: 'US Dollar Index (Broad)',   unit: 'Index' },
    vix:           { id: 'VIXCLS',   label: 'VIX Volatility Index',      unit: 'Index' },
    sp500:         { id: 'SP500',    label: 'S&P 500',                   unit: 'Index' },
    industrial_prod: { id: 'INDPRO', label: 'Industrial Production',     unit: 'Index 2017=100' },
    retail_sales:  { id: 'RSAFS',    label: 'Retail & Food Service Sales', unit: 'Millions USD' },
    housing_starts:{ id: 'HOUST',    label: 'Housing Starts',            unit: 'Thousands SAAR' },
    consumer_sentiment: { id: 'UMCSENT', label: 'Consumer Sentiment (UMich)', unit: 'Index 1966=100' },
};

export interface FREDObservation {
    date: string;       // YYYY-MM-DD
    value: number | null;
}

export interface FREDSeries {
    seriesId: string;
    label: string;
    unit: string;
    frequency: string;
    latest: FREDObservation | null;
    observations: FREDObservation[];  // last 8 periods
}

export interface MacroSnapshot {
    asOf: string;
    series: FREDSeries[];
    summary: string;  // LLM-ready formatted text block
    error?: string;
}

// ─── Fetch a single FRED series (last N observations) ───────────────────────

async function fetchSeries(
    seriesId: string,
    limit = 8,
): Promise<FREDObservation[]> {
    const url = new URL(`${FRED_BASE}/series/observations`);
    url.searchParams.set('series_id', seriesId);
    url.searchParams.set('api_key', FRED_API_KEY);
    url.searchParams.set('file_type', 'json');
    url.searchParams.set('sort_order', 'desc');
    url.searchParams.set('limit', String(limit));

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`FRED ${seriesId}: HTTP ${res.status}`);
    const data = await res.json();

    return (data.observations ?? [])
        .filter((o: any) => o.value !== '.' && o.value !== '')
        .map((o: any) => ({
            date: o.date,
            value: parseFloat(o.value),
        }))
        .reverse();  // chronological order
}

// ─── Main export: fetch the macro snapshot used by Deep Research ─────────────

export async function getMacroSnapshot(
    seriesKeys: (keyof typeof MACRO_SERIES)[] = [
        'gdp_growth', 'cpi_yoy', 'fed_funds', 'unemployment',
        'treasury_10y', 'treasury_2y', 'yield_spread',
        'credit_spread_hy', 'dollar_index', 'vix',
    ],
): Promise<MacroSnapshot> {
    const asOf = new Date().toISOString().split('T')[0];

    const results = await Promise.allSettled(
        seriesKeys.map(async (key) => {
            const meta = MACRO_SERIES[key];
            const obs = await fetchSeries(meta.id, 8);
            return {
                seriesId: meta.id,
                label: meta.label,
                unit: meta.unit,
                frequency: '',
                latest: obs.length > 0 ? obs[obs.length - 1] : null,
                observations: obs,
            } as FREDSeries;
        }),
    );

    const series: FREDSeries[] = results
        .filter((r): r is PromiseFulfilledResult<FREDSeries> => r.status === 'fulfilled')
        .map(r => r.value);

    // Build a compact text block for LLM injection
    const lines = series
        .filter(s => s.latest !== null)
        .map(s => {
            const prev = s.observations.length >= 2
                ? s.observations[s.observations.length - 2]
                : null;
            const delta = prev?.value !== null && s.latest?.value !== null
                ? ((s.latest!.value! - prev!.value!) / Math.abs(prev!.value!)) * 100
                : null;
            const deltaStr = delta !== null
                ? ` (${delta >= 0 ? '+' : ''}${delta.toFixed(1)}% MoM)`
                : '';
            return `• ${s.label}: ${s.latest!.value} ${s.unit} as of ${s.latest!.date}${deltaStr}`;
        });

    const summary = lines.length > 0
        ? `MACRO ENVIRONMENT (FRED — Federal Reserve Data, as of ${asOf}):\n${lines.join('\n')}`
        : '';

    return { asOf, series, summary };
}

// ─── Lightweight helper: just the formatted text for prompt injection ────────

export async function getMacroSummaryText(): Promise<string> {
    try {
        const snap = await getMacroSnapshot();
        return snap.summary;
    } catch {
        return '';  // never fail — macro is supplementary, not required
    }
}

// ─── FRED ALFRED vintages (plan §6.7) ──────────────────────────────────────
// Point-in-time observations — what a series LOOKED LIKE on a specific
// vintage date. Critical for backtesting and honest historical analysis,
// since most macro series are revised after initial release.

export async function fetchFREDVintage(
    seriesId: string,
    vintageDate: string,   // YYYY-MM-DD — the date the data was "as-of"
    limit = 12,
): Promise<FREDObservation[]> {
    const url = new URL(`${FRED_BASE}/series/observations`);
    url.searchParams.set('series_id', seriesId);
    url.searchParams.set('api_key', FRED_API_KEY);
    url.searchParams.set('file_type', 'json');
    url.searchParams.set('sort_order', 'desc');
    url.searchParams.set('limit', String(limit));
    // ALFRED vintage params — returns data as it was known on vintageDate.
    url.searchParams.set('realtime_start', vintageDate);
    url.searchParams.set('realtime_end', vintageDate);

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`FRED ALFRED ${seriesId}: HTTP ${res.status}`);
    const data = await res.json();
    return (data.observations ?? [])
        .filter((o: any) => o.value !== '.' && o.value !== '')
        .map((o: any) => ({ date: o.date, value: parseFloat(o.value) }))
        .reverse();
}

// ─── BLS (Bureau of Labor Statistics) — free public API ────────────────────
// v2 API: https://api.bls.gov/publicAPI/v2/timeseries/data/
// CPI, PPI, employment, productivity, wages. 50 queries/day without a key,
// 500/day with a free registration key (BLS_API_KEY env var).

export const BLS_BASE = 'https://api.bls.gov/publicAPI/v2/timeseries/data/';
const BLS_API_KEY = import.meta.env.VITE_BLS_API_KEY || '';

export interface BLSObservation {
    date: string;           // YYYY-MM-01 for monthly series (period is M01-M12)
    value: number | null;
    period: string;         // M01, M02, Q01, …
    periodName: string;
}

export interface BLSSeries {
    seriesId: string;
    observations: BLSObservation[];
    catalog?: {
        seriesTitle?: string;
        survey?: string;
    };
}

// Canonical BLS series ids worth surfacing:
//   CUUR0000SA0       — CPI-U All Items
//   CWUR0000SA0       — CPI-W All Items
//   WPSFD4131         — Final-demand PPI
//   LNS14000000       — Unemployment rate (seasonally adjusted)
//   LNS12000000       — Employment level
//   CES0500000003     — Average hourly earnings, total private
//   PRS85006092       — Labor productivity, nonfarm business
export const BLS_SERIES: Record<string, { id: string; label: string; unit: string }> = {
    cpi_u:         { id: 'CUUR0000SA0',    label: 'CPI-U All Items',              unit: 'Index 1982-84=100' },
    cpi_w:         { id: 'CWUR0000SA0',    label: 'CPI-W All Items',              unit: 'Index 1982-84=100' },
    ppi_fd:        { id: 'WPSFD4131',      label: 'Final-demand PPI',             unit: 'Index' },
    unemp_rate:    { id: 'LNS14000000',    label: 'Unemployment rate (SA)',       unit: '%' },
    employment:    { id: 'LNS12000000',    label: 'Civilian employment level',    unit: 'Thousands' },
    avg_earnings:  { id: 'CES0500000003',  label: 'Avg hourly earnings (private)', unit: '$' },
    productivity:  { id: 'PRS85006092',    label: 'Nonfarm productivity',         unit: '% annual rate' },
};

// Parse a BLS period label into a YYYY-MM-DD we can sort chronologically.
// Monthly periods look like "M01" (Jan) through "M12"; quarterly "Q01"–"Q04";
// annual "A01". We anchor to the first day of that period.
export function blsPeriodToDate(year: string, period: string): string {
    const y = year.padStart(4, '0');
    if (/^M\d{2}$/.test(period)) {
        const month = period.slice(1).padStart(2, '0');
        return `${y}-${month}-01`;
    }
    if (/^Q\d{2}$/.test(period)) {
        const q = parseInt(period.slice(1), 10);
        const month = (q - 1) * 3 + 1;
        return `${y}-${String(month).padStart(2, '0')}-01`;
    }
    return `${y}-01-01`;
}

export async function fetchBLSSeries(
    seriesIds: string[],
    opts: { startYear?: string; endYear?: string } = {},
): Promise<BLSSeries[]> {
    const now = new Date();
    const body: Record<string, unknown> = {
        seriesid: seriesIds,
        startyear: opts.startYear ?? String(now.getFullYear() - 2),
        endyear: opts.endYear ?? String(now.getFullYear()),
        catalog: false,
    };
    if (BLS_API_KEY) body.registrationkey = BLS_API_KEY;

    const res = await fetch(BLS_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`BLS: HTTP ${res.status}`);
    const data = await res.json();
    if (data.status !== 'REQUEST_SUCCEEDED') {
        throw new Error(`BLS: ${data.status} — ${(data.message ?? []).join(' ')}`);
    }

    const out: BLSSeries[] = [];
    for (const s of data.Results?.series ?? []) {
        const observations: BLSObservation[] = (s.data ?? [])
            .map((row: any) => ({
                date: blsPeriodToDate(row.year, row.period),
                value: row.value === '' || row.value == null ? null : parseFloat(row.value),
                period: row.period,
                periodName: row.periodName,
            }))
            .filter((o: BLSObservation) => o.value !== null)
            .sort((a: BLSObservation, b: BLSObservation) => a.date.localeCompare(b.date));
        out.push({ seriesId: s.seriesID, observations });
    }
    return out;
}

// ─── World Bank Open Data — WDI indicators, fully open ─────────────────────

export const WORLD_BANK_BASE = 'https://api.worldbank.org/v2';

export interface WorldBankObservation {
    date: string;     // YYYY-MM-01 (annual series are dated 01-01)
    value: number | null;
    country: string;  // ISO3
    indicator: string;
}

// Commonly useful WDI indicators:
//   NY.GDP.MKTP.CD            — GDP current USD
//   NY.GDP.MKTP.KD.ZG         — GDP growth annual %
//   FP.CPI.TOTL.ZG            — Inflation CPI annual %
//   SL.UEM.TOTL.ZS            — Unemployment %
//   GC.DOD.TOTL.GD.ZS         — Central gov debt % of GDP
export const WDI_INDICATORS: Record<string, { id: string; label: string; unit: string }> = {
    gdp_usd:      { id: 'NY.GDP.MKTP.CD',      label: 'GDP (current USD)',       unit: 'USD' },
    gdp_growth:   { id: 'NY.GDP.MKTP.KD.ZG',   label: 'Real GDP growth',         unit: '% YoY' },
    cpi_yoy:      { id: 'FP.CPI.TOTL.ZG',      label: 'CPI inflation',           unit: '% YoY' },
    unemployment: { id: 'SL.UEM.TOTL.ZS',      label: 'Unemployment rate',       unit: '%' },
    govt_debt:    { id: 'GC.DOD.TOTL.GD.ZS',   label: 'Central govt debt',       unit: '% of GDP' },
};

export async function fetchWorldBankIndicator(
    country: string,     // ISO3 or "all" for cross-country
    indicator: string,
    opts: { startYear?: number; endYear?: number; perPage?: number } = {},
): Promise<WorldBankObservation[]> {
    const now = new Date().getFullYear();
    const date = `${opts.startYear ?? now - 10}:${opts.endYear ?? now}`;
    const url = new URL(`${WORLD_BANK_BASE}/country/${country}/indicator/${indicator}`);
    url.searchParams.set('format', 'json');
    url.searchParams.set('date', date);
    url.searchParams.set('per_page', String(opts.perPage ?? 60));

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`World Bank ${indicator}: HTTP ${res.status}`);
    const data = await res.json();
    // WB API returns [metadata, rows[]]
    const rows = Array.isArray(data) && data.length >= 2 ? data[1] : [];
    return (rows || [])
        .filter((r: any) => r && r.value !== null)
        .map((r: any) => ({
            date: `${r.date}-01-01`,
            value: typeof r.value === 'number' ? r.value : parseFloat(r.value),
            country: r.countryiso3code || r.country?.id || '',
            indicator: r.indicator?.id || indicator,
        }))
        .sort((a: WorldBankObservation, b: WorldBankObservation) => a.date.localeCompare(b.date));
}

// ─── ECB Statistical Data Warehouse — no key, no SDMX wrangling ────────────
// Uses the CSV-data endpoint to avoid SDMX-XML parsing. Dataflows worth
// surfacing for a G10 research desk:
//   EXR/M.USD.EUR.SP00.A   — EUR/USD monthly avg
//   FM/D.U2.EUR.MMSR.SRT.ALL.TTR.VOL   — €STR proxy; daily
//   ICP/M.U2.N.000000.4.ANR            — HICP headline inflation YoY
//   MIR/M.U2.B.A2A.A.R.A.2240.EUR.N    — bank lending rate
//
// We take the simplest path: `?format=csvdata&lastNObservations=N`. CSV
// columns are fixed by ECB so we can parse without a full SDMX codec.

export const ECB_BASE = 'https://data-api.ecb.europa.eu/service/data';

export interface ECBObservation {
    date: string;    // YYYY-MM-01 or YYYY-QN → anchored to first day
    value: number | null;
}

export const ECB_KEYS: Record<string, { key: string; label: string; unit: string }> = {
    eurusd:       { key: 'EXR/M.USD.EUR.SP00.A', label: 'EUR/USD (monthly avg)', unit: 'rate' },
    hicp_yoy:     { key: 'ICP/M.U2.N.000000.4.ANR', label: 'Euro-area HICP YoY', unit: '%' },
    // MRO = Main Refinancing Operations rate; key may evolve, kept as example.
    mro_rate:     { key: 'FM/D.U2.EUR.4F.KR.MRR_FR.LEV', label: 'ECB MRO rate', unit: '%' },
};

// Parse a 2-line-plus CSV from ECB (`TIME_PERIOD,OBS_VALUE` columns included
// in every response). Return chronologically-ordered observations.
export function parseECBCsv(csv: string): ECBObservation[] {
    const lines = csv.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    const header = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
    const periodIdx = header.indexOf('TIME_PERIOD');
    const valueIdx = header.indexOf('OBS_VALUE');
    if (periodIdx < 0 || valueIdx < 0) return [];
    const out: ECBObservation[] = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map(c => c.replace(/"/g, '').trim());
        const p = cols[periodIdx];
        const v = cols[valueIdx];
        if (!p || v === undefined || v === '') continue;
        let date = `${p}-01-01`;
        if (/^\d{4}-\d{2}$/.test(p)) date = `${p}-01`;
        else if (/^\d{4}-Q[1-4]$/.test(p)) {
            const [y, q] = p.split('-Q');
            const month = (parseInt(q, 10) - 1) * 3 + 1;
            date = `${y}-${String(month).padStart(2, '0')}-01`;
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(p)) date = p;
        const num = parseFloat(v);
        if (Number.isFinite(num)) out.push({ date, value: num });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
}

export async function fetchECBSeries(
    key: string,
    lastN = 12,
): Promise<ECBObservation[]> {
    const url = `${ECB_BASE}/${key}?format=csvdata&lastNObservations=${lastN}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ECB ${key}: HTTP ${res.status}`);
    const csv = await res.text();
    return parseECBCsv(csv);
}

// ─── BEA (Bureau of Economic Analysis) — NIPA / GDP / Regional ─────────────
// API: https://apps.bea.gov/api/data/?UserID={KEY}&method=GetData&datasetname=NIPA&...
// Free key via https://apps.bea.gov/API/signup/ (instant). Without a key
// every call fails — set VITE_BEA_API_KEY before relying on this client.
//
// We expose NIPA (the 'big-N' table family — GDP, personal income, PCE)
// because that's what most equity research touches. Regional (state-level
// GDP), ITA (trade), and FixedAssets are intentionally out of scope for
// this commit; they're identical request shape if a caller needs them.

export const BEA_BASE = 'https://apps.bea.gov/api/data/';
const BEA_API_KEY = import.meta.env.VITE_BEA_API_KEY || '';

export interface BEAObservation {
    date: string;            // YYYY-MM-01 anchored to first day of period
    period: string;          // raw TimePeriod from BEA (e.g. "2026Q1" or "2026M03")
    lineNumber: string;
    lineDescription: string;
    value: number | null;
    unit: string;            // CL_UNIT (e.g. "Level", "Percent")
    unitMult: number;        // 10^N multiplier; raw number is value × 10^unitMult
}

// Common NIPA tables worth pinning:
//   T10101 — GDP, billions of current $    (quarterly)
//   T10103 — Real GDP, chained 2017 $     (quarterly)
//   T10105 — GDP price indexes             (quarterly)
//   T20100 — Personal income & outlays     (monthly)
//   T20805 — PCE price indexes             (monthly)
export const BEA_NIPA_TABLES: Record<string, { id: string; label: string; freq: 'Q' | 'M' | 'A' }> = {
    gdp_nominal:  { id: 'T10101', label: 'GDP (current dollars)',                  freq: 'Q' },
    gdp_real:     { id: 'T10103', label: 'Real GDP (chained 2017 dollars)',        freq: 'Q' },
    gdp_pi:       { id: 'T10105', label: 'GDP price indexes',                       freq: 'Q' },
    personal_inc: { id: 'T20100', label: 'Personal income and outlays',             freq: 'M' },
    pce_pi:       { id: 'T20805', label: 'PCE price indexes (incl. core PCE)',      freq: 'M' },
};

// BEA TimePeriod parser. "2026Q1" → 2026-01-01, "2026M03" → 2026-03-01,
// "2026" → 2026-01-01. Returns null when the format isn't recognized.
export function parseBEAPeriod(period: string): string | null {
    if (!period) return null;
    let m = period.match(/^(\d{4})Q([1-4])$/);
    if (m) {
        const month = (parseInt(m[2], 10) - 1) * 3 + 1;
        return `${m[1]}-${String(month).padStart(2, '0')}-01`;
    }
    m = period.match(/^(\d{4})M(\d{2})$/);
    if (m) {
        const mn = parseInt(m[2], 10);
        if (mn < 1 || mn > 12) return null;
        return `${m[1]}-${String(mn).padStart(2, '0')}-01`;
    }
    if (/^\d{4}$/.test(period)) return `${period}-01-01`;
    return null;
}

// Defensive parser for BEA's slightly unhinged comma-separated number
// format ("1,234.5") and occasional special markers ("(D)" = withheld).
export function parseBEAValue(raw: string | number | null | undefined): number | null {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
    const cleaned = String(raw).replace(/,/g, '').trim();
    if (!cleaned || cleaned === '(D)' || cleaned === '(NA)' || cleaned === '...') return null;
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : null;
}

export interface FetchBEAOptions {
    table: string;          // e.g. "T10101"
    frequency: 'Q' | 'M' | 'A';
    years?: string;         // "2024,2025,2026" or "ALL"
    apiKey?: string;        // override for testing
}

export async function fetchBEANIPATable(opts: FetchBEAOptions): Promise<BEAObservation[]> {
    const apiKey = opts.apiKey ?? BEA_API_KEY;
    if (!apiKey) {
        throw new Error('BEA: no API key set (VITE_BEA_API_KEY required)');
    }
    const url = new URL(BEA_BASE);
    url.searchParams.set('UserID', apiKey);
    url.searchParams.set('method', 'GetData');
    url.searchParams.set('datasetname', 'NIPA');
    url.searchParams.set('TableName', opts.table);
    url.searchParams.set('Frequency', opts.frequency);
    url.searchParams.set('Year', opts.years ?? 'ALL');
    url.searchParams.set('ResultFormat', 'JSON');

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`BEA ${opts.table}: HTTP ${res.status}`);
    const json = await res.json();
    return parseBEAResponse(json);
}

// Parse a BEA JSON response → BEAObservation[]. Defensive: any of the
// shape mismatches BEA serves up (Error block, missing Data array,
// unexpected null fields) yields an empty list rather than a throw.
export function parseBEAResponse(json: unknown): BEAObservation[] {
    if (!json || typeof json !== 'object') return [];
    const root = (json as any).BEAAPI;
    if (!root) return [];
    if (root.Error) return [];
    const rows = root.Results?.Data;
    if (!Array.isArray(rows)) return [];
    const out: BEAObservation[] = [];
    for (const r of rows as any[]) {
        const period = String(r.TimePeriod ?? '');
        const date = parseBEAPeriod(period);
        if (!date) continue;
        out.push({
            date,
            period,
            lineNumber: String(r.LineNumber ?? ''),
            lineDescription: String(r.LineDescription ?? ''),
            value: parseBEAValue(r.DataValue),
            unit: String(r.CL_UNIT ?? ''),
            unitMult: typeof r.UNIT_MULT === 'number' ? r.UNIT_MULT
                : parseInt(String(r.UNIT_MULT ?? '0'), 10) || 0,
        });
    }
    out.sort((a, b) => a.date.localeCompare(b.date));
    return out;
}

// ─── Unified cross-provider snapshot ────────────────────────────────────────
// Returns a single prompt-ready text block covering FRED + BLS + WB + ECB.
// Any provider failure is silent — macro is supplementary, never required.

export async function getUnifiedMacroSummaryText(opts: {
    country?: string;     // ISO3 for World Bank; default USA
} = {}): Promise<string> {
    const country = opts.country ?? 'USA';
    const [fred, bls, wb, ecb] = await Promise.allSettled([
        getMacroSummaryText(),
        fetchBLSSeries([BLS_SERIES.cpi_u.id, BLS_SERIES.unemp_rate.id, BLS_SERIES.avg_earnings.id])
            .then(seriesArr => {
                if (!seriesArr.length) return '';
                const lines = seriesArr.map(s => {
                    const latest = s.observations[s.observations.length - 1];
                    const meta = Object.values(BLS_SERIES).find(m => m.id === s.seriesId);
                    const label = meta?.label ?? s.seriesId;
                    const unit = meta?.unit ?? '';
                    return latest ? `• ${label}: ${latest.value} ${unit} as of ${latest.date}` : '';
                }).filter(Boolean);
                return lines.length ? `BLS (Bureau of Labor Statistics):\n${lines.join('\n')}` : '';
            }),
        Promise.all([
            fetchWorldBankIndicator(country, WDI_INDICATORS.gdp_growth.id).catch(() => []),
            fetchWorldBankIndicator(country, WDI_INDICATORS.cpi_yoy.id).catch(() => []),
        ]).then(([gdp, cpi]) => {
            const g = gdp[gdp.length - 1];
            const c = cpi[cpi.length - 1];
            const parts: string[] = [];
            if (g) parts.push(`• GDP growth ${country}: ${g.value?.toFixed(2)}% YoY (${g.date.slice(0, 4)})`);
            if (c) parts.push(`• CPI inflation ${country}: ${c.value?.toFixed(2)}% YoY (${c.date.slice(0, 4)})`);
            return parts.length ? `World Bank WDI:\n${parts.join('\n')}` : '';
        }),
        fetchECBSeries(ECB_KEYS.eurusd.key, 4).then(obs => {
            const latest = obs[obs.length - 1];
            return latest ? `ECB:\n• EUR/USD: ${latest.value} as of ${latest.date}` : '';
        }),
    ]);

    const blocks = [fred, bls, wb, ecb]
        .map(r => r.status === 'fulfilled' ? r.value : '')
        .filter(s => typeof s === 'string' && s.trim().length > 0);
    return blocks.join('\n\n');
}
