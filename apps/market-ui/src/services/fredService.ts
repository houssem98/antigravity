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
const FRED_API_KEY = import.meta.env.VITE_FRED_API_KEY || 'abcdefghijklmnopqrstuvwxyz123456'; // public demo key

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
