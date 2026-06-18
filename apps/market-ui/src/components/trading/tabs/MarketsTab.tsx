import React from 'react';
import { motion } from 'motion/react';

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
  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-[color:var(--bg)]">
      <div className="p-4 border-b border-[color:var(--line)]">
        <h2 className="text-h3 font-semibold text-[color:var(--text)]">{asset} Markets</h2>
      </div>

      <div className="flex-1 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-[color:var(--surface-2)] border-b border-[color:var(--line)]">
            <tr>
              <th className="px-4 py-3 label text-[color:var(--text-3)]">#</th>
              <th className="px-4 py-3 label text-[color:var(--text-3)]">Exchange</th>
              <th className="px-4 py-3 label text-[color:var(--text-3)]">Pairs</th>
              <th className="px-4 py-3 label text-[color:var(--text-3)] text-right">Price</th>
              <th className="px-4 py-3 label text-[color:var(--text-3)] text-right">±2% / -2% Depth</th>
              <th className="px-4 py-3 label text-[color:var(--text-3)] text-right">Volume (24h)</th>
              <th className="px-4 py-3 label text-[color:var(--text-3)] text-right">Volume %</th>
            </tr>
          </thead>
          <tbody>
            {EXCHANGES_DATA.map((ex, idx) => (
              <motion.tr
                key={`${ex.rank}-${ex.pair}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: idx * 0.02 }}
                className="border-b border-[color:var(--line)] hover:bg-[color:var(--surface-2)] transition-colors"
              >
                <td className="px-4 py-3 text-data text-[color:var(--text-3)]">{ex.rank}</td>
                <td className="px-4 py-3 font-medium text-[color:var(--text)]">{ex.name}</td>
                <td className="px-4 py-3 font-mono text-[color:var(--text)] text-data">{ex.pair}</td>
                <td className="px-4 py-3 text-right font-mono text-[color:var(--text)]">{ex.price}</td>
                <td className="px-4 py-3 text-right font-mono text-label text-[color:var(--text-2)]">{ex.depth}</td>
                <td className="px-4 py-3 text-right font-mono text-[color:var(--up)]">{ex.volume24h}</td>
                <td className="px-4 py-3 text-right font-mono text-[color:var(--text-2)]">{ex.volumePercent}</td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
