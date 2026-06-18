import React from 'react';
import { motion } from 'motion/react';

interface Holder {
  rank: number;
  address: string;
  percentage: number;
  amount: string;
  value: string;
}

const HOLDERS_DATA: Holder[] = [
  { rank: 1, address: '1A1z7zRa7sx6jHAkDALab39Yvm06pWfubE', percentage: 4.25, amount: '191,382 BTC', value: '$12.1B' },
  { rank: 2, address: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT', percentage: 3.12, amount: '140,405 BTC', value: '$8.9B' },
  { rank: 3, address: '3J98t1WpEZ73CNmYviecrnyiWrnqRhWNLy', percentage: 2.89, amount: '130,000 BTC', value: '$8.2B' },
  { rank: 4, address: '1LqBGSKuX5yYanrS4oJD9tgFEHKESWhxqR', percentage: 2.45, amount: '110,500 BTC', value: '$7.0B' },
  { rank: 5, address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', percentage: 2.12, amount: '95,360 BTC', value: '$6.0B' },
];

interface HoldersTabProps {
  asset: string;
}

export const HoldersTab: React.FC<HoldersTabProps> = ({ asset }) => {
  const totalPct = HOLDERS_DATA.reduce((sum, h) => sum + h.percentage, 0);

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-[color:var(--bg)]">
      {/* Stats */}
      <div className="p-4 border-b border-[color:var(--line)] grid grid-cols-3 gap-4">
        <div>
          <div className="label text-[color:var(--text-3)] mb-1">Top 5 Holdings</div>
          <div className="text-h3 font-semibold text-[color:var(--text)]">{totalPct.toFixed(1)}%</div>
          <div className="text-label text-[color:var(--text-4)]">of total supply</div>
        </div>
        <div>
          <div className="label text-[color:var(--text-3)] mb-1">Distribution</div>
          <div className="w-full h-2 bg-[color:var(--line)] rounded-full overflow-hidden mt-2">
            <div
              className="h-full bg-gradient-to-r from-[color:var(--accent)] to-[color:var(--up)]"
              style={{ width: `${Math.min(100, totalPct)}%` }}
            />
          </div>
        </div>
        <div>
          <div className="label text-[color:var(--text-3)] mb-1">Concentration</div>
          <div className="text-h3 font-semibold text-[color:var(--text)]">
            {totalPct < 30 ? 'Low' : totalPct < 60 ? 'Medium' : 'High'}
          </div>
        </div>
      </div>

      {/* Holders table */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-[color:var(--surface-2)] border-b border-[color:var(--line)]">
            <tr>
              <th className="px-4 py-3 label text-[color:var(--text-3)] text-right">Rank</th>
              <th className="px-4 py-3 label text-[color:var(--text-3)]">Address</th>
              <th className="px-4 py-3 label text-[color:var(--text-3)] text-right">Percentage</th>
              <th className="px-4 py-3 label text-[color:var(--text-3)] text-right">Amount</th>
              <th className="px-4 py-3 label text-[color:var(--text-3)] text-right">Value</th>
            </tr>
          </thead>
          <tbody>
            {HOLDERS_DATA.map((holder, idx) => (
              <motion.tr
                key={holder.address}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: idx * 0.03 }}
                className="border-b border-[color:var(--line)] hover:bg-[color:var(--surface-2)] transition-colors"
              >
                <td className="px-4 py-3 text-data text-[color:var(--text-3)] text-right">{holder.rank}</td>
                <td className="px-4 py-3">
                  <code className="text-label font-mono text-[color:var(--text-2)] bg-[color:var(--bg)] px-2 py-1 rounded-sm">
                    {holder.address.slice(0, 10)}...{holder.address.slice(-8)}
                  </code>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-16 h-1.5 bg-[color:var(--line)] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[color:var(--accent)]"
                        style={{ width: `${Math.min(100, (holder.percentage / 5) * 100)}%` }}
                      />
                    </div>
                    <span className="text-data font-mono text-[color:var(--text)]">{holder.percentage.toFixed(2)}%</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-right text-data font-mono text-[color:var(--text-2)]">{holder.amount}</td>
                <td className="px-4 py-3 text-right text-data font-mono font-semibold text-[color:var(--up)]">{holder.value}</td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
