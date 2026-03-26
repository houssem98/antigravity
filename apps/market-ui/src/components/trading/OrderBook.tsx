import React, { useState, useEffect } from 'react';
import { isCryptoAsset } from '../../constants/tradingAssets';

interface OrderBookProps {
  asset: string;
}

interface OrderBookEntry {
  price: number;
  amount: number;
  total: number;
}

export const OrderBook: React.FC<OrderBookProps> = ({ asset }) => {
  const [bids, setBids] = useState<OrderBookEntry[]>([]);
  const [asks, setAsks] = useState<OrderBookEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let restInterval: NodeJS.Timeout | null = null;
    let isMounted = true;

    setBids([]);
    setAsks([]);
    setLoading(true);

    if (isCryptoAsset(asset)) {
      const symbol = `${asset.toLowerCase()}usdt`;
      
      const fetchRestOrderBook = async () => {
        if (!isMounted) return;
        try {
          const response = await fetch(`/api/crypto/depth?symbol=${symbol.toUpperCase()}`);
          if (response.status === 400) {
            console.error('Invalid symbol or not supported by Binance');
            if (isMounted) setLoading(false);
            if (restInterval) clearInterval(restInterval);
            return;
          }
          if (!response.ok) throw new Error('REST API failed');
          const data = await response.json();
          processOrderBookData(data);
        } catch (e) {
          console.error('REST OrderBook fallback failed:', e);
          if (isMounted) setLoading(false);
        }
      };

      const startRestPolling = () => {
        if (restInterval) clearInterval(restInterval);
        fetchRestOrderBook();
        restInterval = setInterval(fetchRestOrderBook, 2000);
      };

      const processOrderBookData = (data: any) => {
        if (!isMounted) return;
        if (data.bids && data.asks && data.bids.length > 0 && data.asks.length > 0) {
          let currentTotal = 0;
          const formattedBids = data.bids.slice(0, 15).map((b: string[]) => {
            const amount = parseFloat(b[1]);
            currentTotal += amount;
            return { price: parseFloat(b[0]), amount, total: currentTotal };
          });

          currentTotal = 0;
          const formattedAsks = data.asks.slice(0, 15).map((a: string[]) => {
            const amount = parseFloat(a[1]);
            currentTotal += amount;
            return { price: parseFloat(a[0]), amount, total: currentTotal };
          }).reverse();

          setBids(formattedBids);
          setAsks(formattedAsks);
          setLoading(false);
        } else {
          setLoading(false);
          if (restInterval) {
            clearInterval(restInterval);
          }
        }
      };

      const connectWebSocket = (useUS: boolean = false) => {
        if (!isMounted) return;
        
        const baseUrl = useUS ? 'wss://stream.binance.us' : 'wss://stream.binance.com';
        ws = new WebSocket(`${baseUrl}/ws/${symbol}@depth20@100ms`);

        const connectionTimeout = setTimeout(() => {
          if (ws && ws.readyState !== WebSocket.OPEN) {
            console.log(`WebSocket connection timeout (${baseUrl}), falling back...`);
            ws.onerror = null; // Prevent double fallback
            ws.close();
            if (!useUS && isMounted) {
              connectWebSocket(true);
            } else if (isMounted) {
              startRestPolling();
            }
          }
        }, 5000);

        ws.onopen = () => {
          clearTimeout(connectionTimeout);
        };

        ws.onmessage = (event) => {
          if (!isMounted) return;
          try {
            const data = JSON.parse(event.data);
            
            if (data.code || data.msg) {
              console.error('Binance WebSocket error:', data.msg);
              if (!useUS) {
                console.log('Falling back to Binance.us...');
                if (ws) ws.close();
                connectWebSocket(true);
              } else {
                console.log('Falling back to REST API...');
                if (ws) ws.close();
                startRestPolling();
              }
              return;
            }

            processOrderBookData(data);
          } catch (e) {
            console.error('Error parsing order book data:', e);
          }
        };

        ws.onerror = (error) => {
          clearTimeout(connectionTimeout);
          console.error(`OrderBook WebSocket error (${baseUrl}):`, error);
          if (!useUS && isMounted) {
            console.log('Falling back to Binance.us...');
            if (ws) ws.close();
            connectWebSocket(true);
          } else if (isMounted) {
            console.log('Falling back to REST API...');
            if (ws) ws.close();
            startRestPolling();
          }
        };

        ws.onclose = () => {
          // Do nothing on close, let onerror handle the fallback
        };
      };

      connectWebSocket(false);
    } else {
      // For non-crypto, we don't have a free live order book API easily available in this environment
      // We'll just show a message
      setLoading(false);
    }

    return () => {
      isMounted = false;
      if (ws) ws.close();
      if (restInterval) clearInterval(restInterval);
    };
  }, [asset]);

  if (!isCryptoAsset(asset)) {
    return (
      <div className="w-full md:w-64 md:border-l border-[#1F2937] bg-[#0B0E14] flex flex-col shrink-0 h-full">
        <div className="p-3 border-b border-[#1F2937] font-semibold text-sm text-gray-200">Order Book</div>
        <div className="flex-1 flex items-center justify-center p-4 text-center text-gray-500 text-sm">
          Live order book is only available for crypto assets.
        </div>
      </div>
    );
  }

  const maxTotal = Math.max(
    bids.length > 0 ? bids[bids.length - 1].total : 0,
    asks.length > 0 ? asks[0].total : 0,
    1 // Prevent division by zero
  );

  return (
    <div className="w-full md:w-64 md:border-l border-[#1F2937] bg-[#0B0E14] flex flex-col shrink-0 overflow-hidden text-xs font-mono h-full">
      <div className="p-3 border-b border-[#1F2937] font-semibold text-sm text-gray-200 font-sans flex justify-between items-center">
        <span>Order Book</span>
        <span className="text-xs text-gray-500 font-normal">USDT</span>
      </div>
      
      <div className="flex justify-between px-3 py-2 text-gray-500 border-b border-[#1F2937]/50">
        <span>Price</span>
        <span>Amount</span>
        <span>Total</span>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#2962FF]"></div>
        </div>
      ) : bids.length === 0 && asks.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-4 text-center text-gray-500 text-sm">
          No order book data available for this asset.
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-y-auto custom-scrollbar">
          {/* Asks (Sell Orders) */}
          <div className="flex flex-col justify-end flex-1">
            {asks.map((ask, i) => {
              const depthPercentage = (ask.total / maxTotal) * 100;
              return (
                <div key={`ask-${i}`} className="flex justify-between px-3 py-1 relative group cursor-pointer hover:bg-[#1F2937]/50">
                  <div 
                    className="absolute top-0 right-0 h-full bg-[#FF1744]/10 transition-all" 
                    style={{ width: `${depthPercentage}%` }}
                  />
                  <span className="text-[#FF1744] z-10">{ask.price.toFixed(2)}</span>
                  <span className="text-gray-300 z-10">{ask.amount.toFixed(4)}</span>
                  <span className="text-gray-500 z-10">{ask.total.toFixed(4)}</span>
                </div>
              );
            })}
          </div>

          {/* Spread / Current Price Area */}
          <div className="py-2 px-3 border-y border-[#1F2937] bg-[#111827] flex items-center justify-center gap-2">
            {asks.length > 0 && bids.length > 0 && (
              <>
                <span className="text-lg font-bold text-white">
                  {bids[0].price.toFixed(2)}
                </span>
                <span className="text-gray-500 text-[10px]">
                  Spread: {(asks[asks.length - 1].price - bids[0].price).toFixed(2)}
                </span>
              </>
            )}
          </div>

          {/* Bids (Buy Orders) */}
          <div className="flex flex-col flex-1">
            {bids.map((bid, i) => {
              const depthPercentage = (bid.total / maxTotal) * 100;
              return (
                <div key={`bid-${i}`} className="flex justify-between px-3 py-1 relative group cursor-pointer hover:bg-[#1F2937]/50">
                  <div 
                    className="absolute top-0 right-0 h-full bg-[#00E676]/10 transition-all" 
                    style={{ width: `${depthPercentage}%` }}
                  />
                  <span className="text-[#00E676] z-10">{bid.price.toFixed(2)}</span>
                  <span className="text-gray-300 z-10">{bid.amount.toFixed(4)}</span>
                  <span className="text-gray-500 z-10">{bid.total.toFixed(4)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
