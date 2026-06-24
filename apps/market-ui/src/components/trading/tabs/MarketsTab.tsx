import React, { useState } from 'react';
import { motion } from 'motion/react';
import { BarChart3, Zap, Sparkles, AlertCircle, RefreshCw, Search, X, ArrowUpDown } from 'lucide-react';
import { HermesQueryPanel } from '../HermesQueryPanel';
import { useHermesPanel } from '../../../hooks/useHermesPanel';
import { useMarketsWebSocket } from '../../../hooks/useMarketsWebSocket';
import { useMarketsSort } from '../../../hooks/useMarketsSort';
import { useMarketsSearch } from '../../../hooks/useMarketsSearch';

interface MarketsTabProps {
  asset: string;
}

const SkeletonRow = () => (
  <tr className="border-b border-[color:var(--line)]">
    {Array.from({ length: 8 }).map((_, i) => (
      <td key={i} className="px-4 py-4">
        <div className="h-4 bg-[color:var(--surface-2)] rounded-md animate-pulse" />
      </td>
    ))}
  </tr>
);

export const MarketsTab: React.FC<MarketsTabProps> = ({ asset }) => {
  const [hoveredRank, setHoveredRank] = useState<number | null>(null);
  const [filter, setFilter] = useState<'all' | 'cex' | 'dex'>('all');
  const hermesPanel = useHermesPanel();
  const { data: marketsData, loading, error } = useMarketsWebSocket({ asset });

  const [searchQuery, setSearchQuery] = useState('');

  const typeFiltered = (marketsData?.exchanges || []).filter(ex => {
    if (filter === 'all') return true;
    const cexNames = ['Binance', 'Coinbase', 'Kraken', 'OKX', 'Bybit', 'Bitget', 'Upbit'];
    const isCEX = cexNames.some(name => ex.name.includes(name));
    if (filter === 'cex') return isCEX;
    if (filter === 'dex') return !isCEX;
    return true;
  });

  const searchFiltered = typeFiltered.filter(ex => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return ex.name.toLowerCase().includes(q) || ex.pair.toLowerCase().includes(q);
  });

  const { sorted: filteredData, sortField, sortOrder, toggleSort } = useMarketsSort(searchFiltered);

  return (
    <div className="flex flex-col flex-1 overflow-y-auto bg-gradient-to-b from-[color:var(--bg)] via-[color:var(--bg)] to-[color:color-mix(in_oklch,var(--accent)_2%,var(--bg))]">
      {/* Header with Filters */}
      <div className="sticky top-0 z-30 px-8 py-6 border-b border-[color:var(--line)] bg-[color:var(--surface)] bg-opacity-95 backdrop-blur-xl">
        {/* Title Section */}
        <div className="flex items-end justify-between mb-6">
          <div className="flex items-end gap-4">
            <div className="p-3 rounded-xl bg-gradient-to-br from-[color:var(--accent)] via-[color:color-mix(in_oklch,var(--accent)_85%,transparent)] to-[color:color-mix(in_oklch,var(--accent)_60%,transparent)] shadow-lg shadow-[color:var(--accent)]/25">
              <BarChart3 className="w-6 h-6 text-[color:var(--accent-ink)]" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-[color:var(--text)] tracking-tight">{asset} Markets</h2>
              <p className="text-sm text-[color:var(--text-3)] mt-1.5 font-medium">Real-time exchange data • 24h metrics</p>
            </div>
          </div>
        </div>

        {/* Control Row */}
        <div className="flex items-center gap-3">
          {/* Search Bar */}
          <div className="flex-1 relative max-w-md">
            <Search className="absolute left-4 top-3 w-4 h-4 text-[color:var(--text-3)]" />
            <input
              type="text"
              placeholder="Search exchange or pair..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-[color:var(--surface-2)] border border-[color:var(--line)] text-[color:var(--text)] text-sm placeholder-[color:var(--text-3)] focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/50 transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-4 top-3 text-[color:var(--text-3)] hover:text-[color:var(--text)] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Filter Buttons */}
          <div className="flex items-center gap-2">
            {['All', 'CEX', 'DEX'].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f.toLowerCase() as any)}
                className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                  filter === f.toLowerCase()
                    ? 'bg-[color:var(--accent)] text-[color:var(--accent-ink)] shadow-lg shadow-[color:var(--accent)]/25 font-semibold'
                    : 'bg-[color:var(--surface-2)] text-[color:var(--text-3)] border border-[color:var(--line)] hover:bg-[color:var(--surface)] hover:text-[color:var(--text-2)] hover:border-[color:var(--accent)]/30'
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Ask Hermes Button */}
          <button
            onClick={() => hermesPanel.openPanel({ exchanges: filteredData, asset })}
            className="ml-auto px-4 py-2.5 rounded-lg text-sm font-semibold bg-gradient-to-r from-[color:var(--accent)] via-[color:var(--accent)] to-[color:color-mix(in_oklch,var(--accent)_80%,transparent)] text-[color:var(--accent-ink)] hover:shadow-xl hover:shadow-[color:var(--accent)]/30 transition-all duration-200 flex items-center gap-2 whitespace-nowrap"
          >
            <Sparkles className="w-4 h-4" />
            Ask Hermes
          </button>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="flex-1 px-6 py-8 flex items-center justify-center">
          <div className="text-center">
            <AlertCircle className="w-12 h-12 text-[color:var(--down)] mx-auto mb-3 opacity-50" />
            <p className="text-[color:var(--text-3)]">{error}</p>
            <p className="text-[color:var(--text-3)] text-sm mt-2">(WebSocket reconnecting...)</p>
          </div>
        </div>
      )}

      {/* Table */}
      {!error && (
        <div className="flex-1 px-8 py-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-[color:var(--line)] sticky top-[70px] bg-[color:var(--surface)] bg-opacity-95 backdrop-blur-md">
                <th className="px-4 py-4 text-left text-xs font-bold text-[color:var(--text-3)] uppercase tracking-wider">#</th>
                <th className="px-4 py-4 text-left text-xs font-bold text-[color:var(--text-3)] uppercase tracking-wider">Exchange</th>
                <th className="px-4 py-4 text-left text-xs font-bold text-[color:var(--text-3)] uppercase tracking-wider">Pair</th>
                <th
                  onClick={() => toggleSort('price')}
                  className="px-4 py-4 text-right text-xs font-bold text-[color:var(--text-3)] uppercase tracking-wider cursor-pointer hover:text-[color:var(--accent)] transition-colors flex items-center justify-end gap-2 group"
                >
                  Price
                  {sortField === 'price' && (
                    <ArrowUpDown className={`w-4 h-4 text-[color:var(--accent)] ${sortOrder === 'asc' ? 'rotate-180' : ''}`} />
                  )}
                  {sortField !== 'price' && <ArrowUpDown className="w-4 h-4 opacity-0 group-hover:opacity-30 transition-opacity" />}
                </th>
                <th className="px-4 py-4 text-right text-xs font-bold text-[color:var(--text-3)] uppercase tracking-wider">Depth</th>
                <th
                  onClick={() => toggleSort('volume24h')}
                  className="px-4 py-4 text-right text-xs font-bold text-[color:var(--text-3)] uppercase tracking-wider cursor-pointer hover:text-[color:var(--accent)] transition-colors flex items-center justify-end gap-2 group"
                >
                  Volume (24h)
                  {sortField === 'volume24h' && (
                    <ArrowUpDown className={`w-4 h-4 text-[color:var(--accent)] ${sortOrder === 'asc' ? 'rotate-180' : ''}`} />
                  )}
                  {sortField !== 'volume24h' && <ArrowUpDown className="w-4 h-4 opacity-0 group-hover:opacity-30 transition-opacity" />}
                </th>
                <th className="px-4 py-4 text-right text-xs font-bold text-[color:var(--text-3)] uppercase tracking-wider">Volume %</th>
                <th
                  onClick={() => toggleSort('liquidity')}
                  className="px-4 py-4 text-right text-xs font-bold text-[color:var(--text-3)] uppercase tracking-wider cursor-pointer hover:text-[color:var(--accent)] transition-colors flex items-center justify-end gap-2 group"
                >
                  Liquidity
                  {sortField === 'liquidity' && (
                    <ArrowUpDown className={`w-4 h-4 text-[color:var(--accent)] ${sortOrder === 'asc' ? 'rotate-180' : ''}`} />
                  )}
                  {sortField !== 'liquidity' && <ArrowUpDown className="w-4 h-4 opacity-0 group-hover:opacity-30 transition-opacity" />}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--line)]">
              {loading
                ? Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
                : filteredData.map((ex, idx) => {
                    const isHovered = hoveredRank === ex.rank;
                    const volumeNum = parseFloat(ex.volumePercent.replace('%', ''));

                    return (
                      <motion.tr
                        key={`${ex.rank}-${ex.pair}`}
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.02 }}
                        onMouseEnter={() => setHoveredRank(ex.rank)}
                        onMouseLeave={() => setHoveredRank(null)}
                        className={`group transition-all duration-300 ${
                          isHovered
                            ? 'bg-gradient-to-r from-[color:color-mix(in_oklch,var(--accent)_12%,var(--surface))] via-[color:color-mix(in_oklch,var(--accent)_6%,var(--surface))] to-transparent shadow-lg shadow-[color:var(--accent)]/10 border-l-2 border-l-[color:var(--accent)]'
                            : 'hover:bg-[color:color-mix(in_oklch,var(--accent)_5%,var(--surface))]'
                        }`}
                      >
                        <td className="px-4 py-4 text-center">
                          <span className={`w-7 h-7 rounded-full inline-flex items-center justify-center text-sm font-bold transition-all duration-200 ${
                            isHovered
                              ? 'bg-[color:var(--accent)] text-[color:var(--accent-ink)] shadow-lg shadow-[color:var(--accent)]/40'
                              : 'bg-[color:var(--surface-2)] text-[color:var(--text-3)]'
                          }`}>
                            {ex.rank}
                          </span>
                        </td>

                        <td className="px-4 py-4">
                          <div className="font-semibold text-[color:var(--text)] group-hover:text-[color:var(--accent)] transition-colors duration-200">
                            {ex.name}
                          </div>
                        </td>

                        <td className="px-4 py-4">
                          <div className="inline-block px-3 py-1.5 rounded-md bg-gradient-to-br from-[color:color-mix(in_oklch,var(--accent)_15%,var(--surface))] to-[color:color-mix(in_oklch,var(--accent)_8%,var(--surface))] border border-[color:var(--accent)]/30 font-mono text-xs font-semibold text-[color:var(--accent)] tracking-wide">
                            {ex.pair}
                          </div>
                        </td>

                        <td className="px-4 py-4 text-right">
                          <motion.div
                            initial={{ backgroundColor: 'transparent' }}
                            animate={{ backgroundColor: 'transparent' }}
                            className="font-mono font-bold text-[color:var(--accent)] text-sm relative"
                          >
                            {ex.price}
                            <motion.div
                              className="absolute inset-0 rounded pointer-events-none border border-[color:var(--accent)] opacity-0"
                              animate={{ opacity: [0.5, 0] }}
                              transition={{ duration: 0.6, repeat: Infinity, repeatDelay: 4 }}
                            />
                          </motion.div>
                        </td>

                        <td className="px-4 py-4 text-right">
                          <div className="font-mono text-xs text-[color:var(--text-2)] space-y-1">
                            <div className="flex items-center justify-end gap-2">
                              <div className="h-2 w-8 bg-[color:color-mix(in_oklch,var(--up)_25%,var(--surface))] rounded-full" />
                              <div className="text-[color:var(--up)] font-semibold w-16 text-right">{ex.depth.bid}</div>
                            </div>
                            <div className="flex items-center justify-end gap-2">
                              <div className="h-2 w-8 bg-[color:color-mix(in_oklch,var(--down)_25%,var(--surface))] rounded-full" />
                              <div className="text-[color:var(--down)] font-semibold w-16 text-right">{ex.depth.ask}</div>
                            </div>
                          </div>
                        </td>

                        <td className="px-4 py-4 text-right">
                          <div className="font-mono font-bold text-[color:var(--accent)] text-sm">
                            {ex.volume24h}
                          </div>
                        </td>

                        <td className="px-4 py-4 text-right">
                          <div className="flex items-center justify-end gap-3">
                            <div className="h-2 w-14 bg-[color:var(--surface-2)] rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-300 ${
                                  volumeNum > 3
                                    ? 'bg-gradient-to-r from-[color:var(--up)] to-[color:var(--up)]/70'
                                    : volumeNum > 1
                                    ? 'bg-gradient-to-r from-[color:var(--accent)] to-[color:var(--accent)]/70'
                                    : 'bg-[color:var(--text-3)]/50'
                                }`}
                                style={{ width: `${Math.min(100, volumeNum * 20)}%` }}
                              />
                            </div>
                            <span className={`font-mono font-bold text-sm w-12 text-right ${
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

                        <td className="px-4 py-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {Array.from({ length: 5 }).map((_, i) => {
                              const level = (i + 1) * 200;
                              const isActive = ex.liquidity >= level;
                              return (
                                <motion.div
                                  key={i}
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: 'auto', opacity: 1 }}
                                  transition={{ delay: i * 0.08 }}
                                  className={`w-2 h-5 rounded-sm transition-all duration-200 ${
                                    isActive
                                      ? 'bg-gradient-to-t from-[color:var(--accent)] via-[color:var(--accent)]/85 to-[color:var(--accent)]/70 shadow-md shadow-[color:var(--accent)]/40'
                                      : 'bg-[color:var(--surface-2)]'
                                  } ${isHovered && isActive ? 'brightness-125' : ''}`}
                                />
                              );
                            })}
                          </div>
                        </td>
                      </motion.tr>
                    );
                  })}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer Stats */}
      <div className="px-8 py-6 border-t border-[color:var(--line)] bg-gradient-to-r from-[color:color-mix(in_oklch,var(--accent)_5%,var(--surface))] via-[color:color-mix(in_oklch,var(--accent)_2%,var(--surface))] to-[color:var(--surface)]">
        <div className="grid grid-cols-4 gap-6">
          <div className="group">
            <div className="text-xs font-bold text-[color:var(--text-3)] uppercase tracking-wider mb-2">Total Volume</div>
            <div className="font-bold text-[color:var(--accent)] text-lg group-hover:text-[color:var(--accent)] transition-colors">—</div>
          </div>
          <div className="group">
            <div className="text-xs font-bold text-[color:var(--text-3)] uppercase tracking-wider mb-2">Top Exchange</div>
            <div className="font-bold text-[color:var(--text)] text-lg group-hover:text-[color:var(--accent)] transition-colors">{marketsData?.exchanges?.[0]?.name || '—'}</div>
          </div>
          <div className="group">
            <div className="text-xs font-bold text-[color:var(--text-3)] uppercase tracking-wider mb-2">Avg Spread</div>
            <div className="font-bold text-[color:var(--text)] text-lg group-hover:text-[color:var(--accent)] transition-colors">—</div>
          </div>
          <div className="group">
            <div className="text-xs font-bold text-[color:var(--text-3)] uppercase tracking-wider mb-2">Showing</div>
            <div className="font-bold text-[color:var(--accent)] text-lg">{filteredData.length} <span className="text-[color:var(--text-3)] text-base">of {marketsData?.exchanges?.length || 0}</span></div>
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
