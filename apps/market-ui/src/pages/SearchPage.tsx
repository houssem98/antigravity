// Unified Search Page — QA (Gravity WebSocket) + Deep Research (Gemini Pipeline)
// User toggles between ⚡ Quick Answer and 📄 Deep Research before searching.

import { useState, useRef, useEffect, useCallback, Children, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useResearchStore } from '../stores/researchStore';
import { Link, useSearchParams } from 'react-router-dom';
import {
    Search, Zap, FileText, Database, ChevronRight, CheckCircle, Clock, Cpu,
    Sparkles, ChevronDown, Check, Feather, Plus, Trash2, ArrowUp, Edit3,
    Settings as SettingsIcon, Bookmark, BookmarkCheck, X, ExternalLink, Grid3x3,
} from 'lucide-react';
import GridView from '../components/grid/GridView';
import { useGravitySearch, cleanAnswer, type GravityCitation, type GravitySource, type GravityMetric, type ChartSpec, type SearchFilters } from '../hooks/useGravitySearch';
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
import type { ResearchBlueprint } from '../services/deepResearchService';
import { runResearchGraph } from '../services/researchGraph';
import ResearchProgress from '../components/research/ResearchProgress';
import ResearchReportComponent from '../components/research/ResearchReport';
import BlueprintReview from '../components/research/BlueprintReview';
import QaSearchProgress from '../components/qa/QaSearchProgress';
import { supabase, getAccessToken } from '../services/supabase';
import {
    listQaConversations, createQaConversation, loadQaTurns, saveQaTurn,
    deleteQaConversation, conversationTitle,
    type QaConversationMeta,
} from '../services/qaHistory';

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

// Replace inline [N] markers in any direct string child with a clickable citation
// badge. Applied at every text-bearing element so badges work inside paragraphs,
// list items, table cells, headings, and emphasis alike.
function injectCitations(
    children: ReactNode,
    citationMap: Map<number, GravityCitation>,
    onOpen: (c: GravityCitation) => void,
): ReactNode {
    return Children.map(children, (child) => {
        if (typeof child !== 'string') return child;
        const parts = child.split(/(\[\d+\])/g);
        return parts.map((part, i) => {
            const m = part.match(/^\[(\d+)\]$/);
            if (!m) return part;
            const num = parseInt(m[1], 10);
            const c = citationMap.get(num);
            return c
                ? <CitationBadge key={i} citation={c} onOpen={onOpen} />
                : <sup key={i} className="text-[var(--accent)] text-xs">[{num}]</sup>;
        });
    });
}

function AnswerText({ text, citations, onCitationOpen }: {
    text: string;
    citations: GravityCitation[];
    onCitationOpen?: (c: GravityCitation) => void;
}) {
    const citationMap = new Map(citations.map(c => [c.citation_number, c]));
    const onOpen = onCitationOpen ?? (() => {});
    const cite = (children: ReactNode) => injectCitations(children, citationMap, onOpen);
    const md = cleanAnswer(text);

    return (
        <div className="text-[var(--text)] text-[13.5px] leading-7 space-y-3.5 break-words">
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                    p: ({ children }) => <p className="leading-7">{cite(children)}</p>,
                    strong: ({ children }) => <strong className="font-semibold text-white">{cite(children)}</strong>,
                    em: ({ children }) => <em className="italic">{cite(children)}</em>,
                    a: ({ href, children }) => (
                        <a href={href} target="_blank" rel="noopener noreferrer"
                           className="text-[var(--accent)] underline decoration-[var(--accent)]/40 hover:decoration-[var(--accent)]">
                            {cite(children)}
                        </a>
                    ),
                    ul: ({ children }) => <ul className="list-disc pl-5 space-y-1.5 marker:text-[var(--text-3)]">{children}</ul>,
                    ol: ({ children }) => <ol className="list-decimal pl-5 space-y-1.5 marker:text-[var(--text-3)]">{children}</ol>,
                    li: ({ children }) => <li className="leading-7">{cite(children)}</li>,
                    h1: ({ children }) => <h1 className="font-display text-lg font-semibold text-white mt-5 mb-2">{cite(children)}</h1>,
                    h2: ({ children }) => <h2 className="font-display text-base font-semibold text-white mt-5 mb-2">{cite(children)}</h2>,
                    h3: ({ children }) => <h3 className="font-display text-sm font-semibold text-white/90 mt-4 mb-1.5 uppercase tracking-wide">{cite(children)}</h3>,
                    blockquote: ({ children }) => (
                        <blockquote className="pl-3 border-l border-white/15 text-[var(--text-2)] italic">{children}</blockquote>
                    ),
                    hr: () => <hr className="border-white/[0.08] my-4" />,
                    code: ({ children }) => (
                        <code className="font-mono text-[12px] bg-white/[0.06] text-[var(--accent)] px-1 py-0.5 rounded">{children}</code>
                    ),
                    pre: ({ children }) => (
                        <pre className="font-mono text-[12px] bg-white/[0.03] border border-white/[0.06] rounded-lg p-3 overflow-x-auto">{children}</pre>
                    ),
                    table: ({ children }) => (
                        <div className="overflow-x-auto rounded-lg border border-white/[0.08] my-3">
                            <table className="w-full text-[12.5px] border-collapse">{children}</table>
                        </div>
                    ),
                    thead: ({ children }) => <thead className="bg-white/[0.04]">{children}</thead>,
                    tr: ({ children }) => <tr className="border-b border-white/[0.06] last:border-0">{children}</tr>,
                    th: ({ children }) => (
                        <th className="px-3 py-2 text-left font-semibold text-[var(--text-2)] uppercase tracking-wider text-[11px] whitespace-nowrap">
                            {cite(children)}
                        </th>
                    ),
                    td: ({ children }) => (
                        <td className="px-3 py-2 text-[var(--text)] align-top whitespace-nowrap">{cite(children)}</td>
                    ),
                }}
            >
                {md}
            </ReactMarkdown>
        </div>
    );
}

