import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';

export default function Footer() {
    const year = new Date().getFullYear();
    return (
        <footer className="relative z-10 py-10 px-6 border-t border-[rgba(255,255,255,0.05)] bg-[#070A12]">
            <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-[#A7B0C8]">
                <Link to="/" className="flex items-center gap-2 hover:text-white transition-colors">
                    <Sparkles className="w-4 h-4 text-[#00F0FF]" />
                    <span className="font-semibold">MarketIntelligence</span>
                </Link>
                <a
                    href="mailto:hello@marketintelligence.io"
                    className="hover:text-white transition-colors font-mono text-xs"
                >
                    hello@marketintelligence.io
                </a>
                <span className="text-xs text-[#A7B0C8]/50">
                    © {year} · All rights reserved
                </span>
            </div>
        </footer>
    );
}
