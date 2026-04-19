// Unified Search Page — QA (Gravity WebSocket) + Deep Research (Gemini Pipeline)
// User toggles between ⚡ Quick Answer and 📄 Deep Research before searching.

import { useState, useRef, useEffect, useCallback } from 'react';
import { useResearchStore } from '../stores/researchStore';
import { Link, useSearchParams } from 'react-router-dom';
import {
    Search, Zap, FileText, Database, ChevronRight, CheckCircle, Clock, Cpu,
    Sparkles, ChevronDown, Check, Feather, Plus, Trash2, ArrowUp, Edit3,
    Settings as SettingsIcon, Bookmark, BookmarkCheck, X, ExternalLink, Grid3x3,
} from 'lucide-react';
import GridView from '../components/grid/GridView';
import { useGravitySearch, type GravityCitation, type GravitySource, type GravityMetric, type ChartSpec, type SearchFilters } from '../hooks/useGravitySearch';
import {
    LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { fetchServerKeyStatus, hasRequiredKeysAsync } from '../services/apiKeys';
import {
    performDeepResearch,
    GEMINI_MODELS,
    ResearchCancelledError,
} from '../services/deepResearchService';
import ResearchProgress from '../components/research/ResearchProgress';
import ResearchReportComponent from '../components/research/ResearchReport';
import { supabase } from '../services/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

type SearchMode = 'grid' | 'qa' | 'research';

interface ChatTurn {
    role: 'user' | 'assistant';
    content: string;
    citations?: GravityCitation[];
    sources?: GravitySource[];
    structuredData?: GravityMetric[];
    chartSpecs?: ChartSpec[];
}

// HistoryItem is defined in researchStore.ts
import type { HistoryItem } from '../stores/researchStore';

// ─── QA Example queries ───────────────────────────────────────────────────────

const QA_EXAMPLES = [
    "What was NVIDIA's data center revenue in Q3 FY2026?",
    "Compare FAANG operating margins over the last 4 quarters",
    "What did TSMC say about CapEx guidance in recent earnings?",
    "Tesla gross margin trend from 2023 to 2025",
    "Which S&P 500 companies mentioned tariff risk in their 10-K?",
    "NVIDIA vs AMD data center GPU market share",
];

const RESEARCH_EXAMPLES = [
    'AI semiconductor demand trends 2025',
    'Electric vehicle market share analysis',
    'Enterprise SaaS valuation trends',
    'Cloud infrastructure spending forecast',
    'Renewable energy investment outlook',
];

// ─── Status labels for QA streaming ───────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
    understanding: 'Understanding query…',
    searching: 'Searching 5 retrieval channels…',
    reranking: 'Reranking results…',
    reasoning: 'Generating cited answer…',
    validating: 'Verifying citations…',
    complete: 'Done',
    error: 'Error',
};

// ─── Citation badge (click → side panel) ─────────────────────────────────────

function CitationBadge({ citation, onOpen }: { citation: GravityCitation; onOpen: (c: GravityCitation) => void }) {
    return (
        <button
            onClick={() => onOpen(citation)}
            title={`[${citation.citation_number}] ${citation.document_title}`}
            className="ml-0.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-[var(--accent)]/20 text-[var(--accent)] text-[10px] font-bold hover:bg-[var(--accent)]/40 active:scale-95 transition-all align-super"
        >
            {citation.citation_number}
        </button>
    );
}

// ─── Answer renderer with inline citation badges ──────────────────────────────

function AnswerText({ text, citations, onCitationOpen }: {
    text: string;
    citations: GravityCitation[];
    onCitationOpen?: (c: GravityCitation) => void;
}) {
    const citationMap = new Map(citations.map(c => [c.citation_number, c]));
    const parts = text.split(/(\[\d+\])/g);
    return (
        <div className="prose prose-invert prose-sm max-w-none text-[var(--text)] leading-7">
            {parts.map((part, i) => {
                const match = part.match(/^\[(\d+)\]$/);
                if (match) {
                    const num = parseInt(match[1]);
                    const citation = citationMap.get(num);
                    return citation
                        ? <CitationBadge key={i} citation={citation} onOpen={onCitationOpen ?? (() => {})} />
                        : <sup key={i} className="text-[var(--accent)] text-xs">[{num}]</sup>;
                }
                return <span key={i}>{part}</span>;
            })}
        </div>
    );
}

// ─── Source card ──────────────────────────────────────────────────────────────

function SourceCard({ source, index }: { source: GravitySource; index: number }) {
    const [expanded, setExpanded] = useState(false);
    return (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 hover:border-[var(--accent)]/20 transition-colors">
            <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-mono text-[var(--accent)] bg-[var(--accent)]/10 px-1.5 py-0.5 rounded">
                            {source.ticker || '—'}
                        </span>
                        <span className="text-[10px] text-[var(--text-2)] truncate">{source.section}</span>
                        <span className="ml-auto text-[10px] text-[var(--text-3)]">
                            {Math.round(source.score * 100)}%
                        </span>
                    </div>
                    <p className="text-xs font-medium text-white truncate">{source.document_title}</p>
                    {source.filing_date && (
                        <p className="text-[10px] text-[var(--text-3)] mt-0.5">{source.filing_date}</p>
                    )}
                </div>
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-white/5 text-[var(--text-2)] text-[10px] flex items-center justify-center">
                    {index + 1}
                </span>
            </div>
            <button
                onClick={() => setExpanded(e => !e)}
                className="mt-2 text-[10px] text-[var(--accent)] hover:text-[var(--accent)] transition-colors"
            >
                {expanded ? 'Hide passage' : 'Show passage'}
            </button>
            {expanded && (
                <p className="mt-2 text-[11px] text-[var(--text-2)] leading-relaxed border-l-2 border-[var(--accent)]/30 pl-2">
                    "{source.text}"
                </p>
            )}
        </div>
    );
}

// ─── Chart renderer ───────────────────────────────────────────────────────────

const CHART_COLORS = ['var(--accent)', 'var(--accent)', 'var(--accent)', 'oklch(0.785 0.170 72)', 'var(--up)', 'var(--down)'];

