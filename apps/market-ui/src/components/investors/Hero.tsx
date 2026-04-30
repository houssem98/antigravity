import { useLayoutEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Sparkles, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

gsap.registerPlugin(ScrollTrigger);

type HeroProps = {
    onScrollToWaitlist: () => void;
};

const STATS = [
    '450M+ documents indexed',
    '<5 min reports',
    '99.9% SLA',
    '6 LLM providers',
];

export default function Hero({ onScrollToWaitlist }: HeroProps) {
    const sectionRef = useRef<HTMLElement>(null);
    const headlineRef = useRef<HTMLHeadingElement>(null);
    const subRef = useRef<HTMLParagraphElement>(null);
    const ctaRef = useRef<HTMLDivElement>(null);
    const statsRef = useRef<HTMLDivElement>(null);
    const bgRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        const section = sectionRef.current;
        if (!section) return;

        const ctx = gsap.context(() => {
            const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
            tl.fromTo(bgRef.current, { opacity: 0 }, { opacity: 1, duration: 0.8 });
            tl.fromTo(
                headlineRef.current,
                { opacity: 0, y: 22 },
                { opacity: 1, y: 0, duration: 0.7 },
                0.15,
            );
            tl.fromTo(
                subRef.current,
                { opacity: 0, y: 16 },
                { opacity: 1, y: 0, duration: 0.55 },
                0.35,
            );
            tl.fromTo(
                ctaRef.current,
                { opacity: 0, y: 14 },
                { opacity: 1, y: 0, duration: 0.5 },
                0.5,
            );
            tl.fromTo(
                statsRef.current?.querySelectorAll('.stat-item') ?? [],
                { opacity: 0, y: 10 },
                { opacity: 1, y: 0, duration: 0.4, stagger: 0.06 },
                0.65,
            );

            gsap.to(bgRef.current, {
                y: '-8vh',
                scrollTrigger: {
                    trigger: section,
                    start: 'top top',
                    end: 'bottom top',
                    scrub: 0.6,
                },
            });
        }, section);

        return () => ctx.revert();
    }, []);

    return (
        <section
            ref={sectionRef}
            className="relative w-full min-h-screen overflow-hidden flex items-center justify-center px-6 py-24"
        >
            <div
                ref={bgRef}
                className="absolute inset-0 -z-10"
                style={{
                    background:
                        'radial-gradient(ellipse at 50% 0%, rgba(0,240,255,0.10), transparent 55%), radial-gradient(ellipse at 80% 60%, rgba(138,180,248,0.06), transparent 60%), #070A12',
                    opacity: 0,
                }}
            />

            <nav className="absolute top-0 left-0 right-0 z-50 flex items-center justify-between px-[4vw] py-[3.5vh]">
                <Link to="/" className="flex items-center gap-2.5">
                    <Sparkles className="w-6 h-6 text-[#00F0FF]" />
                    <span className="font-bold text-lg tracking-tight text-white">
                        MarketIntelligence
                    </span>
                </Link>
                <div className="hidden md:flex items-center gap-8 text-sm text-[#A7B0C8]">
                    <Link to="/" className="hover:text-white transition-colors">
                        Product
                    </Link>
                    <a href="#moat" className="hover:text-white transition-colors">
                        Moat
                    </a>
                    <a href="#traction" className="hover:text-white transition-colors">
                        Traction
                    </a>
                    <button
                        onClick={onScrollToWaitlist}
                        className="px-5 py-2 rounded-full border border-[rgba(255,255,255,0.2)] text-white/80 hover:border-white/50 hover:text-white hover:bg-white/5 transition-all text-sm font-medium"
                    >
                        Request access
                    </button>
                </div>
            </nav>

            <div className="max-w-4xl mx-auto text-center relative z-10">
                <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[rgba(0,240,255,0.08)] border border-[rgba(0,240,255,0.2)] text-[11px] uppercase tracking-[0.12em] text-[#00F0FF] font-medium mb-7">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#00F0FF] animate-pulse" />
                    Investor brief · Seed / Series A
                </span>

                <h1
                    ref={headlineRef}
                    className="text-4xl md:text-6xl lg:text-[68px] font-bold leading-[1.05] tracking-tight mb-6"
                >
                    The intelligence layer
                    <br />
                    for modern markets.
                </h1>

                <p
                    ref={subRef}
                    className="text-lg md:text-xl text-[#A7B0C8] max-w-2xl mx-auto leading-relaxed mb-10"
                >
                    Bloomberg Terminal meets Perplexity — an AI-native,
                    citation-grade research and execution platform for
                    institutions and active traders.
                </p>

                <div ref={ctaRef} className="flex flex-col sm:flex-row gap-3 justify-center items-center mb-14">
                    <button
                        onClick={onScrollToWaitlist}
                        className="group bg-[#00F0FF] text-[#070A12] px-7 py-3.5 rounded-xl font-bold text-sm hover:bg-[#00F0FF]/90 active:scale-95 transition-all flex items-center gap-2"
                    >
                        Request investor access
                        <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                    </button>
                    <a
                        href="#wedge"
                        className="px-7 py-3.5 rounded-xl text-sm font-semibold border border-[rgba(255,255,255,0.15)] text-[#F4F6FF]/85 hover:border-white/35 hover:bg-white/5 transition-all"
                    >
                        See the wedge
                    </a>
                </div>

                <div
                    ref={statsRef}
                    className="flex flex-wrap justify-center gap-x-6 gap-y-2 pt-6 border-t border-[rgba(0,240,255,0.08)]"
                >
                    {STATS.map((s) => (
                        <span
                            key={s}
                            className="stat-item font-mono text-[12px] text-[#A7B0C8] tracking-wide"
                        >
                            · {s}
                        </span>
                    ))}
                </div>
            </div>
        </section>
    );
}
