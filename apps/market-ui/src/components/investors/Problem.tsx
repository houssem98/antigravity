import { motion } from 'motion/react';
import { Clock, Search, AlertTriangle } from 'lucide-react';

const CARDS = [
    {
        icon: Clock,
        color: '#F9AB00',
        title: 'Analysts burn 4+ hours per report',
        body: 'A single institutional-grade research memo still takes half a day of reading filings, transcripts, and sell-side notes — before any synthesis happens.',
    },
    {
        icon: Search,
        color: '#8AB4F8',
        title: "Legacy tools don't reason",
        body: 'Bloomberg, FactSet, AlphaSense index the world. They retrieve — they don\'t synthesize, verify, or challenge a thesis.',
    },
    {
        icon: AlertTriangle,
        color: '#FF6B6B',
        title: 'Generic LLMs hallucinate',
        body: 'ChatGPT and Perplexity ship on unverifiable output. Institutions cannot put a number in front of an IC from a model that invents citations.',
    },
];

export default function Problem() {
    return (
        <section className="relative z-10 py-24 px-6 bg-[#070A12]">
            <div className="max-w-6xl mx-auto">
                <div className="text-center mb-14">
                    <span className="text-xs uppercase tracking-[0.14em] text-[#00F0FF] font-medium mb-3 block">
                        Why now
                    </span>
                    <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
                        The research stack is broken on both ends.
                    </h2>
                    <p className="text-[#A7B0C8] max-w-xl mx-auto">
                        Buy-side workflows sit between slow legacy terminals and
                        fast-but-unreliable general AI. Neither is institutional.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                    {CARDS.map((c, i) => (
                        <motion.div
                            key={c.title}
                            initial={{ opacity: 0, y: 16 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true, amount: 0.4 }}
                            transition={{ duration: 0.45, delay: i * 0.08 }}
                            className="p-6 rounded-2xl border border-[rgba(255,255,255,0.06)]"
                            style={{ background: 'rgba(255,255,255,0.025)' }}
                        >
                            <div
                                className="w-11 h-11 rounded-xl flex items-center justify-center mb-5"
                                style={{
                                    background: `${c.color}15`,
                                    border: `1px solid ${c.color}25`,
                                }}
                            >
                                <c.icon className="w-5 h-5" style={{ color: c.color }} />
                            </div>
                            <h3 className="font-semibold text-[15px] mb-2 leading-snug">
                                {c.title}
                            </h3>
                            <p className="text-sm text-[#A7B0C8] leading-relaxed">
                                {c.body}
                            </p>
                        </motion.div>
                    ))}
                </div>
            </div>
        </section>
    );
}
