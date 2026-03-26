import { useRef, useLayoutEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Search, Sparkles, TrendingUp, BarChart3 } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

const promptChips = [
  'Earnings surprises',
  'Supply chain shifts',
  'Macro momentum',
  'AI infrastructure capex',
];

export default function HeroSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const headlineRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLDivElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  const microcopyRef = useRef<HTMLParagraphElement>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const navigate = useNavigate();

  const handleSearch = () => {
    if (!searchQuery.trim()) return;
    navigate(`/search?mode=research&q=${encodeURIComponent(searchQuery.trim())}`);
  };

  useLayoutEffect(() => {
    const section = sectionRef.current;
    const bg = bgRef.current;
    const card = cardRef.current;
    const headline = headlineRef.current;
    const input = inputRef.current;
    const chips = chipsRef.current;
    const microcopy = microcopyRef.current;
    if (!section || !bg || !card || !headline || !input || !chips || !microcopy) return;

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
      tl.fromTo(bg, { opacity: 0, scale: 1.06 }, { opacity: 1, scale: 1, duration: 1 });
      tl.fromTo(card, { opacity: 0, y: 26, scale: 0.985 }, { opacity: 1, y: 0, scale: 1, duration: 0.7 }, 0.15);
      const chars = headline.querySelectorAll('.char');
      tl.fromTo(chars, { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.55, stagger: 0.018 }, 0.35);
      tl.fromTo(input, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.45 }, 0.6);
      const chipEls = chips.querySelectorAll('.chip');
      tl.fromTo(chipEls, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.45, stagger: 0.06 }, 0.75);
      tl.fromTo(microcopy, { opacity: 0 }, { opacity: 1, duration: 0.4 }, 0.9);

      const scrollTl = gsap.timeline({
        scrollTrigger: {
          trigger: section, start: 'top top', end: '+=130%', pin: true, scrub: 0.6,
          onLeaveBack: () => { gsap.set(card, { opacity: 1, y: 0, scale: 1 }); gsap.set(bg, { y: 0, scale: 1 }); },
        },
      });
      scrollTl.fromTo(card, { y: 0, scale: 1, opacity: 1 }, { y: '-22vh', scale: 0.96, opacity: 0, ease: 'power2.in' }, 0.7);
      scrollTl.fromTo(bg, { y: 0, scale: 1 }, { y: '-8vh', scale: 1.04 }, 0.7);
    }, section);

    return () => ctx.revert();
  }, []);

  const headlineText = 'Ask the market anything.';
  const chars = headlineText.split('').map((char, i) => (
    <span key={i} className="char inline-block">{char === ' ' ? '\u00A0' : char}</span>
  ));

  return (
    <section ref={sectionRef} className="relative w-full h-screen overflow-hidden z-10">

      {/* Background */}
      <div ref={bgRef} className="absolute inset-0 w-full h-full" style={{ opacity: 0 }}>
        <img src="/hero_city_bg.jpg" alt="City" className="w-full h-full object-cover" />
        <div className="absolute inset-0 vignette" />
      </div>

      {/* Nav */}
      <nav className="absolute top-0 left-0 right-0 z-50 flex items-center justify-between px-[4vw] py-[3.5vh]">
        <div className="flex items-center gap-2.5">
          <Sparkles className="w-6 h-6 text-[#00F0FF]" />
          <span className="font-bold text-lg tracking-tight text-white">MarketIntelligence</span>
        </div>
        <div className="hidden md:flex items-center gap-8 text-sm text-[#A7B0C8]">
          <a href="#features" className="hover:text-white transition-colors">Product</a>
          <a href="#features" className="hover:text-white transition-colors">Data</a>
          <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
          <Link
            to="/auth"
            className="px-5 py-2 rounded-full border border-[rgba(255,255,255,0.2)] text-white/80 hover:border-white/50 hover:text-white hover:bg-white/5 transition-all text-sm font-medium"
          >
            Sign in
          </Link>
        </div>
      </nav>

      {/* Hero card */}
      <div
        ref={cardRef}
        className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 w-[min(880px,90vw)] panel-bg panel-border rounded-2xl z-40"
        style={{ opacity: 0 }}
      >
        <div className="absolute -inset-10 bg-[radial-gradient(circle,rgba(0,240,255,0.12),transparent_60%)] -z-10 pointer-events-none" />
        <div className="p-7 md:p-10">

          <h1 ref={headlineRef} className="text-4xl md:text-5xl lg:text-[56px] font-bold text-center mb-8 leading-tight tracking-tight">
            {chars}
          </h1>

          {/* Search bar */}
          <div ref={inputRef} className="mb-5">
            <div className="flex items-center gap-3 bg-[#070A12]/75 border border-[rgba(0,240,255,0.18)] rounded-2xl px-5 py-4 focus-within:border-[#00F0FF]/55 transition-all shadow-xl">
              <Search className="w-5 h-5 text-[#A7B0C8]/70 flex-shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="E.g., 'AI semiconductor demand trends Q2'"
                className="flex-1 bg-transparent text-[#F4F6FF] placeholder:text-[#A7B0C8]/45 outline-none text-sm md:text-[15px]"
                autoComplete="off"
              />
              <button
                onClick={handleSearch}
                disabled={!searchQuery.trim()}
                className="bg-[#00F0FF] text-[#070A12] px-6 py-2.5 rounded-xl font-bold text-sm hover:bg-[#00F0FF]/90 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Sparkles className="w-4 h-4" />
                Search
              </button>
            </div>
          </div>

          {/* Chips */}
          <div ref={chipsRef} className="flex flex-wrap justify-center gap-2.5 mb-7">
            {promptChips.map((chip, i) => (
              <button
                key={i}
                onClick={() => setSearchQuery(chip)}
                className="chip px-4 py-1.5 rounded-full text-sm border border-[rgba(255,255,255,0.15)] text-[#A7B0C8] hover:text-white hover:border-white/35 hover:bg-white/05 transition-all"
              >
                {chip}
              </button>
            ))}
          </div>

          {/* Stats */}
          <div className="flex justify-center gap-6 md:gap-12 pt-5 border-t border-[rgba(0,240,255,0.08)]">
            {[
              { icon: TrendingUp, label: '450M+ documents' },
              { icon: BarChart3, label: 'Real-time data' },
              { icon: Sparkles, label: 'Verified sources' },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-2 text-xs md:text-sm text-[#A7B0C8]">
                <Icon className="w-4 h-4 text-[#00F0FF]" />
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Microcopy */}
      <p ref={microcopyRef} className="absolute left-1/2 bottom-[8vh] -translate-x-1/2 text-xs md:text-sm text-[#A7B0C8]/60 z-20 whitespace-nowrap" style={{ opacity: 0 }}>
        Real-time data. Verified sources. No hallucinations.
      </p>
    </section>
  );
}
