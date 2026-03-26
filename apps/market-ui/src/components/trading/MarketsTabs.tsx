import React, { useState } from 'react';
import { motion } from 'motion/react';
import { TrendingUp, TrendingDown, ArrowRight, ArrowRightLeft } from 'lucide-react';

const formatCurrency = (value: number) => {
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
};

export const CategoriesTab = () => {
  const categories = [
    { name: 'Smart Contract Platform', marketCap: 450000000000, volume: 25000000000, change: 2.5, topCoins: ['ETH', 'SOL', 'ADA'] },
    { name: 'DeFi', marketCap: 85000000000, volume: 5000000000, change: -1.2, topCoins: ['UNI', 'LINK', 'AAVE'] },
    { name: 'Meme', marketCap: 40000000000, volume: 8000000000, change: 15.4, topCoins: ['DOGE', 'SHIB', 'PEPE'] },
    { name: 'Layer 2', marketCap: 35000000000, volume: 3000000000, change: 5.1, topCoins: ['MATIC', 'OP', 'ARB'] },
    { name: 'Gaming', marketCap: 15000000000, volume: 1500000000, change: 0.8, topCoins: ['IMX', 'SAND', 'MANA'] },
    { name: 'AI & Big Data', marketCap: 25000000000, volume: 4000000000, change: 8.7, topCoins: ['RNDR', 'FET', 'AGIX'] },
  ];

  return (
    <div className="w-full">
      <table className="w-full text-left border-collapse whitespace-nowrap">
        <thead>
          <tr className="border-b border-[#1F2937] text-gray-400 text-xs uppercase tracking-wider bg-[#111827]/80 backdrop-blur-md">
            <th className="py-4 px-6 font-bold">Category</th>
            <th className="py-4 px-6 font-bold text-right">Market Cap</th>
            <th className="py-4 px-6 font-bold text-right">Volume (24h)</th>
            <th className="py-4 px-6 font-bold text-right">Change (24h)</th>
            <th className="py-4 px-6 font-bold">Top Coins</th>
          </tr>
        </thead>
        <tbody>
          {categories.map((cat, index) => (
            <motion.tr 
              key={cat.name}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: index * 0.05 }}
              className="border-b border-[#1F2937]/50 hover:bg-[#1F2937]/50 transition-colors cursor-pointer"
            >
              <td className="py-4 px-6 font-bold text-white">{cat.name}</td>
              <td className="py-4 px-6 text-right font-mono text-gray-300">{formatCurrency(cat.marketCap)}</td>
              <td className="py-4 px-6 text-right font-mono text-gray-300">{formatCurrency(cat.volume)}</td>
              <td className={`py-4 px-6 text-right font-mono font-medium ${cat.change >= 0 ? 'text-[#00E676]' : 'text-[#FF1744]'}`}>
                <div className="flex items-center justify-end gap-1">
                  {cat.change >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {Math.abs(cat.change).toFixed(2)}%
                </div>
              </td>
              <td className="py-4 px-6">
                <div className="flex items-center gap-2">
                  {cat.topCoins.map(coin => (
                    <span key={coin} className="text-xs font-medium text-gray-400 bg-[#1F2937] px-2 py-1 rounded-md">{coin}</span>
                  ))}
                </div>
              </td>
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export const ExchangesTab = () => {
  const exchanges = [
    { name: 'Binance', score: 9.9, volume: 15000000000, markets: 1200, coins: 350 },
    { name: 'Coinbase Exchange', score: 8.5, volume: 2500000000, markets: 500, coins: 200 },
    { name: 'Kraken', score: 8.2, volume: 1000000000, markets: 600, coins: 220 },
    { name: 'KuCoin', score: 7.8, volume: 800000000, markets: 1100, coins: 600 },
    { name: 'OKX', score: 7.5, volume: 1200000000, markets: 700, coins: 300 },
  ];

  return (
    <div className="w-full">
      <table className="w-full text-left border-collapse whitespace-nowrap">
        <thead>
          <tr className="border-b border-[#1F2937] text-gray-400 text-xs uppercase tracking-wider bg-[#111827]/80 backdrop-blur-md">
            <th className="py-4 px-6 font-bold">Exchange</th>
            <th className="py-4 px-6 font-bold text-center">Trust Score</th>
            <th className="py-4 px-6 font-bold text-right">Volume (24h)</th>
            <th className="py-4 px-6 font-bold text-right">Markets</th>
            <th className="py-4 px-6 font-bold text-right">Coins</th>
          </tr>
        </thead>
        <tbody>
          {exchanges.map((ex, index) => (
            <motion.tr 
              key={ex.name}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: index * 0.05 }}
              className="border-b border-[#1F2937]/50 hover:bg-[#1F2937]/50 transition-colors cursor-pointer"
            >
              <td className="py-4 px-6 font-bold text-white flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-[#1F2937] flex items-center justify-center text-xs text-gray-400">{ex.name.charAt(0)}</div>
                {ex.name}
              </td>
              <td className="py-4 px-6 text-center">
                <span className="bg-green-500/20 text-green-400 px-2 py-1 rounded-md font-bold text-sm">{ex.score}</span>
              </td>
              <td className="py-4 px-6 text-right font-mono text-gray-300">{formatCurrency(ex.volume)}</td>
              <td className="py-4 px-6 text-right font-mono text-gray-400">{ex.markets}</td>
              <td className="py-4 px-6 text-right font-mono text-gray-400">{ex.coins}</td>
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export const NFTsTab = () => {
  const nfts = [
    { name: 'Bored Ape Yacht Club', floorPrice: 15.5, volume: 1200, change: 5.2, items: 10000 },
    { name: 'CryptoPunks', floorPrice: 45.2, volume: 800, change: -2.1, items: 10000 },
    { name: 'Mutant Ape Yacht Club', floorPrice: 3.2, volume: 500, change: 1.5, items: 20000 },
    { name: 'Azuki', floorPrice: 4.8, volume: 300, change: -0.5, items: 10000 },
    { name: 'Pudgy Penguins', floorPrice: 12.1, volume: 900, change: 12.4, items: 8888 },
  ];

  return (
    <div className="w-full">
      <table className="w-full text-left border-collapse whitespace-nowrap">
        <thead>
          <tr className="border-b border-[#1F2937] text-gray-400 text-xs uppercase tracking-wider bg-[#111827]/80 backdrop-blur-md">
            <th className="py-4 px-6 font-bold">Collection</th>
            <th className="py-4 px-6 font-bold text-right">Floor Price (ETH)</th>
            <th className="py-4 px-6 font-bold text-right">Volume (24h ETH)</th>
            <th className="py-4 px-6 font-bold text-right">Change (24h)</th>
            <th className="py-4 px-6 font-bold text-right">Items</th>
          </tr>
        </thead>
        <tbody>
          {nfts.map((nft, index) => (
            <motion.tr 
              key={nft.name}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: index * 0.05 }}
              className="border-b border-[#1F2937]/50 hover:bg-[#1F2937]/50 transition-colors cursor-pointer"
            >
              <td className="py-4 px-6 font-bold text-white flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#1F2937] flex items-center justify-center text-xs text-gray-400">{nft.name.charAt(0)}</div>
                {nft.name}
              </td>
              <td className="py-4 px-6 text-right font-mono text-gray-300">{nft.floorPrice.toFixed(2)} ETH</td>
              <td className="py-4 px-6 text-right font-mono text-gray-300">{nft.volume.toLocaleString()} ETH</td>
              <td className={`py-4 px-6 text-right font-mono font-medium ${nft.change >= 0 ? 'text-[#00E676]' : 'text-[#FF1744]'}`}>
                <div className="flex items-center justify-end gap-1">
                  {nft.change >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {Math.abs(nft.change).toFixed(2)}%
                </div>
              </td>
              <td className="py-4 px-6 text-right font-mono text-gray-400">{nft.items.toLocaleString()}</td>
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export const ConverterTab = () => {
  const [amount, setAmount] = useState('1');
  const [from, setFrom] = useState('BTC');
  const [to, setTo] = useState('USD');

  return (
    <div className="w-full p-8 flex flex-col items-center justify-center min-h-[400px]">
      <div className="bg-[#111827] border border-[#1F2937] rounded-2xl p-8 w-full max-w-md shadow-2xl">
        <h3 className="text-xl font-bold text-white mb-6 text-center">Cryptocurrency Converter</h3>
        
        <div className="space-y-4">
          <div className="bg-[#0B0E14] border border-[#1F2937] rounded-xl p-4">
            <label className="text-xs text-gray-400 font-medium mb-2 block">You Pay</label>
            <div className="flex items-center gap-4">
              <input 
                type="number" 
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="bg-transparent text-2xl font-mono text-white w-full focus:outline-none"
                placeholder="0.00"
              />
              <select 
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="bg-[#1F2937] text-white font-bold py-2 px-4 rounded-lg outline-none cursor-pointer"
              >
                <option value="BTC">BTC</option>
                <option value="ETH">ETH</option>
                <option value="SOL">SOL</option>
                <option value="USDT">USDT</option>
              </select>
            </div>
          </div>

          <div className="flex justify-center -my-2 relative z-10">
            <button 
              className="bg-[#2962FF] p-2 rounded-full border-4 border-[#111827] text-white hover:bg-blue-600 transition-colors"
              onClick={() => {
                setFrom(to);
                setTo(from);
              }}
            >
              <ArrowRightLeft className="w-5 h-5 rotate-90" />
            </button>
          </div>

          <div className="bg-[#0B0E14] border border-[#1F2937] rounded-xl p-4">
            <label className="text-xs text-gray-400 font-medium mb-2 block">You Get</label>
            <div className="flex items-center gap-4">
              <input 
                type="number" 
                value={from === 'BTC' && to === 'USD' ? Number(amount) * 65000 : 0} // Mock conversion
                readOnly
                className="bg-transparent text-2xl font-mono text-gray-400 w-full focus:outline-none"
                placeholder="0.00"
              />
              <select 
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="bg-[#1F2937] text-white font-bold py-2 px-4 rounded-lg outline-none cursor-pointer"
              >
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="BTC">BTC</option>
                <option value="ETH">ETH</option>
              </select>
            </div>
          </div>
        </div>

        <button className="w-full bg-[#2962FF] hover:bg-[#2962FF]/90 text-white font-bold py-4 rounded-xl mt-6 transition-all shadow-lg shadow-blue-900/20">
          Convert Now
        </button>
      </div>
    </div>
  );
};
