// Landing Page — Premium sales page
import { Link } from 'react-router-dom';
import {
    ArrowRight, Check, FileText,
    BarChart3, Shield, Zap, Globe, ChevronRight, Star, Quote,
    Search,
} from 'lucide-react';
import HeroSection from '../sections/HeroSection';
import DashboardSection from '../sections/DashboardSection';
import ExecutionSection from '../sections/ExecutionSection';
import ClosingSection from '../sections/ClosingSection';

// ─── Social proof logos (text-based) ───
const LOGOS = ['Goldman Sachs', 'Morgan Stanley', 'BlackRock', 'Citadel', 'Two Sigma', 'Bridgewater'];

// ─── Features ───
const FEATURES = [
    {
        icon: Search,
        color: '#00F0FF',
        title: 'Generative Search',
        desc: 'Ask anything in plain English. Our AI searches across 450M+ documents including earnings calls, SEC filings, analyst reports, and real-time news.',
    },
    {
        icon: FileText,
        color: '#8AB4F8',
        title: 'Deep Research Reports',
        desc: 'Get publication-ready reports in minutes. Each report synthesizes dozens of verified sources with inline citations and confidence scores.',
    },
    {
        icon: BarChart3,
        color: '#81C995',
        title: 'Real-Time Market Data',
        desc: 'Live stock quotes, historical price data, and market metrics — all integrated directly into your research workflow.',
    },
    {
        icon: Shield,
        color: '#F9AB00',
        title: 'Verified Sources Only',
        desc: 'Every insight is backed by traceable citations. No hallucinations, no fabricated data — only verified, institutional-grade sources.',
    },
    {
        icon: Zap,
        color: '#D96570',
        title: 'Multi-Model AI',
        desc: 'Choose between Gemini 2.5 Pro for deep reasoning or Flash variants for speed. Automatic fallback ensures 99.9% uptime.',
    },
    {
        icon: Globe,
        color: '#9B72CB',
        title: 'SEC EDGAR Integration',
        desc: '10-K, 10-Q, 8-K filings indexed and searchable in real-time. Get regulatory insights before the market reacts.',
    },
];

// ─── Testimonials ───
const TESTIMONIALS = [
    {
        quote: 'MarketIntelligence cut our research time from 4 hours to 12 minutes. The citation quality rivals what our analysts produce manually.',
        name: 'Sarah Chen',
        role: 'Portfolio Manager',
        company: 'Apex Capital',
        rating: 5,
    },
    {
        quote: 'The SEC filing integration alone is worth the price. I can query 10-Ks in plain English and get structured answers with page references.',
        name: 'Marcus Weber',
        role: 'Head of Research',
        company: 'Meridian Asset Management',
        rating: 5,
    },
    {
        quote: 'Best investment intelligence tool I\'ve used. The multi-model fallback means it never goes down during market hours when I need it most.',
        name: 'Priya Nair',
        role: 'Equity Analyst',
        company: 'Vantage Investments',
        rating: 5,
    },
];

// ─── Pricing ───
const PLANS = [
    {
        name: 'Starter',
        price: '$49',
        period: '/month',
        desc: 'For individual analysts and researchers',
        features: ['20 deep research reports/mo', 'Real-time market data', 'SEC EDGAR access', 'Export to PDF', 'Email support'],
        cta: 'Start free trial',
        highlight: false,
    },
    {
        name: 'Professional',
        price: '$149',
        period: '/month',
        desc: 'For serious investors and portfolio managers',
        features: ['Unlimited research reports', 'All Gemini models', 'Priority processing', 'API access', 'Research history & archive', 'Slack integration', 'Priority support'],
        cta: 'Start free trial',
        highlight: true,
    },
    {
        name: 'Enterprise',
        price: 'Custom',
        period: '',
        desc: 'For teams and institutions',
        features: ['Everything in Professional', 'Team workspaces', 'Custom data sources', 'SSO / SAML', 'SLA guarantee', 'Dedicated account manager', 'On-prem deployment option'],
        cta: 'Talk to sales',
        highlight: false,
    },
];

// ─── How it works ───
const STEPS = [
    { n: '01', title: 'Ask a question', desc: 'Type any market research question in plain English. Our AI understands financial context and nuance.' },
    { n: '02', title: 'AI researches', desc: 'We simultaneously search web sources, SEC filings, earnings transcripts, and analyst reports.' },
    { n: '03', title: 'Get your report', desc: 'Receive a comprehensive, cited report in minutes — ready to share, export, or act on.' },
];

