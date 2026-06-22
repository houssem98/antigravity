// Research History Page — Premium design with stats dashboard and rich cards
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Clock, FileText, Database, Search, Loader2, ChevronRight,
    Sparkles, Trash2, BarChart3, TrendingUp, BookOpen, Calendar,
    ArrowRight, Filter, SortDesc
} from 'lucide-react';
import { listReports, deleteReport, type ReportMeta } from '../services/reports';

type ReportSummary = ReportMeta;

export default function HistoryPage() {
    const [reports, setReports] = useState<ReportSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const navigate = useNavigate();

    useEffect(() => {
        fetchReports();
    }, []);

    const fetchReports = async () => {
        setLoading(true);
        setReports(await listReports());
        setLoading(false);
    };

    const handleDelete = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm('Delete this report permanently?')) return;
        setDeletingId(id);
        await deleteReport(id);
        setReports(prev => prev.filter(r => r.id !== id));
        setDeletingId(null);
    };

    const filtered = reports.filter(r =>
        r.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.query.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const sorted = [...filtered].sort((a, b) => {
        const dateA = new Date(a.created_at).getTime();
        const dateB = new Date(b.created_at).getTime();
        return sortOrder === 'newest' ? dateB - dateA : dateA - dateB;
    });

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        const now = new Date();
        const diff = now.getTime() - date.getTime();
        const mins = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (mins < 2) return 'Just now';
        if (mins < 60) return `${mins}m ago`;
        if (hours < 24) return `${hours}h ago`;
        if (days < 7) return `${days}d ago`;
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    const formatFullDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleDateString('en-US', {
            weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    };

    // Stats calculations
    const totalSources = reports.reduce((sum, r) => sum + (r.sources_analyzed || 0), 0);
    const totalReadTime = reports.reduce((sum, r) => sum + (r.read_time || 0), 0);
    const avgSources = reports.length > 0 ? Math.round(totalSources / reports.length) : 0;

    // Color accent for each report (based on index)
    const ACCENTS = [
        { from: '#4285F4', to: '#2563EB' },
        { from: '#9B72CB', to: '#7C3AED' },
        { from: '#D96570', to: '#DC2626' },
        { from: '#059669', to: '#10B981' },
        { from: '#D97706', to: '#F59E0B' },
        { from: '#0891B2', to: '#06B6D4' },
        { from: '#4F46E5', to: '#6366F1' },
        { from: '#BE185D', to: '#EC4899' },
    ];

    return (
        <div className="p-6 md:p-8 max-w-6xl mx-auto">
            {/* ═══ HERO HEADER ═══ */}
            <div className="relative mb-8 p-8 rounded-2xl overflow-hidden"
                style={{
                    background: 'linear-gradient(135deg, rgba(13,18,37,0.95), rgba(15,27,51,0.95))',
                    borderWidth: 1,
                    borderColor: 'rgba(0,240,255,0.08)',
                }}
            >
                {/* Decorative gradient orbs */}
                <div className="absolute top-0 right-0 w-80 h-80 rounded-full opacity-10"
                    style={{ background: 'radial-gradient(circle, #4285F4 0%, transparent 70%)' }} />
                <div className="absolute bottom-0 left-20 w-60 h-60 rounded-full opacity-5"
                    style={{ background: 'radial-gradient(circle, #9B72CB 0%, transparent 70%)' }} />

                <div className="relative z-10 flex items-start justify-between">
                    <div>
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-11 h-11 rounded-xl flex items-center justify-center"
                                style={{ background: 'linear-gradient(135deg, #4285F4, #9B72CB)' }}>
                                <BookOpen className="w-5 h-5 text-white" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold text-[#F4F6FF]">Research Library</h1>
                                <p className="text-xs text-[#A7B0C8]/60 tracking-wide uppercase">
                                    Your Intelligence Archive
                                </p>
                            </div>
                        </div>
                        <p className="text-sm text-[#A7B0C8] max-w-lg leading-relaxed mt-2">
                            Browse, search, and revisit your deep research reports. Each report contains comprehensive market intelligence powered by AI analysis.
                        </p>
                    </div>
                    <button
                        onClick={() => navigate('/research')}
                        className="flex items-center gap-2 px-4 py-2 rounded-sm font-semibold text-label text-[color:var(--accent-ink)] bg-[color:var(--accent)] hover:brightness-110 transition-colors flex-shrink-0 shiny chrome cta-glow press"
                        style={{ letterSpacing: '0.04em' }}
                    >
                        <Sparkles className="w-3.5 h-3.5" />
                        NEW RESEARCH
                        <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                </div>

                {/* ═══ STATS ROW ═══ */}
                {reports.length > 0 && (
                    <div className="relative z-10 grid grid-cols-2 md:grid-cols-4 gap-3 mt-6 stagger">
                        {[
                            { icon: FileText, label: 'Total Reports', value: reports.length, color: '#4285F4' },
                            { icon: Database, label: 'Sources Analyzed', value: totalSources, color: '#9B72CB' },
                            { icon: TrendingUp, label: 'Avg Sources/Report', value: avgSources, color: '#059669' },
                            { icon: Clock, label: 'Total Read Time', value: `${totalReadTime}m`, color: '#D97706' },
                        ].map((stat, i) => (
                            <div key={i} className="p-4 rounded-xl transition-all hover:scale-[1.02]"
                                style={{
                                    background: 'rgba(255,255,255,0.03)',
                                    borderWidth: 1,
                                    borderColor: 'rgba(255,255,255,0.06)',
                                }}
                            >
                                <stat.icon className="w-4 h-4 mb-2" style={{ color: stat.color }} />
                                <div className="text-xl font-bold text-[#F4F6FF]">{stat.value}</div>
                                <div className="text-[10px] text-[#A7B0C8]/50 uppercase tracking-wider mt-0.5">{stat.label}</div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* ═══ SEARCH & FILTER BAR ═══ */}
            {reports.length > 0 && (
                <div className="flex items-center gap-3 mb-6">
                    <div className="relative flex-1">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#A7B0C8]/40" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search by title, topic, or query..."
                            className="w-full pl-11 pr-4 py-3 rounded-xl text-sm text-[#F4F6FF] placeholder-[#A7B0C8]/30 focus:outline-none transition-all"
                            style={{
                                background: 'rgba(13,18,37,0.8)',
                                borderWidth: 1,
                                borderColor: 'rgba(0,240,255,0.08)',
                            }}
                        />
                    </div>
                    <button
                        onClick={() => setSortOrder(sortOrder === 'newest' ? 'oldest' : 'newest')}
                        className="flex items-center gap-2 px-4 py-3 rounded-xl text-xs font-medium text-[#A7B0C8] transition-all hover:text-[#00F0FF]"
                        style={{
                            background: 'rgba(13,18,37,0.8)',
                            borderWidth: 1,
                            borderColor: 'rgba(0,240,255,0.08)',
                        }}
                        title={`Sort: ${sortOrder}`}
                    >
                        <SortDesc className="w-4 h-4" />
                        {sortOrder === 'newest' ? 'Newest' : 'Oldest'}
                    </button>
                    <div className="flex items-center gap-1.5 px-4 py-3 rounded-xl text-xs text-[#A7B0C8]/50"
                        style={{
                            background: 'rgba(13,18,37,0.5)',
                            borderWidth: 1,
                            borderColor: 'rgba(0,240,255,0.04)',
                        }}
                    >
                        <Filter className="w-3.5 h-3.5" />
                        {filtered.length} result{filtered.length !== 1 ? 's' : ''}
                    </div>
                </div>
            )}

            {/* ═══ LOADING ═══ */}
            {loading && (
                <div className="flex flex-col items-center justify-center py-24">
                    <div className="relative">
                        <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
                            style={{ background: 'rgba(0,240,255,0.05)', borderWidth: 1, borderColor: 'rgba(0,240,255,0.1)' }}>
                            <Loader2 className="w-7 h-7 text-[#00F0FF] animate-spin" />
                        </div>
                    </div>
                    <p className="text-sm text-[#A7B0C8] mt-4">Loading your research library...</p>
                </div>
            )}

            {/* ═══ EMPTY STATE ═══ */}
            {!loading && reports.length === 0 && (
                <div className="text-center py-24 px-8">
                    <div className="w-20 h-20 mx-auto mb-6 rounded-2xl flex items-center justify-center"
                        style={{
                            background: 'linear-gradient(135deg, rgba(66,133,244,0.1), rgba(155,114,203,0.1))',
                            borderWidth: 1,
                            borderColor: 'rgba(0,240,255,0.08)',
                        }}
                    >
                        <BookOpen className="w-9 h-9 text-[#A7B0C8]/30" />
                    </div>
                    <h3 className="text-xl font-semibold text-[#F4F6FF] mb-2">Your library is empty</h3>
                    <p className="text-sm text-[#A7B0C8] mb-8 max-w-sm mx-auto leading-relaxed">
                        Start your first deep research to build your intelligence archive. Each report analyzes dozens of sources.
                    </p>
                    <button
                        onClick={() => navigate('/research')}
                        className="px-6 py-2.5 rounded-sm text-label font-semibold text-[color:var(--accent-ink)] bg-[color:var(--accent)] hover:brightness-110 transition-colors shiny chrome cta-glow press"
                        style={{ letterSpacing: '0.06em' }}
                    >
                        <span className="flex items-center gap-2">
                            <Sparkles className="w-3.5 h-3.5" />
                            BEGIN YOUR FIRST RESEARCH
                        </span>
                    </button>
                </div>
            )}

            {/* ═══ REPORT CARDS ═══ */}
            {!loading && sorted.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {sorted.map((report, idx) => {
                        const accent = ACCENTS[idx % ACCENTS.length];
                        const isDeleting = deletingId === report.id;
                        return (
                            <div
                                key={report.id}
                                onClick={() => navigate(`/report/${report.id}`)}
                                className={`group relative rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.01] hover:shadow-2xl ${isDeleting ? 'opacity-50 pointer-events-none' : ''}`}
                                style={{
                                    background: 'rgba(13,18,37,0.85)',
                                    borderWidth: 1,
                                    borderColor: 'rgba(0,240,255,0.06)',
                                }}
                            >
                                {/* Top accent gradient bar */}
                                <div className="h-1 rounded-t-2xl transition-all duration-300 group-hover:h-1.5"
                                    style={{ background: `linear-gradient(90deg, ${accent.from}, ${accent.to})` }} />

                                <div className="p-5">
                                    {/* Header row */}
                                    <div className="flex items-start gap-3 mb-3">
                                        {/* Icon badge */}
                                        <div className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center transition-transform group-hover:scale-110"
                                            style={{ background: `linear-gradient(135deg, ${accent.from}20, ${accent.to}20)` }}>
                                            <BarChart3 className="w-4.5 h-4.5" style={{ color: accent.from }} />
                                        </div>

                                        <div className="min-w-0 flex-1">
                                            <h3 className="font-semibold text-[#F4F6FF] group-hover:text-[#00F0FF] transition-colors line-clamp-2 text-[15px] leading-tight mb-1.5">
                                                {report.title?.replace(/\*\*/g, '')}
                                            </h3>
                                            <p className="text-[11px] text-[#A7B0C8]/40 line-clamp-1 italic">
                                                "{report.query}"
                                            </p>
                                        </div>

                                        {/* Actions */}
                                        <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={(e) => handleDelete(report.id, e)}
                                                className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-red-500/15 transition-all"
                                                title="Delete report"
                                            >
                                                <Trash2 className="w-3.5 h-3.5 text-[#A7B0C8]/50 hover:text-red-400 transition-colors" />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Summary */}
                                    {report.summary && (
                                        <p className="text-[13px] text-[#A7B0C8]/70 line-clamp-2 leading-relaxed mb-4 pl-[52px]">
                                            {report.summary}
                                        </p>
                                    )}

                                    {/* Footer meta */}
                                    <div className="flex items-center justify-between pt-3 pl-[52px]"
                                        style={{ borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.04)' }}>
                                        <div className="flex items-center gap-4">
                                            <div className="flex items-center gap-1.5 text-[11px] text-[#A7B0C8]/50">
                                                <Calendar className="w-3 h-3" />
                                                <span title={formatFullDate(report.created_at)}>
                                                    {formatDate(report.created_at)}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-1.5 text-[11px] text-[#A7B0C8]/50">
                                                <Database className="w-3 h-3" />
                                                {report.sources_analyzed} sources
                                            </div>
                                            <div className="flex items-center gap-1.5 text-[11px] text-[#A7B0C8]/50">
                                                <Clock className="w-3 h-3" />
                                                {report.read_time}m read
                                            </div>
                                        </div>
                                        <ChevronRight className="w-4 h-4 text-[#A7B0C8]/20 group-hover:text-[#00F0FF] group-hover:translate-x-0.5 transition-all" />
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ═══ NO SEARCH RESULTS ═══ */}
            {!loading && reports.length > 0 && filtered.length === 0 && (
                <div className="text-center py-16">
                    <Search className="w-8 h-8 text-[#A7B0C8]/20 mx-auto mb-3" />
                    <p className="text-sm text-[#A7B0C8]">
                        No reports matching "<span className="text-[#00F0FF]">{searchQuery}</span>"
                    </p>
                    <button
                        onClick={() => setSearchQuery('')}
                        className="mt-3 text-xs text-[#A7B0C8]/50 hover:text-[#00F0FF] transition-colors"
                    >
                        Clear search
                    </button>
                </div>
            )}
        </div>
    );
}
