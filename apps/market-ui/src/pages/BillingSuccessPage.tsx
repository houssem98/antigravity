import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle, Loader2 } from 'lucide-react';

export default function BillingSuccessPage() {
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const sessionId = params.get('session_id');
    const [countdown, setCountdown] = useState(5);

    useEffect(() => {
        const interval = setInterval(() => {
            setCountdown(c => {
                if (c <= 1) {
                    clearInterval(interval);
                    navigate('/billing');
                    return 0;
                }
                return c - 1;
            });
        }, 1000);
        return () => clearInterval(interval);
    }, [navigate]);

    return (
        <div className="min-h-screen bg-[color:var(--bg)] flex items-center justify-center p-6">
            <div className="max-w-md w-full text-center space-y-6">
                <div className="flex justify-center">
                    <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center">
                        <CheckCircle className="w-8 h-8 text-emerald-400" />
                    </div>
                </div>
                <div className="space-y-2">
                    <h1 className="text-2xl font-semibold text-[color:var(--fg)]">Payment successful</h1>
                    <p className="text-zinc-400">Your subscription is now active. Welcome to the next level.</p>
                    {sessionId && (
                        <p className="text-xs text-zinc-600 font-mono">ref: {sessionId.slice(0, 24)}…</p>
                    )}
                </div>
                <div className="flex items-center justify-center gap-2 text-zinc-400 text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Redirecting in {countdown}s…
                </div>
                <button
                    onClick={() => navigate('/billing')}
                    className="w-full py-2.5 rounded-lg bg-[color:var(--accent)] text-black font-semibold text-sm hover:opacity-90 transition-opacity"
                >
                    Go to Billing
                </button>
            </div>
        </div>
    );
}
