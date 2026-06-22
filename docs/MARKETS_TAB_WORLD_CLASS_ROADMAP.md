# World-Class Markets Tab Roadmap

**Goal:** Transform Markets tab from mock data → production-grade with live data, premium design, and flawless UX.

---

## 1. Current State vs Target

| Aspect | Current | Target |
|--------|---------|--------|
| **Data** | Mock (8 rows, static) | Live (100+ pairs, 60s updates) |
| **Sources** | None | CoinGecko + Binance API + fallback |
| **Design** | Good (premium layout done) | Excellent (cohesion, interactions, polish) |
| **Performance** | Fast (no API calls) | Fast (<1.5s data load, cached) |
| **UX** | Basic filters | Search, sort, advanced filters, export |
| **Error Handling** | None | Graceful fallback, retry logic, offline mode |
| **Real-time** | No | Live updates (1-5s tick) |

---

## 2. Phase 1: Live Data Integration (8-12h)

### 2.1 Data Pipeline

**Data Sources (Priority Order):**
1. **CoinGecko API** (free tier: 500 calls/min, no auth needed)
   - `/simple/price` → get live prices, market caps, 24h volumes
   - `/coins/markets` → get exchange data by pair
   - `/coins/{id}/markets` → get detailed market data per exchange
   
2. **Binance API** (free tier: 1200 req/min)
   - `GET /api/v3/ticker/24hr` → volume, price, depth
   - `GET /api/v3/depth?symbol=BTCUSDT` → order book depth
   - Real-time updates via WebSocket (bid/ask streams)

3. **Fallback** (mock data when APIs down)
   - Serve last-cached data + "stale data" warning
   - Never blank, never broken

### 2.2 Backend Changes

**New Files:**
- `app/services/markets/exchange_data_service.py` — orchestrate CoinGecko + Binance
- `app/services/markets/caching_layer.py` — Redis cache (60s TTL)
- `app/api/routes/markets.py` — `/api/markets/data` endpoint (replace mock)

**New Endpoint:**
```python
GET /api/markets/data?asset=BTC&limit=50&sort=volume&order=desc
# Returns: { exchanges: [...], metadata: { updated_at, source, version } }
```

**Example Response:**
```json
{
  "asset": "BTC",
  "exchanges": [
    {
      "rank": 1,
      "name": "Binance",
      "pair": "BTC/USDT",
      "price": "$64,558.19",
      "depth": { "bid": "$16.6M", "ask": "$23.3M" },
      "volume24h": "$1.23B",
      "volumePercent": "3.95%",
      "liquidity": 791,
      "spreadBps": 1.2,
      "lastUpdate": "2min ago"
    }
  ],
  "metadata": {
    "updated_at": "2026-06-22T15:30:00Z",
    "source": "binance+coingecko",
    "cached": false,
    "health": "healthy"
  }
}
```

### 2.3 Frontend Changes

**Update MarketsTab.tsx:**
- Replace mock EXCHANGES_DATA with API fetch
- Add loading skeleton while fetching
- Add error state with retry button
- Real-time tick updates (WebSocket or poll every 5s)
- Add "Last updated 2 min ago" metadata footer

**New Hook:**
- `useMarketsData()` — fetch, cache, refetch on interval
- Retry logic (exponential backoff)
- Stale data detection + warning

**Files to Update:**
- `src/components/trading/tabs/MarketsTab.tsx` — integrate live data
- `src/hooks/useMarketsData.ts` — data fetching + caching
- `src/services/trading/marketsAPI.ts` — API client

---

## 3. Phase 2: Premium Design & Interactions (6-10h)

### 3.1 Visual Polish

**Enhancements:**
- **Skeleton loading** — shimmer effect while fetching
- **Live ticker animation** — price changes flash green/red (brief 500ms highlight)
- **Depth visualization** → horizontal bar chart (bid/ask imbalance)
- **Liquidity indicator** → color-coded bars (green=high, yellow=med, red=low)
- **Spread indicator** → badge showing bid-ask spread (tight=green, wide=red)

### 3.2 Interactions

**Search:**
- Search by exchange name or pair
- Fuzzy match (e.g., "binance btc" finds "Binance BTC/USDT")
- Highlight matched text

**Sort:**
- Click column headers to sort (volume, price, depth, liquidity)
- Multi-column sort (hold Shift)
- Sort direction indicator (↑/↓)

**Advanced Filters:**
- Filter by CEX/DEX
- Filter by volume range (>$100M, >$500M, >$1B)
- Filter by spread (<5bps, <10bps, <20bps)
- Filter by liquidity tier (>500, >1000)

**Row Actions:**
- Click row → expand details (candle chart, depth chart, recent trades)
- Long press → copy pair
- Right-click → context menu (copy, share, add to watchlist)

### 3.3 Cohesion Tweaks

**Color Coding:**
- Volume: bright green (high) → grey (low)
- Spread: green (tight) → red (wide)
- Liquidity: 5-bar gradient (dark→bright green)
- Volume change: +5% = lighter, bright green; -5% = muted red

**Typography Hierarchy:**
- Exchange name: bold, larger
- Pair: monospace, secondary color
- Metrics: mono, right-aligned, numerical

**Spacing & Alignment:**
- Consistent padding: 12px grid
- Header sticky on scroll (like current)
- Footer stats pinned at bottom (volume, spread, liquidity averages)

---

## 4. Phase 3: Real-Time Updates (4-8h)

### 4.1 WebSocket Streaming (Optional, High-Value)

