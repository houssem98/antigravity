import { useEffect, useState } from 'react';
import { Loader2, Save, Check, AlertCircle, RefreshCw, Trash2, Plus } from 'lucide-react';
import {
    adminGetConfig, adminUpdatePlans, adminUpdateProviders, adminUpdateWallets,
    adminListSubscriptions, adminListInvoices, adminConfirmInvoice, adminSetSubscription,
} from '../services/billing';

// ─── Shared ───────────────────────────────────────────────────────────────────

function SaveButton({ onClick, saving, saved }: { onClick: () => void; saving: boolean; saved: boolean }) {
    return (
        <button
            onClick={onClick}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[color:var(--accent)] text-black text-xs font-semibold disabled:opacity-50 hover:opacity-90"
        >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
            {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
        </button>
    );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
            <div className="px-5 py-3 border-b border-zinc-800 bg-zinc-900">
                <h2 className="font-semibold text-sm text-zinc-200">{title}</h2>
            </div>
            <div className="p-5">{children}</div>
        </div>
    );
}

function ErrMsg({ msg }: { msg: string }) {
    return (
        <div className="flex items-start gap-2 p-3 rounded-lg border border-red-500/20 bg-red-500/10 text-red-400 text-xs">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{msg}</span>
        </div>
    );
}

// ─── Plans editor ─────────────────────────────────────────────────────────────

