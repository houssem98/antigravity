"""
Crypto signals — multi-source free + paid adapters (plan §6.8).

Free path (default, no keys):
  - DefiLlama        — TVL, protocols, chains, stablecoins, yields
  - Coinpaprika      — global + per-coin OHLC, tickers
  - Messari (free)   — assets metrics + news + governance + research
  - CoinGecko        — already wired in market-ui; mirrored here for backend

Paid path (env-gated, stub returns [] when key absent):
  - Kaiko            — spot + derivatives + order book (avg $28.5K/yr)
  - Glassnode        — on-chain metrics, enterprise

All adapters emit `RetrievalResult` objects with:
  document_type = "crypto"
  source_quality = 4   (data is real, but volatile + speculative)
  metadata.kind = "tvl" | "ohlc" | "onchain" | "news" | "stablecoin"

Use cases:
  - "What's Ethereum 24h TVL change?" -> DefiLlama
  - "USDC stablecoin supply by chain?" -> DefiLlama stablecoins
  - "Top DEXs by 7d volume?" -> DefiLlama protocols
  - "BTC realized cap Q1 2026?" -> Glassnode (paid)
  - "ETH spot vs perp basis?" -> Kaiko (paid)
"""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from typing import Optional
from urllib.parse import quote

import structlog

from app.core.retrieval.fusion import RetrievalResult

logger = structlog.get_logger()


_USER_AGENT = "GravitySearch/1.0 (gravity@antigravity.ai)"

# Free public bases — no auth.
_DEFILLAMA_BASE = "https://api.llama.fi"
_DEFILLAMA_PRO_BASE = "https://api.llama.fi"       # /yields uses different path; same host
_DEFILLAMA_STABLE_BASE = "https://stablecoins.llama.fi"
_COINPAPRIKA_BASE = "https://api.coinpaprika.com/v1"
_MESSARI_BASE = "https://data.messari.io/api/v1"
_COINGECKO_BASE = "https://api.coingecko.com/api/v3"

# Paid (env-gated).
_KAIKO_BASE = "https://us.market-api.kaiko.io/v2"
_GLASSNODE_BASE = "https://api.glassnode.com/v1"


# ─── Data classes ─────────────────────────────────────────────────────────────

@dataclass
class CryptoSignal:
    source: str           # "defillama" | "coinpaprika" | "messari" | "coingecko" | "kaiko" | "glassnode"
    kind: str             # "tvl" | "ohlc" | "onchain" | "news" | "stablecoin" | "protocol"
    asset: str            # symbol or protocol slug
    title: str
    body: str
    url: str
    metric_value: Optional[float] = None
    metric_unit: str = ""
    timestamp: str = ""


# ─── DefiLlama (free) ─────────────────────────────────────────────────────────

async def fetch_defillama_protocols(top_n: int = 50, timeout: float = 8.0) -> list[CryptoSignal]:
    """Top DeFi protocols by TVL."""
    import httpx
    url = f"{_DEFILLAMA_BASE}/protocols"
    try:
        async with httpx.AsyncClient(timeout=timeout, headers={"User-Agent": _USER_AGENT}) as c:
            r = await c.get(url)
        if r.status_code != 200:
            return []
        data = r.json()
    except Exception as e:
        logger.debug("defillama_protocols_failed", error=str(e))
        return []

    data.sort(key=lambda p: p.get("tvl") or 0, reverse=True)
    out: list[CryptoSignal] = []
    for p in data[:top_n]:
        tvl = float(p.get("tvl") or 0)
        chg = float(p.get("change_1d") or 0)
        chains = ", ".join(p.get("chains", [])[:5])
        body = (
            f"{p.get('name','')} ({p.get('symbol','') or '?'}) — "
            f"TVL ${tvl/1e9:.2f}B, 24h {chg:+.2f}%, "
            f"category {p.get('category','?')}, chains {chains}"
        )
        out.append(CryptoSignal(
            source="defillama", kind="protocol",
            asset=p.get("slug", "") or p.get("name", ""),
            title=f"{p.get('name','')} TVL",
            body=body,
            url=f"https://defillama.com/protocol/{p.get('slug','')}",
            metric_value=tvl, metric_unit="USD",
        ))
    return out