function StarRating({ count }: { count: number }) {
    return (
        <div className="flex gap-0.5">
            {Array.from({ length: count }).map((_, i) => (
                <Star key={i} className="w-3.5 h-3.5 fill-[#F9AB00] text-[#F9AB00]" />
            ))}
        </div>
    );
}

export default function LandingPage() {
    return (
        <div className="relative bg-[#070A12] text-[#F4F6FF]">
            <div className="noise-overlay" />

            {/* ══════════ HERO ══════════ */}
            <HeroSection />

            {/* ══════════ LOGO BAR ══════════ */}
            <div className="relative z-50 bg-[#070A12] border-y border-[rgba(0,240,255,0.06)] py-7">
                <div className="max-w-6xl mx-auto px-6">
                    <p className="text-center text-xs uppercase tracking-widest text-[#A7B0C8]/40 mb-6 font-medium">
                        Trusted by analysts at leading institutions
                    </p>
                    <div className="flex flex-wrap justify-center items-center gap-8 md:gap-14">
                        {LOGOS.map(logo => (
                            <span key={logo} className="text-sm font-semibold text-[#A7B0C8]/35 hover:text-[#A7B0C8]/60 transition-colors tracking-wide">
                                {logo}
                            </span>
                        ))}
                    </div>
                </div>
            </div>

            {/* ══════════ HOW IT WORKS ══════════ */}
            <section id="how" className="relative z-50 py-24 px-6 bg-[#070A12]">
                <div className="max-w-5xl mx-auto text-center mb-16">
                    <span className="text-xs uppercase tracking-widest text-[#00F0FF] font-medium mb-3 block">How it works</span>
                    <h2 className="text-3xl md:text-4xl font-bold mb-4">Research in 3 steps</h2>
                    <p className="text-[#A7B0C8] max-w-xl mx-auto">From question to institutional-quality report in under 5 minutes.</p>
                </div>
                <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">
                    {STEPS.map((step, i) => (
                        <div key={i} className="relative text-center">
                            {i < STEPS.length - 1 && (
                                <ChevronRight className="hidden md:block absolute -right-4 top-8 w-6 h-6 text-[#A7B0C8]/20" />
                            )}
                            <div className="w-14 h-14 rounded-2xl bg-[rgba(0,240,255,0.08)] border border-[rgba(0,240,255,0.15)] flex items-center justify-center mx-auto mb-5">
                                <span className="text-lg font-bold text-[#00F0FF] font-mono">{step.n}</span>
                            </div>
                            <h3 className="font-semibold text-lg mb-2">{step.title}</h3>
                            <p className="text-sm text-[#A7B0C8] leading-relaxed">{step.desc}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* ══════════ DASHBOARD PREVIEW ══════════ */}
            <DashboardSection />

            {/* ══════════ FEATURES ══════════ */}
            <section id="features" className="relative z-50 py-24 px-6 bg-[#070A12]">
                <div className="max-w-6xl mx-auto">
                    <div className="text-center mb-16">
                        <span className="text-xs uppercase tracking-widest text-[#00F0FF] font-medium mb-3 block">Platform</span>
                        <h2 className="text-3xl md:text-4xl font-bold mb-4">Everything you need to move faster</h2>
                        <p className="text-[#A7B0C8] max-w-xl mx-auto">
                            Built for finance professionals who need institutional-grade insights without the institutional overhead.
                        </p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {FEATURES.map((f, i) => (
                            <div
                                key={i}
                                className="p-6 rounded-2xl border border-[rgba(255,255,255,0.06)] hover:border-[rgba(0,240,255,0.15)] transition-all group"
                                style={{ background: 'rgba(255,255,255,0.02)' }}
                            >
                                <div
                                    className="w-11 h-11 rounded-xl flex items-center justify-center mb-5 transition-transform group-hover:scale-110"
                                    style={{ background: `${f.color}15`, border: `1px solid ${f.color}25` }}
                                >
                                    <f.icon className="w-5 h-5" style={{ color: f.color }} />
                                </div>
                                <h3 className="font-semibold text-[15px] mb-2">{f.title}</h3>
                                <p className="text-sm text-[#A7B0C8] leading-relaxed">{f.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ══════════ EXECUTION DEMO ══════════ */}
            <ExecutionSection />

            {/* ══════════ TESTIMONIALS ══════════ */}
            <section className="relative z-50 py-24 px-6 bg-[#070A12]">
                <div className="max-w-6xl mx-auto">
                    <div className="text-center mb-16">
                        <span className="text-xs uppercase tracking-widest text-[#00F0FF] font-medium mb-3 block">Social proof</span>
                        <h2 className="text-3xl md:text-4xl font-bold mb-4">What professionals say</h2>
                        <p className="text-[#A7B0C8] max-w-md mx-auto">
                            Analysts and portfolio managers who made the switch.
                        </p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {TESTIMONIALS.map((t, i) => (
                            <div
                                key={i}
                                className="p-7 rounded-2xl flex flex-col gap-5 border border-[rgba(255,255,255,0.06)] hover:border-[rgba(0,240,255,0.12)] transition-all"
                                style={{ background: 'rgba(255,255,255,0.025)' }}
                            >
                                <Quote className="w-7 h-7 text-[#00F0FF]/30 flex-shrink-0" />
                                <p className="text-sm text-[#F4F6FF]/80 leading-relaxed flex-1">"{t.quote}"</p>
                                <div>
                                    <StarRating count={t.rating} />
                                    <p className="font-semibold text-sm mt-2">{t.name}</p>
                                    <p className="text-xs text-[#A7B0C8]/60">{t.role} · {t.company}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                    {/* Aggregate rating */}
                    <div className="flex items-center justify-center gap-3 mt-10">
                        <StarRating count={5} />
                        <span className="text-sm text-[#A7B0C8]"><span className="text-white font-semibold">4.9/5</span> from 300+ reviews</span>
                    </div>
                </div>
            </section>

            {/* ══════════ PRICING ══════════ */}
            <section id="pricing" className="relative z-50 py-24 px-6" style={{ background: 'rgba(0,240,255,0.02)' }}>
                <div className="max-w-6xl mx-auto">
                    <div className="text-center mb-16">
                        <span className="text-xs uppercase tracking-widest text-[#00F0FF] font-medium mb-3 block">Pricing</span>
                        <h2 className="text-3xl md:text-4xl font-bold mb-4">Simple, transparent pricing</h2>
                        <p className="text-[#A7B0C8] max-w-md mx-auto">14-day free trial on all plans. No credit card required.</p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
                        {PLANS.map((plan, i) => (
                            <div
                                key={i}
                                className={`relative p-8 rounded-2xl flex flex-col gap-6 transition-all ${plan.highlight
                                    ? 'border-2 border-[#00F0FF]/40 scale-[1.02]'
                                    : 'border border-[rgba(255,255,255,0.07)]'}`}
                                style={{
                                    background: plan.highlight
                                        ? 'linear-gradient(135deg, rgba(0,240,255,0.06), rgba(138,180,248,0.04))'
                                        : 'rgba(255,255,255,0.025)',
                                }}
                            >
                                {plan.highlight && (
                                    <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider bg-[#00F0FF] text-[#070A12]">
                                        Most popular
                                    </div>
                                )}
                                <div>
                                    <p className="text-sm font-semibold text-[#A7B0C8] mb-1">{plan.name}</p>
                                    <div className="flex items-end gap-1">
                                        <span className="text-4xl font-bold">{plan.price}</span>
                                        <span className="text-[#A7B0C8] text-sm pb-1">{plan.period}</span>
                                    </div>
                                    <p className="text-xs text-[#A7B0C8]/60 mt-1">{plan.desc}</p>
                                </div>

                                <Link
                                    to="/auth"
                                    className={`w-full py-3 rounded-xl text-center text-sm font-semibold transition-all ${plan.highlight
                                        ? 'bg-[#00F0FF] text-[#070A12] hover:bg-[#00F0FF]/90'
                                        : 'border border-[rgba(0,240,255,0.25)] text-[#00F0FF] hover:bg-[rgba(0,240,255,0.08)]'
                                        }`}
                                >
                                    {plan.cta} <ArrowRight className="inline w-3.5 h-3.5 ml-1" />
                                </Link>

                                <ul className="space-y-2.5">
                                    {plan.features.map(f => (
                                        <li key={f} className="flex items-center gap-2.5 text-sm text-[#A7B0C8]">
                                            <Check className="w-4 h-4 text-[#00F0FF] flex-shrink-0" />
                                            {f}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ══════════ STATS STRIP ══════════ */}
            <section className="relative z-50 py-16 px-6 border-y border-[rgba(0,240,255,0.06)] bg-[#070A12]">
                <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
                    {[
                        { value: '450M+', label: 'Documents indexed' },
                        { value: '<5 min', label: 'Report generation' },
                        { value: '99.9%', label: 'Uptime SLA' },
                        { value: '300+', label: 'Active professionals' },
                    ].map(stat => (
                        <div key={stat.label}>
                            <p className="text-3xl font-bold text-[#00F0FF] mb-1">{stat.value}</p>
                            <p className="text-xs text-[#A7B0C8]/60 uppercase tracking-wider">{stat.label}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* ══════════ CLOSING CTA ══════════ */}
            <ClosingSection />
        </div>
    );
}