function PlansEditor({ initial }: { initial: Record<string, any> }) {
    const [plans, setPlans] = useState<Record<string, any>>(structuredClone(initial));
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [err, setErr] = useState('');

    const setField = (planId: string, field: string, value: any) => {
        setPlans(prev => ({ ...prev, [planId]: { ...prev[planId], [field]: value } }));
        setSaved(false);
    };

    const setFeature = (planId: string, i: number, value: string) => {
        const features = [...(plans[planId].features ?? [])];
        features[i] = value;
        setField(planId, 'features', features);
    };

    const addFeature = (planId: string) => {
        setField(planId, 'features', [...(plans[planId].features ?? []), '']);
    };

    const removeFeature = (planId: string, i: number) => {
        const features = [...(plans[planId].features ?? [])];
        features.splice(i, 1);
        setField(planId, 'features', features);
    };

    const save = async () => {
        setSaving(true);
        setErr('');
        try {
            await adminUpdatePlans(plans);
            setSaved(true);
        } catch (e: any) {
            setErr(e?.message || 'Save failed');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-4">
            {err && <ErrMsg msg={err} />}
            {Object.entries(plans).map(([planId, plan]) => (
                <div key={planId} className="p-4 rounded-xl border border-zinc-700 bg-zinc-800/50 space-y-3">
                    <div className="flex items-center gap-3">
                        <span className="text-xs font-mono text-zinc-500 w-12">{planId}</span>
                        <input
                            value={plan.name}
                            onChange={e => setField(planId, 'name', e.target.value)}
                            className="flex-1 px-2 py-1 rounded bg-zinc-900 border border-zinc-700 text-sm text-zinc-200 focus:outline-none focus:border-[color:var(--accent)]"
                            placeholder="Plan name"
                        />
                        <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={plan.active ?? true}
                                onChange={e => setField(planId, 'active', e.target.checked)}
                                className="w-3.5 h-3.5"
                            />
                            Active
                        </label>
                        <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={plan.highlight ?? false}
                                onChange={e => setField(planId, 'highlight', e.target.checked)}
                                className="w-3.5 h-3.5"
                            />
                            Highlight
                        </label>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                        <div>
                            <p className="text-[10px] text-zinc-500 mb-1">Price (USD/mo)</p>
                            <input
                                type="number"
                                value={plan.price_usd}
                                onChange={e => setField(planId, 'price_usd', parseFloat(e.target.value) || 0)}
                                className="w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-700 text-sm text-zinc-200 focus:outline-none focus:border-[color:var(--accent)]"
                            />
                        </div>
                        <div>
                            <p className="text-[10px] text-zinc-500 mb-1">Period label</p>
                            <input
                                value={plan.period}
                                onChange={e => setField(planId, 'period', e.target.value)}
                                className="w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-700 text-sm text-zinc-200 focus:outline-none focus:border-[color:var(--accent)]"
                                placeholder="/ mo"
                            />
                        </div>
                        <div>
                            <p className="text-[10px] text-zinc-500 mb-1">Searches/day (-1 = ∞)</p>
                            <input
                                type="number"
                                value={plan.limits?.searches_per_day ?? -1}
                                onChange={e => setField(planId, 'limits', { ...plan.limits, searches_per_day: parseInt(e.target.value) })}
                                className="w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-700 text-sm text-zinc-200 focus:outline-none focus:border-[color:var(--accent)]"
                            />
                        </div>
                    </div>
                    <div>
                        <p className="text-[10px] text-zinc-500 mb-1">Description</p>
                        <input
                            value={plan.description}
                            onChange={e => setField(planId, 'description', e.target.value)}
                            className="w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-700 text-sm text-zinc-200 focus:outline-none focus:border-[color:var(--accent)]"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <p className="text-[10px] text-zinc-500">Features</p>
                        {(plan.features ?? []).map((f: string, i: number) => (
                            <div key={i} className="flex items-center gap-1.5">
                                <input
                                    value={f}
                                    onChange={e => setFeature(planId, i, e.target.value)}
                                    className="flex-1 px-2 py-1 rounded bg-zinc-900 border border-zinc-700 text-xs text-zinc-200 focus:outline-none focus:border-[color:var(--accent)]"
                                />
                                <button onClick={() => removeFeature(planId, i)} className="p-1 text-zinc-600 hover:text-red-400">
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        ))}
                        <button onClick={() => addFeature(planId)} className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300">
                            <Plus className="w-3.5 h-3.5" /> Add feature
                        </button>
                    </div>
                </div>
            ))}
            <div className="flex justify-end">
                <SaveButton onClick={save} saving={saving} saved={saved} />
            </div>
        </div>
    );
}

// ─── Providers editor ─────────────────────────────────────────────────────────

function ProvidersEditor({ initial }: { initial: Record<string, any> }) {
    const [providers, setProviders] = useState<Record<string, any>>(structuredClone(initial));
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [err, setErr] = useState('');

    const set = (pid: string, field: string, value: any) => {
        setProviders(prev => ({ ...prev, [pid]: { ...prev[pid], [field]: value } }));
        setSaved(false);
    };

    const save = async () => {
        setSaving(true);
        setErr('');
        try {
            await adminUpdateProviders(providers);
            setSaved(true);
        } catch (e: any) {
            setErr(e?.message || 'Save failed');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-4">
            {err && <ErrMsg msg={err} />}
            {Object.entries(providers).map(([pid, p]) => (
                <div key={pid} className="p-4 rounded-xl border border-zinc-700 bg-zinc-800/50 space-y-3">
                    <div className="flex items-center gap-3">
                        <span className="text-xl">{p.icon}</span>
                        <span className="text-xs font-mono text-zinc-500 w-16">{pid}</span>
                        <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer ml-auto">
                            <input
                                type="checkbox"
                                checked={p.enabled ?? true}
                                onChange={e => set(pid, 'enabled', e.target.checked)}
                                className="w-3.5 h-3.5"
                            />
                            Enabled
                        </label>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                        <div>
                            <p className="text-[10px] text-zinc-500 mb-1">Label</p>
                            <input value={p.label} onChange={e => set(pid, 'label', e.target.value)}
                                className="w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-700 text-xs text-zinc-200 focus:outline-none focus:border-[color:var(--accent)]" />
                        </div>
                        <div>
                            <p className="text-[10px] text-zinc-500 mb-1">Sublabel</p>
                            <input value={p.sublabel} onChange={e => set(pid, 'sublabel', e.target.value)}
                                className="w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-700 text-xs text-zinc-200 focus:outline-none focus:border-[color:var(--accent)]" />
                        </div>
                        <div>
                            <p className="text-[10px] text-zinc-500 mb-1">Icon (emoji)</p>
                            <input value={p.icon} onChange={e => set(pid, 'icon', e.target.value)}
                                className="w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-700 text-xs text-zinc-200 focus:outline-none focus:border-[color:var(--accent)]" />
                        </div>
                    </div>
                    <div>
                        <p className="text-[10px] text-zinc-500 mb-1">Description</p>
                        <input value={p.description} onChange={e => set(pid, 'description', e.target.value)}
                            className="w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-700 text-xs text-zinc-200 focus:outline-none focus:border-[color:var(--accent)]" />
                    </div>
                    {pid === 'payoneer' && (
                        <div>
                            <p className="text-[10px] text-zinc-500 mb-1">Payoneer email</p>
                            <input value={p.email ?? ''} onChange={e => set(pid, 'email', e.target.value)}
                                className="w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-700 text-xs text-zinc-200 focus:outline-none focus:border-[color:var(--accent)]"
                                placeholder="your@payoneer.com" />
                        </div>
                    )}
                </div>
            ))}
            <div className="flex justify-end">
                <SaveButton onClick={save} saving={saving} saved={saved} />
            </div>
        </div>
    );
}

// ─── Wallets editor ───────────────────────────────────────────────────────────

function WalletsEditor({ initial }: { initial: Record<string, string> }) {
    const [wallets, setWallets] = useState<Record<string, string>>({ ...initial });
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [err, setErr] = useState('');

    const save = async () => {
        setSaving(true);
        setErr('');
        try {
            await adminUpdateWallets(wallets);
            setSaved(true);
        } catch (e: any) {
            setErr(e?.message || 'Save failed');
        } finally {
            setSaving(false);
        }
    };

    const LABELS: Record<string, string> = {
        BTC: 'Bitcoin (BTC)',
        ETH: 'Ethereum (ETH / USDT ERC20)',
        USDT_ERC20: 'USDT ERC20 (separate address if different from ETH)',
        USDT_TRC20: 'USDT TRC20 (Tron — lowest fees)',
    };

    return (
        <div className="space-y-4">
            {err && <ErrMsg msg={err} />}
            {Object.entries(wallets).map(([currency, addr]) => (
                <div key={currency}>
                    <p className="text-xs text-zinc-400 mb-1">{LABELS[currency] ?? currency}</p>
                    <input
                        value={addr}
                        onChange={e => { setWallets(w => ({ ...w, [currency]: e.target.value })); setSaved(false); }}
                        className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-xs text-zinc-200 font-mono focus:outline-none focus:border-[color:var(--accent)] placeholder-zinc-600"
                        placeholder={`Your ${currency} address…`}
                    />
                </div>
            ))}
            <div className="flex justify-end">
                <SaveButton onClick={save} saving={saving} saved={saved} />
            </div>
        </div>
    );
}

// ─── Subscriptions table ──────────────────────────────────────────────────────

function SubscriptionsTable() {
    const [items, setItems] = useState<any[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState('');
    const [editing, setEditing] = useState<string | null>(null);
    const [editPlan, setEditPlan] = useState('');
    const [editStatus, setEditStatus] = useState('');
    const [saving, setSaving] = useState(false);

    const load = async () => {
        setLoading(true);
        setErr('');
        try {
            const data = await adminListSubscriptions();
            setItems(data.items);
            setTotal(data.total);
        } catch (e: any) {
            setErr(e?.message || 'Load failed');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const startEdit = (item: any) => {
        setEditing(item.user_id);
        setEditPlan(item.plan);
        setEditStatus(item.status);
    };

    const saveEdit = async (user_id: string) => {
        setSaving(true);
        try {
            await adminSetSubscription(user_id, editPlan, editStatus);
            setEditing(null);
            await load();
        } catch (e: any) {
            setErr(e?.message || 'Save failed');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <p className="text-xs text-zinc-500">{total} total subscriptions</p>
                <button onClick={load} className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300">
                    <RefreshCw className="w-3 h-3" /> Refresh
                </button>
            </div>
            {err && <ErrMsg msg={err} />}
            {loading ? (
                <div className="flex items-center gap-2 text-zinc-500 text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="border-b border-zinc-800 text-zinc-500">
                                <th className="text-left py-2 pr-3 font-medium">User ID</th>
                                <th className="text-left py-2 pr-3 font-medium">Plan</th>
                                <th className="text-left py-2 pr-3 font-medium">Status</th>
                                <th className="text-left py-2 pr-3 font-medium">Provider</th>
                                <th className="text-left py-2 pr-3 font-medium">Updated</th>
                                <th className="text-left py-2 font-medium">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.map((item: any) => (
                                <tr key={item.user_id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                                    <td className="py-2 pr-3 font-mono text-zinc-400 max-w-[120px] truncate">{item.user_id}</td>
                                    <td className="py-2 pr-3">
                                        {editing === item.user_id ? (
                                            <input value={editPlan} onChange={e => setEditPlan(e.target.value)}
                                                className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-700 text-zinc-200 w-20" />
                                        ) : (
                                            <span className="text-zinc-200">{item.plan}</span>
                                        )}
                                    </td>
                                    <td className="py-2 pr-3">
                                        {editing === item.user_id ? (
                                            <input value={editStatus} onChange={e => setEditStatus(e.target.value)}
                                                className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-700 text-zinc-200 w-24" />
                                        ) : (
                                            <span className={item.status === 'active' ? 'text-emerald-400' : 'text-zinc-400'}>{item.status}</span>
                                        )}
                                    </td>
                                    <td className="py-2 pr-3 text-zinc-500 capitalize">{item.provider}</td>
                                    <td className="py-2 pr-3 text-zinc-600">{item.updated_at ? new Date(item.updated_at).toLocaleDateString() : '—'}</td>
                                    <td className="py-2">
                                        {editing === item.user_id ? (
                                            <div className="flex gap-1.5">
                                                <button onClick={() => saveEdit(item.user_id)} disabled={saving}
                                                    className="px-2 py-0.5 rounded bg-[color:var(--accent)] text-black text-xs font-medium disabled:opacity-50">
                                                    {saving ? '…' : 'Save'}
                                                </button>
                                                <button onClick={() => setEditing(null)}
                                                    className="px-2 py-0.5 rounded border border-zinc-700 text-zinc-400 text-xs">
                                                    Cancel
                                                </button>
                                            </div>
                                        ) : (
                                            <button onClick={() => startEdit(item)}
                                                className="px-2 py-0.5 rounded border border-zinc-700 text-zinc-400 text-xs hover:text-zinc-200">
                                                Edit
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                            {items.length === 0 && (
                                <tr><td colSpan={6} className="py-6 text-center text-zinc-600">No subscriptions yet</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

// ─── Crypto invoices table ────────────────────────────────────────────────────

function InvoicesTable() {
    const [items, setItems] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState('');
    const [confirming, setConfirming] = useState<string | null>(null);

    const load = async () => {
        setLoading(true);
        setErr('');
        try {
            const data = await adminListInvoices('pending_confirmation');
            setItems(data.items);
        } catch (e: any) {
            setErr(e?.message || 'Load failed');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const confirm = async (invoice_id: string) => {
        setConfirming(invoice_id);
        try {
            await adminConfirmInvoice(invoice_id);
            await load();
        } catch (e: any) {
            setErr(e?.message || 'Confirm failed');
        } finally {
            setConfirming(null);
        }
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <p className="text-xs text-zinc-500">Pending crypto invoices (need manual confirmation)</p>
                <button onClick={load} className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300">
                    <RefreshCw className="w-3 h-3" /> Refresh
                </button>
            </div>
            {err && <ErrMsg msg={err} />}
            {loading ? (
                <div className="flex items-center gap-2 text-zinc-500 text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="border-b border-zinc-800 text-zinc-500">
                                <th className="text-left py-2 pr-3 font-medium">Invoice ID</th>
                                <th className="text-left py-2 pr-3 font-medium">User</th>
                                <th className="text-left py-2 pr-3 font-medium">Plan</th>
                                <th className="text-left py-2 pr-3 font-medium">Currency</th>
                                <th className="text-left py-2 pr-3 font-medium">Amount</th>
                                <th className="text-left py-2 pr-3 font-medium">Tx Hash</th>
                                <th className="text-left py-2 font-medium">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.map((item: any) => (
                                <tr key={item.invoice_id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                                    <td className="py-2 pr-3 font-mono text-zinc-400 max-w-[80px] truncate">{item.invoice_id?.slice(0, 8)}…</td>
                                    <td className="py-2 pr-3 font-mono text-zinc-400 max-w-[80px] truncate">{item.user_id}</td>
                                    <td className="py-2 pr-3 text-zinc-200">{item.plan}</td>
                                    <td className="py-2 pr-3 text-zinc-400">{item.currency}</td>
                                    <td className="py-2 pr-3 text-zinc-200">${item.amount_usd}</td>
                                    <td className="py-2 pr-3 font-mono text-zinc-500 max-w-[100px] truncate">{item.tx_hash || '—'}</td>
                                    <td className="py-2">
                                        <button
                                            onClick={() => confirm(item.invoice_id)}
                                            disabled={confirming === item.invoice_id}
                                            className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium disabled:opacity-50"
                                        >
                                            {confirming === item.invoice_id ? '…' : 'Confirm'}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {items.length === 0 && (
                                <tr><td colSpan={7} className="py-6 text-center text-zinc-600">No pending invoices</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminBillingPage() {
    const [config, setConfig] = useState<Record<string, any> | null>(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState('');

    useEffect(() => {
        adminGetConfig()
            .then(setConfig)
            .catch(e => setErr(e?.message || 'Failed to load config — are you admin?'))
            .finally(() => setLoading(false));
    }, []);

    if (loading) {
        return (
            <div className="min-h-screen bg-[color:var(--bg)] flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
            </div>
        );
    }

    if (err || !config) {
        return (
            <div className="min-h-screen bg-[color:var(--bg)] flex items-center justify-center p-10">
                <div className="max-w-md text-center space-y-3">
                    <AlertCircle className="w-8 h-8 text-red-400 mx-auto" />
                    <p className="text-red-400 text-sm">{err || 'Config unavailable'}</p>
                    <p className="text-zinc-500 text-xs">Admin role required. Your account must have role=admin in the auth store.</p>
                </div>
            </div>
        );
    }

    const wallets = config.providers?.crypto?.wallets ?? {};

    return (
        <div className="min-h-screen bg-[color:var(--bg)] text-[color:var(--fg)] p-6 md:p-10">
            <div className="max-w-4xl mx-auto space-y-8">

                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Admin — Billing Config</h1>
                    <p className="text-zinc-500 text-sm mt-1">Changes apply immediately — no restart needed.</p>
                </div>

                <SectionCard title="Plans">
                    <PlansEditor initial={config.plans ?? {}} />
                </SectionCard>

                <SectionCard title="Payment Providers">
                    <ProvidersEditor initial={config.providers ?? {}} />
                </SectionCard>

                <SectionCard title="Crypto Wallets">
                    <WalletsEditor initial={wallets} />
                </SectionCard>

                <SectionCard title="Subscriptions">
                    <SubscriptionsTable />
                </SectionCard>

                <SectionCard title="Pending Crypto Invoices">
                    <InvoicesTable />
                </SectionCard>

            </div>
        </div>
    );
}