async def fetch_defillama_chain_tvl(timeout: float = 8.0) -> list[CryptoSignal]:
    """TVL by chain."""
    import httpx
    try:
        async with httpx.AsyncClient(timeout=timeout, headers={"User-Agent": _USER_AGENT}) as c:
            r = await c.get(f"{_DEFILLAMA_BASE}/v2/chains")
        if r.status_code != 200:
            return []
        chains = r.json()
    except Exception:
        return []

    chains.sort(key=lambda x: x.get("tvl") or 0, reverse=True)
    out: list[CryptoSignal] = []
    for c in chains[:30]:
        tvl = float(c.get("tvl") or 0)
        out.append(CryptoSignal(
            source="defillama", kind="tvl",
            asset=c.get("name", ""),
            title=f"{c.get('name','')} chain TVL",
            body=f"{c.get('name','')} chain holds ${tvl/1e9:.2f}B in TVL across DeFi protocols.",
            url=f"https://defillama.com/chain/{quote(c.get('name',''))}",
            metric_value=tvl, metric_unit="USD",
        ))
    return out


async def fetch_defillama_stablecoins(timeout: float = 8.0) -> list[CryptoSignal]:
    """Stablecoin circulating supply + peg deviation."""
    import httpx
    try:
        async with httpx.AsyncClient(timeout=timeout, headers={"User-Agent": _USER_AGENT}) as c:
            r = await c.get(f"{_DEFILLAMA_STABLE_BASE}/stablecoins?includePrices=true")
        if r.status_code != 200:
            return []
        data = r.json().get("peggedAssets", [])
    except Exception:
        return []

    out: list[CryptoSignal] = []
    for s in data[:20]:
        circ = (s.get("circulating") or {}).get("peggedUSD", 0)
        try:
            circ = float(circ)
        except (ValueError, TypeError):
            circ = 0.0
        price = s.get("price")
        peg_dev = ""
        if price is not None:
            try:
                pf = float(price)
                peg_dev = f", peg ${pf:.4f} ({(pf-1)*100:+.2f}%)"
            except (ValueError, TypeError):
                pass
        body = (
            f"{s.get('name','')} ({s.get('symbol','')}) stablecoin — "
            f"circulating ${circ/1e9:.2f}B, "
            f"mechanism {s.get('pegMechanism','?')}{peg_dev}"
        )
        out.append(CryptoSignal(
            source="defillama", kind="stablecoin",
            asset=s.get("symbol", ""),
            title=f"{s.get('symbol','')} stablecoin",
            body=body,
            url=f"https://defillama.com/stablecoin/{s.get('symbol','').lower()}",
            metric_value=circ, metric_unit="USD",
        ))
    return out


async def fetch_defillama_yields(top_n: int = 30, timeout: float = 8.0) -> list[CryptoSignal]:
    """Top yield-bearing pools."""
    import httpx
    try:
        async with httpx.AsyncClient(timeout=timeout, headers={"User-Agent": _USER_AGENT}) as c:
            r = await c.get("https://yields.llama.fi/pools")
        if r.status_code != 200:
            return []
        pools = r.json().get("data", [])
    except Exception:
        return []

    # Filter: at least $1M TVL + APY available, sort by APY desc
    pools = [p for p in pools if (p.get("tvlUsd") or 0) > 1_000_000 and p.get("apy") is not None]
    pools.sort(key=lambda x: x.get("apy") or 0, reverse=True)

    out: list[CryptoSignal] = []
    for p in pools[:top_n]:
        apy = float(p.get("apy") or 0)
        tvl = float(p.get("tvlUsd") or 0)
        body = (
            f"{p.get('project','')} pool {p.get('symbol','')} on {p.get('chain','')} — "
            f"APY {apy:.2f}%, TVL ${tvl/1e6:.1f}M"
        )
        out.append(CryptoSignal(
            source="defillama", kind="yield",
            asset=p.get("symbol", ""),
            title=f"{p.get('project','')} {p.get('symbol','')} yield",
            body=body,
            url="https://defillama.com/yields",
            metric_value=apy, metric_unit="percent",
        ))
    return out


# ─── Coinpaprika (free) ───────────────────────────────────────────────────────

async def fetch_coinpaprika_global(timeout: float = 8.0) -> list[CryptoSignal]:
    """Global crypto market stats."""
    import httpx
    try:
        async with httpx.AsyncClient(timeout=timeout, headers={"User-Agent": _USER_AGENT}) as c:
            r = await c.get(f"{_COINPAPRIKA_BASE}/global")
        if r.status_code != 200:
            return []
        g = r.json()
    except Exception:
        return []

    body = (
        f"Total crypto market cap ${(g.get('market_cap_usd',0) or 0)/1e12:.2f}T, "
        f"24h vol ${(g.get('volume_24h_usd',0) or 0)/1e9:.1f}B, "
        f"BTC dominance {g.get('bitcoin_dominance_percentage',0):.1f}%, "
        f"{g.get('cryptocurrencies_number',0)} cryptocurrencies tracked"
    )
    return [CryptoSignal(
        source="coinpaprika", kind="global",
        asset="MARKET",
        title="Global Crypto Market Stats",
        body=body,
        url="https://coinpaprika.com/",
        metric_value=g.get("market_cap_usd"), metric_unit="USD",
    )]


