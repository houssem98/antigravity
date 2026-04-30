import { motion } from 'motion/react';
import {
    Layers,
    GitMerge,
    Shuffle,
    ShieldCheck,
    MessagesSquare,
    Terminal,
} from 'lucide-react';

const CARDS = [
    {
        icon: Layers,
        color: '#00F0FF',
        title: 'Voyage Finance embeddings',
        body: 'Domain-tuned 1,024-dim vectors for finance — not generic OpenAI embeddings. Higher recall on filings, transcripts, and sell-side language.',
    },
    {
        icon: GitMerge,
        color: '#8AB4F8',
        title: '5-channel retrieval fusion',
        body: 'Dense + BM25 + SPLADE + knowledge graph + structured SQL, fused via Reciprocal Rank Fusion and reranked by Cohere.',
    },
    {
        icon: Shuffle,
        color: '#9B72CB',
        title: 'Vendor-hedged LLM stack',
        body: 'Anthropic + OpenAI + Google + DeepSeek + Cohere + Voyage. Routed by complexity — Flash for speed, Opus for thesis work, DeepSeek for quant.',
    },
    {
        icon: ShieldCheck,
        color: '#81C995',
        title: 'Per-sentence citation audit',
        body: 'LLM-judge and cross-reference verifier audit every claim against source passages. Every sentence in every report is traceable.',
    },
    {
        icon: MessagesSquare,
        color: '#F9AB00',
        title: 'CryptoBERT sentiment pipeline',
        body: 'Real influencer feeds via Tavily, scored by a fine-tuned BERT model — bullish/bearish/neutral with impact weighting. Not generic web scraping.',
    },
    {
        icon: Terminal,
        color: '#FF6B6B',
        title: 'TradingView MCP surface',
        body: 'A 78-tool automation layer for chart control, Pine script, replay, and alerts — foundation for the enterprise / prop-desk tier (roadmap).',
    },
];

export default function Moat() {
    return (
        <section
            id="moat"
            className="relative z-10 py-24 px-6 bg-[#070A12] border-y border-[rgba(0,240,255,0.06)]"
        >
            <div className="max-w-6xl mx-auto">
                <div className="text-center mb-14">
                    <span className="text-xs uppercase tracking-[0.14em] text-[#00F0FF] font-medium mb-3 block">
                        Technical moat
                    </span>
                    <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
                        What's actually defensible.
                    </h2>
                    <p className="text-[#A7B0C8] max-w-xl mx-auto">
                        Six layers that compound. Replacing any one of them is
                        a quarter of engineering. Replacing the stack is a
                        company.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                    {CARDS.map((c, i) => (
                        <motion.div
                            key={c.title}
                            initial={{ opacity: 0, y: 16 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true, amount: 0.2 }}
                            transition={{ duration: 0.45, delay: (i % 3) * 0.05 }}
                            className="p-6 rounded-2xl border border-[rgba(255,255,255,0.06)] hover:border-[rgba(0,240,255,0.18)] transition-all"
                            style={{ background: 'rgba(255,255,255,0.025)' }}
                        >
                            <div
                                className="w-11 h-11 rounded-xl flex items-center justify-center mb-5"
                                style={{
                                    background: `${c.color}15`,
                                    border: `1px solid ${c.color}25`,
                                }}
                            >
                                <c.icon
                                    className="w-5 h-5"
                                    style={{ color: c.color }}
                                />
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
