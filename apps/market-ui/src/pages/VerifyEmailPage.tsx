import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Brain, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { confirmEmailVerification } from '../services/supabase';

type State = 'loading' | 'ok' | 'error';

export default function VerifyEmailPage() {
    const [params] = useSearchParams();
    const token = params.get('token') ?? '';
    const initialState: State = token ? 'loading' : 'error';
    const [state, setState] = useState<State>(initialState);
    const [error, setError] = useState(token ? '' : 'Missing verification token.');

    useEffect(() => {
        if (!token) return;
        confirmEmailVerification(token)
            .then(() => setState('ok'))
            .catch((err: unknown) => {
                setState('error');
                const msg = err instanceof Error ? err.message : 'Verification link is invalid or expired.';
                setError(msg);
            });
    }, [token]);

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
                    <h1 className="text-2xl font-bold text-[#F4F6FF]">Verify email</h1>
                </div>

                <div className="panel-bg panel-border rounded-2xl p-8 text-center">
                    {state === 'loading' && (
                        <div className="space-y-3">
                            <Loader2 className="w-10 h-10 mx-auto text-[#00F0FF] animate-spin" />
                            <p className="text-sm text-[#A7B0C8]">Confirming your email…</p>
                        </div>
                    )}
                    {state === 'ok' && (
                        <div className="space-y-4">
                            <CheckCircle className="w-12 h-12 mx-auto text-emerald-400" />
                            <h2 className="text-lg font-medium text-[#F4F6FF]">Email verified</h2>
                            <p className="text-sm text-[#A7B0C8]">Your account is fully set up.</p>
                            <Link
                                to="/search"
                                className="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg font-medium text-sm bg-gradient-to-r from-[#4285F4] via-[#9B72CB] to-[#D96570] text-white hover:shadow-lg hover:shadow-[#9B72CB]/20"
                            >
                                Continue
                            </Link>
                        </div>
                    )}
                    {state === 'error' && (
                        <div className="space-y-4">
                            <AlertCircle className="w-12 h-12 mx-auto text-red-400" />
                            <h2 className="text-lg font-medium text-[#F4F6FF]">Verification failed</h2>
                            <p className="text-sm text-[#A7B0C8]">{error}</p>
                            <Link
                                to="/auth"
                                className="inline-block text-sm text-[#00F0FF] hover:underline"
                            >
                                Back to login
                            </Link>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
