import { useRef, useLayoutEffect, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Bell, TrendingUp, AlertTriangle, ChartLine, ArrowRight, Save, Check } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

export default function ExecutionSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);
  const leftPanelRef = useRef<HTMLDivElement>(null);
  const rightCardRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const [orderData, setOrderData] = useState({
    symbol: '',
    side: 'Buy',
    quantity: '',
    orderType: 'Market',
  });
  const [showSuccess, setShowSuccess] = useState(false);

  useLayoutEffect(() => {
    const section = sectionRef.current;
    const bg = bgRef.current;
    const leftPanel = leftPanelRef.current;
    const rightCard = rightCardRef.current;
    const bell = bellRef.current;
    const form = formRef.current;

    if (!section || !bg || !leftPanel || !rightCard || !bell || !form) return;

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
        { opacity: 0, scale: 1.08 },
        { opacity: 1, scale: 1, ease: 'none' },
        0
      );

      // Left panel entrance (0-30%)
      scrollTl.fromTo(
        leftPanel,
        { x: '-50vw', opacity: 0, scale: 0.98 },
        { x: 0, opacity: 1, scale: 1, ease: 'power2.out' },
        0
      );

      // Right card entrance (0-30%)
      scrollTl.fromTo(
        rightCard,
        { x: '50vw', opacity: 0, scale: 0.98 },
        { x: 0, opacity: 1, scale: 1, ease: 'power2.out' },
        0
      );

      // Bell button entrance (10-25%)
      scrollTl.fromTo(
        bell,
        { scale: 0.6, opacity: 0 },
        { scale: 1, opacity: 1, ease: 'back.out(1.7)' },
        0.1
      );

      // Form fields stagger (12-30%)
      const fields = form.querySelectorAll('.form-field');
      scrollTl.fromTo(
        fields,
        { y: 16, opacity: 0 },
        { y: 0, opacity: 1, stagger: 0.06, ease: 'power2.out' },
        0.12
      );

      // Exit animations (70-100%)
      scrollTl.fromTo(
        leftPanel,
        { x: 0, opacity: 1 },
        { x: '-18vw', opacity: 0.2, ease: 'power2.in' },
        0.7
      );
      scrollTl.fromTo(
        rightCard,
        { x: 0, opacity: 1 },
        { x: '18vw', opacity: 0.2, ease: 'power2.in' },
        0.7
      );
      scrollTl.fromTo(
        bell,
        { opacity: 1 },
        { opacity: 0, ease: 'power2.in' },
        0.85
      );
      scrollTl.fromTo(
        bg,
        { opacity: 1 },
        { opacity: 0.4, ease: 'power2.in' },
        0.7
      );
    }, section);

    return () => ctx.revert();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setShowSuccess(true);
    setTimeout(() => setShowSuccess(false), 3000);
  };

  return (
    <section
      ref={sectionRef}
      className="relative w-full h-screen overflow-hidden z-30"
    >
      {/* Background image */}
      <div ref={bgRef} className="absolute inset-0 w-full h-full" style={{ opacity: 0 }}>
        <img
          src="/execution_city_bg.jpg"
          alt="Execution background"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-[#070A12]/50" />
      </div>

      {/* Bell button */}
      <button
        ref={bellRef}
        className="absolute right-[4vw] top-[4vh] w-11 h-11 rounded-full bg-[rgba(11,16,34,0.8)] border border-[rgba(0,240,255,0.2)] flex items-center justify-center z-40 hover:border-[#00F0FF]/50 transition-colors"
        style={{ opacity: 0 }}
      >
        <Bell className="w-5 h-5 text-[#00F0FF]" />
        <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#00F0FF] text-[#070A12] text-[10px] font-bold flex items-center justify-center">
          3
        </span>
      </button>

      {/* Left panel - Order Form */}
      <div
        ref={leftPanelRef}
        className="absolute left-[6vw] top-1/2 -translate-y-1/2 w-[min(520px,42vw)] panel-bg panel-border rounded-2xl p-6 z-40"
        style={{ opacity: 0 }}
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-[#00F0FF]/10 flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-[#00F0FF]" />
          </div>
          <div>
            <h3 className="font-semibold text-lg">New Order</h3>
            <p className="text-xs text-[#A7B0C8]">Execute with confidence</p>
          </div>
        </div>

        <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
          <div className="form-field">
            <label className="block text-xs text-[#A7B0C8] mb-1.5">Symbol</label>
            <input
              type="text"
              value={orderData.symbol}
              onChange={(e) => setOrderData({ ...orderData, symbol: e.target.value.toUpperCase() })}
              placeholder="e.g., AAPL"
              className="w-full bg-[#070A12]/60 border border-[rgba(0,240,255,0.15)] rounded-xl px-4 py-3 text-sm text-[#F4F6FF] placeholder:text-[#A7B0C8]/40 outline-none focus:border-[#00F0FF]/40 transition-colors"
            />
          </div>

          <div className="form-field grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-[#A7B0C8] mb-1.5">Side</label>
              <div className="flex rounded-xl overflow-hidden border border-[rgba(0,240,255,0.15)]">
                <button
                  type="button"
                  onClick={() => setOrderData({ ...orderData, side: 'Buy' })}
                  className={`flex-1 py-3 text-sm font-medium transition-colors ${
                    orderData.side === 'Buy'
                      ? 'bg-[#00F0FF] text-[#070A12]'
                      : 'bg-[#070A12]/60 text-[#A7B0C8] hover:text-[#F4F6FF]'
                  }`}
                >
                  Buy
                </button>
                <button
                  type="button"
                  onClick={() => setOrderData({ ...orderData, side: 'Sell' })}
                  className={`flex-1 py-3 text-sm font-medium transition-colors ${
                    orderData.side === 'Sell'
                      ? 'bg-[#FF6B6B] text-[#070A12]'
                      : 'bg-[#070A12]/60 text-[#A7B0C8] hover:text-[#F4F6FF]'
                  }`}
                >
                  Sell
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs text-[#A7B0C8] mb-1.5">Quantity</label>
              <input
                type="number"
                value={orderData.quantity}
                onChange={(e) => setOrderData({ ...orderData, quantity: e.target.value })}
                placeholder="0"
                className="w-full bg-[#070A12]/60 border border-[rgba(0,240,255,0.15)] rounded-xl px-4 py-3 text-sm text-[#F4F6FF] placeholder:text-[#A7B0C8]/40 outline-none focus:border-[#00F0FF]/40 transition-colors"
              />
            </div>
          </div>

          <div className="form-field">
            <label className="block text-xs text-[#A7B0C8] mb-1.5">Order Type</label>
            <select
              value={orderData.orderType}
              onChange={(e) => setOrderData({ ...orderData, orderType: e.target.value })}
              className="w-full bg-[#070A12]/60 border border-[rgba(0,240,255,0.15)] rounded-xl px-4 py-3 text-sm text-[#F4F6FF] outline-none focus:border-[#00F0FF]/40 transition-colors appearance-none cursor-pointer"
            >
              <option value="Market">Market</option>
              <option value="Limit">Limit</option>
              <option value="Stop">Stop</option>
              <option value="Stop Limit">Stop Limit</option>
            </select>
          </div>

          <div className="form-field pt-2 flex gap-3">
            <button
              type="submit"
              disabled={showSuccess}
              className={`flex-1 py-3 rounded-xl font-medium text-sm transition-all flex items-center justify-center gap-2 ${
                showSuccess
                  ? 'bg-green-500 text-white'
                  : 'bg-[#00F0FF] text-[#070A12] hover:bg-[#00F0FF]/90'
              }`}
            >
              {showSuccess ? (
                <>
                  <Check className="w-4 h-4" />
                  Order Placed
                </>
              ) : (
                <>
                  <TrendingUp className="w-4 h-4" />
                  Place Order
                </>
              )}
            </button>
            <button
              type="button"
              className="px-4 py-3 rounded-xl border border-[rgba(0,240,255,0.2)] text-sm text-[#A7B0C8] hover:text-[#F4F6FF] hover:border-[#00F0FF]/40 transition-all flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              Save
            </button>
          </div>
        </form>
      </div>

      {/* Right card - Pattern Alert */}
      <div
        ref={rightCardRef}
        className="absolute right-[6vw] top-1/2 -translate-y-1/2 w-[min(420px,34vw)] panel-bg panel-border rounded-2xl p-6 z-40"
        style={{ opacity: 0 }}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-[#FF6B6B]/10 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-[#FF6B6B]" />
          </div>
          <div>
            <h3 className="font-semibold text-lg">Pattern Alert</h3>
            <span className="text-xs text-[#A7B0C8]">2 min ago</span>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[rgba(255,107,107,0.08)] border border-[rgba(255,107,107,0.2)] mb-4">
          <p className="text-sm text-[#F4F6FF] leading-relaxed">
            Breakout detected on high volume with tightening spreads. Technical indicators suggest continued momentum.
          </p>
        </div>

        <div className="space-y-3 mb-5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-[#A7B0C8]">Pattern</span>
            <span className="text-[#F4F6FF] font-medium">Bull Flag</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-[#A7B0C8]">Confidence</span>
            <span className="text-[#00F0FF] font-medium">87%</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-[#A7B0C8]">Volume</span>
            <span className="text-[#00F0FF] font-medium">2.4x avg</span>
          </div>
        </div>

        <button className="w-full py-3 rounded-xl bg-[rgba(0,240,255,0.1)] border border-[rgba(0,240,255,0.2)] text-sm text-[#00F0FF] hover:bg-[rgba(0,240,255,0.15)] transition-all flex items-center justify-center gap-2">
          <ChartLine className="w-4 h-4" />
          Open Chart
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </section>
  );
}
