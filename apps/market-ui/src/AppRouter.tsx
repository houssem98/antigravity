// App Router with Auth Guard
//
// Session source: gravity-api (Phase 1+2). Supabase Auth is deprecated but
// the client lib still ships in the bundle for read-only fallback. We scrub
// any leftover Supabase magic-link / OAuth hash fragments on mount so tokens
// don't linger in the URL bar or browser history.
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useState, useEffect, Suspense } from 'react';
import { getSession, startSessionManager, subscribeAuth } from './services/supabase';
import { lazyWithReload, RouteErrorBoundary } from './lib/lazyWithReload';
import AppLayout from './components/AppLayout';
import LandingPage from './pages/LandingPage';

// Route components are code-split so the landing/auth first paint no longer
// pulls the heavy app pages into the initial bundle. lazyWithReload recovers
// from stale chunks after a deploy.
const AuthPage = lazyWithReload(() => import('./pages/AuthPage'));
const ForgotPasswordPage = lazyWithReload(() => import('./pages/ForgotPasswordPage'));
const ResetPasswordPage = lazyWithReload(() => import('./pages/ResetPasswordPage'));
const VerifyEmailPage = lazyWithReload(() => import('./pages/VerifyEmailPage'));
const MfaSetupPage = lazyWithReload(() => import('./pages/MfaSetupPage'));
const DashboardPage = lazyWithReload(() => import('./pages/DashboardPage'));
const SettingsPage = lazyWithReload(() => import('./pages/SettingsPage'));
const HistoryPage = lazyWithReload(() => import('./pages/HistoryPage'));
const ReportViewerPage = lazyWithReload(() => import('./pages/ReportViewerPage'));
const SearchPage = lazyWithReload(() => import('./pages/SearchPage'));
const CompanyPage = lazyWithReload(() => import('./pages/CompanyPage'));
const DocumentsPage = lazyWithReload(() => import('./pages/DocumentsPage'));
const TradingAssistantPage = lazyWithReload(() => import('./pages/TradingAssistantPage'));
const InvestorsPage = lazyWithReload(() => import('./pages/InvestorsPage'));
const BillingPage = lazyWithReload(() => import('./pages/BillingPage'));
const BillingSuccessPage = lazyWithReload(() => import('./pages/BillingSuccessPage'));
const BillingCancelPage = lazyWithReload(() => import('./pages/BillingCancelPage'));
const AdminBillingPage = lazyWithReload(() => import('./pages/AdminBillingPage'));

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
    const location = useLocation();
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

    const errorFallback = (reset: () => void) => (
        <div className="min-h-screen bg-[color:var(--bg)] flex items-center justify-center p-6">
            <div className="max-w-sm w-full text-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] p-6">
                <p className="text-[color:var(--text)] font-semibold mb-1">This page hit a snag.</p>
                <p className="text-sm text-[color:var(--text-3)] mb-4">
                    The rest of the app still works — reload, or head back to search.
                </p>
                <div className="flex gap-2 justify-center">
                    <button
                        onClick={() => window.location.reload()}
                        className="px-3 py-1.5 rounded-md text-sm bg-[color:var(--accent)] text-[color:var(--accent-ink)] font-medium"
                    >
                        Reload
                    </button>
                    <a
                        href="/search"
                        onClick={reset}
                        className="px-3 py-1.5 rounded-md text-sm border border-[color:var(--line)] text-[color:var(--text-2)]"
                    >
                        Back to search
                    </a>
                </div>
            </div>
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
            <RouteErrorBoundary resetKey={location.pathname} fallback={errorFallback}>
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
            </RouteErrorBoundary>
        </>
    );
}
