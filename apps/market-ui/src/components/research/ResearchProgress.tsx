// Premium Research Progress — World-Class Loading State
// Terminal-style live log · Animated stage pipeline · Source counter

import { useState, useEffect } from 'react';
import {
    Brain, Globe, FileSearch, Pen,
    CheckCircle2, Loader2, Sparkles, Zap,
} from 'lucide-react';
import type { ResearchProgress as ProgressType } from '../../services/deepResearchService';

interface Props {
    progress: ProgressType;
}

const STAGES = [
    { key: 'planning',     Icon: Brain,       label: 'Planning',     desc: 'Research strategy' },
    { key: 'searching',    Icon: Globe,        label: 'Searching',    desc: 'Web & databases'   },
    { key: 'analyzing',    Icon: FileSearch,   label: 'Analyzing',    desc: 'Documents & filings' },
    { key: 'synthesizing', Icon: Pen,          label: 'Writing',      desc: 'Generating report'  },
] as const;

const LOG_LINES = [
    { stage: 0, msg: 'Parsing research query...' },
    { stage: 0, msg: 'Identifying key subtopics and angles...' },
    { stage: 0, msg: 'Generating targeted search queries...' },
    { stage: 1, msg: 'Dispatching web search requests...' },
    { stage: 1, msg: 'Crawling financial news sources...' },
    { stage: 1, msg: 'Extracting relevant content chunks...' },
    { stage: 1, msg: 'Deduplicating and ranking sources...' },
    { stage: 2, msg: 'Scanning SEC EDGAR filings...' },
    { stage: 2, msg: 'Cross-referencing earnings reports...' },
    { stage: 2, msg: 'Extracting market data signals...' },
    { stage: 2, msg: 'Building knowledge graph...' },
    { stage: 3, msg: 'Synthesizing findings into narrative...' },
    { stage: 3, msg: 'Applying citations and references...' },
    { stage: 3, msg: 'Formatting comprehensive report...' },
];