**Approach 1: Binance WebSocket** (Recommended)
```
wss://stream.binance.com:9443/ws/btcusdt@aggTrade
wss://stream.binance.com:9443/ws/btcusdt@depth@100ms
```
- Subscribe to top 20 pairs
- Update price every 100ms
- Update depth every 500ms
- Auto-reconnect on disconnect

**Approach 2: Polling** (Simpler, Lower-Cost)
```
GET /api/markets/data every 5 seconds
```
- Lower cost (no WebSocket overhead)
- Slight delay but acceptable
- Easier error handling

### 4.2 Frontend Integration

**Update useMarketsData():**
- Add WebSocket subscription (or poll interval)
- Diff incoming data vs rendered
- Only re-render changed rows (React.memo)
- Flash animation on price change

**Performance:**
- Virtualization (react-window) → render only visible rows
- Skip animation if <100ms since last update (prevents flicker)
- Throttle updates (10 updates/sec max)

---

## 5. Phase 4: Advanced Features (8-12h, Optional)

### 5.1 Comparison Mode

**Feature:**
- Select 2 pairs → side-by-side comparison
- Depth visualization (bid/ask overlap)
- Spread efficiency score
- Liquidity per $1M volume

### 5.2 Watchlist / Alerts

**Persistent Watchlist:**
- Save favorite pairs (localStorage)
- Pin to top of table
- Star icon toggle

**Price Alerts:**
- Alert when price breaches level
- Alert when spread widens beyond X bps
- Alert when volume spikes >50%

### 5.3 Export / Share

**Export:**
- Download as CSV (asset, pair, price, depth, volume, liquidity, spread)
- Share snapshot (JSON link, encoded in URL)

### 5.4 Depth / Spread Visualization

**New Tab Variant:**
- Markets → Depth (side-by-side bid/ask volume bars)
- Markets → Spread (scatter: spread bps vs volume)
- Markets → Liquidity Heatmap (grid: asset × exchange, color=liquidity)

---

## 6. Error Handling & Resilience

### 6.1 Failure Scenarios

| Scenario | Handling |
|----------|----------|
| **API down** | Show cached data + warning "Last updated X ago" |
| **Slow API** | Show skeleton for 2s, timeout after 5s, serve stale |
| **Partial data** (1 pair missing) | Show what's available, mark missing with "—" |
| **Network error** | Retry exponential backoff (1s, 2s, 4s, 8s) |
| **Invalid data** (price=NaN) | Filter out, show "Unable to load pair" |

### 6.2 Health Indicator

**Footer:**
```
✅ Live — All data fresh (<1min)
⏱️  Cached — Last updated 5 min ago  
⚠️  Partial — 3/50 pairs unavailable
❌ Offline — Using cached data (24h old)
```

---

## 7. Implementation Timeline

| Phase | Effort | Duration | Blocker |
|-------|--------|----------|---------|
| **Phase 1** (Live data) | 8-12h | 2-3 days | None |
| **Phase 2** (Design + UX) | 6-10h | 2-3 days | Phase 1 done |
| **Phase 3** (Real-time) | 4-8h | 1-2 days | Phase 1 done (WebSocket optional) |
| **Phase 4** (Advanced) | 8-12h | 2-3 days | Phase 2 done |

**Total: 26-42 hours (~1 engineer, 2-3 weeks at 15h/week)**

**MVP Path (Phase 1 + 2): 14-22 hours (~1 week)**

---

## 8. Success Metrics

| Metric | Target | Current |
|--------|--------|---------|
| **Data freshness** | <1min | N/A (mock) |
| **Page load** | <1.5s | <500ms (mock) |
| **Real-time update** | <500ms latency | N/A |
| **Error resilience** | Always show data | N/A |
| **Design cohesion** | 4.5/5 (Figma review) | 4.0/5 |
| **User engagement** | 3+ interactions/session | N/A |

---

## 9. Data Source Selection

### CoinGecko (Primary)
✅ Free, no auth, 500 req/min  
✅ Multi-exchange data  
✅ Reliable, 99.9% uptime  
❌ 5-10s delay (cached data)  

**Use for:** Base data, fallback, history

### Binance API (Secondary)
✅ Real-time, <100ms latency  
✅ Depth, trades, WebSocket  
✅ 1200 req/min free  
❌ Binance pairs only (~300)  

**Use for:** Real-time updates, depth, live volume

### Fallback Strategy
If both down:
1. Check Redis cache
2. Serve cached data + "stale" warning
3. Show "Last updated X hours ago"
4. Show only pairs with recent cached data
5. Retry every 30s

---

## 10. Cost & Resource

| Resource | Cost | Notes |
|----------|------|-------|
| **CoinGecko API** | Free | Generous free tier |
| **Binance API** | Free | 1200 req/min enough |
| **Redis cache** | ~$5-10/mo | Already in infra |
| **Bandwidth** | Minimal | ~10KB per request |
| **Dev time** | 26-42h | 1 engineer, 2-3 weeks |

**Total first month: $5-15 + dev time**

---

## 11. Success Criteria (Ship When)

**Phase 1 + 2 Complete (MVP):**
- ✅ Live CoinGecko data flows through
- ✅ All Binance pairs (>300) show real prices
- ✅ Design polished (cohesion 4.5+)
- ✅ <1.5s initial load
- ✅ Error handling in place (always shows data)
- ✅ Mobile responsive
- ✅ A/B test vs mock: user engagement up 50%+

**Phase 3 Optional:**
- WebSocket for real-time if user demand exists

**Phase 4 Optional:**
- Advanced features based on user feedback
