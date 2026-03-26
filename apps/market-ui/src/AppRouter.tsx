// App Router with Auth Guard
import { Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { supabase } from './services/supabase';
import type { Session } from '@supabase/supabase-js';
import AppLayout from './components/AppLayout';
import LandingPage from './pages/LandingPage';
import AuthPage from './pages/AuthPage';

import DashboardPage from './pages/DashboardPage';
import SettingsPage from './pages/SettingsPage';
import HistoryPage from './pages/HistoryPage';
import ReportViewerPage from './pages/ReportViewerPage';
import SearchPage from './pages/SearchPage';
import CompanyPage from './pages/CompanyPage';
import DocumentsPage from './pages/DocumentsPage';
import TradingAssistantPage from './pages/TradingAssistantPage';

function ProtectedRoute({ children, session }: { children: React.ReactNode; session: Session | null }) {
    if (!session) return <Navigate to="/auth" replace />;
    return <>{children}</>;
}

export default function AppRouter() {
    const [session, setSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
            setLoading(false);
        }).catch(() => {
            setLoading(false);
        });

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session);
        });

        return () => subscription.unsubscribe();
    }, []);

    if (loading) {
        return (
            <div className="min-h-screen bg-[#070A12] flex items-center justify-center">
                <div className="w-8 h-8 rounded-full border-2 border-[#00F0FF] border-t-transparent animate-spin" />
            </div>
        );
    }

    return (
        <Routes>
            {/* Public */}
            <Route path="/" element={<LandingPage />} />
            <Route path="/auth" element={session ? <Navigate to="/search" replace /> : <AuthPage />} />

            {/* Trading — fullscreen with its own sidebar */}
            <Route path="/trading" element={<TradingAssistantPage />} />

            {/* Protected */}
            <Route element={
                <ProtectedRoute session={session}>
                    <AppLayout />
                </ProtectedRoute>
            }>
                {/* Unified search: QA + Deep Research */}
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
            </Route>
        </Routes>
    );
}
