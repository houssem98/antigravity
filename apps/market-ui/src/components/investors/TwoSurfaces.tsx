import { motion } from 'motion/react';
import { FileText, LineChart } from 'lucide-react';

const RESEARCH = {
    icon: FileText,
    color: '#00F0FF',
    heading: 'Research',
    sub: 'For analysts, PMs, corp-dev',
    bullets: [
        'Deep reports',
        'SEC EDGAR real-time ingestion',
        'Per-sentence citations',
        'Agentic research mode',
        'Excel · PDF · Slack exports',
    ],
    tag: 'SaaS · $49–$149/mo · Enterprise custom',
};

const TRADING = {
    icon: LineChart,
    color: '#8AB4F8',
    heading: 'Trading',
    sub: 'For active traders, prop desks, crypto funds',
    bullets: [
        'Pro charting · 60+ drawing tools',
        'AI chart copilot (chart-aware)',
        'Live order books · Binance depth',
        'CryptoBERT sentiment on influencers',
        'Fundamentals · financials panel',
    ],
    tag: 'SaaS + future execution revenue via broker integrations',
};

type ColProps = {
    data: typeof RESEARCH;
    delay: number;
};

function Column({ data, delay }: ColProps) {
    const Icon = data.icon;
    return (
        <motion.div
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.5, delay }}
            className="p-7 md:p-9 rounded-2xl border border-[rgba(255,255,255,0.07)] flex flex-col h-full"
            style={{ background: 'rgba(255,255,255,0.025)' }}
        >
            <div
                className="w-12 h-12 rounded-xl flex items-center justify-center mb-5"
                style={{
                    background: `${data.color}15`,
                    border: `1px solid ${data.color}30`,
                }}
            >
                <Icon className="w-5 h-5" style={{ color: data.color }} />
            </div>
            <h3 className="text-2xl font-bold mb-1">{data.heading}</h3>
            <p className="text-sm text-[#A7B0C8] mb-6">{data.sub}</p>

            <ul className="space-y-2.5 mb-7 flex-1">
                {data.bullets.map((b) => (
                    <li
                        key={b}
                        className="flex items-start gap-2.5 text-sm text-[#F4F6FF]/85"
                    >
                        <span
                            className="mt-1.5 w-1 h-1 rounded-full flex-shrink-0"
                            style={{ background: data.color }}
                        />
                        {b}
                    </li>
                ))}
            </ul>

            <div
                className="text-[11px] uppercase tracking-[0.08em] font-mono px-3 py-2 rounded-lg"
                style={{
                    background: `${data.color}08`,
                    color: data.color,
                    border: `1px solid ${data.color}20`,
                }}
            >
                {data.tag}
            </div>
        </motion.div>
    );
}

export default function TwoSurfaces() {
    return (
        <section className="relative z-10 py-24 px-6 bg-[#070A12]">
            <div className="max-w-6xl mx-auto">
                <div className="text-center mb-14">
                    <span className="text-xs uppercase tracking-[0.14em] text-[#00F0FF] font-medium mb-3 block">
                        Two surfaces · one engine
                    </span>
                    <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
                        Monetized on both sides of the desk.
                    </h2>
                    <p className="text-[#A7B0C8] max-w-xl mx-auto">
                        Research is the wedge. Trading is the expansion. Same
                        retrieval engine powers both.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-8">
                    <Column data={RESEARCH} delay={0} />
                    <Column data={TRADING} delay={0.08} />
                </div>

                <motion.p
                    initial={{ opacity: 0 }}
                    whileInView={{ opacity: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.5, delay: 0.2 }}
                    className="text-center text-[#00F0FF] text-sm md:text-base font-medium max-w-2xl mx-auto"
                >
                    Same retrieval engine. Same LLM router. Same citation
                    layer. Monetized on both sides of the desk.
                </motion.p>
            </div>
        </section>
    );
}
