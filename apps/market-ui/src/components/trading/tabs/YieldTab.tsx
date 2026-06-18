import React, { useState } from 'react';
import { motion } from 'motion/react';

interface YieldProvider {
  rank: number;
  name: string;
  type: string;
  apy: string;
  defi: 'CeFi' | 'DeFi';
}

const YIELD_DATA: YieldProvider[] = [
  { rank: 0, name: 'Nexo', type: 'Earn (Locked), Earn (Flexi)', apy: '2.70%-6.20%', defi: 'CeFi' },
  { rank: 1, name: 'Binance', type: 'Earn (Flexi)', apy: '0.03%-0.28%', defi: 'CeFi' },
  { rank: 2, name: 'Bybit', type: 'Earn (Locked), Staking, Earn (Flexi)', apy: '0.10%-10.00%', defi: 'CeFi' },
  { rank: 3, name: 'Bitget', type: 'Earn (Locked), Earn (Flexi)', apy: '0.12%-5.00%', defi: 'CeFi' },
  { rank: 4, name: 'Gate', type: 'Earn (Locked), Staking, Earn (Flexi)', apy: '0.30%-10.30%', defi: 'CeFi' },
  { rank: 5, name: 'KuCoin', type: 'Earn (Locked), Earn (Flexi)', apy: '0.01%-0.50%', defi: 'CeFi' },
  { rank: 6, name: 'MEXC', type: 'Earn (Flexi)', apy: '0.50%-10.00%', defi: 'CeFi' },
];

interface YieldTabProps {
  asset: string;
}

export const YieldTab: React.FC<YieldTabProps> = ({ asset }) => {
  const [filter, setFilter] = useState<'all' | 'cefi' | 'defi'>('all');

  const filtered = YIELD_DATA.filter(p => {
    if (filter === 'all') return true;
    return p.defi === (filter === 'cefi' ? 'CeFi' : 'DeFi');
  });

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-[color:var(--bg)]">
      {/* Header with filters */}
      <div className="p-4 border-b border-[color:var(--line)] flex items-center gap-3">
        <span className="text-body font-semibold text-[color:var(--text)]">{asset} Yield</span>
        <div className="flex gap-2 ml-auto">
          {(['all', 'cefi', 'defi'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-sm text-label font-medium uppercase transition-colors ${
                filter === f
                  ? 'bg-[color:var(--accent)] text-[color:var(--accent-ink)]'
                  : 'bg-[color:var(--surface)] text-[color:var(--text-3)] hover:text-[color:var(--text)]'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Yield table */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-left">
          <thead className="sticky top-0 bg-[color:var(--surface-2)] border-b border-[color:var(--line)]">
            <tr>
              <th className="px-4 py-3 label text-[color:var(--text-3)]">#</th>
              <th className="px-4 py-3 label text-[color:var(--text-3)]">Service Provider</th>
              <th className="px-4 py-3 label text-[color:var(--text-3)]">Yield Type</th>
              <th className="px-4 py-3 label text-[color:var(--text-3)] text-right">Net APY</th>
              <th className="px-4 py-3 label text-[color:var(--text-3)] text-right">DeFi/CeFi</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((provider, idx) => (
              <motion.tr
                key={provider.rank}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: idx * 0.02 }}
                className="border-b border-[color:var(--line)] hover:bg-[color:var(--surface-2)] transition-colors"
              >
                <td className="px-4 py-3 text-data text-[color:var(--text-3)]">{provider.rank + 1}</td>
                <td className="px-4 py-3 text-body font-medium text-[color:var(--text)]">{provider.name}</td>
                <td className="px-4 py-3 text-label text-[color:var(--text-2)]">{provider.type}</td>
                <td className="px-4 py-3 text-data font-semibold text-[color:var(--up)] text-right">{provider.apy}</td>
                <td className="px-4 py-3 text-label text-right">
                  <span className={`px-2 py-1 rounded-sm text-[color:var(--text-3)] ${provider.defi === 'CeFi' ? 'bg-[color:var(--accent)]/10' : 'bg-[color:var(--up)]/10'}`}>
                    {provider.defi}
                  </span>
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
