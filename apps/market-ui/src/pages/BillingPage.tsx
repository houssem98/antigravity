import { useEffect, useState } from 'react';
import {
    Check, CreditCard, ExternalLink, Loader2, AlertCircle,
    Zap, Copy, CheckCheck, ChevronDown, ChevronUp,
} from 'lucide-react';
import {
    getBillingConfig, getMySubscription, createCheckout, createPortalSession, confirmCryptoTx,
    type SubscriptionStatus, type BillingConfig, type ProviderConfig,
    type PlanConfig, type CheckoutResponse, type PayoneerInfo,
} from '../services/billing';

// ─── small helpers ────────────────────────────────────────────────────────────

function StatusBadge({ status, plan }: { status: string; plan: string }) {
    const colors: Record<string, string> = {
        active:   'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
        trialing: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
        past_due: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
        canceled: 'bg-red-500/10 text-red-400 border-red-500/20',
        none:     'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
    };
    const label = status === 'none' ? 'Free plan' : `${plan} · ${status}`;
    return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${colors[status] ?? colors.none}`}>
            <span className="w-1.5 h-1.5 rounded-full bg-current" />
            {label}
        </span>
    );
}

function CopyButton({ text }: { text: string }) {
    const [copied, setCopied] = useState(false);
    const copy = () => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };
    return (
        <button onClick={copy} className="p-1.5 rounded hover:bg-zinc-700 transition-colors text-zinc-400 hover:text-zinc-200">
            {copied ? <CheckCheck className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
    );
}

// ─── Crypto result panel ──────────────────────────────────────────────────────

function CryptoPanel({ result, onConfirm }: {
    result: CheckoutResponse;
    onConfirm: (txHash: string) => Promise<void>;
}) {
    const [txHash, setTxHash] = useState('');
    const [confirming, setConfirming] = useState(false);
    const [confirmed, setConfirmed] = useState(false);
    const [err, setErr] = useState('');

    const submit = async () => {
        if (!txHash.trim()) return;
        setConfirming(true);
        setErr('');
        try {
            await onConfirm(txHash.trim());
            setConfirmed(true);
        } catch (e: any) {
            setErr(e?.message || 'Error');
        } finally {
            setConfirming(false);
        }
    };

    return (
        <div className="space-y-5 p-5 rounded-xl border border-zinc-700 bg-zinc-900">
            <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm">Crypto Payment</h3>
                <span className="text-xs text-zinc-400">{result.currency} · ${result.amount_usd}</span>
            </div>

            {result.url && (
                <a href={result.url} target="_blank" rel="noreferrer"
                   className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-[color:var(--accent)] text-black font-semibold text-sm hover:opacity-90">
                    <ExternalLink className="w-4 h-4" />
                    Pay via Coinbase Commerce
                </a>
            )}

            <div className="space-y-2">
                <p className="text-xs text-zinc-400">Or send directly to wallet:</p>
                <div className="flex items-center gap-2 p-3 rounded-lg bg-zinc-800 border border-zinc-700">
                    <code className="text-xs text-zinc-200 flex-1 break-all">{result.wallet}</code>
                    <CopyButton text={result.wallet ?? ''} />
                </div>
            </div>

            {result.qr_data && (
                <div className="flex justify-center">
                    <img src={result.qr_data} alt="Wallet QR" className="w-36 h-36 rounded-lg border border-zinc-700" />
                </div>
            )}

            <div className="border-t border-zinc-800 pt-4 space-y-3">
                <p className="text-xs text-zinc-400">After sending, paste your transaction hash:</p>
                <input
                    value={txHash}
                    onChange={e => setTxHash(e.target.value)}
                    placeholder="0x... or txid..."
                    className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-[color:var(--accent)]"
                />
                {err && <p className="text-xs text-red-400">{err}</p>}
                {confirmed ? (
                    <div className="flex items-center gap-2 text-emerald-400 text-sm">
                        <CheckCheck className="w-4 h-4" /> Tx submitted — activating within 1 confirmation
                    </div>
                ) : (
                    <button
                        onClick={submit}
                        disabled={confirming || !txHash.trim()}
                        className="w-full py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-sm font-medium disabled:opacity-40 flex items-center justify-center gap-2"
                    >
                        {confirming && <Loader2 className="w-4 h-4 animate-spin" />}
                        Submit transaction hash
                    </button>
                )}
            </div>

            <div className="text-xs text-zinc-500 space-y-0.5">
                <p>Invoice ID: <code>{result.invoice_id}</code></p>
                <p>Save this ID for support.</p>
            </div>
        </div>
    );
}

// ─── Payoneer result panel ────────────────────────────────────────────────────

function PayoneerPanel({ info }: { info: PayoneerInfo }) {
    const [open, setOpen] = useState(true);
    return (
        <div className="space-y-3 p-5 rounded-xl border border-zinc-700 bg-zinc-900">
            <button className="flex items-center justify-between w-full" onClick={() => setOpen(o => !o)}>
                <h3 className="font-semibold text-sm">Payoneer Transfer Instructions</h3>
                {open ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
            </button>
            {open && (
                <>
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-zinc-800 border border-zinc-700">
                        <code className="text-sm text-[color:var(--accent)] flex-1">{info.send_to_email}</code>
                        <CopyButton text={info.send_to_email} />
                    </div>
                    <div className="text-xs font-mono bg-zinc-800 rounded-lg p-3 space-y-1.5 border border-zinc-700">
                        <p className="text-zinc-400 mb-2">Amount: <span className="text-white font-bold">${info.amount_usd} USD</span></p>
                        {info.instructions.map((step, i) => (
                            <p key={i} className="text-zinc-300">
                                <span className="text-zinc-500 mr-2">{i + 1}.</span>{step}
                            </p>
                        ))}
                    </div>
                    <p className="text-xs text-zinc-500">
                        Plan activates within 24h after we confirm receipt.
                        Email us with your Payoneer transaction ID if not activated.
                    </p>
                </>
            )}
        </div>
    );
}

// ─── Plan card ────────────────────────────────────────────────────────────────

function PlanCard({
    planId, plan, isCurrent, isSelected, onSelect,
}: {
    planId: string;
    plan: PlanConfig;
    isCurrent: boolean;
    isSelected: boolean;
    onSelect: (id: string) => void;
}) {
    const price = plan.price_usd === 0 ? '$0' : `$${plan.price_usd}`;
    return (
        <div
            onClick={() => planId !== 'free' && onSelect(planId)}
            className={`relative flex flex-col rounded-2xl border p-6 transition-all cursor-pointer ${
                plan.highlight
                    ? 'border-[color:var(--accent)] bg-[color:var(--accent)]/5'
                    : 'border-zinc-800 bg-zinc-900/40'
            } ${isCurrent ? 'ring-2 ring-[color:var(--accent)]' : ''} ${
                isSelected && !isCurrent ? 'ring-2 ring-white/30' : ''
            } ${planId === 'free' ? 'cursor-default' : 'hover:border-zinc-600'}`}
        >
            {plan.highlight && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="flex items-center gap-1 px-3 py-0.5 rounded-full text-xs font-semibold bg-[color:var(--accent)] text-black">
                        <Zap className="w-3 h-3" /> Most popular
                    </span>
                </div>
            )}
            <div className="space-y-1 mb-6">
                <h2 className="text-lg font-semibold">{plan.name}</h2>
                <p className="text-zinc-400 text-sm">{plan.description}</p>
                <div className="flex items-baseline gap-1 pt-2">
                    <span className="text-3xl font-bold">{price}</span>
                    <span className="text-zinc-400 text-sm">{plan.period}</span>
                </div>
            </div>
            <ul className="space-y-2.5 flex-1 mb-6">
                {plan.features.map(f => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                        <Check className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                        <span className="text-zinc-300">{f}</span>
                    </li>
                ))}
            </ul>
            {isCurrent ? (
                <div className="w-full py-2 rounded-lg border border-zinc-700 text-center text-sm text-zinc-400">
                    Current plan
                </div>
            ) : planId === 'free' ? (
                <div className="w-full py-2 rounded-lg border border-zinc-800 text-center text-sm text-zinc-600">
                    Free forever
                </div>
            ) : (
                <div className={`w-full py-2 rounded-lg border text-center text-sm font-medium transition-colors ${
                    isSelected
                        ? 'border-[color:var(--accent)] text-[color:var(--accent)] bg-[color:var(--accent)]/10'
                        : 'border-zinc-700 text-zinc-300 hover:border-zinc-500'
                }`}>
                    {isSelected ? '✓ Selected' : `Select ${plan.name}`}
                </div>
            )}
        </div>
    );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const PROVIDER_SETUP_HINTS: Record<string, string> = {
    'PayPal not configured': 'Add PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET to services/gravity-api/.env and restart the API.',
    'Paddle not configured': 'Add PADDLE_API_KEY to services/gravity-api/.env and restart the API.',
    'Wallet not configured': 'Add your crypto wallet address (e.g. CRYPTO_WALLET_USDT_TRC20) to services/gravity-api/.env and restart the API.',
};

function friendlyError(msg: string): string {
    for (const [key, hint] of Object.entries(PROVIDER_SETUP_HINTS)) {
        if (msg.includes(key)) return hint;
    }
    return msg;
}

export default function BillingPage() {
    const [config, setConfig] = useState<BillingConfig | null>(null);
    const [sub, setSub] = useState<SubscriptionStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
    const [selectedProvider, setSelectedProvider] = useState<string>('paddle');
    const [selectedCrypto, setSelectedCrypto] = useState<string>('USDT_TRC20');

    const [checkingOut, setCheckingOut] = useState(false);
    const [openingPortal, setOpeningPortal] = useState(false);
    const [checkoutResult, setCheckoutResult] = useState<CheckoutResponse | null>(null);

    useEffect(() => {
        Promise.all([
            getBillingConfig(),
            getMySubscription().catch(() => ({
                plan: 'free', status: 'none', provider: 'none',
                current_period_end: null, cancel_at_period_end: false, customer_id: null,
            })),
        ]).then(([cfg, s]) => {
            setConfig(cfg);
            setSub(s as SubscriptionStatus);
            // Default to first enabled paid provider
            const firstProvider = cfg.providers.find(p => p.id !== 'free');
            if (firstProvider) setSelectedProvider(firstProvider.id);
        }).finally(() => setLoading(false));
    }, []);

    const currentPlan = sub?.plan ?? 'free';

    const handleCheckout = async () => {
        if (!selectedPlan || selectedPlan === 'free') return;
        setCheckingOut(true);
        setError(null);
        setCheckoutResult(null);
        try {
            const result = await createCheckout(
                selectedPlan,
                selectedProvider,
                selectedProvider === 'crypto' ? selectedCrypto : undefined,
            );
            if (result.url && selectedProvider !== 'crypto' && selectedProvider !== 'payoneer') {
                window.location.href = result.url;
            } else {
                setCheckoutResult(result);
            }
        } catch (e: any) {
            setError(friendlyError(e?.message || 'Checkout failed'));
        } finally {
            setCheckingOut(false);
        }
    };

    const handlePortal = async () => {
        setOpeningPortal(true);
        try {
            const { url } = await createPortalSession();
            window.open(url, '_blank');
        } catch (e: any) {
            setError(e?.message || 'Could not open billing portal');
        } finally {
            setOpeningPortal(false);
        }
    };

    const handleCryptoConfirm = async (txHash: string) => {
        if (!checkoutResult?.invoice_id) throw new Error('No invoice');
        await confirmCryptoTx(checkoutResult.invoice_id, txHash);
    };

    const canCheckout = selectedPlan && selectedPlan !== 'free' && selectedPlan !== currentPlan;

    const activePlans = config
        ? Object.entries(config.plans).filter(([, p]) => p.active)
        : [];

    const activeProviders: ProviderConfig[] = config?.providers ?? [];

    const selectedProviderCfg = activeProviders.find(p => p.id === selectedProvider);
    const cryptoCurrencies = selectedProviderCfg?.currencies ?? ['USDT_TRC20', 'USDT_ERC20', 'ETH', 'BTC'];
    const selectedPlanCfg = selectedPlan && config ? config.plans[selectedPlan] : null;

    return (
        <div className="min-h-screen bg-[color:var(--bg)] text-[color:var(--fg)] p-6 md:p-10">
            <div className="max-w-5xl mx-auto space-y-10">

                {/* Header */}
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Billing &amp; Plans</h1>
                    <p className="text-zinc-400 text-sm mt-1">Choose a plan and payment method.</p>
                </div>

                {/* Current status */}
                {!loading && sub && (
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-zinc-800 bg-zinc-900/50">
                        <div className="flex items-center gap-3">
                            <CreditCard className="w-5 h-5 text-zinc-400" />
                            <div className="space-y-0.5">
                                <StatusBadge status={sub.status} plan={sub.plan} />
                                {sub.provider && sub.provider !== 'none' && (
                                    <p className="text-xs text-zinc-500 capitalize">via {sub.provider}</p>
                                )}
                            </div>
                        </div>
                        {sub.customer_id && sub.provider === 'paddle' && (
                            <button
                                onClick={handlePortal}
                                disabled={openingPortal}
                                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-zinc-700 text-sm hover:bg-zinc-800 transition-colors disabled:opacity-50"
                            >
                                {openingPortal ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                                Manage / invoices
                            </button>
                        )}
                    </div>
                )}

                {loading && (
                    <div className="flex items-center gap-2 text-zinc-500">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-sm">Loading…</span>
                    </div>
                )}

                {/* Plan cards */}
                {!loading && (
                    <div className={`grid grid-cols-1 gap-6 ${activePlans.length >= 3 ? 'md:grid-cols-3' : activePlans.length === 2 ? 'md:grid-cols-2' : ''}`}>
                        {activePlans.map(([planId, plan]) => (
                            <PlanCard
                                key={planId}
                                planId={planId}
                                plan={plan}
                                isCurrent={planId === currentPlan}
                                isSelected={selectedPlan === planId}
                                onSelect={setSelectedPlan}
                            />
                        ))}
                    </div>
                )}

                {/* Payment method + checkout */}
                {selectedPlan && selectedPlan !== 'free' && selectedPlan !== currentPlan && (
                    <div className="space-y-6 p-6 rounded-2xl border border-zinc-800 bg-zinc-900/40">
                        <h2 className="font-semibold text-sm text-zinc-300">
                            Payment method
                            {selectedPlanCfg && (
                                <span className="ml-2 text-[color:var(--accent)]">
                                    — {selectedPlanCfg.name} ${selectedPlanCfg.price_usd}{selectedPlanCfg.period}
                                </span>
                            )}
                        </h2>

                        {/* Provider grid */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {activeProviders.map(m => (
                                <button
                                    key={m.id}
                                    onClick={() => { setSelectedProvider(m.id); setCheckoutResult(null); setError(null); }}
                                    className={`flex flex-col items-center gap-2 p-4 rounded-xl border text-center transition-all ${
                                        selectedProvider === m.id
                                            ? 'border-[color:var(--accent)] bg-[color:var(--accent)]/10 text-[color:var(--accent)]'
                                            : 'border-zinc-700 hover:border-zinc-500 text-zinc-300'
                                    }`}
                                >
                                    <span className="text-2xl">{m.icon}</span>
                                    <div>
                                        <p className="text-xs font-semibold">{m.label}</p>
                                        <p className="text-[10px] text-zinc-500 mt-0.5">{m.sublabel}</p>
                                    </div>
                                </button>
                            ))}
                        </div>

                        {/* Provider description */}
                        {selectedProviderCfg && (
                            <p className="text-xs text-zinc-400">{selectedProviderCfg.description}</p>
                        )}

                        {/* Crypto currency selector */}
                        {selectedProvider === 'crypto' && (
                            <div className="space-y-2">
                                <p className="text-xs text-zinc-400 font-medium">Select currency:</p>
                                <div className="grid grid-cols-2 gap-2">
                                    {cryptoCurrencies.map(c => (
                                        <button
                                            key={c}
                                            onClick={() => setSelectedCrypto(c)}
                                            className={`flex items-center gap-2 p-3 rounded-lg border text-left text-xs transition-all ${
                                                selectedCrypto === c
                                                    ? 'border-[color:var(--accent)] bg-[color:var(--accent)]/10'
                                                    : 'border-zinc-700 hover:border-zinc-500'
                                            }`}
                                        >
                                            <span className="font-bold text-zinc-200">{c.replace('_', ' ')}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Inline error */}
                        {error && (
                            <div className="flex items-start gap-2 p-3 rounded-lg border border-red-500/20 bg-red-500/10 text-red-400 text-xs">
                                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                                <span>{error}</span>
                            </div>
                        )}

                        {/* Checkout button */}
                        {!checkoutResult && (
                            <button
                                onClick={handleCheckout}
                                disabled={checkingOut || !canCheckout}
                                className="w-full py-3 rounded-xl bg-[color:var(--accent)] text-black font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {checkingOut ? (
                                    <><Loader2 className="w-4 h-4 animate-spin" /> Processing…</>
                                ) : selectedProvider === 'payoneer' ? (
                                    'Get Payment Instructions'
                                ) : selectedProvider === 'crypto' ? (
                                    `Generate ${selectedCrypto} Invoice`
                                ) : (
                                    `Pay with ${selectedProviderCfg?.label ?? selectedProvider}`
                                )}
                            </button>
                        )}

                        {/* Try again */}
                        {error && checkoutResult === null && (
                            <button
                                onClick={() => setError(null)}
                                className="w-full py-2 rounded-lg border border-zinc-700 text-zinc-400 text-xs hover:bg-zinc-800 transition-colors"
                            >
                                Try again
                            </button>
                        )}

                        {/* Result panels */}
                        {checkoutResult && selectedProvider === 'crypto' && (
                            <CryptoPanel result={checkoutResult} onConfirm={handleCryptoConfirm} />
                        )}
                        {checkoutResult && selectedProvider === 'payoneer' && checkoutResult.manual_info && (
                            <PayoneerPanel info={checkoutResult.manual_info} />
                        )}
                    </div>
                )}

                {/* FAQ */}
                <div className="pt-4 border-t border-zinc-800 space-y-4">
                    <h3 className="text-sm font-medium text-zinc-400">FAQ</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm text-zinc-400">
                        {[
                            ['Can I cancel anytime?', 'Yes. Cancel via billing portal. Access stays until period ends.'],
                            ['What cards are accepted?', 'Visa, Mastercard, Amex via Paddle. PayPal linked card also works.'],
                            ['How fast is crypto activation?', 'Coinbase Commerce: instant on confirmation. Manual wallet: within 24h after tx hash submitted.'],
                            ['Payoneer how long?', 'Within 24h after we confirm receipt. Email us your transaction ID.'],
                            ['Need > 5 seats?', 'Contact us for enterprise pricing.'],
                            ['Is there a free trial?', 'Free tier is unlimited time. Cancel before renewal if needed.'],
                        ].map(([q, a]) => (
                            <div key={q}>
                                <p className="text-zinc-300 font-medium mb-1">{q}</p>
                                <p>{a}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
