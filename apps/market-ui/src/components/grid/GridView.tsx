// Grid Research View — Hebbia Matrix / AlphaSense Generative Grid analogue.
// Rows=tickers × Columns=analyst prompts. Each cell is an independent
// cancellable LLM call with per-cell status.

import { useState, useRef, useEffect } from 'react';
import { Play, X, Grid as GridIcon, Sparkles, Loader2, Check, AlertCircle, Download, Clock, Trash2 } from 'lucide-react';
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
    const abortRef = useRef<AbortController | null>(null);

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

        setState(s => updateCell(s, ticker, promptId, { status: 'running' }));

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
            setState(s => updateCell(s, ticker, promptId, cell));
            setEditingCell(null);
        } catch (e: any) {
            setState(s => updateCell(s, ticker, promptId, {
                status: 'error',
                error: e?.message ?? 'Unknown error',
            }));
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

    return (
        <div className="p-6 bg-[color:var(--bg)] text-[color:var(--text-2)]">
            <div className="max-w-[1400px] mx-auto">
                {/* Header */}
                <div className="flex items-center gap-3 mb-2">
                    <div className="w-8 h-8 rounded-sm flex items-center justify-center bg-[color:var(--accent)]">
                        <GridIcon className="w-4 h-4 text-[color:var(--accent-ink)]" />
                    </div>
                    <div>
                        <h1 className="font-display font-semibold text-h3 text-[color:var(--text)] tracking-tight">Research Grid</h1>
                        <p className="label mt-0.5">TICKERS × PROMPTS · ONE CITED ANSWER PER CELL</p>
                    </div>
                </div>

                {/* Config */}
                <div className="mt-5 p-4 rounded-sm bg-[color:var(--surface)] border border-[color:var(--line)]">
                    <label className="label block mb-1.5">Tickers (comma-separated)</label>
                    <input
                        type="text"
                        value={tickersInput}
                        onChange={e => setTickersInput(e.target.value)}
                        placeholder="NVDA, AAPL, MSFT"
                        disabled={running}
                        className="w-full px-3 py-2 rounded-sm text-sm bg-[color:var(--bg)] border border-[color:var(--line)] text-[color:var(--text)] placeholder:text-[color:var(--text-4)] focus:outline-none focus:border-[color:var(--accent)] disabled:opacity-50"
                    />

                    <label className="label block mt-4 mb-1.5">LLM Model</label>
                    <div className="flex gap-1.5 mb-4">
                        {['deepseek', 'claude', 'gemini'].map(model => (
                            <button
                                key={model}
                                onClick={() => setSelectedModel(model as 'deepseek' | 'claude' | 'gemini')}
                                disabled={running}
                                className={`px-3 py-1.5 rounded-sm text-xs font-medium transition-colors border ${
                                    selectedModel === model
                                        ? 'border-[color:var(--accent)] text-[color:var(--accent)] bg-[color:color-mix(in_oklch,var(--accent)_12%,transparent)]'
                                        : 'border-[color:var(--line)] text-[color:var(--text-3)] hover:text-[color:var(--text)] hover:border-[color:var(--line-strong)]'
                                } disabled:opacity-50`}
                            >
                                {model === 'deepseek' ? 'DeepSeek ($)' : model === 'claude' ? 'Claude ($$)' : 'Gemini (Free)'}
                            </button>
                        ))}
                    </div>

                    <label className="label block mt-4 mb-1.5">Analyst prompts</label>
                    <div className="flex flex-wrap gap-1.5">
                        {SEED_GRID_PROMPTS.map(p => {
                            const active = promptIds.includes(p.id);
                            return (
                                <button
                                    key={p.id}
                                    onClick={() => togglePrompt(p.id)}
                                    disabled={running}
                                    className={`px-2.5 py-1 rounded-sm text-xs transition-colors border ${active
                                        ? 'border-[color:var(--accent)] text-[color:var(--accent)] bg-[color:color-mix(in_oklch,var(--accent)_12%,transparent)]'
                                        : 'border-[color:var(--line)] text-[color:var(--text-3)] hover:text-[color:var(--text)] hover:border-[color:var(--line-strong)]'
                                        } disabled:opacity-50`}
                                >
                                    {p.label}
                                </button>
                            );
                        })}
                    </div>

                    <div className="flex items-center gap-3 mt-4">
                        {!running ? (
                            <button
                                onClick={startRun}
                                disabled={!tickersInput.trim() || activePrompts.length === 0}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-sm font-medium bg-[color:var(--accent)] text-[color:var(--accent-ink)] hover:opacity-90 disabled:opacity-40 transition-opacity"
                            >
                                <Play className="w-3.5 h-3.5" />
                                Run grid
                            </button>
                        ) : (
                            <button
                                onClick={cancelRun}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-sm text-[color:var(--down)] border border-[color:var(--down)] hover:bg-[color:color-mix(in_oklch,var(--down)_12%,transparent)] transition-colors"
                            >
                                <X className="w-3.5 h-3.5" />
                                Cancel
                            </button>
                        )}
                        {progress && (
                            <span className="label">
                                {progress.done}/{progress.total} DONE
                                {progress.failed > 0 && <span className="down"> · {progress.failed} FAILED</span>}
                                {progress.cancelled > 0 && <span className="text-[color:var(--text-3)]"> · {progress.cancelled} CANCELLED</span>}
                            </span>
                        )}

                        <div className="flex-1" />

                        {state && !running && progress && progress.done > 0 && (
                            <>
                                <button
                                    onClick={handleExportCSV}
                                    title="Export CSV"
                                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm text-xs text-[color:var(--text-2)] border border-[color:var(--line)] hover:text-[color:var(--text)] hover:border-[color:var(--line-strong)] transition-colors"
                                >
                                    <Download className="w-3.5 h-3.5" />
                                    CSV
                                </button>
                                <button
                                    onClick={handleExportXLSX}
                                    title="Export Excel (formatted, with Sources sheet)"
                                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm text-xs text-[color:var(--accent-ink)] bg-[color:var(--accent)] hover:opacity-90 transition-opacity"
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

                {/* Grid */}
                {state && (
                    <div className="mt-5 rounded-sm border border-[color:var(--line)] overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="bg-[color:var(--surface-2)] border-b-2 border-[color:var(--line)]">
                                        <th className="sticky left-0 z-20 px-4 py-3 text-left font-semibold text-xs text-[color:var(--text)] bg-[color:var(--surface-2)] min-w-[90px]">
                                            TICKER
                                        </th>
                                        {state.def.prompts.map(p => (
                                            <th
                                                key={p.id}
                                                className={`px-4 py-3 text-left font-semibold text-xs text-[color:var(--text)] ${
                                                    p.synthesis
                                                        ? 'bg-[color:color-mix(in_oklch,var(--accent)_8%,transparent)]'
                                                        : 'bg-[color:var(--surface-2)]'
                                                }`}
                                                style={{ minWidth: p.synthesis ? '280px' : '220px' }}
                                            >
                                                {p.label}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[color:var(--line)]">
                                    {state.def.tickers.map((ticker, idx) => (
                                        <tr
                                            key={ticker}
                                            className={`transition-colors ${
                                                idx % 2 === 0
                                                    ? 'bg-[color:var(--bg)]'
                                                    : 'bg-[color:color-mix(in_oklch,var(--surface)_50%,transparent)]'
                                            } hover:bg-[color:color-mix(in_oklch,var(--accent)_6%,transparent)]`}
                                        >
                                            <td className="sticky left-0 z-10 px-4 py-4 font-mono font-semibold text-sm text-[color:var(--accent)] border-r border-[color:var(--line)] bg-inherit">
                                                {ticker}
                                            </td>
                                            {state.def.prompts.map(p => {
                                                const cell = state.cells[cellKey(ticker, p.id)];
                                                return (
                                                    <td
                                                        key={p.id}
                                                        className={`px-4 py-4 align-top ${
                                                            cell?.status === 'done'
                                                                ? 'cursor-pointer hover:bg-[color:color-mix(in_oklch,var(--accent)_10%,transparent)]'
                                                                : ''
                                                        }`}
                                                        onClick={() => cell?.status === 'done' && setSelectedCell(cell)}
                                                    >
                                                        <CellContent cell={cell} />
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))}
                                    {/* Synthesis row (comparison) */}
                                    {state.def.prompts.some(p => p.synthesis) && (
                                        <tr className="bg-[color:color-mix(in_oklch,var(--accent)_12%,transparent)] border-t-2 border-[color:var(--accent)]">
                                            <td className="sticky left-0 z-10 px-4 py-4 font-mono font-semibold text-sm text-[color:var(--accent)] border-r border-[color:var(--line)] bg-inherit flex items-center gap-2">
                                                <span className="inline-block w-2 h-2 rounded-full bg-[color:var(--accent)]" />
                                                COMPARISON
                                            </td>
                                            {state.def.prompts.map(p => {
                                                const cell = state.cells[cellKey('ALL', p.id)];
                                                return (
                                                    <td
                                                        key={p.id}
                                                        className={`px-4 py-4 align-top ${
                                                            p.synthesis
                                                                ? cell?.status === 'done'
                                                                    ? 'cursor-pointer hover:bg-[color:color-mix(in_oklch,var(--accent)_8%,transparent)]'
                                                                    : ''
                                                                : 'text-[color:var(--text-3)] opacity-50'
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
                    className="fixed inset-0 z-50 flex items-center justify-center p-6"
                    style={{ background: 'color-mix(in oklch, var(--bg) 70%, transparent)' }}
                    onClick={() => setSelectedCell(null)}
                >
                    <div
                        className="max-w-2xl w-full max-h-[80vh] overflow-y-auto rounded-sm p-5 bg-[color:var(--surface)] border border-[color:var(--line)]"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-start justify-between mb-3">
                            <div>
                                <div className="label">{selectedCell.ticker}</div>
                                <div className="font-display text-h4 font-medium text-[color:var(--text)]">
                                    {SEED_GRID_PROMPTS.find(p => p.id === selectedCell.promptId)?.label}
                                </div>
                            </div>
                            <button
                                onClick={() => setSelectedCell(null)}
                                className="p-1 rounded-sm text-[color:var(--text-3)] hover:text-[color:var(--text)] hover:bg-[color:var(--surface-2)]"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="text-sm text-[color:var(--text-2)] whitespace-pre-wrap leading-relaxed">
                            {selectedCell.answer}
                        </div>
                        {selectedCell.citations && selectedCell.citations.length > 0 && (
                            <div className="mt-4 border-t border-[color:var(--line)] pt-3">
                                <div className="label mb-1.5">SOURCES ({selectedCell.citations.length})</div>
                                <ul className="space-y-1">
                                    {selectedCell.citations.map(c => (
                                        <li key={c.id} className="text-xs text-[color:var(--text-3)] flex gap-1.5">
                                            <span className="text-[color:var(--accent)] font-mono shrink-0">[{c.id}]</span>
                                            <span className="truncate">{c.title}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        {selectedCell.durationMs && (
                            <div className="mt-3 label flex items-center gap-2">
                                <span>{(selectedCell.durationMs / 1000).toFixed(1)}S · {selectedCell.modelUsed}</span>
                                {selectedCell.ragUsed && (
                                    <span className="px-1.5 py-0.5 rounded-sm text-[10px] font-medium bg-[color:color-mix(in_oklch,var(--accent)_15%,transparent)] text-[color:var(--accent)] border border-[color:color-mix(in_oklch,var(--accent)_30%,transparent)]">
                                        SEC RAG
                                    </span>
                                )}
                            </div>
                        )}
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
                            className="mt-4 w-full px-3 py-2 rounded-sm text-sm font-medium bg-[color:var(--accent)] text-[color:var(--accent-ink)] hover:opacity-90 transition-opacity"
                        >
                            Edit & Re-run
                        </button>
                    </div>
                </div>
            )}

            {/* Cell edit modal */}
            {editingCell && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-6"
                    style={{ background: 'color-mix(in oklch, var(--bg) 70%, transparent)' }}
                    onClick={() => setEditingCell(null)}
                >
                    <div
                        className="max-w-2xl w-full max-h-[80vh] overflow-y-auto rounded-sm p-5 bg-[color:var(--surface)] border border-[color:var(--line)]"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-start justify-between mb-3">
                            <div>
                                <div className="label">{editingCell.ticker}</div>
                                <div className="font-display text-h4 font-medium text-[color:var(--text)]">
                                    Edit prompt
                                </div>
                            </div>
                            <button
                                onClick={() => setEditingCell(null)}
                                className="p-1 rounded-sm text-[color:var(--text-3)] hover:text-[color:var(--text)] hover:bg-[color:var(--surface-2)]"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <textarea
                            value={editPrompt}
                            onChange={e => setEditPrompt(e.target.value)}
                            className="w-full h-40 px-3 py-2 rounded-sm text-sm bg-[color:var(--bg)] border border-[color:var(--line)] text-[color:var(--text)] placeholder:text-[color:var(--text-4)] focus:outline-none focus:border-[color:var(--accent)] resize-none"
                            placeholder="Enter prompt..."
                        />
                        <div className="flex gap-2 mt-3">
                            <button
                                onClick={() => reRunCell(editingCell.ticker, editingCell.promptId, editPrompt)}
                                className="flex-1 px-3 py-2 rounded-sm text-sm font-medium bg-[color:var(--accent)] text-[color:var(--accent-ink)] hover:opacity-90 transition-opacity"
                            >
                                Re-run
                            </button>
                            <button
                                onClick={() => setEditingCell(null)}
                                className="px-3 py-2 rounded-sm text-sm font-medium border border-[color:var(--line)] text-[color:var(--text-2)] hover:text-[color:var(--text)] hover:border-[color:var(--line-strong)] transition-colors"
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
        return <span className="text-[color:var(--text-4)] text-xs">—</span>;
    }
    if (cell.status === 'running') {
        return (
            <div className="flex items-center gap-2.5 text-xs text-[color:var(--text-3)]">
                <Loader2 className="w-4 h-4 animate-spin flex-shrink-0 text-[color:var(--accent)]" />
                <span>Running…</span>
            </div>
        );
    }
    if (cell.status === 'error') {
        return (
            <div className="flex items-start gap-2 text-xs text-[color:var(--down)] title={cell.error}" title={cell.error}>
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span className="truncate max-w-xs">{cell.error || 'Error'}</span>
            </div>
        );
    }
    if (cell.status === 'cancelled') {
        return <span className="text-xs text-[color:var(--text-3)]">Cancelled</span>;
    }
    const excerpt = (cell.answer ?? '').slice(0, 180);
    return (
        <div className="space-y-1.5">
            {cell.ragUsed && (
                <div className="inline-flex gap-1">
                    <span className="inline-block px-2 py-1 rounded text-[10px] font-medium bg-[color:color-mix(in_oklch,var(--accent)_20%,transparent)] text-[color:var(--accent)]">
                        SEC RAG
                    </span>
                </div>
            )}
            <p className="text-sm text-[color:var(--text-2)] leading-snug line-clamp-4 max-w-xs">
                {excerpt}{(cell.answer ?? '').length > 180 ? '…' : ''}
            </p>
            {cell.durationMs && (
                <div className="flex items-center gap-1.5 text-[10px] text-[color:var(--text-4)]">
                    <span className="font-medium">{(cell.durationMs / 1000).toFixed(1)}s</span>
                    <span>•</span>
                    <span className="truncate">{cell.modelUsed}</span>
                </div>
            )}
        </div>
    );
}
