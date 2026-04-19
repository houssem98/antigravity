import marketData from '../data/market_data.json';
import { apiGetQuote, apiGetOverview } from './api';

export interface Stock {
  symbol: string;
  price: number;
  change: number;
  positive: boolean;
  volume: number;
  marketCap: number;
  companyName: string;
}

export interface NewsItem {
  title: string;
  summary: string;
  source: string;
  url: string;
}

export interface MarketData {
  stocks: Record<string, Stock>;
  news: NewsItem[];
  lastUpdated: string;
}

export interface CompanyOverview {
  symbol: string;
  name: string;
  description: string;
  sector: string;
  industry: string;
  marketCap: number;
  peRatio: number;
  dividendYield: number;
  fiftyTwoWeekHigh: number;
  fiftyTwoWeekLow: number;
}

// Live quote via market-server proxy (Alpha Vantage key stays server-side).
export const getStockQuote = async (symbol: string): Promise<Stock | null> => {
  try {
    const data = await apiGetQuote(symbol);
    if (data['Error Message'] || data['Note']) return null;

    const quote = data['Global Quote'];
    if (!quote) return null;

    const price = parseFloat(quote['05. price']);
    const change = parseFloat(quote['09. change']);
    const changePercent = parseFloat(quote['10. change percent']?.replace('%', '') ?? '0');

    return {
      symbol,
      price,
      change: changePercent,
      positive: change > 0,
      volume: parseInt(quote['06. volume']),
      marketCap: 0,
      companyName: symbol,
    };
  } catch {
    return null;
  }
};

export const getCompanyOverview = async (symbol: string): Promise<CompanyOverview | null> => {
  try {
    const data = await apiGetOverview(symbol);
    if (data['Error Message'] || data['Note'] || !data.Symbol) return null;

    return {
      symbol: data.Symbol,
      name: data.Name,
      description: data.Description,
      sector: data.Sector,
      industry: data.Industry,
      marketCap: parseInt(data.MarketCapitalization) || 0,
      peRatio: parseFloat(data.PERatio) || 0,
      dividendYield: parseFloat(data.DividendYield) || 0,
      fiftyTwoWeekHigh: parseFloat(data['52WeekHigh']) || 0,
      fiftyTwoWeekLow: parseFloat(data['52WeekLow']) || 0,
    };
  } catch {
    return null;
  }
};

// Static fallback data (no API key needed).
export const getMarketData = (): MarketData => marketData as MarketData;

export const getStockList = (): Stock[] => Object.values(marketData.stocks);

export const getMarketMovers = (): Stock[] =>
  getStockList().sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 5);

export const getNews = (): NewsItem[] => marketData.news;

export const formatMarketCap = (marketCap: number): string => {
  if (marketCap >= 1e12) return `$${(marketCap / 1e12).toFixed(2)}T`;
  if (marketCap >= 1e9)  return `$${(marketCap / 1e9).toFixed(2)}B`;
  if (marketCap >= 1e6)  return `$${(marketCap / 1e6).toFixed(2)}M`;
  return `$${marketCap.toFixed(2)}`;
};

export const formatVolume = (volume: number): string => {
  if (volume >= 1e9) return `${(volume / 1e9).toFixed(2)}B`;
  if (volume >= 1e6) return `${(volume / 1e6).toFixed(2)}M`;
  if (volume >= 1e3) return `${(volume / 1e3).toFixed(2)}K`;
  return volume.toString();
};
