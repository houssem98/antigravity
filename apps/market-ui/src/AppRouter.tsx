// App Router with Auth Guard
//
// Session source: gravity-api (Phase 1+2). Supabase Auth is deprecated but
// the client lib still ships in the bundle for read-only fallback. We scrub
// any leftover Supabase magic-link / OAuth hash fragments on mount so tokens
// don't linger in the URL bar or browser history.
import { Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { getSession } from './services/supabase';
import AppLayout from './components/AppLayout';
import LandingPage from './pages/LandingPage';
import AuthPage from './pages/AuthPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import VerifyEmailPage from './pages/VerifyEmailPage';
import MfaSetupPage from './pages/MfaSetupPage';

import DashboardPage from './pages/DashboardPage';
import SettingsPage from './pages/SettingsPage';
import HistoryPage from './pages/HistoryPage';
import ReportViewerPage from './pages/ReportViewerPage';
import SearchPage from './pages/SearchPage';
import CompanyPage from './pages/CompanyPage';
import DocumentsPage from './pages/DocumentsPage';
import TradingAssistantPage from './pages/TradingAssistantPage';
import InvestorsPage from './pages/InvestorsPage';
import BillingPage from './pages/BillingPage';
import BillingSuccessPage from './pages/BillingSuccessPage';
import BillingCancelPage from './pages/BillingCancelPage';
import AdminBillingPage from './pages/AdminBillingPage';

type SessionLike = { user?: { id?: string; email?: string } } | null;

function ProtectedRoute({ children, session }: { children: React.ReactNode; session: SessionLike }) {
    if (!session) return <Navigate to="/auth" replace />;
    return <>{children}</>;
}

// Strip any auth-token / error fragment from the URL on first paint so it
// doesn't get logged, screenshotted, or bookmarked. Hash is client-only —
// never sent to the server — but it lingers in browser history.
function scrubAuthHash(): { error?: string } {
    if (typeof window === 'undefined' || !window.location.hash) return {};
    // Let the Supabase recovery flow consume the hash on /reset-password.
    if (window.location.pathname === '/reset-password') return {};
    const hash = window.location.hash.startsWith('#')
        ? window.location.hash.slice(1)
        : window.location.hash;
    const params = new URLSearchParams(hash);
    const isAuthFragment =
        params.has('access_token') ||
        params.has('refresh_token') ||
        params.has('error') ||
        params.has('error_code') ||
        params.has('error_description') ||
        params.has('sb');
    if (!isAuthFragment) return {};
    const err = params.get('error_description') || params.get('error') || '';
    // Drop the hash from the URL bar — keep path + query intact.
    const clean = window.location.pathname + window.location.search;
    window.history.replaceState(null, '', clean);
    return err ? { error: err.replace(/\+/g, ' ') } : {};
}

export default function AppRouter() {
    const [session, setSession] = useState<SessionLike>(null);
    const [loading, setLoading] = useState(true);
    const [hashError, setHashError] = useState<string | null>(null);

    useEffect(() => {
        const { error } = scrubAuthHash();
        if (error) setHashError(error);

        getSession()
            .then((s) => setSession((s ?? null) as SessionLike))
            .catch(() => setSession(null))
            .finally(() => setLoading(false));
    }, []);

    if (loading) {
        return (
            <div className="min-h-screen bg-[color:var(--bg)] flex items-center justify-center">
                <div className="w-6 h-6 rounded-full border-2 border-[color:var(--accent)] border-t-transparent animate-spin" />
            </div>
        );
    }

    return (
        <>
            {hashError && (
                <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-md w-[calc(100%-2rem)] px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm shadow-lg">
                    {hashError}.{' '}
                    <a href="/forgot-password" className="underline hover:text-red-200">
                        Request a new link
                    </a>
                    .
                    <button
                        onClick={() => setHashError(null)}
                        className="ml-2 opacity-60 hover:opacity-100"
                        aria-label="dismiss"
                    >
                        ×
                    </button>
                </div>
            )}
            <Routes>
                {/* Public */}
                <Route path="/" element={<LandingPage />} />
                <Route path="/auth" element={session ? <Navigate to="/search" replace /> : <AuthPage />} />
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/verify-email" element={<VerifyEmailPage />} />

                {/* Trading — fullscreen with its own sidebar */}
                <Route path="/trading" element={<TradingAssistantPage />} />

                {/* Investors — public waitlist landing */}
                <Route path="/investors" element={<InvestorsPage />} />

                {/* Billing success/cancel — public so Stripe can redirect without session */}
                <Route path="/billing/success" element={<BillingSuccessPage />} />
                <Route path="/billing/cancel" element={<BillingCancelPage />} />

                {/* Protected */}
                <Route element={
                    <ProtectedRoute session={session}>
                        <AppLayout />
                    </ProtectedRoute>
                }>
                    {/* Unified search: Research Grid + QA + Deep Research */}
                    <Route path="/search" element={<SearchPage />} />

                    {/* Redirect old /research to unified search */}
                    <Route path="/research" element={<Navigate to="/search?mode=research" replace />} />

                    {/* Company intelligence profiles */}
                    <Route path="/companies" element={<CompanyPage />} />
                    <Route path="/companies/:ticker" element={<CompanyPage />} />

                    {/* Existing */}
                    <Route path="/history" element={<HistoryPage />} />
                    <Route path="/report/:id" element={<ReportViewerPage />} />
                    <Route path="/dashboard" element={<DashboardPage />} />
                    <Route path="/documents" element={<DocumentsPage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                    <Route path="/settings/mfa" element={<MfaSetupPage />} />
                    <Route path="/billing" element={<BillingPage />} />
                    <Route path="/admin/billing" element={<AdminBillingPage />} />
                </Route>
            </Routes>
        </>
    );
}
