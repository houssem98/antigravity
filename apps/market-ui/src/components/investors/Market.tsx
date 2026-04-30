import { motion } from 'motion/react';

const POINTS = [
    {
        k: 'Bloomberg Terminal',
        v: '$10B+ annual revenue · 325k+ seats',
    },
    {
        k: 'AlphaSense',
        v: 'Valued at $4B in 2024',
    },
    {
        k: 'Retail + crypto active-trader TAM',
        v: 'Tens of millions globally',
    },
];

export default function Market() {
    return (
        <section className="relative z-10 py-24 px-6 bg-[#070A12]">
            <div className="max-w-4xl mx-auto">
                <div className="text-center mb-12">
                    <span className="text-xs uppercase tracking-[0.14em] text-[#00F0FF] font-medium mb-3 block">
                        Market
                    </span>
                    <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
                        The category is already huge.
                    </h2>
                </div>

                <ul className="flex flex-col gap-3 mb-10">
                    {POINTS.map((p, i) => (
                        <motion.li
                            key={p.k}
                            initial={{ opacity: 0, x: -12 }}
                            whileInView={{ opacity: 1, x: 0 }}
                            viewport={{ once: true, amount: 0.4 }}
                            transition={{ duration: 0.4, delay: i * 0.08 }}
                            className="flex flex-col md:flex-row md:items-baseline gap-1 md:gap-4 px-5 py-4 rounded-xl border border-[rgba(255,255,255,0.06)]"
                            style={{ background: 'rgba(255,255,255,0.02)' }}
                        >
                            <span className="text-[11px] uppercase tracking-[0.1em] text-[#00F0FF] font-mono md:w-56 flex-shrink-0">
                                {p.k}
                            </span>
                            <span className="text-sm md:text-base text-[#F4F6FF]/90">
                                {p.v}
                            </span>
                        </motion.li>
                    ))}
                </ul>

                <motion.p
                    initial={{ opacity: 0 }}
                    whileInView={{ opacity: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.5, delay: 0.3 }}
                    className="text-center text-base md:text-lg text-[#F4F6FF] max-w-2xl mx-auto"
                >
                    We're building the first platform that serves{' '}
                    <span className="text-[#00F0FF]">both sides</span> with the
                    same engine.
                </motion.p>
            </div>
        </section>
    );
}
