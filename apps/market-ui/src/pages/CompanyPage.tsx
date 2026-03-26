// Company Profile Page — AlphaSense-style company intelligence hub
// Combines Alpha Vantage market data + Gravity's indexed filings + structured financials

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    ArrowLeft, TrendingUp, TrendingDown, FileText,
    Zap, ExternalLink, BarChart3, Building2, RefreshCw, Activity,
} from 'lucide-react';
import {
    BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, Cell,
} from 'recharts';
import { apiGetOverview, apiGetQuote } from '../services/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MarketOverview {
    Symbol: string;
    Name: string;
    Sector: string;
    Industry: string;
    Description: string;
    MarketCapitalization: string;
    PERatio: string;
    EPS: string;
    DividendYield: string;
    '52WeekHigh': string;
    '52WeekLow': string;
    AnalystTargetPrice: string;
    ReturnOnEquityTTM: string;
    ProfitMargin: string;
    RevenueGrowthYOY: string;
    OperatingMarginTTM: string;
    GrossProfitTTM: string;
    RevenueTTM: string;
    EBITDA: string;
}

interface Quote {
    '05. price': string;
    '09. change': string;
    '10. change percent': string;
    '06. volume': string;
}

interface GravityDocument {
    id: string;
    ticker: string;
    filing_type: string;
    filing_date: string | null;
    title: string;
    chunk_count: number;
    status: string;
}

interface GravityMetric {
    metric: string;
    value: string | number;
    unit?: string;
    period?: string;
    ticker?: string;
}

interface SentimentResult {
    ticker: string;
    overall_score: number;       // -1 to +1
    label: string;               // 'bullish' | 'neutral' | 'bearish'
    confidence: number;
    document_count: number;
    period?: string;
    breakdown?: { category: string; score: number; count: number }[];
}

interface SentimentDelta {
    ticker: string;
    current_score: number;
    previous_score: number;
    delta: number;
    direction: 'improving' | 'deteriorating' | 'stable';
    significant_shifts: { topic: string; change: number; direction: string }[];
}

