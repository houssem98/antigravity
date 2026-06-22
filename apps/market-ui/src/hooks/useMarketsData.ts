import { useState, useEffect, useCallback } from 'react';

interface ExchangeMarket {
  rank: number;
  name: string;
  pair: string;
  price: string;
  depth: { bid: string; ask: string };
  volume24h: string;
  volumePercent: string;
  liquidity: number;
  spreadBps: number;
  lastUpdate: string;
  symbol: string;
}

interface MarketsData {
  asset: string;
  exchanges: ExchangeMarket[];
  metadata: {
    updated_at: string;
    source: string;
    cached?: boolean;
    health: string;
    error?: string;
  };
}

interface UseMarketsDataOptions {
  asset?: string;
  limit?: number;
  sort?: string;
  order?: string;
  pollInterval?: number;
}

export function useMarketsData(options: UseMarketsDataOptions = {}) {
  const {
    asset = 'BTC',
    limit = 50,
    sort = 'volume_24h',
    order = 'desc',
    pollInterval = 5000,
  } = options;

  const [data, setData] = useState<MarketsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMarkets = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({
        asset,
        limit: limit.toString(),
        sort,
        order,
      });

      const apiUrl = process.env.REACT_APP_API_URL || 'https://gravity-api-prod.fly.dev';
      const response = await fetch(`${apiUrl}/api/trading/markets/data?${params}`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch markets');
    } finally {
      setLoading(false);
    }
  }, [asset, limit, sort, order]);

  useEffect(() => {
    fetchMarkets();

    if (pollInterval > 0) {
      const interval = setInterval(fetchMarkets, pollInterval);
      return () => clearInterval(interval);
    }
  }, [fetchMarkets, pollInterval]);

  return {
    data,
    loading,
    error,
    refetch: fetchMarkets,
  };
}