async def fetch_coinpaprika_top_coins(top_n: int = 50, timeout: float = 8.0) -> list[CryptoSignal]:
    """Top N coins by rank."""
    import httpx
    try:
        async with httpx.AsyncClient(timeout=timeout, headers={"User-Agent": _USER_AGENT}) as c:
            r = await c.get(f"{_COINPAPRIKA_BASE}/tickers?limit={top_n}")
        if r.status_code != 200:
            return []
        coins = r.json()
    except Exception:
        return []

    out: list[CryptoSignal] = []
    for c in coins[:top_n]:
        q = (c.get("quotes") or {}).get("USD") or {}
        price = float(q.get("price") or 0)
        chg = float(q.get("percent_change_24h") or 0)
        mcap = float(q.get("market_cap") or 0)
        body = (
            f"{c.get('name','')} ({c.get('symbol','')}) — "
            f"price ${price:,.2f}, 24h {chg:+.2f}%, "
            f"market cap ${mcap/1e9:.2f}B, rank #{c.get('rank','?')}"
        )
        out.append(CryptoSignal(
            source="coinpaprika", kind="ticker",
            asset=c.get("symbol", ""),
            title=f"{c.get('symbol','')} price",
            body=body,
            url=f"https://coinpaprika.com/coin/{c.get('id','')}/",
            metric_value=price, metric_unit="USD",
            timestamp=q.get("timestamp", "") or "",
        ))
    return out


# ─── Messari (free tier — limited rate) ───────────────────────────────────────

async def fetch_messari_news(top_n: int = 20, timeout: float = 8.0) -> list[CryptoSignal]:
    """Latest crypto news from Messari."""
    import httpx
    headers = {"User-Agent": _USER_AGENT, "Accept": "application/json"}
    api_key = os.getenv("MESSARI_API_KEY", "")
    if api_key:
        headers["x-messari-api-key"] = api_key
    try:
        async with httpx.AsyncClient(timeout=timeout, headers=headers) as c:
            r = await c.get(f"{_MESSARI_BASE}/news", params={"limit": top_n})
        if r.status_code != 200:
            return []
        data = r.json().get("data", [])
    except Exception:
        return []

    out: list[CryptoSignal] = []
    for n in data[:top_n]:
        title = n.get("title", "")
        body = (n.get("content") or n.get("summary") or "")[:1500]
        if not body:
            body = title
        out.append(CryptoSignal(
            source="messari", kind="news",
            asset=", ".join(a.get("symbol", "") for a in (n.get("references") or [])[:5]),
            title=title[:300],
            body=body,
            url=n.get("url", ""),
            timestamp=n.get("published_at", "") or "",
        ))
    return out


# ─── CoinGecko backend mirror (free) ──────────────────────────────────────────

async def fetch_coingecko_trending(timeout: float = 8.0) -> list[CryptoSignal]:
    """Trending coins on CoinGecko (last 24h)."""
    import httpx
    try:
        async with httpx.AsyncClient(timeout=timeout, headers={"User-Agent": _USER_AGENT}) as c:
            r = await c.get(f"{_COINGECKO_BASE}/search/trending")
        if r.status_code != 200:
            return []
        data = r.json().get("coins", [])
    except Exception:
        return []

    out: list[CryptoSignal] = []
    for entry in data[:10]:
        coin = entry.get("item") or {}
        body = (
            f"{coin.get('name','')} ({coin.get('symbol','')}) trending on CoinGecko — "
            f"rank #{coin.get('market_cap_rank','?')}, "
            f"score {coin.get('score','?')}"
        )
        out.append(CryptoSignal(
            source="coingecko", kind="trending",
            asset=coin.get("symbol", ""),
            title=f"{coin.get('symbol','')} trending",
            body=body,
            url=f"https://www.coingecko.com/en/coins/{coin.get('id','')}",
        ))
    return out


# ─── Kaiko (paid, stub) ───────────────────────────────────────────────────────

