// Grid Research View — Hebbia Matrix / AlphaSense Generative Grid analogue.
// Rows=tickers × Columns=analyst prompts. Each cell is an independent
// cancellable LLM call with per-cell status.

import { useState, useRef, useEffect, Children, type ReactNode } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Play, X, Grid as GridIcon, Sparkles, Loader2, Check, AlertCircle, Download, Clock, Trash2, Copy, Check as CheckIcon, ExternalLink } from 'lucide-react';
import type { Citation } from '../../services/deepResearchService';
import {
    initializeGrid,
    runGrid,
    runGridCell,
    updateCell,
    toCSV,
    SEED_GRID_PROMPTS,
    cellKey,
    resolvePrompt,
    type GridDef,
    type GridState,
    type GridCell,
    type CellRunnerDeps,
} from '../../services/gridResearch';
import { queryGravityRAG } from '../../services/gravitySearchService';
import { saveGridRun, loadLatestGridRun, listGridRuns, loadGridRun, deleteGridRun, type SavedGridRow } from '../../services/gridStore';
import { exportGridToXLSX, downloadBlob } from '../../services/gridExcel';

const LLM_PROXY_URL = `${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/llm/chat`;

const MODEL_CONFIG: Record<string, { provider: string; model: string }> = {
    deepseek: { provider: 'deepseek', model: 'deepseek-chat' },
    claude: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    gemini: { provider: 'gemini', model: 'gemini-2.5-flash' },
};

async function callLLMProxy(prompt: string, modelKey: 'deepseek' | 'claude' | 'gemini', signal?: AbortSignal): Promise<{ text: string; model: any }> {
    const config = MODEL_CONFIG[modelKey];
    const res = await fetch(LLM_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...config, prompt, max_tokens: 2048 }),
        signal,
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `LLM proxy failed (${res.status})`);
    }
    const data = await res.json();
    return { text: data.text ?? '', model: data.model ?? config.model };
}

async function searchGravityCell(query: string, ticker: string, signal?: AbortSignal) {
    return queryGravityRAG(query, { companies: [ticker] });
}

const DEFAULT_TICKERS = ['NVDA', 'AAPL', 'MSFT', 'GOOGL'];

