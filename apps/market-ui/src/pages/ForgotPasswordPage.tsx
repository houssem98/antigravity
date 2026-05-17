import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Brain, Loader2, Mail, ArrowRight, CheckCircle } from 'lucide-react';
import { requestPasswordReset } from '../services/supabase';

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [submitted, setSubmitted] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            await requestPasswordReset(email);
        } catch (err) {
            console.warn('reset_request_error', err);
        } finally {
            setSubmitted(true);
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
                    <h1 className="text-2xl font-bold text-[#F4F6FF]">Forgot password</h1>
                    <p className="text-[#A7B0C8] mt-1 text-sm">We'll email you a reset link</p>
                </div>

                <div className="panel-bg panel-border rounded-2xl p-8">
                    {submitted ? (
                        <div className="text-center space-y-4">
                            <CheckCircle className="w-12 h-12 mx-auto text-emerald-400" />
                            <h2 className="text-lg font-medium text-[#F4F6FF]">Check your inbox</h2>
                            <p className="text-sm text-[#A7B0C8]">
                                If an account exists for <span className="text-[#F4F6FF]">{email}</span>,
                                we just sent a password reset link. It expires in 15 minutes.
                            </p>
                            <p className="text-xs text-[#A7B0C8]/60">
                                Not in your inbox? Check spam. Still nothing?{' '}
                                <button
                                    type="button"
                                    onClick={() => setSubmitted(false)}
                                    className="text-[#00F0FF] hover:underline"
                                >
                                    Try again
                                </button>
                            </p>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <label className="block text-xs font-medium text-[#A7B0C8] mb-1.5">Email</label>
                                <div className="relative">
                                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#A7B0C8]/50" />
                                    <input
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        placeholder="you@example.com"
                                        required
                                        className="w-full pl-10 pr-4 py-3 rounded-lg bg-[#0D1225] border border-[rgba(0,240,255,0.1)] text-[#F4F6FF] placeholder-[#A7B0C8]/30 text-sm focus:outline-none focus:border-[#00F0FF]/40 transition-colors"
                                    />
                                </div>
                            </div>

                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full flex items-center justify-center gap-2 py-3 rounded-lg font-medium text-sm transition-all disabled:opacity-50 bg-gradient-to-r from-[#4285F4] via-[#9B72CB] to-[#D96570] text-white hover:shadow-lg hover:shadow-[#9B72CB]/20"
                            >
                                {loading ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <>
                                        Send reset link
                                        <ArrowRight className="w-4 h-4" />
                                    </>
                                )}
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
