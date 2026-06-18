# Hermes AI Agent Integration for Trading Features

**Status:** Aligns with `hermes-integration` branch, Phase 0 (safety net) in progress  
**Related:** `/HERMES_ROADMAP.md` (core search integration), `hermes_agent` package (v0.14.0)

**Goal:** Extend Hermes routing from search pipeline into trading UI (Markets, News, Yield, Holders, About) for real-time market analysis, synthesis, and risk flagging.

---

## 1. Hermes Foundation (Already In Place)

| Component | Status | Details |
|---|---|---|
| **Hermes Agent Package** | ✅ Installed | v0.14.0 in `.venv/Lib/site-packages` |
| **Feature Flags** | ✅ Ready | `HERMES_ENABLED`, `HERMES_ROUTE_PERCENTAGE` in config |
| **LLM Router** | ✅ Built | Routes by complexity; ready for Hermes fallback |
| **Eval Baseline** | 🔄 Phase 0 | Deepeval + `baseline_diff.py` auto-rollback |
| **Trading UI** | ✅ Just Built | Markets, News, Yield, Holders, About tabs |

**Current LLM Routes:**
- Gemini 2.5 Flash — 70% simple queries
- Claude Sonnet 4.5 — 20% multi-hop
- Claude Opus 4.6 — 8% advanced
- GPT-5.2 / DeepSeek — 2% math-heavy
- **Hermes (TBD)** — fallback OR cheap-route tier

---

## 2. Current State of Trading Features

### Markets Tab (Just Built)
- **Content:** Exchange pairs, 24h volumes, depth, liquidity
- **Data Source:** Mock EXCHANGES_DATA (8 rows)
- **Interaction:** Filter by CEX/DEX, hover effects
- **Missing:** Real-time data, analysis, synthesis

### Other Tabs (Built But Basic)
- **News:** Grid layout, filters (Top/Latest/CMC Daily)
- **Yield:** Providers table, CeFi/DeFi filter
- **Holders:** Top holders, concentration stats
- **About:** Asset info, links, technical details

---

## 3. Hermes Trading Integration Roadmap

### Core Strategy
Hermes enters trading UI via **trading-specific query channel** — separate from search-pipeline routing. This allows:
1. **No impact on search latency** — search pipeline unchanged during Phase 0/1 rollout
2. **Cheap to A/B test** — toggle on/off per tab without redeploying core API
3. **High-value analysis** — markets + news synthesis impossible without agent loop

---

## Phase 1T: Markets Tab "Ask Hermes" (Depends on Phase 1 Core)

**Prereq:** Core Hermes Phase 1 (LLM router integration) passes eval baseline  
**Effort:** 8-12 hours (UI + API bridge)

### Implementation

**Frontend:** `src/components/trading/tabs/MarketsPanel.tsx`
```jsx
<MarketsTab asset={currentAsset} />
  → Add floating button: "Ask Hermes why Binance 38%?"
  → Click → MarketsHermesPanel (right sidepanel)
  → Stream real-time answer + citations
```

**Backend:** New endpoint `/api/trading/markets/ask`
```python
@router.post("/trading/markets/ask")
async def ask_about_market(
    asset: str,
    question: str,
    context: dict,  # {exchanges: [...], asset_info: {...}}
):
    # Build Hermes query:
    query = f"Asset: {asset}. Markets data: {context}. User asks: {question}"
    
    # Route through Hermes if enabled + percentage hit:
    result = await query_hermes(
        query=query,
        reasoning_depth="fast",  # simple Hermes mode
        source_filter=["markets", "exchange_data"]
    )
    
    # Stream via WebSocket (same as search pipeline)
    for token in result.stream():
        yield token
```

**Example Queries Supported:**
- "Why is Binance 38% of volume?" → Hermes analyzes market concentration
- "Best liquidity for BTC/USDT?" → Compares depth across exchanges
- "Volume shifted vs yesterday?" → Trends + causes
- "Which exchange has fastest trade?" → Latency vs volume tradeoff

**Files to Create:**
- `src/components/trading/HermesQueryPanel.tsx` — sidepanel UI
- `src/services/trading/hermesMarketQuery.ts` — query builder
- `app/api/trading/markets/ask.py` — FastAPI endpoint
- `app/services/trading/market_context_builder.py` — embed market data for Hermes

**Success Metric:**
- Hermes answer latency < 3s (fast mode)
- Citations include exchange name + metric source
- Answer pass_rate ≥ baseline - 5%

