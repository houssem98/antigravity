// Premium Finance Research Report — World-Class Design
// Bloomberg Terminal × AlphaSense × Perplexity Pro

import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
    ChevronDown, Share2, FileDown, Copy, Check,
    BookOpen, ExternalLink, Globe, BarChart3,
    Sparkles, TrendingUp, TrendingDown, Minus,
    Clock, Database, Calendar, Shield,
    Brain, HelpCircle, Headphones, FileText, X,
} from 'lucide-react';
import type { ResearchReport as ReportType, Citation, TemplateKey } from '../../services/deepResearchService';
import PdfPreview from './PdfPreview';

interface Props {
    report: ReportType;
    instant?: boolean;
    onClose?: () => void;
}

const TEMPLATE_LABELS: Record<TemplateKey, string> = {
    investment_memo: 'Investment Memo',
    earnings_preview: 'Earnings Preview',
    earnings_recap: 'Earnings Recap',
    thematic: 'Thematic Research',
    company_primer: 'Company Primer',
    comparative: 'Comparative Analysis',
};

/* ─────────────────── Sentiment detector ─────────────────── */
function detectSentiment(text: string): 'bullish' | 'bearish' | 'neutral' {
    const lower = text.toLowerCase();
    const b = ['growth', 'surge', 'bull', 'rise', 'gain', 'outperform', 'beat', 'strong',
        'positive', 'opportunity', 'upside', 'accelerat', 'momentum', 'record', 'expand',
        'robust', 'recovery'].filter(w => lower.includes(w)).length;
    const br = ['decline', 'fall', 'bear', 'loss', 'underperform', 'miss', 'risk', 'weak',
        'negative', 'downside', 'concern', 'contract', 'slowdown', 'recession',
        'headwind', 'pressure'].filter(w => lower.includes(w)).length;
    if (b > br + 2) return 'bullish';
    if (br > b + 2) return 'bearish';
    return 'neutral';
}

/* ─────────────────── Source card ─────────────────── */
function SourceCard({ c }: { c: Citation }) {
    const isSEC = c.source === 'SEC EDGAR';
    const domain = (() => {
        try { return new URL(c.url).hostname.replace('www.', ''); }
        catch { return c.source; }
    })();

    return (
        <a
            href={c.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-start gap-3 p-3.5 rounded-xl border transition-all"
            style={{
                background: '#0C0F1C',
                borderColor: 'rgba(255,255,255,0.06)',
            }}
            onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.13)';
                (e.currentTarget as HTMLElement).style.background = '#111428';
            }}
            onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.06)';
                (e.currentTarget as HTMLElement).style.background = '#111318';
            }}
        >
            {/* Icon / favicon */}
            <div className="flex-shrink-0 mt-0.5 w-6 h-6 rounded overflow-hidden flex items-center justify-center"
                style={{ background: isSEC ? '#0F2744' : 'rgba(255,255,255,0.05)' }}>
                {isSEC
                    ? <Shield className="w-3.5 h-3.5" style={{ color: '#60A5FA' }} />
                    : <img
                        src={`https://www.google.com/s2/favicons?domain=${domain}&sz=16`}
                        className="w-4 h-4"
                        alt=""
                        onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                }
            </div>

            {/* Text */}
            <div className="flex-1 min-w-0">
                <div className="flex items-start gap-1.5 mb-1">
                    <span className="inline-block text-[10px] font-mono font-bold px-1.5 py-0.5 rounded flex-shrink-0"
                        style={{ background: 'rgba(61,127,246,0.13)', color: '#3D7FF6' }}>
                        [{c.id}]
                    </span>
                    <p className="text-[12px] leading-[1.4] transition-colors line-clamp-2"
                        style={{ color: '#8D95A8' }}>
                        {c.title}
                    </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px]" style={{ color: '#3D4861' }}>{domain}</span>
                    {c.publishedDate && (
                        <>
                            <span style={{ color: 'rgba(255,255,255,0.1)' }}>·</span>
                            <span className="text-[10px]" style={{ color: '#3D4861' }}>{c.publishedDate}</span>
                        </>
                    )}
                    {isSEC && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded"
                            style={{ background: 'rgba(96,165,250,0.1)', color: '#60A5FA' }}>
                            SEC EDGAR
                        </span>
                    )}
                </div>
            </div>

            <ExternalLink className="w-3 h-3 flex-shrink-0 mt-0.5 opacity-0 group-hover:opacity-50 transition-opacity"
                style={{ color: '#8D95A8' }} />
        </a>
    );
}

