import React, { useState } from 'react';
import { motion } from 'motion/react';
import { TrendingUp, BarChart3, Zap, Sparkles } from 'lucide-react';
import { HermesQueryPanel } from '../HermesQueryPanel';
import { useHermesPanel } from '../../../hooks/useHermesPanel';

interface Exchange {
  rank: number;
  name: string;
  icon?: string;
  pair: string;
  price: string;
  depth: string;
  volume24h: string;
  volumePercent: string;
  liquidity: number;
  type: 'CEX' | 'DEX';
}

const EXCHANGES_DATA: Exchange[] = [
  { rank: 1, name: 'Binance', pair: 'BTC/USDT', price: '$64,558.19', depth: '$16,614,755/$23,286,821', volume24h: '$1,234,712,430', volumePercent: '3.95%', liquidity: 791, type: 'CEX' },
  { rank: 2, name: 'Binance', pair: 'BTC/USDC', price: '$64,556.03', depth: '$3,773,721/$5,064,171', volume24h: '$422,907,420', volumePercent: '1.35%', liquidity: 749, type: 'CEX' },
  { rank: 3, name: 'Coinbase Exchange', pair: 'BTC/USD', price: '$64,568.02', depth: '$6,894,068/$12,279,087', volume24h: '$488,809,652', volumePercent: '1.57%', liquidity: 729, type: 'CEX' },
  { rank: 4, name: 'Upbit', pair: 'BTC/KRW', price: '$63,815.64', depth: '$156,077/$14,999', volume24h: '$77,858,859', volumePercent: '0.25%', liquidity: 563, type: 'CEX' },
  { rank: 5, name: 'Aster', pair: 'BTC/USDT', price: '$64,567.96', depth: '$225,813/$232,607', volume24h: '$1,479,287', volumePercent: '<0.01%', liquidity: 504, type: 'DEX' },
  { rank: 6, name: 'OKX', pair: 'BTC/USDT', price: '$64,567.31', depth: '$4,771,870/$4,880,593', volume24h: '$433,407,444', volumePercent: '1.39%', liquidity: 700, type: 'CEX' },
  { rank: 7, name: 'Bybit', pair: 'BTC/USDT', price: '$64,567.07', depth: '$17,603,400/$13,734,787', volume24h: '$1,143,488,292', volumePercent: '3.66%', liquidity: 565, type: 'CEX' },
  { rank: 8, name: 'Bitget', pair: 'BTC/USDT', price: '$64,560.14', depth: '$4,622,081/$3,841,568', volume24h: '$368,217,890', volumePercent: '1.18%', liquidity: 695, type: 'CEX' },
];

interface MarketsTabProps {
  asset: string;
}