// ─── Source pills (document-copilot style, our colors) ────────────────────────
// Numbered chips under the answer; click opens the right-side context panel.

function SourcePills({ citations, onOpen }: {
    citations: GravityCitation[];
    onOpen: (c: GravityCitation) => void;
}) {
    if (!citations.length) return null;
    return (
        <div>
            <p className="text-[10px] text-[var(--text-3)] uppercase tracking-wider mb-2">Sources</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {citations.map(c => (
                    <button
                        key={c.citation_number}
                        onClick={() => onOpen(c)}
                        title={c.document_title}
                        className="shiny chrome press flex items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--line)] bg-white/[0.02] px-2.5 py-2 text-left hover:border-[color-mix(in_oklch,var(--accent)_40%,transparent)] transition-colors"
                    >
                        <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[var(--accent)]/15 text-[var(--accent)] text-[10px] font-bold flex items-center justify-center">
                            {c.citation_number}
                        </span>
                        <span className="min-w-0">
                            <span className="flex items-center gap-1.5">
                                {c.ticker && <span className="text-[11px] font-mono font-semibold text-[var(--accent)]">{c.ticker}</span>}
                                {c.is_verified && <CheckCircle className="w-3 h-3 text-green-400 flex-shrink-0" />}
                            </span>
                            <span className="block text-[10px] text-[var(--text-3)] truncate">{c.document_title}</span>
                        </span>
                    </button>
                ))}
            </div>
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

// ─── SEC filing-type sub-selector (customisable) ──────────────────────────────
// Fetched from gravity-api's canonical registry so users pick exactly which SEC
// forms to search (10-K, 8-K, DEF 14A, 13F-HR, ...). Shown when "SEC Filings" active.

interface FilingTypeMeta {
    code: string; label: string; category: string; description: string;
    parsing: string; default: boolean;
}

const GRAVITY_API = import.meta.env.VITE_GRAVITY_API_URL || 'http://localhost:8000';

function useFilingTypes(): FilingTypeMeta[] {
    const [types, setTypes] = useState<FilingTypeMeta[]>([]);
    useEffect(() => {
        let alive = true;
        fetch(`${GRAVITY_API}/v1/documents/filing-types`)
            .then(r => (r.ok ? r.json() : null))
            .then(d => { if (alive && d?.filing_types) setTypes(d.filing_types); })
            .catch(() => { /* registry optional — falls back to defaults */ });
        return () => { alive = false; };
    }, []);
    return types;
}

function FilingTypeSelector({
    types, selected, onToggle,
}: {
    types: FilingTypeMeta[];
    selected: Set<string>;
    onToggle: (code: string) => void;
}) {
    if (types.length === 0) return null;
    return (
        <div className="flex items-center gap-1 flex-wrap max-w-4xl mx-auto mt-2 pl-1">
            {types.map(t => {
                const on = selected.has(t.code);
                return (
                    <button
                        key={t.code}
                        onClick={() => onToggle(t.code)}
                        title={`${t.description} (${t.category})`}
                        className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium transition-all border ${
                            on
                                ? 'bg-[var(--accent)]/15 border-[var(--accent)]/40 text-[var(--accent)]'
                                : 'border-white/[0.06] text-[var(--text-3)] hover:text-[var(--text-2)] hover:border-white/[0.12]'
                        }`}
                    >
                        {t.code}
                    </button>
                );
            })}
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

// ─── Source context — cited chunk + neighbours (small-to-big) ─────────────────

interface ContextChunk { position: number; text: string; section: string; is_cited: boolean; }

function SourceContext({ citation }: { citation: GravityCitation }) {
    const [chunks, setChunks] = useState<ContextChunk[] | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let alive = true;
        setLoading(true); setChunks(null);
        (async () => {
            try {
                const tok = await getAccessToken();
                const res = await fetch(
                    `${GRAVITY_API}/v1/documents/chunk/${encodeURIComponent(citation.chunk_id)}/context?window=1`,
                    { headers: tok ? { Authorization: `Bearer ${tok}` } : {} },
                );
                const data = res.ok ? await res.json() : null;
                if (alive) setChunks(data?.chunks?.length ? data.chunks : null);
            } catch {
                if (alive) setChunks(null);
            } finally {
                if (alive) setLoading(false);
            }
        })();
        return () => { alive = false; };
    }, [citation.chunk_id]);

    // Fallback: no neighbours persisted → show the cited passage alone.
    const rows: ContextChunk[] = chunks ?? [
        { position: 0, text: citation.text, section: citation.section, is_cited: true },
    ];

    return (
        <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
            <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-[var(--text-3)] uppercase tracking-wider">Source Context</p>
                {loading && <div className="w-3 h-3 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />}
            </div>
            <p className="text-[10px] text-[var(--text-3)] mb-3">Neighbouring chunks are shown around the cited passage for continuity.</p>
            <div className="space-y-2">
                {rows.map((c, i) => (
                    <div
                        key={i}
                        className={c.is_cited
                            ? 'rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/[0.06] p-3'
                            : 'rounded-lg border border-white/[0.05] bg-white/[0.01] p-3'}
                    >
                        <div className="flex items-center gap-2 mb-1.5">
                            <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded ${c.is_cited ? 'bg-[var(--accent)]/20 text-[var(--accent)]' : 'bg-white/[0.05] text-[var(--text-3)]'}`}>
                                {c.is_cited ? 'Cited passage' : (i === 0 ? 'Previous' : 'Next')}
                            </span>
                            {c.section && <span className="text-[10px] text-[var(--text-3)] truncate">{c.section}</span>}
                        </div>
                        <p className={`text-xs leading-relaxed ${c.is_cited ? 'text-[var(--text)]' : 'text-[var(--text-2)]'}`}>
                            {c.is_cited ? `"${c.text}"` : c.text}
                        </p>
                    </div>
                ))}
            </div>
        </div>
    );
}

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
                {/* Source metadata — ticker · form · filed date (parsed from title) */}
                {(() => {
                    const fm = citation.document_title.match(/\b(10-K|10-Q|8-K|DEF 14A|S-1|20-F|6-K|40-F|13F-HR|SC 13[DG]|4)\b/);
                    const dm = citation.document_title.match(/\d{4}-\d{2}-\d{2}/);
                    return (
                        <div className="flex flex-wrap gap-2">
                            {citation.ticker && (
                                <span className="px-2 py-0.5 rounded bg-[var(--accent)]/10 text-[var(--accent)] text-xs font-mono">{citation.ticker}</span>
                            )}
                            {fm && (
                                <span className="px-2 py-0.5 rounded bg-white/[0.06] text-white text-xs font-medium">{fm[0]}</span>
                            )}
                            {dm && (
                                <span className="px-2 py-0.5 rounded bg-white/[0.04] text-[var(--text-2)] text-xs">Filed {dm[0]}</span>
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
                    );
                })()}

                {/* Source context — cited passage + neighbouring chunks */}
                <SourceContext citation={citation} />

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
    const [conversationId, setConversationId] = useState<string>(() => crypto.randomUUID());
    const [chatHistory, setChatHistory] = useState<ChatTurn[]>([]);
    const [activeTab, setActiveTab] = useState<'answer' | 'sources' | 'data'>('answer');
    const [activeSource, setActiveSource] = useState<SourceFilterId>('all');
    const filingTypes = useFilingTypes();
    // User-selected SEC sub-types (empty = use the SEC Filings default set).
    const [selectedFilingTypes, setSelectedFilingTypes] = useState<Set<string>>(new Set());
    const toggleFilingType = (code: string) => setSelectedFilingTypes(prev => {
        const next = new Set(prev);
        next.has(code) ? next.delete(code) : next.add(code);
        return next;
    });
    const [openCitation, setOpenCitation] = useState<GravityCitation | null>(null);
    const [savedSearches, setSavedSearches] = useState<Set<string>>(new Set());
    const qaInputRef = useRef<HTMLInputElement>(null);
    const { state: qaState, displayAnswer, search: qaSearch, cancel: qaCancel, reset: qaReset } = useGravitySearch();

    // ── QA history (persistent — Supabase qa_conversations/qa_turns) ──────────
    const [qaConversations, setQaConversations] = useState<QaConversationMeta[]>([]);
    const [activeQaId, setActiveQaId] = useState<string | null>(null);
    const [qaSidebarSearch, setQaSidebarSearch] = useState('');
    const [currentQuery, setCurrentQuery] = useState<string | null>(null); // live exchange question
    const completedRef = useRef(false);                     // dedupe the complete→persist effect
    const threadEndRef = useRef<HTMLDivElement>(null);

    // ── Research state (global store — survives route changes) ────────────────
    const [researchInput, setResearchInput] = useState('');
    const [showModelPicker, setShowModelPicker] = useState(false);
    const [loadingReport, setLoadingReport] = useState(false);
    const [reviewPlan, setReviewPlan] = useState(false);
    const [pendingBlueprint, setPendingBlueprint] = useState<ResearchBlueprint | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const researchAbortRef = useRef<AbortController | null>(null);
    const blueprintResolverRef = useRef<((v: ResearchBlueprint | null | undefined) => void) | null>(null);

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
        loadQaConversations();
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
        if (!q.trim() || isQaSearching) return;

        // Commit the previous finished exchange into the thread before starting
        // a new one. The live block always renders only the current exchange.
        if (currentQuery && qaState.finalAnswer) {
            const finished = currentQuery;
            const finishedAnswer = qaState.finalAnswer;
            setChatHistory(prev => [
                ...prev,
                { role: 'user', content: finished },
                {
                    role: 'assistant',
                    content: finishedAnswer,
                    citations: qaState.citations,
                    sources: qaState.sources,
                    structuredData: qaState.structuredData,
                    chartSpecs: qaState.chartSpecs,
                },
            ]);
        }

        // Build filters from active source selection. For SEC Filings, honor the
        // user's filing-type sub-selection (falls back to the default set if none).
        const filterConf = SOURCE_FILTERS.find(f => f.id === activeSource);
        let docTypes: string[] = filterConf ? [...filterConf.types] : [];
        if (activeSource === 'filings' && selectedFilingTypes.size > 0) {
            docTypes = [...selectedFilingTypes];
        }
        const filters: SearchFilters | undefined = docTypes.length > 0
            ? { document_types: docTypes }
            : undefined;

        setCurrentQuery(q.trim());
        completedRef.current = false;
        setQaInput('');
        setActiveTab('answer');
        setOpenCitation(null);
        qaSearch(q.trim(), conversationId, filters);
        requestAnimationFrame(() => threadEndRef.current?.scrollIntoView({ behavior: 'smooth' }));
    };

    // ── QA history handlers ────────────────────────────────────────────────────

    const loadQaConversations = useCallback(async () => {
        const rows = await listQaConversations();
        setQaConversations(rows);
    }, []);

    // On completion, persist the exchange (create the conversation row on first
    // answer). Display is handled by the live block — this only touches the DB.
    useEffect(() => {
        if (qaState.status !== 'complete' || completedRef.current) return;
        const answer = qaState.finalAnswer;
        const userQ = currentQuery;
        if (!answer || !userQ) return;
        completedRef.current = true;

        const assistantTurn = {
            role: 'assistant' as const,
            content: answer,
            citations: qaState.citations,
            sources: qaState.sources,
            structuredData: qaState.structuredData,
            chartSpecs: qaState.chartSpecs,
            followUpQueries: qaState.followUpQueries,
        };

        (async () => {
            let convId = activeQaId;
            if (!convId) {
                convId = await createQaConversation(conversationTitle(userQ));
                if (convId) {
                    setActiveQaId(convId);
                    setConversationId(convId);
                    await loadQaConversations();
                }
            }
            if (!convId) return;
            await saveQaTurn(convId, { role: 'user', content: userQ });
            await saveQaTurn(convId, assistantTurn);
        })();

        requestAnimationFrame(() => threadEndRef.current?.scrollIntoView({ behavior: 'smooth' }));
    }, [qaState.status]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleNewQa = () => {
        qaReset();
        setChatHistory([]);
        setActiveQaId(null);
        setConversationId(crypto.randomUUID());
        setCurrentQuery(null);
        setQaInput('');
        completedRef.current = false;
        setOpenCitation(null);
        setTimeout(() => qaInputRef.current?.focus(), 50);
    };

    const handleLoadQaConversation = async (id: string) => {
        if (activeQaId === id) return;
        qaReset();
        setOpenCitation(null);
        setCurrentQuery(null);
        const turns = await loadQaTurns(id);
        setChatHistory(turns.map(t => ({
            role: t.role,
            content: t.content,
            citations: t.citations,
            sources: t.sources,
            structuredData: t.structuredData,
            chartSpecs: t.chartSpecs,
        })));
        setActiveQaId(id);
        setConversationId(id);
        completedRef.current = false;
    };

    const handleDeleteQaConversation = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        await deleteQaConversation(id);
        setQaConversations(prev => prev.filter(c => c.id !== id));
        if (activeQaId === id) handleNewQa();
    };

    // Group QA conversations by recency for the sidebar.
    const qaGrouped = (() => {
        const q = qaSidebarSearch.toLowerCase();
        const filtered = q ? qaConversations.filter(c => c.title.toLowerCase().includes(q)) : qaConversations;
        const now = Date.now();
        const groups: { label: string; items: QaConversationMeta[] }[] = [
            { label: 'Today', items: [] }, { label: 'Yesterday', items: [] },
            { label: 'Previous 7 days', items: [] }, { label: 'Older', items: [] },
        ];
        filtered.forEach(c => {
            const d = Math.floor((now - new Date(c.created_at).getTime()) / 86400000);
            if (d <= 0) groups[0].items.push(c);
            else if (d === 1) groups[1].items.push(c);
            else if (d < 7) groups[2].items.push(c);
            else groups[3].items.push(c);
        });
        return groups.filter(g => g.items.length > 0);
    })();

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
            // Build optional HITL callback — present only when the toggle is on.
            // The callback stashes the drafted blueprint into component state and
            // returns a Promise the dialog resolves when the analyst clicks
            // Approve / Run-with-edits / Cancel.
            const onBlueprintReady = reviewPlan
                ? (bp: ResearchBlueprint) => new Promise<ResearchBlueprint | null | undefined>(resolve => {
                    blueprintResolverRef.current = resolve;
                    setPendingBlueprint(bp);
                })
                : undefined;
            // Use graph orchestration when VITE_USE_RESEARCH_GRAPH=true (durable
            // checkpointing, reflection loop, gap-fill fanout). Falls back to the
            // direct pipeline if the graph encounters an unrecoverable error.
            const useGraph = import.meta.env.VITE_USE_RESEARCH_GRAPH === 'true';
            const result = useGraph
                ? await runResearchGraph({
                    query: searchQuery,
                    onProgress: setProgress,
                    model: selectedModel,
                    signal: controller.signal,
                    onBlueprintReady,
                })
                : await performDeepResearch(
                    searchQuery,
                    setProgress,
                    selectedModel,
                    undefined,
                    controller.signal,
                    onBlueprintReady,
                );
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
            blueprintResolverRef.current = null;
            setPendingBlueprint(null);
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
        const hasThread = chatHistory.length > 0 || currentQuery !== null;
        const dataCount = qaState.chartSpecs.length > 0
            ? ` · ${qaState.chartSpecs.length} chart${qaState.chartSpecs.length > 1 ? 's' : ''}`
            : qaState.structuredData.length > 0 ? ` (${qaState.structuredData.length})` : '';
        return (
            <div className="flex h-[calc(100vh-64px)] bg-[var(--bg)]">
                {/* Citation side panel overlay */}
                {openCitation && (
                    <>
                        <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]" onClick={() => setOpenCitation(null)} />
                        <CitationPanel citation={openCitation} onClose={() => setOpenCitation(null)} />
                    </>
                )}

                {/* Human-in-the-loop plan-review dialog */}
                {pendingBlueprint && (
                    <BlueprintReview
                        blueprint={pendingBlueprint}
                        onSubmit={result => {
                            const resolve = blueprintResolverRef.current;
                            blueprintResolverRef.current = null;
                            setPendingBlueprint(null);
                            resolve?.(result);
                        }}
                    />
                )}

                {/* ═══════════════ HISTORY SIDEBAR ═══════════════ */}
                <aside className="w-[256px] flex-shrink-0 flex-col hidden md:flex border-r border-[var(--line)]">
                    <div className="flex items-center justify-between px-4 pt-4 pb-2">
                        <span className="label" style={{ letterSpacing: '0.12em' }}>Quick Answer</span>
                        <button
                            onClick={handleNewQa}
                            title="New conversation"
                            className="press w-7 h-7 rounded-[var(--radius)] flex items-center justify-center text-[var(--text-3)] hover:text-[var(--text)] hover:bg-white/[0.05] transition-colors"
                        >
                            <Edit3 className="w-3.5 h-3.5" />
                        </button>
                    </div>

                    <div className="px-3 pb-2">
                        <button
                            onClick={handleNewQa}
                            className="press w-full flex items-center gap-2 px-3 py-2 rounded-[var(--radius)] text-[13px] text-[var(--text-2)] hover:text-[var(--text)] border border-[var(--line)] hover:border-[var(--line-strong)] transition-colors"
                        >
                            <Plus className="w-3.5 h-3.5" />
                            New conversation
                        </button>
                    </div>

                    <div className="px-3 pb-2">
                        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-[var(--radius)] bg-white/[0.03] border border-transparent focus-within:border-[var(--line)]">
                            <Search className="w-3.5 h-3.5 text-[var(--text-4)] flex-shrink-0" />
                            <input
                                value={qaSidebarSearch}
                                onChange={e => setQaSidebarSearch(e.target.value)}
                                placeholder="Search history…"
                                className="flex-1 bg-transparent text-[12px] text-[var(--text-2)] placeholder:text-[var(--text-4)] outline-none"
                            />
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto px-2 pb-3">
                        {qaConversations.length === 0 ? (
                            <p className="text-center text-[11px] text-[var(--text-4)] py-10">No conversations yet</p>
                        ) : (
                            qaGrouped.map(group => (
                                <div key={group.label} className="mb-1">
                                    <p className="label px-2 py-1.5" style={{ fontSize: '10px' }}>{group.label}</p>
                                    {group.items.map(c => (
                                        <button
                                            key={c.id}
                                            onClick={() => handleLoadQaConversation(c.id)}
                                            className={`group w-full flex items-center gap-1.5 px-2 py-1.5 rounded-[var(--radius)] text-left transition-colors text-[12.5px] leading-snug ${activeQaId === c.id
                                                ? 'bg-white/[0.07] text-[var(--text)]'
                                                : 'text-[var(--text-2)] hover:bg-white/[0.04] hover:text-[var(--text)]'
                                                }`}
                                        >
                                            <span className="flex-1 truncate">{c.title}</span>
                                            <span
                                                onClick={(e) => handleDeleteQaConversation(c.id, e)}
                                                title="Delete"
                                                className="opacity-0 group-hover:opacity-100 flex-shrink-0 p-1 rounded hover:bg-white/10 transition-all"
                                            >
                                                <Trash2 className="w-3 h-3 text-[var(--text-4)] hover:text-[var(--down)]" />
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            ))
                        )}
                    </div>

                    <div className="px-3 py-3 border-t border-[var(--line)]">
                        <Link
                            to="/settings"
                            className="flex items-center gap-2 px-2 py-1.5 rounded-[var(--radius)] text-[12.5px] text-[var(--text-3)] hover:text-[var(--text)] hover:bg-white/[0.04] transition-colors"
                        >
                            <SettingsIcon className="w-3.5 h-3.5" />
                            Settings &amp; help
                        </Link>
                    </div>
                </aside>

                {/* ═══════════════ MAIN ═══════════════ */}
                <div className="flex-1 flex flex-col min-w-0">

                    {/* Top bar — mode toggle + live result metadata */}
                    <div className="border-b border-[var(--line)] px-6 py-2.5 flex items-center gap-3">
                        <ModeToggle mode={mode} onChange={setMode} />
                        {currentQuery && qaState.status === 'complete' && (
                            <div className="ml-auto flex items-center gap-3 text-[11px] text-[var(--text-3)] font-num">
                                {qaState.cacheHit && <span className="flex items-center gap-1 text-[var(--up)]">⚡ Cached</span>}
                                {qaState.latencyMs && (
                                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{qaState.latencyMs}ms</span>
                                )}
                                {qaState.modelUsed && (
                                    <span className="flex items-center gap-1"><Cpu className="w-3 h-3" />{qaState.modelUsed}</span>
                                )}
                                {qaState.confidence > 0 && (
                                    <span className={qaState.confidence > 0.8 ? 'up' : qaState.confidence > 0.6 ? '' : 'down'}>
                                        {Math.round(qaState.confidence * 100)}% conf
                                    </span>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Thread (scrollable) */}
                    <div className="flex-1 overflow-y-auto">
                        <div className="max-w-3xl mx-auto w-full px-6 py-7">

                            {/* Idle hero — premium attract state */}
                            {!hasThread && (
                                <div className="relative pt-4">
                                    <div aria-hidden className="aurora" />
                                    <div className="relative stagger space-y-8 pt-6">
                                        <div className="text-center">
                                            {/* Brand mark with slow glint */}
                                            <div className="flex justify-center mb-5">
                                                <div className="glint chrome w-12 h-12 rounded-[var(--radius-lg)] flex items-center justify-center"
                                                    style={{ background: 'color-mix(in oklch, var(--accent) 18%, var(--surface))', border: '1px solid color-mix(in oklch, var(--accent) 38%, transparent)' }}>
                                                    <Sparkles className="w-5 h-5" style={{ color: 'var(--accent)' }} />
                                                </div>
                                            </div>

                                            <div className="inline-flex items-center gap-2 mb-4 label">
                                                <span className="pulse-dot text-[var(--accent)]">●</span>
                                                <span>Retrieval online · 5 channels</span>
                                            </div>
                                            <h1 className="font-display font-semibold text-[clamp(30px,4.2vw,48px)] leading-[1.02] tracking-[-0.025em] text-[var(--text)]">
                                                Ask anything.<br />
                                                <span className="text-[var(--text-2)]">Every claim cited.</span>
                                            </h1>
                                            <p className="mt-4 text-[13px] text-[var(--text-3)] max-w-[50ch] mx-auto leading-relaxed">
                                                Institutional-grade answers over SEC filings, earnings transcripts, news &amp; broker notes — synthesized across five retrieval channels in real time.
                                            </p>

                                            {/* Capability chips */}
                                            <div className="flex flex-wrap items-center justify-center gap-2 mt-6">
                                                {[
                                                    { icon: Database, text: '5 retrieval channels' },
                                                    { icon: CheckCircle, text: 'Source-verified citations' },
                                                    { icon: Zap, text: 'Sub-second answers' },
                                                ].map(({ icon: Ic, text }) => (
                                                    <span key={text} className="chrome inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] text-[var(--text-2)]"
                                                        style={{ background: 'color-mix(in oklch, var(--surface) 70%, transparent)', border: '1px solid var(--line)' }}>
                                                        <Ic className="w-3 h-3" style={{ color: 'var(--accent)' }} />
                                                        {text}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Example query cards — shiny premium */}
                                        <div>
                                            <p className="label mb-3 text-center" style={{ letterSpacing: '0.14em' }}>Try one of these</p>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                                {QA_EXAMPLES.map((q, i) => (
                                                    <button
                                                        key={q}
                                                        onClick={() => handleQaSubmit(q)}
                                                        className="shiny chrome press group relative text-left rounded-[var(--radius-lg)] border border-[var(--line)] p-3.5 hover:border-[color-mix(in_oklch,var(--accent)_45%,transparent)] transition-colors overflow-hidden"
                                                        style={{ background: 'color-mix(in oklch, var(--surface) 55%, transparent)' }}
                                                    >
                                                        <div className="flex items-start gap-3">
                                                            <span className="font-num text-[10px] text-[var(--text-4)] mt-0.5 tabular-nums flex-shrink-0">
                                                                {String(i + 1).padStart(2, '0')}
                                                            </span>
                                                            <span className="text-[13px] text-[var(--text-2)] group-hover:text-[var(--text)] leading-snug transition-colors">{q}</span>
                                                            <ChevronRight className="w-4 h-4 ml-auto flex-shrink-0 text-[var(--text-4)] group-hover:text-[var(--accent)] group-hover:translate-x-0.5 transition-all" />
                                                        </div>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Committed past turns */}
                            {chatHistory.length > 0 && (
                                <div className="space-y-7 mb-7">
                                    {chatHistory.map((turn, i) => turn.role === 'user' ? (
                                        <div key={i} className="flex justify-end">
                                            <div className="font-display text-[15px] text-[var(--text)] bg-white/[0.04] border border-[var(--line)] px-4 py-2 rounded-[var(--radius-lg)] max-w-[85%]">
                                                {turn.content}
                                            </div>
                                        </div>
                                    ) : (
                                        <div key={i} className="space-y-3">
                                            <AnswerText text={turn.content} citations={turn.citations || []} onCitationOpen={setOpenCitation} />
                                            {(turn.citations?.length ?? 0) > 0 && (
                                                <SourcePills citations={turn.citations!} onOpen={setOpenCitation} />
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Live exchange — current question + streaming/finished answer */}
                            {currentQuery && (
                                <div className="space-y-4 rise-in">
                                    <div className="flex justify-end">
                                        <div className="font-display text-[15px] text-[var(--text)] bg-white/[0.04] border border-[var(--line)] px-4 py-2 rounded-[var(--radius-lg)] max-w-[85%]">
                                            {currentQuery}
                                        </div>
                                    </div>

                                    {/* Stage pipeline + terminal live-log while retrieving */}
                                    {isQaSearching && !displayAnswer && (
                                        <QaSearchProgress
                                            status={qaState.status}
                                            sourcesCount={qaState.sources.length}
                                            citationsCount={qaState.citations.length}
                                            agentSteps={qaState.agentSteps}
                                        />
                                    )}

                                    {(displayAnswer || (!isQaSearching && qaState.sources.length > 0)) && (
                                        <>
                                            {/* Tabs */}
                                            <div className="flex gap-1 border-b border-[var(--line)]">
                                                {([
                                                    { key: 'answer', label: 'Answer', icon: Zap },
                                                    { key: 'sources', label: `Sources (${qaState.sources.length})`, icon: FileText },
                                                    { key: 'data', label: `Data${dataCount}`, icon: Database },
                                                ] as const).map(({ key, label, icon: Icon }) => (
                                                    <button
                                                        key={key}
                                                        onClick={() => setActiveTab(key)}
                                                        className={`flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium border-b-2 -mb-px transition-colors ${activeTab === key
                                                            ? 'border-[var(--accent)] text-[var(--accent)]'
                                                            : 'border-transparent text-[var(--text-3)] hover:text-[var(--text)]'
                                                            }`}
                                                    >
                                                        <Icon className="w-3.5 h-3.5" />
                                                        {label}
                                                    </button>
                                                ))}
                                            </div>

                                            {/* Answer tab */}
                                            {activeTab === 'answer' && (
                                                <div className="space-y-5">
                                                    <AgentTracePanel
                                                        steps={qaState.agentSteps}
                                                        complete={qaState.agentTraceComplete}
                                                        totalIterations={qaState.totalIterations}
                                                        totalCostUsd={qaState.totalCostUsd}
                                                    />

                                                    {displayAnswer
                                                        ? <div className="sheen-once chrome rounded-[var(--radius-lg)] border border-[var(--line)] p-5"
                                                               style={{ background: 'color-mix(in oklch, var(--surface) 42%, transparent)' }}>
                                                            <AnswerText text={displayAnswer} citations={qaState.citations} onCitationOpen={setOpenCitation} />
                                                            {isQaSearching && <span className="stream-caret" />}
                                                          </div>
                                                        : <div className="flex items-center gap-2 text-[13px] text-[var(--text-2)] py-2">
                                                            <span className="w-3 h-3 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
                                                            Generating answer…
                                                        </div>
                                                    }

                                                    {qaState.citations.length > 0 && (
                                                        <SourcePills citations={qaState.citations} onOpen={setOpenCitation} />
                                                    )}

                                                    {qaState.followUpQueries.length > 0 && (
                                                        <div className="pt-1">
                                                            <p className="label mb-2">Follow-up</p>
                                                            <div className="flex flex-col">
                                                                {qaState.followUpQueries.map(q => (
                                                                    <button
                                                                        key={q}
                                                                        onClick={() => handleQaSubmit(q)}
                                                                        className="row-hot text-left text-[13px] text-[var(--text-2)] hover:text-[var(--accent)] flex items-center gap-2 group py-1.5 px-2 -mx-2 rounded-[var(--radius)] transition-colors"
                                                                    >
                                                                        <ChevronRight className="w-4 h-4 text-[var(--text-4)] group-hover:text-[var(--accent)] flex-shrink-0" />
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
                                                        ? <p className="text-[13px] text-[var(--text-3)] text-center py-8">No sources retrieved yet</p>
                                                        : qaState.sources.map((s, i) => <SourceCard key={s.chunk_id} source={s} index={i} />)
                                                    }
                                                </div>
                                            )}

                                            {/* Data tab */}
                                            {activeTab === 'data' && (
                                                <div className="space-y-4">
                                                    {qaState.chartSpecs.length === 0 && qaState.structuredData.length === 0 && (
                                                        <p className="text-[13px] text-[var(--text-3)] text-center py-8">No structured financial data for this query</p>
                                                    )}
                                                    {qaState.chartSpecs.length > 0 && (
                                                        <div className="space-y-4">
                                                            {qaState.chartSpecs.map(spec => (
                                                                <DataChart key={spec.chart_id} spec={spec} structuredData={qaState.structuredData} />
                                                            ))}
                                                        </div>
                                                    )}
                                                    {qaState.structuredData.length > 0 && (
                                                        <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--line)]">
                                                            <table className="w-full text-[12.5px]">
                                                                <thead>
                                                                    <tr className="border-b border-[var(--line)] bg-white/[0.02]">
                                                                        {['Entity', 'Metric', 'Value', 'Period'].map(h => (
                                                                            <th key={h} className="label px-4 py-2.5 text-left">{h}</th>
                                                                        ))}
                                                                    </tr>
                                                                </thead>
                                                                <tbody className="divide-y divide-[var(--line)]">
                                                                    {qaState.structuredData.map((m, i) => (
                                                                        <tr key={i} className="row-hot">
                                                                            <td className="px-4 py-2.5">
                                                                                {(m.entity || m.ticker) && (
                                                                                    <span className="font-num text-[11px] text-[var(--accent)] bg-[var(--accent)]/10 px-1.5 py-0.5 rounded">
                                                                                        {m.entity ?? m.ticker}
                                                                                    </span>
                                                                                )}
                                                                            </td>
                                                                            <td className="px-4 py-2.5 text-[var(--text-2)]">{m.metric}</td>
                                                                            <td className="px-4 py-2.5 font-num text-[var(--text)]">
                                                                                {typeof m.value === 'number' ? m.value.toLocaleString() : m.value}
                                                                                {m.unit && <span className="ml-1 text-[11px] text-[var(--text-3)]">{m.unit}</span>}
                                                                            </td>
                                                                            <td className="px-4 py-2.5 text-[var(--text-3)] font-num">{m.period ?? '—'}</td>
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

                                    {/* Error — only when no answer streamed */}
                                    {qaState.status === 'error' && !displayAnswer && (
                                        <div className="rounded-[var(--radius)] border border-[var(--down)]/25 bg-[var(--down)]/[0.06] p-4 text-[13px] text-[var(--down)]">
                                            {qaState.error ?? 'Search failed. Make sure the Gravity backend is running on port 8000.'}
                                        </div>
                                    )}
                                </div>
                            )}

                            <div ref={threadEndRef} />
                        </div>
                    </div>

                    {/* Composer (sticky bottom) */}
                    <div className="border-t border-[var(--line)] bg-[var(--bg)] px-6 py-3">
                        <div className="max-w-3xl mx-auto w-full">
                            <form
                                onSubmit={e => { e.preventDefault(); handleQaSubmit(qaInput); }}
                                className="flex gap-2.5 items-center"
                            >
                                <div className="flex-1 relative input-halo rounded-[var(--radius-lg)] border border-[var(--line)]" style={{ background: 'color-mix(in oklch, var(--surface) 60%, transparent)' }}>
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-3)]" />
                                    <input
                                        ref={qaInputRef}
                                        value={qaInput}
                                        onChange={e => setQaInput(e.target.value)}
                                        placeholder={hasThread ? 'Ask a follow-up…' : 'Ask anything about any company, filing, or market trend…'}
                                        className="w-full pl-10 pr-4 py-2.5 bg-transparent border-0 rounded-[var(--radius-lg)] text-[13.5px] text-[var(--text)] placeholder:text-[var(--text-4)] focus:outline-none"
                                    />
                                </div>
                                {isQaSearching ? (
                                    <button
                                        type="button"
                                        onClick={qaCancel}
                                        className="press px-4 py-2.5 rounded-[var(--radius-lg)] border border-[var(--down)]/30 text-[var(--down)] text-[13px] hover:bg-[var(--down)]/10 transition-colors"
                                    >
                                        Cancel
                                    </button>
                                ) : (
                                    <button
                                        type="submit"
                                        disabled={!qaInput.trim()}
                                        className="press cta-glow shiny glint px-5 py-2.5 rounded-[var(--radius-lg)] bg-[var(--accent)] text-[var(--accent-ink)] text-[13px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none transition-all flex items-center gap-1.5"
                                    >
                                        <Zap className="w-4 h-4" /> Ask
                                    </button>
                                )}
                            </form>

                            <div className="flex items-center justify-between mt-2 gap-2">
                                <SourceFilterBar active={activeSource} onChange={id => setActiveSource(id)} />
                                {qaInput.trim() && (
                                    <button
                                        onClick={() => handleSaveSearch(qaInput)}
                                        title={savedSearches.has(qaInput) ? 'Search saved' : 'Save search'}
                                        className="press flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius)] text-[11px] border border-[var(--line)] text-[var(--text-3)] hover:text-[var(--text-2)] hover:border-[var(--line-strong)] transition-all flex-shrink-0"
                                    >
                                        {savedSearches.has(qaInput)
                                            ? <><BookmarkCheck className="w-3.5 h-3.5 text-[var(--accent)]" /> Saved</>
                                            : <><Bookmark className="w-3.5 h-3.5" /> Save</>
                                        }
                                    </button>
                                )}
                            </div>

                            {activeSource === 'filings' && (
                                <FilingTypeSelector
                                    types={filingTypes}
                                    selected={selectedFilingTypes}
                                    onToggle={toggleFilingType}
                                />
                            )}
                        </div>
                    </div>
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
                        <div className="relative flex flex-col items-center justify-center h-full min-h-[420px] px-8 text-center overflow-hidden">
                            <div
                                aria-hidden
                                className="pointer-events-none absolute inset-0"
                                style={{
                                    background: 'radial-gradient(55% 55% at 50% 42%, color-mix(in oklch, var(--accent) 9%, transparent) 0%, transparent 70%)',
                                }}
                            />
                            <div
                                aria-hidden
                                className="pointer-events-none absolute inset-0 opacity-[0.35]"
                                style={{
                                    backgroundImage:
                                        'linear-gradient(var(--line) 1px, transparent 1px), linear-gradient(90deg, var(--line) 1px, transparent 1px)',
                                    backgroundSize: '56px 56px',
                                    maskImage: 'radial-gradient(ellipse 50% 45% at 50% 42%, black 0%, transparent 75%)',
                                    WebkitMaskImage: 'radial-gradient(ellipse 50% 45% at 50% 42%, black 0%, transparent 75%)',
                                }}
                            />
                            <div className="stagger relative">
                                <div className="inline-flex items-center gap-2 mb-6 text-[10px] font-mono uppercase tracking-[0.28em] text-[var(--text-3)]">
                                    <span className="pulse-dot text-[var(--accent)]">●</span>
                                    <span>Deep research instrument</span>
                                </div>
                                <h2 className="font-display font-medium text-[clamp(36px,5vw,56px)] leading-[0.98] tracking-[-0.022em] text-[var(--text)] mb-4">
                                    A report, not a reply.
                                </h2>
                                <p className="text-[13px] text-[var(--text-3)] max-w-[48ch] mx-auto mb-10 leading-relaxed">
                                    Multi-agent synthesis across live web, SEC filings &amp; market data — cited, structured, ready to share.
                                </p>
                                <div className="flex flex-wrap justify-center gap-2 max-w-2xl">
                                    {RESEARCH_EXAMPLES.map((s) => (
                                        <button
                                            key={s}
                                            onClick={() => { setResearchInput(s); setTimeout(() => textareaRef.current?.focus(), 50); }}
                                            className="px-4 py-2 rounded-full text-[13px] text-[var(--text-2)] border border-white/[0.07] bg-white/[0.015] hover:text-white hover:border-[var(--accent)]/35 hover:bg-white/[0.04] transition-all"
                                        >
                                            {s}
                                        </button>
                                    ))}
                                </div>
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

                                    {/* Review-plan toggle (HITL) */}
                                    <button
                                        type="button"
                                        onClick={() => setReviewPlan(v => !v)}
                                        title={reviewPlan
                                            ? 'Plan review ON — you\'ll edit queries, SEC targets, metrics, and angles before retrieval fires.'
                                            : 'Plan review OFF — research runs end-to-end without interruption.'}
                                        className={`flex items-center gap-1.5 h-8 px-3 rounded-full text-[12px] transition-colors font-medium ${reviewPlan
                                            ? 'text-pink-200 bg-pink-500/15 hover:bg-pink-500/25'
                                            : 'text-white/60 hover:bg-white/10'}`}
                                    >
                                        <Edit3 className="w-3.5 h-3.5" />
                                        Review plan
                                        {reviewPlan && <span className="ml-0.5 w-1.5 h-1.5 rounded-full bg-pink-400" />}
                                    </button>
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
