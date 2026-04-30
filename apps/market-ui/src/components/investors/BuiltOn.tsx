const LOGOS = [
    'Anthropic',
    'OpenAI',
    'Google',
    'Voyage',
    'Cohere',
    'DeepSeek',
    'Neo4j',
    'Qdrant',
    'TimescaleDB',
    'Elasticsearch',
    'Redis',
    'Supabase',
    'Clerk',
];

export default function BuiltOn() {
    return (
        <section className="relative z-10 py-16 px-6 border-y border-[rgba(0,240,255,0.06)] bg-[#070A12]">
            <div className="max-w-6xl mx-auto">
                <p className="text-center text-[11px] uppercase tracking-[0.14em] text-[#A7B0C8]/50 font-medium mb-7">
                    Built on
                </p>
                <div className="flex flex-wrap justify-center items-center gap-x-7 gap-y-3">
                    {LOGOS.map((logo) => (
                        <span
                            key={logo}
                            className="text-sm font-semibold text-[#A7B0C8]/40 hover:text-[#A7B0C8]/80 transition-colors tracking-wide font-mono"
                        >
                            {logo}
                        </span>
                    ))}
                </div>
            </div>
        </section>
    );
}
