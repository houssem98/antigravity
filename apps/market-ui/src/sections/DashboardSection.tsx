import { useRef, useLayoutEffect, useState, useEffect } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { TrendingUp, TrendingDown, FileText, Bell, Activity, Droplets, Zap, ExternalLink } from 'lucide-react';
import { getStockList, getNews, formatMarketCap, formatVolume, type Stock, type NewsItem } from '../services/marketData';

gsap.registerPlugin(ScrollTrigger);

const smartMonitor = [
  { label: 'Sentiment', value: 72, icon: Activity, color: '#00F0FF' },
  { label: 'Liquidity', value: 88, icon: Droplets, color: '#00F0FF' },
  { label: 'Volatility', value: 41, icon: Zap, color: '#FF6B6B' },
];

// Sparkline component
function Sparkline({ positive }: { positive: boolean }) {
  const points = positive
    ? '0,20 20,15 40,18 60,10 80,12 100,5'
    : '0,10 20,12 40,8 60,15 80,18 100,20';

  return (
    <svg viewBox="0 0 100 25" className="w-16 h-6">
      <polyline
        fill="none"
        stroke={positive ? '#00F0FF' : '#FF6B6B'}
        strokeWidth="2"
        points={points}
        className="sparkline"
      />
    </svg>
  );
}

// Progress ring component
function ProgressRing({ value, color }: { value: number; color: string }) {
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (value / 100) * circumference;

  return (
    <div className="relative w-16 h-16">
      <svg className="w-full h-full progress-ring">
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke="rgba(0, 240, 255, 0.15)"
          strokeWidth="4"
        />
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          className="progress-ring-circle"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-sm font-mono font-medium">{value}%</span>
      </div>
    </div>
  );
}