interface LongitudinalPoint {
    period: string;
    revenue?: number;
    net_income?: number;
    operating_income?: number;
    eps?: number;
    gross_margin?: number;
    [key: string]: string | number | undefined;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const GRAVITY_BASE = import.meta.env.VITE_GRAVITY_URL ?? 'http://localhost:8000';

function fmt(n: string | number, style: 'currency' | 'percent' | 'number' = 'number'): string {
    const num = typeof n === 'string' ? parseFloat(n) : n;
    if (isNaN(num)) return '—';
    if (style === 'currency') {
        if (num >= 1e12) return `$${(num / 1e12).toFixed(2)}T`;
        if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
        if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
        return `$${num.toLocaleString()}`;
    }
    if (style === 'percent') return `${(num * 100).toFixed(2)}%`;
    return num.toLocaleString();
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
    return (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <p className="text-xs text-[#4A5568] uppercase tracking-wider mb-1">{label}</p>
            <p className="text-xl font-semibold text-white">{value}</p>
            {sub && <p className="text-xs text-[#A7B0C8] mt-0.5">{sub}</p>}
        </div>
    );
}

function FilingRow({ doc, ticker }: { doc: GravityDocument; ticker: string }) {
    const navigate = useNavigate();
    const typeColor: Record<string, string> = {
        '10-K': '#00F0FF', '10-Q': '#5B8DF6', '8-K': '#F59E0B',
    };
    const color = typeColor[doc.filing_type] ?? '#A7B0C8';
    return (
        <div className="flex items-center gap-3 py-2.5 border-b border-white/[0.04] last:border-0 group">
            <span
                className="text-[10px] font-mono px-1.5 py-0.5 rounded flex-shrink-0"
                style={{ color, background: color + '18' }}
            >
                {doc.filing_type}
            </span>
            <div className="flex-1 min-w-0">
                <p className="text-sm text-white truncate">{doc.title}</p>
                {doc.filing_date && <p className="text-[10px] text-[#4A5568]">{doc.filing_date}</p>}
            </div>
            <button
                onClick={() => navigate(`/search?q=${encodeURIComponent(`${ticker} ${doc.filing_type} ${doc.filing_date ?? ''}`)}`)}
                className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-[10px] text-[#00F0FF] hover:underline flex-shrink-0"
            >
                <Zap className="w-3 h-3" /> Search
            </button>
        </div>
    );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CompanyPage() {
    const { ticker } = useParams<{ ticker: string }>();
    const navigate = useNavigate();
    const symbol = (ticker ?? '').toUpperCase();

    const [overview, setOverview] = useState<MarketOverview | null>(null);
    const [quote, setQuote] = useState<Quote | null>(null);
    const [documents, setDocuments] = useState<GravityDocument[]>([]);
    const [metrics, setMetrics] = useState<GravityMetric[]>([]);
    const [sentiment, setSentiment] = useState<SentimentResult | null>(null);
    const [sentimentDelta, setSentimentDelta] = useState<SentimentDelta | null>(null);
    const [longitudinal, setLongitudinal] = useState<LongitudinalPoint[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'overview' | 'filings' | 'data' | 'sentiment'>('overview');

    useEffect(() => {
        if (!symbol) return;
        setLoading(true);

        Promise.allSettled([
            // Alpha Vantage overview
            apiGetOverview(symbol),
            // Alpha Vantage quote
            apiGetQuote(symbol),
            // Gravity indexed documents
            fetch(`${GRAVITY_BASE}/v1/documents?ticker=${symbol}&limit=15`).then(r => r.json()),
            // Gravity structured financial metrics
            fetch(`${GRAVITY_BASE}/v1/search/structured`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: `key financial metrics for ${symbol}`, companies: [symbol], limit: 30 }),
            }).then(r => r.json()),
            // Gravity sentiment score
            fetch(`${GRAVITY_BASE}/v1/analytics/sentiment/${symbol}`, {
                headers: { 'X-API-Key': 'deep-research-internal' },
            }).then(r => r.ok ? r.json() : null).catch(() => null),
            // Gravity sentiment delta (vs previous period)
            fetch(`${GRAVITY_BASE}/v1/analytics/sentiment/${symbol}/delta`, {
                headers: { 'X-API-Key': 'deep-research-internal' },
            }).then(r => r.ok ? r.json() : null).catch(() => null),
            // Gravity longitudinal trend
            fetch(`${GRAVITY_BASE}/v1/analytics/longitudinal/${symbol}`, {
                headers: { 'X-API-Key': 'deep-research-internal' },
            }).then(r => r.ok ? r.json() : null).catch(() => null),
        ]).then(([ov, qt, docs, met, sent, sentDelta, longit]) => {
            if (ov.status === 'fulfilled' && ov.value?.Symbol) setOverview(ov.value);
            if (qt.status === 'fulfilled') setQuote(qt.value?.['Global Quote'] ?? null);
            if (docs.status === 'fulfilled') setDocuments(docs.value?.documents ?? docs.value ?? []);
            if (met.status === 'fulfilled') setMetrics(met.value?.rows ?? met.value?.structured_data ?? []);
            if (sent.status === 'fulfilled' && sent.value) setSentiment(sent.value);
            if (sentDelta.status === 'fulfilled' && sentDelta.value) setSentimentDelta(sentDelta.value);
            if (longit.status === 'fulfilled' && longit.value) {
                const pts = longit.value?.data_points ?? longit.value?.periods ?? [];
                setLongitudinal(pts);
            }
            setLoading(false);
        });
    }, [symbol]);

    if (!symbol) return null;

    const price = quote?.['05. price'] ?? null;
    const changePct = quote?.['10. change percent']?.replace('%', '') ?? null;
    const isUp = changePct ? parseFloat(changePct) >= 0 : null;

    const chartData = metrics
        .filter(m => typeof m.value === 'number' && m.period)
        .slice(0, 8)
        .map(m => ({ name: m.period!, value: m.value as number, label: m.metric }));

    const COLORS = ['#00F0FF', '#5B8DF6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6'];

    return (
        <div className="min-h-[calc(100vh-64px)] p-6 max-w-5xl mx-auto">
            {/* Back */}
            <button
                onClick={() => navigate(-1)}
                className="flex items-center gap-1.5 text-sm text-[#A7B0C8] hover:text-white mb-6 transition-colors"
            >
                <ArrowLeft className="w-4 h-4" /> Back
            </button>

            {loading ? (
                <div className="flex items-center justify-center h-64">
                    <div className="w-8 h-8 rounded-full border-2 border-[#00F0FF] border-t-transparent animate-spin" />
                </div>
            ) : (
                <>
                    {/* Header */}
                    <div className="flex items-start justify-between gap-4 mb-6">
                        <div>
                            <div className="flex items-center gap-3 mb-1">
                                <div className="w-10 h-10 rounded-xl bg-[#5B8DF6]/10 flex items-center justify-center">
                                    <Building2 className="w-5 h-5 text-[#5B8DF6]" />
                                </div>
                                <div>
                                    <h1 className="text-2xl font-bold text-white">
                                        {overview?.Name ?? symbol}
                                    </h1>
                                    <p className="text-sm text-[#A7B0C8]">
                                        {symbol} · {overview?.Sector ?? '—'} · {overview?.Industry ?? '—'}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Price */}
                        {price && (
                            <div className="text-right flex-shrink-0">
                                <p className="text-3xl font-bold text-white">${parseFloat(price).toFixed(2)}</p>
                                {changePct && (
                                    <div className={`flex items-center justify-end gap-1 text-sm ${isUp ? 'text-green-400' : 'text-red-400'}`}>
                                        {isUp ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                                        {isUp ? '+' : ''}{parseFloat(changePct).toFixed(2)}%
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Quick actions */}
                    <div className="flex gap-2 mb-6">
                        <button
                            onClick={() => navigate(`/search?q=${encodeURIComponent(`${overview?.Name ?? symbol} latest earnings analysis`)}`)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#00F0FF]/10 border border-[#00F0FF]/30 text-[#00F0FF] text-xs hover:bg-[#00F0FF]/20 transition-colors"
                        >
                            <Zap className="w-3.5 h-3.5" /> Quick Search
                        </button>
                        <button
                            onClick={() => navigate(`/search?mode=research&q=${encodeURIComponent(`Full investment analysis of ${overview?.Name ?? symbol}`)}`)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#5B8DF6]/10 border border-[#5B8DF6]/30 text-[#5B8DF6] text-xs hover:bg-[#5B8DF6]/20 transition-colors"
                        >
                            <FileText className="w-3.5 h-3.5" /> Deep Research
                        </button>
                        <a
                            href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${symbol}&type=10-K&dateb=&owner=include&count=10`}
                            target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/[0.08] text-[#A7B0C8] text-xs hover:border-white/20 hover:text-white transition-colors"
                        >
                            <ExternalLink className="w-3.5 h-3.5" /> SEC EDGAR
                        </a>
                    </div>

                    {/* Key stats grid */}
                    {overview && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                            <StatCard label="Market Cap" value={fmt(overview.MarketCapitalization, 'currency')} />
                            <StatCard label="P/E Ratio" value={overview.PERatio ?? '—'} />
                            <StatCard label="EPS (TTM)" value={overview.EPS ? `$${overview.EPS}` : '—'} />
                            <StatCard label="Analyst Target" value={overview.AnalystTargetPrice ? `$${overview.AnalystTargetPrice}` : '—'} />
                            <StatCard label="52W High" value={overview['52WeekHigh'] ? `$${overview['52WeekHigh']}` : '—'} />
                            <StatCard label="52W Low" value={overview['52WeekLow'] ? `$${overview['52WeekLow']}` : '—'} />
                            <StatCard label="Operating Margin" value={overview.OperatingMarginTTM ? `${(parseFloat(overview.OperatingMarginTTM) * 100).toFixed(1)}%` : '—'} />
                            <StatCard label="Revenue (TTM)" value={fmt(overview.RevenueTTM, 'currency')} />
                        </div>
                    )}

                    {/* Tabs */}
                    <div className="flex gap-1 border-b border-white/[0.06] mb-5">
                        {([
                            { key: 'overview', label: 'Overview', icon: BarChart3 },
                            { key: 'filings', label: `Filings (${documents.length})`, icon: FileText },
                            { key: 'data', label: `Metrics (${metrics.length})`, icon: RefreshCw },
                            { key: 'sentiment', label: 'Sentiment', icon: Activity },
                        ] as const).map(({ key, label, icon: Icon }) => (
                            <button
                                key={key}
                                onClick={() => setActiveTab(key)}
                                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${activeTab === key
                                    ? 'border-[#00F0FF] text-[#00F0FF]'
                                    : 'border-transparent text-[#A7B0C8] hover:text-white'
                                    }`}
                            >
                                <Icon className="w-3.5 h-3.5" /> {label}
                            </button>
                        ))}
                    </div>

                    {/* Overview tab */}
                    {activeTab === 'overview' && (
                        <div className="space-y-5">
                            {overview?.Description && (
                                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
                                    <p className="text-xs text-[#4A5568] uppercase tracking-wider mb-2">About</p>
                                    <p className="text-sm text-[#A7B0C8] leading-relaxed">{overview.Description}</p>
                                </div>
                            )}

                            {chartData.length > 0 && (
                                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
                                    <p className="text-xs text-[#4A5568] uppercase tracking-wider mb-4">Financial Metrics (from Gravity Index)</p>
                                    <ResponsiveContainer width="100%" height={200}>
                                        <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 8, left: 8 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                                            <XAxis dataKey="name" tick={{ fill: '#4A5568', fontSize: 10 }} axisLine={false} tickLine={false} />
                                            <YAxis tick={{ fill: '#4A5568', fontSize: 10 }} axisLine={false} tickLine={false} width={60} />
                                            <Tooltip
                                                contentStyle={{ backgroundColor: '#0D1117', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', fontSize: '12px', color: '#E8EBF0' }}
                                                formatter={(v: number, _n, p) => [v.toLocaleString(), p.payload.label]}
                                            />
                                            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                                                {chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Filings tab */}
                    {activeTab === 'filings' && (
                        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                            {documents.length === 0
                                ? <p className="text-sm text-[#4A5568] text-center py-8">No indexed filings found. Seed the Gravity index first.</p>
                                : documents.map(doc => <FilingRow key={doc.id} doc={doc} ticker={symbol} />)
                            }
                        </div>
                    )}

                    {/* Sentiment tab */}
                    {activeTab === 'sentiment' && (
                        <div className="space-y-5">
                            {!sentiment ? (
                                <p className="text-sm text-[#4A5568] text-center py-8">
                                    No sentiment data indexed yet. Ingest earnings transcripts or news first.
                                </p>
                            ) : (
                                <>
                                    {/* Score card */}
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                                            <p className="text-xs text-[#4A5568] uppercase tracking-wider mb-1">Sentiment Score</p>
                                            <p className={`text-3xl font-bold ${sentiment.overall_score > 0.1 ? 'text-green-400' : sentiment.overall_score < -0.1 ? 'text-red-400' : 'text-yellow-400'}`}>
                                                {sentiment.overall_score > 0 ? '+' : ''}{(sentiment.overall_score * 100).toFixed(0)}
                                            </p>
                                            <p className="text-xs text-[#A7B0C8] mt-1 capitalize">{sentiment.label}</p>
                                        </div>
                                        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                                            <p className="text-xs text-[#4A5568] uppercase tracking-wider mb-1">Confidence</p>
                                            <p className="text-3xl font-bold text-white">{(sentiment.confidence * 100).toFixed(0)}%</p>
                                            <p className="text-xs text-[#4A5568] mt-1">{sentiment.document_count} documents analyzed</p>
                                        </div>
                                        {sentimentDelta && (
                                            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                                                <p className="text-xs text-[#4A5568] uppercase tracking-wider mb-1">vs Prior Period</p>
                                                <p className={`text-3xl font-bold ${sentimentDelta.delta > 0 ? 'text-green-400' : sentimentDelta.delta < 0 ? 'text-red-400' : 'text-yellow-400'}`}>
                                                    {sentimentDelta.delta > 0 ? '+' : ''}{(sentimentDelta.delta * 100).toFixed(0)}
                                                </p>
                                                <p className="text-xs text-[#A7B0C8] mt-1 capitalize">{sentimentDelta.direction}</p>
                                            </div>
                                        )}
                                    </div>

                                    {/* Category breakdown */}
                                    {sentiment.breakdown && sentiment.breakdown.length > 0 && (
                                        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
                                            <p className="text-xs text-[#4A5568] uppercase tracking-wider mb-4">Sentiment by Category</p>
                                            <div className="space-y-3">
                                                {sentiment.breakdown.map(b => (
                                                    <div key={b.category} className="flex items-center gap-3">
                                                        <span className="text-xs text-[#A7B0C8] w-32 flex-shrink-0 capitalize">{b.category}</span>
                                                        <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                                                            <div
                                                                className={`h-full rounded-full transition-all ${b.score > 0.1 ? 'bg-green-400' : b.score < -0.1 ? 'bg-red-400' : 'bg-yellow-400'}`}
                                                                style={{ width: `${Math.abs(b.score) * 100}%`, marginLeft: b.score < 0 ? 'auto' : '0' }}
                                                            />
                                                        </div>
                                                        <span className={`text-xs font-mono w-10 text-right ${b.score > 0.1 ? 'text-green-400' : b.score < -0.1 ? 'text-red-400' : 'text-yellow-400'}`}>
                                                            {b.score > 0 ? '+' : ''}{(b.score * 100).toFixed(0)}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Significant shifts */}
                                    {sentimentDelta?.significant_shifts && sentimentDelta.significant_shifts.length > 0 && (
                                        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
                                            <p className="text-xs text-[#4A5568] uppercase tracking-wider mb-3">Notable Shifts vs Prior Period</p>
                                            <div className="space-y-2">
                                                {sentimentDelta.significant_shifts.map((s, i) => (
                                                    <div key={i} className="flex items-center gap-3">
                                                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${s.direction === 'positive' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                                                            {s.direction === 'positive' ? '▲' : '▼'}
                                                        </span>
                                                        <span className="text-sm text-[#A7B0C8]">{s.topic}</span>
                                                        <span className={`ml-auto text-xs font-mono ${s.direction === 'positive' ? 'text-green-400' : 'text-red-400'}`}>
                                                            {s.change > 0 ? '+' : ''}{(s.change * 100).toFixed(0)} pts
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Longitudinal chart */}
                                    {longitudinal.length > 0 && (
                                        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
                                            <p className="text-xs text-[#4A5568] uppercase tracking-wider mb-4">Revenue Trend</p>
                                            <ResponsiveContainer width="100%" height={200}>
                                                <LineChart data={longitudinal} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                                                    <XAxis dataKey="period" tick={{ fill: '#4A5568', fontSize: 10 }} axisLine={false} tickLine={false} />
                                                    <YAxis tick={{ fill: '#4A5568', fontSize: 10 }} axisLine={false} tickLine={false} width={60} />
                                                    <Tooltip contentStyle={{ backgroundColor: '#0D1117', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', fontSize: '12px', color: '#E8EBF0' }} />
                                                    {['revenue', 'net_income', 'operating_income'].filter(k => longitudinal.some(p => p[k] !== undefined)).map((key, i) => (
                                                        <Line key={key} type="monotone" dataKey={key} stroke={['#00F0FF', '#5B8DF6', '#10B981'][i]} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} name={key.replace(/_/g, ' ')} />
                                                    ))}
                                                </LineChart>
                                            </ResponsiveContainer>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}

                    {/* Metrics tab */}
                    {activeTab === 'data' && (
                        <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
                            {metrics.length === 0
                                ? <p className="text-sm text-[#4A5568] text-center py-8">No structured metrics found in Gravity index.</p>
                                : (
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                                                {['Metric', 'Value', 'Period'].map(h => (
                                                    <th key={h} className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-[#4A5568]">{h}</th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-white/[0.04]">
                                            {metrics.map((m, i) => (
                                                <tr key={i} className="hover:bg-white/[0.02] transition-colors">
                                                    <td className="px-4 py-2.5 text-[#A7B0C8]">{m.metric}</td>
                                                    <td className="px-4 py-2.5 font-mono text-white">
                                                        {typeof m.value === 'number' ? m.value.toLocaleString() : m.value}
                                                        {m.unit && <span className="ml-1 text-xs text-[#4A5568]">{m.unit}</span>}
                                                    </td>
                                                    <td className="px-4 py-2.5 text-[#4A5568]">{m.period ?? '—'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )
                            }
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
