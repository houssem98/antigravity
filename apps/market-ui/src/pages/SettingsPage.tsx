// Settings — server-configured API provider status.
// Keys live in market-server env (never in the browser). This page is a
// read-only status view so operators can see what's wired up.

import { useEffect, useState } from 'react';
import { Key, CheckCircle, XCircle, Loader2, ShieldCheck } from 'lucide-react';
import { fetchServerKeyStatus, type ServerKeyStatus } from '../services/apiKeys';

interface Row {
    id: keyof ServerKeyStatus['llm'] | 'tavily' | 'alphaVantage';
    name: string;
    env: string;
    desc: string;
    kind: 'llm' | 'data';
}

const ROWS: Row[] = [
    { id: 'anthropic',    name: 'Anthropic (Claude)', env: 'ANTHROPIC_API_KEY',     kind: 'llm',  desc: 'Claude Opus / Sonnet / Haiku for synthesis, extraction, and adversarial analysis' },
    { id: 'gemini',       name: 'Google Gemini',      env: 'GEMINI_API_KEY',        kind: 'llm',  desc: 'Gemini 2.5 Pro / Flash for planning and fast drafts (generous free tier)' },
    { id: 'deepseek',     name: 'DeepSeek',           env: 'DEEPSEEK_API_KEY',      kind: 'llm',  desc: 'DeepSeek V3 / R1 — chain-of-thought reasoning, cost-efficient' },
    { id: 'groq',         name: 'Groq',               env: 'GROQ_API_KEY',          kind: 'llm',  desc: 'Llama 3.3 / GPT-OSS / Qwen hosted on Groq (free tier fallback)' },
    { id: 'tavily',       name: 'Tavily Web Search',  env: 'TAVILY_API_KEY',        kind: 'data', desc: 'Web research + content extraction — required for Deep Research' },
    { id: 'alphaVantage', name: 'Alpha Vantage',      env: 'ALPHA_VANTAGE_API_KEY', kind: 'data', desc: 'Stock quotes and company overviews (optional — pipeline degrades gracefully)' },
];

export default function SettingsPage() {
    const [status, setStatus] = useState<ServerKeyStatus | null>(null);
    const [loading, setLoading]   = useState(true);
    const [error, setError]       = useState<string | null>(null);

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const s = await fetchServerKeyStatus(true);
            setStatus(s);
        } catch (e: any) {
            setError(e?.message || 'Could not reach market-server');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const isAvailable = (row: Row): boolean => {
        if (!status) return false;
        if (row.kind === 'llm') return status.llm[row.id as keyof ServerKeyStatus['llm']];
        return status[row.id as 'tavily' | 'alphaVantage'];
    };

    const anyLLM = status
        ? status.llm.anthropic || status.llm.gemini || status.llm.deepseek || status.llm.groq
        : false;
    const deepResearchReady = anyLLM && !!status?.tavily;

    return (
        <div className="p-8 max-w-4xl mx-auto">
            <div className="mb-8">
                <h1 className="text-3xl font-bold mb-2">Settings</h1>
                <p className="text-[color:var(--muted)]">
                    API keys live on the server (<code className="text-[color:var(--accent)]">market-server/.env</code>) — never in your browser.
                </p>
            </div>

            <div className="panel-bg panel-border rounded-2xl p-6 space-y-5">
                <div className="flex items-center gap-3 pb-4 border-b border-[color:var(--line)]">
                    <Key className="w-5 h-5 text-[color:var(--accent)]" />
                    <h2 className="text-xl font-semibold">Provider Status</h2>
                    {loading && <Loader2 className="w-4 h-4 animate-spin text-[color:var(--muted)] ml-auto" />}
                </div>

                {error && (
                    <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                        {error}
                    </div>
                )}

                {!loading && (
                    <div className={`flex items-center gap-3 rounded-xl p-3 text-sm ${
                        deepResearchReady
                            ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                            : 'bg-amber-500/10 border border-amber-500/20 text-amber-400'
                    }`}>
                        <ShieldCheck className="w-4 h-4" />
                        {deepResearchReady
                            ? 'Deep Research is ready — at least one LLM and Tavily are configured.'
                            : 'Deep Research needs at least one LLM provider AND Tavily configured on the server.'}
                    </div>
                )}

                <div className="divide-y divide-[color:var(--line)]">
                    {ROWS.map(row => {
                        const available = isAvailable(row);
                        return (
                            <div key={row.id} className="py-3 flex items-start gap-4">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium">{row.name}</span>
                                        <code className="text-xs text-[color:var(--muted)] bg-[color:var(--surface)] px-1.5 py-0.5 rounded">
                                            {row.env}
                                        </code>
                                    </div>
                                    <p className="text-xs text-[color:var(--muted)] mt-1">{row.desc}</p>
                                </div>
                                <div className="flex items-center gap-2 text-sm">
                                    {available ? (
                                        <>
                                            <CheckCircle className="w-4 h-4 text-green-500" />
                                            <span className="text-green-400">Configured</span>
                                        </>
                                    ) : (
                                        <>
                                            <XCircle className="w-4 h-4 text-[color:var(--muted)]" />
                                            <span className="text-[color:var(--muted)]">Not set</span>
                                        </>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="pt-4 border-t border-[color:var(--line)] flex items-center justify-between">
                    <p className="text-xs text-[color:var(--muted)]">
                        To add or rotate a key, edit <code>services/market-server/.env</code> and restart the server.
                    </p>
                    <button
                        onClick={load}
                        disabled={loading}
                        className="px-4 py-2 rounded-xl border border-[color:var(--line)] text-sm text-[color:var(--muted)] hover:text-[color:var(--text)] hover:border-[color:var(--accent)]/40 transition-all disabled:opacity-50"
                    >
                        Refresh
                    </button>
                </div>
            </div>

            <div className="mt-6 panel-bg panel-border rounded-xl p-4">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h3 className="text-sm font-medium mb-1">Two-factor authentication</h3>
                        <p className="text-xs text-[color:var(--muted)]">
                            Add a second factor (TOTP authenticator app) to your sign-in. Recommended.
                        </p>
                    </div>
                    <a
                        href="/settings/mfa"
                        className="shrink-0 px-4 py-2 rounded-xl border border-[color:var(--accent)]/40 text-sm text-[color:var(--accent)] hover:bg-[color:var(--accent)]/10 transition-all"
                    >
                        Set up 2FA
                    </a>
                </div>
            </div>

            <div className="mt-6 panel-bg panel-border rounded-xl p-4">
                <h3 className="text-sm font-medium mb-2">Security Model</h3>
                <p className="text-xs text-[color:var(--muted)] leading-relaxed">
                    All third-party API calls (LLM, Tavily, Alpha Vantage) are proxied through the authenticated
                    market-server. Your browser never sees provider keys, so there is no localStorage risk, no
                    key leak on shared machines, and key rotation is a single server-side config change.
                </p>
            </div>
        </div>
    );
}
