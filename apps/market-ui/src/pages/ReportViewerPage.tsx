// Report Viewer Page — Gemini-style full-screen report panel
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2, AlertCircle, ArrowLeft } from 'lucide-react';
import { getReport } from '../services/reports';
import ResearchReportComponent from '../components/research/ResearchReport';
import type { ResearchReport } from '../services/deepResearchService';

export default function ReportViewerPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [report, setReport] = useState<ResearchReport | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!id) return;

        const fetchReport = async () => {
            const data = await getReport(id);
            if (!data) {
                setError('Report not found');
                setLoading(false);
                return;
            }

            setReport({
                query: data.query,
                title: data.title,
                summary: data.summary || '',
                markdown: data.markdown,
                citations: (data.citations ?? []) as ResearchReport['citations'],
                metadata: {
                    sourcesAnalyzed: data.sources_analyzed || 0,
                    generatedAt: data.created_at,
                    estimatedReadTime: data.read_time || 0,
                },
            });
            setLoading(false);
        };

        fetchReport();
    }, [id, navigate]);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen"
                style={{ background: '#1E1F22' }}>
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
                    style={{ background: 'rgba(138,180,248,0.08)', border: '1px solid rgba(138,180,248,0.12)' }}>
                    <Loader2 className="w-6 h-6 text-[#8AB4F8] animate-spin" />
                </div>
                <p className="text-sm text-[#9AA0A6]">Loading report...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen"
                style={{ background: '#1E1F22' }}>
                <AlertCircle className="w-10 h-10 text-[#F28B82] mb-4" />
                <p className="text-[#E8EAED] font-medium mb-2">{error}</p>
                <button
                    onClick={() => navigate('/history')}
                    className="flex items-center gap-2 text-sm text-[#8AB4F8] hover:text-[#AECBFA] transition-colors mt-2"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Back to Research Library
                </button>
            </div>
        );
    }

    return (
        <div className="h-screen flex flex-col" style={{ background: '#1E1F22' }}>
            {report && (
                <ResearchReportComponent
                    report={report}
                    instant
                    onClose={() => navigate('/history')}
                />
            )}
        </div>
    );
}
