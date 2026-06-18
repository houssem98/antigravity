import React, { useState } from 'react';
import { motion } from 'motion/react';
import { TrendingUp, BarChart3 } from 'lucide-react';

interface Exchange {
  rank: number;
  name: string;
  pair: string;
  price: string;
  depth: string;
  volume24h: string;
  volumePercent: string;
}

const EXCHANGES_DATA: Exchange[] = [
  { rank: 1, name: 'Binance', pair: 'BTC/USDT', price: '$64,558.19', depth: '$16,614,755/$23,286,821', volume24h: '$1,234,712,430', volumePercent: '3.95%' },
  { rank: 2, name: 'Binance', pair: 'BTC/USDC', price: '$64,556.03', depth: '$3,773,721/$5,064,171', volume24h: '$422,907,420', volumePercent: '1.35%' },
  { rank: 3, name: 'Coinbase Exchange', pair: 'BTC/USD', price: '$64,568.02', depth: '$6,894,068/$12,279,087', volume24h: '$488,809,652', volumePercent: '1.57%' },
  { rank: 4, name: 'Upbit', pair: 'BTC/KRW', price: '$63,815.64', depth: '$156,077/$14,999', volume24h: '$77,858,859', volumePercent: '0.25%' },
  { rank: 5, name: 'Aster', pair: 'BTC/USDT', price: '$64,567.96', depth: '$225,813/$232,607', volume24h: '$1,479,287', volumePercent: '<0.01%' },
  { rank: 6, name: 'OKX', pair: 'BTC/USDT', price: '$64,567.31', depth: '$4,771,870/$4,880,593', volume24h: '$433,407,444', volumePercent: '1.39%' },
  { rank: 7, name: 'Bybit', pair: 'BTC/USDT', price: '$64,567.07', depth: '$17,603,400/$13,734,787', volume24h: '$1,143,488,292', volumePercent: '3.66%' },
  { rank: 8, name: 'Bitget', pair: 'BTC/USDT', price: '$64,560.14', depth: '$4,622,081/$3,841,568', volume24h: '$368,217,890', volumePercent: '1.18%' },
];

interface MarketsTabProps {
  asset: string;
}