/* ─────────────────── Main component ─────────────────── */
export default function ResearchReport({ report, instant, onClose }: Props) {
    const [revealedChars, setRevealedChars] = useState(instant ? report.markdown.length : 0);
    const [isFullyRevealed, setIsFullyRevealed] = useState(instant === true);
    const [copied, setCopied] = useState(false);
    const [showContents, setShowContents] = useState(false);
    const [showShareMenu, setShowShareMenu] = useState(false);
    const [showCreateMenu, setShowCreateMenu] = useState(false);
    const [showPreview, setShowPreview] = useState(false);
    const [activeSection, setActiveSection] = useState('');
    const reportRef = useRef<HTMLDivElement>(null);

    /* Typewriter — 80 chars / 16ms ≈ 5000 chars/sec */
    useEffect(() => {
        if (isFullyRevealed) return;
        const timer = setInterval(() => {
            setRevealedChars(prev => {
                const next = Math.min(prev + 80, report.markdown.length);
                if (next >= report.markdown.length) { clearInterval(timer); setIsFullyRevealed(true); }
                return next;
            });
        }, 16);
        return () => clearInterval(timer);
    }, [report.markdown.length, isFullyRevealed]);

    /* Preprocess: [1] → superscript citation link */
    const process = (md: string) => md.replace(/\[(\d+)\]/g, (_, n) => `[${n}](#cite-${n})`);

    const displayedMarkdown = process(
        isFullyRevealed ? report.markdown : report.markdown.substring(0, revealedChars)
    );

    /* TOC extraction */
    const toc = (() => {
        const regex = /^(#{2,3})\s+(.+)$/gm;
        const items: { level: number; text: string; id: string }[] = [];
        let m;
        while ((m = regex.exec(report.markdown)) !== null) {
            const text = m[2].replace(/\*\*/g, '').replace(/\[.*?\]/g, '').trim();
            const id = text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
            items.push({ level: m[1].length, text, id });
        }
        return items;
    })();

    /* Helpers */
    const handleCopy = async () => {
        await navigator.clipboard.writeText(report.markdown);
        setCopied(true); setTimeout(() => setCopied(false), 2000);
    };
    const skipAnimation = () => { setRevealedChars(report.markdown.length); setIsFullyRevealed(true); };

    /* Scroll spy */
    useEffect(() => {
        if (!isFullyRevealed) return;
        const obs = new IntersectionObserver(
            entries => entries.forEach(e => { if (e.isIntersecting) setActiveSection(e.target.id); }),
            { rootMargin: '-80px 0px -75% 0px' }
        );
        reportRef.current?.querySelectorAll('h2, h3').forEach(h => obs.observe(h));
        return () => obs.disconnect();
    }, [isFullyRevealed]);

    /* Close dropdowns on outside click */
    useEffect(() => {
        const h = () => { setShowContents(false); setShowShareMenu(false); setShowCreateMenu(false); };
        document.addEventListener('click', h);
        return () => document.removeEventListener('click', h);
    }, []);

    const cleanTitle = report.title?.replace(/\*\*/g, '').replace(/^#+\s*/, '').trim() || 'Research Report';
    const generatedDate = new Date(report.metadata.generatedAt).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
    });
    const sentiment = detectSentiment(report.markdown);
    const SENTIMENT = {
        bullish: { Icon: TrendingUp, color: '#10B981', bg: 'rgba(16,185,129,0.1)', label: 'Bullish Outlook' },
        bearish: { Icon: TrendingDown, color: '#EF4444', bg: 'rgba(239,68,68,0.1)', label: 'Bearish Outlook' },
        neutral:  { Icon: Minus,       color: '#94A3B8', bg: 'rgba(148,163,184,0.1)', label: 'Neutral Outlook' },
    }[sentiment];

    const dropdownBase: React.CSSProperties = {
        background: '#0E1120',
        border: '1px solid rgba(255,255,255,0.07)',
    };

    /* ─── Markdown custom renderers ─── */
    const mdComponents: React.ComponentProps<typeof ReactMarkdown>['components'] = {
        h1: ({ children }) => (
            <h1 className="text-[28px] font-bold mb-5 leading-tight tracking-tight" style={{ color: '#F0F2F5' }}>
                {children}
            </h1>
        ),
        h2: ({ children }) => {
            const text = String(children ?? '').replace(/[^\w\s-]/g, '');
            const id = text.toLowerCase().replace(/\s+/g, '-');
            return (
                <h2 id={id} className="flex items-center gap-3 text-[19px] font-bold mt-12 mb-4 scroll-mt-20" style={{ color: '#E8EDF5' }}>
                    <span className="inline-block w-[3px] h-5 rounded-full flex-shrink-0"
                        style={{ background: 'linear-gradient(180deg, #3D7FF6, #7C3AED)' }} />
                    {children}
                </h2>
            );
        },
        h3: ({ children }) => {
            const text = String(children ?? '').replace(/[^\w\s-]/g, '');
            const id = text.toLowerCase().replace(/\s+/g, '-');
            return (
                <h3 id={id} className="text-[15px] font-semibold mt-8 mb-3 scroll-mt-20" style={{ color: '#C8D4EC' }}>
                    {children}
                </h3>
            );
        },
        h4: ({ children }) => (
            <h4 className="text-[12px] font-bold uppercase tracking-widest mt-6 mb-2" style={{ color: '#5A6480' }}>
                {children}
            </h4>
        ),
        p: ({ children }) => (
            <p className="mb-4 text-[14.5px] leading-[1.88]" style={{ color: '#A0AABF' }}>
                {children}
            </p>
        ),
        strong: ({ children }) => (
            <strong className="font-semibold" style={{ color: '#E0E8F5' }}>{children}</strong>
        ),
        em: ({ children }) => (
            <em className="italic" style={{ color: '#B8C6DE' }}>{children}</em>
        ),
        a: ({ href, children }) => {
            /* Citation superscript */
            if (href?.startsWith('#cite-')) {
                const id = href.replace('#cite-', '');
                return (
                    <sup>
                        <a
                            href={`#citation-${id}`}
                            className="inline-block min-w-[16px] text-center px-1 py-0.5 rounded text-[10px] font-mono font-bold mx-0.5 transition-opacity hover:opacity-70"
                            style={{ backgroundColor: 'rgba(61,127,246,0.15)', color: '#3D7FF6' }}
                        >
                            {id}
                        </a>
                    </sup>
                );
            }
            return (
                <a href={href} target="_blank" rel="noopener noreferrer"
                    className="underline underline-offset-2 transition-colors hover:opacity-80"
                    style={{ color: '#3D7FF6', textDecorationColor: 'rgba(61,127,246,0.35)' }}>
                    {children}
                </a>
            );
        },
        blockquote: ({ children }) => (
            <div className="my-6 rounded-xl overflow-hidden"
                style={{ border: '1px solid rgba(61,127,246,0.22)', background: 'rgba(61,127,246,0.06)' }}>
                <div className="flex items-center gap-2 px-5 pt-4 pb-0">
                    <Sparkles className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#3D7FF6' }} />
                    <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#3D7FF6' }}>
                        Key Finding
                    </span>
                </div>
                <div className="px-5 pb-4 pt-2 text-[14px] leading-[1.75]" style={{ color: '#BDC8E0' }}>
                    {children}
                </div>
            </div>
        ),
        ul: ({ children }) => <ul className="my-4 space-y-2">{children}</ul>,
        ol: ({ children }) => <ol className="my-4 space-y-2 list-none">{children}</ol>,
        li: ({ children }) => (
            <li className="flex items-start gap-2.5 text-[14px] leading-[1.75]" style={{ color: '#A0AABF' }}>
                <span className="w-[5px] h-[5px] rounded-full flex-shrink-0 mt-[10px]"
                    style={{ background: 'rgba(61,127,246,0.6)' }} />
                <span className="flex-1">{children}</span>
            </li>
        ),
        table: ({ children }) => (
            <div className="my-7 rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">{children}</table>
                </div>
            </div>
        ),
        thead: ({ children }) => (
            <thead style={{ background: 'linear-gradient(90deg, rgba(61,127,246,0.1), rgba(124,58,237,0.07))' }}>
                {children}
            </thead>
        ),
        th: ({ children }) => (
            <th className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wider border-b"
                style={{ color: '#6D7A94', borderColor: 'rgba(255,255,255,0.07)' }}>
                {children}
            </th>
        ),
        td: ({ children }) => (
            <td className="px-4 py-3 text-[13px] border-b" style={{ color: '#A0AABF', borderColor: 'rgba(255,255,255,0.04)' }}>
                {children}
            </td>
        ),
        code: ({ children, className }) => {
            const isBlock = className?.includes('language-');
            return isBlock ? (
                <div className="my-5 rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div className="px-4 py-2 text-[10px] font-mono uppercase border-b"
                        style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.06)', color: '#3D4861' }}>
                        {className?.replace('language-', '') || 'code'}
                    </div>
                    <pre className="p-4 overflow-x-auto" style={{ background: '#080B14' }}>
                        <code className="text-[13px] font-mono leading-relaxed" style={{ color: '#E8EDF5' }}>
                            {children}
                        </code>
                    </pre>
                </div>
            ) : (
                <code className="px-1.5 py-0.5 rounded-md text-[12px] font-mono"
                    style={{ background: 'rgba(255,255,255,0.06)', color: '#F87171' }}>
                    {children}
                </code>
            );
        },
        hr: () => <hr className="my-10 h-px border-none" style={{ background: 'rgba(255,255,255,0.06)' }} />,
    };

    return (
        <div className="min-h-full" style={{ background: '#070A12' }}>

            {/* ══════════════════════════════════════════════
                GRADIENT TOP ACCENT LINE
            ══════════════════════════════════════════════ */}
            <div className="h-[2px] w-full"
                style={{ background: 'linear-gradient(90deg, #3D7FF6 0%, #7C3AED 50%, #EC4899 100%)' }} />

            {/* ══════════════════════════════════════════════
                METADATA HEADER
            ══════════════════════════════════════════════ */}
            <div className="border-b" style={{ borderColor: 'rgba(255,255,255,0.05)', background: '#0A0D18' }}>
                <div className="max-w-[1120px] mx-auto px-8 py-6">
                    {/* Title */}
                    <h1 className="text-[22px] md:text-[26px] font-bold mb-4 leading-tight tracking-tight"
                        style={{ color: '#F0F2F5' }}>
                        {cleanTitle}
                    </h1>

                    {/* Stats row */}
                    <div className="flex items-center flex-wrap gap-3">
                        {/* Sentiment chip */}
                        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-semibold"
                            style={{ background: SENTIMENT.bg, color: SENTIMENT.color }}>
                            <SENTIMENT.Icon className="w-3.5 h-3.5" />
                            {SENTIMENT.label}
                        </div>

                        {/* Divider */}
                        <span style={{ color: 'rgba(255,255,255,0.08)' }}>|</span>

                        <div className="flex items-center gap-1.5 text-[12px]" style={{ color: '#3D4861' }}>
                            <Database className="w-3 h-3" />
                            <span>{report.metadata.sourcesAnalyzed} sources</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[12px]" style={{ color: '#3D4861' }}>
                            <Clock className="w-3 h-3" />
                            <span>{report.metadata.estimatedReadTime} min read</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[12px]" style={{ color: '#3D4861' }}>
                            <Calendar className="w-3 h-3" />
                            <span>{generatedDate}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[12px]" style={{ color: '#3D4861' }}>
                            <Sparkles className="w-3 h-3" />
                            <span>AI Research Engine</span>
                        </div>
                    </div>

                    {/* Phase-1/2 metadata strip: template, grounding, budget */}
                    {(report.metadata.confidence || report.metadata.template || report.metadata.verification || report.metadata.claimAudit || report.metadata.citationDensity || report.metadata.factInference || report.metadata.sectionFanout || report.metadata.contextualRetrieval || report.metadata.distillation || report.metadata.revisions || report.metadata.injectionDefense || report.metadata.readers || report.metadata.recency || report.metadata.hitl || report.metadata.budget) && (
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                            {report.metadata.confidence && (() => {
                                const c = report.metadata.confidence;
                                const bg = c === 'High' ? 'rgba(34, 197, 94, 0.14)' : c === 'Medium' ? 'rgba(234, 179, 8, 0.14)' : 'rgba(239, 68, 68, 0.14)';
                                const border = c === 'High' ? 'rgba(34, 197, 94, 0.3)' : c === 'Medium' ? 'rgba(234, 179, 8, 0.3)' : 'rgba(239, 68, 68, 0.3)';
                                const color = c === 'High' ? '#86EFAC' : c === 'Medium' ? '#FDE68A' : '#FCA5A5';
                                const tip = c === 'High'
                                    ? 'Numeric grounding, multi-source corroboration, citation density, and fact-vs-inference separation all cleared the High threshold.'
                                    : c === 'Medium'
                                        ? 'Numeric grounding, citation density, and hedged-forecast discipline cleared Medium. Re-verify single-source figures and unhedged forecasts before publication.'
                                        : 'One or more grounding signals (numeric rate, citation density, hedged forecasts) below threshold. Primary-source verification required.';
                                return (
                                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium"
                                        style={{ background: bg, color, border: `1px solid ${border}` }}
                                        title={tip}>
                                        <Shield className="w-3 h-3" />
                                        <span>Confidence: {c}</span>
                                    </div>
                                );
                            })()}
                            {report.metadata.template && (
                                <div className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px]"
                                    style={{ background: 'rgba(99, 102, 241, 0.12)', color: '#A5B4FC', border: '1px solid rgba(99, 102, 241, 0.25)' }}>
                                    <FileText className="w-3 h-3" />
                                    <span>{TEMPLATE_LABELS[report.metadata.template] || report.metadata.template}</span>
                                </div>
                            )}
                            {report.metadata.verification && report.metadata.verification.totalClaims > 0 && (() => {
                                const v = report.metadata.verification;
                                const rate = v.groundedClaims / v.totalClaims;
                                const bg = rate >= 0.85 ? 'rgba(34, 197, 94, 0.12)' : rate >= 0.6 ? 'rgba(234, 179, 8, 0.12)' : 'rgba(239, 68, 68, 0.12)';
                                const border = rate >= 0.85 ? 'rgba(34, 197, 94, 0.25)' : rate >= 0.6 ? 'rgba(234, 179, 8, 0.25)' : 'rgba(239, 68, 68, 0.25)';
                                const color = rate >= 0.85 ? '#86EFAC' : rate >= 0.6 ? '#FDE68A' : '#FCA5A5';
                                const tip = [
                                    v.unsupportedClaims.length > 0 ? `Unsupported: ${v.unsupportedClaims.slice(0, 5).join(', ')}` : 'All numeric claims grounded in sources',
                                    v.singleSourceClaims && v.singleSourceClaims.length > 0
                                        ? `Single-source (flagged for cross-reference): ${v.singleSourceClaims.slice(0, 5).join(', ')}`
                                        : '',
                                ].filter(Boolean).join('\n');
                                const multiLabel = typeof v.multiSourceClaims === 'number'
                                    ? ` · ${v.multiSourceClaims} corroborated`
                                    : '';
                                return (
                                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px]"
                                        style={{ background: bg, color, border: `1px solid ${border}` }}
                                        title={tip}>
                                        <Shield className="w-3 h-3" />
                                        <span>{v.groundedClaims}/{v.totalClaims} numeric grounded{multiLabel}</span>
                                    </div>
                                );
                            })()}
                            {report.metadata.claimAudit && report.metadata.claimAudit.audited > 0 && (() => {
                                const a = report.metadata.claimAudit!;
                                const rate = a.supported / a.audited;
                                const bg = rate >= 0.85 ? 'rgba(34, 197, 94, 0.12)' : rate >= 0.6 ? 'rgba(234, 179, 8, 0.12)' : 'rgba(239, 68, 68, 0.12)';
                                const border = rate >= 0.85 ? 'rgba(34, 197, 94, 0.25)' : rate >= 0.6 ? 'rgba(234, 179, 8, 0.25)' : 'rgba(239, 68, 68, 0.25)';
                                const color = rate >= 0.85 ? '#86EFAC' : rate >= 0.6 ? '#FDE68A' : '#FCA5A5';
                                const flagged = a.flags.map(f => `[${f.status}] ${f.claim.slice(0, 80)}`).join('\n');
                                return (
                                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px]"
                                        style={{ background: bg, color, border: `1px solid ${border}` }}
                                        title={flagged || 'All audited claims supported'}>
                                        <Shield className="w-3 h-3" />
                                        <span>{a.supported}/{a.audited} claims LLM-audited</span>
                                    </div>
                                );
                            })()}
                            {report.metadata.citationDensity && report.metadata.citationDensity.totalFactSentences > 0 && (() => {
                                const d = report.metadata.citationDensity!;
                                const rate = d.density;
                                const bg = rate >= 0.85 ? 'rgba(34, 197, 94, 0.12)' : rate >= 0.6 ? 'rgba(234, 179, 8, 0.12)' : 'rgba(239, 68, 68, 0.12)';
                                const border = rate >= 0.85 ? 'rgba(34, 197, 94, 0.25)' : rate >= 0.6 ? 'rgba(234, 179, 8, 0.25)' : 'rgba(239, 68, 68, 0.25)';
                                const color = rate >= 0.85 ? '#86EFAC' : rate >= 0.6 ? '#FDE68A' : '#FCA5A5';
                                const tip = d.uncitedSamples.length > 0
                                    ? `Uncited factual sentences:\n` + d.uncitedSamples.map(s => '• ' + s).join('\n')
                                    : 'Every factual sentence carries an inline citation';
                                return (
                                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px]"
                                        style={{ background: bg, color, border: `1px solid ${border}` }}
                                        title={tip}>
                                        <Shield className="w-3 h-3" />
                                        <span>{d.citedSentences}/{d.totalFactSentences} sentences cited ({Math.round(rate * 100)}%)</span>
                                    </div>
                                );
                            })()}
                            {report.metadata.factInference && report.metadata.factInference.totalForwardLooking > 0 && (() => {
                                const fi = report.metadata.factInference!;
                                const rate = fi.hedgingRate;
                                const bg = rate >= 0.85 ? 'rgba(34, 197, 94, 0.12)' : rate >= 0.6 ? 'rgba(234, 179, 8, 0.12)' : 'rgba(239, 68, 68, 0.12)';
                                const border = rate >= 0.85 ? 'rgba(34, 197, 94, 0.25)' : rate >= 0.6 ? 'rgba(234, 179, 8, 0.25)' : 'rgba(239, 68, 68, 0.25)';
                                const color = rate >= 0.85 ? '#86EFAC' : rate >= 0.6 ? '#FDE68A' : '#FCA5A5';
                                const tip = fi.unhedgedSamples.length > 0
                                    ? `Unhedged forward-looking sentences (flagged as speculation):\n` + fi.unhedgedSamples.map(s => '• ' + s).join('\n')
                                    : 'Every forward-looking claim is hedged or attributed';
                                return (
                                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px]"
                                        style={{ background: bg, color, border: `1px solid ${border}` }}
                                        title={tip}>
                                        <Shield className="w-3 h-3" />
                                        <span>{fi.hedgedCount}/{fi.totalForwardLooking} forecasts hedged ({Math.round(rate * 100)}%)</span>
                                    </div>
                                );
                            })()}
                            {report.metadata.sectionFanout && report.metadata.sectionFanout.planned > 0 && (() => {
                                const f = report.metadata.sectionFanout!;
                                const rate = f.planned > 0 ? f.completed / f.planned : 0;
                                const active = f.used && rate >= 0.6;
                                const bg = active ? 'rgba(56, 189, 248, 0.12)' : 'rgba(156, 163, 175, 0.10)';
                                const border = active ? 'rgba(56, 189, 248, 0.3)' : 'rgba(156, 163, 175, 0.25)';
                                const color = active ? '#7DD3FC' : '#9CA3AF';
                                const tip = f.used
                                    ? `Parallel section fanout: ${f.completed}/${f.planned} sections written concurrently${f.failed > 0 ? ` (${f.failed} failed)` : ''}. Each section saw only its relevant evidence slice.`
                                    : 'Section fanout skipped — monolith Writer used (budget-constrained or fallback triggered).';
                                return (
                                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px]"
                                        style={{ background: bg, color, border: `1px solid ${border}` }}
                                        title={tip}>
                                        <Sparkles className="w-3 h-3" />
                                        <span>{f.used ? `Fanout ${f.completed}/${f.planned}` : 'Monolith Writer'}</span>
                                    </div>
                                );
                            })()}
                            {report.metadata.contextualRetrieval && report.metadata.contextualRetrieval.total > 0 && (() => {
                                const cr = report.metadata.contextualRetrieval!;
                                const rate = cr.total > 0 ? cr.enriched / cr.total : 0;
                                const active = cr.used && rate >= 0.8;
                                const bg = active ? 'rgba(168, 85, 247, 0.12)' : 'rgba(156, 163, 175, 0.10)';
                                const border = active ? 'rgba(168, 85, 247, 0.3)' : 'rgba(156, 163, 175, 0.25)';
                                const color = active ? '#D8B4FE' : '#9CA3AF';
                                const tip = cr.used
                                    ? `Contextual Retrieval: ${cr.enriched}/${cr.total} sources tagged with self-describing context (${cr.llmBatches} LLM batch${cr.llmBatches === 1 ? '' : 'es'}${cr.cacheHits > 0 ? `, ${cr.cacheHits} from cache` : ''}${cr.deterministicBatches > 0 ? `, ${cr.deterministicBatches} deterministic fallback` : ''}). Writer sees source type, entity, date, and query relevance inline with every citation.`
                                    : 'Contextual Retrieval skipped (no sources).';
                                return (
                                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px]"
                                        style={{ background: bg, color, border: `1px solid ${border}` }}
                                        title={tip}>
                                        <Sparkles className="w-3 h-3" />
                                        <span>Contextual Retrieval {cr.enriched}/{cr.total}</span>
                                    </div>
                                );
                            })()}
                            {report.metadata.distillation && report.metadata.distillation.used && !report.metadata.distillation.fallback && (() => {
                                const dd = report.metadata.distillation!;
                                const savedPct = Math.round((1 - dd.compressionRatio) * 100);
                                const tip = `Context distillation: accumulated intelligence compressed ${dd.inputChars.toLocaleString()} → ${dd.outputChars.toLocaleString()} chars (${savedPct}% saved) before Writer handoff. Preserves numeric facts and named quotes that a silent substring truncation would drop from later rounds.`;
                                return (
                                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px]"
                                        style={{ background: 'rgba(20, 184, 166, 0.12)', color: '#5EEAD4', border: '1px solid rgba(20, 184, 166, 0.3)' }}
                                        title={tip}>
                                        <Sparkles className="w-3 h-3" />
                                        <span>Distilled −{savedPct}%</span>
                                    </div>
                                );
                            })()}
                            {report.metadata.recency && report.metadata.recency.total > 0 && (() => {
                                const rc = report.metadata.recency!;
                                const freshRate = rc.total > 0 ? (rc.fresh + rc.recent) / rc.total : 0;
                                const healthy = freshRate >= 0.6;
                                const bg = healthy ? 'rgba(16, 185, 129, 0.12)' : 'rgba(234, 179, 8, 0.12)';
                                const color = healthy ? '#6EE7B7' : '#FDE047';
                                const border = healthy ? 'rgba(16, 185, 129, 0.3)' : 'rgba(234, 179, 8, 0.3)';
                                const parts: string[] = [];
                                if (rc.fresh > 0) parts.push(`${rc.fresh} fresh (≤90d)`);
                                if (rc.recent > 0) parts.push(`${rc.recent} recent (≤1y)`);
                                if (rc.stale > 0) parts.push(`${rc.stale} stale (1–3y)`);
                                if (rc.archival > 0) parts.push(`${rc.archival} archival (>3y)`);
                                if (rc.undated > 0) parts.push(`${rc.undated} undated`);
                                const tip = `Source recency across ${rc.total} web sources: ${parts.join(', ')}. Recency is blended into the ranking score — a 2022 aggregator post cannot outrank a 2026 Reuters wire on freshness-sensitive queries.`;
                                return (
                                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px]"
                                        style={{ background: bg, color, border: `1px solid ${border}` }}
                                        title={tip}>
                                        <Sparkles className="w-3 h-3" />
                                        <span>{rc.fresh + rc.recent}/{rc.total} recent</span>
                                    </div>
                                );
                            })()}
                            {report.metadata.readers && report.metadata.readers.totalReaders > 0 && (() => {
                                const rd = report.metadata.readers!;
                                const successRate = rd.totalReaders > 0 ? rd.succeeded / rd.totalReaders : 0;
                                const healthy = successRate >= 0.6 && rd.fallbackRounds === 0;
                                const bg = healthy ? 'rgba(59, 130, 246, 0.12)' : 'rgba(249, 115, 22, 0.12)';
                                const color = healthy ? '#93C5FD' : '#FDBA74';
                                const border = healthy ? 'rgba(59, 130, 246, 0.3)' : 'rgba(249, 115, 22, 0.3)';
                                const pieces: string[] = [];
                                if (rd.cacheHits > 0) pieces.push(`${rd.cacheHits} from cache`);
                                if (rd.noRelevantFacts > 0) pieces.push(`${rd.noRelevantFacts} reported no relevant facts`);
                                if (rd.failed > 0) pieces.push(`${rd.failed} failed`);
                                if (rd.fallbackRounds > 0) pieces.push(`${rd.fallbackRounds} round${rd.fallbackRounds === 1 ? '' : 's'} fell back to monolithic extractor`);
                                const tip = `Reader/Extractor: ${rd.succeeded} of ${rd.totalReaders} per-source parallel Readers produced usable fact summaries${pieces.length > 0 ? ' (' + pieces.join(', ') + ')' : ''}. Each Reader reads ONE source; the Extractor merges their outputs into the round brief.`;
                                return (
                                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px]"
                                        style={{ background: bg, color, border: `1px solid ${border}` }}
                                        title={tip}>
                                        <Sparkles className="w-3 h-3" />
                                        <span>Readers {rd.succeeded}/{rd.totalReaders}</span>
                                    </div>
                                );
                            })()}
                            {report.metadata.injectionDefense && report.metadata.injectionDefense.scanned > 0 && (() => {
                                const ij = report.metadata.injectionDefense!;
                                const hot = ij.flagged > 0;
                                const bg = hot ? 'rgba(239, 68, 68, 0.12)' : 'rgba(34, 197, 94, 0.10)';
                                const color = hot ? '#FCA5A5' : '#86EFAC';
                                const border = hot ? 'rgba(239, 68, 68, 0.3)' : 'rgba(34, 197, 94, 0.25)';
                                const patternSummary = Object.entries(ij.patternHits)
                                    .sort((a, b) => (b[1] as number) - (a[1] as number))
                                    .slice(0, 4)
                                    .map(([k, v]) => `${k} ×${v}`)
                                    .join(', ');
                                const tip = hot
                                    ? `Prompt-injection defense: ${ij.flagged} of ${ij.scanned} untrusted web snippets contained injection-attempt patterns (${patternSummary}). Patterns were redacted before any LLM saw them.`
                                    : `Prompt-injection defense: scanned ${ij.scanned} untrusted web snippet${ij.scanned === 1 ? '' : 's'} — none contained known injection patterns.`;
                                return (
                                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px]"
                                        style={{ background: bg, color, border: `1px solid ${border}` }}
                                        title={tip}>
                                        <Sparkles className="w-3 h-3" />
                                        <span>{hot ? `${ij.flagged} injection${ij.flagged === 1 ? '' : 's'} blocked` : `${ij.scanned} snippet${ij.scanned === 1 ? '' : 's'} clean`}</span>
                                    </div>
                                );
                            })()}
                            {report.metadata.revisions && report.metadata.revisions.used && report.metadata.revisions.accepted && report.metadata.revisions.editsApplied > 0 && (() => {
                                const rv = report.metadata.revisions!;
                                const delta = rv.issuesBefore - rv.issuesAfter;
                                const tip = `Self-revision: senior reviewer pass applied ${rv.editsApplied} surgical edit${rv.editsApplied === 1 ? '' : 's'} to the draft — flagged issues reduced from ${rv.issuesBefore} to ${rv.issuesAfter} (−${delta}). Revisor only accepts edits that strictly reduce aggregate issue count.`;
                                return (
                                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px]"
                                        style={{ background: 'rgba(245, 158, 11, 0.12)', color: '#FCD34D', border: '1px solid rgba(245, 158, 11, 0.3)' }}
                                        title={tip}>
                                        <Sparkles className="w-3 h-3" />
                                        <span>{rv.editsApplied} edit{rv.editsApplied === 1 ? '' : 's'} · −{delta} issue{delta === 1 ? '' : 's'}</span>
                                    </div>
                                );
                            })()}
                            {report.metadata.hitl && report.metadata.hitl.used && (() => {
                                const h = report.metadata.hitl!;
                                const tip = h.modified
                                    ? 'Human-in-the-loop plan review: analyst edited the research blueprint (queries, SEC targets, angles) before retrieval fired. Reflects deliberate scoping choices rather than the LLM\'s first pass.'
                                    : 'Human-in-the-loop plan review: analyst inspected the auto-generated blueprint and accepted it as-is before retrieval fired.';
                                return (
                                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px]"
                                        style={{ background: 'rgba(236, 72, 153, 0.12)', color: '#F9A8D4', border: '1px solid rgba(236, 72, 153, 0.3)' }}
                                        title={tip}>
                                        <Sparkles className="w-3 h-3" />
                                        <span>{h.modified ? 'Plan edited by analyst' : 'Plan approved by analyst'}</span>
                                    </div>
                                );
                            })()}
                            {report.metadata.budget && (
                                <div className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px]"
                                    style={{ background: 'rgba(255,255,255,0.04)', color: '#6B7280', border: '1px solid rgba(255,255,255,0.08)' }}
                                    title="LLM calls and estimated tokens consumed by this query">
                                    <Brain className="w-3 h-3" />
                                    <span>{report.metadata.budget.llmCalls} LLM calls · ~{Math.round(report.metadata.budget.estimatedTokens / 1000)}k tokens</span>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* ══════════════════════════════════════════════
                STICKY ACTION TOOLBAR
            ══════════════════════════════════════════════ */}
            <div className="sticky top-0 z-50 border-b"
                style={{
                    background: 'rgba(7,10,18,0.92)',
                    backdropFilter: 'blur(20px)',
                    borderColor: 'rgba(255,255,255,0.06)',
                }}>
                <div className="max-w-[1120px] mx-auto px-8 py-2 flex items-center gap-0.5">

                    {/* Contents dropdown */}
                    <div className="relative">
                        <button
                            onClick={e => { e.stopPropagation(); setShowContents(!showContents); setShowShareMenu(false); setShowCreateMenu(false); }}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] transition-colors hover:bg-white/[0.06]"
                            style={{ color: '#6D7A94' }}>
                            Contents
                            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showContents ? 'rotate-180' : ''}`} />
                        </button>
                        {showContents && (
                            <div onClick={e => e.stopPropagation()}
                                className="absolute left-0 top-full mt-1.5 w-72 max-h-[60vh] overflow-y-auto rounded-xl shadow-2xl z-50"
                                style={dropdownBase}>
                                <p className="px-4 pt-3 pb-2 text-[10px] uppercase tracking-widest font-semibold"
                                    style={{ color: '#3D4861' }}>
                                    Table of Contents
                                </p>
                                {toc.map((item, i) => (
                                    <a key={i} href={`#${item.id}`} onClick={() => setShowContents(false)}
                                        className={`flex items-center gap-2 py-2 text-[13px] transition-colors hover:bg-white/[0.04] truncate
                                            ${item.level === 2 ? 'px-4 font-medium' : 'px-8 text-[12px]'}
                                            ${activeSection === item.id ? '' : ''}`}
                                        style={{ color: activeSection === item.id ? '#3D7FF6' : '#6D7A94' }}>
                                        {item.level === 3 && (
                                            <span className="w-1 h-1 rounded-full flex-shrink-0"
                                                style={{ background: 'rgba(255,255,255,0.2)' }} />
                                        )}
                                        <span className="truncate">{item.text}</span>
                                    </a>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Share & Export dropdown */}
                    <div className="relative">
                        <button
                            onClick={e => { e.stopPropagation(); setShowShareMenu(!showShareMenu); setShowContents(false); setShowCreateMenu(false); }}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] transition-colors hover:bg-white/[0.06]"
                            style={{ color: '#6D7A94' }}>
                            <Share2 className="w-3.5 h-3.5" />
                            Share & Export
                            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showShareMenu ? 'rotate-180' : ''}`} />
                        </button>
                        {showShareMenu && (
                            <div onClick={e => e.stopPropagation()}
                                className="absolute left-0 top-full mt-1.5 w-52 rounded-xl shadow-2xl py-1.5 z-50"
                                style={dropdownBase}>
                                {[
                                    { icon: Share2, label: 'Share', fn: () => { navigator.share?.({ title: cleanTitle, text: report.summary }); setShowShareMenu(false); } },
                                    { icon: FileDown, label: 'Export to PDF', fn: () => { setShowPreview(true); setShowShareMenu(false); } },
                                    { icon: copied ? Check : Copy, label: copied ? 'Copied!' : 'Copy Markdown', fn: () => { handleCopy(); setShowShareMenu(false); } },
                                ].map(({ icon: Icon, label, fn }) => (
                                    <button key={label} onClick={fn}
                                        className="w-full flex items-center gap-3 px-4 py-2.5 text-[13px] transition-colors hover:bg-white/[0.04]"
                                        style={{ color: '#A0AABF' }}>
                                        <Icon className="w-4 h-4" style={{ color: '#3D4861' }} />
                                        {label}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Create dropdown */}
                    <div className="relative">
                        <button
                            onClick={e => { e.stopPropagation(); setShowCreateMenu(!showCreateMenu); setShowContents(false); setShowShareMenu(false); }}
                            className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[13px] font-semibold text-white transition-all hover:opacity-90"
                            style={{ background: 'linear-gradient(135deg, #1E3A8A, #3D7FF6)' }}>
                            Create
                            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showCreateMenu ? 'rotate-180' : ''}`} />
                        </button>
                        {showCreateMenu && (
                            <div onClick={e => e.stopPropagation()}
                                className="absolute right-0 top-full mt-1.5 w-52 rounded-xl shadow-2xl py-1.5 z-50"
                                style={dropdownBase}>
                                {[
                                    { icon: Globe, label: 'Web Page', fn: () => { window.open(`data:text/html,${encodeURIComponent(`<html><body>${report.markdown}</body></html>`)}`); setShowCreateMenu(false); } },
                                    { icon: BarChart3, label: 'Infographic', fn: () => { setShowPreview(true); setShowCreateMenu(false); } },
                                    { icon: HelpCircle, label: 'Quiz', disabled: true },
                                    { icon: FileText, label: 'Flashcards', disabled: true },
                                    { icon: Headphones, label: 'Audio Overview', disabled: true },
                                ].map(({ icon: Icon, label, fn, disabled }) => (
                                    <button key={label} onClick={fn} disabled={disabled}
                                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-[13px] transition-colors ${disabled ? 'cursor-not-allowed' : 'hover:bg-white/[0.04]'}`}
                                        style={{ color: disabled ? '#2A3248' : '#A0AABF' }}>
                                        <Icon className="w-4 h-4" style={{ color: disabled ? '#1E2740' : '#3D4861' }} />
                                        {label}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Spacer */}
                    <div className="flex-1" />

                    {/* Skip animation */}
                    {!isFullyRevealed && (
                        <button onClick={skipAnimation}
                            className="px-3 py-1.5 rounded-full text-[12px] transition-colors hover:bg-white/[0.06]"
                            style={{ color: '#3D7FF6' }}>
                            Skip ↓
                        </button>
                    )}

                    {/* Copy button */}
                    <button onClick={handleCopy}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] transition-colors hover:bg-white/[0.06]"
                        style={{ color: '#6D7A94' }}>
                        {copied
                            ? <Check className="w-3.5 h-3.5" style={{ color: '#10B981' }} />
                            : <Copy className="w-3.5 h-3.5" />}
                        {copied ? 'Copied' : 'Copy'}
                    </button>

                    {/* Close */}
                    {onClose && (
                        <button onClick={onClose}
                            className="w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-white/[0.06]"
                            style={{ color: '#6D7A94' }}>
                            <X className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </div>

            {/* ══════════════════════════════════════════════
                MAIN LAYOUT — TOC sidebar + content
            ══════════════════════════════════════════════ */}
            <div className="max-w-[1120px] mx-auto px-8 py-10 flex gap-10">

                {/* ─── LEFT STICKY TOC ─── */}
                <aside className="hidden xl:block w-[200px] flex-shrink-0">
                    <div className="sticky top-[53px] pt-1">
                        <p className="text-[10px] uppercase tracking-widest font-bold mb-4"
                            style={{ color: '#2A3248' }}>
                            Contents
                        </p>
                        <nav className="space-y-0.5">
                            {toc.map((item, i) => {
                                const isActive = activeSection === item.id;
                                return (
                                    <a key={i} href={`#${item.id}`}
                                        className={`flex items-center gap-2 py-1.5 text-[12px] leading-snug truncate transition-all
                                            ${item.level === 2 ? 'font-medium' : 'pl-3 text-[11px]'}`}
                                        style={{ color: isActive ? '#3D7FF6' : item.level === 2 ? '#3D4861' : '#2A3248' }}>
                                        {isActive && item.level === 2 && (
                                            <span className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
                                                style={{ background: '#3D7FF6' }} />
                                        )}
                                        <span className="truncate">{item.text}</span>
                                    </a>
                                );
                            })}
                        </nav>
                    </div>
                </aside>

                {/* ─── REPORT CONTENT ─── */}
                <div className="flex-1 min-w-0" ref={reportRef}>

                    {/* Executive Summary card */}
                    {report.summary && (
                        <div className="mb-10 rounded-2xl overflow-hidden"
                            style={{
                                border: '1px solid rgba(61,127,246,0.2)',
                                background: 'linear-gradient(135deg, rgba(61,127,246,0.07) 0%, rgba(124,58,237,0.04) 100%)',
                            }}>
                            <div className="px-6 pt-5 pb-1 flex items-center gap-2.5 border-b"
                                style={{ borderColor: 'rgba(61,127,246,0.12)' }}>
                                <Brain className="w-4 h-4 flex-shrink-0" style={{ color: '#3D7FF6' }} />
                                <span className="text-[11px] font-bold uppercase tracking-widest"
                                    style={{ color: '#3D7FF6' }}>
                                    Executive Summary
                                </span>
                            </div>
                            <div className="px-6 py-5">
                                <p className="text-[14.5px] leading-[1.85]" style={{ color: '#BDC8E0' }}>
                                    {report.summary}
                                </p>
                            </div>

                            {/* Key stats strip */}
                            <div className="px-6 pb-5 flex items-center gap-6 flex-wrap">
                                <div className="flex flex-col">
                                    <span className="text-[22px] font-bold tabular-nums" style={{ color: '#3D7FF6' }}>
                                        {report.metadata.sourcesAnalyzed}
                                    </span>
                                    <span className="text-[10px] uppercase tracking-wider mt-0.5" style={{ color: '#3D4861' }}>
                                        Sources
                                    </span>
                                </div>
                                <div className="w-px h-8" style={{ background: 'rgba(255,255,255,0.06)' }} />
                                <div className="flex flex-col">
                                    <span className="text-[22px] font-bold tabular-nums" style={{ color: SENTIMENT.color }}>
                                        {SENTIMENT.label.split(' ')[0]}
                                    </span>
                                    <span className="text-[10px] uppercase tracking-wider mt-0.5" style={{ color: '#3D4861' }}>
                                        Outlook
                                    </span>
                                </div>
                                <div className="w-px h-8" style={{ background: 'rgba(255,255,255,0.06)' }} />
                                <div className="flex flex-col">
                                    <span className="text-[22px] font-bold tabular-nums" style={{ color: '#E8EDF5' }}>
                                        {report.metadata.estimatedReadTime}m
                                    </span>
                                    <span className="text-[10px] uppercase tracking-wider mt-0.5" style={{ color: '#3D4861' }}>
                                        Read Time
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ─── Markdown body ─── */}
                    <div>
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                            {displayedMarkdown}
                        </ReactMarkdown>

                        {/* Blinking cursor during stream */}
                        {!isFullyRevealed && (
                            <span className="inline-block w-0.5 h-[18px] align-text-bottom animate-pulse ml-0.5 rounded-full"
                                style={{ background: '#3D7FF6' }} />
                        )}
                    </div>

                    {/* ─── Sources grid ─── */}
                    {isFullyRevealed && report.citations.length > 0 && (
                        <div className="mt-16 pt-8" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
                            id="citations">
                            <div className="flex items-center gap-3 mb-6">
                                <BookOpen className="w-5 h-5" style={{ color: '#3D7FF6' }} />
                                <h2 className="text-[16px] font-bold" style={{ color: '#E8EDF5' }}>
                                    Sources & References
                                </h2>
                                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full"
                                    style={{ background: 'rgba(61,127,246,0.1)', color: '#3D7FF6' }}>
                                    {report.citations.length}
                                </span>
                            </div>

                            {/* Web sources */}
                            {report.citations.filter(c => c.source !== 'SEC EDGAR').length > 0 && (
                                <div className="mb-6">
                                    <p className="text-[10px] uppercase tracking-widest font-semibold mb-3"
                                        style={{ color: '#2A3248' }}>
                                        Web Sources
                                    </p>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                        {report.citations.filter(c => c.source !== 'SEC EDGAR').map(c => (
                                            <div key={c.id} id={`citation-${c.id}`}>
                                                <SourceCard c={c} />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* SEC filings */}
                            {report.citations.filter(c => c.source === 'SEC EDGAR').length > 0 && (
                                <div>
                                    <p className="text-[10px] uppercase tracking-widest font-semibold mb-3"
                                        style={{ color: '#2A3248' }}>
                                        SEC EDGAR Filings
                                    </p>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                        {report.citations.filter(c => c.source === 'SEC EDGAR').map(c => (
                                            <div key={c.id} id={`citation-${c.id}`}>
                                                <SourceCard c={c} />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ─── Bottom attribution ─── */}
                    {isFullyRevealed && (
                        <div className="mt-10 pt-6 pb-2 flex items-center gap-3 flex-wrap"
                            style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                            <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                                style={{ background: 'linear-gradient(135deg, #3D7FF6, #7C3AED)' }}>
                                <Sparkles className="w-2.5 h-2.5 text-white" />
                            </div>
                            <span className="text-[12px]" style={{ color: '#2A3248' }}>
                                Generated by AI Research Engine · {generatedDate} · {report.metadata.sourcesAnalyzed} sources analyzed
                            </span>
                        </div>
                    )}
                </div>
            </div>

            {/* PDF Preview Modal */}
            {showPreview && (
                <PdfPreview report={report} onClose={() => setShowPreview(false)} />
            )}
        </div>
    );
}
