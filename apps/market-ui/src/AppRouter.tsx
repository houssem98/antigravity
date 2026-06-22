// App Router with Auth Guard
//
// Session source: gravity-api (Phase 1+2). Supabase Auth is deprecated but
// the client lib still ships in the bundle for read-only fallback. We scrub
// any leftover Supabase magic-link / OAuth hash fragments on mount so tokens
// don't linger in the URL bar or browser history.
import { Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect, lazy, Suspense } from 'react';
import { getSession, startSessionManager, subscribeAuth } from './services/supabase';
import AppLayout from './components/AppLayout';
import LandingPage from './pages/LandingPage';

// Route components are code-split so the landing/auth first paint no longer
// pulls the heavy app pages (charts, PDF renderer, deep-research engine) into
// the initial bundle. Each route loads its own chunk on navigation.
const AuthPage = lazy(() => import('./pages/AuthPage'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));
const VerifyEmailPage = lazy(() => import('./pages/VerifyEmailPage'));
const MfaSetupPage = lazy(() => import('./pages/MfaSetupPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const HistoryPage = lazy(() => import('./pages/HistoryPage'));
const ReportViewerPage = lazy(() => import('./pages/ReportViewerPage'));
const SearchPage = lazy(() => import('./pages/SearchPage'));
const CompanyPage = lazy(() => import('./pages/CompanyPage'));
const DocumentsPage = lazy(() => import('./pages/DocumentsPage'));
const TradingAssistantPage = lazy(() => import('./pages/TradingAssistantPage'));
const InvestorsPage = lazy(() => import('./pages/InvestorsPage'));
const BillingPage = lazy(() => import('./pages/BillingPage'));
const BillingSuccessPage = lazy(() => import('./pages/BillingSuccessPage'));
const BillingCancelPage = lazy(() => import('./pages/BillingCancelPage'));
const AdminBillingPage = lazy(() => import('./pages/AdminBillingPage'));

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

        let cancelled = false;

        // Start the central session manager: proactive token refresh, cross-tab
        // sync, and the auth observer below. Idempotent.
        startSessionManager();

        // Single live source of truth. Fires now with the current session and on
        // every login/logout/refresh — including changes from other tabs and the
        // proactive refresh timer — so the app never wedges in a zombie state.
        const unsubscribe = subscribeAuth((s) => {
            if (!cancelled) setSession((s ?? null) as SessionLike);
        });

        // Initial gate: getSession() transparently refreshes an expired-but-
        // renewable token, so a tab resumed after days silently renews instead
        // of bouncing to /auth. subscribeAuth already seeded state synchronously.
        getSession()
            .then((s) => { if (!cancelled) setSession((s ?? null) as SessionLike); })
            .catch(() => { if (!cancelled) setSession(null); })
            .finally(() => { if (!cancelled) setLoading(false); });

        return () => {
            cancelled = true;
            unsubscribe();
        };
    }, []);

    const routeFallback = (
        <div className="min-h-screen bg-[color:var(--bg)] flex items-center justify-center">
            <div className="w-6 h-6 rounded-full border-2 border-[color:var(--accent)] border-t-transparent animate-spin" />
        </div>
    );

    if (loading) return routeFallback;

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
            <Suspense fallback={routeFallback}>
            <Routes>
                {/* Public */}
                <Route path="/" element={<LandingPage />} />
                <Route path="/auth" element={<AuthPage />} />
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
            </Suspense>
        </>
    );
}
