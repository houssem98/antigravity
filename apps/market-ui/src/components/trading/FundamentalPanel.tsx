import React, { useState, useEffect } from 'react';
import { FileText, DollarSign, PieChart, TrendingUp, Loader2, X, BarChart3 } from 'lucide-react';
import { isCryptoAsset } from '../../constants/tradingAssets';
import { FinancialsModal } from './FinancialsModal';

interface FundamentalPanelProps {
  asset: string;
}

interface FundamentalData {
  marketCap?: number;
  trailingPE?: number;
  forwardPE?: number;
  dividendYield?: number;
  profitMargins?: number;
  returnOnEquity?: number;
  totalRevenue?: number;
  ebitda?: number;
  debtToEquity?: number;
  currency?: string;
}

export const FundamentalPanel: React.FC<FundamentalPanelProps> = ({ asset }) => {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<FundamentalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    setData(null);
    setError(null);
    setExpanded(false);
  }, [asset]);

  const fetchFundamentals = async () => {
    setLoading(true);
    setError(null);
    try {
      const isCrypto = isCryptoAsset(asset);
      let symbol = asset;
      if (isCrypto) {
        symbol = `${asset}-USD`;
      }

      // Fetch basic quote data first (more reliable for crypto)
      const quoteRes = await fetch(`/api/quote?symbols=${symbol}`);
      if (!quoteRes.ok) throw new Error('Failed to fetch quote data');
      const quoteJson = await quoteRes.json();
      const quoteData = quoteJson.quoteResponse?.result?.[0];

      if (!quoteData) throw new Error('No fundamental data available for this asset');

      // Try fetching deep fundamentals, but don't fail if it doesn't exist
      let result: any = {};
      try {
        const res = await fetch(`/api/fundamentals?symbol=${symbol}`);
        if (res.ok) {
          const json = await res.json();
          result = json.quoteSummary?.result?.[0] || {};
        }
      } catch (e) {
        console.warn("Deep fundamentals not available, using basic quote data");
      }

      const stats = result.defaultKeyStatistics || {};
      const fin = result.financialData || {};
      const summary = result.summaryDetail || {};

      setData({
        marketCap: quoteData.marketCap || summary.marketCap?.raw || summary.marketCap,
        trailingPE: quoteData.trailingPE || summary.trailingPE?.raw || summary.trailingPE || stats.trailingPE?.raw || stats.trailingPE,
        forwardPE: quoteData.forwardPE || stats.forwardPE?.raw || stats.forwardPE,
        dividendYield: quoteData.dividendYield || summary.dividendYield?.raw || summary.dividendYield,
        profitMargins: fin.profitMargins?.raw || fin.profitMargins,
        returnOnEquity: fin.returnOnEquity?.raw || fin.returnOnEquity,
        totalRevenue: fin.totalRevenue?.raw || fin.totalRevenue,
        ebitda: fin.ebitda?.raw || fin.ebitda,
        debtToEquity: fin.debtToEquity?.raw || fin.debtToEquity,
        currency: quoteData.currency || fin.financialCurrency || summary.currency || 'USD'
      });
      setExpanded(true);
    } catch (err: any) {
      console.error("Fundamentals error:", err);
      setError(err.message || "Failed to fetch fundamentals");
    } finally {
      setLoading(false);
    }
  };

  const formatNumber = (num?: number, isCurrency = false, currency = 'USD') => {
    if (num === undefined || num === null) return 'N/A';
    
    if (num >= 1e12) return `${isCurrency ? '$' : ''}${(num / 1e12).toFixed(2)}T`;
    if (num >= 1e9) return `${isCurrency ? '$' : ''}${(num / 1e9).toFixed(2)}B`;
    if (num >= 1e6) return `${isCurrency ? '$' : ''}${(num / 1e6).toFixed(2)}M`;
    
    if (isCurrency) {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(num);
    }
    return new Intl.NumberFormat('en-US').format(num);
  };

  const formatPercent = (num?: number) => {
    if (num === undefined || num === null) return 'N/A';
    return `${(num * 100).toFixed(2)}%`;
  };

  return (
    <div className="absolute top-16 right-4 z-20 flex flex-col items-end mt-2">
      {!data && !loading && (
        <button
          onClick={fetchFundamentals}
          className="flex items-center gap-2 bg-[#1e222d] hover:bg-[#2a2e39] text-gray-300 px-4 py-2 rounded-lg border border-gray-800 shadow-lg transition-colors"
        >
          <FileText className="w-4 h-4 text-purple-400" />
          <span className="text-sm font-medium">Fundamentals</span>
        </button>
      )}

      {loading && (
        <div className="flex items-center gap-2 bg-[#1e222d] text-gray-300 px-4 py-2 rounded-lg border border-gray-800 shadow-lg">
          <Loader2 className="w-4 h-4 text-purple-400 animate-spin" />
          <span className="text-sm font-medium">Loading {asset}...</span>
        </div>
      )}

      {error && (
        <div className="flex flex-col gap-2 bg-[#1e222d] text-red-400 px-4 py-3 rounded-lg border border-red-900/50 shadow-lg max-w-xs">
          <span className="text-sm font-medium">Data Unavailable</span>
          <span className="text-xs opacity-80">{error}</span>
          <button onClick={() => setError(null)} className="text-xs underline mt-1 text-gray-400 hover:text-gray-300 text-left">Dismiss</button>
        </div>
      )}

      {data && (
        <div className={`bg-[#1e222d] border border-gray-800 shadow-xl rounded-xl overflow-hidden transition-all duration-300 ${expanded ? 'w-80' : 'w-auto'}`}>
          <div 
            className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-[#2a2e39] transition-colors bg-purple-500/10 border-b border-purple-500/20"
            onClick={() => setExpanded(!expanded)}
          >
            <div className="flex items-center gap-3">
              <FileText className="w-5 h-5 text-purple-400" />
              <div className="flex flex-col">
                <span className="text-xs text-gray-400 font-medium uppercase tracking-wider">{asset} Fundamentals</span>
                <span className="text-sm font-bold text-gray-200">Key Metrics</span>
              </div>
            </div>
            {expanded && (
              <button onClick={(e) => { e.stopPropagation(); setData(null); }} className="text-gray-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {expanded && (
            <div className="p-4 grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-gray-500 uppercase flex items-center gap-1"><DollarSign className="w-3 h-3"/> Market Cap</span>
                <span className="text-sm font-medium text-gray-200">{formatNumber(data.marketCap, true, data.currency)}</span>
              </div>
              
              <div className="flex flex-col gap-1">
                <span className="text-xs text-gray-500 uppercase flex items-center gap-1"><PieChart className="w-3 h-3"/> P/E Ratio (TTM)</span>
                <span className="text-sm font-medium text-gray-200">{data.trailingPE?.toFixed(2) || 'N/A'}</span>
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-xs text-gray-500 uppercase flex items-center gap-1"><PieChart className="w-3 h-3"/> Forward P/E</span>
                <span className="text-sm font-medium text-gray-200">{data.forwardPE?.toFixed(2) || 'N/A'}</span>
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-xs text-gray-500 uppercase flex items-center gap-1"><TrendingUp className="w-3 h-3"/> Revenue</span>
                <span className="text-sm font-medium text-gray-200">{formatNumber(data.totalRevenue, true, data.currency)}</span>
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-xs text-gray-500 uppercase flex items-center gap-1"><TrendingUp className="w-3 h-3"/> Profit Margin</span>
                <span className="text-sm font-medium text-gray-200">{formatPercent(data.profitMargins)}</span>
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-xs text-gray-500 uppercase flex items-center gap-1"><TrendingUp className="w-3 h-3"/> ROE</span>
                <span className="text-sm font-medium text-gray-200">{formatPercent(data.returnOnEquity)}</span>
              </div>
              
              <div className="flex flex-col gap-1">
                <span className="text-xs text-gray-500 uppercase flex items-center gap-1"><DollarSign className="w-3 h-3"/> Div Yield</span>
                <span className="text-sm font-medium text-gray-200">{formatPercent(data.dividendYield)}</span>
              </div>
              
              <div className="flex flex-col gap-1">
                <span className="text-xs text-gray-500 uppercase flex items-center gap-1"><PieChart className="w-3 h-3"/> Debt/Equity</span>
                <span className="text-sm font-medium text-gray-200">{data.debtToEquity?.toFixed(2) || 'N/A'}</span>
              </div>
              
              <div className="col-span-2 mt-2">
                <button
                  onClick={(e) => { e.stopPropagation(); setIsModalOpen(true); }}
                  className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors text-sm font-medium"
                >
                  <BarChart3 className="w-4 h-4" />
                  View Full Financials
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <FinancialsModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        asset={asset} 
      />
    </div>
  );
};