---

## Phase 2T: Multi-Tab Synthesis (News → Markets → Yield) (Depends on Phase 1T + Phase 2 Core)

**Prereq:** Phase 1T (Ask Hermes) working + Phase 2 Core (skill templates) merged  
**Effort:** 10-14 hours

**Objective:** Hermes synthesizes across tabs — answers questions requiring 2+ data sources

**Example Queries:**
- "Why did BTC yield drop after the news?" → news sentiment + market impact + yield provider response
- "Did Binance's listing cause the volume spike?" → news event → exchange volume change
- "Is this coin concentrated or liquid?" → holders concentration + market depth

**Implementation:**
```python
# New endpoint: /api/trading/synthesis/query
# Takes: asset, question, enabled_tabs: ["news", "markets", "yield", "holders"]

context = {
    "news": fetch_latest_news(asset),
    "markets": fetch_exchange_data(asset),
    "yield": fetch_yield_providers(asset),
    "holders": fetch_top_holders(asset),
}

answer = await query_hermes(
    query=user_question,
    context=context,
    reasoning_depth="agentic",  # Allow multi-hop, requires agent loop
    max_hops=3  # Plan → Read → Synthesize
)
```

**Files to Create:**
- `src/components/trading/HermesSynthesisPanel.tsx` — multi-tab sidebar
- `src/services/trading/hermesContextAggregator.ts` — gather data from all tabs
- `app/api/trading/synthesis/query.py` — aggregation endpoint
- Add sentiment scoring to `NewsTab.tsx` (prep for synthesis)

**Success Metric:**
- Agentic queries < 8s latency
- Answer bridges ≥ 2 tabs
- Citation count ≥ 3 distinct sources per answer

---

## Phase 3T: Auto-Risk Alerts (Holders + Markets) (Depends on Phase 1T)

**Prereq:** Phase 1T working  
**Effort:** 4-6 hours

**Objective:** Hermes auto-runs on tab load, flags concentration/liquidity risks

**Implementation:**
```python
# Runs on TradingAssistantPage mount, only if asset changes
async def check_asset_safety(asset: str):
    data = {
        "holders": fetch_top_holders(asset),
        "markets": fetch_exchange_data(asset),
    }
    
    # Simple templated check (no agent loop needed)
    risks = await query_hermes(
        query=f"Is {asset} safe to trade? Check holder concentration + liquidity.",
        context=data,
        reasoning_depth="fast",  # template-based
        skill="risk_assessment"  # Phase 2 Core adds this
    )
    
    if risks.severity >= "HIGH":
        show_banner("⚠️ " + risks.summary)
```

**Example Alerts:**
- "Top 5 holders control 80% — HIGH CONCENTRATION RISK"
- "Only $50K depth on largest exchange — THIN LIQUIDITY"
- "94% volume on Binance — EXCHANGE CONCENTRATION"

**Files to Create:**
- `src/components/trading/HermesRiskBanner.tsx` — top-of-page banner
- `src/hooks/useAssetRiskCheck.ts` — auto-run on asset change
- `app/services/trading/risk_templates.py` — Hermes skill templates

**Success Metric:**
- Banner shows within 1.5s of asset load
- Risk score correlates with actual user trades (if tracked)

---

## Phase 4T: Yield Ranking by Market Conditions (Depends on Phase 2T)

**Prereq:** Phase 2T (synthesis) + Phase 4 Core (scheduled reports)  
**Effort:** 6-8 hours (lower priority)

**Objective:** Hermes recommends yield providers based on current markets

**Example:**
- "Bull market? Prefer high-risk CEX yields"
- "Bear market? Prefer stablecoin yields on blue-chip providers"
- "High volatility? Avoid leveraged yield strategies"

**Files to Create:**
- `src/services/trading/yieldRanker.ts` — context-aware ranking
- `app/services/trading/yield_templates.py` — Hermes skill

**Success Metric:** Yield recommendation changes with market conditions

---

## 4. Integration Timeline (Aligned with Core Hermes Phases)

### Concurrent Work (Phase 1T: Ask Hermes on Markets)

```
CORE HERMES                          TRADING HERMES
├─ Phase 0 (Baseline)    ────────────┬─ Start Phase 1T dev
├─ Phase 1 (Fallback)    ✓ REQUIRED  └─ Phase 1T unblocked
├─ Phase 2 (Skills)      ────────────┬─ Phase 2T dev (synthesis)
│                                    └─ Phase 3T dev (risk alerts)
└─ Phase 3 (Orchestrator)───────────── Phase 4T dev (optional)
```

