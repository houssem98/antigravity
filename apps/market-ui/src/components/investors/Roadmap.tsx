import { motion } from 'motion/react';
import { Check, CircleDashed, Clock } from 'lucide-react';

const COLUMNS = [
    {
        label: 'Shipped today',
        icon: Check,
        color: '#81C995',
        items: [
            'Research pipeline · 5-channel retrieval',
            'Agentic research loop + citation audit',
            'Pro charting · 60+ drawing tools',
            'AI chart copilot',
            'CryptoBERT community sentiment',
            'SEC EDGAR real-time ingestion',
        ],
    },
    {
        label: 'Q2 2026',
        icon: CircleDashed,
        color: '#00F0FF',
        items: [
            'Algorithmic pattern detection',
            'Custom research templates',
            'Team workspaces',
        ],
    },
    {
        label: 'Q3 2026',
        icon: Clock,
        color: '#9B72CB',
        items: [
            'Broker integrations (Alpaca, IBKR)',
            'Strategy automation',
            'On-prem enterprise tier',
        ],
    },
];

export default function Roadmap() {
    return (
        <section className="relative z-10 py-24 px-6 bg-[#070A12]">
            <div className="max-w-6xl mx-auto">
                <div className="text-center mb-14">
                    <span className="text-xs uppercase tracking-[0.14em] text-[#00F0FF] font-medium mb-3 block">
                        Roadmap
                    </span>
                    <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
                        What's shipped, what's next.
                    </h2>
                    <p className="text-[#A7B0C8] max-w-xl mx-auto">
                        Honest about today. Clear about tomorrow.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                    {COLUMNS.map((col, idx) => (
                        <motion.div
                            key={col.label}
                            initial={{ opacity: 0, y: 16 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true, amount: 0.3 }}
                            transition={{ duration: 0.45, delay: idx * 0.08 }}
                            className="p-6 rounded-2xl border border-[rgba(255,255,255,0.06)]"
                            style={{ background: 'rgba(255,255,255,0.025)' }}
                        >
                            <div className="flex items-center gap-2.5 mb-5">
                                <div
                                    className="w-9 h-9 rounded-lg flex items-center justify-center"
                                    style={{
                                        background: `${col.color}15`,
                                        border: `1px solid ${col.color}30`,
                                    }}
                                >
                                    <col.icon
                                        className="w-4 h-4"
                                        style={{ color: col.color }}
                                    />
                                </div>
                                <span
                                    className="text-[11px] uppercase tracking-[0.1em] font-mono font-semibold"
                                    style={{ color: col.color }}
                                >
                                    {col.label}
                                </span>
                            </div>

                            <ul className="space-y-2.5">
                                {col.items.map((item) => (
                                    <li
                                        key={item}
                                        className="text-sm text-[#A7B0C8] leading-relaxed flex items-start gap-2"
                                    >
                                        <span
                                            className="mt-1.5 w-1 h-1 rounded-full flex-shrink-0"
                                            style={{ background: col.color }}
                                        />
                                        {item}
                                    </li>
                                ))}
                            </ul>
                        </motion.div>
                    ))}
                </div>
            </div>
        </section>
    );
}
