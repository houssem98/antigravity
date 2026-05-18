import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
    Loader2, ShieldCheck, AlertCircle, Copy, Check, Download, ArrowRight,
} from 'lucide-react';
import {
    mfaEnroll, mfaVerify, mfaQrUrl, getSession,
    type MfaEnrollResponse,
} from '../services/supabase';

type Stage = 'loading' | 'scan' | 'verify' | 'codes' | 'error';

export default function MfaSetupPage() {
    const navigate = useNavigate();
    const [stage, setStage] = useState<Stage>('loading');
    const [enrollment, setEnrollment] = useState<MfaEnrollResponse | null>(null);
    const [email, setEmail] = useState('');
    const [code, setCode] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        (async () => {
            try {
                const session = await getSession() as { user?: { email?: string } } | null;
                if (!session) {
                    navigate('/auth', { replace: true });
                    return;
                }
                setEmail(session.user?.email ?? '');
                const data = await mfaEnroll();
                setEnrollment(data);
                setStage('scan');
            } catch (err) {
                const msg = err instanceof Error ? err.message : 'Failed to start MFA setup';
                setError(msg);
                setStage('error');
            }
        })();
    }, [navigate]);

    const handleVerify = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!enrollment) return;
        setError('');
        setBusy(true);
        try {
            const res = await mfaVerify(enrollment.secret, code.trim());
            setRecoveryCodes(res.recovery_codes);
            setStage('codes');
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Invalid code';
            setError(msg);
        } finally {
            setBusy(false);
        }
    };

    const copyAllCodes = async () => {
        await navigator.clipboard.writeText(recoveryCodes.join('\n'));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const downloadCodes = () => {
        const body = [
            'AlphaSense AI — recovery codes',
            `Email: ${email}`,
            `Generated: ${new Date().toISOString()}`,
            '',
            'Each code can be used ONCE to log in if you lose access to your',
            'authenticator app. Store these somewhere safe and offline.',
            '',
            ...recoveryCodes,
        ].join('\n');
        const blob = new Blob([body], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `alphasense-recovery-${Date.now()}.txt`;
        a.click();
        URL.revokeObjectURL(url);
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
                        <ShieldCheck className="w-8 h-8 text-white" />
                    </div>
                    <h1 className="text-2xl font-bold text-[#F4F6FF]">Set up two-factor auth</h1>
                    <p className="text-[#A7B0C8] mt-1 text-sm">
                        Adds a second factor when you sign in
                    </p>
                </div>

                <div className="panel-bg panel-border rounded-2xl p-8">
                    {stage === 'loading' && (
                        <div className="text-center space-y-3">
                            <Loader2 className="w-10 h-10 mx-auto text-[#00F0FF] animate-spin" />
                            <p className="text-sm text-[#A7B0C8]">Preparing secure secret…</p>
                        </div>
                    )}

                    {stage === 'error' && (
                        <div className="text-center space-y-4">
                            <AlertCircle className="w-12 h-12 mx-auto text-red-400" />
                            <p className="text-sm text-[#A7B0C8]">{error}</p>
                            <Link to="/settings" className="text-sm text-[#00F0FF] hover:underline">
                                Back to settings
                            </Link>
                        </div>
                    )}

                    {stage === 'scan' && enrollment && (
                        <div className="space-y-5">
                            <p className="text-sm text-[#A7B0C8]">
                                Scan this QR with Google Authenticator, 1Password, Authy, or any TOTP app.
                            </p>
                            <div className="flex justify-center">
                                <div className="p-3 bg-white rounded-xl">
                                    <img
                                        src={mfaQrUrl(enrollment.secret, email)}
                                        alt="MFA QR code"
                                        className="w-48 h-48"
                                    />
                                </div>
                            </div>
                            <details className="text-xs text-[#A7B0C8]">
                                <summary className="cursor-pointer hover:text-[#F4F6FF]">
                                    Can't scan? Enter secret manually
                                </summary>
                                <code className="block mt-2 p-2 bg-[#0D1225] rounded font-mono text-[#F4F6FF] break-all">
                                    {enrollment.secret}
                                </code>
                            </details>
                            <button
                                type="button"
                                onClick={() => setStage('verify')}
                                className="w-full flex items-center justify-center gap-2 py-3 rounded-lg font-medium text-sm bg-gradient-to-r from-[#4285F4] via-[#9B72CB] to-[#D96570] text-white"
                            >
                                I scanned it
                                <ArrowRight className="w-4 h-4" />
                            </button>
                        </div>
                    )}

                    {stage === 'verify' && (
                        <form onSubmit={handleVerify} className="space-y-4">
                            <p className="text-sm text-[#A7B0C8]">
                                Enter the 6-digit code from your authenticator app to confirm.
                            </p>
                            <input
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]{6}"
                                maxLength={6}
                                value={code}
                                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                                placeholder="000000"
                                required
                                autoFocus
                                className="w-full px-4 py-3 text-center text-2xl tracking-[0.5em] font-mono rounded-lg bg-[#0D1225] border border-[rgba(0,240,255,0.1)] text-[#F4F6FF] focus:outline-none focus:border-[#00F0FF]/40"
                            />
                            {error && (
                                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                                    <span>{error}</span>
                                </div>
                            )}
                            <button
                                type="submit"
                                disabled={busy || code.length !== 6}
                                className="w-full flex items-center justify-center gap-2 py-3 rounded-lg font-medium text-sm transition-all disabled:opacity-50 bg-gradient-to-r from-[#4285F4] via-[#9B72CB] to-[#D96570] text-white"
                            >
                                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Activate MFA'}
                            </button>
                            <button
                                type="button"
                                onClick={() => setStage('scan')}
                                className="w-full text-xs text-[#A7B0C8] hover:text-[#F4F6FF]"
                            >
                                ← Back to QR
                            </button>
                        </form>
                    )}

                    {stage === 'codes' && (
                        <div className="space-y-4">
                            <div className="flex items-center gap-2 text-emerald-400">
                                <ShieldCheck className="w-5 h-5" />
                                <span className="text-sm font-medium">MFA activated</span>
                            </div>

                            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs">
                                <strong>Save these 10 recovery codes.</strong> Each works ONCE if you
                                lose your authenticator. They will NOT be shown again.
                            </div>

                            <div className="grid grid-cols-2 gap-2 p-3 bg-[#0D1225] rounded-lg font-mono text-sm text-[#F4F6FF]">
                                {recoveryCodes.map((c, i) => (
                                    <div key={i} className="px-2 py-1.5 rounded bg-[#070A12]">
                                        {c}
                                    </div>
                                ))}
                            </div>

                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={copyAllCodes}
                                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm border border-[rgba(0,240,255,0.2)] text-[#F4F6FF] hover:bg-[#0D1225]"
                                >
                                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                    {copied ? 'Copied' : 'Copy all'}
                                </button>
                                <button
                                    type="button"
                                    onClick={downloadCodes}
                                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm border border-[rgba(0,240,255,0.2)] text-[#F4F6FF] hover:bg-[#0D1225]"
                                >
                                    <Download className="w-4 h-4" />
                                    Download .txt
                                </button>
                            </div>

                            <button
                                type="button"
                                onClick={() => navigate('/settings', { replace: true })}
                                className="w-full mt-2 py-3 rounded-lg font-medium text-sm bg-gradient-to-r from-[#4285F4] via-[#9B72CB] to-[#D96570] text-white"
                            >
                                Done — back to settings
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
