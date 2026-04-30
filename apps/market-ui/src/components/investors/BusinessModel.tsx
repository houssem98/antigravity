import { motion } from 'motion/react';
import { Check } from 'lucide-react';

const PLANS = [
    {
        name: 'Starter',
        price: '$49',
        period: '/mo',
        desc: 'Individual analysts and researchers',
        features: ['20 deep reports / mo', 'Real-time market data', 'SEC EDGAR access'],
        highlight: false,
    },
    {
        name: 'Professional',
        price: '$149',
        period: '/mo',
        desc: 'Serious investors and PMs',
        features: [
            'Unlimited reports',
            'All models · priority routing',
            'Slack · API · archive',
        ],
        highlight: true,
    },
    {
        name: 'Enterprise',
        price: 'Custom',
        period: '',
        desc: 'Teams and institutions',
        features: ['SSO · SAML', 'Custom sources · SLA', 'On-prem deployment'],
        highlight: false,
    },
    {
        name: 'Execution',
        price: 'Roadmap',
        period: '',
        desc: 'Transaction revenue via broker partnerships',
        features: ['Alpaca · IBKR routing', 'Strategy automation', 'Prop-desk tier'],
        highlight: false,
        roadmap: true,
    },
];

export default function BusinessModel() {
    return (
        <section
            id="pricing"
            className="relative z-10 py-24 px-6 bg-[#070A12]"
        >
            <div className="max-w-6xl mx-auto">
                <div className="text-center mb-14">
                    <span className="text-xs uppercase tracking-[0.14em] text-[#00F0FF] font-medium mb-3 block">
                        Business model
                    </span>
                    <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
                        Three SaaS tiers today. A fourth revenue line tomorrow.
                    </h2>
                    <p className="text-[#A7B0C8] max-w-xl mx-auto">
                        Predictable subscription economics on the research
                        side. Transaction upside on the trading side.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-stretch">
                    {PLANS.map((plan, i) => (
                        <motion.div
                            key={plan.name}
                            initial={{ opacity: 0, y: 14 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true, amount: 0.3 }}
                            transition={{ duration: 0.45, delay: i * 0.06 }}
                            className={`relative p-6 rounded-2xl flex flex-col gap-5 ${plan.highlight
                                    ? 'border-2 border-[#00F0FF]/40'
                                    : plan.roadmap
                                        ? 'border border-dashed border-[rgba(155,114,203,0.4)]'
                                        : 'border border-[rgba(255,255,255,0.07)]'
                                }`}
                            style={{
                                background: plan.highlight
                                    ? 'linear-gradient(135deg, rgba(0,240,255,0.06), rgba(138,180,248,0.04))'
                                    : plan.roadmap
                                        ? 'rgba(155,114,203,0.03)'
                                        : 'rgba(255,255,255,0.025)',
                            }}
                        >
                            {plan.highlight && (
                                <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-[0.12em] bg-[#00F0FF] text-[#070A12]">
                                    Most popular
                                </span>
                            )}
                            {plan.roadmap && (
                                <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-[0.12em] bg-[#9B72CB] text-white">
                                    Roadmap
                                </span>
                            )}

                            <div>
                                <p className="text-sm font-semibold text-[#A7B0C8] mb-1">
                                    {plan.name}
                                </p>
                                <div className="flex items-end gap-1">
                                    <span className="text-3xl font-bold">
                                        {plan.price}
                                    </span>
                                    {plan.period && (
                                        <span className="text-[#A7B0C8] text-sm pb-1">
                                            {plan.period}
                                        </span>
                                    )}
                                </div>
                                <p className="text-xs text-[#A7B0C8]/60 mt-1 leading-relaxed">
                                    {plan.desc}
                                </p>
                            </div>

                            <ul className="space-y-2 flex-1">
                                {plan.features.map((f) => (
                                    <li
                                        key={f}
                                        className="flex items-start gap-2 text-xs text-[#A7B0C8]"
                                    >
                                        <Check
                                            className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${plan.roadmap ? 'text-[#9B72CB]' : 'text-[#00F0FF]'}`}
                                        />
                                        <span>{f}</span>
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