function DataChart({ spec, structuredData }: { spec: ChartSpec; structuredData: GravityMetric[] }) {
    // Build a lookup from row_id → metric row
    const rowMap = new Map(structuredData.map(r => [r.row_id ?? '', r]));

    // Collect the relevant rows in spec order
    const rows = spec.data_refs.map(ref => rowMap.get(ref)).filter(Boolean) as GravityMetric[];
    if (rows.length === 0) return null;

    // For line/area: x = period, group by entity+metric series
    // For bar: x = entity (or period), single dimension
    const isTimeSeries = spec.chart_type === 'line' || spec.chart_type === 'area';

    // Build flat array of { x, [seriesKey]: value }
    type DataPoint = Record<string, string | number>;
    const points: DataPoint[] = [];

    if (isTimeSeries) {
        // Group by period
        const byPeriod = new Map<string, DataPoint>();
        rows.forEach(r => {
            const period = r.period ?? '';
            if (!byPeriod.has(period)) byPeriod.set(period, { x: period });
            const key = r.entity ? `${r.entity} ${r.metric}` : r.metric;
            byPeriod.get(period)![key] = typeof r.value === 'number' ? r.value : parseFloat(String(r.value)) || 0;
        });
        points.push(...Array.from(byPeriod.values()));
    } else {
        // Bar: one bar per row, x = entity or period
        rows.forEach(r => {
            points.push({
                x: r.entity ?? r.period ?? '',
                value: typeof r.value === 'number' ? r.value : parseFloat(String(r.value)) || 0,
            });
        });
    }

    // Determine series keys (all keys except 'x')
    const seriesKeys = points.length > 0
        ? Object.keys(points[0]).filter(k => k !== 'x')
        : ['value'];

    const tooltipStyle = {
        backgroundColor: 'var(--bg)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 8,
        fontSize: 11,
        color: 'var(--text)',
    };

    return (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <p className="text-xs font-medium text-[var(--text-2)] mb-3">{spec.title}</p>
            <ResponsiveContainer width="100%" height={220}>
                {isTimeSeries ? (
                    <LineChart data={points} margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                        <XAxis dataKey="x" tick={{ fill: 'var(--text-3)', fontSize: 10 }} axisLine={false} tickLine={false} />
                        <YAxis
                            tick={{ fill: 'var(--text-3)', fontSize: 10 }}
                            axisLine={false}
                            tickLine={false}
                            label={spec.y_label ? { value: spec.y_label, angle: -90, position: 'insideLeft', fill: 'var(--text-3)', fontSize: 10, dx: -4 } : undefined}
                        />
                        <Tooltip contentStyle={tooltipStyle} />
                        {seriesKeys.length > 1 && <Legend wrapperStyle={{ fontSize: 10, color: 'var(--text-2)' }} />}
                        {seriesKeys.map((key, i) => (
                            <Line
                                key={key}
                                type="monotone"
                                dataKey={key}
                                stroke={CHART_COLORS[i % CHART_COLORS.length]}
                                strokeWidth={2}
                                dot={{ r: 3, fill: CHART_COLORS[i % CHART_COLORS.length] }}
                                activeDot={{ r: 5 }}
                            />
                        ))}
                    </LineChart>
                ) : (
                    <BarChart data={points} margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                        <XAxis dataKey="x" tick={{ fill: 'var(--text-3)', fontSize: 10 }} axisLine={false} tickLine={false} />
                        <YAxis
                            tick={{ fill: 'var(--text-3)', fontSize: 10 }}
                            axisLine={false}
                            tickLine={false}
                            label={spec.y_label ? { value: spec.y_label, angle: -90, position: 'insideLeft', fill: 'var(--text-3)', fontSize: 10, dx: -4 } : undefined}
                        />
                        <Tooltip contentStyle={tooltipStyle} />
                        {seriesKeys.map((key, i) => (
                            <Bar
                                key={key}
                                dataKey={key}
                                fill={CHART_COLORS[i % CHART_COLORS.length]}
                                radius={[4, 4, 0, 0]}
                                maxBarSize={48}
                            />
                        ))}
                    </BarChart>
                )}
            </ResponsiveContainer>
            {spec.y_label && <p className="text-[10px] text-[var(--text-3)] mt-1 text-right">{spec.y_label}</p>}
        </div>
    );
}

// ─── Source filter config ─────────────────────────────────────────────────────

const SOURCE_FILTERS = [
    { id: 'all',      label: 'All Sources',     types: [] },
    { id: 'filings',  label: 'SEC Filings',      types: ['10-K', '10-Q', '8-K'] },
    { id: 'earnings', label: 'Earnings Calls',   types: ['earnings_transcript'] },
    { id: 'news',     label: 'News',             types: ['news'] },
    { id: 'broker',   label: 'Broker Reports',   types: ['broker_report'] },
] as const;

type SourceFilterId = typeof SOURCE_FILTERS[number]['id'];

// ─── Source Filter Bar ────────────────────────────────────────────────────────

