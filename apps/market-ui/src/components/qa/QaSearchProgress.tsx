// Quick-Answer search progress — stage pipeline + terminal live-log.
// Mirrors the Deep Research loading state but is driven by the live WebSocket
// retrieval pipeline (understanding → retrieve → rerank → generate) and the
// agentic trace when the agentic engine is running. Themed with project tokens.

import { useState, useEffect, useRef } from 'react';
import {
    Brain, Layers, ListFilter, PenLine,
    CheckCircle2, Loader2, Sparkles, Zap,
} from 'lucide-react';
import type { SearchStatus, AgentTraceStep } from '../../hooks/useGravitySearch';

interface Props {
    status: SearchStatus;
    sourcesCount: number;
    citationsCount: number;
    agentSteps: AgentTraceStep[];
}

const STAGES = [
    { key: 'understanding', Icon: Brain,      label: 'Understand', desc: 'Query intent' },
    { key: 'searching',     Icon: Layers,     label: 'Retrieve',   desc: '5 channels'   },
    { key: 'reranking',     Icon: ListFilter, label: 'Rerank',     desc: 'Cross-encoder' },
    { key: 'reasoning',     Icon: PenLine,    label: 'Generate',   desc: 'Cited answer' },
] as const;

// WS status → stage index (validating folds into Generate; complete = past last)
const STATUS_STAGE: Record<string, number> = {
    idle: -1, understanding: 0, searching: 1, reranking: 2,
    reasoning: 3, validating: 3, complete: 4, error: -1,
};

const STATUS_PCT: Record<string, number> = {
    understanding: 15, searching: 45, reranking: 65,
    reasoning: 85, validating: 93, complete: 100,
};

// Scripted lines per stage — the texture between real events.
const LOG_LINES: { stage: number; msg: string }[] = [
    { stage: 0, msg: 'Parsing query · detecting intent…' },
    { stage: 0, msg: 'Expanding tickers and named entities…' },
    { stage: 1, msg: 'Dense vector search · Qdrant + voyage-finance-2…' },
    { stage: 1, msg: 'Sparse BM25 keyword search · Elasticsearch…' },
    { stage: 1, msg: 'SPLADE learned-sparse retrieval…' },
    { stage: 1, msg: 'Knowledge-graph traversal · Neo4j…' },
    { stage: 2, msg: 'Reciprocal-rank fusion across channels…' },
    { stage: 2, msg: 'Cross-encoder rerank · Cohere rerank-v3.5…' },
    { stage: 3, msg: 'Routing to optimal model…' },
    { stage: 3, msg: 'Synthesizing cited answer…' },
    { stage: 3, msg: 'Validating citations against sources…' },
];

const STAGE_COLORS = ['var(--accent)', 'var(--accent)', 'oklch(0.785 0.170 72)', 'var(--up)'];

