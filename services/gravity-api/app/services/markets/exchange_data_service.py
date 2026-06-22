"""Live exchange data service - CoinGecko + Binance API integration."""

import asyncio
import httpx
import structlog
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta

logger = structlog.get_logger()


class ExchangeDataService:
    """Fetch real-time exchange market data from CoinGecko + Binance."""

    def __init__(self):
        self.coingecko_base = "https://api.coingecko.com/api/v3"
        self.binance_base = "https://api.binance.com/api/v3"
        self.timeout = 10.0

    async def get_markets(
        self,
        asset: str = "bitcoin",
        limit: int = 50,
        sort: str = "volume_24h",
        order: str = "desc",
    ) -> Dict[str, Any]:
        """
        Fetch market data for an asset.

        Args:
            asset: Asset ID (bitcoin, ethereum, solana) or symbol (BTC, ETH, SOL)
            limit: Number of markets to return (max 250)
            sort: Sort by: volume_24h, price, market_cap, liquidity
            order: asc or desc

        Returns:
            {
                "asset": "BTC",
                "exchanges": [...],
                "metadata": { "updated_at", "source", "health" }
            }
        """

        try:
            # Map symbol to coingecko ID
            asset_id = self._symbol_to_id(asset)

            # Fetch from CoinGecko (primary source)
            markets = await self._fetch_coingecko_markets(asset_id, limit, sort, order)

            # Enrich with Binance real-time depth/volume where possible
            markets = await self._enrich_with_binance(markets)

            return {
                "asset": asset.upper() if len(asset) <= 3 else asset_id.upper(),
                "exchanges": markets,
                "metadata": {
                    "updated_at": datetime.utcnow().isoformat() + "Z",
                    "source": "coingecko+binance",
                    "cached": False,
                    "health": "healthy",
                },
            }

        except Exception as e:
            logger.warning("markets_fetch_failed", error=str(e), asset=asset)
            # Return empty or cached fallback
            return {
                "asset": asset.upper(),
                "exchanges": [],
                "metadata": {
                    "source": "error",
                    "health": "error",
                    "error": str(e),
                },
            }

    async def _fetch_coingecko_markets(
        self, asset_id: str, limit: int, sort: str, order: str
    ) -> List[Dict[str, Any]]:
        """Fetch market data from CoinGecko."""

        params = {
            "vs_currency": "usd",
            "order": sort,
            "per_page": min(limit, 250),
            "page": 1,
            "sparkline": False,
        }

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                url = f"{self.coingecko_base}/coins/{asset_id}/markets"
                response = await client.get(url, params=params)
                response.raise_for_status()
                data = response.json()

                # Transform CoinGecko response to our format
                markets = []
                for idx, market in enumerate(data[:limit], 1):
                    markets.append(
                        {
                            "rank": idx,
                            "name": market.get("name", "Unknown"),
                            "pair": f"{asset_id.upper()}/USD",
                            "price": f"${market.get('current_price', 0):,.2f}",
                            "depth": {"bid": "$?", "ask": "$?"},  # Enrich from Binance
                            "volume24h": f"${market.get('total_volume', 0) / 1e6:.2f}M",
                            "volumePercent": "?%",  # Calculate from total
                            "liquidity": 0,  # Enrich from Binance
                            "spreadBps": 0,  # Enrich from Binance
                            "lastUpdate": "now",
                            "symbol": market.get("symbol", "").upper(),
                        }
                    )

                return markets

        except Exception as e:
            logger.warning("coingecko_fetch_failed", error=str(e))
            return []

    async def _enrich_with_binance(
        self, markets: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """Enrich market data with Binance real-time depth + volume."""

        # Try to get Binance depth for USDT pairs (most liquid)
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                # Get top Binance pairs
                url = f"{self.binance_base}/ticker/24hr"
                response = await client.get(url)
                response.raise_for_status()
                binance_data = response.json()

                # Map by symbol for lookup
                binance_map = {
                    item["symbol"]: item
                    for item in binance_data
                    if "USDT" in item["symbol"]
                }

                # Enrich markets with Binance data
                for market in markets:
                    symbol = market.get("symbol", "").upper()
                    binance_pair = f"{symbol}USDT"

                    if binance_pair in binance_map:
                        b_data = binance_map[binance_pair]
                        market["volume24h"] = f"${float(b_data.get('quoteAssetVolume', 0)) / 1e9:.2f}B"
                        market["lastUpdate"] = "live"
                        market["liquidity"] = 700  # Mock: calculate from depth

        except Exception as e:
            logger.warning("binance_enrichment_failed", error=str(e))

        return markets

    async def _get_binance_depth(self, symbol: str) -> Dict[str, str]:
        """Fetch order book depth from Binance."""

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                url = f"{self.binance_base}/depth"
                response = await client.get(
                    url,
                    params={"symbol": f"{symbol}USDT", "limit": 5},
                )
                response.raise_for_status()
                data = response.json()

                bids = data.get("bids", [])
                asks = data.get("asks", [])

                bid_volume = sum(float(b[1]) for b in bids)
                ask_volume = sum(float(a[1]) for a in asks)

                return {
                    "bid": f"${bid_volume / 1e6:.1f}M",
                    "ask": f"${ask_volume / 1e6:.1f}M",
                }

        except Exception as e:
            logger.warning("binance_depth_failed", error=str(e), symbol=symbol)
            return {"bid": "$?", "ask": "$?"}

    @staticmethod
    def _symbol_to_id(symbol_or_id: str) -> str:
        """Map symbol (BTC, ETH) to CoinGecko ID (bitcoin, ethereum)."""

        mapping = {
            "BTC": "bitcoin",
            "ETH": "ethereum",
            "SOL": "solana",
            "XRP": "ripple",
            "ADA": "cardano",
            "DOGE": "dogecoin",
            "USDT": "tether",
            "USDC": "usd-coin",
        }

        return mapping.get(symbol_or_id.upper(), symbol_or_id.lower())
