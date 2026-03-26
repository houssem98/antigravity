// App Layout - Persistent sidebar and topbar for app pages

import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import {
    Zap, BarChart3, Settings, Sparkles,
    Activity, LogOut, History, Building2, Database, TrendingUp,
} from 'lucide-react';
import { signOut } from '../services/supabase';

const NAV = [
    { to: '/search', icon: Zap, label: 'Search' },
    { to: '/trading', icon: TrendingUp, label: 'AI Trading Assistant' },
    { to: '/history', icon: History, label: 'History' },
    { to: '/companies', icon: Building2, label: 'Companies' },
    { to: '/dashboard', icon: BarChart3, label: 'Dashboard' },
    { to: '/documents', icon: Database, label: 'Documents' },
    { to: '/settings', icon: Settings, label: 'Settings' },
];

export default function AppLayout() {
    const location = useLocation();
    const navigate = useNavigate();

    const isActive = (path: string) =>
        path === '/companies'
            ? location.pathname.startsWith('/companies')
            : location.pathname === path;

    const handleSignOut = async () => {
        await signOut();
        navigate('/auth');
    };

    return (
        <div className="min-h-screen bg-[#070A12] flex">
            {/* Sidebar */}
            <aside className="w-[72px] bg-[#070A12] border-r border-[rgba(255,255,255,0.05)] flex flex-col items-center py-6 fixed h-full z-50">
                {/* Logo */}
                <Link to="/search" className="w-10 h-10 rounded-xl bg-[#5B8DF6]/10 flex items-center justify-center mb-8">
                    <Sparkles className="w-5 h-5 text-[#5B8DF6]" />
                </Link>

                <nav className="flex flex-col gap-3 flex-1">
                    {NAV.map(({ to, icon: Icon, label }) => (
                        <Link
                            key={to}
                            to={to}
                            title={label}
                            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${isActive(to) ? 'bg-white/[0.08]' : 'hover:bg-white/[0.07]'
                                }`}
                        >
                            <Icon className={`w-5 h-5 ${isActive(to) ? 'text-[#5B8DF6]' : 'text-[#A7B0C8]'}`} />
                        </Link>
                    ))}
                </nav>

                {/* Sign out */}
                <button
                    onClick={handleSignOut}
                    title="Sign Out"
                    className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-red-500/10 transition-colors group"
                >
                    <LogOut className="w-5 h-5 text-[#A7B0C8] group-hover:text-red-400" />
                </button>
            </aside>

            {/* Main content */}
            <div className="flex-1 ml-[72px]">
                <header className="h-16 bg-[rgba(7,10,18,0.95)] border-b border-[rgba(255,255,255,0.05)] flex items-center justify-between px-6 fixed top-0 right-0 left-[72px] z-40">
                    <div className="flex items-center gap-2">
                        <Sparkles className="w-6 h-6 text-[#5B8DF6]" />
                        <span className="font-semibold text-lg tracking-tight">Antigravity</span>
                        <span className="text-[#4A5568] text-sm ml-1">Market Intelligence</span>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2 text-xs text-[#A7B0C8]">
                            <Activity className="w-4 h-4 text-[#5B8DF6]" />
                            <span className="text-[#5B8DF6]">●</span> Live
                        </div>
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#3D7FF6] to-[#7C3AED]" />
                    </div>
                </header>

                <main className="pt-16 min-h-screen">
                    <Outlet />
                </main>
            </div>
        </div>
    );
}