export default function DashboardSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const card1Ref = useRef<HTMLDivElement>(null);
  const card2Ref = useRef<HTMLDivElement>(null);
  const card3Ref = useRef<HTMLDivElement>(null);

  const [stocks, setStocks] = useState<Stock[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Load real market data
    const stockData = getStockList();
    const newsData = getNews();
    setStocks(stockData);
    setNews(newsData);
    setLoading(false);
  }, []);

  useLayoutEffect(() => {
    const section = sectionRef.current;
    const bg = bgRef.current;
    const sidebar = sidebarRef.current;
    const header = headerRef.current;
    const card1 = card1Ref.current;
    const card2 = card2Ref.current;
    const card3 = card3Ref.current;

    if (!section || !bg || !sidebar || !header || !card1 || !card2 || !card3) return;

    const ctx = gsap.context(() => {
      const scrollTl = gsap.timeline({
        scrollTrigger: {
          trigger: section,
          start: 'top top',
          end: '+=130%',
          pin: true,
          scrub: 0.6,
        },
      });

      // Background entrance (0-30%)
      scrollTl.fromTo(
        bg,
        { opacity: 0, scale: 1.06 },
        { opacity: 1, scale: 1, ease: 'none' },
        0
      );

      // Sidebar entrance (0-20%)
      scrollTl.fromTo(
        sidebar,
        { x: -72, opacity: 0 },
        { x: 0, opacity: 1, ease: 'power2.out' },
        0
      );

      // Header entrance (5-25%)
      scrollTl.fromTo(
        header,
        { y: -24, opacity: 0 },
        { y: 0, opacity: 1, ease: 'power2.out' },
        0.05
      );

      // Cards entrance (10-30%) with stagger
      scrollTl.fromTo(
        card1,
        { x: '-10vw', opacity: 0 },
        { x: 0, opacity: 1, ease: 'power2.out' },
        0.1
      );
      scrollTl.fromTo(
        card2,
        { y: '10vh', opacity: 0 },
        { y: 0, opacity: 1, ease: 'power2.out' },
        0.13
      );
      scrollTl.fromTo(
        card3,
        { x: '10vw', opacity: 0 },
        { x: 0, opacity: 1, ease: 'power2.out' },
        0.16
      );

      // Exit animations (70-100%)
      scrollTl.fromTo(
        [card1, card2, card3],
        { y: 0, opacity: 1 },
        { y: '10vh', opacity: 0.25, ease: 'power2.in' },
        0.7
      );
      scrollTl.fromTo(
        sidebar,
        { opacity: 1 },
        { opacity: 0.3, ease: 'power2.in' },
        0.7
      );
      scrollTl.fromTo(
        header,
        { y: 0, opacity: 1 },
        { y: -18, opacity: 0.25, ease: 'power2.in' },
        0.7
      );
      scrollTl.fromTo(
        bg,
        { scale: 1, opacity: 1 },
        { scale: 1.05, opacity: 0.35, ease: 'power2.in' },
        0.7
      );
    }, section);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      className="relative w-full h-screen overflow-hidden z-20"
    >
      {/* Background image */}
      <div ref={bgRef} className="absolute inset-0 w-full h-full" style={{ opacity: 0 }}>
        <img
          src="/dashboard_city_bg.jpg"
          alt="Dashboard background"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-[#070A12]/60" />
      </div>

      {/* Sidebar */}
      <div
        ref={sidebarRef}
        className="absolute left-0 top-0 h-full w-[72px] bg-[rgba(7,10,18,0.85)] border-r border-[rgba(0,240,255,0.10)] z-30 flex flex-col items-center py-6"
        style={{ opacity: 0 }}
      >
        <div className="w-10 h-10 rounded-xl bg-[#00F0FF]/10 flex items-center justify-center mb-8">
          <Activity className="w-5 h-5 text-[#00F0FF]" />
        </div>
        <nav className="flex flex-col gap-4">
          <button className="w-10 h-10 rounded-xl bg-[#00F0FF]/20 flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-[#00F0FF]" />
          </button>
          <button className="w-10 h-10 rounded-xl hover:bg-[rgba(0,240,255,0.1)] flex items-center justify-center transition-colors">
            <FileText className="w-5 h-5 text-[#A7B0C8]" />
          </button>
          <button className="w-10 h-10 rounded-xl hover:bg-[rgba(0,240,255,0.1)] flex items-center justify-center transition-colors">
            <Bell className="w-5 h-5 text-[#A7B0C8]" />
          </button>
        </nav>
      </div>

      {/* Header */}
      <div
        ref={headerRef}
        className="absolute top-0 left-[72px] right-0 h-16 bg-[rgba(7,10,18,0.85)] border-b border-[rgba(0,240,255,0.10)] z-30 flex items-center justify-between px-6"
        style={{ opacity: 0 }}
      >
        <div className="text-sm text-[#A7B0C8]">
          <span className="text-[#F4F6FF]">Dashboard</span>
          <span className="mx-2">/</span>
          <span>Overview</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-xs text-[#A7B0C8]">
            <span className="text-[#00F0FF]">●</span> Live Data
          </div>
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#00F0FF] to-[#00F0FF]/50" />
        </div>
      </div>

      {/* Main workspace */}
      <div className="absolute left-[72px] top-16 right-0 bottom-0 p-4 md:p-6 lg:p-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6 h-full">
          {/* Card 1: Market Movers */}
          <div
            ref={card1Ref}
            className="panel-bg panel-border rounded-2xl p-5 flex flex-col"
            style={{ opacity: 0 }}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-lg">Market Movers</h3>
              <Sparkline positive={true} />
            </div>
            <div className="flex-1 space-y-3">
              {loading ? (
                <div className="space-y-3">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-10 bg-[rgba(0,240,255,0.05)] rounded animate-pulse" />
                  ))}
                </div>
              ) : (
                stocks.map((stock, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between py-2 border-b border-[rgba(0,240,255,0.08)] last:border-0"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-medium text-[#F4F6FF]">{stock.symbol}</span>
                      <span className="text-sm text-[#A7B0C8]">${stock.price.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-xs text-[#A7B0C8] hidden sm:inline">
                        Vol: {formatVolume(stock.volume)}
                      </span>
                      <div
                        className={`flex items-center gap-1 text-sm font-mono ${
                          stock.positive ? 'text-[#00F0FF]' : 'text-[#FF6B6B]'
                        }`}
                      >
                        {stock.positive ? (
                          <TrendingUp className="w-3.5 h-3.5" />
                        ) : (
                          <TrendingDown className="w-3.5 h-3.5" />
                        )}
                        <span>{stock.positive ? '+' : ''}{stock.change}%</span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            <button className="mt-4 w-full py-2.5 rounded-xl border border-[rgba(0,240,255,0.2)] text-sm text-[#A7B0C8] hover:text-[#00F0FF] hover:border-[#00F0FF]/40 transition-all">
              View all
            </button>
          </div>

          {/* Card 2: AI Digest - Now with Real News */}
          <div
            ref={card2Ref}
            className="panel-bg panel-border rounded-2xl p-5 flex flex-col"
            style={{ opacity: 0 }}
          >
            <div className="flex items-center gap-2 mb-4">
              <FileText className="w-5 h-5 text-[#00F0FF]" />
              <h3 className="font-semibold text-lg">AI Digest</h3>
              <span className="ml-auto text-xs text-[#A7B0C8]">Live News</span>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto">
              {loading ? (
                <div className="space-y-4">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="h-16 bg-[rgba(0,240,255,0.05)] rounded animate-pulse" />
                  ))}
                </div>
              ) : (
                news.slice(0, 4).map((item, index) => (
                  <div key={index} className="group cursor-pointer">
                    <div className="flex items-start gap-3">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#00F0FF] mt-2 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-[#F4F6FF] leading-relaxed group-hover:text-[#00F0FF] transition-colors line-clamp-2">
                          {item.title}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-[#A7B0C8]/70">{item.source}</span>
                          <ExternalLink className="w-3 h-3 text-[#A7B0C8]/50 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            <button className="mt-4 w-full py-2.5 rounded-xl bg-[#00F0FF] text-[#070A12] text-sm font-medium hover:bg-[#00F0FF]/90 transition-colors flex items-center justify-center gap-2">
              <FileText className="w-4 h-4" />
              Generate report
            </button>
          </div>

          {/* Card 3: Smart Monitor */}
          <div
            ref={card3Ref}
            className="panel-bg panel-border rounded-2xl p-5 flex flex-col"
            style={{ opacity: 0 }}
          >
            <div className="flex items-center gap-2 mb-4">
              <Activity className="w-5 h-5 text-[#00F0FF]" />
              <h3 className="font-semibold text-lg">Smart Monitor</h3>
            </div>
            <div className="flex-1 space-y-5">
              {smartMonitor.map((item, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between py-2"
                >
                  <div className="flex items-center gap-3">
                    <item.icon className="w-5 h-5 text-[#A7B0C8]" />
                    <span className="text-sm text-[#A7B0C8]">{item.label}</span>
                  </div>
                  <ProgressRing value={item.value} color={item.color} />
                </div>
              ))}
            </div>
            
            {/* Market Stats */}
            <div className="mt-4 p-4 rounded-xl bg-[rgba(0,240,255,0.08)] border border-[rgba(0,240,255,0.15)]">
              <div className="flex items-center gap-2 mb-3">
                <Bell className="w-4 h-4 text-[#00F0FF]" />
                <span className="text-xs font-medium text-[#00F0FF]">Market Overview</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-[#A7B0C8]">Total Market Cap</p>
                  <p className="text-sm font-mono text-[#F4F6FF]">
                    {loading ? '-' : formatMarketCap(stocks.reduce((acc, s) => acc + (s.marketCap || 0), 0))}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#A7B0C8]">Advancing</p>
                  <p className="text-sm font-mono text-[#00F0FF]">
                    {loading ? '-' : `${stocks.filter(s => s.positive).length}/${stocks.length}`}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