export default function ResearchProgress({ progress }: Props) {
    const [visibleLogs, setVisibleLogs] = useState<number>(0);
    const [dots, setDots] = useState('');

    const currentStageIdx = STAGES.findIndex(s => s.key === progress.stage);

    /* Reveal log lines progressively */
    useEffect(() => {
        const interval = setInterval(() => {
            setVisibleLogs(prev => {
                const max = LOG_LINES.filter(l => l.stage <= currentStageIdx).length;
                return Math.min(prev + 1, max);
            });
        }, 1200);
        return () => clearInterval(interval);
    }, [currentStageIdx]);

    /* Animated ellipsis */
    useEffect(() => {
        const t = setInterval(() => {
            setDots(d => d.length >= 3 ? '' : d + '.');
        }, 420);
        return () => clearInterval(t);
    }, []);


    const stageLines = LOG_LINES.slice(0, visibleLogs);

    return (
        <div className="max-w-[680px] mx-auto py-12 px-4">

            {/* ── Header ── */}
            <div className="flex items-center gap-4 mb-10">
                <div className="relative flex-shrink-0">
                    {/* Animated glow ring */}
                    <div className="absolute inset-0 rounded-full animate-ping opacity-20"
                        style={{ background: 'linear-gradient(135deg, #3D7FF6, #7C3AED)', animationDuration: '2s' }} />
                    <div className="w-12 h-12 rounded-full flex items-center justify-center relative"
                        style={{ background: 'linear-gradient(135deg, #1E3A8A, #3D7FF6)' }}>
                        <Sparkles className="w-5 h-5 text-white" />
                    </div>
                    {/* Live indicator */}
                    <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center"
                        style={{ background: '#070A12' }}>
                        <div className="w-2.5 h-2.5 rounded-full animate-pulse"
                            style={{ background: '#10B981' }} />
                    </div>
                </div>
                <div>
                    <h3 className="text-[17px] font-bold" style={{ color: '#F0F2F5' }}>
                        Deep Research{dots}
                    </h3>
                    <p className="text-[13px] mt-0.5" style={{ color: '#3D4861' }}>
                        {progress.message}
                    </p>
                </div>

                {/* Source counter */}
                {progress.sourcesFound !== undefined && progress.sourcesFound > 0 && (
                    <div className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-full"
                        style={{ background: 'rgba(61,127,246,0.1)', border: '1px solid rgba(61,127,246,0.2)' }}>
                        <Globe className="w-3.5 h-3.5" style={{ color: '#3D7FF6' }} />
                        <span className="text-[12px] font-mono font-bold tabular-nums" style={{ color: '#3D7FF6' }}>
                            {progress.sourcesFound} sources
                        </span>
                    </div>
                )}
            </div>

            {/* ── Stage pipeline ── */}
            <div className="flex items-start gap-0 mb-8">
                {STAGES.map((stage, i) => {
                    const isComplete = i < currentStageIdx;
                    const isCurrent  = i === currentStageIdx;
                    const isPending  = i > currentStageIdx;
                    const { Icon }   = stage;

                    return (
                        <div key={stage.key} className="flex items-center flex-1">
                            {/* Stage node */}
                            <div className="flex flex-col items-center flex-1">
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center mb-2.5 transition-all duration-700`}
                                    style={{
                                        background: isComplete
                                            ? 'rgba(16,185,129,0.15)'
                                            : isCurrent
                                                ? 'rgba(61,127,246,0.15)'
                                                : 'rgba(255,255,255,0.03)',
                                        border: isComplete
                                            ? '1px solid rgba(16,185,129,0.3)'
                                            : isCurrent
                                                ? '1px solid rgba(61,127,246,0.4)'
                                                : '1px solid rgba(255,255,255,0.06)',
                                        boxShadow: isCurrent
                                            ? '0 0 16px rgba(61,127,246,0.25)'
                                            : 'none',
                                    }}>
                                    {isComplete && <CheckCircle2 className="w-4 h-4" style={{ color: '#10B981' }} />}
                                    {isCurrent  && <Loader2     className="w-4 h-4 animate-spin" style={{ color: '#3D7FF6' }} />}
                                    {isPending  && <Icon        className="w-4 h-4" style={{ color: '#2A3248' }} />}
                                </div>

                                <span className="text-[11px] font-semibold text-center leading-tight"
                                    style={{ color: isComplete ? '#10B981' : isCurrent ? '#3D7FF6' : '#2A3248' }}>
                                    {stage.label}
                                </span>
                                <span className="text-[10px] text-center mt-0.5 leading-tight"
                                    style={{ color: isCurrent ? '#3D4861' : '#1E2740' }}>
                                    {stage.desc}
                                </span>
                            </div>

                            {/* Connector line */}
                            {i < STAGES.length - 1 && (
                                <div className="h-[1px] w-8 flex-shrink-0 mb-8 relative overflow-hidden rounded-full"
                                    style={{ background: 'rgba(255,255,255,0.05)' }}>
                                    {isComplete && (
                                        <div className="absolute inset-0 rounded-full"
                                            style={{ background: 'rgba(16,185,129,0.4)' }} />
                                    )}
                                    {isCurrent && (
                                        <div className="absolute inset-0 rounded-full animate-pulse"
                                            style={{ background: 'rgba(61,127,246,0.5)' }} />
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* ── Terminal log ── */}
            <div className="rounded-2xl overflow-hidden"
                style={{
                    background: '#0A0D18',
                    border: '1px solid rgba(255,255,255,0.06)',
                }}>
                {/* Terminal top bar */}
                <div className="flex items-center gap-2 px-4 py-3 border-b"
                    style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                    <div className="flex gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#FF5F57' }} />
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#FFBD2E' }} />
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#28C840' }} />
                    </div>
                    <div className="flex-1 flex items-center justify-center gap-2">
                        <Zap className="w-3 h-3" style={{ color: '#3D4861' }} />
                        <span className="text-[11px] font-mono" style={{ color: '#3D4861' }}>
                            research-engine · live log
                        </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#10B981' }} />
                        <span className="text-[10px] font-mono" style={{ color: '#10B981' }}>LIVE</span>
                    </div>
                </div>

                {/* Log lines */}
                <div className="p-4 font-mono space-y-1.5 min-h-[220px] max-h-[320px] overflow-y-auto"
                    style={{ scrollbarWidth: 'none' }}>
                    {stageLines.map((line, i) => {
                        const isLatest = i === stageLines.length - 1;
                        const stageColors = ['#3D7FF6', '#A78BFA', '#F59E0B', '#10B981'];
                        const stageColor = stageColors[line.stage] || '#3D7FF6';
                        const ts = new Date().toLocaleTimeString('en-US', {
                            hour12: false,
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                        });

                        return (
                            <div key={i}
                                className={`flex items-start gap-3 text-[12px] transition-all duration-500 ${isLatest ? 'opacity-100' : 'opacity-50'}`}>
                                {/* Timestamp */}
                                <span className="flex-shrink-0 tabular-nums" style={{ color: '#2A3248' }}>
                                    {ts}
                                </span>
                                {/* Stage tag */}
                                <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase"
                                    style={{ background: `${stageColor}15`, color: stageColor }}>
                                    {STAGES[line.stage]?.label}
                                </span>
                                {/* Message */}
                                <span style={{ color: isLatest ? '#E8EDF5' : '#3D4861' }}>
                                    {line.msg}
                                    {isLatest && (
                                        <span className="inline-block w-1.5 h-3.5 ml-1 align-text-bottom animate-pulse rounded-sm"
                                            style={{ background: stageColor }} />
                                    )}
                                </span>
                            </div>
                        );
                    })}
                </div>

                {/* Progress bar */}
                <div className="px-4 pb-4 pt-2 border-t" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-mono" style={{ color: '#3D4861' }}>
                            {progress.message}
                        </span>
                        <span className="text-[12px] font-mono font-bold tabular-nums" style={{ color: '#3D7FF6' }}>
                            {progress.progress}%
                        </span>
                    </div>
                    <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
                        <div
                            className="h-full rounded-full transition-all duration-700 ease-out"
                            style={{
                                width: `${progress.progress}%`,
                                background: 'linear-gradient(90deg, #3D7FF6, #7C3AED, #EC4899)',
                            }}
                        />
                    </div>
                </div>
            </div>

            {/* ── Hint text ── */}
            <p className="text-center text-[12px] mt-6" style={{ color: '#1E2740' }}>
                AI is reading and cross-referencing {progress.sourcesFound ?? '...'} sources in real time
            </p>
        </div>
    );
}
