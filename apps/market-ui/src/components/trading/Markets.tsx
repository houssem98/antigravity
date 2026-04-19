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

const HighlightCard = ({ title, icon: Icon, data, onSelect }: { title: string, icon: any, data: MarketData[], type: 'gainer' | 'loser' | 'trending', onSelect: (s: string) => void }) => {
  return (
    <div className="bg-[color:var(--surface)] border border-[color:var(--line)] hover:border-[color:var(--line-strong)] rounded-[4px] p-3 transition-colors lux-border">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon className="w-3.5 h-3.5 text-[color:var(--accent)]" />
          <span className="label">{title}</span>
        </div>
        <button className="text-label font-semibold text-[color:var(--text-3)] hover:text-[color:var(--text)] flex items-center gap-0.5 transition-colors">
          MORE <ChevronRight className="w-3 h-3" />
        </button>
      </div>

      <div className="space-y-1">
        {data.slice(0, 3).map((coin, idx) => {
          const change = parseFloat(coin.changePercent24Hr);
          const isPositive = change >= 0;
          return (
            <div
              key={coin.id}
              onClick={() => onSelect(coin.symbol)}
              className="flex items-center justify-between px-2 py-1.5 -mx-2 rounded-sm cursor-pointer hover:bg-[color:var(--surface-2)] transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <span className="font-mono text-data text-[color:var(--text-3)] w-3">{idx + 1}</span>
                <img src={`https://assets.coincap.io/assets/icons/${coin.symbol.toLowerCase()}@2x.png`} alt={coin.symbol} className="w-5 h-5 rounded-full" onError={(e) => { (e.target as HTMLImageElement).src = 'https://assets.coincap.io/assets/icons/btc@2x.png' }} />
                <div className="flex flex-col leading-tight">
                  <span className="text-data font-semibold text-[color:var(--text)]">{coin.symbol}</span>
                  <span className="text-label text-[color:var(--text-3)] truncate w-20">{coin.name}</span>
                </div>
              </div>
              <div className="flex flex-col items-end leading-tight">
                <span className="font-mono text-data text-[color:var(--text)]">${formatCurrency(coin.priceUsd)}</span>
                <span className={`font-mono text-label flex items-center ${isPositive ? 'up' : 'down'}`}>
                  {isPositive ? <TrendingUp className="w-2.5 h-2.5 mr-0.5" /> : <TrendingDown className="w-2.5 h-2.5 mr-0.5" />}
                  {Math.abs(change).toFixed(2)}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
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
      } catch { /* fall through */ }

      try {
        const res = await fetch('https://api.coinlore.net/api/tickers/?start=0&limit=100');
        const data = await res.json();
        if (data?.data && Array.isArray(data.data)) {
          setMarkets(data.data.map(normalizeCoinlore));
        }
      } catch (error) {
        console.error('Failed to fetch markets:', error);
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

  const totalPages = Math.ceil(filteredMarkets.length / itemsPerPage);
  const paginatedMarkets = filteredMarkets.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, activeTab]);

  const totalMarketCap = markets.reduce((sum, m) => sum + parseFloat(m.marketCapUsd || '0'), 0);
  const totalVolume24h = markets.reduce((sum, m) => sum + parseFloat(m.volumeUsd24Hr || '0'), 0);
  const btcData = markets.find(m => m.symbol === 'BTC');
  const ethData = markets.find(m => m.symbol === 'ETH');
  const btcDominance = btcData ? (parseFloat(btcData.marketCapUsd) / totalMarketCap) * 100 : 0;
  const ethDominance = ethData ? (parseFloat(ethData.marketCapUsd) / totalMarketCap) * 100 : 0;

  const topGainers = [...markets].sort((a, b) => parseFloat(b.changePercent24Hr || '0') - parseFloat(a.changePercent24Hr || '0'));
  const topLosers = [...markets].sort((a, b) => parseFloat(a.changePercent24Hr || '0') - parseFloat(b.changePercent24Hr || '0'));
  const trending = [...markets].sort((a, b) => parseFloat(b.volumeUsd24Hr || '0') - parseFloat(a.volumeUsd24Hr || '0'));

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[color:var(--bg)]">
        <div className="label text-[color:var(--text-3)]">LOADING MARKETS...</div>
      </div>
    );
  }

  const Stat = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="flex items-baseline gap-1.5">
      <span className="label">{label}</span>
      <span className="font-mono text-data text-[color:var(--text)]">{value}</span>
    </div>
  );

  return (
    <div className="flex-1 bg-[color:var(--bg)] overflow-y-auto">
      {/* Global market stats bar */}
      <div className="border-b border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-2 flex flex-wrap items-center gap-x-5 gap-y-1">
        <Stat label="CRYPTOS" value={markets.length} />
        <span className="w-px h-3 bg-[color:var(--line)]" />
        <Stat label="MCAP" value={`$${formatNumber(totalMarketCap)}`} />
        <span className="w-px h-3 bg-[color:var(--line)]" />
        <Stat label="24H VOL" value={`$${formatNumber(totalVolume24h)}`} />
        <span className="w-px h-3 bg-[color:var(--line)]" />
        <Stat label="BTC DOM" value={`${btcDominance.toFixed(1)}%`} />
        <Stat label="ETH DOM" value={`${ethDominance.toFixed(1)}%`} />
        <span className="w-px h-3 bg-[color:var(--line)]" />
        <div className="flex items-center gap-1.5">
          <Activity className="w-3 h-3 text-[color:var(--text-3)]" />
          <Stat label="ETH GAS" value="12 GWEI" />
        </div>
        <span className="w-px h-3 bg-[color:var(--line)]" />
        <div className="flex items-center gap-2">
          <AlertTriangle className={`w-3 h-3 ${fearAndGreed ? (parseInt(fearAndGreed.value) > 50 ? 'up' : 'text-[color:var(--accent)]') : 'text-[color:var(--text-3)]'}`} />
          <span className="label">FEAR &amp; GREED</span>
          {fearAndGreed ? (
            <div className="flex items-center gap-2">
              <span className={`font-mono text-data ${parseInt(fearAndGreed.value) > 50 ? 'up' : 'text-[color:var(--accent)]'}`}>
                {fearAndGreed.value}/100
              </span>
              <div className="w-16 h-1 bg-[color:var(--line)] overflow-hidden">
                <div
                  className={parseInt(fearAndGreed.value) > 50 ? 'h-full bg-[color:var(--up)]' : 'h-full bg-[color:var(--accent)]'}
                  style={{ width: `${fearAndGreed.value}%` }}
                />
              </div>
              <span className="label">{fearAndGreed.classification}</span>
            </div>
          ) : (
            <span className="label text-[color:var(--text-4)]">LOADING</span>
          )}
        </div>
      </div>

      <div className="px-4 py-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
          <div className="section-mark" data-mark="001 / MARKETS">
            <h2 className="text-h2 font-display font-semibold text-[color:var(--text)] tracking-tight leading-[0.95]">
              Cryptocurrency Prices <span className="text-[color:var(--text-3)] italic font-normal">by Market Cap</span>
            </h2>
            <p className="text-body text-[color:var(--text-3)] mt-1.5">
              Global cryptocurrency market cap: <span className="font-mono text-[color:var(--text)]">${formatNumber(totalMarketCap)}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[color:var(--text-3)]" />
              <input
                type="text"
                placeholder="Search assets..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-[color:var(--surface)] border border-[color:var(--line)] text-[color:var(--text)] placeholder:text-[color:var(--text-3)] text-body pl-8 pr-3 py-1.5 rounded-sm focus:outline-none focus:border-[color:var(--line-strong)] w-full md:w-72 transition-colors"
              />
            </div>
            <button className="flex items-center gap-1.5 bg-[color:var(--surface)] border border-[color:var(--line)] hover:border-[color:var(--line-strong)] text-[color:var(--text-2)] text-label font-semibold px-3 py-1.5 rounded-sm transition-colors" style={{ letterSpacing: '0.06em' }}>
              FILTERS
            </button>
            <button className="flex items-center gap-1.5 bg-[color:var(--surface)] border border-[color:var(--line)] hover:border-[color:var(--line-strong)] text-[color:var(--text-2)] text-label font-semibold px-3 py-1.5 rounded-sm transition-colors" style={{ letterSpacing: '0.06em' }}>
              CUSTOMIZE
            </button>
          </div>
        </div>

        {/* Highlights */}
        {!searchQuery && activeTab === 'all' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4 stagger">
            <HighlightCard title="TRENDING" icon={Flame} data={trending} type="trending" onSelect={onAssetSelect} />
            <HighlightCard title="TOP GAINERS" icon={Trophy} data={topGainers} type="gainer" onSelect={onAssetSelect} />
            <HighlightCard title="TOP LOSERS" icon={TrendingDown} data={topLosers} type="loser" onSelect={onAssetSelect} />
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-0 mb-0 border-b border-[color:var(--line)] overflow-x-auto">
          {['all', 'watchlist', 'categories', 'portfolio', 'exchanges', 'nfts', 'converter'].map((tab) => {
            const isActive = activeTab === tab;
            const label = tab === 'watchlist' ? `Watchlist (${watchlist.length})` : tab === 'all' ? 'Cryptocurrencies' : tab;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab as any)}
                className={`relative px-3 py-2 text-body font-medium whitespace-nowrap capitalize transition-colors ${
                  isActive
                    ? 'text-[color:var(--text)]'
                    : 'text-[color:var(--text-3)] hover:text-[color:var(--text-2)]'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  {tab === 'watchlist' && <Star className={`w-3.5 h-3.5 ${isActive ? 'text-[color:var(--accent)]' : ''}`} />}
                  {label}
                </div>
                {isActive && <span className="absolute bottom-0 left-0 right-0 h-px bg-[color:var(--accent)]" />}
              </button>
            );
          })}
        </div>

        {/* Table container */}
        <div className="bg-[color:var(--surface)] border border-t-0 border-[color:var(--line)] overflow-hidden">
          <div className="overflow-x-auto">
            {activeTab === 'categories' ? (
              <CategoriesTab />
            ) : activeTab === 'exchanges' ? (
              <ExchangesTab />
            ) : activeTab === 'nfts' ? (
              <NFTsTab />
            ) : activeTab === 'converter' ? (
              <ConverterTab />
            ) : activeTab === 'portfolio' ? (
              <div className="py-16 text-center">
                <div className="flex flex-col items-center gap-2">
                  <Activity className="w-8 h-8 text-[color:var(--text-3)]" />
                  <h3 className="text-h4 font-display font-semibold text-[color:var(--text)]">Portfolio Coming Soon</h3>
                  <p className="text-body text-[color:var(--text-3)] max-w-sm">
                    Detailed portfolio tracker is in development.
                  </p>
                </div>
              </div>
            ) : (
              <table className="w-full text-left border-collapse whitespace-nowrap">
                <thead>
                  <tr className="border-b border-[color:var(--line)] bg-[color:var(--surface-2)]">
                    {[
                      { key: null, label: '', cls: 'w-8' },
                      { key: 'rank', label: '#', cls: 'w-10 hidden sm:table-cell' },
                      { key: 'name', label: 'Name', cls: '' },
                      { key: 'priceUsd', label: 'Price', cls: 'text-right' },
                      { key: 'changePercent1Hr', label: '1h %', cls: 'text-right hidden md:table-cell' },
                      { key: 'changePercent24Hr', label: '24h %', cls: 'text-right' },
                      { key: 'changePercent7d', label: '7d %', cls: 'text-right hidden lg:table-cell' },
                      { key: 'marketCapUsd', label: 'Market Cap', cls: 'text-right hidden sm:table-cell' },
                      { key: 'volumeUsd24Hr', label: 'Volume (24h)', cls: 'text-right hidden lg:table-cell' },
                      { key: 'csupply', label: 'Circulating', cls: 'text-right hidden xl:table-cell' },
                      { key: null, label: 'Last 7 Days', cls: 'text-right hidden md:table-cell' },
                    ].map((h, i) => (
                      <th
                        key={i}
                        className={`py-2 px-4 label ${h.cls} ${h.key ? 'cursor-pointer hover:text-[color:var(--text)] transition-colors group' : ''}`}
                        onClick={() => h.key && handleSort(h.key as keyof MarketData)}
                      >
                        <div className={`flex items-center gap-1 ${h.cls.includes('text-right') ? 'justify-end' : ''}`}>
                          {h.label}
                          {h.key && <ArrowUpDown className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paginatedMarkets.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="py-10 text-center text-body text-[color:var(--text-3)]">
                        {activeTab === 'watchlist' ? 'Your watchlist is empty. Star assets to add them.' : 'No markets found.'}
                      </td>
                    </tr>
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
                          <tr
                            className={`border-b border-[color:var(--line)] transition-colors hover:bg-[color:var(--surface-2)] group cursor-pointer ${isExpanded ? 'bg-[color:var(--surface-2)]' : ''}`}
                            onClick={() => setExpandedCoin(isExpanded ? null : market.id)}
                          >
                            <td className="py-2.5 px-4" onClick={(e) => {
                              e.stopPropagation();
                              if (market.symbol) toggleWatchlist(e, market.symbol);
                            }}>
                              <Star className={`w-3.5 h-3.5 transition-colors ${isStarred ? 'text-[color:var(--accent)] fill-[color:var(--accent)]' : 'text-[color:var(--text-3)] hover:text-[color:var(--text)]'}`} />
                            </td>
                            <td className="py-2.5 px-4 font-mono text-data text-[color:var(--text-3)] hidden sm:table-cell">
                              {market.rank}
                            </td>
                            <td className="py-2.5 px-4">
                              <div className="flex items-center gap-2.5">
                                <img
                                  src={`https://assets.coincap.io/assets/icons/${(market.symbol || 'btc').toLowerCase()}@2x.png`}
                                  alt={market.name}
                                  className="w-6 h-6 rounded-full border border-[color:var(--line)]"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).src = 'https://assets.coincap.io/assets/icons/btc@2x.png';
                                  }}
                                />
                                <div className="flex items-center gap-2">
                                  <span className="text-body font-semibold text-[color:var(--text)]">{market.name || 'Unknown'}</span>
                                  <span className="font-mono text-label text-[color:var(--text-3)] bg-[color:var(--bg)] border border-[color:var(--line)] px-1.5 py-0.5 rounded-sm">{market.symbol || '???'}</span>
                                </div>
                              </div>
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono text-data text-[color:var(--text)]">
                              ${parseFloat(market.priceUsd || '0').toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                            </td>
                            <td className={`py-2.5 px-4 text-right font-mono text-data hidden md:table-cell ${isPositive1h ? 'up' : 'down'}`}>
                              {isPositive1h ? '+' : '-'}{Math.abs(change1h).toFixed(2)}%
                            </td>
                            <td className={`py-2.5 px-4 text-right font-mono text-data ${isPositive24h ? 'up' : 'down'}`}>
                              {isPositive24h ? '+' : '-'}{Math.abs(change24h).toFixed(2)}%
                            </td>
                            <td className={`py-2.5 px-4 text-right font-mono text-data hidden lg:table-cell ${isPositive7d ? 'up' : 'down'}`}>
                              {isPositive7d ? '+' : '-'}{Math.abs(change7d).toFixed(2)}%
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono text-data text-[color:var(--text-2)] hidden sm:table-cell">
                              ${formatNumber(market.marketCapUsd || '0')}
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono text-data text-[color:var(--text-2)] hidden lg:table-cell">
                              <div className="flex flex-col items-end leading-tight">
                                <span>${formatNumber(market.volumeUsd24Hr || '0')}</span>
                                <span className="text-label text-[color:var(--text-3)]">{formatNumber(parseFloat(market.volumeUsd24Hr || '0') / parseFloat(market.priceUsd || '1'))} {market.symbol}</span>
                              </div>
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono text-data text-[color:var(--text-2)] hidden xl:table-cell">
                              <div className="flex flex-col items-end leading-tight">
                                <span>{formatNumber(market.csupply || '0')} {market.symbol}</span>
                                {market.msupply && market.msupply !== '0' && (
                                  <div className="w-24 h-0.5 bg-[color:var(--line)] mt-1 overflow-hidden">
                                    <div
                                      className="h-full bg-[color:var(--text-3)]"
                                      style={{ width: `${Math.min(100, (parseFloat(market.csupply) / parseFloat(market.msupply)) * 100)}%` }}
                                    />
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="py-2.5 px-4 text-right hidden md:table-cell">
                              <div className="flex items-center justify-end gap-3 relative">
                                <div className="w-24 h-10 transition-opacity group-hover:opacity-0">
                                  <Sparkline id={market.symbol} color={isPositive7d ? 'var(--up)' : 'var(--down)'} />
                                </div>
                                <div className="absolute inset-0 flex items-center justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onAssetSelect(market.symbol);
                                    }}
                                    className="bg-[color:var(--accent)] text-[color:var(--accent-ink)] hover:brightness-110 px-3 py-1 rounded-sm text-label font-semibold transition-colors shiny chrome cta-glow press"
                                    style={{ letterSpacing: '0.06em' }}
                                  >
                                    TRADE
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>

                          <AnimatePresence>
                            {isExpanded && (
                              <motion.tr
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                className="bg-[color:var(--bg)] border-b border-[color:var(--line)] overflow-hidden"
                              >
                                <td colSpan={11} className="p-0">
                                  <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                    <div className="space-y-3">
                                      <div className="flex items-center gap-2.5">
                                        <img
                                          src={`https://assets.coincap.io/assets/icons/${(market.symbol || 'btc').toLowerCase()}@2x.png`}
                                          alt={market.name}
                                          className="w-8 h-8 rounded-full"
                                          onError={(e) => {
                                            (e.target as HTMLImageElement).src = 'https://assets.coincap.io/assets/icons/btc@2x.png';
                                          }}
                                        />
                                        <div>
                                          <h3 className="text-h4 font-display font-semibold text-[color:var(--text)]">{market.name}</h3>
                                          <div className="flex items-center gap-1.5">
                                            <span className="label">RANK #{market.rank}</span>
                                            <span className="font-mono text-label text-[color:var(--text-3)]">{market.symbol}</span>
                                          </div>
                                        </div>
                                      </div>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onAssetSelect(market.symbol);
                                        }}
                                        className="flex items-center gap-1.5 bg-[color:var(--accent)] text-[color:var(--accent-ink)] hover:brightness-110 px-3 py-1.5 rounded-sm text-label font-semibold transition-colors shiny chrome cta-glow press"
                                        style={{ letterSpacing: '0.04em' }}
                                      >
                                        <BarChart2 className="w-3.5 h-3.5" />
                                        ADVANCED CHART
                                      </button>
                                    </div>

                                    <div className="space-y-2">
                                      <div>
                                        <div className="label mb-0.5">MARKET CAP</div>
                                        <div className="font-mono text-data text-[color:var(--text)]">${parseFloat(market.marketCapUsd || '0').toLocaleString()}</div>
                                      </div>
                                      <div>
                                        <div className="label mb-0.5">FULLY DILUTED</div>
                                        <div className="font-mono text-data text-[color:var(--text)]">
                                          {market.msupply && market.msupply !== '0'
                                            ? '$' + (parseFloat(market.msupply) * parseFloat(market.priceUsd)).toLocaleString(undefined, { maximumFractionDigits: 0 })
                                            : '∞'}
                                        </div>
                                      </div>
                                      <div>
                                        <div className="label mb-0.5">VOLUME 24H</div>
                                        <div className="font-mono text-data text-[color:var(--text)]">${parseFloat(market.volumeUsd24Hr || '0').toLocaleString()}</div>
                                      </div>
                                    </div>

                                    <div className="space-y-2">
                                      <div>
                                        <div className="label mb-0.5">CIRCULATING</div>
                                        <div className="font-mono text-data text-[color:var(--text)]">{parseFloat(market.csupply || '0').toLocaleString()} {market.symbol}</div>
                                      </div>
                                      <div>
                                        <div className="label mb-0.5">TOTAL SUPPLY</div>
                                        <div className="font-mono text-data text-[color:var(--text)]">{parseFloat(market.tsupply || '0').toLocaleString()} {market.symbol}</div>
                                      </div>
                                      <div>
                                        <div className="label mb-0.5">MAX SUPPLY</div>
                                        <div className="font-mono text-data text-[color:var(--text)]">
                                          {market.msupply && market.msupply !== '0' ? parseFloat(market.msupply).toLocaleString() + ' ' + market.symbol : '∞'}
                                        </div>
                                      </div>
                                    </div>

                                    <div className="space-y-2">
                                      <div className="label mb-1">LINKS</div>
                                      <div className="flex flex-wrap gap-1.5">
                                        <a
                                          href={`https://coinmarketcap.com/currencies/${market.id}/`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="flex items-center gap-1 text-label font-semibold bg-[color:var(--surface-2)] hover:bg-[color:var(--surface)] text-[color:var(--text-2)] border border-[color:var(--line)] hover:border-[color:var(--line-strong)] px-2 py-1 rounded-sm transition-colors"
                                          onClick={(e) => e.stopPropagation()}
                                          style={{ letterSpacing: '0.04em' }}
                                        >
                                          COINMARKETCAP <ExternalLink className="w-2.5 h-2.5" />
                                        </a>
                                        <a
                                          href={`https://www.coingecko.com/en/coins/${market.id}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="flex items-center gap-1 text-label font-semibold bg-[color:var(--surface-2)] hover:bg-[color:var(--surface)] text-[color:var(--text-2)] border border-[color:var(--line)] hover:border-[color:var(--line-strong)] px-2 py-1 rounded-sm transition-colors"
                                          onClick={(e) => e.stopPropagation()}
                                          style={{ letterSpacing: '0.04em' }}
                                        >
                                          COINGECKO <ExternalLink className="w-2.5 h-2.5" />
                                        </a>
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

          {/* Pagination */}
          {!['categories', 'portfolio', 'exchanges', 'nfts', 'converter'].includes(activeTab) && totalPages > 1 && (
            <div className="flex flex-col sm:flex-row items-center justify-between px-4 py-2.5 border-t border-[color:var(--line)] gap-3">
              <div className="flex items-center gap-3 text-body text-[color:var(--text-3)]">
                <div>
                  Showing <span className="font-mono text-[color:var(--text)]">{(currentPage - 1) * itemsPerPage + 1}</span>–<span className="font-mono text-[color:var(--text)]">{Math.min(currentPage * itemsPerPage, filteredMarkets.length)}</span> of <span className="font-mono text-[color:var(--text)]">{filteredMarkets.length}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="label">ROWS</span>
                  <select
                    value={itemsPerPage}
                    onChange={(e) => {
                      setItemsPerPage(Number(e.target.value));
                      setCurrentPage(1);
                    }}
                    className="bg-[color:var(--bg)] border border-[color:var(--line)] text-[color:var(--text)] font-mono text-data rounded-sm px-1.5 py-0.5 focus:outline-none focus:border-[color:var(--line-strong)]"
                  >
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                  disabled={currentPage === 1}
                  className="px-2.5 py-1 rounded-sm bg-[color:var(--bg)] border border-[color:var(--line)] text-[color:var(--text-2)] disabled:opacity-40 disabled:cursor-not-allowed hover:border-[color:var(--line-strong)] hover:text-[color:var(--text)] transition-colors text-label font-semibold"
                  style={{ letterSpacing: '0.04em' }}
                >
                  PREV
                </button>
                <div className="flex items-center gap-0.5">
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
                        className={`w-7 h-7 rounded-sm flex items-center justify-center font-mono text-data transition-colors ${
                          currentPage === pageNum
                            ? 'bg-[color:color-mix(in_oklch,var(--accent)_12%,transparent)] text-[color:var(--accent)]'
                            : 'text-[color:var(--text-3)] hover:bg-[color:var(--surface-2)] hover:text-[color:var(--text)]'
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                  disabled={currentPage === totalPages}
                  className="px-2.5 py-1 rounded-sm bg-[color:var(--bg)] border border-[color:var(--line)] text-[color:var(--text-2)] disabled:opacity-40 disabled:cursor-not-allowed hover:border-[color:var(--line-strong)] hover:text-[color:var(--text)] transition-colors text-label font-semibold"
                  style={{ letterSpacing: '0.04em' }}
                >
                  NEXT
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
