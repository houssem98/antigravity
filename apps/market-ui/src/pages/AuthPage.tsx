// Auth Page — Login & Sign Up
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signIn, signUp } from '../services/supabase';
import { Brain, Loader2, Mail, Lock, ArrowRight, Sparkles } from 'lucide-react';

export default function AuthPage() {
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const navigate = useNavigate();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccess('');
        setLoading(true);

        try {
            if (isLogin) {
                await signIn(email, password);
                navigate('/search');
            } else {
                await signUp(email, password);
                setSuccess('Account created! Check your email to verify, then log in.');
                setIsLogin(true);
            }
        } catch (err: any) {
            setError(err.message || 'Authentication failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#070A12] flex items-center justify-center p-4">
            {/* Background effects */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[#4285F4]/5 rounded-full blur-3xl" />
                <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-[#9B72CB]/5 rounded-full blur-3xl" />
            </div>

            <div className="relative w-full max-w-md">
                {/* Logo */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-[#4285F4] via-[#9B72CB] to-[#D96570] mb-4">
                        <Brain className="w-8 h-8 text-white" />
                    </div>
                    <h1 className="text-2xl font-bold text-[#F4F6FF]">AlphaSense AI</h1>
                    <p className="text-[#A7B0C8] mt-1 text-sm">Deep Market Intelligence</p>
                </div>

                {/* Auth Card */}
                <div className="panel-bg panel-border rounded-2xl p-8">
                    {/* Tabs */}
                    <div className="flex gap-1 p-1 rounded-lg bg-[#0D1225] mb-6">
                        <button
                            onClick={() => { setIsLogin(true); setError(''); setSuccess(''); }}
                            className={`flex-1 py-2.5 rounded-md text-sm font-medium transition-all ${isLogin
                                ? 'bg-[#00F0FF]/10 text-[#00F0FF]'
                                : 'text-[#A7B0C8] hover:text-[#F4F6FF]'
                                }`}
                        >
                            Log In
                        </button>
                        <button
                            onClick={() => { setIsLogin(false); setError(''); setSuccess(''); }}
                            className={`flex-1 py-2.5 rounded-md text-sm font-medium transition-all ${!isLogin
                                ? 'bg-[#00F0FF]/10 text-[#00F0FF]'
                                : 'text-[#A7B0C8] hover:text-[#F4F6FF]'
                                }`}
                        >
                            Sign Up
                        </button>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        {/* Email */}
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

                        {/* Password */}
                        <div>
                            <label className="block text-xs font-medium text-[#A7B0C8] mb-1.5">Password</label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#A7B0C8]/50" />
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder={isLogin ? 'Enter password' : 'Min 6 characters'}
                                    required
                                    minLength={6}
                                    className="w-full pl-10 pr-4 py-3 rounded-lg bg-[#0D1225] border border-[rgba(0,240,255,0.1)] text-[#F4F6FF] placeholder-[#A7B0C8]/30 text-sm focus:outline-none focus:border-[#00F0FF]/40 transition-colors"
                                />
                            </div>
                        </div>

                        {/* Error / Success */}
                        {error && (
                            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                                {error}
                            </div>
                        )}
                        {success && (
                            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm">
                                {success}
                            </div>
                        )}

                        {/* Submit */}
                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full flex items-center justify-center gap-2 py-3 rounded-lg font-medium text-sm transition-all disabled:opacity-50 bg-gradient-to-r from-[#4285F4] via-[#9B72CB] to-[#D96570] text-white hover:shadow-lg hover:shadow-[#9B72CB]/20"
                        >
                            {loading ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <>
                                    {isLogin ? 'Log In' : 'Create Account'}
                                    <ArrowRight className="w-4 h-4" />
                                </>
                            )}
                        </button>
                    </form>

                    {/* Features */}
                    {!isLogin && (
                        <div className="mt-6 pt-5 border-t border-[rgba(0,240,255,0.06)]">
                            <p className="text-xs text-[#A7B0C8]/60 mb-3">What you get:</p>
                            <div className="space-y-2">
                                {['AI-powered deep research reports', 'Real-time market data', 'SEC filing analysis', 'Report history & export'].map((feature) => (
                                    <div key={feature} className="flex items-center gap-2 text-xs text-[#A7B0C8]">
                                        <Sparkles className="w-3 h-3 text-[#00F0FF]" />
                                        {feature}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Landing page link */}
                <p className="text-center mt-6 text-xs text-[#A7B0C8]/50">
                    <a href="/" className="hover:text-[#00F0FF] transition-colors">← Back to home</a>
                </p>
            </div>
        </div>
    );
}
