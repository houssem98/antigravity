import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Brain, Loader2, Lock, CheckCircle, AlertCircle } from 'lucide-react';
import { confirmPasswordReset, supabase } from '../services/supabase';

const STRENGTH_LABELS = ['Very weak', 'Weak', 'Fair', 'Strong', 'Excellent'];
const STRENGTH_COLORS = ['#D96570', '#D96570', '#E0A038', '#4285F4', '#22C55E'];

function scorePassword(pw: string): number {
    let score = 0;
    if (pw.length >= 12) score++;
    if (pw.length >= 16) score++;
    const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length;
    if (classes >= 3) score++;
    if (classes === 4) score++;
    return Math.min(score, 4);
}

// When Supabase is the auth backend, the recovery link uses an #access_token
// hash that the Supabase client auto-consumes via detectSessionInUrl. In that
// mode there is no `?token=` query param — gating the form on `token` was
// what produced the "Missing or invalid reset link" error after migration.
const SUPABASE_AUTH =
    !import.meta.env.VITE_DEV_AUTH_BYPASS &&
    (import.meta.env.VITE_AUTH_BACKEND ?? 'gravity_api') === 'supabase';

export default function ResetPasswordPage() {
    const [params] = useSearchParams();
    const queryToken = params.get('token') ?? '';
    const navigate = useNavigate();

    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [done, setDone] = useState(false);
    const [hasSupabaseRecoverySession, setHasSupabaseRecoverySession] = useState(false);

    const score = useMemo(() => scorePassword(password), [password]);

    useEffect(() => {
        if (SUPABASE_AUTH) {
            // Surface any error in the recovery URL hash first (expired/used
            // link arrives as #error=access_denied&error_code=otp_expired&...).
            // Supabase's detectSessionInUrl won't create a session for these,
            // so polling getSession would silently time out with a misleading
            // "Missing or invalid" message.
            const rawHash = typeof window !== 'undefined' && window.location.hash
                ? window.location.hash.replace(/^#/, '')
                : '';
            const hashParams = new URLSearchParams(rawHash);
            const hashError =
                hashParams.get('error_description') ||
                hashParams.get('error_code') ||
                hashParams.get('error') ||
                '';
            if (hashError) {
                const msg = hashError.replace(/\+/g, ' ');
                const isExpired = /otp_expired|expired/i.test(hashError);
                setError(
                    isExpired
                        ? 'Reset link has expired or was already used. Request a fresh one from the forgot-password page.'
                        : `Reset link error: ${msg}. Request a fresh one.`,
                );
                // Strip the bad hash so a manual refresh doesn't repeat.
                window.history.replaceState(null, '', window.location.pathname + window.location.search);
                return;
            }

            // detectSessionInUrl consumes the recovery hash asynchronously and
            // fires a PASSWORD_RECOVERY event when ready. Polling getSession()
            // can miss the window, so subscribe to the auth state change and
            // also kick off a short polling fallback for the case where the
            // session was already established before the page mounted.
            // Static import = client already initialized by the time the
            // page mounts. detectSessionInUrl may have already processed the
            // hash and fired PASSWORD_RECOVERY before our listener attaches,
            // so do a synchronous getSession() first.
            const sub = supabase.auth.onAuthStateChange((event, session) => {
                if (event === 'PASSWORD_RECOVERY' || (session && event === 'SIGNED_IN')) {
                    setHasSupabaseRecoverySession(true);
                    setError('');
                }
            });

            let cancelled = false;
            (async () => {
                // Poll up to 10s in case session storage write races the mount.
                for (let i = 0; i < 50; i++) {
                    if (cancelled) return;
                    const { data } = await supabase.auth.getSession();
                    if (data.session) {
                        setHasSupabaseRecoverySession(true);
                        setError('');
                        return;
                    }
                    await new Promise(r => setTimeout(r, 200));
                }
                if (!cancelled) {
                    setError(prev => prev || 'Missing or invalid reset link. Request a new one.');
                }
            })();

            return () => {
                cancelled = true;
                sub.data.subscription.unsubscribe();
            };
        }
        // Legacy gravity-api token flow.
        if (!queryToken) {
            setError('Missing or invalid reset link. Request a new one.');
        }
    }, [queryToken]);

    const canSubmit = SUPABASE_AUTH ? hasSupabaseRecoverySession : !!queryToken;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        if (password !== confirm) {
            setError('Passwords do not match');
            return;
        }
        if (score < 3) {
            setError('Password too weak. Use 12+ chars with mixed case, digits, and symbols.');
            return;
        }
        setLoading(true);
        try {
            // queryToken is unused in Supabase mode — confirmPasswordReset
            // ignores it and calls supabase.auth.updateUser() instead.
            await confirmPasswordReset(queryToken, password);
            setDone(true);
            setTimeout(() => navigate('/auth', { replace: true }), 2200);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Reset failed. Link may be expired or already used.';
            setError(msg);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#070A12] flex items-center justify-center p-4">
            <div className="fixed inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[#4285F4]/5 rounded-full blur-3xl" />
                <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-[#9B72CB]/5 rounded-full blur-3xl" />
            </div>

            <div className="relative w-full max-w-md">
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-[#4285F4] via-[#9B72CB] to-[#D96570] mb-4">
                        <Brain className="w-8 h-8 text-white" />
                    </div>
                    <h1 className="text-2xl font-bold text-[#F4F6FF]">Reset password</h1>
                    <p className="text-[#A7B0C8] mt-1 text-sm">Pick a strong new password</p>
                </div>

                <div className="panel-bg panel-border rounded-2xl p-8">
                    {done ? (
                        <div className="text-center space-y-4">
                            <CheckCircle className="w-12 h-12 mx-auto text-emerald-400" />
                            <h2 className="text-lg font-medium text-[#F4F6FF]">Password updated</h2>
                            <p className="text-sm text-[#A7B0C8]">Redirecting you to login…</p>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <label className="block text-xs font-medium text-[#A7B0C8] mb-1.5">New password</label>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#A7B0C8]/50" />
                                    <input
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        placeholder="Min 12 characters, mixed case, digits, symbols"
                                        required
                                        minLength={12}
                                        className="w-full pl-10 pr-4 py-3 rounded-lg bg-[#0D1225] border border-[rgba(0,240,255,0.1)] text-[#F4F6FF] placeholder-[#A7B0C8]/30 text-sm focus:outline-none focus:border-[#00F0FF]/40 transition-colors"
                                    />
                                </div>
                                {password && (
                                    <div className="mt-2 flex items-center gap-2">
                                        <div className="flex-1 h-1.5 rounded-full bg-[#0D1225] overflow-hidden">
                                            <div
                                                className="h-full transition-all duration-300"
                                                style={{
                                                    width: `${(score + 1) * 20}%`,
                                                    background: STRENGTH_COLORS[score],
                                                }}
                                            />
                                        </div>
                                        <span className="text-xs font-medium" style={{ color: STRENGTH_COLORS[score] }}>
                                            {STRENGTH_LABELS[score]}
                                        </span>
                                    </div>
                                )}
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-[#A7B0C8] mb-1.5">Confirm</label>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#A7B0C8]/50" />
                                    <input
                                        type="password"
                                        value={confirm}
                                        onChange={(e) => setConfirm(e.target.value)}
                                        placeholder="Re-enter password"
                                        required
                                        minLength={12}
                                        className="w-full pl-10 pr-4 py-3 rounded-lg bg-[#0D1225] border border-[rgba(0,240,255,0.1)] text-[#F4F6FF] placeholder-[#A7B0C8]/30 text-sm focus:outline-none focus:border-[#00F0FF]/40 transition-colors"
                                    />
                                </div>
                            </div>

                            {error && (
                                <div className="space-y-2">
                                    <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                                        <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                                        <span>{error}</span>
                                    </div>
                                    {!canSubmit && (
                                        <Link
                                            to="/forgot-password"
                                            className="block text-center py-2 rounded-lg text-sm border border-[rgba(0,240,255,0.2)] text-[#00F0FF] hover:bg-[#0D1225]"
                                        >
                                            Request a fresh reset link →
                                        </Link>
                                    )}
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={loading || !canSubmit}
                                className="w-full flex items-center justify-center gap-2 py-3 rounded-lg font-medium text-sm transition-all disabled:opacity-50 bg-gradient-to-r from-[#4285F4] via-[#9B72CB] to-[#D96570] text-white hover:shadow-lg hover:shadow-[#9B72CB]/20"
                            >
                                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Update password'}
                            </button>
                        </form>
                    )}
                </div>

                <p className="text-center mt-6 text-xs text-[#A7B0C8]/50">
                    <Link to="/auth" className="hover:text-[#00F0FF] transition-colors">← Back to login</Link>
                </p>
            </div>
        </div>
    );
}
