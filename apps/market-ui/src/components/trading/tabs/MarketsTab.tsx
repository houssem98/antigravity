import React, { useState } from 'react';
import { motion } from 'motion/react';
import { BarChart3, Zap, Sparkles, AlertCircle, RefreshCw, Search, X, ArrowUpDown } from 'lucide-react';
import { HermesQueryPanel } from '../HermesQueryPanel';
import { useHermesPanel } from '../../../hooks/useHermesPanel';
import { useMarketsData } from '../../../hooks/useMarketsData';
import { useMarketsSort } from '../../../hooks/useMarketsSort';
import { useMarketsSearch } from '../../../hooks/useMarketsSearch';

interface MarketsTabProps {
  asset: string;
}

const SkeletonRow = () => (
  <tr className="border-b border-[color:var(--line)]">
    {Array.from({ length: 8 }).map((_, i) => (
      <td key={i} className="px-3 py-3">
        <div className="h-4 bg-[color:var(--surface-2)] rounded animate-pulse" />
      </td>
    ))}
  </tr>
);

export const MarketsTab: React.FC<MarketsTabProps> = ({ asset }) => {
  const [hoveredRank, setHoveredRank] = useState<number | null>(null);
  const [filter, setFilter] = useState<'all' | 'cex' | 'dex'>('all');
  const hermesPanel = useHermesPanel();
  const { data: marketsData, loading, error, refetch } = useMarketsData({ asset });

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

        {/* Search & Filter Row */}
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-[color:var(--text-3)]" />
            <input
              type="text"
              placeholder="Search exchange or pair..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-3 py-2 rounded-md bg-[color:var(--surface-2)] border border-[color:var(--line)] text-[color:var(--text)] placeholder-[color:var(--text-3)] focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-2.5 text-[color:var(--text-3)] hover:text-[color:var(--text)]"
              >
                <X className="w-4 h-4" />
              </button>
            )}
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
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="flex-1 px-6 py-8 flex items-center justify-center">
          <div className="text-center">
            <AlertCircle className="w-12 h-12 text-[color:var(--down)] mx-auto mb-3 opacity-50" />
            <p className="text-[color:var(--text-3)] mb-4">{error}</p>
            <button
              onClick={refetch}
              className="px-4 py-2 rounded-md bg-[color:var(--accent)] text-[color:var(--accent-ink)] hover:brightness-110 flex items-center gap-2 mx-auto"
            >
              <RefreshCw className="w-4 h-4" />
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      {!error && (
        <div className="flex-1 px-6 py-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[color:var(--line)] sticky top-0 bg-[color:var(--surface)]">
                <th className="px-3 py-3 text-left label font-semibold text-[color:var(--text-3)]">#</th>
                <th className="px-3 py-3 text-left label font-semibold text-[color:var(--text-3)]">Exchange</th>
                <th className="px-3 py-3 text-left label font-semibold text-[color:var(--text-3)]">Pair</th>
                <th
                  onClick={() => toggleSort('price')}
                  className="px-3 py-3 text-right label font-semibold text-[color:var(--text-3)] cursor-pointer hover:text-[color:var(--text-2)] transition-colors flex items-center justify-end gap-1"
                >
                  Price
                  {sortField === 'price' && (
                    <ArrowUpDown className={`w-4 h-4 ${sortOrder === 'asc' ? 'rotate-180' : ''}`} />
                  )}
                </th>
                <th className="px-3 py-3 text-right label font-semibold text-[color:var(--text-3)]">Bid / Ask Depth</th>
                <th
                  onClick={() => toggleSort('volume24h')}
                  className="px-3 py-3 text-right label font-semibold text-[color:var(--text-3)] cursor-pointer hover:text-[color:var(--text-2)] transition-colors flex items-center justify-end gap-1"
                >
                  Volume (24h)
                  {sortField === 'volume24h' && (
                    <ArrowUpDown className={`w-4 h-4 ${sortOrder === 'asc' ? 'rotate-180' : ''}`} />
                  )}
                </th>
                <th className="px-3 py-3 text-right label font-semibold text-[color:var(--text-3)]">Volume %</th>
                <th
                  onClick={() => toggleSort('liquidity')}
                  className="px-3 py-3 text-right label font-semibold text-[color:var(--text-3)] cursor-pointer hover:text-[color:var(--text-2)] transition-colors flex items-center justify-end gap-1"
                >
                  Liquidity
                  {sortField === 'liquidity' && (
                    <ArrowUpDown className={`w-4 h-4 ${sortOrder === 'asc' ? 'rotate-180' : ''}`} />
                  )}
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
                        className={`group transition-all duration-200 ${
                          isHovered
                            ? 'bg-gradient-to-r from-[color:color-mix(in_oklch,var(--accent)_10%,var(--surface))] to-transparent'
                            : 'hover:bg-[color:color-mix(in_oklch,var(--accent)_4%,var(--surface))]'
                        }`}
                      >
                        <td className="px-3 py-3 text-center">
                          <span className={`w-6 h-6 rounded-full inline-flex items-center justify-center text-label font-bold transition-all ${
                            isHovered
                              ? 'bg-[color:var(--accent)] text-[color:var(--accent-ink)]'
                              : 'bg-[color:var(--surface-2)] text-[color:var(--text-3)]'
                          }`}>
                            {ex.rank}
                          </span>
                        </td>

                        <td className="px-3 py-3">
                          <div className="font-medium text-[color:var(--text)] group-hover:text-[color:var(--accent)] transition-colors">
                            {ex.name}
                          </div>
                        </td>

                        <td className="px-3 py-3">
                          <div className="inline-block px-2 py-1 rounded-sm bg-[color:var(--surface-2)] border border-[color:var(--line)] font-mono text-data text-[color:var(--accent)]">
                            {ex.pair}
                          </div>
                        </td>

                        <td className="px-3 py-3 text-right">
                          <motion.div
                            initial={{ backgroundColor: 'transparent' }}
                            animate={{ backgroundColor: 'transparent' }}
                            className="font-mono font-semibold text-[color:var(--accent)] text-data relative"
                          >
                            {ex.price}
                            <motion.div
                              className="absolute inset-0 rounded pointer-events-none border border-[color:var(--accent)] opacity-0"
                              animate={{ opacity: [0.5, 0] }}
                              transition={{ duration: 0.6, repeat: Infinity, repeatDelay: 4 }}
                            />
                          </motion.div>
                        </td>

                        <td className="px-3 py-3 text-right">
                          <div className="font-mono text-data text-[color:var(--text-2)]">
                            <div className="flex items-center justify-end gap-1">
                              <div className="h-2 w-6 bg-[color:color-mix(in_oklch,var(--up)_20%,var(--surface))] rounded-full" />
                              <div className="text-[color:var(--up)]">{ex.depth.bid}</div>
                            </div>
                            <div className="flex items-center justify-end gap-1">
                              <div className="h-2 w-6 bg-[color:color-mix(in_oklch,var(--down)_20%,var(--surface))] rounded-full" />
                              <div className="text-[color:var(--down)]">{ex.depth.ask}</div>
                            </div>
                          </div>
                        </td>

                        <td className="px-3 py-3 text-right">
                          <div className="font-mono font-semibold text-[color:var(--accent)]">
                            {ex.volume24h}
                          </div>
                        </td>

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

                        <td className="px-3 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {Array.from({ length: 5 }).map((_, i) => {
                              const level = (i + 1) * 200;
                              const isActive = ex.liquidity >= level;
                              return (
                                <motion.div
                                  key={i}
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: 'auto', opacity: 1 }}
                                  transition={{ delay: i * 0.1 }}
                                  className={`w-1.5 h-4 rounded-sm transition-all ${
                                    isActive
                                      ? 'bg-gradient-to-t from-[color:var(--accent)] to-[color:var(--accent)]/70'
                                      : 'bg-[color:var(--surface-2)]'
                                  } ${isHovered ? 'brightness-125' : ''}`}
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
      <div className="px-6 py-4 border-t border-[color:var(--line)] bg-gradient-to-r from-[color:color-mix(in_oklch,var(--accent)_3%,var(--surface))] to-transparent">
        <div className="grid grid-cols-4 gap-4 text-sm">
          <div>
            <div className="label text-[color:var(--text-3)] mb-1">Total Volume</div>
            <div className="font-semibold text-[color:var(--text)]">—</div>
          </div>
          <div>
            <div className="label text-[color:var(--text-3)] mb-1">Top Exchange</div>
            <div className="font-semibold text-[color:var(--text)]">{marketsData?.exchanges?.[0]?.name || '—'}</div>
          </div>
          <div>
            <div className="label text-[color:var(--text-3)] mb-1">Avg Spread</div>
            <div className="font-semibold text-[color:var(--text)]">—</div>
          </div>
          <div>
            <div className="label text-[color:var(--text-3)] mb-1">Showing</div>
            <div className="font-semibold text-[color:var(--text)]">{filteredData.length} of {marketsData?.exchanges?.length || 0}</div>
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
