import { motion } from 'motion/react';

const CHANNELS = [
    { label: 'Dense', sub: 'voyage-finance-2' },
    { label: 'Sparse', sub: 'BM25 · ES' },
    { label: 'SPLADE', sub: 'learned sparse' },
    { label: 'Graph', sub: 'Neo4j entities' },
    { label: 'SQL', sub: 'Timescale TS' },
];

const PIPELINE = [
    { label: 'RRF fusion' },
    { label: 'Cohere rerank' },
    { label: 'Agent loop' },
    { label: 'Citation audit' },
];

export default function Wedge() {
    return (
        <section id="wedge" className="relative z-10 py-24 px-6 bg-[#070A12]">
            <div className="max-w-6xl mx-auto">
                <div className="text-center mb-14">
                    <span className="text-xs uppercase tracking-[0.14em] text-[#00F0FF] font-medium mb-3 block">
                        The wedge
                    </span>
                    <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
                        Five retrieval channels. One reasoning loop.
                    </h2>
                    <p className="text-[#A7B0C8] max-w-2xl mx-auto leading-relaxed">
                        We fuse dense, sparse, learned-sparse, graph, and
                        structured retrieval — then run an agentic
                        Planner → Reader → Extractor → Critic → Verifier →
                        Writer loop with per-sentence citation audit. It is the
                        first AI research surface institutions can ship to
                        production without a human verifier in the loop.
                    </p>
                </div>

                <div
                    className="p-6 md:p-10 rounded-2xl border border-[rgba(255,255,255,0.07)]"
                    style={{ background: 'rgba(255,255,255,0.02)' }}
                >
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
                        {CHANNELS.map((c, i) => (
                            <motion.div
                                key={c.label}
                                initial={{ opacity: 0, y: 12 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true }}
                                transition={{ duration: 0.4, delay: i * 0.05 }}
                                className="p-4 rounded-xl border border-[rgba(0,240,255,0.15)] text-center"
                                style={{ background: 'rgba(0,240,255,0.04)' }}
                            >
                                <p className="text-sm font-semibold text-[#F4F6FF]">
                                    {c.label}
                                </p>
                                <p className="text-[11px] font-mono text-[#A7B0C8]/70 mt-1">
                                    {c.sub}
                                </p>
                            </motion.div>
                        ))}
                    </div>

                    <div className="flex items-center justify-center mb-8">
                        <div className="w-px h-8 bg-gradient-to-b from-[rgba(0,240,255,0.4)] to-transparent" />
                    </div>

                    <div className="flex flex-wrap justify-center items-center gap-2 md:gap-3">
                        {PIPELINE.map((s, i) => (
                            <motion.div
                                key={s.label}
                                initial={{ opacity: 0 }}
                                whileInView={{ opacity: 1 }}
                                viewport={{ once: true }}
                                transition={{ duration: 0.4, delay: 0.3 + i * 0.08 }}
                                className="flex items-center gap-2 md:gap-3"
                            >
                                <span className="px-3 md:px-4 py-2 rounded-lg text-xs md:text-sm font-medium text-[#F4F6FF] border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.025)]">
                                    {s.label}
                                </span>
                                {i < PIPELINE.length - 1 && (
                                    <span className="text-[#00F0FF]/50 text-xs">→</span>
                                )}
                            </motion.div>
                        ))}
                    </div>

                    <p className="text-center text-sm text-[#A7B0C8] mt-8 max-w-2xl mx-auto">
                        Every claim routed through{' '}
                        <span className="text-[#00F0FF] font-medium">
                            LLM-judge + cross-reference verifier
                        </span>{' '}
                        before it reaches the analyst.
                    </p>
                </div>
            </div>
        </section>
    );
}