**Detailed Timeline:**

| Week | Core Hermes | Trading Hermes | Blocker? |
|---|---|---|---|
| 1-2 | Phase 0 (safety net) | 1T design + API scaffolding | No |
| 2-3 | Phase 1 (LLM router) | 1T: MarketsPanel + endpoint | **YES** |
| 3-4 | Phase 1 eval + rollout | 1T QA + A/B test (5% users) | Parallel |
| 4-5 | Phase 2 (skills) | 2T: synthesis context builder | Parallel |
| 5-6 | Phase 2 eval | 2T + 3T: risk alerts | Parallel |
| 6-7 | Phase 3 (orchestrator) | 2T eval + 4T (optional) | Parallel |

**Total Effort (Trading-Only):**
- Phase 1T: 8-12 hours
- Phase 2T: 10-14 hours
- Phase 3T: 4-6 hours
- Phase 4T: 6-8 hours (optional)
- **Total: 28-40 hours** (~1-2 engineers, 3-4 weeks at 10h/week)

---

## 5. Architecture

### Data Flow
```
User in Trading UI
  ↓ [Ask Hermes about market]
  ↓
/api/trading/markets/ask  (NEW)
  ↓
app/services/trading/market_context_builder.py (NEW)
  ├─ Fetch live markets data (CoinGecko/Binance)
  ├─ Fetch asset info (About tab)
  └─ Embed context
  ↓
app/llm/router.py (MODIFIED)
  ├─ Check: HERMES_ENABLED + HERMES_ROUTE_PERCENTAGE
  ├─ Route to HermesRoute() if hit
  └─ Else: existing route (Gemini/Claude)
  ↓
hermes_agent (v0.14.0 package)
  ├─ Query understanding
  ├─ Plan → Read → Synthesize (if agentic)
  └─ Stream answer + citations
  ↓
WebSocket stream → Browser
  ↓
MarketsPanel (sidepanel UI) streams tokens in real-time
```

### Files to Create (Minimum Viable)

**Frontend (React):**
- `src/components/trading/HermesQueryPanel.tsx` — sidepanel + streaming
- `src/hooks/useHermesStream.ts` — WebSocket hook (can reuse from search)
- `src/services/trading/hermesAPI.ts` — API client

**Backend (Python):**
- `app/api/trading/__init__.py`
- `app/api/trading/markets.py` — `/ask` endpoint
- `app/services/trading/market_context_builder.py` — data preparation
- `app/services/trading/risk_templates.py` — Phase 3T (optional)

---

## 6. Success Metrics

| Phase | Metric | Target | Notes |
|---|---|---|---|
| **1T** | Latency (fast mode) | < 3s p95 | Comparable to search |
| **1T** | Answer relevance | ≥ baseline - 5% | Deepeval pass_rate |
| **1T** | Citation accuracy | 100% | No made-up sources |
| **2T** | Agentic latency | < 8s p95 | Allow agent loop time |
| **3T** | Risk alert accuracy | > 80% | Vs manual review |
| **3T** | False positive rate | < 10% | Too many alerts = noise |

---

## 7. Risks & Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Hermes Phase 1 slips | HIGH | Start 1T design immediately (not blocked) |
| Latency regresses | HIGH | A/B test at 5% before scaling |
| Hallucination on new coins | MEDIUM | Validate context freshness; deny unknown assets |
| Rate-limit exhaustion | LOW | Batch requests by 60s; use cheap Hermes tier |
| User confusion (too many panels) | MEDIUM | Launch with toggle flag; educate in tooltip |

---

## 8. Rollback Plan (Instant)

At any phase, if metrics regress:

```bash
# Disable trading Hermes (same flags as core)
fly secrets set HERMES_ENABLED=false -a gravity-api-prod
fly deploy -a gravity-api-prod

# Revert Git (nuclear option)
git reset --hard hermes-phase-1T-stable  # (create branch after each phase passes)
```

---

## 9. NOT in Scope

- On-chain data (requires additional API/RPC)
- Predictive models (ML training scope)
- Portfolio tracking / PnL
- Backtesting
- Custom alerts (Phase 5+ if user demand)

---

## 10. Success = Shipped

**Minimum viable win:** Phase 1T shipped to 5% of users, latency < 3s, no regressions  
**Full win:** Phase 2T + 3T shipped, synthesis answers ≥ baseline - 5%, risk alerts > 80% accurate
