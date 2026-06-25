// Grid Research View — Hebbia Matrix / AlphaSense Generative Grid analogue.
// Rows=tickers × Columns=analyst prompts. Each cell is an independent
// cancellable LLM call with per-cell status.

import { useState, useRef, useEffect } from 'react';
import { Play, X, Grid as GridIcon, Sparkles, Loader2, Check, AlertCircle, Download, Clock, Trash2, Copy, Check as CheckIcon } from 'lucide-react';
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
    const abortRef = useRef<AbortController | null>(null);

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
                // Serial: the shared LLM is a free-tier Gemini key (~15 req/min).
                // Concurrency >1 bursts past the quota -> 429 on most cells.
                concurrency: 1,
                signal: controller.signal,
                onCellUpdate: (s) => { setState({ ...s }); },
            });
            setState(final);
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
        <div className="p-6 bg-gradient-to-b from-[#0a0a0a] via-[#0f0f1a] to-[#0a0a0a] text-[color:var(--text-2)] min-h-screen">
            <div className="max-w-[1600px] mx-auto">
                {/* Header */}
                <div className="flex items-center gap-4 mb-8">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-gradient-to-br from-[#d4af37] to-[#aa8c2c] shadow-lg shadow-[#d4af37]/40">
                        <GridIcon className="w-5 h-5 text-[#0a0a0a]" />
                    </div>
                    <div>
                        <h1 className="font-display font-bold text-3xl text-[#d4af37] tracking-tight drop-shadow-lg">Research Grid</h1>
                        <p className="text-xs font-bold text-[#00d9ff] mt-1 uppercase tracking-widest">Tickers × Prompts · One Cited Answer Per Cell</p>
                    </div>
                </div>

                {/* Config */}
                <div className="mt-8 p-6 rounded-lg bg-gradient-to-br from-[#1a1a2e] to-[#16213e] border border-[#d4af37]/30 shadow-2xl shadow-[#d4af37]/20 backdrop-blur-sm">
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
                        {['deepseek', 'claude', 'gemini'].map(model => (
                            <button
                                key={model}
                                onClick={() => setSelectedModel(model as 'deepseek' | 'claude' | 'gemini')}
                                disabled={running}
                                className={`px-3 py-2 rounded-md text-xs font-bold transition-all border uppercase tracking-wider ${
                                    selectedModel === model
                                        ? 'border-[#d4af37] text-[#d4af37] bg-[#d4af37]/15 shadow-lg shadow-[#d4af37]/30'
                                        : 'border-[#d4af37]/30 text-[#888] hover:text-[#d4af37] hover:border-[#d4af37]/50'
                                } disabled:opacity-40 cursor-pointer`}
                            >
                                {model === 'deepseek' ? 'DeepSeek' : model === 'claude' ? 'Claude' : 'Gemini'}
                            </button>
                        ))}
                    </div>

                    <label className="text-xs font-bold text-[#d4af37] block mt-4 mb-3 uppercase tracking-wider">Analyst Prompts</label>
                    <div className="flex flex-wrap gap-2 mb-6">
                        {SEED_GRID_PROMPTS.map(p => {
                            const active = promptIds.includes(p.id);
                            return (
                                <button
                                    key={p.id}
                                    onClick={() => togglePrompt(p.id)}
                                    disabled={running}
                                    className={`px-3 py-2 rounded-md text-xs font-bold transition-all border uppercase tracking-wider ${active
                                        ? 'border-[#00d9ff] text-[#00d9ff] bg-[#00d9ff]/15 shadow-lg shadow-[#00d9ff]/40'
                                        : 'border-[#d4af37]/30 text-[#888] hover:text-[#d4af37] hover:border-[#d4af37]/50'
                                        } disabled:opacity-40 cursor-pointer`}
                                >
                                    {p.label}
                                </button>
                            );
                        })}
                    </div>

                    <div className="flex items-center gap-3">
                        {!running ? (
                            <button
                                onClick={startRun}
                                disabled={!tickersInput.trim() || activePrompts.length === 0}
                                className="flex items-center gap-2 px-6 py-3 rounded-md text-sm font-bold bg-gradient-to-r from-[#00d9ff] to-[#00b8cc] text-[#0a0a0a] hover:shadow-xl hover:shadow-[#00d9ff]/50 disabled:opacity-40 active:scale-95 transition-all uppercase tracking-wider"
                            >
                                <Play className="w-4 h-4" />
                                Run Grid
                            </button>
                        ) : (
                            <button
                                onClick={cancelRun}
                                className="flex items-center gap-2 px-6 py-3 rounded-md text-sm font-bold text-[#ff4444] border-2 border-[#ff4444] hover:bg-[#ff4444]/15 hover:shadow-lg hover:shadow-[#ff4444]/30 active:scale-95 transition-all uppercase tracking-wider"
                            >
                                <X className="w-4 h-4" />
                                Cancel
                            </button>
                        )}
                        {progress && (
                            <span className="text-xs font-bold text-[#00d9ff] uppercase tracking-wider">
                                {progress.done}/{progress.total} DONE
                                {progress.failed > 0 && <span className="text-[#ff4444]"> · {progress.failed} FAILED</span>}
                                {progress.cancelled > 0 && <span className="text-[#888]"> · {progress.cancelled} CANCELLED</span>}
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
                        <input
                            type="text"
                            placeholder="Search cells by ticker or content..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="flex-1 px-4 py-2.5 rounded-md text-sm bg-[#0a0a0a] border border-[#d4af37]/30 text-[#00d9ff] placeholder:text-[#444] focus:outline-none focus:ring-2 focus:ring-[#d4af37]/50 focus:border-[#d4af37] transition-all"
                        />
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
                    <div className="mt-6 rounded-lg border border-[#d4af37]/30 overflow-hidden shadow-2xl shadow-[#d4af37]/20 bg-[#0a0a0a]" style={{ maxHeight: 'calc(100vh - 450px)' }}>
                        <div className="overflow-x-auto overflow-y-auto h-full">
                            <table className="w-full text-xs">
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
                                            className="sticky left-0 z-30 px-3 py-3 text-left font-bold text-[10px] text-[#d4af37] bg-[#2d2416]/90 min-w-[70px] cursor-pointer hover:text-[#ffed4e] transition-colors uppercase tracking-wider"
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
                                                className={`px-3 py-3 text-left font-bold text-[10px] cursor-pointer transition-colors uppercase tracking-wider ${
                                                    p.synthesis
                                                        ? 'bg-[#1a1a1a] text-[#00d9ff] hover:bg-[#00d9ff]/10'
                                                        : 'bg-[#2d2416]/80 text-[#d4af37] hover:text-[#ffed4e]'
                                                }`}
                                                style={{ minWidth: p.synthesis ? '200px' : '160px' }}
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
                                        <tr
                                            key={ticker}
                                            className={`transition-colors border-b border-[#333] ${
                                                idx % 2 === 0
                                                    ? 'bg-[#0a0a0a]'
                                                    : 'bg-[#111111]'
                                            } hover:bg-[#1a1a2e]/60`}
                                        >
                                            <td className="sticky left-0 z-10 px-3 py-3 font-mono font-bold text-xs text-[#00d9ff] border-r border-[#d4af37]/30 bg-inherit whitespace-nowrap">
                                                {ticker}
                                            </td>
                                            {state.def.prompts.map(p => {
                                                const cell = state.cells[cellKey(ticker, p.id)];
                                                const isCopied = copiedCell === `${ticker}::${p.id}`;
                                                return (
                                                    <td
                                                        key={p.id}
                                                        className={`px-3 py-3 align-top relative group border-r border-[#333] ${
                                                            cell?.status === 'done'
                                                                ? 'cursor-pointer hover:bg-[#1a1a2e]/40'
                                                                : ''
                                                        }`}
                                                        onClick={() => cell?.status === 'done' && setSelectedCell(cell)}
                                                    >
                                                        <CellContent cell={cell} />
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
                                        </tr>
                                    )))}
                                    {/* Synthesis row (comparison) */}
                                    {state.def.prompts.some(p => p.synthesis) && (
                                        <tr className="bg-gradient-to-r from-[#1a1a2e]/80 via-[#1a1a3e]/80 to-[#1a1a2e]/80 border-t-2 border-b border-[#00d9ff]/40">
                                            <td className="sticky left-0 z-10 px-3 py-3 font-mono font-bold text-xs text-[#00d9ff] border-r border-[#d4af37]/30 bg-[#1a1a2e]/90 flex items-center gap-1.5 whitespace-nowrap">
                                                <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#00d9ff]" />
                                                COMP
                                            </td>
                                            {state.def.prompts.map(p => {
                                                const cell = state.cells[cellKey('ALL', p.id)];
                                                return (
                                                    <td
                                                        key={p.id}
                                                        className={`px-3 py-3 align-top border-r border-[#333] ${
                                                            p.synthesis
                                                                ? cell?.status === 'done'
                                                                    ? 'cursor-pointer hover:bg-[#00d9ff]/10'
                                                                    : ''
                                                                : 'text-[#555] opacity-40'
                                                        }`}
                                                        onClick={() =>
                                                            p.synthesis &&
                                                            cell?.status === 'done' &&
                                                            setSelectedCell(cell)
                                                        }
                                                    >
                                                        {p.synthesis ? <CellContent cell={cell} /> : '—'}
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
                        <div className="prose prose-sm max-w-none mb-6 text-[color:var(--text-2)] leading-relaxed">
                            <p className="whitespace-pre-wrap text-sm leading-relaxed">
                                {selectedCell.answer}
                            </p>
                        </div>
                        {selectedCell.citations && selectedCell.citations.length > 0 && (
                            <div className="mt-8 pt-8 border-t-2 border-[color:color-mix(in_oklch,var(--accent)_20%,transparent)]">
                                <h3 className="font-bold text-xs text-[color:var(--text)] mb-4 uppercase tracking-wider">
                                    Sources ({selectedCell.citations.length})
                                </h3>
                                <ul className="space-y-3">
                                    {selectedCell.citations.map(c => (
                                        <li
                                            key={c.id}
                                            className="text-xs text-[color:var(--text-2)] flex gap-3 p-3 rounded-lg bg-[color:color-mix(in_oklch,var(--surface)_60%,transparent)] hover:bg-[color:color-mix(in_oklch,var(--accent)_8%,transparent)] border border-[color:var(--line)] transition-all"
                                        >
                                            <span className="font-mono font-bold text-[color:var(--accent)] shrink-0 w-7">[{c.id}]</span>
                                            <span className="truncate leading-relaxed">{c.title}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
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

function CellContent({ cell }: { cell?: GridCell }) {
    if (!cell || cell.status === 'pending') {
        return <span className="text-[#444] text-[10px]">—</span>;
    }
    if (cell.status === 'running') {
        return (
            <div className="flex items-center gap-1.5 text-[10px] text-[#00d9ff]">
                <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />
                <span>Running</span>
            </div>
        );
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

    return (
        <div className="space-y-1">
            {cell.ragUsed && (
                <div className="inline-block">
                    <span className="inline-block px-1.5 py-0.5 rounded text-[8px] font-bold bg-[#00d9ff]/20 text-[#00d9ff] uppercase">
                        RAG
                    </span>
                </div>
            )}
            {isNoData && (
                <div className="inline-block">
                    <span className="inline-block px-1.5 py-0.5 rounded text-[8px] font-bold bg-[#888]/20 text-[#888] uppercase">
                        —
                    </span>
                </div>
            )}
            <p className={`text-[10px] leading-tight line-clamp-3 max-w-[150px] ${
                isNoData
                    ? 'text-[#888] italic'
                    : 'text-[#bbb]'
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
        </div>
    );
}
