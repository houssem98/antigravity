import React, { useState, useEffect } from 'react';
import { ExternalLink } from 'lucide-react';
import { motion } from 'motion/react';

interface NewsItem {
  id: string;
  title: string;
  image: string;
  source: string;
  time: string;
}

const MOCK_NEWS: NewsItem[] = [
  {
    id: '1',
    title: "Strategy's STRC Drops to $91.7 as Bitcoin Buys Spook Investors",
    image: 'https://via.placeholder.com/300x180?text=Bitcoin+News',
    source: 'CoinMarketCap',
    time: '7 hours ago'
  },
  {
    id: '2',
    title: 'Bitcoin Covenants Part 2: OP_CHECKTEMPLATEVERIFY',
    image: 'https://via.placeholder.com/300x180?text=BTC+Technical',
    source: 'Cointelegraph.com News (Full)',
    time: '10 hours ago'
  },
  {
    id: '3',
    title: 'Understanding the BTC/USDT Spot CVD Chart: A Trader\'s Guide to Order Flow',
    image: 'https://via.placeholder.com/300x180?text=Trading+Guide',
    source: 'BitcoinWorld',
    time: '15 hours ago'
  },
  {
    id: '4',
    title: '10x Research: BlackRock\'s New Bitcoin Income ETF Is Structurally Set to Underperform BTC',
    image: 'https://via.placeholder.com/300x180?text=Research',
    source: 'BitcoinWorld',
    time: '18 hours ago'
  },
];

interface NewsTabProps {
  asset: string;
}

export const NewsTab: React.FC<NewsTabProps> = ({ asset }) => {
  const [filter, setFilter] = useState<'top' | 'latest' | 'analysis'>('top');

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-[color:var(--bg)]">
      {/* Header with filters */}
      <div className="p-4 border-b border-[color:var(--line)] flex items-center gap-3">
        <span className="text-body font-semibold text-[color:var(--text)]">{asset} News</span>
        <div className="flex gap-2 ml-auto">
          {(['top', 'latest', 'analysis'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-sm text-label font-medium capitalize transition-colors ${
                filter === f
                  ? 'bg-[color:var(--accent)] text-[color:var(--accent-ink)]'
                  : 'bg-[color:var(--surface)] text-[color:var(--text-3)] hover:text-[color:var(--text)]'
              }`}
            >
              {f === 'analysis' ? 'CMC Daily Analysis' : f}
            </button>
          ))}
        </div>
      </div>

      {/* News grid */}
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
          {MOCK_NEWS.map((item, idx) => (
            <motion.a
              key={item.id}
              href="#"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
              className="group cursor-pointer rounded-sm overflow-hidden border border-[color:var(--line)] hover:border-[color:var(--line-strong)] transition-colors"
            >
              <div className="aspect-video bg-[color:var(--surface)] overflow-hidden">
                <img
                  src={item.image}
                  alt={item.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                />
              </div>
              <div className="p-3 bg-[color:var(--surface)]">
                <h3 className="text-body font-semibold text-[color:var(--text)] group-hover:text-[color:var(--accent)] transition-colors line-clamp-2 mb-2">
                  {item.title}
                </h3>
                <div className="flex items-center justify-between text-label text-[color:var(--text-3)]">
                  <span>{item.source}</span>
                  <span>{item.time}</span>
                </div>
              </div>
            </motion.a>
          ))}
        </div>
      </div>
    </div>
  );
};
