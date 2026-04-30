import { motion } from 'motion/react';

const STATS = [
    { value: '450M+', label: 'Documents indexed', sub: 'Filings, transcripts, news, analyst reports' },
    { value: '<5 min', label: 'Avg report generation', sub: 'From question to cited output' },
    { value: '99.9%', label: 'Uptime SLA', sub: '6-provider LLM fallback' },
    { value: '—', label: 'Beta users', sub: 'TODO: wire live count' },
    { value: '—', label: 'Reports generated', sub: 'TODO: wire live count' },
    { value: '6', label: 'LLM providers', sub: 'Anthropic, OpenAI, Google, DeepSeek, Cohere, Voyage' },
];

export default function Traction() {
    return (
        <section
            id="traction"
            className="relative z-10 py-24 px-6"
            style={{ background: 'rgba(0,240,255,0.02)' }}
        >
            <div className="max-w-6xl mx-auto">
                <div className="text-center mb-14">
                    <span className="text-xs uppercase tracking-[0.14em] text-[#00F0FF] font-medium mb-3 block">
                        Traction
                    </span>
                    <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
                        Real numbers, real product.
                    </h2>
                    <p className="text-[#A7B0C8] max-w-xl mx-auto">
                        In-product metrics — not projections.
                    </p>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
                    {STATS.map((s, i) => (
                        <motion.div
                            key={s.label}
                            initial={{ opacity: 0, y: 14 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true, amount: 0.3 }}
                            transition={{ duration: 0.45, delay: (i % 3) * 0.06 }}
                            className="p-6 md:p-7 rounded-2xl border border-[rgba(255,255,255,0.06)]"
                            style={{ background: 'rgba(255,255,255,0.025)' }}
                        >
                            <p className="text-4xl md:text-5xl font-bold text-[#00F0FF] mb-2 font-display tracking-tight">
                                {s.value}
                            </p>
                            <p className="text-[11px] uppercase tracking-[0.1em] text-[#F4F6FF] font-medium mb-1">
                                {s.label}
                            </p>
                            <p className="text-xs text-[#A7B0C8]/70 leading-relaxed">
                                {s.sub}
                            </p>
                        </motion.div>
                    ))}
                </div>
            </div>
        </section>
    );
}
