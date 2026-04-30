import { motion } from 'motion/react';

// TODO: drop screenshot files into apps/market-ui/public/investor/:
//   - research-report.png    → report with citation badges + confidence banner
//   - trading-chart.png      → chart with AI assistant annotation
//   - sentiment-panel.png    → CryptoBERT influencer sentiment panel
const SHOTS = [
    {
        src: '/investor/research-report.png',
        caption: 'Cited research report with confidence banner',
        label: 'Research',
    },
    {
        src: '/investor/trading-chart.png',
        caption: 'AI copilot annotating a live chart',
        label: 'Trading',
    },
    {
        src: '/investor/sentiment-panel.png',
        caption: 'CryptoBERT sentiment on influencer feeds',
        label: 'Sentiment',
    },
];

export default function LiveProduct() {
    return (
        <section className="relative z-10 py-24 px-6 bg-[#070A12]">
            <div className="max-w-6xl mx-auto">
                <div className="text-center mb-14">
                    <span className="text-xs uppercase tracking-[0.14em] text-[#00F0FF] font-medium mb-3 block">
                        Live product
                    </span>
                    <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
                        Shipping today, in users' hands.
                    </h2>
                    <p className="text-[#A7B0C8] max-w-xl mx-auto">
                        Not a slideware deck. Real screenshots from the
                        production platform.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                    {SHOTS.map((s, i) => (
                        <motion.figure
                            key={s.src}
                            initial={{ opacity: 0, y: 16 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true, amount: 0.3 }}
                            transition={{ duration: 0.5, delay: i * 0.08 }}
                            className="group rounded-2xl overflow-hidden border border-[rgba(0,240,255,0.12)]"
                            style={{
                                background: 'rgba(255,255,255,0.025)',
                                boxShadow: '0 0 0 1px rgba(0,240,255,0.04)',
                            }}
                        >
                            <div className="relative aspect-[4/3] bg-[#0B1020] overflow-hidden">
                                <img
                                    src={s.src}
                                    alt={s.caption}
                                    className="w-full h-full object-cover"
                                    onError={(e) => {
                                        const t = e.currentTarget;
                                        t.style.display = 'none';
                                    }}
                                />
                                <div className="absolute inset-0 flex items-center justify-center text-[11px] uppercase tracking-[0.14em] text-[#A7B0C8]/45 font-mono pointer-events-none">
                                    {s.label} screenshot
                                </div>
                                <div className="absolute inset-0 ring-1 ring-inset ring-[rgba(0,240,255,0.08)] group-hover:ring-[rgba(0,240,255,0.25)] transition-all" />
                            </div>
                            <figcaption className="px-5 py-4 flex items-center justify-between gap-3">
                                <span className="text-sm text-[#F4F6FF]/85">
                                    {s.caption}
                                </span>
                                <span className="text-[11px] uppercase tracking-[0.08em] text-[#00F0FF] font-mono">
                                    {s.label}
                                </span>
                            </figcaption>
                        </motion.figure>
                    ))}
                </div>
            </div>
        </section>
    );
}
