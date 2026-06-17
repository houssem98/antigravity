import React, { useState, useEffect } from 'react';
import { Globe, Github, Twitter, MessageCircle, ExternalLink, Loader } from 'lucide-react';
import { motion } from 'motion/react';

interface AboutTabProps {
  asset: string;
}

interface CryptoInfo {
  name: string;
  symbol: string;
  description: string;
  founded: string;
  website: string;
  whitepaper: string;
  github?: string;
  twitter?: string;
  discord?: string;
  blockchain: string;
  consensus: string;
  totalSupply: string;
  marketCap: string;
}

const CRYPTO_INFO: Record<string, CryptoInfo> = {
  BTC: {
    name: 'Bitcoin',
    symbol: 'BTC',
    description:
      'Bitcoin is a peer-to-peer electronic cash system created by the pseudonymous Satoshi Nakamoto. It is the world\'s first decentralized digital currency and operates without a central bank or single administrator.',
    founded: '2009',
    website: 'https://bitcoin.org',
    whitepaper: 'https://bitcoin.org/bitcoin.pdf',
    github: 'https://github.com/bitcoin/bitcoin',
    twitter: 'https://twitter.com/bitcoin',
    discord: 'https://discord.gg/bitcoin',
    blockchain: 'Bitcoin',
    consensus: 'Proof of Work (SHA-256)',
    totalSupply: '21,000,000 BTC',
    marketCap: '$1.2T',
  },
  ETH: {
    name: 'Ethereum',
    symbol: 'ETH',
    description:
      'Ethereum is a decentralized computing platform featuring smart contracts. It enables developers to build decentralized applications (dApps) and has become the leading blockchain for DeFi, NFTs, and Web3 applications.',
    founded: '2015',
    website: 'https://ethereum.org',
    whitepaper: 'https://ethereum.org/en/whitepaper/',
    github: 'https://github.com/ethereum',
    twitter: 'https://twitter.com/ethereum',
    discord: 'https://discord.gg/ethereum',
    blockchain: 'Ethereum',
    consensus: 'Proof of Stake',
    totalSupply: 'Unlimited',
    marketCap: '$310B',
  },
  SOL: {
    name: 'Solana',
    symbol: 'SOL',
    description:
      'Solana is a high-performance blockchain built for scalability. It uses a novel Proof of History consensus mechanism to achieve high throughput and low transaction costs, making it ideal for NFTs and DeFi applications.',
    founded: '2017',
    website: 'https://solana.com',
    whitepaper: 'https://solana.com/solana-whitepaper.pdf',
    github: 'https://github.com/solana-labs/solana',
    twitter: 'https://twitter.com/solana',
    discord: 'https://discord.gg/solana',
    blockchain: 'Solana',
    consensus: 'Proof of History + Proof of Stake',
    totalSupply: '511,616,946 SOL',
    marketCap: '$72B',
  },
};

export const AboutTab: React.FC<AboutTabProps> = ({ asset }) => {
  const [info, setInfo] = useState<CryptoInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Simulate loading
    setTimeout(() => {
      const data = CRYPTO_INFO[asset];
      setInfo(data || CRYPTO_INFO.BTC);
      setLoading(false);
    }, 300);
  }, [asset]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader className="w-6 h-6 text-[color:var(--text-3)] animate-spin" />
      </div>
    );
  }

  if (!info) {
    return (
      <div className="flex items-center justify-center h-96 text-[color:var(--text-3)]">
        No information available
      </div>
    );
  }

  const links = [
    { label: 'Website', url: info.website, icon: Globe },
    { label: 'Whitepaper', url: info.whitepaper, icon: ExternalLink },
    ...(info.github ? [{ label: 'GitHub', url: info.github, icon: Github }] : []),
    ...(info.twitter ? [{ label: 'Twitter', url: info.twitter, icon: Twitter }] : []),
    ...(info.discord ? [{ label: 'Discord', url: info.discord, icon: MessageCircle }] : []),
  ];

  return (
    <div className="overflow-y-auto max-h-[calc(100vh-200px)]">
      <div className="p-6 space-y-6">
        {/* Header */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <div className="flex items-center gap-4 mb-4">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[color:var(--accent)] to-[color:var(--up)] flex items-center justify-center text-h3 font-bold text-white">
              {info.symbol.charAt(0)}
            </div>
            <div>
              <h1 className="text-h2 font-bold text-[color:var(--text)]">{info.name}</h1>
              <p className="text-body text-[color:var(--text-3)]">
                {info.symbol} • Founded {info.founded}
              </p>
            </div>
          </div>
        </motion.div>

        {/* Description */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <h3 className="text-body font-semibold text-[color:var(--text)] mb-2">About</h3>
          <p className="text-body text-[color:var(--text-2)] leading-relaxed">{info.description}</p>
        </motion.div>

        {/* Technical Details */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <h3 className="text-body font-semibold text-[color:var(--text)] mb-3">Technical Details</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { label: 'Blockchain', value: info.blockchain },
              { label: 'Consensus', value: info.consensus },
              { label: 'Total Supply', value: info.totalSupply },
              { label: 'Market Cap', value: info.marketCap },
            ].map((item, idx) => (
              <motion.div
                key={item.label}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.15 + idx * 0.05 }}
                className="p-3 bg-[color:var(--surface)] border border-[color:var(--line)] rounded-sm"
              >
                <div className="label text-[color:var(--text-3)] mb-1">{item.label}</div>
                <div className="text-body font-semibold text-[color:var(--text)]">{item.value}</div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Links */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <h3 className="text-body font-semibold text-[color:var(--text)] mb-3">Resources</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {links.map((link, idx) => {
              const Icon = link.icon;
              return (
                <motion.a
                  key={link.label}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.2 + idx * 0.05 }}
                  className="flex items-center gap-2 p-3 bg-[color:var(--surface)] border border-[color:var(--line)] hover:border-[color:var(--line-strong)] hover:bg-[color:var(--surface-2)] rounded-sm transition-colors group"
                >
                  <Icon className="w-4 h-4 text-[color:var(--text-3)] group-hover:text-[color:var(--accent)] transition-colors" />
                  <span className="text-label font-semibold text-[color:var(--text-2)] group-hover:text-[color:var(--text)] transition-colors">
                    {link.label}
                  </span>
                  <ExternalLink className="w-3 h-3 text-[color:var(--text-3)] opacity-0 group-hover:opacity-100 transition-opacity ml-auto" />
                </motion.a>
              );
            })}
          </div>
        </motion.div>

        {/* Disclaimer */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }} className="p-3 bg-[color:var(--bg)] border border-[color:var(--line)] rounded-sm">
          <p className="text-label text-[color:var(--text-3)]">
            ℹ️ Information shown is for educational purposes only and should not be considered as investment advice.
          </p>
        </motion.div>
      </div>
    </div>
  );
};
