import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Briefcase, Plus, Trash2, X, TrendingUp, TrendingDown, RefreshCw } from 'lucide-react';
import { isCryptoAsset } from '../../constants/tradingAssets';

interface PortfolioItem {
  id: string;
  symbol: string;
  quantity: number;
  averagePrice: number;
}

interface QuoteData {
  [symbol: string]: {
    price: number;
    changePercent: number;
  };
}

export const PortfolioPanel: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [items, setItems] = useState<PortfolioItem[]>([]);
  const [quotes, setQuotes] = useState<QuoteData>({});
  const [loading, setLoading] = useState(false);
  
  // Form state
  const [newSymbol, setNewSymbol] = useState('');
  const [newQuantity, setNewQuantity] = useState('');
  const [newPrice, setNewPrice] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem('portfolio');
    if (saved) {
      try {
        setItems(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse portfolio', e);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('portfolio', JSON.stringify(items));
    if (items.length > 0) {
      fetchQuotes();
      const interval = setInterval(fetchQuotes, 10000);
      return () => clearInterval(interval);
    } else {
      setQuotes({});
    }
  }, [items]);

  const fetchQuotes = async () => {
    setLoading(true);
    try {
      const symbols = items.map(item => {
        const isCrypto = isCryptoAsset(item.symbol.toUpperCase());
        return isCrypto ? `${item.symbol.toUpperCase()}-USD` : item.symbol.toUpperCase();
      }).join(',');

      const res = await fetch(`/api/quote?symbols=${symbols}`);
      if (!res.ok) throw new Error('Failed to fetch quotes');
      const data = await res.json();
      
      const newQuotes: QuoteData = {};
      if (data.quoteResponse && data.quoteResponse.result) {
        data.quoteResponse.result.forEach((quote: any) => {
          let sym = quote.symbol;
          if (sym.endsWith('-USD')) sym = sym.replace('-USD', '');
          newQuotes[sym] = {
            price: quote.regularMarketPrice,
            changePercent: quote.regularMarketChangePercent
          };
        });
      }
      setQuotes(newQuotes);
    } catch (err) {
      console.error("Error fetching quotes:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSymbol || !newQuantity || !newPrice) return;
    
    const newItem: PortfolioItem = {
      id: Date.now().toString(),
      symbol: newSymbol.toUpperCase(),
      quantity: parseFloat(newQuantity),
      averagePrice: parseFloat(newPrice),
    };
    
    setItems([...items, newItem]);
    setNewSymbol('');
    setNewQuantity('');
    setNewPrice('');
  };

  const handleRemoveItem = (id: string) => {
    setItems(items.filter(item => item.id !== id));
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
  };

  const formatPercent = (value: number) => {
    return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
  };

  let totalValue = 0;
  let totalCost = 0;

  items.forEach(item => {
    const quote = quotes[item.symbol];
    const currentPrice = quote ? quote.price : item.averagePrice;
    totalValue += currentPrice * item.quantity;
    totalCost += item.averagePrice * item.quantity;
  });

  const totalPL = totalValue - totalCost;
  const totalPLPercent = totalCost > 0 ? (totalPL / totalCost) * 100 : 0;

  return (
    <>
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 left-6 p-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full shadow-[0_0_20px_rgba(79,70,229,0.4)] transition-colors z-40 flex items-center justify-center"
        title="Portfolio Tracker"
      >
        <Briefcase className="w-6 h-6" />
      </motion.button>

      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="bg-gradient-to-b from-[#1e222d] to-[#131722] border border-gray-800 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden relative"
            >
              {/* Decorative glow */}
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-lg h-32 bg-indigo-500/20 blur-[100px] pointer-events-none" />
              
              {/* Header */}
              <div className="flex items-center justify-between p-6 border-b border-gray-800/50 bg-[#131722]/50 backdrop-blur-md relative z-10">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-indigo-500/20 rounded-xl shadow-inner">
                    <Briefcase className="w-6 h-6 text-indigo-400" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white tracking-tight">Portfolio Tracker</h2>
                    <p className="text-sm text-gray-400">Monitor your assets and performance</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <motion.button 
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={fetchQuotes}
                    disabled={loading}
                    className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50"
                    title="Refresh Prices"
                  >
                    <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin text-indigo-400' : ''}`} />
                  </motion.button>
                  <motion.button 
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => setIsOpen(false)}
                    className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
                  >
                    <X className="w-6 h-6" />
                  </motion.button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6 relative z-10 custom-scrollbar">
                
                {/* Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {[
                    { label: 'Total Balance', value: formatCurrency(totalValue), isPL: false },
                    { label: 'Total Cost', value: formatCurrency(totalCost), isPL: false },
                    { 
                      label: 'Total Profit/Loss', 
                      value: formatCurrency(totalPL), 
                      isPL: true,
                      percent: formatPercent(totalPLPercent),
                      isPositive: totalPL >= 0
                    }
                  ].map((card, i) => (
                    <motion.div 
                      key={i}
                      whileHover={{ y: -2 }}
                      className="bg-[#2a2e39]/80 backdrop-blur-sm p-5 rounded-xl border border-gray-700/50 shadow-lg relative overflow-hidden group"
                    >
                      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                      <span className="text-sm text-gray-400 font-medium relative z-10">{card.label}</span>
                      {card.isPL ? (
                        <div className={`text-2xl font-bold mt-1 flex items-center gap-2 relative z-10 ${card.isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                          {card.isPositive ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
                          {card.value}
                          <span className="text-sm font-medium px-2 py-0.5 rounded-md bg-black/30 shadow-inner">
                            {card.percent}
                          </span>
                        </div>
                      ) : (
                        <div className="text-2xl font-bold text-white mt-1 tracking-tight relative z-10">{card.value}</div>
                      )}
                    </motion.div>
                  ))}
                </div>

                {/* Add Asset Form */}
                <form onSubmit={handleAddItem} className="bg-[#2a2e39]/50 backdrop-blur-sm p-5 rounded-xl border border-gray-700/50 flex flex-wrap items-end gap-4 shadow-inner">
                  <div className="flex-1 min-w-[150px]">
                    <label className="block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wider">Asset Symbol</label>
                    <input 
                      type="text" 
                      required
                      placeholder="e.g. AAPL, BTC"
                      value={newSymbol}
                      onChange={e => setNewSymbol(e.target.value)}
                      className="w-full bg-[#131722] border border-gray-600/50 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all uppercase shadow-inner"
                    />
                  </div>
                  <div className="flex-1 min-w-[150px]">
                    <label className="block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wider">Quantity</label>
                    <input 
                      type="number" 
                      required
                      step="any"
                      min="0"
                      placeholder="0.00"
                      value={newQuantity}
                      onChange={e => setNewQuantity(e.target.value)}
                      className="w-full bg-[#131722] border border-gray-600/50 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all shadow-inner"
                    />
                  </div>
                  <div className="flex-1 min-w-[150px]">
                    <label className="block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wider">Avg Buy Price ($)</label>
                    <input 
                      type="number" 
                      required
                      step="any"
                      min="0"
                      placeholder="0.00"
                      value={newPrice}
                      onChange={e => setNewPrice(e.target.value)}
                      className="w-full bg-[#131722] border border-gray-600/50 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all shadow-inner"
                    />
                  </div>
                  <motion.button 
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    type="submit"
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-lg font-medium transition-colors flex items-center gap-2 h-[46px] shadow-lg shadow-indigo-500/20"
                  >
                    <Plus className="w-4 h-4" /> Add Asset
                  </motion.button>
                </form>

                {/* Assets Table */}
                <div className="bg-[#2a2e39]/80 backdrop-blur-sm rounded-xl border border-gray-700/50 overflow-hidden shadow-xl">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-[#1e222d]/80 border-b border-gray-700/50">
                          <th className="p-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Asset</th>
                          <th className="p-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Holdings</th>
                          <th className="p-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Avg Price</th>
                          <th className="p-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Current Price</th>
                          <th className="p-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Total Value</th>
                          <th className="p-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">P/L</th>
                          <th className="p-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-700/30">
                        <AnimatePresence>
                          {items.length === 0 ? (
                            <motion.tr initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                              <td colSpan={7} className="p-12 text-center text-gray-500">
                                <div className="flex flex-col items-center gap-3">
                                  <Briefcase className="w-12 h-12 text-gray-600 opacity-50" />
                                  <p>No assets in your portfolio. Add some above!</p>
                                </div>
                              </td>
                            </motion.tr>
                          ) : (
                            items.map(item => {
                              const quote = quotes[item.symbol];
                              const currentPrice = quote ? quote.price : item.averagePrice;
                              const value = currentPrice * item.quantity;
                              const cost = item.averagePrice * item.quantity;
                              const pl = value - cost;
                              const plPercent = cost > 0 ? (pl / cost) * 100 : 0;
                              const isProfit = pl >= 0;

                              return (
                                <motion.tr 
                                  key={item.id} 
                                  initial={{ opacity: 0, y: 10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  exit={{ opacity: 0, x: -20 }}
                                  className="hover:bg-[#1e222d]/80 transition-colors group"
                                >
                                  <td className="p-4">
                                    <div className="font-bold text-white flex items-center gap-2">
                                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-xs shadow-inner">
                                        {item.symbol.charAt(0)}
                                      </div>
                                      {item.symbol}
                                    </div>
                                  </td>
                                  <td className="p-4 text-right">
                                    <div className="text-gray-200 font-medium">{item.quantity}</div>
                                  </td>
                                  <td className="p-4 text-right">
                                    <div className="text-gray-400">{formatCurrency(item.averagePrice)}</div>
                                  </td>
                                  <td className="p-4 text-right">
                                    <div className="text-gray-200 font-medium">
                                      {quote ? formatCurrency(quote.price) : <span className="animate-pulse">Loading...</span>}
                                    </div>
                                  </td>
                                  <td className="p-4 text-right">
                                    <div className="font-bold text-white">{formatCurrency(value)}</div>
                                  </td>
                                  <td className="p-4 text-right">
                                    <div className={`font-medium flex flex-col items-end ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                                      <span>{formatCurrency(pl)}</span>
                                      <span className="text-xs bg-black/20 px-1.5 py-0.5 rounded mt-0.5">{formatPercent(plPercent)}</span>
                                    </div>
                                  </td>
                                  <td className="p-4 text-center">
                                    <motion.button 
                                      whileHover={{ scale: 1.1 }}
                                      whileTap={{ scale: 0.9 }}
                                      onClick={() => handleRemoveItem(item.id)}
                                      className="p-2 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                                      title="Remove Asset"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </motion.button>
                                  </td>
                                </motion.tr>
                              );
                            })
                          )}
                        </AnimatePresence>
                      </tbody>
                    </table>
                  </div>
                </div>

              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
