import { useRef, useLayoutEffect, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Link } from 'react-router-dom';
import { Search, FileCheck, Bell, Mail, Twitter, Linkedin, Github, ArrowRight, Sparkles } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

const features = [
  {
    icon: Search,
    text: 'Generative search across transcripts, filings, and research',
  },
  {
    icon: FileCheck,
    text: 'Smart summaries with verified citations',
  },
  {
    icon: Bell,
    text: 'Live monitors + alerting',
  },
];

export default function ClosingSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const headlineRef = useRef<HTMLHeadingElement>(null);
  const featuresRef = useRef<HTMLDivElement>(null);
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useLayoutEffect(() => {
    const section = sectionRef.current;
    const bg = bgRef.current;
    const card = cardRef.current;
    const headline = headlineRef.current;
    const featuresEl = featuresRef.current;

    if (!section || !bg || !card || !headline || !featuresEl) return;

    const ctx = gsap.context(() => {
      // Background parallax
      gsap.fromTo(
        bg,
        { y: 0 },
        {
          y: -50,
          ease: 'none',
          scrollTrigger: {
            trigger: section,
            start: 'top bottom',
            end: 'bottom top',
            scrub: true,
          },
        }
      );

      // Card entrance
      gsap.fromTo(
        card,
        { opacity: 0, y: 40, scale: 0.98 },
        {
          opacity: 1,
          y: 0,
          scale: 1,
          duration: 0.8,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: card,
            start: 'top 80%',
            end: 'top 45%',
            scrub: 1,
          },
        }
      );

      // Headline character animation
      const chars = headline.querySelectorAll('.char');
      gsap.fromTo(
        chars,
        { opacity: 0, y: 18 },
        {
          opacity: 1,
          y: 0,
          stagger: 0.02,
          duration: 0.6,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: headline,
            start: 'top 75%',
            toggleActions: 'play none none reverse',
          },
        }
      );

      // Features stagger
      const featureItems = featuresEl.querySelectorAll('.feature-item');
      gsap.fromTo(
        featureItems,
        { opacity: 0, y: 16 },
        {
          opacity: 1,
          y: 0,
          stagger: 0.1,
          duration: 0.5,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: featuresEl,
            start: 'top 80%',
            toggleActions: 'play none none reverse',
          },
        }
      );
    }, section);

    return () => ctx.revert();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email) {
      setSubmitted(true);
      setTimeout(() => {
        setSubmitted(false);
        setEmail('');
      }, 3000);
    }
  };

  // Split headline into characters
  const headlineText = 'Ready to trade what you know?';
  const chars = headlineText.split('').map((char, i) => (
    <span key={i} className="char inline-block">
      {char === ' ' ? '\u00A0' : char}
    </span>
  ));

  return (
    <section
      ref={sectionRef}
      className="relative w-full min-h-screen z-40 overflow-hidden"
    >
      {/* Background image */}
      <div ref={bgRef} className="absolute inset-0 w-full h-[120%]">
        <img
          src="/closing_city_bg.jpg"
          alt="Closing background"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#070A12]/70 via-[#070A12]/80 to-[#070A12]" />
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center justify-center min-h-screen px-4 py-20">
        {/* CTA Card */}
        <div
          ref={cardRef}
          className="w-full max-w-[720px] panel-bg panel-border rounded-2xl p-8 md:p-10 animate-breathe"
          style={{ opacity: 0 }}
        >
          <div className="text-center mb-8">
            <h2
              ref={headlineRef}
              className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4"
            >
              {chars}
            </h2>
            <p className="text-[#A7B0C8] text-base md:text-lg">
              Get early access to the intelligence layer built for execution.
            </p>
          </div>

          {/* Email form */}
          <form onSubmit={handleSubmit} className="mb-8">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#A7B0C8]" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  className="w-full bg-[#070A12]/60 border border-[rgba(0,240,255,0.15)] rounded-xl pl-12 pr-4 py-3.5 text-sm text-[#F4F6FF] placeholder:text-[#A7B0C8]/40 outline-none focus:border-[#00F0FF]/40 transition-colors"
                />
              </div>
              <button
                type="submit"
                disabled={submitted}
                className={`px-6 py-3.5 rounded-xl font-medium text-sm transition-all flex items-center justify-center gap-2 ${
                  submitted
                    ? 'bg-green-500 text-white'
                    : 'bg-[#00F0FF] text-[#070A12] hover:bg-[#00F0FF]/90'
                }`}
              >
                {submitted ? (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Request Sent!
                  </>
                ) : (
                  <>
                    Request Early Access
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </form>

          <div className="flex justify-center gap-4 mb-8">
            <button className="px-5 py-2.5 rounded-xl border border-[rgba(0,240,255,0.2)] text-sm text-[#A7B0C8] hover:text-[#F4F6FF] hover:border-[#00F0FF]/40 transition-all">
              Talk to Sales
            </button>
          </div>

          {/* Features */}
          <div ref={featuresRef} className="grid gap-4 pt-6 border-t border-[rgba(0,240,255,0.1)]">
            {features.map((feature, index) => (
              <div
                key={index}
                className="feature-item flex items-center gap-3 text-sm text-[#A7B0C8]"
              >
                <div className="w-8 h-8 rounded-lg bg-[rgba(0,240,255,0.08)] flex items-center justify-center flex-shrink-0">
                  <feature.icon className="w-4 h-4 text-[#00F0FF]" />
                </div>
                <span>{feature.text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Contact & Footer */}
        <div className="mt-12 text-center">
          <a
            href="mailto:hello@marketintelligence.io"
            className="inline-flex items-center gap-2 text-[#A7B0C8] hover:text-[#00F0FF] transition-colors mb-6"
          >
            <Mail className="w-4 h-4" />
            hello@marketintelligence.io
          </a>

          <div className="flex items-center justify-center gap-4 mb-8">
            <a href="#" className="w-10 h-10 rounded-full bg-[rgba(0,240,255,0.08)] flex items-center justify-center text-[#A7B0C8] hover:text-[#00F0FF] hover:bg-[rgba(0,240,255,0.15)] transition-all">
              <Twitter className="w-4 h-4" />
            </a>
            <a href="#" className="w-10 h-10 rounded-full bg-[rgba(0,240,255,0.08)] flex items-center justify-center text-[#A7B0C8] hover:text-[#00F0FF] hover:bg-[rgba(0,240,255,0.15)] transition-all">
              <Linkedin className="w-4 h-4" />
            </a>
            <a href="#" className="w-10 h-10 rounded-full bg-[rgba(0,240,255,0.08)] flex items-center justify-center text-[#A7B0C8] hover:text-[#00F0FF] hover:bg-[rgba(0,240,255,0.15)] transition-all">
              <Github className="w-4 h-4" />
            </a>
          </div>

          <p className="text-xs text-[#A7B0C8]/60">
            © 2026 MarketIntelligence. All rights reserved.
          </p>

          <Link
            to="/investors"
            className="mt-4 inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.14em] text-[#A7B0C8]/50 hover:text-[#00F0FF] transition-colors"
          >
            For Investors <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      </div>
    </section>
  );
}
