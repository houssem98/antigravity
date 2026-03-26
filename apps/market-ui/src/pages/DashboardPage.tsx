// Dashboard Page — Live research stats, recent reports, market data, and documents
// Fetches real data from Supabase + Gravity API

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
    FileText, TrendingUp, Search, ArrowRight, BarChart3,
    Clock, Database, Sparkles, Upload,
} from 'lucide-react';
import { supabase } from '../services/supabase';
import { getStockList, getNews } from '../services/marketData';

interface DashboardStats {
    reportCount: number;
    totalSources: number;
    hoursSaved: number;
    docCount: number;
}

interface RecentReport {
    id: string;
    query: string;
    title: string;
    created_at: string;
    sources_analyzed: number;
}

const GRAVITY_API = 'http://localhost:8000';

export default function DashboardPage() {
    const stocks = getStockList().slice(0, 5);
    const news = getNews().slice(0, 4);
    const [stats, setStats] = useState<DashboardStats>({ reportCount: 0, totalSources: 0, hoursSaved: 0, docCount: 0 });
    const [recentReports, setRecentReports] = useState<RecentReport[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchDashboardData();
    }, []);

    const fetchDashboardData = async () => {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) { setLoading(false); return; }

            // Fetch reports from Supabase
            const { data: reports } = await supabase
                .from('research_reports')
                .select('id, query, title, created_at, sources_analyzed')
                .eq('user_id', session.user.id)
                .order('created_at', { ascending: false })
                .limit(50);

            const reportList = reports || [];
            const totalSources = reportList.reduce((sum, r) => sum + (r.sources_analyzed || 0), 0);
            const hoursSaved = reportList.length * 2.5; // ~2.5 hrs per deep research report

            setRecentReports(reportList.slice(0, 5));
            setStats(prev => ({
                ...prev,
                reportCount: reportList.length,
                totalSources,
                hoursSaved,
            }));

            // Fetch document count from Gravity API (non-blocking)
            try {
                const res = await fetch(`${GRAVITY_API}/v1/documents?limit=1`);
                if (res.ok) {
                    const docData = await res.json();
                    setStats(prev => ({ ...prev, docCount: docData.total || 0 }));
                }
            } catch { /* Gravity API offline — show 0 */ }
        } catch (err) {
            console.warn('Dashboard fetch failed:', err);
        } finally {
            setLoading(false);
        }
    };

    const formatTimeAgo = (dateStr: string) => {
        const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
        if (diff < 60) return 'Just now';
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        return `${Math.floor(diff / 86400)}d ago`;
    };

    return (
        <div className="p-8">
            <div className="mb-8">
                <h1 className="text-3xl font-bold mb-2">Dashboard</h1>
                <p className="text-[#A7B0C8]">Market overview and research activity</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Quick Action Cards */}
                <div className="lg:col-span-2 panel-bg panel-border rounded-2xl p-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-xl font-semibold mb-2">Start New Research</h2>
                            <p className="text-[#A7B0C8] text-sm">
                                Generate comprehensive market intelligence reports with AI-powered deep research
                            </p>
                        </div>
                        <Link
                            to="/search"
                            className="px-6 py-3 rounded-xl bg-[#00F0FF] text-[#070A12] font-medium text-sm hover:bg-[#00F0FF]/90 transition-all flex items-center gap-2"
                        >
                            <Search className="w-4 h-4" />
                            New Research
                            <ArrowRight className="w-4 h-4" />
                        </Link>
                    </div>
                </div>

                {/* Upload Documents Card */}
                <Link
                    to="/documents"
                    className="panel-bg panel-border rounded-2xl p-6 hover:border-[#00F0FF]/30 transition-colors group"
                >
                    <div className="flex items-center gap-3 mb-3">
                        <div className="w-10 h-10 rounded-xl bg-[#9B72CB]/10 flex items-center justify-center">
                            <Upload className="w-5 h-5 text-[#C8A2FF]" />
                        </div>
                        <div>
                            <h3 className="font-semibold text-sm group-hover:text-[#00F0FF] transition-colors">Upload Documents</h3>
                            <p className="text-xs text-[#4A5568]">
                                {stats.docCount > 0 ? `${stats.docCount} docs indexed` : 'Ingest PDFs, 10-Ks, transcripts'}
                            </p>
                        </div>
                    </div>
                </Link>

                {/* Stats Row */}
                <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-4 gap-4">
                    {[
                        { label: 'Reports Generated', value: stats.reportCount, icon: BarChart3, color: '#00F0FF' },
                        { label: 'Sources Analyzed', value: stats.totalSources.toLocaleString(), icon: Database, color: '#5B8DF6' },
                        { label: 'Hours Saved', value: stats.hoursSaved.toFixed(1), icon: Clock, color: '#9B72CB' },
                        { label: 'Documents Indexed', value: stats.docCount, icon: FileText, color: '#F9AB00' },
                    ].map(({ label, value, icon: Icon, color }) => (
                        <div key={label} className="panel-bg panel-border rounded-xl p-5">
                            <div className="flex items-center gap-2 mb-2">
                                <Icon className="w-4 h-4" style={{ color }} />
                                <div className="text-xs text-[#A7B0C8]">{label}</div>
                            </div>
                            <div className="text-2xl font-mono font-bold" style={{ color }}>
                                {loading ? (
                                    <div className="w-12 h-6 rounded bg-white/5 animate-pulse" />
                                ) : value}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Recent Reports */}
                <div className="lg:col-span-2 panel-bg panel-border rounded-2xl p-6">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                            <Sparkles className="w-5 h-5 text-[#C8A2FF]" />
                            <h3 className="font-semibold text-lg">Recent Reports</h3>
                        </div>
                        <Link to="/history" className="text-xs text-[#5B8DF6] hover:text-[#00F0FF] transition-colors">
                            View all →
                        </Link>
                    </div>
                    {loading ? (
                        <div className="space-y-3">
                            {[1, 2, 3].map(i => (
                                <div key={i} className="h-14 rounded-xl bg-white/[0.02] animate-pulse" />
                            ))}
                        </div>
                    ) : recentReports.length === 0 ? (
                        <div className="text-center py-8">
                            <p className="text-sm text-[#4A5568] mb-3">No reports yet</p>
                            <Link
                                to="/search?mode=research"
                                className="text-xs text-[#5B8DF6] hover:text-[#00F0FF] transition-colors"
                            >
                                Start your first deep research →
                            </Link>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {recentReports.map(report => (
                                <Link
                                    key={report.id}
                                    to={`/report/${report.id}`}
                                    className="flex items-center justify-between p-3 rounded-xl hover:bg-white/[0.03] transition-colors group"
                                >
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm text-white truncate group-hover:text-[#00F0FF] transition-colors">
                                            {report.title || report.query}
                                        </p>
                                        <div className="flex items-center gap-3 mt-1">
                                            <span className="text-[10px] text-[#4A5568]">{formatTimeAgo(report.created_at)}</span>
                                            {report.sources_analyzed > 0 && (
                                                <span className="text-[10px] text-[#4A5568]">
                                                    {report.sources_analyzed} sources
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <ArrowRight className="w-4 h-4 text-[#4A5568] group-hover:text-[#00F0FF] flex-shrink-0" />
                                </Link>
                            ))}
                        </div>
                    )}
                </div>

                {/* Market Movers */}
                <div className="panel-bg panel-border rounded-2xl p-6">
                    <div className="flex items-center gap-2 mb-4">
                        <TrendingUp className="w-5 h-5 text-[#00F0FF]" />
                        <h3 className="font-semibold text-lg">Market Movers</h3>
                    </div>
                    <div className="space-y-3">
                        {stocks.map((stock, index) => (
                            <Link
                                key={index}
                                to={`/companies/${stock.symbol}`}
                                className="flex items-center justify-between py-2 border-b border-[rgba(0,240,255,0.08)] last:border-0 hover:opacity-80 transition-opacity"
                            >
                                <div className="flex items-center gap-3">
                                    <span className="font-mono font-medium text-[#F4F6FF]">{stock.symbol}</span>
                                    <span className="text-sm text-[#A7B0C8]">${stock.price.toFixed(2)}</span>
                                </div>
                                <div className={`flex items-center gap-1 text-sm font-mono ${stock.positive ? 'text-[#00F0FF]' : 'text-[#FF6B6B]'}`}>
                                    <span>{stock.positive ? '+' : ''}{stock.change}%</span>
                                </div>
                            </Link>
                        ))}
                    </div>
                </div>

                {/* Market News */}
                <div className="lg:col-span-3 panel-bg panel-border rounded-2xl p-6">
                    <div className="flex items-center gap-2 mb-4">
                        <FileText className="w-5 h-5 text-[#00F0FF]" />
                        <h3 className="font-semibold text-lg">Market News</h3>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {news.map((item, index) => (
                            <div key={index} className="group cursor-pointer">
                                <div className="flex items-start gap-3">
                                    <div className="w-1.5 h-1.5 rounded-full bg-[#00F0FF] mt-2 flex-shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm text-[#F4F6FF] leading-relaxed group-hover:text-[#00F0FF] transition-colors line-clamp-2">
                                            {item.title}
                                        </p>
                                        <span className="text-xs text-[#A7B0C8]/70">{item.source}</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
