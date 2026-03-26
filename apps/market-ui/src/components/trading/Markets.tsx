import React, { useState, useEffect } from 'react';
import { Search, TrendingUp, TrendingDown, Star, ArrowUpDown, ExternalLink, BarChart2, Flame, Trophy, AlertTriangle, Activity, ChevronRight } from 'lucide-react';
import { Sparkline } from './Sparkline';
import { motion, AnimatePresence } from 'motion/react';
import { CategoriesTab, ExchangesTab, NFTsTab, ConverterTab } from './MarketsTabs';

interface MarketData {
  id: string;
  symbol: string;
  name: string;
  rank: number;
  priceUsd: string;
  changePercent1Hr: string;
  changePercent24Hr: string;
  changePercent7d: string;
  marketCapUsd: string;
  volumeUsd24Hr: string;
  csupply: string;
  tsupply: string;
  msupply: string;
}

interface MarketsProps {
  onAssetSelect: (asset: string) => void;
}

const formatCurrency = (num: string | number) => {
  const n = typeof num === 'string' ? parseFloat(num) : num;
  if (n < 0.01) return n.toFixed(6);
  if (n < 1) return n.toFixed(4);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const HighlightCard = ({ title, icon: Icon, data, type, onSelect }: { title: string, icon: any, data: MarketData[], type: 'gainer' | 'loser' | 'trending', onSelect: (s: string) => void }) => {
  return (
    <motion.div 
      whileHover={{ y: -4, scale: 1.01 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className="bg-gradient-to-br from-[#111827] to-[#0B0E14] border border-[#1F2937] hover:border-[#2962FF]/50 rounded-2xl p-5 shadow-lg relative overflow-hidden group cursor-pointer"
    >
      <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-[#2962FF]/10 to-transparent rounded-full blur-2xl -mr-10 -mt-10 transition-opacity group-hover:opacity-100 opacity-50"></div>
      
      <div className="flex items-center justify-between mb-4 relative z-10">
        <div className="flex items-center gap-2">
          <div className={`p-2 rounded-lg ${type === 'gainer' ? 'bg-green-500/10 text-green-500' : type === 'loser' ? 'bg-red-500/10 text-red-500' : 'bg-orange-500/10 text-orange-500'}`}>
            <Icon className="w-5 h-5" />
          </div>
          <h3 className="font-bold text-white">{title}</h3>
        </div>
        <button className="text-xs text-[#2962FF] hover:text-blue-400 font-medium flex items-center gap-1 transition-colors">
          More <ChevronRight className="w-3 h-3" />
        </button>
      </div>

      <div className="space-y-3 relative z-10">
        {data.slice(0, 3).map((coin, idx) => {
          const change = parseFloat(coin.changePercent24Hr);
          const isPositive = change >= 0;
          return (
            <motion.div 
              key={coin.id} 
              onClick={() => onSelect(coin.symbol)}
              whileHover={{ x: 4, backgroundColor: 'rgba(31, 41, 55, 0.8)' }}
              className="flex items-center justify-between p-2 -mx-2 rounded-lg transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-gray-500 text-xs font-medium w-3">{idx + 1}</span>
                <img src={`https://assets.coincap.io/assets/icons/${coin.symbol.toLowerCase()}@2x.png`} alt={coin.symbol} className="w-6 h-6 rounded-full" onError={(e) => { (e.target as HTMLImageElement).src = 'https://assets.coincap.io/assets/icons/btc@2x.png' }} />
                <div className="flex flex-col">
                  <span className="text-sm font-bold text-white group-hover:text-[#2962FF] transition-colors">{coin.symbol}</span>
                  <span className="text-xs text-gray-400 truncate w-20">{coin.name}</span>
                </div>
              </div>
              <div className="flex flex-col items-end">
                <span className="text-sm font-medium text-white">${formatCurrency(coin.priceUsd)}</span>
                <span className={`text-xs font-medium flex items-center ${isPositive ? 'text-[#00E676]' : 'text-[#FF1744]'}`}>
                  {isPositive ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                  {Math.abs(change).toFixed(2)}%
                </span>
              </div>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
};

export const Markets: React.FC<MarketsProps> = ({ onAssetSelect }) => {
  const [markets, setMarkets] = useState<MarketData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: keyof MarketData, direction: 'asc' | 'desc' }>({ key: 'rank', direction: 'asc' });
  const [activeTab, setActiveTab] = useState<'all' | 'watchlist' | 'categories' | 'portfolio' | 'exchanges' | 'nfts' | 'converter'>('all');
  const [expandedCoin, setExpandedCoin] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);
  const [fearAndGreed, setFearAndGreed] = useState<{ value: string, classification: string } | null>(null);
  const [watchlist, setWatchlist] = useState<string[]>(() => {
    const saved = localStorage.getItem('nexus_watchlist');
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    localStorage.setItem('nexus_watchlist', JSON.stringify(watchlist));
  }, [watchlist]);

  const toggleWatchlist = (e: React.MouseEvent, symbol: string) => {
    e.stopPropagation();
    setWatchlist(prev => 
      prev.includes(symbol) 
        ? prev.filter(s => s !== symbol)
        : [...prev, symbol]
    );
  };

  useEffect(() => {
    const normalizeCoinlore = (coin: any) => ({
      id: coin.nameid,
      symbol: coin.symbol,
      name: coin.name,
      rank: coin.rank,
      priceUsd: coin.price_usd,
      changePercent1Hr: coin.percent_change_1h || '0',
      changePercent24Hr: coin.percent_change_24h || '0',
      changePercent7d: coin.percent_change_7d || '0',
      marketCapUsd: coin.market_cap_usd || '0',
      volumeUsd24Hr: coin.volume24?.toString() || '0',
      csupply: coin.csupply || '0',
      tsupply: coin.tsupply || '0',
      msupply: coin.msupply || '0',
    });

    const fetchMarkets = async () => {
      // Try backend proxy first, fall back to Coinlore directly
      try {
        const res = await fetch('/api/crypto/markets');
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            setMarkets(data);
            setLoading(false);
            return;
          }
        }
      } catch { /* fall through to direct fetch */ }

      // Direct Coinlore fallback (works without backend)
      try {
        const res = await fetch('https://api.coinlore.net/api/tickers/?start=0&limit=100');
        const data = await res.json();
        if (data?.data && Array.isArray(data.data)) {
          setMarkets(data.data.map(normalizeCoinlore));
        }
      } catch (error) {
        console.error('Failed to fetch markets from all sources:', error);
      } finally {
        setLoading(false);
      }
    };

    const fetchFearAndGreed = async () => {
      try {
        const response = await fetch('https://api.alternative.me/fng/');
        const data = await response.json();
        if (data && data.data && data.data.length > 0) {
          setFearAndGreed({
            value: data.data[0].value,
            classification: data.data[0].value_classification
          });
        }
      } catch (error) {
        console.error('Error fetching fear and greed:', error);
      }
    };

    fetchMarkets();
    fetchFearAndGreed();
    
    // Refresh every 10 seconds
    const interval = setInterval(fetchMarkets, 10000);
    return () => clearInterval(interval);
  }, []);

  const formatNumber = (num: string | number) => {
    const n = typeof num === 'string' ? parseFloat(num) : num;
    if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
    return n.toFixed(2);
  };

  const handleSort = (key: keyof MarketData) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  const sortedMarkets = [...markets].sort((a, b) => {
    let aValue: any = a[sortConfig.key];
    let bValue: any = b[sortConfig.key];

    if (sortConfig.key === 'name' || sortConfig.key === 'symbol') {
      aValue = (aValue || '').toLowerCase();
      bValue = (bValue || '').toLowerCase();
    } else {
      aValue = parseFloat(aValue || '0');
      bValue = parseFloat(bValue || '0');
    }

    if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  });

  const filteredMarkets = sortedMarkets.filter(m => {
    const matchesSearch = (m.name || '').toLowerCase().includes(searchQuery.toLowerCase()) || 
                          (m.symbol || '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTab = activeTab === 'all' || watchlist.includes(m.symbol);
    return matchesSearch && matchesTab;
  });

  // Pagination logic
  const totalPages = Math.ceil(filteredMarkets.length / itemsPerPage);
  const paginatedMarkets = filteredMarkets.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // Reset page when search or tab changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, activeTab]);

  // Calculate Global Metrics
  const totalMarketCap = markets.reduce((sum, m) => sum + parseFloat(m.marketCapUsd || '0'), 0);
  const totalVolume24h = markets.reduce((sum, m) => sum + parseFloat(m.volumeUsd24Hr || '0'), 0);
  const btcData = markets.find(m => m.symbol === 'BTC');
  const ethData = markets.find(m => m.symbol === 'ETH');
  const btcDominance = btcData ? (parseFloat(btcData.marketCapUsd) / totalMarketCap) * 100 : 0;
  const ethDominance = ethData ? (parseFloat(ethData.marketCapUsd) / totalMarketCap) * 100 : 0;

  // Calculate Highlights
  const topGainers = [...markets].sort((a, b) => parseFloat(b.changePercent24Hr || '0') - parseFloat(a.changePercent24Hr || '0'));
  const topLosers = [...markets].sort((a, b) => parseFloat(a.changePercent24Hr || '0') - parseFloat(b.changePercent24Hr || '0'));
  const trending = [...markets].sort((a, b) => parseFloat(b.volumeUsd24Hr || '0') - parseFloat(a.volumeUsd24Hr || '0'));

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0A0E17]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#2962FF]"></div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-[#0A0E17] overflow-y-auto p-4 md:p-6 custom-scrollbar">
      {/* Global Market Stats Bar */}
      <div className="max-w-7xl mx-auto mb-6 bg-[#111827]/80 backdrop-blur-md border border-[#1F2937] rounded-xl p-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs font-medium text-gray-400 shadow-sm">
        <div className="flex items-center gap-2">
          <span>Cryptos: <span className="text-[#2962FF]">{markets.length}+</span></span>
        </div>
        <div className="flex items-center gap-2">
          <span>Market Cap: <span className="text-[#2962FF]">${formatNumber(totalMarketCap)}</span></span>
        </div>
        <div className="flex items-center gap-2">
          <span>24h Vol: <span className="text-[#2962FF]">${formatNumber(totalVolume24h)}</span></span>
        </div>
        <div className="flex items-center gap-2">
          <span>Dominance: <span className="text-[#2962FF]">BTC {btcDominance.toFixed(1)}% ETH {ethDominance.toFixed(1)}%</span></span>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1"><Activity className="w-3 h-3"/> ETH Gas: <span className="text-[#2962FF]">12 Gwei</span></span>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-2">
            <AlertTriangle className={`w-3 h-3 ${fearAndGreed ? (parseInt(fearAndGreed.value) > 50 ? 'text-green-500' : 'text-orange-500') : 'text-gray-500'}`}/> 
            Fear & Greed: 
            {fearAndGreed ? (
              <div className="flex items-center gap-2">
                <span className={parseInt(fearAndGreed.value) > 50 ? 'text-green-500 font-bold' : 'text-orange-500 font-bold'}>
                  {fearAndGreed.value}/100
                </span>
                <div className="w-16 h-1.5 bg-[#1F2937] rounded-full overflow-hidden flex">
                  <div 
                    className={`h-full ${parseInt(fearAndGreed.value) > 50 ? 'bg-green-500' : 'bg-orange-500'}`}
                    style={{ width: `${fearAndGreed.value}%` }}
                  />
                </div>
                <span className="text-gray-400 text-[10px] uppercase">{fearAndGreed.classification}</span>
              </div>
            ) : (
              <span className="text-gray-500">Loading...</span>
            )}
          </span>
        </div>
      </div>

      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">Cryptocurrency Prices by Market Cap</h1>
            <p className="text-gray-400">The global cryptocurrency market cap today is ${formatNumber(totalMarketCap)}.</p>
          </motion.div>
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="flex items-center gap-3"
          >
            <div className="relative group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 group-focus-within:text-[#2962FF] transition-colors" />
              <input
                type="text"
                placeholder="Search assets..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-[#111827] border border-[#1F2937] text-white pl-10 pr-4 py-2.5 rounded-xl focus:outline-none focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF] w-full md:w-80 transition-all shadow-sm"
              />
            </div>
            <motion.button 
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="flex items-center gap-2 bg-[#111827] border border-[#1F2937] hover:bg-[#1F2937] hover:border-gray-600 text-gray-300 px-4 py-2.5 rounded-xl transition-all shadow-sm"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
              <span className="hidden sm:inline">Filters</span>
            </motion.button>
            <motion.button 
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="flex items-center gap-2 bg-[#111827] border border-[#1F2937] hover:bg-[#1F2937] hover:border-gray-600 text-gray-300 px-4 py-2.5 rounded-xl transition-all shadow-sm"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 3H3"/><path d="M21 12H3"/><path d="M21 21H3"/><path d="M8 3v18"/><path d="M16 3v18"/></svg>
              <span className="hidden sm:inline">Customize</span>
            </motion.button>
          </motion.div>
        </div>

        {/* 3D Highlights Section */}
        <AnimatePresence>
          {!searchQuery && activeTab === 'all' && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8 perspective-1000"
            >
              <HighlightCard title="Trending" icon={Flame} data={trending} type="trending" onSelect={onAssetSelect} />
              <HighlightCard title="Top Gainers" icon={Trophy} data={topGainers} type="gainer" onSelect={onAssetSelect} />
              <HighlightCard title="Top Losers" icon={TrendingDown} data={topLosers} type="loser" onSelect={onAssetSelect} />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-4 mb-6 border-b border-[#1F2937] relative overflow-x-auto custom-scrollbar pb-1">
          {['all', 'watchlist', 'categories', 'portfolio', 'exchanges', 'nfts', 'converter'].map((tab) => (
            <button 
              key={tab}
              onClick={() => setActiveTab(tab as any)}
              className={`pb-3 px-3 text-sm font-bold transition-all relative whitespace-nowrap ${activeTab === tab ? 'text-white' : 'text-gray-400 hover:text-gray-200'}`}
            >
              <div className="flex items-center gap-2 capitalize">
                {tab === 'watchlist' && <Star className={`w-4 h-4 ${activeTab === tab ? 'text-yellow-500 fill-yellow-500' : ''}`} />}
                {tab === 'watchlist' ? `Watchlist (${watchlist.length})` : tab === 'all' ? 'Cryptocurrencies' : tab}
              </div>
              {activeTab === tab && (
                <motion.div 
                  layoutId="activeTabIndicator"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-600 to-blue-400 shadow-[0_0_8px_rgba(41,98,255,0.8)]"
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
            </button>
          ))}
        </div>

        <div className="bg-[#0B0E14] border border-[#1F2937] rounded-2xl overflow-hidden shadow-2xl relative">
          <div className="absolute inset-0 bg-gradient-to-b from-[#1F2937]/10 to-transparent pointer-events-none"></div>
          <div className="overflow-x-auto relative z-10">
            {activeTab === 'categories' ? (
              <CategoriesTab />
            ) : activeTab === 'exchanges' ? (
              <ExchangesTab />
            ) : activeTab === 'nfts' ? (
              <NFTsTab />
            ) : activeTab === 'converter' ? (
              <ConverterTab />
            ) : activeTab === 'portfolio' ? (
              <div className="py-24 text-center">
                <div className="flex flex-col items-center justify-center space-y-4">
                  <div className="w-16 h-16 bg-[#1F2937] rounded-full flex items-center justify-center mb-2">
                    <Activity className="w-8 h-8 text-gray-400" />
                  </div>
                  <h3 className="text-xl font-bold text-white capitalize">Portfolio Coming Soon</h3>
                  <p className="text-gray-400 max-w-md mx-auto">
                    We are working on bringing you a detailed portfolio tracker. Stay tuned!
                  </p>
                </div>
              </div>
            ) : (
              <table className="w-full text-left border-collapse whitespace-nowrap">
                <thead>
                  <tr className="border-b border-[#1F2937] text-gray-400 text-xs uppercase tracking-wider bg-[#111827]/80 backdrop-blur-md">
                    <th className="py-4 px-6 font-bold w-10"></th>
                    <th className="py-4 px-6 font-bold cursor-pointer hover:text-white transition-colors w-12 hidden sm:table-cell group" onClick={() => handleSort('rank')}>
                      <div className="flex items-center gap-1.5"># <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" /></div>
                    </th>
                    <th className="py-4 px-6 font-bold cursor-pointer hover:text-white transition-colors group" onClick={() => handleSort('name')}>
                      <div className="flex items-center gap-1.5">Name <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" /></div>
                    </th>
                    <th className="py-4 px-6 font-bold text-right cursor-pointer hover:text-white transition-colors group" onClick={() => handleSort('priceUsd')}>
                      <div className="flex items-center justify-end gap-1.5">Price <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" /></div>
                    </th>
                    <th className="py-4 px-6 font-bold text-right cursor-pointer hover:text-white transition-colors hidden md:table-cell group" onClick={() => handleSort('changePercent1Hr')}>
                      <div className="flex items-center justify-end gap-1.5">1h % <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" /></div>
                    </th>
                    <th className="py-4 px-6 font-bold text-right cursor-pointer hover:text-white transition-colors group" onClick={() => handleSort('changePercent24Hr')}>
                      <div className="flex items-center justify-end gap-1.5">24h % <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" /></div>
                    </th>
                    <th className="py-4 px-6 font-bold text-right cursor-pointer hover:text-white transition-colors hidden lg:table-cell group" onClick={() => handleSort('changePercent7d')}>
                      <div className="flex items-center justify-end gap-1.5">7d % <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" /></div>
                    </th>
                    <th className="py-4 px-6 font-bold text-right cursor-pointer hover:text-white transition-colors hidden sm:table-cell group" onClick={() => handleSort('marketCapUsd')}>
                      <div className="flex items-center justify-end gap-1.5">Market Cap <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" /></div>
                    </th>
                    <th className="py-4 px-6 font-bold text-right cursor-pointer hover:text-white transition-colors hidden lg:table-cell group" onClick={() => handleSort('volumeUsd24Hr')}>
                      <div className="flex items-center justify-end gap-1.5">Volume (24h) <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" /></div>
                    </th>
                    <th className="py-4 px-6 font-bold text-right cursor-pointer hover:text-white transition-colors hidden xl:table-cell group" onClick={() => handleSort('csupply')}>
                      <div className="flex items-center justify-end gap-1.5">Circulating Supply <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" /></div>
                    </th>
                    <th className="py-4 px-6 font-bold text-right hidden md:table-cell">Last 7 Days</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedMarkets.length === 0 ? (
                    <motion.tr
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                    >
                      <td colSpan={11} className="py-12 text-center text-gray-500">
                        {activeTab === 'watchlist' ? 'Your watchlist is empty. Star some assets to add them here.' : 'No markets found.'}
                      </td>
                    </motion.tr>
                  ) : (
                    paginatedMarkets.map((market, index) => {
                      const change1h = parseFloat(market.changePercent1Hr || '0');
                      const change24h = parseFloat(market.changePercent24Hr || '0');
                      const change7d = parseFloat(market.changePercent7d || '0');
                      const isPositive1h = change1h >= 0;
                      const isPositive24h = change24h >= 0;
                      const isPositive7d = change7d >= 0;
                      const isStarred = watchlist.includes(market.symbol);
                      const isExpanded = expandedCoin === market.id;
                      
                      return (
                        <React.Fragment key={market.id || index}>
                          <motion.tr 
                            layout
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.2, delay: index * 0.02 }}
                            className={`border-b border-[#1F2937]/50 transition-all duration-200 hover:bg-[#1F2937]/50 hover:shadow-lg hover:-translate-y-[1px] group cursor-pointer ${isExpanded ? 'bg-[#1F2937]/20' : ''}`}
                            onClick={() => setExpandedCoin(isExpanded ? null : market.id)}
                          >
                          <td className="py-4 px-6 text-gray-500" onClick={(e) => {
                            e.stopPropagation();
                            if (market.symbol) toggleWatchlist(e, market.symbol);
                          }}>
                            <Star className={`w-4 h-4 transition-colors ${isStarred ? 'text-yellow-500 fill-yellow-500 drop-shadow-[0_0_5px_rgba(234,179,8,0.5)]' : 'hover:text-yellow-500'}`} />
                          </td>
                          <td className="py-4 px-6 text-gray-400 font-medium hidden sm:table-cell">
                            {market.rank}
                          </td>
                          <td className="py-4 px-6">
                            <div className="flex items-center gap-3">
                              <img 
                                src={`https://assets.coincap.io/assets/icons/${(market.symbol || 'btc').toLowerCase()}@2x.png`}
                                alt={market.name}
                                className="w-8 h-8 rounded-full shadow-sm border border-gray-800"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).src = 'https://assets.coincap.io/assets/icons/btc@2x.png';
                                }}
                              />
                              <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                                <span className="font-bold text-white group-hover:text-[#2962FF] transition-colors">{market.name || 'Unknown'}</span>
                                <span className="text-xs font-medium text-gray-400 bg-[#1F2937]/50 border border-gray-700/50 px-2 py-0.5 rounded-md">{market.symbol || '???'}</span>
                              </div>
                            </div>
                          </td>
                          <td className="py-4 px-6 text-right font-mono text-white font-medium">
                            ${parseFloat(market.priceUsd || '0').toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                          </td>
                          <td className={`py-4 px-6 text-right font-mono font-medium hidden md:table-cell ${isPositive1h ? 'text-[#00E676]' : 'text-[#FF1744]'}`}>
                            <div className="flex items-center justify-end gap-1">
                              {isPositive1h ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                              {Math.abs(change1h).toFixed(2)}%
                            </div>
                          </td>
                          <td className={`py-4 px-6 text-right font-mono font-medium ${isPositive24h ? 'text-[#00E676]' : 'text-[#FF1744]'}`}>
                            <div className="flex items-center justify-end gap-1">
                              {isPositive24h ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                              {Math.abs(change24h).toFixed(2)}%
                            </div>
                          </td>
                          <td className={`py-4 px-6 text-right font-mono font-medium hidden lg:table-cell ${isPositive7d ? 'text-[#00E676]' : 'text-[#FF1744]'}`}>
                            <div className="flex items-center justify-end gap-1">
                              {isPositive7d ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                              {Math.abs(change7d).toFixed(2)}%
                            </div>
                          </td>
                          <td className="py-4 px-6 text-right font-mono text-gray-300 hidden sm:table-cell">
                            ${formatNumber(market.marketCapUsd || '0')}
                          </td>
                          <td className="py-4 px-6 text-right font-mono text-gray-300 hidden lg:table-cell">
                            <div className="flex flex-col items-end">
                              <span className="font-medium">${formatNumber(market.volumeUsd24Hr || '0')}</span>
                              <span className="text-xs text-gray-500">{formatNumber(parseFloat(market.volumeUsd24Hr || '0') / parseFloat(market.priceUsd || '1'))} {market.symbol}</span>
                            </div>
                          </td>
                          <td className="py-4 px-6 text-right font-mono text-gray-300 hidden xl:table-cell">
                            <div className="flex flex-col items-end">
                              <span className="font-medium">{formatNumber(market.csupply || '0')} {market.symbol}</span>
                              {market.msupply && market.msupply !== '0' && (
                                <div className="w-24 h-1.5 bg-[#1F2937] rounded-full mt-1.5 overflow-hidden border border-gray-800">
                                  <div 
                                    className="h-full bg-gradient-to-r from-gray-500 to-gray-300 rounded-full" 
                                    style={{ width: `${Math.min(100, (parseFloat(market.csupply) / parseFloat(market.msupply)) * 100)}%` }}
                                  />
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="py-4 px-6 text-right hidden md:table-cell">
                            <div className="flex items-center justify-end gap-4 relative">
                              <div className="w-28 h-12 transition-opacity duration-300 group-hover:opacity-0">
                                <Sparkline id={market.symbol} color={isPositive7d ? '#00E676' : '#FF1744'} />
                              </div>
                              <div className="absolute inset-0 flex items-center justify-end opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onAssetSelect(market.symbol);
                                  }}
                                  className="bg-[#2962FF] hover:bg-[#2962FF]/90 text-white px-5 py-2 rounded-lg text-sm font-bold transition-all shadow-lg shadow-blue-900/30 hover:shadow-blue-900/50 hover:-translate-y-0.5"
                                >
                                  Trade
                                </button>
                              </div>
                            </div>
                          </td>
                        </motion.tr>
                        
                        {/* Expanded Details Row */}
                        <AnimatePresence>
                          {isExpanded && (
                            <motion.tr 
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              className="bg-[#0B0E14]/80 border-b border-[#1F2937] overflow-hidden"
                            >
                              <td colSpan={11} className="p-0">
                                <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                                  {/* Overview */}
                                <div className="space-y-4">
                                  <div className="flex items-center gap-3">
                                    <img 
                                      src={`https://assets.coincap.io/assets/icons/${(market.symbol || 'btc').toLowerCase()}@2x.png`}
                                      alt={market.name}
                                      className="w-10 h-10 rounded-full shadow-sm"
                                      onError={(e) => {
                                        (e.target as HTMLImageElement).src = 'https://assets.coincap.io/assets/icons/btc@2x.png';
                                      }}
                                    />
                                    <div>
                                      <h3 className="text-lg font-bold text-white">{market.name}</h3>
                                      <div className="flex items-center gap-2">
                                        <span className="text-sm text-gray-400 bg-[#1F2937] px-2 py-0.5 rounded">Rank #{market.rank}</span>
                                        <span className="text-sm text-gray-400">{market.symbol}</span>
                                      </div>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-4">
                                    <button 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onAssetSelect(market.symbol);
                                      }}
                                      className="flex items-center gap-2 bg-[#2962FF] hover:bg-[#2962FF]/80 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all shadow-lg shadow-blue-900/20"
                                    >
                                      <BarChart2 className="w-4 h-4" />
                                      Advanced Chart
                                    </button>
                                  </div>
                                </div>

                                {/* Market Stats */}
                                <div className="space-y-3">
                                  <div>
                                    <div className="text-sm text-gray-500 mb-1">Market Cap</div>
                                    <div className="text-white font-mono font-medium">${parseFloat(market.marketCapUsd || '0').toLocaleString()}</div>
                                  </div>
                                  <div>
                                    <div className="text-sm text-gray-500 mb-1">Fully Diluted Valuation</div>
                                    <div className="text-white font-mono font-medium">
                                      {market.msupply && market.msupply !== '0' 
                                        ? '$' + (parseFloat(market.msupply) * parseFloat(market.priceUsd)).toLocaleString(undefined, { maximumFractionDigits: 0 })
                                        : '∞'}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-sm text-gray-500 mb-1">Volume (24h)</div>
                                    <div className="text-white font-mono font-medium">${parseFloat(market.volumeUsd24Hr || '0').toLocaleString()}</div>
                                  </div>
                                </div>

                                {/* Supply Info */}
                                <div className="space-y-3">
                                  <div>
                                    <div className="text-sm text-gray-500 mb-1">Circulating Supply</div>
                                    <div className="text-white font-mono font-medium">{parseFloat(market.csupply || '0').toLocaleString()} {market.symbol}</div>
                                  </div>
                                  <div>
                                    <div className="text-sm text-gray-500 mb-1">Total Supply</div>
                                    <div className="text-white font-mono font-medium">{parseFloat(market.tsupply || '0').toLocaleString()} {market.symbol}</div>
                                  </div>
                                  <div>
                                    <div className="text-sm text-gray-500 mb-1">Max Supply</div>
                                    <div className="text-white font-mono font-medium">
                                      {market.msupply && market.msupply !== '0' ? parseFloat(market.msupply).toLocaleString() + ' ' + market.symbol : '∞'}
                                    </div>
                                  </div>
                                </div>

                                {/* Links & Info */}
                                <div className="space-y-3">
                                  <div>
                                    <div className="text-sm text-gray-500 mb-2">Info</div>
                                    <div className="flex flex-wrap gap-2">
                                      <a 
                                        href={`https://coinmarketcap.com/currencies/${market.id}/`} 
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-1 text-xs bg-[#1F2937] hover:bg-[#374151] text-gray-300 px-3 py-1.5 rounded-lg transition-colors"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        CoinMarketCap <ExternalLink className="w-3 h-3" />
                                      </a>
                                      <a 
                                        href={`https://www.coingecko.com/en/coins/${market.id}`} 
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-1 text-xs bg-[#1F2937] hover:bg-[#374151] text-gray-300 px-3 py-1.5 rounded-lg transition-colors"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        CoinGecko <ExternalLink className="w-3 h-3" />
                                      </a>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </td>
                          </motion.tr>
                        )}
                      </AnimatePresence>
                    </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
            )}
          </div>
          
          {/* Pagination Controls */}
          {!['categories', 'portfolio', 'exchanges', 'nfts', 'converter'].includes(activeTab) && totalPages > 1 && (
            <div className="flex flex-col sm:flex-row items-center justify-between px-6 py-4 border-t border-[#1F2937] bg-[#0B0E14]/50 gap-4">
              <div className="flex items-center gap-4 text-sm text-gray-400">
                <div>
                  Showing <span className="font-medium text-white">{(currentPage - 1) * itemsPerPage + 1}</span> to <span className="font-medium text-white">{Math.min(currentPage * itemsPerPage, filteredMarkets.length)}</span> of <span className="font-medium text-white">{filteredMarkets.length}</span> results
                </div>
                <div className="flex items-center gap-2">
                  <span>Show rows:</span>
                  <select 
                    value={itemsPerPage} 
                    onChange={(e) => {
                      setItemsPerPage(Number(e.target.value));
                      setCurrentPage(1);
                    }}
                    className="bg-[#1F2937] border border-gray-700 text-white text-sm rounded-md px-2 py-1 focus:outline-none focus:border-[#2962FF]"
                  >
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1 rounded-md bg-[#1F2937] text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#374151] transition-colors text-sm"
                >
                  Previous
                </button>
                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum = i + 1;
                    if (totalPages > 5 && currentPage > 3) {
                      pageNum = currentPage - 2 + i;
                      if (pageNum > totalPages) pageNum = totalPages - 4 + i;
                    }
                    return (
                      <button
                        key={pageNum}
                        onClick={() => setCurrentPage(pageNum)}
                        className={`w-8 h-8 rounded-md flex items-center justify-center text-sm transition-colors ${currentPage === pageNum ? 'bg-[#2962FF] text-white' : 'text-gray-400 hover:bg-[#1F2937] hover:text-white'}`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                  disabled={currentPage === totalPages}
                  className="px-3 py-1 rounded-md bg-[#1F2937] text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#374151] transition-colors text-sm"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
