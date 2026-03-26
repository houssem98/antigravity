// PDF Preview modal — unified dark palette, no cyan remnants

import { useState, useEffect, useCallback } from 'react';
import { X, Download, Loader2, ZoomIn, ZoomOut, FileText } from 'lucide-react';
import { generatePdfBlob, exportReportToPDF } from '../../services/pdfExport';
import type { ResearchReport } from '../../services/deepResearchService';

interface Props {
    report: ResearchReport;
    onClose: () => void;
}

export default function PdfPreview({ report, onClose }: Props) {
    const [exporting, setExporting] = useState(false);
    const [zoom, setZoom] = useState(100);
    const [pdfUrl, setPdfUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        generatePdfBlob(report)
            .then(blob => {
                if (cancelled) return;
                setPdfUrl(URL.createObjectURL(blob));
                setLoading(false);
            })
            .catch(err => {
                if (cancelled) return;
                setError(`Failed to generate PDF: ${err?.message || err}`);
                setLoading(false);
            });
        return () => { cancelled = true; };
    }, [report]);

    useEffect(() => {
        return () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); };
    }, [pdfUrl]);

    const handleExport = useCallback(async () => {
        setExporting(true);
        try { await exportReportToPDF(report); }
        finally { setExporting(false); }
    }, [report]);

    const adjustZoom = (delta: number) =>
        setZoom(prev => Math.min(200, Math.max(50, prev + delta)));

    useEffect(() => {
        const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', h);
        return () => window.removeEventListener('keydown', h);
    }, [onClose]);

    const cleanTitle = report.title?.replace(/\*\*/g, '').replace(/^#+\s*/, '').trim();

    return (
        <div
            className="fixed inset-0 z-[100] flex flex-col"
            style={{ background: 'rgba(7,10,18,0.97)', backdropFilter: 'blur(12px)' }}
        >
            {/* ── Toolbar ── */}
            <div
                className="flex items-center justify-between px-5 py-3 border-b flex-shrink-0"
                style={{
                    background: '#0A0D18',
                    borderColor: 'rgba(255,255,255,0.06)',
                }}
            >
                {/* Left: traffic lights + title */}
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 rounded-full" style={{ background: '#FF5F57' }} />
                        <div className="w-3 h-3 rounded-full" style={{ background: '#FEBC2E' }} />
                        <div className="w-3 h-3 rounded-full" style={{ background: '#28C840' }} />
                    </div>
                    <div className="flex items-center gap-2 ml-2">
                        <FileText className="w-3.5 h-3.5" style={{ color: '#3D7FF6' }} />
                        <span className="text-[13px] font-medium" style={{ color: '#A0AABF' }}>
                            PDF Preview
                        </span>
                        <span className="text-[12px] truncate max-w-[320px]" style={{ color: '#3D4861' }}>
                            — {cleanTitle}
                        </span>
                    </div>
                </div>

                {/* Right: zoom + download + close */}
                <div className="flex items-center gap-2">
                    {/* Zoom */}
                    <div className="flex items-center gap-1 px-2 py-1 rounded-lg"
                        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                        <button
                            onClick={() => adjustZoom(-25)}
                            className="w-6 h-6 flex items-center justify-center rounded transition-colors hover:bg-white/[0.08]"
                        >
                            <ZoomOut className="w-3.5 h-3.5" style={{ color: '#6D7A94' }} />
                        </button>
                        <span className="text-[12px] font-mono min-w-[36px] text-center" style={{ color: '#8D95A8' }}>
                            {zoom}%
                        </span>
                        <button
                            onClick={() => adjustZoom(25)}
                            className="w-6 h-6 flex items-center justify-center rounded transition-colors hover:bg-white/[0.08]"
                        >
                            <ZoomIn className="w-3.5 h-3.5" style={{ color: '#6D7A94' }} />
                        </button>
                    </div>

                    {/* Download button */}
                    <button
                        onClick={handleExport}
                        disabled={exporting || loading}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-white transition-all disabled:opacity-40 hover:opacity-90"
                        style={{ background: 'linear-gradient(135deg, #1E3A8A, #3D7FF6)' }}
                    >
                        {exporting ? (
                            <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                Generating…
                            </>
                        ) : (
                            <>
                                <Download className="w-3.5 h-3.5" />
                                Download PDF
                            </>
                        )}
                    </button>

                    {/* Close */}
                    <button
                        onClick={onClose}
                        className="w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-white/[0.07]"
                        style={{ color: '#6D7A94' }}
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* ── Preview area ── */}
            <div className="flex-1 relative overflow-hidden" style={{ background: '#070A12' }}>

                {/* Loading state */}
                {loading && (
                    <div className="absolute inset-0 flex items-center justify-center z-10">
                        <div className="flex flex-col items-center gap-4">
                            <div className="relative">
                                <div className="w-14 h-14 rounded-full flex items-center justify-center"
                                    style={{ background: 'rgba(61,127,246,0.1)', border: '1px solid rgba(61,127,246,0.2)' }}>
                                    <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#3D7FF6' }} />
                                </div>
                            </div>
                            <div className="text-center">
                                <p className="text-[14px] font-medium mb-1" style={{ color: '#E8EDF5' }}>
                                    Generating PDF…
                                </p>
                                <p className="text-[12px]" style={{ color: '#3D4861' }}>
                                    Rendering {report.citations.length} sources into document
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Error state */}
                {error && (
                    <div className="absolute inset-0 flex items-center justify-center z-10">
                        <div className="flex flex-col items-center gap-4 text-center max-w-sm px-6">
                            <div className="w-12 h-12 rounded-full flex items-center justify-center"
                                style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
                                <X className="w-5 h-5" style={{ color: '#EF4444' }} />
                            </div>
                            <div>
                                <p className="text-[14px] font-medium mb-2" style={{ color: '#E8EDF5' }}>
                                    PDF Generation Failed
                                </p>
                                <p className="text-[12px] leading-relaxed" style={{ color: '#3D4861' }}>
                                    {error}
                                </p>
                            </div>
                            <button
                                onClick={onClose}
                                className="px-4 py-2 rounded-lg text-[13px] transition-colors hover:bg-white/[0.07]"
                                style={{ color: '#6D7A94' }}
                            >
                                Close
                            </button>
                        </div>
                    </div>
                )}

                {/* PDF iframe */}
                {pdfUrl && !loading && (
                    <div className="w-full h-full flex justify-center overflow-auto"
                        style={{ background: '#060810' }}>
                        <iframe
                            src={`${pdfUrl}#zoom=${zoom}`}
                            title="PDF Preview"
                            className="w-full h-full"
                            style={{ border: 'none', maxWidth: '960px' }}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
