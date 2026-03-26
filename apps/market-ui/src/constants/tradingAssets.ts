export const CRYPTO_ASSETS = [
  { symbol: 'BTC', name: 'Bitcoin' },
  { symbol: 'ETH', name: 'Ethereum' },
  { symbol: 'SOL', name: 'Solana' },
  { symbol: 'BNB', name: 'Binance Coin' },
  { symbol: 'XRP', name: 'Ripple' },
  { symbol: 'ADA', name: 'Cardano' },
  { symbol: 'DOGE', name: 'Dogecoin' },
  { symbol: 'DOT', name: 'Polkadot' },
  { symbol: 'AVAX', name: 'Avalanche' },
  { symbol: 'LINK', name: 'Chainlink' },
  { symbol: 'MATIC', name: 'Polygon' },
  { symbol: 'SHIB', name: 'Shiba Inu' },
  { symbol: 'LTC', name: 'Litecoin' },
  { symbol: 'UNI', name: 'Uniswap' },
  { symbol: 'ATOM', name: 'Cosmos' },
];

export const STOCK_ASSETS = [
  { symbol: 'AAPL', name: 'Apple Inc.' },
  { symbol: 'MSFT', name: 'Microsoft Corp.' },
  { symbol: 'TSLA', name: 'Tesla Inc.' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.' },
  { symbol: 'NVDA', name: 'NVIDIA Corp.' },
  { symbol: 'META', name: 'Meta Platforms' },
  { symbol: 'NFLX', name: 'Netflix Inc.' },
  { symbol: 'AMD', name: 'Advanced Micro Devices' },
  { symbol: 'SPY', name: 'SPDR S&P 500 ETF' },
  { symbol: 'QQQ', name: 'Invesco QQQ Trust' },
  { symbol: 'INTC', name: 'Intel Corp.' },
  { symbol: 'BA', name: 'Boeing Co.' },
  { symbol: 'DIS', name: 'Walt Disney Co.' },
  { symbol: 'V', name: 'Visa Inc.' },
];

export const FOREX_ASSETS = [
  { symbol: 'EURUSD=X', name: 'EUR/USD' },
  { symbol: 'GBPUSD=X', name: 'GBP/USD' },
  { symbol: 'USDJPY=X', name: 'USD/JPY' },
  { symbol: 'AUDUSD=X', name: 'AUD/USD' },
  { symbol: 'USDCAD=X', name: 'USD/CAD' },
  { symbol: 'USDCHF=X', name: 'USD/CHF' },
  { symbol: 'NZDUSD=X', name: 'NZD/USD' },
  { symbol: 'EURGBP=X', name: 'EUR/GBP' },
  { symbol: 'EURJPY=X', name: 'EUR/JPY' },
  { symbol: 'GBPJPY=X', name: 'GBP/JPY' },
];

export const ALL_ASSETS = [
  ...CRYPTO_ASSETS.map(a => ({ ...a, type: 'Crypto' })),
  ...STOCK_ASSETS.map(a => ({ ...a, type: 'Stock' })),
  ...FOREX_ASSETS.map(a => ({ ...a, type: 'Forex' }))
];

export const isCryptoAsset = (symbol: string) => {
  const isStock = STOCK_ASSETS.some(a => a.symbol === symbol);
  const isForex = FOREX_ASSETS.some(a => a.symbol === symbol);
  return !isStock && !isForex;
};