export default function QaSearchProgress({ status, sourcesCount, citationsCount, agentSteps }: Props) {
    const [visibleLogs, setVisibleLogs] = useState(0);
    const [dots, setDots] = useState('');
    const logRef = useRef<HTMLDivElement>(null);

    const stageIdx = STATUS_STAGE[status] ?? -1;
    const pct = STATUS_PCT[status] ?? 0;

    // Reveal scripted lines up to the current stage.
    useEffect(() => {
        const t = setInterval(() => {
            setVisibleLogs(prev => {
                const max = LOG_LINES.filter(l => l.stage <= stageIdx).length;
                return Math.min(prev + 1, max);
            });
        }, 650);
        return () => clearInterval(t);
    }, [stageIdx]);

    useEffect(() => {
        const t = setInterval(() => setDots(d => (d.length >= 3 ? '' : d + '.')), 420);
        return () => clearInterval(t);
    }, []);

    useEffect(() => {
        logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
    }, [visibleLogs, agentSteps.length]);

    const scripted = LOG_LINES.slice(0, visibleLogs);
    // Real agentic-trace lines appended live (only present in agentic mode).
    const agentLines = agentSteps.map(s => ({
        stage: 3,
        msg: `${s.agent}: ${s.action}${s.detail ? ` — ${s.detail}` : ''}`,
        agent: true,
    }));
    const lines = [...scripted.map(l => ({ ...l, agent: false })), ...agentLines];

    const headerMsg =
        status === 'understanding' ? 'Understanding your question'
        : status === 'searching'   ? 'Retrieving across 5 channels'
        : status === 'reranking'   ? 'Reranking the best evidence'
        : status === 'reasoning'   ? 'Generating a cited answer'
        : status === 'validating'  ? 'Verifying every citation'
        : 'Working';

    return (
        <div className="rise-in">
            {/* ── Header ── */}
            <div className="flex items-center gap-3 mb-6">
                <div className="relative flex-shrink-0">
                    <div className="absolute inset-0 rounded-full animate-ping opacity-20"
                        style={{ background: 'var(--accent)', animationDuration: '2s' }} />
                    <div className="w-10 h-10 rounded-full flex items-center justify-center relative"
                        style={{ background: 'color-mix(in oklch, var(--accent) 22%, var(--surface))', border: '1px solid color-mix(in oklch, var(--accent) 40%, transparent)' }}>
                        <Sparkles className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                    </div>
                    <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full flex items-center justify-center" style={{ background: 'var(--bg)' }}>
                        <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--up)' }} />
                    </div>
                </div>
                <div className="min-w-0">
                    <h3 className="font-display text-[15px] font-semibold text-[var(--text)]">Quick Answer{dots}</h3>
                    <p className="text-[12px] text-[var(--text-3)] mt-0.5">{headerMsg}</p>
                </div>
                {sourcesCount > 0 && (
                    <div className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-full font-num"
                        style={{ background: 'color-mix(in oklch, var(--accent) 10%, transparent)', border: '1px solid color-mix(in oklch, var(--accent) 22%, transparent)' }}>
                        <Layers className="w-3 h-3" style={{ color: 'var(--accent)' }} />
                        <span className="text-[11px] font-semibold tabular-nums" style={{ color: 'var(--accent)' }}>{sourcesCount} sources</span>
                    </div>
                )}
            </div>

            {/* ── Stage pipeline ── */}
            <div className="flex items-start mb-6">
                {STAGES.map((stage, i) => {
                    const isComplete = i < stageIdx;
                    const isCurrent = i === stageIdx;
                    const { Icon } = stage;
                    const c = STAGE_COLORS[i];
                    return (
                        <div key={stage.key} className="flex items-center flex-1">
                            <div className="flex flex-col items-center flex-1">
                                <div className="w-9 h-9 rounded-full flex items-center justify-center mb-2 transition-all duration-700"
                                    style={{
                                        background: isComplete ? 'color-mix(in oklch, var(--up) 15%, transparent)'
                                            : isCurrent ? `color-mix(in oklch, ${c} 16%, transparent)` : 'rgba(255,255,255,0.03)',
                                        border: isComplete ? '1px solid color-mix(in oklch, var(--up) 35%, transparent)'
                                            : isCurrent ? `1px solid color-mix(in oklch, ${c} 45%, transparent)` : '1px solid var(--line)',
                                        boxShadow: isCurrent ? `0 0 16px color-mix(in oklch, ${c} 28%, transparent)` : 'none',
                                    }}>
                                    {isComplete && <CheckCircle2 className="w-4 h-4" style={{ color: 'var(--up)' }} />}
                                    {isCurrent && <Loader2 className="w-4 h-4 animate-spin" style={{ color: c }} />}
                                    {!isComplete && !isCurrent && <Icon className="w-4 h-4" style={{ color: 'var(--text-4)' }} />}
                                </div>
                                <span className="font-display text-[11px] font-semibold text-center leading-tight"
                                    style={{ color: isComplete ? 'var(--up)' : isCurrent ? c : 'var(--text-4)' }}>
                                    {stage.label}
                                </span>
                                <span className="text-[10px] text-center mt-0.5 leading-tight"
                                    style={{ color: isCurrent ? 'var(--text-3)' : 'var(--text-4)' }}>
                                    {stage.desc}
                                </span>
                            </div>
                            {i < STAGES.length - 1 && (
                                <div className="h-px w-8 flex-shrink-0 mb-8 relative overflow-hidden rounded-full" style={{ background: 'var(--line)' }}>
                                    {isComplete && <div className="absolute inset-0" style={{ background: 'color-mix(in oklch, var(--up) 40%, transparent)' }} />}
                                    {isCurrent && <div className="absolute inset-0 animate-pulse" style={{ background: `color-mix(in oklch, ${c} 50%, transparent)` }} />}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* ── Terminal live-log ── */}
            <div className="rounded-[var(--radius-lg)] overflow-hidden border border-[var(--line)]" style={{ background: 'color-mix(in oklch, var(--bg) 70%, black)' }}>
                <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-[var(--line)]">
                    <div className="flex gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#FF5F57' }} />
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#FFBD2E' }} />
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#28C840' }} />
                    </div>
                    <div className="flex-1 flex items-center justify-center gap-2">
                        <Zap className="w-3 h-3 text-[var(--text-4)]" />
                        <span className="text-[11px] font-num text-[var(--text-3)]">retrieval-engine · live log</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--up)' }} />
                        <span className="text-[10px] font-num up">LIVE</span>
                    </div>
                </div>

                <div ref={logRef} className="p-3.5 font-num space-y-1.5 min-h-[180px] max-h-[280px] overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
                    {lines.map((line, i) => {
                        const isLatest = i === lines.length - 1;
                        const c = STAGE_COLORS[line.stage] ?? 'var(--accent)';
                        const ts = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
                        return (
                            <div key={i} className={`flex items-start gap-3 text-[11.5px] transition-opacity duration-500 ${isLatest ? 'opacity-100' : 'opacity-55'}`}>
                                <span className="flex-shrink-0 tabular-nums text-[var(--text-4)]">{ts}</span>
                                <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[9.5px] font-bold uppercase tracking-wide"
                                    style={{ background: `color-mix(in oklch, ${c} 14%, transparent)`, color: c }}>
                                    {(line as { agent?: boolean }).agent ? 'AGENT' : STAGES[line.stage]?.label ?? 'LOG'}
                                </span>
                                <span style={{ color: isLatest ? 'var(--text)' : 'var(--text-3)' }}>
                                    {line.msg}
                                    {isLatest && <span className="inline-block w-1.5 h-3.5 ml-1 align-text-bottom animate-pulse rounded-sm" style={{ background: c }} />}
                                </span>
                            </div>
                        );
                    })}
                </div>

                <div className="px-3.5 pb-3.5 pt-2 border-t border-[var(--line)]">
                    <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[11px] font-num text-[var(--text-3)]">
                            {citationsCount > 0 ? `${citationsCount} citations verified` : headerMsg}
                        </span>
                        <span className="text-[12px] font-num font-bold tabular-nums" style={{ color: 'var(--accent)' }}>{pct}%</span>
                    </div>
                    <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                        <div className="h-full rounded-full transition-all duration-700 ease-out"
                            style={{ width: `${pct}%`, background: 'linear-gradient(90deg, var(--accent), oklch(0.785 0.170 72), var(--up))' }} />
                    </div>
                </div>
            </div>
        </div>
    );
}