export default function GridView() {
    const [tickersInput, setTickersInput] = useState(DEFAULT_TICKERS.join(', '));
    const [promptIds, setPromptIds] = useState<string[]>(SEED_GRID_PROMPTS.map(p => p.id));
    const [state, setState] = useState<GridState | null>(null);
    const [running, setRunning] = useState(false);
    const [selectedCell, setSelectedCell] = useState<GridCell | null>(null);
    const [editingCell, setEditingCell] = useState<{ ticker: string; promptId: string } | null>(null);
    const [editPrompt, setEditPrompt] = useState<string>("");
    const [history, setHistory] = useState<SavedGridRow[]>([]);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [selectedModel, setSelectedModel] = useState<'deepseek' | 'claude' | 'gemini'>('deepseek');
    const [sortBy, setSortBy] = useState<'ticker' | 'status' | 'duration' | null>(null);
    const [sortDesc, setSortDesc] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [copiedCell, setCopiedCell] = useState<string | null>(null);
    const [burst, setBurst] = useState(false);
    const [activeCitation, setActiveCitation] = useState<number | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const searchInputRef = useRef<HTMLInputElement | null>(null);

    // Click an inline [N] citation → reveal & highlight that source below.
    const openCitation = (id: number) => {
        setActiveCitation(id);
        requestAnimationFrame(() => {
            document.getElementById(`grid-src-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
        window.setTimeout(() => setActiveCitation(cur => (cur === id ? null : cur)), 2200);
    };

    const copyCell = async (ticker: string, promptId: string, answer: string) => {
        await navigator.clipboard.writeText(answer);
        setCopiedCell(`${ticker}::${promptId}`);
        setTimeout(() => setCopiedCell(null), 2000);
    };

    const refreshHistory = async () => {
        const rows = await listGridRuns(20).catch(() => []);
        setHistory(rows);
    };

    // Restore last run on mount (best-effort; silent on failure/signed-out)
    useEffect(() => {
        let cancelled = false;
        loadLatestGridRun()
            .then(last => {
                if (cancelled || !last) return;
                setState(last);
                setTickersInput(last.def.tickers.join(', '));
                setPromptIds(last.def.prompts.map(p => p.id));
            })
            .catch(() => { /* ignore */ });
        refreshHistory();
        return () => { cancelled = true; };
    }, []);

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Escape: close modals
            if (e.key === 'Escape') {
                setSelectedCell(null);
                setEditingCell(null);
            }

            // E: edit selected cell
            if (e.key === 'e' && e.ctrlKey === false && e.metaKey === false && selectedCell?.status === 'done') {
                const prompt = state?.def.prompts.find(p => p.id === selectedCell.promptId);
                if (prompt) {
                    const resolved = resolvePrompt(prompt, selectedCell.ticker);
                    setEditPrompt(resolved);
                    setEditingCell({ ticker: selectedCell.ticker, promptId: selectedCell.promptId });
                    setSelectedCell(null);
                }
            }

            // Arrow keys: navigate between cells
            if (selectedCell && state && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                e.preventDefault();
                const tickers = state.def.tickers;
                const prompts = state.def.prompts;
                const tickerIdx = tickers.indexOf(selectedCell.ticker);
                const promptIdx = prompts.findIndex(p => p.id === selectedCell.promptId);

                let newTickerIdx = tickerIdx;
                let newPromptIdx = promptIdx;

                if (e.key === 'ArrowUp' && tickerIdx > 0) newTickerIdx = tickerIdx - 1;
                if (e.key === 'ArrowDown' && tickerIdx < tickers.length - 1) newTickerIdx = tickerIdx + 1;
                if (e.key === 'ArrowLeft' && promptIdx > 0) newPromptIdx = promptIdx - 1;
                if (e.key === 'ArrowRight' && promptIdx < prompts.length - 1) newPromptIdx = promptIdx + 1;

                const newCell = state.cells[cellKey(tickers[newTickerIdx], prompts[newPromptIdx].id)];
                if (newCell?.status === 'done') {
                    setSelectedCell(newCell);
                }
            }

            // Ctrl+E: export CSV
            if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
                e.preventDefault();
                handleExportCSV();
            }

            // Ctrl/Cmd+K: focus search
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                searchInputRef.current?.focus();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedCell, state]);

    const activePrompts = SEED_GRID_PROMPTS.filter(p => promptIds.includes(p.id));

    const togglePrompt = (id: string) => {
        setPromptIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
    };

    const startRun = async () => {
        const tickers = tickersInput.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
        if (tickers.length === 0 || activePrompts.length === 0) return;

        const def: GridDef = {
            id: `grid-${Date.now()}`,
            name: `${tickers.length} tickers × ${activePrompts.length} prompts (${selectedModel})`,
            tickers,
            prompts: activePrompts,
        };
        const initial = initializeGrid(def);
        setState(initial);
        setRunning(true);
        const controller = new AbortController();
        abortRef.current = controller;

        const deps: CellRunnerDeps = {
            callLLM: (prompt, signal) => callLLMProxy(prompt, selectedModel, signal),
            searchGravity: searchGravityCell,
        };

        try {
            const final = await runGrid(initial, deps, {
                // Free Gemini key (~15 req/min) must stay serial or it 429s on
                // most cells. Paid DeepSeek/Claude handle parallel fan-out, so
                // run the grid concurrently for them (huge wall-time win).
                concurrency: selectedModel === 'gemini' ? 1 : 6,
                signal: controller.signal,
                onCellUpdate: (s) => { setState({ ...s }); },
            });
            setState(final);
            // Success micro-interaction: cyan/gold particle burst (spec §11.4)
            const anyDone = Object.values(final.cells).some(c => c.status === 'done');
            if (anyDone && !controller.signal.aborted) {
                setBurst(true);
                setTimeout(() => setBurst(false), 1000);
            }
            // Best-effort persist — non-blocking. Refresh history on success.
            saveGridRun(final).then(() => refreshHistory()).catch(() => { /* ignore */ });
        } finally {
            abortRef.current = null;
            setRunning(false);
        }
    };

    const reRunCell = async (ticker: string, promptId: string, customPrompt?: string) => {
        if (!state) return;
        const prompt = state.def.prompts.find(p => p.id === promptId);
        if (!prompt) return;

        setState(s => s ? updateCell(s, ticker, promptId, { status: 'running' }) : s);

        const deps: CellRunnerDeps = {
            callLLM: (p, signal) => callLLMProxy(p, selectedModel, signal),
            searchGravity: searchGravityCell,
        };

        try {
            // If custom prompt provided, create a modified def with the custom prompt
            let def = state.def;
            if (customPrompt) {
                def = {
                    ...state.def,
                    prompts: state.def.prompts.map(p =>
                        p.id === promptId ? { ...p, prompt: customPrompt } : p
                    ),
                };
            }
            const cell = await runGridCell(def, ticker, promptId, deps, undefined, state);
            setState(s => s ? updateCell(s, ticker, promptId, cell) : s);
            setEditingCell(null);
        } catch (e: any) {
            setState(s => s ? updateCell(s, ticker, promptId, {
                status: 'error',
                error: e?.message ?? 'Unknown error',
            }) : s);
        }
    };

    const stampedName = (ext: string) =>
        `grid-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.${ext}`;

    const handleExportCSV = () => {
        if (!state) return;
        const blob = new Blob([toCSV(state)], { type: 'text/csv;charset=utf-8' });
        downloadBlob(blob, stampedName('csv'));
    };

    const handleExportXLSX = async () => {
        if (!state) return;
        const blob = await exportGridToXLSX(state);
        downloadBlob(blob, stampedName('xlsx'));
    };

    const handleLoadHistory = async (id: string) => {
        setHistoryOpen(false);
        const loaded = await loadGridRun(id);
        if (loaded) {
            setState(loaded);
            setTickersInput(loaded.def.tickers.join(', '));
            setPromptIds(loaded.def.prompts.map(p => p.id));
        }
    };

    const handleDeleteHistory = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        await deleteGridRun(id);
        await refreshHistory();
    };

    const cancelRun = () => {
        abortRef.current?.abort();
        if (state) {
            let next = state;
            for (const [k, c] of Object.entries(state.cells)) {
                if (c.status === 'pending' || c.status === 'running') {
                    next = updateCell(next, c.ticker, c.promptId, { status: 'cancelled' });
                }
                void k;
            }
            setState({ ...next });
        }
    };

    const progress = state
        ? {
            done: Object.values(state.cells).filter(c => c.status === 'done').length,
            failed: Object.values(state.cells).filter(c => c.status === 'error').length,
            cancelled: Object.values(state.cells).filter(c => c.status === 'cancelled').length,
            total: Object.values(state.cells).length,
        }
        : null;

    // Sort tickers based on current sort setting
    const getSortedTickers = () => {
        if (!state || !sortBy) return state?.def.tickers ?? [];

        const tickers = [...state.def.tickers];
        const collator = new Intl.Collator();

        if (sortBy === 'ticker') {
            tickers.sort((a, b) => collator.compare(a, b));
        } else if (sortBy === 'status' || sortBy === 'duration') {
            tickers.sort((a, b) => {
                let aVal: any = null;
                let bVal: any = null;

                // Get first non-synthesis prompt
                const firstPrompt = state.def.prompts.find(p => !p.synthesis);
                if (!firstPrompt) return 0;

                const aCell = state.cells[cellKey(a, firstPrompt.id)];
                const bCell = state.cells[cellKey(b, firstPrompt.id)];

                if (sortBy === 'status') {
                    const statusOrder = { done: 0, error: 1, running: 2, pending: 3, cancelled: 4 };
                    aVal = statusOrder[aCell?.status as keyof typeof statusOrder] ?? 5;
                    bVal = statusOrder[bCell?.status as keyof typeof statusOrder] ?? 5;
                } else if (sortBy === 'duration') {
                    aVal = aCell?.durationMs ?? 0;
                    bVal = bCell?.durationMs ?? 0;
                }

                return sortDesc ? bVal - aVal : aVal - bVal;
            });
        }

        return sortDesc && sortBy !== 'status' ? tickers.reverse() : tickers;
    };

    const sortedTickers = getSortedTickers();

    // Filter tickers based on search query
    const getFilteredTickers = () => {
        if (!searchQuery.trim() || !state) return sortedTickers;

        const query = searchQuery.toLowerCase();
        return sortedTickers.filter(ticker => {
            // Match ticker name
            if (ticker.toLowerCase().includes(query)) return true;

            // Match any cell content
            for (const prompt of state.def.prompts) {
                const cell = state.cells[cellKey(ticker, prompt.id)];
                if (cell?.answer && cell.answer.toLowerCase().includes(query)) {
                    return true;
                }
            }
            return false;
        });
    };

    const filteredTickers = getFilteredTickers();

    return (
        <div className="relative overflow-hidden p-6 bg-gradient-to-b from-[#0b0c12] via-[#0f0f1a] to-[#0b0c12] text-[color:var(--text-2)] min-h-screen" style={{
            '--scrollbar-track': '#1a1a2e',
            '--scrollbar-thumb': '#d4af37',
        } as React.CSSProperties}>
            <style>{`
                .scrollbar-thin::-webkit-scrollbar {
                    height: 8px;
                    width: 8px;
                }
                .scrollbar-thin::-webkit-scrollbar-track {
                    background: #1a1a2e;
                }
                .scrollbar-thin::-webkit-scrollbar-thumb {
                    background: #d4af37;
                    border-radius: 4px;
                }
                .scrollbar-thin::-webkit-scrollbar-thumb:hover {
                    background: #ffed4e;
                }
                /* Research Grid design spec — neon glow + module utilities */
                .glow-cyan {
                    box-shadow: 0 0 8px #00f0ff, 0 0 20px rgba(0, 240, 255, 0.3);
                }
                .glow-cyan-strong {
                    box-shadow: 0 0 16px #00f0ff, 0 0 50px rgba(0, 240, 255, 0.5);
                }
                .glow-cyan-bottom {
                    box-shadow: 0 6px 18px -4px rgba(0, 240, 255, 0.45), 0 0 30px rgba(0, 240, 255, 0.12), inset 1px 1px 0 0 rgba(255, 255, 255, 0.06);
                }
                .glow-gold {
                    box-shadow: 0 0 6px #f4c95f;
                }
                .metallic-header {
                    background: linear-gradient(to bottom, #3a2f1f, #2a2418);
                }
                .card-module {
                    background: #0f1118;
                    border: 1px solid rgba(0, 240, 255, 0.1);
                    border-radius: 10px;
                    transition: all 0.2s ease;
                }
                .card-module:hover {
                    border-color: rgba(0, 240, 255, 0.4);
                }
                /* Faint noise texture overlay for expensive terminal feel (spec §11.1) */
                .noise-overlay {
                    position: absolute;
                    inset: 0;
                    pointer-events: none;
                    opacity: 0.03;
                    z-index: 0;
                    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
                }
                @media (prefers-reduced-motion: reduce) {
                    .glow-cyan, .glow-cyan-strong { transition: none; }
                }
            `}</style>
            <div className="noise-overlay" aria-hidden />
            <div className="relative z-10 max-w-[1600px] mx-auto">
                {/* Header */}
                <div className="flex items-center gap-4 mb-8">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-gradient-to-br from-[#d4af37] to-[#aa8c2c] shadow-lg shadow-[#d4af37]/40">
                        <GridIcon className="w-5 h-5 text-[#0a0a0a]" />
                    </div>
                    <div>
                        <motion.h1
                            animate={{
                                textShadow: [
                                    '0 0 8px rgba(244, 201, 95, 0.4)',
                                    '0 0 18px rgba(244, 201, 95, 0.7)',
                                    '0 0 8px rgba(244, 201, 95, 0.4)',
                                ],
                            }}
                            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                            className="font-display font-bold text-3xl text-[#d4af37] tracking-tight"
                        >
                            Research Grid
                        </motion.h1>
                        <p className="text-xs font-bold text-[#00d9ff] mt-1 uppercase tracking-widest">Tickers × Prompts · One Cited Answer Per Cell</p>
                    </div>
                </div>

                {/* Config */}
                <div className="mt-8 p-6 rounded-2xl bg-gradient-to-b from-[#1a1c24]/80 to-[#0f1118]/80 border border-[#d4af37]/30 glow-cyan-bottom backdrop-blur-md">
                    <label className="text-xs font-bold text-[#d4af37] block mb-2 uppercase tracking-wider">Tickers (comma-separated)</label>
                    <input
                        type="text"
                        value={tickersInput}
                        onChange={e => setTickersInput(e.target.value)}
                        placeholder="NVDA, AAPL, MSFT"
                        disabled={running}
                        className="w-full px-4 py-2.5 rounded-md text-sm bg-[#0a0a0a] border border-[#d4af37]/30 text-[#00d9ff] placeholder:text-[#666] focus:outline-none focus:ring-2 focus:ring-[#d4af37]/50 focus:border-[#d4af37] disabled:opacity-40 transition-all"
                    />

                    <label className="text-xs font-bold text-[#d4af37] block mt-4 mb-3 uppercase tracking-wider">LLM Model</label>
                    <div className="flex gap-2 mb-6">
                        {([
                            { key: 'deepseek', name: 'DeepSeek', cost: '$' },
                            { key: 'claude', name: 'Claude', cost: '$$' },
                            { key: 'gemini', name: 'Gemini', cost: 'Free' },
                        ] as const).map(({ key, name, cost }) => (
                            <motion.button
                                key={key}
                                onClick={() => setSelectedModel(key)}
                                disabled={running}
                                whileHover={{ scale: running ? 1 : 1.03 }}
                                whileTap={{ scale: running ? 1 : 0.98 }}
                                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                                className={`px-4 py-2 rounded-full text-xs font-bold border uppercase tracking-wider ${
                                    selectedModel === key
                                        ? 'border-[#00f0ff] text-white bg-[#00f0ff]/20 glow-cyan'
                                        : 'border-[#d4af37]/40 text-[#a0a8b8] hover:text-[#d4af37] hover:border-[#d4af37]/60'
                                } disabled:opacity-40 cursor-pointer`}
                            >
                                {name} <span className="opacity-70">({cost})</span>
                            </motion.button>
                        ))}
                    </div>

                    <label className="text-xs font-bold text-[#d4af37] block mt-4 mb-3 uppercase tracking-wider">Analyst Prompts</label>
                    <div className="flex flex-wrap gap-2 mb-6">
                        {SEED_GRID_PROMPTS.map(p => {
                            const active = promptIds.includes(p.id);
                            return (
                                <motion.button
                                    key={p.id}
                                    onClick={() => togglePrompt(p.id)}
                                    disabled={running}
                                    whileHover={{ scale: running ? 1 : 1.03 }}
                                    whileTap={{ scale: running ? 1 : 0.98 }}
                                    transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                                    className={`px-4 py-2 rounded-full text-xs font-bold border uppercase tracking-wider ${active
                                        ? 'border-[#00f0ff] text-white bg-[#00f0ff]/20 glow-cyan'
                                        : 'border-[#d4af37]/40 text-[#a0a8b8] hover:text-[#d4af37] hover:border-[#d4af37]/60'
                                        } disabled:opacity-40 cursor-pointer`}
                                >
                                    {p.label}
                                </motion.button>
                            );
                        })}
                    </div>

                    <div className="flex items-center gap-3">
                        {!running ? (
                            <motion.button
                                onClick={startRun}
                                disabled={!tickersInput.trim() || activePrompts.length === 0}
                                whileHover={{ scale: 1.03 }}
                                whileTap={{ scale: 0.97 }}
                                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                                className="flex items-center gap-2 px-8 py-3 rounded-xl text-sm font-bold bg-[#00f0ff] text-[#0a0a0a] glow-cyan disabled:opacity-40 disabled:shadow-none uppercase tracking-wider"
                            >
                                <Play className="w-4 h-4" />
                                Run Grid
                            </motion.button>
                        ) : (
                            <motion.button
                                onClick={cancelRun}
                                animate={{
                                    boxShadow: [
                                        '0 0 12px rgba(0,240,255,0.4), 0 0 40px rgba(0,240,255,0.25)',
                                        '0 0 22px rgba(0,240,255,0.6), 0 0 70px rgba(0,240,255,0.4)',
                                        '0 0 12px rgba(0,240,255,0.4), 0 0 40px rgba(0,240,255,0.25)',
                                    ],
                                }}
                                transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
                                className="flex items-center gap-2 px-8 py-3 rounded-xl text-sm font-bold text-[#00f0ff] border-2 border-[#00f0ff]/70 bg-[#00f0ff]/5 hover:bg-[#ff4444]/15 hover:text-[#ff4444] hover:border-[#ff4444] active:scale-95 transition-colors uppercase tracking-wider"
                            >
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Processing… <span className="opacity-60">/ Cancel</span>
                            </motion.button>
                        )}
                        {progress && (
                            <span className="relative text-xs font-bold text-[#00f0ff] uppercase tracking-wider">
                                <AnimatedCount value={progress.done} />/{progress.total} DONE
                                {progress.failed > 0 && <span className="text-[#ff4444]"> · {progress.failed} FAILED</span>}
                                {progress.cancelled > 0 && <span className="text-[#888]"> · {progress.cancelled} CANCELLED</span>}
                                <ParticleBurst show={burst} />
                            </span>
                        )}

                        <div className="flex-1" />

                        {state && !running && progress && progress.done > 0 && (
                            <>
                                <button
                                    onClick={handleExportCSV}
                                    title="Export CSV"
                                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium text-[color:var(--text-2)] border border-[color:var(--line)] hover:text-[color:var(--text)] hover:border-[color:var(--text-2)] hover:shadow-sm hover:bg-[color:var(--surface-2)] transition-all"
                                >
                                    <Download className="w-3.5 h-3.5" />
                                    CSV
                                </button>
                                <button
                                    onClick={handleExportXLSX}
                                    title="Export Excel (formatted, with Sources sheet)"
                                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-[color:var(--accent-ink)] bg-gradient-to-br from-[color:var(--accent)] to-[color:color-mix(in_oklch,var(--accent)_80%,black)] hover:shadow-md hover:shadow-[color:color-mix(in_oklch,var(--accent)_30%,transparent)] active:scale-95 transition-all"
                                >
                                    <Download className="w-3.5 h-3.5" />
                                    Excel
                                </button>
                            </>
                        )}

                        {history.length > 0 && (
                            <div className="relative">
                                <button
                                    onClick={() => setHistoryOpen(o => !o)}
                                    title="Recent runs"
                                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm text-xs text-[color:var(--text-2)] border border-[color:var(--line)] hover:text-[color:var(--text)] hover:border-[color:var(--line-strong)] transition-colors"
                                >
                                    <Clock className="w-3.5 h-3.5" />
                                    History ({history.length})
                                </button>
                                {historyOpen && (
                                    <>
                                        <div className="fixed inset-0 z-30" onClick={() => setHistoryOpen(false)} />
                                        <div className="absolute right-0 mt-1 w-[320px] max-h-[360px] overflow-y-auto rounded-sm bg-[color:var(--surface-2)] border border-[color:var(--line)] shadow-lg z-40">
                                            {history.map(row => (
                                                <div
                                                    key={row.id}
                                                    onClick={() => handleLoadHistory(row.id)}
                                                    className="flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-[color:var(--surface)] border-b border-[color:var(--line)] last:border-b-0"
                                                >
                                                    <div className="flex-1 min-w-0">
                                                        <div className="text-xs text-[color:var(--text)] truncate">{row.name}</div>
                                                        <div className="label mt-0.5">
                                                            {new Date(row.created_at).toLocaleString()}
                                                        </div>
                                                    </div>
                                                    <button
                                                        onClick={(e) => handleDeleteHistory(row.id, e)}
                                                        title="Delete"
                                                        className="p-1 rounded-sm text-[color:var(--text-4)] hover:text-[color:var(--down)] hover:bg-[color:var(--surface)]"
                                                    >
                                                        <Trash2 className="w-3 h-3" />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Search */}
                {state && (
                    <div className="mt-6 flex items-center gap-2.5">
                        <div className="relative flex-1">
                            <motion.input
                                ref={searchInputRef}
                                type="text"
                                placeholder="Search cells by ticker or content..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                whileFocus={{ boxShadow: '0 0 0 1px #00f0ff, 0 0 20px rgba(0, 240, 255, 0.25)' }}
                                className="w-full px-4 py-2.5 pr-16 rounded-xl text-sm bg-[#111218] border border-white/10 text-[#e8e8f0] placeholder:text-[#666] focus:outline-none focus:border-[#00f0ff]/60 transition-colors"
                            />
                            <kbd className="absolute right-3 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded text-[10px] font-mono text-[#a0a8b8] border border-white/10 bg-[#0a0b10] pointer-events-none">
                                ⌘K
                            </kbd>
                        </div>
                        {searchQuery && (
                            <button
                                onClick={() => setSearchQuery('')}
                                className="px-3 py-2 rounded-lg text-xs font-medium text-[color:var(--text-3)] hover:text-[color:var(--text)] hover:bg-[color:var(--surface-2)] transition-all"
                            >
                                Clear
                            </button>
                        )}
                        {filteredTickers.length !== sortedTickers.length && (
                            <span className="text-xs font-semibold text-[color:var(--text-3)] px-3 py-2 rounded-lg bg-[color:var(--surface)]">
                                {filteredTickers.length} / {sortedTickers.length}
                            </span>
                        )}
                    </div>
                )}

                {/* Grid */}
                {state && (
                    <div className="mt-6 rounded-lg border border-[#d4af37]/30 overflow-hidden shadow-2xl shadow-[#d4af37]/20 bg-[#0a0a0a]">
                        <div className="overflow-x-hidden">
                            <table className="w-full table-fixed text-xs border-collapse">
                                <colgroup>
                                    {/* Fixed narrow TICKER column; all prompt columns split the remaining width equally so the whole table fits without horizontal scroll / zoom-out */}
                                    <col style={{ width: '72px' }} />
                                    {state.def.prompts.map(p => (
                                        <col key={p.id} />
                                    ))}
                                </colgroup>
                                <thead className="sticky top-0 z-20">
                                    <tr className="bg-gradient-to-r from-[#2d2416]/80 via-[#3d3420]/80 to-[#2d2416]/80 border-b-2 border-[#d4af37]/40">
                                        <th
                                            onClick={() => {
                                                if (sortBy === 'ticker') {
                                                    setSortDesc(!sortDesc);
                                                } else {
                                                    setSortBy('ticker');
                                                    setSortDesc(false);
                                                }
                                            }}
                                            className="sticky left-0 z-30 px-2 py-3 text-left font-bold text-[10px] text-[#d4af37] bg-[#2d2416]/90 cursor-pointer hover:text-[#ffed4e] transition-colors uppercase tracking-wider"
                                        >
                                            <div className="flex items-center gap-1.5">
                                                TICKER
                                                {sortBy === 'ticker' && (
                                                    <span className="text-xs">{sortDesc ? '↓' : '↑'}</span>
                                                )}
                                            </div>
                                        </th>
                                        {state.def.prompts.map(p => (
                                            <th
                                                key={p.id}
                                                className={`px-2 py-3 text-left font-bold text-[10px] cursor-pointer transition-colors uppercase tracking-wider break-words ${
                                                    p.synthesis
                                                        ? 'bg-[#1a1a1a] text-[#00d9ff] hover:bg-[#00d9ff]/10'
                                                        : 'bg-[#2d2416]/80 text-[#d4af37] hover:text-[#ffed4e]'
                                                }`}
                                            >
                                                {p.label}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[color:var(--line)]">
                                    {filteredTickers.length === 0 ? (
                                        <tr>
                                            <td colSpan={state.def.prompts.length + 1} className="px-3 py-6 text-center text-xs text-[color:var(--text-3)]">
                                                No cells match your search
                                            </td>
                                        </tr>
                                    ) : (
                                        filteredTickers.map((ticker, idx) => (
                                        <motion.tr
                                            key={ticker}
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ delay: Math.min(idx * 0.03, 0.4), type: 'spring', stiffness: 120, damping: 18 }}
                                            className={`transition-colors border-b border-[#333] hover:shadow-[inset_3px_0_0_0_#00f0ff] ${
                                                idx % 2 === 0
                                                    ? 'bg-[#0a0a0a]'
                                                    : 'bg-[#111111]'
                                            } hover:bg-[#1a1a2e]/60`}
                                        >
                                            <td className="sticky left-0 z-10 px-2 py-3 font-mono font-bold text-xs text-[#00d9ff] border-r border-[#d4af37]/30 bg-inherit whitespace-nowrap">
                                                {ticker}
                                            </td>
                                            {state.def.prompts.map(p => {
                                                // Comparison column stays empty in per-ticker rows —
                                                // aggregate answer renders as a glowing card in the bottom row (spec §6.2).
                                                if (p.synthesis) {
                                                    return (
                                                        <td key={p.id} className="px-2 py-3 align-middle border-r border-[#333] text-center">
                                                            <span className="text-[#2a2a3a] text-xs">·</span>
                                                        </td>
                                                    );
                                                }
                                                const cell = state.cells[cellKey(ticker, p.id)];
                                                const isCopied = copiedCell === `${ticker}::${p.id}`;
                                                return (
                                                    <td
                                                        key={p.id}
                                                        className={`px-2 py-3 align-top relative group border-r border-[#333] ${
                                                            cell?.status === 'done'
                                                                ? 'cursor-pointer hover:bg-[#1a1a2e]/40'
                                                                : ''
                                                        }`}
                                                        onClick={() => cell?.status === 'done' && setSelectedCell(cell)}
                                                    >
                                                        <CellContent cell={cell} loading={running} />
                                                        {cell?.status === 'done' && cell?.answer && (
                                                            <button
                                                                onClick={e => {
                                                                    e.stopPropagation();
                                                                    copyCell(ticker, p.id, cell.answer!);
                                                                }}
                                                                className="absolute top-1 right-1 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity bg-[#1a1a2e] border border-[#d4af37]/30 hover:bg-[#d4af37] hover:text-[#0a0a0a]"
                                                                title="Copy to clipboard"
                                                            >
                                                                {isCopied ? (
                                                                    <CheckIcon className="w-3 h-3 text-[#00ff00]" />
                                                                ) : (
                                                                    <Copy className="w-3 h-3 text-[#888]" />
                                                                )}
                                                            </button>
                                                        )}
                                                    </td>
                                                );
                                            })}
                                        </motion.tr>
                                    )))}
                                    {/* Comparison row — glowing cyan info card sits bottom-right under the Comparison column (spec §6.2) */}
                                    {state.def.prompts.some(p => p.synthesis) && (
                                        <tr className="bg-gradient-to-r from-[#0b0c12] via-[#10131c] to-[#0b0c12] border-t-2 border-[#00f0ff]/40">
                                            <td className="sticky left-0 z-10 px-2 py-4 font-mono font-bold text-[9px] text-[#00f0ff] border-r border-[#d4af37]/30 bg-[#0b0c12] uppercase tracking-wider align-top">
                                                <span className="flex items-center gap-1.5 leading-tight break-words">
                                                    <span className="inline-block w-1.5 h-1.5 shrink-0 rounded-full bg-[#00f0ff] glow-cyan" />
                                                    Comp
                                                </span>
                                            </td>
                                            {state.def.prompts.map(p => {
                                                if (!p.synthesis) {
                                                    // Empty cells across the comparison row.
                                                    return <td key={p.id} className="px-2 py-4 border-r border-[#1a1a22]" />;
                                                }
                                                const cell = state.cells[cellKey('ALL', p.id)];
                                                const ready = cell?.status === 'done';
                                                const answer = cell?.answer ?? '';
                                                return (
                                                    <td key={p.id} className="px-2 py-4 align-top">
                                                        {ready ? (
                                                            <motion.div
                                                                onClick={() => setSelectedCell(cell)}
                                                                whileHover={{ y: -3, boxShadow: '0 0 20px #00f0ff, 0 0 60px rgba(0, 240, 255, 0.55)' }}
                                                                transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                                                                className="cursor-pointer rounded-xl border border-[#00f0ff]/70 bg-[#0f1118] glow-cyan-strong p-3 space-y-1.5"
                                                            >
                                                                <span className="inline-block px-1.5 py-0.5 rounded text-[8px] font-bold bg-[#00f0ff]/25 text-[#00f0ff] uppercase tracking-wider">
                                                                    Comparison
                                                                </span>
                                                                <p className="text-[10px] leading-snug text-[#e0e4f0] line-clamp-4 w-full break-words">
                                                                    {answer.slice(0, 180)}{answer.length > 180 ? '…' : ''}
                                                                </p>
                                                                {cell?.durationMs && (
                                                                    <div className="flex items-center gap-1 text-[9px] text-[#666]">
                                                                        <span className="font-bold text-[#888]">{(cell.durationMs / 1000).toFixed(1)}s</span>
                                                                        <span>•</span>
                                                                        <span className="truncate">{cell.modelUsed}</span>
                                                                    </div>
                                                                )}
                                                            </motion.div>
                                                        ) : (
                                                            <CellContent cell={cell} loading={running} />
                                                        )}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {!state && (
                    <div className="mt-10 flex flex-col items-center justify-center py-14 text-center">
                        <div className="w-12 h-12 rounded-sm flex items-center justify-center mb-5 bg-[color:var(--accent)]">
                            <Sparkles className="w-5 h-5 text-[color:var(--accent-ink)]" />
                        </div>
                        <h2 className="font-display text-h4 font-medium text-[color:var(--text)] mb-1">Build your analyst grid</h2>
                        <p className="text-sm text-[color:var(--text-3)] max-w-md">
                            Pick tickers and prompts above, then run the grid to get parallel cited answers for every cell.
                        </p>
                    </div>
                )}
            </div>

            {/* Cell detail modal */}
            {selectedCell && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 backdrop-blur-sm"
                    style={{ background: 'color-mix(in oklch, var(--bg) 88%, transparent)' }}
                    onClick={() => setSelectedCell(null)}
                >
                    <div
                        className="w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-2xl p-8 bg-[color:var(--surface)] border border-[color:var(--line)] shadow-2xl shadow-[color:color-mix(in_oklch,var(--accent)_15%,transparent)]"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-start justify-between gap-4 mb-8">
                            <div>
                                <div className="inline-block px-3 py-1.5 mb-3 rounded-lg text-xs font-bold text-[color:var(--accent)] bg-[color:color-mix(in_oklch,var(--accent)_18%,transparent)] border border-[color:color-mix(in_oklch,var(--accent)_35%,transparent)] uppercase tracking-wide">
                                    {selectedCell.ticker}
                                </div>
                                <h2 className="font-display text-3xl font-bold text-[color:var(--text)]">
                                    {SEED_GRID_PROMPTS.find(p => p.id === selectedCell.promptId)?.label}
                                </h2>
                            </div>
                            <button
                                onClick={() => setSelectedCell(null)}
                                className="flex-shrink-0 p-2 rounded-lg text-[color:var(--text-3)] hover:text-[color:var(--text)] hover:bg-[color:var(--surface-2)] transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="mb-6">
                            <CellAnswer
                                text={selectedCell.answer ?? ''}
                                citations={selectedCell.citations ?? []}
                                onOpenCitation={openCitation}
                            />
                        </div>
                        {selectedCell.citations && selectedCell.citations.length > 0 && (
                            <CellSources citations={selectedCell.citations} activeId={activeCitation} />
                        )}
                        <div className="mt-8 flex items-center justify-between pt-6 border-t-2 border-[color:color-mix(in_oklch,var(--accent)_20%,transparent)]">
                            <div className="flex items-center gap-2.5 text-xs text-[color:var(--text-3)]">
                                <span className="font-bold">{((selectedCell.durationMs ?? 0) / 1000).toFixed(1)}s</span>
                                <span className="opacity-40">•</span>
                                <span className="font-medium">{selectedCell.modelUsed}</span>
                                {selectedCell.ragUsed && (
                                    <>
                                        <span className="opacity-40">•</span>
                                        <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-[color:color-mix(in_oklch,var(--accent)_25%,transparent)] text-[color:var(--accent)] border border-[color:color-mix(in_oklch,var(--accent)_40%,transparent)]">
                                            SEC RAG
                                        </span>
                                    </>
                                )}
                            </div>
                            <button
                                onClick={() => {
                                    const prompt = state?.def.prompts.find(p => p.id === selectedCell.promptId);
                                    if (prompt) {
                                        const resolved = resolvePrompt(prompt, selectedCell.ticker);
                                        setEditPrompt(resolved);
                                        setEditingCell({ ticker: selectedCell.ticker, promptId: selectedCell.promptId });
                                        setSelectedCell(null);
                                    }
                                }}
                                className="px-6 py-3 rounded-lg text-sm font-bold bg-gradient-to-br from-[color:var(--accent)] to-[color:color-mix(in_oklch,var(--accent)_80%,black)] text-[color:var(--accent-ink)] hover:shadow-lg hover:shadow-[color:color-mix(in_oklch,var(--accent)_30%,transparent)] active:scale-95 transition-all uppercase tracking-wide"
                            >
                                Edit & Re-run
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Cell edit modal */}
            {editingCell && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 backdrop-blur-sm"
                    style={{ background: 'color-mix(in oklch, var(--bg) 88%, transparent)' }}
                    onClick={() => setEditingCell(null)}
                >
                    <div
                        className="w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-2xl p-8 bg-[color:var(--surface)] border border-[color:var(--line)] shadow-2xl shadow-[color:color-mix(in_oklch,var(--accent)_15%,transparent)]"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-start justify-between gap-4 mb-8">
                            <div>
                                <div className="inline-block px-3 py-1.5 mb-3 rounded-lg text-xs font-bold text-[color:var(--accent)] bg-[color:color-mix(in_oklch,var(--accent)_18%,transparent)] border border-[color:color-mix(in_oklch,var(--accent)_35%,transparent)] uppercase tracking-wide">
                                    {editingCell.ticker}
                                </div>
                                <h2 className="font-display text-3xl font-bold text-[color:var(--text)]">
                                    Edit prompt
                                </h2>
                            </div>
                            <button
                                onClick={() => setEditingCell(null)}
                                className="flex-shrink-0 p-2.5 rounded-lg text-[color:var(--text-3)] hover:text-[color:var(--text)] hover:bg-[color:var(--surface-2)] transition-colors"
                            >
                                <X className="w-6 h-6" />
                            </button>
                        </div>
                        <div className="mb-8">
                            <label className="block text-xs font-bold text-[color:var(--text)] mb-3 uppercase tracking-wider">
                                Prompt text
                            </label>
                            <textarea
                                value={editPrompt}
                                onChange={e => setEditPrompt(e.target.value)}
                                className="w-full h-56 px-4 py-3 rounded-xl text-sm bg-[color:var(--bg)] border border-[color:var(--line)] text-[color:var(--text)] placeholder:text-[color:var(--text-4)] focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)] focus:ring-offset-0 focus:border-transparent resize-none font-mono leading-relaxed shadow-sm"
                                placeholder="Enter your custom prompt..."
                            />
                        </div>
                        <div className="flex gap-3">
                            <button
                                onClick={() => reRunCell(editingCell.ticker, editingCell.promptId, editPrompt)}
                                className="flex-1 px-6 py-3 rounded-lg text-sm font-bold bg-gradient-to-br from-[color:var(--accent)] to-[color:color-mix(in_oklch,var(--accent)_80%,black)] text-[color:var(--accent-ink)] hover:shadow-lg hover:shadow-[color:color-mix(in_oklch,var(--accent)_30%,transparent)] active:scale-95 transition-all uppercase tracking-wide"
                            >
                                Re-run cell
                            </button>
                            <button
                                onClick={() => setEditingCell(null)}
                                className="px-6 py-3 rounded-lg text-sm font-semibold border-2 border-[color:var(--line)] text-[color:var(--text-2)] hover:text-[color:var(--text)] hover:border-[color:var(--text-2)] hover:shadow-sm transition-all"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function CellContent({ cell, loading }: { cell?: GridCell; loading?: boolean }) {
    if (!cell || cell.status === 'pending') {
        // During an active run, pending cells render skeletons (spec §11.4)
        return loading ? <SkeletonCard /> : <span className="text-[#444] text-[10px]">—</span>;
    }
    if (cell.status === 'running') {
        return <SkeletonCard active />;
    }
    if (cell.status === 'error') {
        return (
            <div className="flex items-start gap-1 text-[10px] text-[#ff4444]" title={cell.error}>
                <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                <span className="truncate max-w-[150px]">{cell.error || 'Error'}</span>
            </div>
        );
    }
    if (cell.status === 'cancelled') {
        return <span className="text-[10px] text-[#888]">Cancelled</span>;
    }
    const isNoData = cell.modelUsed === 'no-sources';
    const excerpt = (cell.answer ?? '').slice(0, 120);

    // Self-contained "module card" per design spec §6.2:
    // faint cyan border, rounded corners, top-left badge, padded body.
    // Framer Motion spring hover lift + glow intensify (spec §10.2).
    return (
        <motion.div
            whileHover={{ y: -3, boxShadow: '0 0 14px #00f0ff, 0 0 35px rgba(0, 240, 255, 0.35)' }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            className="card-module p-2.5 space-y-1.5"
        >
            {(isNoData || cell.ragUsed) && (
                <div className="inline-block">
                    {isNoData ? (
                        <span className="inline-block px-1.5 py-0.5 rounded text-[8px] font-bold bg-[#888]/20 text-[#888] uppercase tracking-wider">
                            FLAG
                        </span>
                    ) : (
                        <span className="inline-block px-1.5 py-0.5 rounded text-[8px] font-bold bg-[#00f0ff]/20 text-[#00f0ff] uppercase tracking-wider">
                            RAG
                        </span>
                    )}
                </div>
            )}
            <p className={`text-[10px] leading-snug line-clamp-3 w-full break-words ${
                isNoData
                    ? 'text-[#a0a8b8] italic'
                    : 'text-[#e0e4f0]'
            }`}>
                {excerpt}{(cell.answer ?? '').length > 120 ? '…' : ''}
            </p>
            {cell.durationMs && (
                <div className="flex items-center gap-1 text-[9px] text-[#666]">
                    <span className="font-bold text-[#888]">{(cell.durationMs / 1000).toFixed(1)}s</span>
                    <span>•</span>
                    <span className="truncate">{cell.modelUsed}</span>
                </div>
            )}
        </motion.div>
    );
}

// Pulsing skeleton card shown while a cell is pending/running during a run (spec §11.4).
function SkeletonCard({ active }: { active?: boolean }) {
    return (
        <motion.div
            animate={{ opacity: [0.45, 0.85, 0.45] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
            className={`card-module p-2.5 space-y-1.5 w-full ${active ? 'glow-cyan' : ''}`}
        >
            <div className="h-2 w-8 rounded bg-[#00f0ff]/20" />
            <div className="h-1.5 w-full rounded bg-white/10" />
            <div className="h-1.5 w-[85%] rounded bg-white/10" />
            <div className="h-1.5 w-[60%] rounded bg-white/10" />
        </motion.div>
    );
}

// DONE counter that springs up to its target value (spec §11.4).
function AnimatedCount({ value }: { value: number }) {
    const mv = useMotionValue(0);
    const rounded = useTransform(mv, v => Math.round(v));
    useEffect(() => {
        const controls = animate(mv, value, { duration: 0.5, ease: 'easeOut' });
        return () => controls.stop();
    }, [value, mv]);
    return <motion.span>{rounded}</motion.span>;
}

// Cyan/gold particle burst on run completion (spec §11.4).
function ParticleBurst({ show }: { show: boolean }) {
    const dots = [
        { dx: -14, dy: -12, c: '#00f0ff' },
        { dx: 16, dy: -10, c: '#f4c95f' },
        { dx: -10, dy: 12, c: '#f4c95f' },
        { dx: 14, dy: 14, c: '#00f0ff' },
    ];
    return (
        <AnimatePresence>
            {show && (
                <span className="absolute left-1/2 top-1/2 pointer-events-none">
                    {dots.map((d, i) => (
                        <motion.span
                            key={i}
                            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
                            animate={{ x: d.dx, y: d.dy, opacity: 0, scale: 0.4 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.8, ease: 'easeOut' }}
                            className="absolute w-1.5 h-1.5 rounded-full"
                            style={{ background: d.c, boxShadow: `0 0 6px ${d.c}` }}
                        />
                    ))}
                </span>
            )}
        </AnimatePresence>
    );
}

// ─── World-class answer renderer (mirrors the search "quick answer") ───────────
// Markdown body + inline [N] markers turned into clickable citation chips.

function injectCites(
    children: ReactNode,
    map: Map<number, Citation>,
    onOpen: (id: number) => void,
): ReactNode {
    return Children.map(children, (child) => {
        if (typeof child !== 'string') return child;
        const parts = child.split(/(\[\d+\])/g);
        return parts.map((part, i) => {
            const m = part.match(/^\[(\d+)\]$/);
            if (!m) return part;
            const num = parseInt(m[1], 10);
            if (!map.has(num)) {
                return <sup key={i} className="text-[#00f0ff] text-xs">[{num}]</sup>;
            }
            return (
                <button
                    key={i}
                    onClick={() => onOpen(num)}
                    title={map.get(num)!.title}
                    className="mx-0.5 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-[#00f0ff]/20 text-[#00f0ff] text-[10px] font-bold align-super hover:bg-[#00f0ff]/40 hover:shadow-[0_0_8px_rgba(0,240,255,0.5)] active:scale-95 transition-all"
                >
                    {num}
                </button>
            );
        });
    });
}

function CellAnswer({ text, citations, onOpenCitation }: {
    text: string;
    citations: Citation[];
    onOpenCitation: (id: number) => void;
}) {
    const map = new Map(citations.map(c => [c.id, c]));
    const cite = (children: ReactNode) => injectCites(children, map, onOpenCitation);
    const md = text.trim().replace(/\n{3,}/g, '\n\n');

    return (
        <div className="text-[#e8e8f0] text-sm leading-7 space-y-3.5 break-words">
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                    p: ({ children }) => <p className="leading-7">{cite(children)}</p>,
                    strong: ({ children }) => <strong className="font-semibold text-white">{cite(children)}</strong>,
                    em: ({ children }) => <em className="italic text-[#cfd3e0]">{cite(children)}</em>,
                    a: ({ href, children }) => (
                        <a href={href} target="_blank" rel="noopener noreferrer"
                           className="text-[#00f0ff] underline decoration-[#00f0ff]/40 hover:decoration-[#00f0ff]">
                            {cite(children)}
                        </a>
                    ),
                    ul: ({ children }) => <ul className="list-disc pl-5 space-y-1.5 marker:text-[#00f0ff]/60">{children}</ul>,
                    ol: ({ children }) => <ol className="list-decimal pl-5 space-y-1.5 marker:text-[#00f0ff]/60">{children}</ol>,
                    li: ({ children }) => <li className="leading-7">{cite(children)}</li>,
                    h1: ({ children }) => <h1 className="font-display text-lg font-bold text-white mt-5 mb-2">{cite(children)}</h1>,
                    h2: ({ children }) => <h2 className="font-display text-base font-bold text-white mt-5 mb-2">{cite(children)}</h2>,
                    h3: ({ children }) => <h3 className="font-display text-sm font-bold text-[#d4af37] mt-4 mb-1.5 uppercase tracking-wide">{cite(children)}</h3>,
                    blockquote: ({ children }) => (
                        <blockquote className="pl-3 border-l-2 border-[#00f0ff]/40 text-[#a0a8b8] italic">{children}</blockquote>
                    ),
                    hr: () => <hr className="border-white/[0.08] my-4" />,
                    code: ({ children }) => (
                        <code className="font-mono text-[12px] bg-white/[0.06] text-[#00f0ff] px-1 py-0.5 rounded">{children}</code>
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
                        <th className="px-3 py-2 text-left font-semibold text-[#d4af37] uppercase tracking-wider text-[11px]">{cite(children)}</th>
                    ),
                    td: ({ children }) => <td className="px-3 py-2 text-[#e8e8f0] align-top">{cite(children)}</td>,
                }}
            >
                {md}
            </ReactMarkdown>
        </div>
    );
}

function CellSources({ citations, activeId }: { citations: Citation[]; activeId: number | null }) {
    return (
        <div className="mt-8 pt-6 border-t border-[#d4af37]/20">
            <h3 className="font-bold text-xs text-[#d4af37] mb-3 uppercase tracking-wider">
                Sources ({citations.length})
            </h3>
            <ul className="space-y-2">
                {citations.map(c => {
                    const active = activeId === c.id;
                    const hasUrl = !!c.url && c.url !== '#';
                    const Tag: any = hasUrl ? 'a' : 'div';
                    return (
                        <li key={c.id} id={`grid-src-${c.id}`}>
                            <Tag
                                {...(hasUrl ? { href: c.url, target: '_blank', rel: 'noopener noreferrer' } : {})}
                                className={`flex items-start gap-3 p-3 rounded-xl border transition-all ${
                                    active
                                        ? 'border-[#00f0ff] bg-[#00f0ff]/10 ring-1 ring-[#00f0ff]/50 shadow-[0_0_16px_rgba(0,240,255,0.25)]'
                                        : 'border-white/[0.08] bg-white/[0.02] hover:border-[#00f0ff]/40 hover:bg-[#00f0ff]/[0.04]'
                                } ${hasUrl ? 'cursor-pointer' : ''}`}
                            >
                                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#00f0ff]/15 text-[#00f0ff] text-[11px] font-bold flex items-center justify-center">
                                    {c.id}
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="block text-xs text-[#e8e8f0] leading-relaxed">{c.title}</span>
                                    {c.source && (
                                        <span className="block text-[10px] text-[#a0a8b8] mt-0.5 truncate">{c.source}</span>
                                    )}
                                </span>
                                {hasUrl && <ExternalLink className="w-3.5 h-3.5 text-[#a0a8b8] flex-shrink-0 mt-0.5" />}
                            </Tag>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