async def fetch_kaiko_spot(symbol: str, exchange: str = "cbse", timeout: float = 8.0) -> list[CryptoSignal]:
    """Kaiko spot price; requires KAIKO_API_KEY. Returns [] without key."""
    api_key = os.getenv("KAIKO_API_KEY", "")
    if not api_key:
        return []
    import httpx
    url = f"{_KAIKO_BASE}/data/trades.v1/exchanges/{exchange}/spot/{symbol}/aggregations/ohlcv"
    try:
        async with httpx.AsyncClient(timeout=timeout) as c:
            r = await c.get(url, headers={"X-Api-Key": api_key, "User-Agent": _USER_AGENT})
        if r.status_code != 200:
            logger.warning("kaiko_status", status=r.status_code, body=r.text[:200])
            return []
        body = r.json().get("data", [])
    except Exception as e:
        logger.warning("kaiko_failed", error=str(e))
        return []

    out: list[CryptoSignal] = []
    for bar in body[:5]:
        out.append(CryptoSignal(
            source="kaiko", kind="ohlc",
            asset=symbol,
            title=f"{symbol} Kaiko OHLC ({exchange})",
            body=f"{symbol} on {exchange}: O ${bar.get('open',0)} H ${bar.get('high',0)} L ${bar.get('low',0)} C ${bar.get('close',0)} V {bar.get('volume',0)}",
            url=f"https://www.kaiko.com/",
            metric_value=float(bar.get("close", 0) or 0), metric_unit="USD",
            timestamp=str(bar.get("timestamp", "")),
        ))
    return out


# ─── Glassnode (paid, stub) ───────────────────────────────────────────────────

async def fetch_glassnode_metric(asset: str, metric: str = "market/price_usd_close", timeout: float = 8.0) -> list[CryptoSignal]:
    """Glassnode on-chain metric; requires GLASSNODE_API_KEY. Returns [] without key."""
    api_key = os.getenv("GLASSNODE_API_KEY", "")
    if not api_key:
        return []
    import httpx
    url = f"{_GLASSNODE_BASE}/metrics/{metric}"
    try:
        async with httpx.AsyncClient(timeout=timeout) as c:
            r = await c.get(url, params={"a": asset, "api_key": api_key})
        if r.status_code != 200:
            return []
        rows = r.json()
    except Exception as e:
        logger.warning("glassnode_failed", error=str(e))
        return []

    if not rows:
        return []
    latest = rows[-1]
    return [CryptoSignal(
        source="glassnode", kind="onchain",
        asset=asset,
        title=f"{asset} {metric}",
        body=f"{asset} {metric} latest = {latest.get('v')} (t={latest.get('t')})",
        url=f"https://glassnode.com/metrics?a={asset}&m={metric}",
        metric_value=float(latest.get("v") or 0),
        metric_unit="",
        timestamp=str(latest.get("t", "")),
    )]


# ─── Aggregator ───────────────────────────────────────────────────────────────

async def fetch_all_crypto_signals(
    include_protocols: bool = True,
    include_chains: bool = True,
    include_stablecoins: bool = True,
    include_yields: bool = False,
    include_news: bool = True,
    include_top_coins: bool = True,
    include_trending: bool = True,
) -> list[CryptoSignal]:
    """Fan out to all free sources concurrently."""
    tasks = []
    if include_protocols:    tasks.append(fetch_defillama_protocols())
    if include_chains:       tasks.append(fetch_defillama_chain_tvl())
    if include_stablecoins:  tasks.append(fetch_defillama_stablecoins())
    if include_yields:       tasks.append(fetch_defillama_yields())
    if include_news:         tasks.append(fetch_messari_news())
    if include_top_coins:    tasks.append(fetch_coinpaprika_top_coins())
    if include_trending:     tasks.append(fetch_coingecko_trending())
    nested = await asyncio.gather(*tasks, return_exceptions=True)
    out: list[CryptoSignal] = []
    for n in nested:
        if isinstance(n, list):
            out.extend(n)
        elif isinstance(n, Exception):
            logger.debug("crypto_task_failed", error=str(n))
    return out


def crypto_signals_to_results(
    signals: list[CryptoSignal],
    max_results: int = 100,
) -> list[RetrievalResult]:
    """Convert CryptoSignal list to RetrievalResult."""
    out: list[RetrievalResult] = []
    for s in signals[:max_results]:
        text = (s.title + "\n" + s.body).strip() if s.title else s.body
        if not text:
            continue
        out.append(RetrievalResult(
            chunk_id=f"{s.source}::{s.kind}::{s.asset}",
            document_id=f"{s.source}::{s.kind}::{s.asset}",
            text=text[:2500],
            score=0.5,
            metadata={
                "source": s.source,
                "kind": s.kind,
                "asset": s.asset,
                "url": s.url,
                "source_url": s.url,
                "metric_value": s.metric_value,
                "metric_unit": s.metric_unit,
                "timestamp": s.timestamp,
            },
            document_title=s.title[:200],
            document_type="crypto",
            source_quality=4,
            ticker=s.asset,
        ))
    logger.info("crypto_to_results", count=len(out))
    return out