function SourceFilterBar({ active, onChange }: { active: SourceFilterId; onChange: (id: SourceFilterId) => void }) {
    return (
        <div className="flex items-center gap-1 flex-wrap">
            {SOURCE_FILTERS.map(f => (
                <button
                    key={f.id}
                    onClick={() => onChange(f.id)}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-all border ${
                        active === f.id
                            ? 'bg-[var(--accent)]/15 border-[var(--accent)]/40 text-[var(--accent)]'
                            : 'border-white/[0.08] text-[var(--text-3)] hover:text-[var(--text-2)] hover:border-white/[0.15]'
                    }`}
                >
                    {f.label}
                </button>
            ))}
        </div>
    );
}

// ─── Agent Trace Panel — live reasoning steps ─────────────────────────────────

const AGENT_COLORS: Record<string, string> = {
    Planner:   'var(--accent)',
    Reader:    'var(--accent)',
    Extractor: 'var(--accent)',
    Critic:    'oklch(0.785 0.170 72)',
    Verifier:  'var(--up)',
    Writer:    'var(--down)',
};

const AGENT_ICONS: Record<string, string> = {
    Planner:   '🗺',
    Reader:    '📖',
    Extractor: '⛏',
    Critic:    '🔍',
    Verifier:  '✅',
    Writer:    '✍',
};

import type { AgentTraceStep } from '../hooks/useGravitySearch';

function AgentTracePanel({ steps, complete, totalIterations, totalCostUsd }: {
    steps: AgentTraceStep[];
    complete: boolean;
    totalIterations: number;
    totalCostUsd: number | null;
}) {
    if (steps.length === 0) return null;
    return (
        <div className="mt-3 rounded-xl border border-[var(--accent)]/20 bg-[var(--accent)]/5 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06]">
                <Cpu className="w-3.5 h-3.5 text-[var(--accent)]" />
                <span className="text-xs font-semibold text-[var(--accent)]">Agentic Reasoning</span>
                {complete && (
                    <span className="ml-auto text-[10px] text-[var(--text-2)]">
                        {totalIterations} iter{totalIterations !== 1 ? 's' : ''}
                        {totalCostUsd !== null ? ` · $${totalCostUsd.toFixed(4)}` : ''}
                    </span>
                )}
                {!complete && (
                    <span className="ml-auto w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse" />
                )}
            </div>
            <div className="px-3 py-2 space-y-1.5">
                {steps.map((s, i) => {
                    const color = AGENT_COLORS[s.agent] ?? 'var(--text-2)';
                    const icon = AGENT_ICONS[s.agent] ?? '·';
                    return (
                        <div key={i} className="flex items-start gap-2">
                            <span className="text-base leading-none mt-0.5">{icon}</span>
                            <div className="flex-1 min-w-0">
                                <span className="text-[11px] font-semibold" style={{ color }}>{s.agent}</span>
                                <span className="text-[11px] text-[var(--text-2)]"> · {s.action}</span>
                                {s.detail && (
                                    <p className="text-[10px] text-[var(--text-3)] truncate">{s.detail}</p>
                                )}
                            </div>
                            {s.quality_score !== undefined && (
                                <span className={`text-[10px] font-mono ml-auto ${s.quality_score >= 0.75 ? 'text-green-400' : 'text-yellow-400'}`}>
                                    {Math.round(s.quality_score * 100)}%
                                </span>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ─── Citation side panel ──────────────────────────────────────────────────────

function CitationPanel({ citation, onClose }: { citation: GravityCitation; onClose: () => void }) {
    return (
        <div className="fixed inset-y-0 right-0 w-[400px] max-w-full z-50 flex flex-col" style={{ background: 'var(--bg)', borderLeft: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
                <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-[var(--accent)]/20 text-[var(--accent)] text-[10px] font-bold flex items-center justify-center">
                        {citation.citation_number}
                    </span>
                    <span className="text-xs font-semibold text-white truncate max-w-[280px]">{citation.document_title}</span>
                </div>
                <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
                    <X className="w-4 h-4 text-[var(--text-2)]" />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                {/* Source metadata */}
                <div className="flex flex-wrap gap-2">
                    {citation.ticker && (
                        <span className="px-2 py-0.5 rounded bg-[var(--accent)]/10 text-[var(--accent)] text-xs font-mono">{citation.ticker}</span>
                    )}
                    {citation.section && (
                        <span className="px-2 py-0.5 rounded bg-white/[0.04] text-[var(--text-2)] text-xs">{citation.section}</span>
                    )}
                    {citation.is_verified && (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-green-500/10 text-green-400 text-xs">
                            <CheckCircle className="w-3 h-3" /> Verified
                        </span>
                    )}
                </div>

                {/* Passage */}
                <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
                    <p className="text-xs text-[var(--text-3)] uppercase tracking-wider mb-3">Source Passage</p>
                    <blockquote className="text-sm text-[var(--text)] leading-relaxed border-l-2 border-[var(--accent)]/40 pl-4">
                        "{citation.text}"
                    </blockquote>
                </div>

                {/* Link to full doc */}
                <a
                    href={`/documents?ticker=${citation.ticker}&title=${encodeURIComponent(citation.document_title)}`}
                    className="flex items-center gap-2 text-xs text-[var(--accent)] hover:text-[var(--accent)] transition-colors"
                >
                    <ExternalLink className="w-3.5 h-3.5" />
                    View full document
                </a>
            </div>
        </div>
    );
}

// ─── Mode Toggle ──────────────────────────────────────────────────────────────

function ModeToggle({ mode, onChange }: { mode: SearchMode; onChange: (m: SearchMode) => void }) {
    return (
        <div className="flex rounded-full p-0.5" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <button
                onClick={() => onChange('grid')}
                className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-medium transition-all ${mode === 'grid'
                    ? 'bg-[var(--accent)]/20 text-[var(--accent)] shadow-sm'
                    : 'text-[var(--text-2)] hover:text-white'
                    }`}
            >
                <Grid3x3 className="w-3.5 h-3.5" />
                Research Grid
            </button>
            <button
                onClick={() => onChange('qa')}
                className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-medium transition-all ${mode === 'qa'
                    ? 'bg-[var(--accent)]/15 text-[var(--accent)] shadow-sm'
                    : 'text-[var(--text-2)] hover:text-white'
                    }`}
            >
                <Zap className="w-3.5 h-3.5" />
                Quick Answer
            </button>
            <button
                onClick={() => onChange('research')}
                className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-medium transition-all ${mode === 'research'
                    ? 'bg-[var(--accent)]/20 text-[var(--accent)] shadow-sm'
                    : 'text-[var(--text-2)] hover:text-white'
                    }`}
            >
                <FileText className="w-3.5 h-3.5" />
                Deep Research
            </button>
        </div>
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// ─── Page ─────────────────────────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════════

export default function SearchPage() {
    // ── Mode state ────────────────────────────────────────────────────────────
    const [mode, setMode] = useState<SearchMode>('qa');

    // ── QA state ──────────────────────────────────────────────────────────────
    const [qaInput, setQaInput] = useState('');
    const [conversationId] = useState<string>(() => crypto.randomUUID());
    const [chatHistory, setChatHistory] = useState<ChatTurn[]>([]);
    const [activeTab, setActiveTab] = useState<'answer' | 'sources' | 'data'>('answer');
    const [activeSource, setActiveSource] = useState<SourceFilterId>('all');
    const [openCitation, setOpenCitation] = useState<GravityCitation | null>(null);
    const [savedSearches, setSavedSearches] = useState<Set<string>>(new Set());
    const qaInputRef = useRef<HTMLInputElement>(null);
    const { state: qaState, displayAnswer, search: qaSearch, cancel: qaCancel } = useGravitySearch();

    // ── Research state (global store — survives route changes) ────────────────
    const [researchInput, setResearchInput] = useState('');
    const [showModelPicker, setShowModelPicker] = useState(false);
    const [loadingReport, setLoadingReport] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const researchAbortRef = useRef<AbortController | null>(null);

    const isResearching  = useResearchStore((s) => s.isResearching);
    const progress       = useResearchStore((s) => s.progress);
    const report         = useResearchStore((s) => s.report);
    const researchError  = useResearchStore((s) => s.researchError);
    const selectedModel  = useResearchStore((s) => s.selectedModel);
    const history        = useResearchStore((s) => s.history);
    const activeId       = useResearchStore((s) => s.activeId);
    const sidebarSearch  = useResearchStore((s) => s.sidebarSearch);

    const setIsResearching  = useResearchStore((s) => s.setIsResearching);
    const setProgress        = useResearchStore((s) => s.setProgress);
    const setReport          = useResearchStore((s) => s.setReport);
    const setResearchError   = useResearchStore((s) => s.setResearchError);
    const setSelectedModel   = useResearchStore((s) => s.setSelectedModel);
    const setHistory         = useResearchStore((s) => s.setHistory);
    const setActiveId        = useResearchStore((s) => s.setActiveId);
    const setSidebarSearch   = useResearchStore((s) => s.setSidebarSearch);
    const prependHistory     = useResearchStore((s) => s.prependHistory);
    const removeFromHistory  = useResearchStore((s) => s.removeFromHistory);
    const resetResearch      = useResearchStore((s) => s.resetResearch);

    // ── Shared ────────────────────────────────────────────────────────────────
    const [searchParams, setSearchParams] = useSearchParams();

    // ── Init ──────────────────────────────────────────────────────────────────
    useEffect(() => {
        fetchHistory();
        const q = searchParams.get('q');
        const m = searchParams.get('mode');
        if (m === 'research') setMode('research');
        if (q?.trim()) {
            setSearchParams({}, { replace: true });
            if (m === 'research') {
                setMode('research');
                setTimeout(() => runResearch(q.trim()), 300);
            } else {
                handleQaSubmit(q.trim());
            }
        } else {
            qaInputRef.current?.focus();
        }
    }, []);

    // ── QA handlers ───────────────────────────────────────────────────────────

    const handleQaSubmit = (q: string) => {
        if (!q.trim()) return;

        // Save previous turn to history if an answer exists
        if (displayAnswer) {
            setChatHistory(prev => [
                ...prev,
                { role: 'user', content: qaInput },
                {
                    role: 'assistant',
                    content: qaState.finalAnswer || displayAnswer,
                    citations: qaState.citations,
                    sources: qaState.sources,
                    structuredData: qaState.structuredData,
                    chartSpecs: qaState.chartSpecs,
                }
            ]);
        }

        // Build filters from active source selection
        const filterConf = SOURCE_FILTERS.find(f => f.id === activeSource);
        const filters: SearchFilters | undefined = filterConf && filterConf.types.length > 0
            ? { document_types: [...filterConf.types] }
            : undefined;

        setQaInput(q);
        setActiveTab('answer');
        setOpenCitation(null);
        qaSearch(q.trim(), conversationId, filters);
    };

    const handleSaveSearch = async (q: string) => {
        if (!q.trim() || savedSearches.has(q)) return;
        try {
            await fetch('http://localhost:8000/v1/workspaces', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-API-Key': 'deep-research-internal' },
                body: JSON.stringify({ name: q.slice(0, 80), queries: [q], description: 'Saved from search' }),
            });
            setSavedSearches(prev => new Set([...prev, q]));
        } catch { /* non-blocking */ }
    };

    const isQaSearching = !['idle', 'complete', 'error'].includes(qaState.status);

    // ── Research handlers ─────────────────────────────────────────────────────

    const fetchHistory = useCallback(async (force = false) => {
        // Skip if already loaded unless forced (e.g. after delete)
        if (!force && history.length > 0) return;
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const { data } = await supabase
            .from('research_reports')
            .select('id, query, title, created_at')
            .eq('user_id', session.user.id)
            .order('created_at', { ascending: false })
            .limit(50);
        if (data) setHistory(data);
    }, [history.length, setHistory]);

    const runResearch = async (searchQuery: string) => {
        if (!searchQuery.trim() || isResearching) return;
        if (!(await hasRequiredKeysAsync())) {
            setResearchError('Server is missing required API keys (LLM provider + Tavily). Check Settings.');
            return;
        }
        setIsResearching(true);
        setProgress(null);
        setReport(null);
        setResearchError(null);
        setActiveId(null);
        setResearchInput('');
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
        const controller = new AbortController();
        researchAbortRef.current = controller;
        try {
            const result = await performDeepResearch(searchQuery, setProgress, selectedModel, undefined, controller.signal);
            setReport(result);
            try {
                const { data: { session } } = await supabase.auth.getSession();
                if (session) {
                    const { data: saved } = await supabase.from('research_reports').insert({
                        user_id: session.user.id,
                        query: result.query,
                        title: result.title,
                        summary: result.summary || '',
                        markdown: result.markdown,
                        citations: result.citations,
                        sources_analyzed: result.metadata.sourcesAnalyzed,
                        read_time: result.metadata.estimatedReadTime,
                    }).select('id').single();
                    if (saved) {
                        setActiveId(saved.id);
                        prependHistory({ id: saved.id, query: result.query, title: result.title, created_at: new Date().toISOString() });
                    }
                }
            } catch { /* non-blocking */ }
        } catch (err) {
            if (err instanceof ResearchCancelledError || controller.signal.aborted) {
                setResearchError(null);
                setProgress(null);
            } else {
                setResearchError(err instanceof Error ? err.message : 'Research failed');
            }
        } finally {
            researchAbortRef.current = null;
            setIsResearching(false);
        }
    };

    const cancelResearch = () => {
        researchAbortRef.current?.abort();
    };

    const handleLoadReport = async (item: HistoryItem) => {
        if (activeId === item.id) return;
        setLoadingReport(true);
        setResearchError(null);
        setActiveId(item.id);
        try {
            const { data } = await supabase.from('research_reports').select('*').eq('id', item.id).single();
            if (data) setReport({ query: data.query, title: data.title, summary: data.summary, markdown: data.markdown, citations: data.citations || [], metadata: { sourcesAnalyzed: data.sources_analyzed, generatedAt: data.created_at, estimatedReadTime: data.read_time } });
        } catch { setResearchError('Failed to load report'); }
        finally { setLoadingReport(false); }
    };

    const handleNewResearch = () => {
        setResearchInput('');
        resetResearch();
        setTimeout(() => textareaRef.current?.focus(), 50);
    };

    const handleDeleteReport = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        await supabase.from('research_reports').delete().eq('id', id);
        removeFromHistory(id);
        if (activeId === id) handleNewResearch();
    };

    const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setResearchInput(e.target.value);
        e.target.style.height = 'auto';
        e.target.style.height = Math.min(e.target.scrollHeight, 180) + 'px';
    };

    const handleResearchKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runResearch(researchInput); }
    };

    // ── Research sidebar helpers ──────────────────────────────────────────────

    const filteredHistory = history.filter(h =>
        h.query.toLowerCase().includes(sidebarSearch.toLowerCase()) ||
        h.title.toLowerCase().includes(sidebarSearch.toLowerCase())
    );

    const groupByDate = (items: HistoryItem[]) => {
        const now = new Date();
        const groups: { label: string; items: HistoryItem[] }[] = [
            { label: 'Today', items: [] },
            { label: 'Yesterday', items: [] },
            { label: 'Previous 7 days', items: [] },
            { label: 'Older', items: [] },
        ];
        items.forEach(item => {
            const diff = Math.floor((now.getTime() - new Date(item.created_at).getTime()) / 86400000);
            if (diff === 0) groups[0].items.push(item);
            else if (diff === 1) groups[1].items.push(item);
            else if (diff < 7) groups[2].items.push(item);
            else groups[3].items.push(item);
        });
        return groups.filter(g => g.items.length > 0);
    };

    const grouped = groupByDate(filteredHistory);
    const tierColors: Record<string, string> = { premium: 'oklch(0.785 0.170 72)', standard: 'var(--accent)', lite: 'var(--up)' };
    const tierIcons: Record<string, typeof Sparkles> = { premium: Sparkles, standard: Zap, lite: Feather };

    // ═════════════════════════════════════════════════════════════════════════
    // ── RENDER ─────────────────────────────────────────────────────────────
    // ═════════════════════════════════════════════════════════════════════════

    // ── GRID MODE ─────────────────────────────────────────────────────────────
    if (mode === 'grid') {
        return (
            <div className="flex flex-col h-full min-h-[calc(100vh-48px)] bg-[color:var(--bg)]">
                <div className="border-b border-[color:var(--line)] px-4 py-2 bg-[color:var(--surface)]">
                    <div className="flex gap-3 max-w-4xl mx-auto items-center">
                        <ModeToggle mode={mode} onChange={setMode} />
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto">
                    <GridView />
                </div>
            </div>
        );
    }

    // ── QA MODE ───────────────────────────────────────────────────────────────
    if (mode === 'qa') {
        return (
            <div className="flex flex-col h-full min-h-[calc(100vh-64px)]">
                {/* Citation side panel overlay */}
                {openCitation && (
                    <>
                        <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setOpenCitation(null)} />
                        <CitationPanel citation={openCitation} onClose={() => setOpenCitation(null)} />
                    </>
                )}

                {/* Search bar + Mode toggle */}
                <div className="border-b border-white/[0.05] px-6 py-3 bg-[var(--bg)]">
                    <div className="flex gap-3 max-w-4xl mx-auto items-center">
                        <ModeToggle mode={mode} onChange={setMode} />
                        <form
                            onSubmit={e => { e.preventDefault(); handleQaSubmit(qaInput); }}
                            className="flex gap-3 flex-1"
                        >
                            <div className="flex-1 relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-2)]" />
                                <input
                                    ref={qaInputRef}
                                    value={qaInput}
                                    onChange={e => setQaInput(e.target.value)}
                                    placeholder="Ask anything about any company, filing, or market trend…"
                                    className="w-full pl-10 pr-4 py-2.5 bg-white/[0.04] border border-white/[0.08] rounded-xl text-sm text-white placeholder:text-[var(--text-3)] focus:outline-none focus:border-[var(--accent)]/40 transition-colors"
                                />
                            </div>
                            {isQaSearching ? (
                                <button
                                    type="button"
                                    onClick={qaCancel}
                                    className="px-4 py-2.5 rounded-xl border border-red-500/30 text-red-400 text-sm hover:bg-red-500/10 transition-colors"
                                >
                                    Cancel
                                </button>
                            ) : (
                                <button
                                    type="submit"
                                    disabled={!qaInput.trim()}
                                    className="px-5 py-2.5 rounded-xl bg-[var(--accent)]/10 border border-[var(--accent)]/30 text-[var(--accent)] text-sm font-medium hover:bg-[var(--accent)]/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                                >
                                    <Zap className="w-4 h-4" /> Search
                                </button>
                            )}
                        </form>
                    </div>
                    {/* Source filter bar */}
                    <div className="flex items-center justify-between max-w-4xl mx-auto mt-2">
                        <SourceFilterBar active={activeSource} onChange={id => { setActiveSource(id); }} />
                        {/* Save search button */}
                        {qaInput.trim() && (
                            <button
                                onClick={() => handleSaveSearch(qaInput)}
                                title={savedSearches.has(qaInput) ? 'Search saved' : 'Save search'}
                                className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs border border-white/[0.08] text-[var(--text-3)] hover:text-[var(--text-2)] hover:border-white/[0.15] transition-all"
                            >
                                {savedSearches.has(qaInput)
                                    ? <><BookmarkCheck className="w-3.5 h-3.5 text-[var(--accent)]" /> Saved</>
                                    : <><Bookmark className="w-3.5 h-3.5" /> Save</>
                                }
                            </button>
                        )}
                    </div>
                </div>

                <div className="flex-1 max-w-4xl mx-auto w-full px-6 py-6">
                    {/* Chat History */}
                    {chatHistory.length > 0 && (
                        <div className="space-y-6 mb-8">
                            {chatHistory.map((turn, i) => (
                                <div key={i} className={turn.role === 'user' ? 'flex justify-end' : ''}>
                                    {turn.role === 'user' ? (
                                        <div className="bg-[var(--accent)]/15 text-[var(--accent)] px-4 py-2.5 rounded-2xl max-w-[85%] text-sm">
                                            {turn.content}
                                        </div>
                                    ) : (
                                        <div className="bg-white/[0.02] border border-white/[0.06] p-5 rounded-2xl w-full">
                                            <AnswerText text={turn.content} citations={turn.citations || []} onCitationOpen={setOpenCitation} />
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Idle state — example queries */}
                    {qaState.status === 'idle' && chatHistory.length === 0 && (
                        <div className="space-y-6">
                            <p className="text-sm text-[var(--text-3)] text-center">Try asking:</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {QA_EXAMPLES.map(q => (
                                    <button
                                        key={q}
                                        onClick={() => handleQaSubmit(q)}
                                        className="text-left px-4 py-3 rounded-xl border border-white/[0.06] bg-white/[0.02] text-sm text-[var(--text-2)] hover:border-[var(--accent)]/30 hover:text-white transition-colors flex items-center gap-2 group"
                                    >
                                        <ChevronRight className="w-4 h-4 text-[var(--text-3)] group-hover:text-[var(--accent)] flex-shrink-0" />
                                        {q}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Status indicator */}
                    {isQaSearching && (
                        <div className="flex items-center gap-3 mb-6 text-sm text-[var(--text-2)]">
                            <div className="w-4 h-4 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
                            {STATUS_LABELS[qaState.status] ?? 'Working…'}
                        </div>
                    )}

                    {/* Results */}
                    {(displayAnswer || qaState.sources.length > 0) && (
                        <>
                            {/* Tabs */}
                            <div className="flex gap-1 mb-5 border-b border-white/[0.06]">
                                {([
                                    { key: 'answer', label: 'Answer', icon: Zap },
                                    { key: 'sources', label: `Sources (${qaState.sources.length})`, icon: FileText },
                                    { key: 'data', label: `Data${qaState.chartSpecs.length > 0 ? ` · ${qaState.chartSpecs.length} chart${qaState.chartSpecs.length > 1 ? 's' : ''}` : qaState.structuredData.length > 0 ? ` (${qaState.structuredData.length})` : ''}`, icon: Database },
                                ] as const).map(({ key, label, icon: Icon }) => (
                                    <button
                                        key={key}
                                        onClick={() => setActiveTab(key)}
                                        className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${activeTab === key
                                            ? 'border-[var(--accent)] text-[var(--accent)]'
                                            : 'border-transparent text-[var(--text-2)] hover:text-white'
                                            }`}
                                    >
                                        <Icon className="w-3.5 h-3.5" />
                                        {label}
                                    </button>
                                ))}

                                {/* Metadata */}
                                {qaState.status === 'complete' && (
                                    <div className="ml-auto flex items-center gap-3 text-[10px] text-[var(--text-3)] pb-1">
                                        {qaState.cacheHit && <span className="text-yellow-500">⚡ Cached</span>}
                                        {qaState.latencyMs && (
                                            <span className="flex items-center gap-1">
                                                <Clock className="w-3 h-3" />{qaState.latencyMs}ms
                                            </span>
                                        )}
                                        {qaState.modelUsed && (
                                            <span className="flex items-center gap-1">
                                                <Cpu className="w-3 h-3" />{qaState.modelUsed}
                                            </span>
                                        )}
                                        {qaState.confidence > 0 && (
                                            <span className={qaState.confidence > 0.8 ? 'text-green-400' : qaState.confidence > 0.6 ? 'text-yellow-400' : 'text-red-400'}>
                                                {Math.round(qaState.confidence * 100)}% confidence
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Answer tab */}
                            {activeTab === 'answer' && (
                                <div className="space-y-6">
                                    {/* Agentic reasoning trace — shown when pipeline runs in agentic mode */}
                                    <AgentTracePanel
                                        steps={qaState.agentSteps}
                                        complete={qaState.agentTraceComplete}
                                        totalIterations={qaState.totalIterations}
                                        totalCostUsd={qaState.totalCostUsd}
                                    />

                                    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
                                        {displayAnswer
                                            ? <AnswerText text={displayAnswer} citations={qaState.citations} onCitationOpen={setOpenCitation} />
                                            : <div className="flex items-center gap-2 text-sm text-[var(--text-2)]">
                                                <div className="w-3 h-3 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
                                                Generating answer…
                                            </div>
                                        }
                                    </div>

                                    {/* Follow-up queries */}
                                    {qaState.followUpQueries.length > 0 && (
                                        <div>
                                            <p className="text-xs text-[var(--text-3)] mb-2 uppercase tracking-wider">Follow-up</p>
                                            <div className="flex flex-col gap-1.5">
                                                {qaState.followUpQueries.map(q => (
                                                    <button
                                                        key={q}
                                                        onClick={() => handleQaSubmit(q)}
                                                        className="text-left text-sm text-[var(--text-2)] hover:text-[var(--accent)] flex items-center gap-2 group transition-colors"
                                                    >
                                                        <ChevronRight className="w-4 h-4 text-[var(--text-3)] group-hover:text-[var(--accent)] flex-shrink-0" />
                                                        {q}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Sources tab */}
                            {activeTab === 'sources' && (
                                <div className="space-y-2">
                                    {qaState.sources.length === 0
                                        ? <p className="text-sm text-[var(--text-3)] text-center py-8">No sources retrieved yet</p>
                                        : qaState.sources.map((s, i) => <SourceCard key={s.chunk_id} source={s} index={i} />)
                                    }
                                </div>
                            )}

                            {/* Data tab */}
                            {activeTab === 'data' && (
                                <div className="space-y-4">
                                    {qaState.chartSpecs.length === 0 && qaState.structuredData.length === 0 && (
                                        <p className="text-sm text-[var(--text-3)] text-center py-8">No structured financial data for this query</p>
                                    )}

                                    {/* Charts */}
                                    {qaState.chartSpecs.length > 0 && (
                                        <div className="space-y-4">
                                            {qaState.chartSpecs.map(spec => (
                                                <DataChart
                                                    key={spec.chart_id}
                                                    spec={spec}
                                                    structuredData={qaState.structuredData}
                                                />
                                            ))}
                                        </div>
                                    )}

                                    {/* Data table */}
                                    {qaState.structuredData.length > 0 && (
                                        <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
                                            <table className="w-full text-sm">
                                                <thead>
                                                    <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                                                        {['Entity', 'Metric', 'Value', 'Period'].map(h => (
                                                            <th key={h} className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-3)]">{h}</th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-white/[0.04]">
                                                    {qaState.structuredData.map((m, i) => (
                                                        <tr key={i} className="hover:bg-white/[0.02] transition-colors">
                                                            <td className="px-4 py-2.5">
                                                                {(m.entity || m.ticker) && (
                                                                    <span className="text-xs text-[var(--accent)] bg-[var(--accent)]/10 px-1.5 py-0.5 rounded">
                                                                        {m.entity ?? m.ticker}
                                                                    </span>
                                                                )}
                                                            </td>
                                                            <td className="px-4 py-2.5 text-[var(--text-2)]">{m.metric}</td>
                                                            <td className="px-4 py-2.5 font-mono text-white">
                                                                {typeof m.value === 'number' ? m.value.toLocaleString() : m.value}
                                                                {m.unit && <span className="ml-1 text-xs text-[var(--text-3)]">{m.unit}</span>}
                                                            </td>
                                                            <td className="px-4 py-2.5 text-[var(--text-3)]">{m.period ?? '—'}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            )}
                        </>
                    )}

                    {/* Error */}
                    {qaState.status === 'error' && (
                        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">
                            {qaState.error ?? 'Search failed. Make sure the Gravity backend is running on port 8000.'}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // ── DEEP RESEARCH MODE ────────────────────────────────────────────────────
    return (
        <div className="flex h-[calc(100vh-64px)]" style={{ background: 'var(--bg)' }}>

            {/* ═══════════════ SIDEBAR ═══════════════ */}
            <aside className="w-[280px] flex-shrink-0 flex flex-col" style={{ background: 'var(--bg)', borderRight: '1px solid rgba(255,255,255,0.05)' }}>
                <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-[15px] font-medium text-white/80">Research</span>
                    <button
                        onClick={handleNewResearch}
                        title="New research"
                        className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
                    >
                        <Edit3 className="w-4 h-4 text-white/60" />
                    </button>
                </div>

                <div className="px-3 pb-2">
                    <button
                        onClick={handleNewResearch}
                        className="w-full flex items-center gap-3 px-4 py-2.5 rounded-full text-sm text-white/80 hover:bg-white/10 transition-colors"
                        style={{ background: 'rgba(255,255,255,0.04)' }}
                    >
                        <Plus className="w-4 h-4" />
                        New research
                    </button>
                </div>

                <div className="px-3 pb-2">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.04)' }}>
                        <Search className="w-3.5 h-3.5 text-white/30 flex-shrink-0" />
                        <input
                            type="text"
                            value={sidebarSearch}
                            onChange={e => setSidebarSearch(e.target.value)}
                            placeholder="Search research..."
                            className="flex-1 bg-transparent text-xs text-white/70 placeholder:text-white/25 outline-none"
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto px-2 pb-2" style={{ scrollbarWidth: 'none' }}>
                    {history.length === 0 ? (
                        <div className="text-center py-10">
                            <p className="text-xs text-white/25">No research yet</p>
                        </div>
                    ) : (
                        grouped.map(group => (
                            <div key={group.label} className="mb-1">
                                <p className="text-[11px] text-white/30 font-medium px-3 py-1.5">
                                    {group.label}
                                </p>
                                {group.items.map(item => (
                                    <button
                                        key={item.id}
                                        onClick={() => handleLoadReport(item)}
                                        className={`group w-full flex items-center gap-1 px-3 py-2 rounded-full text-left transition-all text-[13px] leading-snug ${activeId === item.id
                                            ? 'bg-white/15 text-white'
                                            : 'text-white/65 hover:bg-white/[0.08] hover:text-white/90'
                                            }`}
                                    >
                                        <span className="flex-1 truncate">{item.query}</span>
                                        <span
                                            onClick={(e) => handleDeleteReport(item.id, e)}
                                            className="opacity-0 group-hover:opacity-100 flex-shrink-0 p-1 rounded-full hover:bg-white/10 transition-all"
                                            title="Delete"
                                        >
                                            <Trash2 className="w-3 h-3 text-white/40 hover:text-red-400" />
                                        </span>
                                    </button>
                                ))}
                            </div>
                        ))
                    )}
                </div>

                <div className="px-3 py-3 border-t border-white/[0.06]">
                    <Link
                        to="/settings"
                        className="flex items-center gap-3 px-3 py-2 rounded-full text-sm text-white/50 hover:bg-white/[0.08] hover:text-white/80 transition-colors"
                    >
                        <SettingsIcon className="w-4 h-4" />
                        Settings & help
                    </Link>
                </div>
            </aside>

            {/* ═══════════════ MAIN AREA ═══════════════ */}
            <div className="flex-1 flex flex-col min-w-0" style={{ background: 'var(--bg)' }}>

                {/* Mode toggle bar */}
                <div className="border-b border-white/[0.05] px-6 py-3 flex items-center">
                    <ModeToggle mode={mode} onChange={setMode} />
                </div>

                {/* Scrollable content */}
                <div className="flex-1 overflow-y-auto">
                    {loadingReport && (
                        <div className="flex items-center justify-center py-32">
                            <div className="w-8 h-8 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" />
                        </div>
                    )}

                    {researchError && !loadingReport && (
                        <div className="max-w-3xl mx-auto px-8 py-10">
                            <div className="rounded-2xl border border-red-500/15 bg-red-500/5 p-5 flex items-start gap-3">
                                <SettingsIcon className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                                <div>
                                    <p className="text-sm text-white/80 mb-1">Something went wrong</p>
                                    <p className="text-xs text-white/40">{researchError}</p>
                                    {researchError.includes('API keys') && (
                                        <Link to="/settings" className="mt-2 inline-flex items-center gap-1 text-xs text-blue-400 hover:underline">
                                            <SettingsIcon className="w-3 h-3" /> Configure API Keys
                                        </Link>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {isResearching && progress && (
                        <div>
                            <ResearchProgress progress={progress} />
                            <div className="flex justify-center mt-4">
                                <button
                                    onClick={cancelResearch}
                                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm text-white/80 hover:text-white transition-all"
                                    style={{
                                        background: 'rgba(239, 68, 68, 0.1)',
                                        border: '1px solid rgba(239, 68, 68, 0.3)',
                                    }}
                                >
                                    <X className="w-4 h-4" />
                                    Cancel research
                                </button>
                            </div>
                        </div>
                    )}

                    {report && !isResearching && !loadingReport && (
                        <ResearchReportComponent report={report} />
                    )}

                    {/* Empty / Welcome state */}
                    {!report && !isResearching && !researchError && !loadingReport && (
                        <div className="flex flex-col items-center justify-center h-full min-h-[420px] px-8 text-center">
                            <div className="w-16 h-16 rounded-full flex items-center justify-center mb-6"
                                style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent), var(--down))' }}>
                                <Sparkles className="w-7 h-7 text-white" />
                            </div>
                            <h2 className="text-3xl font-medium text-white/90 mb-2">Deep Research</h2>
                            <p className="text-sm text-white/40 max-w-sm mb-10 leading-relaxed">
                                AI-powered institutional research reports with live web sources, SEC filings & market data
                            </p>
                            <div className="flex flex-wrap justify-center gap-2 max-w-xl">
                                {RESEARCH_EXAMPLES.map((s, i) => (
                                    <button
                                        key={i}
                                        onClick={() => { setResearchInput(s); setTimeout(() => textareaRef.current?.focus(), 50); }}
                                        className="px-4 py-2 rounded-full text-sm text-white/55 hover:text-white/90 transition-all"
                                        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
                                    >
                                        {s}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* ═══════════════ INPUT PILL (Gemini-style) ═══════════════ */}
                <div className="px-6 pb-6 pt-2">
                    <div className="max-w-3xl mx-auto">
                        <div
                            className="rounded-3xl transition-all"
                            style={{
                                background: 'var(--bg)',
                                border: '1px solid rgba(255,255,255,0.07)',
                            }}
                        >
                            <div className="px-5 pt-4 pb-1">
                                <textarea
                                    ref={textareaRef}
                                    value={researchInput}
                                    onChange={handleTextareaChange}
                                    onKeyDown={handleResearchKeyDown}
                                    placeholder="Ask a market research question…"
                                    rows={1}
                                    disabled={isResearching}
                                    className="w-full resize-none bg-transparent text-[15px] text-white/90 placeholder:text-white/30 outline-none leading-relaxed min-h-[26px] max-h-[180px] disabled:opacity-40"
                                    style={{ scrollbarWidth: 'none' }}
                                />
                            </div>

                            <div className="flex items-center justify-between px-3 pb-3 pt-1">
                                <div className="flex items-center gap-1">
                                    <button className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors">
                                        <Plus className="w-4 h-4 text-white/50" />
                                    </button>

                                    {/* Model selector */}
                                    <div className="relative">
                                        <button
                                            onClick={() => setShowModelPicker(!showModelPicker)}
                                            className="flex items-center gap-1.5 h-8 px-3 rounded-full text-[12px] text-white/60 hover:bg-white/10 transition-colors font-medium"
                                        >
                                            <Cpu className="w-3.5 h-3.5" />
                                            {GEMINI_MODELS.find(m => m.id === selectedModel)?.name.replace('Gemini ', '')}
                                            <ChevronDown className={`w-3 h-3 transition-transform ${showModelPicker ? 'rotate-180' : ''}`} />
                                        </button>

                                        {showModelPicker && (
                                            <>
                                                <div className="fixed inset-0 z-40" onClick={() => setShowModelPicker(false)} />
                                                <div
                                                    className="absolute left-0 bottom-full mb-2 w-72 rounded-2xl shadow-2xl overflow-hidden z-50"
                                                    style={{ background: 'var(--surface)', border: '1px solid rgba(255,255,255,0.07)' }}
                                                >
                                                    <div className="px-4 py-2.5 text-[11px] text-white/30 uppercase tracking-wider font-medium border-b border-white/[0.06]">
                                                        Select model
                                                    </div>
                                                    {GEMINI_MODELS.map(model => {
                                                        const isSelected = selectedModel === model.id;
                                                        const color = tierColors[model.tier];
                                                        const TierIcon = tierIcons[model.tier] || Cpu;
                                                        return (
                                                            <button
                                                                key={model.id}
                                                                onClick={() => { setSelectedModel(model.id); setShowModelPicker(false); }}
                                                                className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.06] ${isSelected ? 'bg-white/[0.08]' : ''}`}
                                                            >
                                                                <TierIcon className="w-4 h-4 flex-shrink-0" style={{ color }} />
                                                                <div className="flex-1 min-w-0">
                                                                    <div className="text-[13px] font-medium text-white/80">{model.name}</div>
                                                                    <div className="text-[11px] text-white/35 mt-0.5">{model.desc}</div>
                                                                </div>
                                                                {isSelected && <Check className="w-4 h-4 text-white/50" />}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>

                                {/* Send button */}
                                <button
                                    onClick={() => runResearch(researchInput)}
                                    disabled={isResearching || !researchInput.trim()}
                                    className="w-9 h-9 rounded-full flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                                    style={{
                                        background: researchInput.trim() && !isResearching
                                            ? 'white'
                                            : 'rgba(255,255,255,0.12)',
                                    }}
                                >
                                    {isResearching ? (
                                        <div className="w-4 h-4 border-2 border-black/30 border-t-black/80 rounded-full animate-spin" />
                                    ) : (
                                        <ArrowUp className="w-4 h-4" style={{ color: researchInput.trim() ? 'var(--bg)' : 'rgba(255,255,255,0.4)' }} />
                                    )}
                                </button>
                            </div>
                        </div>
                        <p className="text-[11px] text-white/20 text-center mt-2">
                            Enter to research · Shift+Enter for new line
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