export const MarketsTab: React.FC<MarketsTabProps> = ({ asset }) => {
  const [hoveredRank, setHoveredRank] = useState<number | null>(null);

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-gradient-to-b from-[color:var(--bg)] via-[color:var(--bg)] to-[color:color-mix(in_oklch,var(--accent)_3%,var(--bg))]">
      {/* Premium Header */}
      <div className="p-6 border-b border-[color:var(--line)] bg-gradient-to-r from-[color:color-mix(in_oklch,var(--accent)_8%,var(--surface))] to-transparent">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 rounded-lg bg-[color:var(--accent)] bg-opacity-20">
            <BarChart3 className="w-5 h-5 text-[color:var(--accent)]" />
          </div>
          <h2 className="text-h3 font-semibold text-[color:var(--text)]">{asset} Trading Pairs</h2>
        </div>
        <p className="text-label text-[color:var(--text-3)]">Top exchanges by 24h volume</p>
      </div>

      {/* Table Container */}
      <div className="flex-1 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[color:var(--surface-2)] bg-opacity-80 backdrop-blur-sm border-b border-[color:var(--line)]">
            <tr>
              <th className="px-4 py-3 label text-[color:var(--text-3)] font-semibold text-left">#</th>
              <th className="px-4 py-3 label text-[color:var(--text-3)] font-semibold text-left">Exchange</th>
              <th className="px-4 py-3 label text-[color:var(--text-3)] font-semibold text-left">Pair</th>
              <th className="px-4 py-3 label text-[color:var(--text-3)] font-semibold text-right">Price</th>
              <th className="px-4 py-3 label text-[color:var(--text-3)] font-semibold text-right">Order Book Depth</th>
              <th className="px-4 py-3 label text-[color:var(--text-3)] font-semibold text-right">24h Volume</th>
              <th className="px-4 py-3 label text-[color:var(--text-3)] font-semibold text-right">% Share</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[color:var(--line)]">
            {EXCHANGES_DATA.map((ex, idx) => {
              const isHovered = hoveredRank === ex.rank;
              const volumeNum = parseFloat(ex.volumePercent);
              const volumeColor = volumeNum > 3 ? 'from-[color:var(--up)]' : volumeNum > 1 ? 'from-[color:var(--accent)]' : 'from-[color:var(--text-3)]';

              return (
                <motion.tr
                  key={`${ex.rank}-${ex.pair}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.03 }}
                  onMouseEnter={() => setHoveredRank(ex.rank)}
                  onMouseLeave={() => setHoveredRank(null)}
                  className={`group transition-all duration-200 cursor-pointer ${
                    isHovered
                      ? 'bg-gradient-to-r from-[color:color-mix(in_oklch,var(--accent)_12%,var(--bg))] to-transparent shadow-lg'
                      : 'hover:bg-[color:color-mix(in_oklch,var(--accent)_6%,var(--bg))]'
                  }`}
                >
                  {/* Rank */}
                  <td className="px-4 py-4">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-label font-bold transition-all ${
                      isHovered
                        ? 'bg-[color:var(--accent)] text-[color:var(--accent-ink)]'
                        : 'bg-[color:var(--surface-2)] text-[color:var(--text-3)]'
                    }`}>
                      {ex.rank}
                    </div>
                  </td>

                  {/* Exchange Name */}
                  <td className="px-4 py-4">
                    <div className="font-semibold text-[color:var(--text)] group-hover:text-[color:var(--accent)] transition-colors">
                      {ex.name}
                    </div>
                  </td>

                  {/* Trading Pair */}
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-2">
                      <div className="px-2.5 py-1 rounded-sm bg-[color:var(--surface)] border border-[color:var(--line)] font-mono text-data text-[color:var(--text)]">
                        {ex.pair}
                      </div>
                    </div>
                  </td>

                  {/* Price */}
                  <td className="px-4 py-4 text-right">
                    <div className="font-mono font-semibold text-[color:var(--text)] text-data">
                      {ex.price}
                    </div>
                  </td>

                  {/* Order Book Depth */}
                  <td className="px-4 py-4 text-right">
                    <div className="font-mono text-label text-[color:var(--text-2)] space-y-0.5">
                      <div className="text-[color:var(--up)]">+ {ex.depth.split('/')[0]}</div>
                      <div className="text-[color:var(--down)]">- {ex.depth.split('/')[1]}</div>
                    </div>
                  </td>

                  {/* Volume */}
                  <td className="px-4 py-4 text-right">
                    <div className="font-mono font-semibold text-[color:var(--accent)]">
                      {ex.volume24h}
                    </div>
                  </td>

                  {/* Volume % */}
                  <td className="px-4 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className={`h-1.5 rounded-full bg-gradient-to-r ${volumeColor} to-transparent w-12`} />
                      <span className={`font-mono font-semibold text-label ${
                        volumeNum > 3
                          ? 'text-[color:var(--up)]'
                          : volumeNum > 1
                          ? 'text-[color:var(--accent)]'
                          : 'text-[color:var(--text-3)]'
                      }`}>
                        {ex.volumePercent}
                      </span>
                    </div>
                  </td>
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Premium Footer Stats */}
      <div className="px-6 py-4 border-t border-[color:var(--line)] bg-gradient-to-r from-[color:color-mix(in_oklch,var(--accent)_4%,var(--surface))] to-transparent">
        <div className="grid grid-cols-3 gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[color:var(--accent)] bg-opacity-10">
              <TrendingUp className="w-4 h-4 text-[color:var(--accent)]" />
            </div>
            <div>
              <div className="label text-[color:var(--text-3)]">Total 24h Volume</div>
              <div className="font-semibold text-[color:var(--text)]">$3.78B</div>
            </div>
          </div>
          <div>
            <div className="label text-[color:var(--text-3)]">Top Exchange</div>
            <div className="font-semibold text-[color:var(--text)]">Binance (35.4%)</div>
          </div>
          <div>
            <div className="label text-[color:var(--text-3)]">Price Range</div>
            <div className="font-semibold text-[color:var(--text)]">$63.8K - $64.6K</div>
          </div>
        </div>
      </div>
    </div>
  );
};
