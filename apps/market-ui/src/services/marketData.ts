import marketData from '../data/market_data.json';
import { getApiKeys } from './apiKeys';

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

// Alpha Vantage API integration
export const getStockQuote = async (symbol: string): Promise<Stock | null> => {
  const { alphaVantage } = getApiKeys();

  if (!alphaVantage) {
    console.warn('Alpha Vantage API key not configured, using static data');
    return null;
  }

  try {
    const response = await fetch(
      `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${alphaVantage}`
    );

    const data = await response.json();

    if (data['Error Message'] || data['Note']) {
      console.warn('Alpha Vantage API limit reached, using static data');
      return null;
    }

    const quote = data['Global Quote'];
    if (!quote) return null;

    const price = parseFloat(quote['05. price']);
    const change = parseFloat(quote['09. change']);
    const changePercent = parseFloat(quote['10. change percent'].replace('%', ''));

    return {
      symbol,
      price,
      change: changePercent,
      positive: change > 0,
      volume: parseInt(quote['06. volume']),
      marketCap: 0, // Would need separate API call
      companyName: symbol,
    };
  } catch (error) {
    console.error('Error fetching stock quote:', error);
    return null;
  }
};

export const getCompanyOverview = async (symbol: string): Promise<CompanyOverview | null> => {
  const { alphaVantage } = getApiKeys();

  if (!alphaVantage) return null;

  try {
    const response = await fetch(
      `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${symbol}&apikey=${alphaVantage}`
    );

    const data = await response.json();

    if (data['Error Message'] || data['Note'] || !data.Symbol) {
      return null;
    }

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
  } catch (error) {
    console.error('Error fetching company overview:', error);
    return null;
  }
};

// Existing functions with fallback to static data
export const getMarketData = (): MarketData => {
  return marketData as MarketData;
};

export const getStockList = (): Stock[] => {
  return Object.values(marketData.stocks);
};

export const getMarketMovers = (): Stock[] => {
  const stocks = getStockList();
  return stocks.sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 5);
};

export const getNews = (): NewsItem[] => {
  return marketData.news;
};

export const formatMarketCap = (marketCap: number): string => {
  if (marketCap >= 1e12) {
    return `$${(marketCap / 1e12).toFixed(2)}T`;
  } else if (marketCap >= 1e9) {
    return `$${(marketCap / 1e9).toFixed(2)}B`;
  } else if (marketCap >= 1e6) {
    return `$${(marketCap / 1e6).toFixed(2)}M`;
  }
  return `$${marketCap.toFixed(2)}`;
};

export const formatVolume = (volume: number): string => {
  if (volume >= 1e9) {
    return `${(volume / 1e9).toFixed(2)}B`;
  } else if (volume >= 1e6) {
    return `${(volume / 1e6).toFixed(2)}M`;
  } else if (volume >= 1e3) {
    return `${(volume / 1e3).toFixed(2)}K`;
  }
  return volume.toString();
};

