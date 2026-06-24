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

interface UseMarketsWebSocketOptions {
  asset?: string;
  limit?: number;
}

export function useMarketsWebSocket(options: UseMarketsWebSocketOptions = {}) {
  const { asset = 'BTC', limit = 50 } = options;

  const [data, setData] = useState<MarketsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    const apiUrl = process.env.REACT_APP_API_URL || 'https://gravity-api-prod.fly.dev';
    const wsUrl = apiUrl.replace('https://', 'wss://').replace('http://', 'ws://');
    const ws = new WebSocket(`${wsUrl}/api/trading/markets/ws?asset=${asset}`);

    ws.onopen = () => {
      setLoading(false);
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.error) {
          setError(message.error);
        } else {
          setData(message);
          setError(null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to parse message');
      }
    };

    ws.onerror = () => {
      setError('WebSocket connection error');
      setLoading(false);
    };

    ws.onclose = () => {
      setError('Connection closed');
    };

    return () => {
      ws.close();
    };
  }, [asset]);

  return {
    data,
    loading,
    error,
  };
}