export const MarketsTab: React.FC<MarketsTabProps> = ({ asset }) => {
  const [hoveredRank, setHoveredRank] = useState<number | null>(null);
  const [filter, setFilter] = useState<'all' | 'cex' | 'dex'>('all');
  const hermesPanel = useHermesPanel();

  const filteredData = EXCHANGES_DATA.filter(ex => {
    if (filter === 'all') return true;
    if (filter === 'cex') return ex.type === 'CEX';
    if (filter === 'dex') return ex.type === 'DEX';
    return true;
  });

  const getExchangeIcon = (name: string): string => {
    const icons: Record<string, string> = {
      'Binance': '⚡',
      'Coinbase Exchange': '👨‍💼',
      'Upbit': '🚀',
      'Aster': '🌟',
      'OKX': '🔶',
      'Bybit': '⚙️',
      'Bitget': '🔷',
    };
    return icons[name] || '📊';
  };

  return (
    <div className="flex flex-col flex-1 overflow-y-auto bg-gradient-to-b from-[color:var(--bg)] via-[color:var(--bg)] to-[color:color-mix(in_oklch,var(--accent)_2%,var(--bg))]">
      {/* Header with Filters */}
      <div className="sticky top-0 z-30 px-6 py-5 border-b border-[color:var(--line)] bg-[color:var(--surface)] bg-opacity-80 backdrop-blur-md">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-gradient-to-br from-[color:var(--accent)] to-[color:color-mix(in_oklch,var(--accent)_70%,transparent)]">
              <BarChart3 className="w-5 h-5 text-[color:var(--accent-ink)]" />
            </div>
            <div>
              <h2 className="text-h3 font-semibold text-[color:var(--text)]">{asset} Markets</h2>
              <p className="text-label text-[color:var(--text-3)] mt-0.5">Top exchanges by volume</p>
            </div>
          </div>
        </div>

        {/* Filter Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          {['All', 'CEX', 'DEX'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f.toLowerCase() as any)}
              className={`px-3 py-1.5 rounded-md text-label font-medium transition-all duration-200 ${
                filter === f.toLowerCase()
                  ? 'bg-[color:var(--accent)] text-[color:var(--accent-ink)] shadow-lg shadow-[color:var(--accent)]/20'
                  : 'bg-[color:var(--surface-2)] text-[color:var(--text-3)] hover:bg-[color:var(--surface)] hover:text-[color:var(--text-2)]'
              }`}
            >
              {f}
            </button>
          ))}
          <button
            onClick={() => hermesPanel.openPanel({ exchanges: filteredData, asset })}
            className="ml-auto px-3 py-1.5 rounded-md text-label font-medium bg-gradient-to-r from-[color:var(--accent)] to-[color:color-mix(in_oklch,var(--accent)_70%,transparent)] text-[color:var(--accent-ink)] hover:brightness-110 transition-all flex items-center gap-1 shadow-lg shadow-[color:var(--accent)]/20"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Ask Hermes
          </button>
          <button className="px-3 py-1.5 rounded-md text-label font-medium bg-[color:var(--surface-2)] text-[color:var(--text-3)] hover:bg-[color:var(--surface)] transition-colors flex items-center gap-1">
            <Zap className="w-3.5 h-3.5" />
            Filters
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 px-6 py-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[color:var(--line)] sticky top-0">
              <th className="px-3 py-3 text-left label font-semibold text-[color:var(--text-3)]">#</th>
              <th className="px-3 py-3 text-left label font-semibold text-[color:var(--text-3)]">Exchange</th>
              <th className="px-3 py-3 text-left label font-semibold text-[color:var(--text-3)]">Pairs</th>
              <th className="px-3 py-3 text-right label font-semibold text-[color:var(--text-3)]">Price</th>
              <th className="px-3 py-3 text-right label font-semibold text-[color:var(--text-3)]">±2% / -2% Depth</th>
              <th className="px-3 py-3 text-right label font-semibold text-[color:var(--text-3)]">Volume (24h)</th>
              <th className="px-3 py-3 text-right label font-semibold text-[color:var(--text-3)]">Volume %</th>
              <th className="px-3 py-3 text-right label font-semibold text-[color:var(--text-3)]">Liquidity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[color:var(--line)]">
            {filteredData.map((ex, idx) => {
              const isHovered = hoveredRank === ex.rank;
              const volumeNum = parseFloat(ex.volumePercent);

              return (
                <motion.tr
                  key={`${ex.rank}-${ex.pair}`}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.02 }}
                  onMouseEnter={() => setHoveredRank(ex.rank)}
                  onMouseLeave={() => setHoveredRank(null)}
                  className={`group transition-all duration-200 ${
                    isHovered
                      ? 'bg-gradient-to-r from-[color:color-mix(in_oklch,var(--accent)_10%,var(--surface))] to-transparent'
                      : 'hover:bg-[color:color-mix(in_oklch,var(--accent)_4%,var(--surface))]'
                  }`}
                >
                  {/* Rank */}
                  <td className="px-3 py-3 text-center">
                    <span className={`w-6 h-6 rounded-full inline-flex items-center justify-center text-label font-bold transition-all ${
                      isHovered
                        ? 'bg-[color:var(--accent)] text-[color:var(--accent-ink)]'
                        : 'bg-[color:var(--surface-2)] text-[color:var(--text-3)]'
                    }`}>
                      {ex.rank}
                    </span>
                  </td>

                  {/* Exchange with Icon */}
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-[color:var(--surface-2)] flex items-center justify-center text-body group-hover:bg-[color:var(--accent)] group-hover:text-[color:var(--accent-ink)] transition-colors">
                        {getExchangeIcon(ex.name)}
                      </div>
                      <div>
                        <div className="font-medium text-[color:var(--text)] group-hover:text-[color:var(--accent)] transition-colors">
                          {ex.name}
                        </div>
                        <div className="text-label text-[color:var(--text-3)]">{ex.type}</div>
                      </div>
                    </div>
                  </td>

                  {/* Pair */}
                  <td className="px-3 py-3">
                    <div className="inline-block px-2 py-1 rounded-sm bg-[color:var(--surface-2)] border border-[color:var(--line)] font-mono text-data text-[color:var(--accent)]">
                      {ex.pair}
                    </div>
                  </td>

                  {/* Price */}
                  <td className="px-3 py-3 text-right">
                    <div className="font-mono font-semibold text-[color:var(--text)] text-data">
                      {ex.price}
                    </div>
                  </td>

                  {/* Depth */}
                  <td className="px-3 py-3 text-right">
                    <div className="font-mono text-data text-[color:var(--text-2)]">
                      <div className="text-[color:var(--up)]">{ex.depth.split('/')[0]}</div>
                      <div className="text-[color:var(--down)]">{ex.depth.split('/')[1]}</div>
                    </div>
                  </td>

                  {/* Volume */}
                  <td className="px-3 py-3 text-right">
                    <div className="font-mono font-semibold text-[color:var(--accent)]">
                      {ex.volume24h}
                    </div>
                  </td>

                  {/* Volume % with Bar */}
                  <td className="px-3 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="h-1.5 w-12 bg-[color:var(--surface-2)] rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            volumeNum > 3
                              ? 'bg-gradient-to-r from-[color:var(--up)] to-[color:var(--up)]/60'
                              : volumeNum > 1
                              ? 'bg-gradient-to-r from-[color:var(--accent)] to-[color:var(--accent)]/60'
                              : 'bg-[color:var(--text-3)]'
                          }`}
                          style={{ width: `${Math.min(100, volumeNum * 20)}%` }}
                        />
                      </div>
                      <span className={`font-mono font-semibold text-label w-10 ${
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

                  {/* Liquidity Bars */}
                  <td className="px-3 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <div
                          key={i}
                          className={`w-1 h-3 rounded-sm transition-all ${
                            i < Math.floor(ex.liquidity / 200)
                              ? 'bg-[color:var(--accent)]'
                              : 'bg-[color:var(--surface-2)]'
                          }`}
                        />
                      ))}
                    </div>
                  </td>
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer Stats */}
      <div className="px-6 py-4 border-t border-[color:var(--line)] bg-gradient-to-r from-[color:color-mix(in_oklch,var(--accent)_3%,var(--surface))] to-transparent">
        <div className="grid grid-cols-4 gap-4 text-sm">
          <div>
            <div className="label text-[color:var(--text-3)] mb-1">Total Volume</div>
            <div className="font-semibold text-[color:var(--text)]">$3.78B</div>
          </div>
          <div>
            <div className="label text-[color:var(--text-3)] mb-1">Top Exchange</div>
            <div className="font-semibold text-[color:var(--text)]">Binance</div>
          </div>
          <div>
            <div className="label text-[color:var(--text-3)] mb-1">Avg Spread</div>
            <div className="font-semibold text-[color:var(--text)]">0.12%</div>
          </div>
          <div>
            <div className="label text-[color:var(--text-3)] mb-1">Showing</div>
            <div className="font-semibold text-[color:var(--text)]">{filteredData.length} of {EXCHANGES_DATA.length}</div>
          </div>
        </div>
      </div>

      {/* Hermes Query Panel */}
      {hermesPanel.isOpen && (
        <HermesQueryPanel
          asset={asset}
          context={hermesPanel.selectedContext}
          onClose={hermesPanel.closePanel}
        />
      )}
    </div>
  );
};
