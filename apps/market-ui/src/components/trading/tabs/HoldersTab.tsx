import React, { useState, useEffect } from 'react';
import { Loader, TrendingUp } from 'lucide-react';
import { motion } from 'motion/react';

interface Holder {
  rank: number;
  address: string;
  percentage: number;
  amount: string;
  value: string;
}

interface HoldersTabProps {
  asset: string;
}

// Mock data for holders - replace with real API data
const MOCK_HOLDERS: Record<string, Holder[]> = {
  BTC: [
    { rank: 1, address: '1A1z7zRa7sx6jHAkDALab39Yvm06pWfubE', percentage: 4.25, amount: '191,382 BTC', value: '$12.1B' },
    { rank: 2, address: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT', percentage: 3.12, amount: '140,405 BTC', value: '$8.9B' },
    { rank: 3, address: '3J98t1WpEZ73CNmYviecrnyiWrnqRhWNLy', percentage: 2.89, amount: '130,000 BTC', value: '$8.2B' },
    { rank: 4, address: '1LqBGSKuX5yYanrS4oJD9tgFEHKESWhxqR', percentage: 2.45, amount: '110,500 BTC', value: '$7.0B' },
    { rank: 5, address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', percentage: 2.12, amount: '95,360 BTC', value: '$6.0B' },
    { rank: 6, address: '1LCTTeQDF7jHnWUa3vPoC9s8BqDhfFQa5B', percentage: 1.78, amount: '80,200 BTC', value: '$5.1B' },
    { rank: 7, address: '1CounterpartyXXXXXXXXXXXXXXXUWLpeg', percentage: 1.56, amount: '70,300 BTC', value: '$4.5B' },
    { rank: 8, address: '1FEZzLnwwF1Tg7fZfcJXFrfFg4J6L1WXZs', percentage: 1.34, amount: '60,400 BTC', value: '$3.8B' },
  ],
  ETH: [
    { rank: 1, address: '0xDA9dfA130Df4dE4C41aB8ce9b6B6B9CF65bE1d26', percentage: 5.2, amount: '2,145,000 ETH', value: '$5.9B' },
    { rank: 2, address: '0x742d35Cc6634C0532925a3b844Bc9e7595f42AC', percentage: 4.1, amount: '1,680,000 ETH', value: '$4.6B' },
    { rank: 3, address: '0x0000000000000000000000000000000000000000', percentage: 3.8, amount: '1,560,000 ETH', value: '$4.3B' },
    { rank: 4, address: '0x1111111111111111111111111111111111111111', percentage: 3.2, amount: '1,312,000 ETH', value: '$3.6B' },
    { rank: 5, address: '0x47Ac0Fb4F2D84898b3cbB3c20a36f131d3d8B585', percentage: 2.7, amount: '1,106,000 ETH', value: '$3.0B' },
    { rank: 6, address: '0xd3CdA913deA6f330d7712f046d5e0974C7E52B6e', percentage: 2.3, amount: '944,000 ETH', value: '$2.6B' },
    { rank: 7, address: '0x1E4b6e2d1c1Ecf3d8f09C41eD8e5E5A61A4b8cD', percentage: 1.9, amount: '779,000 ETH', value: '$2.1B' },
    { rank: 8, address: '0xC02aaA39b223FE8D0A0e8e4F27ead9083C756Cc2', percentage: 1.6, amount: '656,000 ETH', value: '$1.8B' },
  ],
  SOL: [
    { rank: 1, address: 'So11111111111111111111111111111111111111112', percentage: 8.3, amount: '450,000,000 SOL', value: '$12.5B' },
    { rank: 2, address: '9B5X4z4zVe7K7K9K9K9K9K9K9K9K9K9K9K9K9K9', percentage: 6.1, amount: '330,000,000 SOL', value: '$9.1B' },
    { rank: 3, address: '8bvgxqhJi4k8PfZJVpv9VvVvVvVvVvVvVvVvVvVvV', percentage: 4.2, amount: '227,500,000 SOL', value: '$6.3B' },
  ],
};

export const HoldersTab: React.FC<HoldersTabProps> = ({ asset }) => {
  const [holders, setHolders] = useState<Holder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Simulate loading
    setTimeout(() => {
      const data = MOCK_HOLDERS[asset] || MOCK_HOLDERS.BTC;
      setHolders(data);
      setLoading(false);
    }, 500);
  }, [asset]);

  const formatPercentage = (pct: number) => pct.toFixed(2);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader className="w-6 h-6 text-[color:var(--text-3)] animate-spin" />
      </div>
    );
  }

  const totalHoldingPct = holders.reduce((sum, h) => sum + h.percentage, 0);

  return (
    <div className="flex flex-col h-full">
      {/* Summary stats */}
      <div className="p-4 border-b border-[color:var(--line)] bg-[color:var(--surface)]">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <div className="label text-[color:var(--text-3)] mb-1">Top 8 Holdings</div>
            <div className="text-h4 font-semibold text-[color:var(--text)]">{formatPercentage(totalHoldingPct)}%</div>
            <div className="text-label text-[color:var(--text-4)] mt-1">of total supply</div>
          </div>
          <div>
            <div className="label text-[color:var(--text-3)] mb-1">Holder Distribution</div>
            <div className="w-full h-2 bg-[color:var(--bg)] rounded-full overflow-hidden mt-2">
              <div
                className="h-full bg-gradient-to-r from-[color:var(--accent)] to-[color:var(--up)]"
                style={{ width: `${Math.min(100, totalHoldingPct)}%` }}
              />
            </div>
          </div>
          <div>
            <div className="label text-[color:var(--text-3)] mb-1">Concentration</div>
            <div className="text-h4 font-semibold text-[color:var(--text)]">
              {totalHoldingPct < 30 ? 'Low' : totalHoldingPct < 60 ? 'Medium' : 'High'}
            </div>
          </div>
        </div>
      </div>

      {/* Holders table */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-left border-collapse whitespace-nowrap">
          <thead className="sticky top-0">
            <tr className="border-b border-[color:var(--line)] bg-[color:var(--surface-2)]">
              <th className="py-3 px-4 label text-[color:var(--text-3)] font-semibold text-right">Rank</th>
              <th className="py-3 px-4 label text-[color:var(--text-3)] font-semibold">Address</th>
              <th className="py-3 px-4 label text-[color:var(--text-3)] font-semibold text-right">Percentage</th>
              <th className="py-3 px-4 label text-[color:var(--text-3)] font-semibold text-right">Amount</th>
              <th className="py-3 px-4 label text-[color:var(--text-3)] font-semibold text-right">Value</th>
            </tr>
          </thead>
          <tbody>
            {holders.map((holder, idx) => (
              <motion.tr
                key={holder.address}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: idx * 0.03 }}
                className="border-b border-[color:var(--line)] hover:bg-[color:var(--surface-2)] transition-colors"
              >
                <td className="py-3 px-4 text-data text-[color:var(--text-3)] text-right font-mono">{holder.rank}</td>
                <td className="py-3 px-4">
                  <code className="text-label font-mono text-[color:var(--text)] bg-[color:var(--bg)] px-2 py-1 rounded-sm">
                    {holder.address.slice(0, 10)}...{holder.address.slice(-8)}
                  </code>
                </td>
                <td className="py-3 px-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-24 h-1.5 bg-[color:var(--line)] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[color:var(--accent)]"
                        style={{ width: `${Math.min(100, (holder.percentage / Math.max(totalHoldingPct, 10)) * 100)}%` }}
                      />
                    </div>
                    <span className="text-data font-mono text-[color:var(--text)]">{formatPercentage(holder.percentage)}%</span>
                  </div>
                </td>
                <td className="py-3 px-4 text-right text-data font-mono text-[color:var(--text-2)]">{holder.amount}</td>
                <td className="py-3 px-4 text-right text-data font-mono font-semibold text-[color:var(--up)]">{holder.value}</td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
