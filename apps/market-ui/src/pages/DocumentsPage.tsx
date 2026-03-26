// Documents Page — Upload, ingest, and manage financial documents
// Drag-and-drop upload wired to Gravity API /v1/documents/ingest

import { useState, useEffect, useRef, useCallback } from 'react';
import {
    Upload, Database, Search, CheckCircle,
    AlertCircle, Loader2, File, X,
} from 'lucide-react';

interface IngestedDocument {
    id: string;
    ticker: string;
    company_name: string;
    filing_type: string;
    filing_date: string | null;
    title: string;
    chunk_count: number;
    status: string;
    created_at: string | null;
}

interface UploadState {
    file: File;
    progress: 'pending' | 'uploading' | 'done' | 'error';
    result?: any;
    error?: string;
}

const GRAVITY_API = 'http://localhost:8000';
const MAX_SIZE = 50 * 1024 * 1024; // 50 MB

export default function DocumentsPage() {
    const [documents, setDocuments] = useState<IngestedDocument[]>([]);
    const [loading, setLoading] = useState(true);
    const [filterTicker, setFilterTicker] = useState('');
    const [filterType, setFilterType] = useState('');
    const [uploads, setUploads] = useState<UploadState[]>([]);
    const [isDragOver, setIsDragOver] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // ── Fetch documents ────────────────────────────────────────────────────

    useEffect(() => { fetchDocuments(); }, [filterTicker, filterType]);

    const fetchDocuments = async () => {
        try {
            const params = new URLSearchParams();
            if (filterTicker) params.set('ticker', filterTicker);
            if (filterType) params.set('filing_type', filterType);
            params.set('limit', '50');

            const res = await fetch(`${GRAVITY_API}/v1/documents?${params}`);
            if (res.ok) {
                const data = await res.json();
                setDocuments(data.documents || []);
            }
        } catch {
            // Gravity API offline
        } finally {
            setLoading(false);
        }
    };

    // ── File uploading ──────────────────────────────────────────────────────

    const uploadFile = async (file: File, index: number) => {
        setUploads(prev => prev.map((u, i) => i === index ? { ...u, progress: 'uploading' } : u));

        try {
            const form = new FormData();
            form.append('file', file);

            const res = await fetch(`${GRAVITY_API}/v1/documents/ingest`, {
                method: 'POST',
                body: form,
            });

            if (!res.ok) {
                const errorData = await res.json().catch(() => ({}));
                throw new Error(errorData.detail || `Upload failed (${res.status})`);
            }

            const result = await res.json();
            setUploads(prev => prev.map((u, i) => i === index ? { ...u, progress: 'done', result } : u));

            // Refresh document list
            fetchDocuments();
        } catch (err) {
            setUploads(prev => prev.map((u, i) =>
                i === index ? { ...u, progress: 'error', error: err instanceof Error ? err.message : 'Upload failed' } : u
            ));
        }
    };

    const handleFiles = useCallback((files: FileList | File[]) => {
        const valid: UploadState[] = [];

        for (const file of Array.from(files)) {
            if (file.size > MAX_SIZE) {
                valid.push({ file, progress: 'error', error: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB)` });
                continue;
            }
            valid.push({ file, progress: 'pending' });
        }

        setUploads(prev => [...prev, ...valid]);

        // Start uploading pending files
        const startIdx = uploads.length;
        valid.forEach((u, i) => {
            if (u.progress === 'pending') {
                uploadFile(u.file, startIdx + i);
            }
        });
    }, [uploads.length]);

    // ── Drag & drop ─────────────────────────────────────────────────────────

    const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true); };
    const handleDragLeave = () => setIsDragOver(false);
    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);
        if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
    };

    const removeUpload = (index: number) => {
        setUploads(prev => prev.filter((_, i) => i !== index));
    };

    const formatDate = (d: string | null) => d ? new Date(d).toLocaleDateString() : '—';
    const formatSize = (chunks: number) => chunks > 0 ? `${chunks} chunks` : '—';

    return (
        <div className="p-8 max-w-6xl mx-auto">
            <div className="mb-8">
                <h1 className="text-3xl font-bold mb-2">Documents</h1>
                <p className="text-[#A7B0C8]">Upload and manage financial documents for search and analysis</p>
            </div>

            {/* Upload Zone */}
            <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`relative rounded-2xl border-2 border-dashed p-10 text-center cursor-pointer transition-all mb-8
                    ${isDragOver
                        ? 'border-[#00F0FF] bg-[#00F0FF]/5'
                        : 'border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.03]'
                    }`}
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept=".pdf,.docx,.txt,.html"
                    onChange={e => e.target.files && handleFiles(e.target.files)}
                    className="hidden"
                />
                <div className="flex flex-col items-center gap-3">
                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-colors ${isDragOver ? 'bg-[#00F0FF]/15' : 'bg-white/[0.04]'
                        }`}>
                        <Upload className={`w-6 h-6 ${isDragOver ? 'text-[#00F0FF]' : 'text-[#A7B0C8]'}`} />
                    </div>
                    <div>
                        <p className="text-sm text-white font-medium">
                            {isDragOver ? 'Drop files here' : 'Drag & drop files or click to browse'}
                        </p>
                        <p className="text-xs text-[#4A5568] mt-1">PDF, DOCX, TXT, HTML • Max 50 MB per file</p>
                    </div>
                </div>
            </div>

            {/* Active Uploads */}
            {uploads.length > 0 && (
                <div className="mb-8 space-y-2">
                    <h3 className="text-sm font-medium text-[#A7B0C8] mb-3">Uploads</h3>
                    {uploads.map((u, i) => (
                        <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-xl border border-white/[0.06] bg-white/[0.02]">
                            <File className="w-4 h-4 text-[#A7B0C8] flex-shrink-0" />
                            <span className="flex-1 text-sm text-white truncate">{u.file.name}</span>
                            <span className="text-xs text-[#4A5568]">{(u.file.size / 1024 / 1024).toFixed(1)} MB</span>

                            {u.progress === 'uploading' && (
                                <Loader2 className="w-4 h-4 text-[#00F0FF] animate-spin" />
                            )}
                            {u.progress === 'done' && (
                                <span className="flex items-center gap-1 text-xs text-green-400">
                                    <CheckCircle className="w-3.5 h-3.5" />
                                    {u.result?.chunk_count} chunks
                                </span>
                            )}
                            {u.progress === 'error' && (
                                <span className="flex items-center gap-1 text-xs text-red-400 max-w-[200px] truncate">
                                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                                    {u.error}
                                </span>
                            )}

                            <button onClick={() => removeUpload(i)} className="p-1 hover:bg-white/10 rounded-lg transition-colors">
                                <X className="w-3.5 h-3.5 text-[#4A5568]" />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* Filters */}
            <div className="flex items-center gap-3 mb-4">
                <div className="flex items-center gap-2 flex-1">
                    <Search className="w-4 h-4 text-[#4A5568]" />
                    <input
                        type="text"
                        value={filterTicker}
                        onChange={e => setFilterTicker(e.target.value)}
                        placeholder="Filter by ticker (e.g. AAPL)"
                        className="flex-1 max-w-[200px] bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-1.5 text-sm text-white placeholder:text-[#4A5568] focus:outline-none focus:border-[#00F0FF]/40"
                    />
                    <select
                        value={filterType}
                        onChange={e => setFilterType(e.target.value)}
                        className="bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-[#00F0FF]/40"
                    >
                        <option value="">All types</option>
                        <option value="10-K">10-K</option>
                        <option value="10-Q">10-Q</option>
                        <option value="8-K">8-K</option>
                        <option value="EARNINGS">Earnings</option>
                    </select>
                </div>
                <div className="flex items-center gap-2 text-xs text-[#4A5568]">
                    <Database className="w-4 h-4" />
                    {documents.length} documents
                </div>
            </div>

            {/* Documents Table */}
            <div className="rounded-xl border border-white/[0.06] overflow-hidden">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                            {['Title', 'Ticker', 'Type', 'Date', 'Chunks', 'Status', 'Indexed'].map(h => (
                                <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[#4A5568]">{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.04]">
                        {loading ? (
                            [1, 2, 3].map(i => (
                                <tr key={i}>
                                    {[1, 2, 3, 4, 5, 6, 7].map(j => (
                                        <td key={j} className="px-4 py-3">
                                            <div className="h-4 rounded bg-white/5 animate-pulse" />
                                        </td>
                                    ))}
                                </tr>
                            ))
                        ) : documents.length === 0 ? (
                            <tr>
                                <td colSpan={7} className="px-4 py-12 text-center text-[#4A5568]">
                                    {filterTicker || filterType
                                        ? 'No documents match your filters'
                                        : 'No documents ingested yet. Upload files above to get started.'}
                                </td>
                            </tr>
                        ) : (
                            documents.map(doc => (
                                <tr key={doc.id} className="hover:bg-white/[0.02] transition-colors">
                                    <td className="px-4 py-3">
                                        <span className="text-white truncate block max-w-[250px]">{doc.title || doc.id.slice(0, 8)}</span>
                                    </td>
                                    <td className="px-4 py-3">
                                        {doc.ticker && (
                                            <span className="text-xs text-[#00F0FF] bg-[#00F0FF]/10 px-2 py-0.5 rounded font-mono">{doc.ticker}</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-[#A7B0C8]">{doc.filing_type || '—'}</td>
                                    <td className="px-4 py-3 text-[#4A5568]">{formatDate(doc.filing_date)}</td>
                                    <td className="px-4 py-3 text-[#A7B0C8] font-mono">{formatSize(doc.chunk_count)}</td>
                                    <td className="px-4 py-3">
                                        <span className={`text-xs px-2 py-0.5 rounded ${doc.status === 'indexed' ? 'bg-green-500/10 text-green-400'
                                            : doc.status === 'error' ? 'bg-red-500/10 text-red-400'
                                                : 'bg-yellow-500/10 text-yellow-400'
                                            }`}>
                                            {doc.status || 'unknown'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-[#4A5568] text-xs">{formatDate(doc.created_at)}</td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
