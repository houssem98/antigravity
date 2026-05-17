# Cloud Deployment Quick Start

**Goal:** Ship Antigravity to cloud. Free tier auto-enabled. Localhost safe.

---

## What's Ready

✅ **Free tier wired:**
- 10 searches/day limit (enforced in `app/api/middleware/rate_limit.py`)
- Auto-assigned on signup
- No payment required

✅ **Multi-provider billing:**
- Paddle (Merchant of Record, works Tunisia ✓)
- PayPal
- Payoneer (manual)
- Crypto (BTC/ETH/USDT)

✅ **Config files created:**
- `apps/market-ui/.env.production` (for Vercel)
- `services/market-server/fly.toml` (for Fly.io)
- `services/gravity-api/fly.toml` (already exists)

✅ **Deploy scripts:**
- `scripts/deploy-to-cloud.sh` (macOS/Linux)
- `scripts/Deploy-ToCloud.ps1` (Windows)

✅ **Localhost isolated:**
- All hardcoded `localhost` URLs behind env var fallbacks
- Local `.env` unchanged
- Cloud uses Fly.io + Vercel URLs

---

## Deployment (Choose One)

### Option A: Automated Script (Easiest)

**Linux/macOS:**
```bash
bash scripts/deploy-to-cloud.sh
```

**Windows:**
```powershell
.\scripts\Deploy-ToCloud.ps1
```

Script handles: Fly.io setup + Vercel deploy + health checks.

### Option B: Manual Steps

See `DEPLOY_RUNBOOK.md` sections 0–8.

---

## Before Running Script

1. **Fly.io CLI installed:**
   ```bash
   brew install flyctl                    # macOS
   # Windows: iwr https://fly.io/install.ps1 -useb | iex
   fly auth login
   ```

2. **API keys ready (from local `.env`):**
   - `ANTHROPIC_API_KEY`
   - `COHERE_API_KEY`
   - `VOYAGE_API_KEY`
   - `DEEPSEEK_API_KEY`
   - `GROQ_API_KEY`
   - Paddle Vendor ID (optional)
   - PayPal Client ID + Secret (optional)
   - Payoneer email (optional)

3. **External services provisioned (free tiers):**
   - Qdrant Cloud (1 GB free)
   - Elastic Cloud (trial)
   - Neo4j Aura (free)

4. **Git committed:**
   ```bash
   git add -A && git commit -m "Deploy: ship to cloud"
   ```

---

## What Happens During Deploy

1. Creates Fly.io apps: `gravity-api-prod` + `market-server-prod`
2. Sets secrets (LLM keys, payment provider creds)
3. Deploys to Fly.io (auto-provisions Postgres + Redis)
4. Builds market-ui Vite bundle
5. Deploys to Vercel
6. Health checks all endpoints
7. Returns URLs for both services

---

## After Deploy

1. **Add custom domain:**
   - Vercel → Settings → Domains → add `antigravity.fyi`
   - Point DNS per Vercel instructions

2. **Update CORS:**
   ```bash
   fly secrets set -a gravity-api-prod CORS_ORIGINS=https://antigravity.fyi,https://www.antigravity.fyi
   fly deploy -a gravity-api-prod
   ```

3. **Test free tier:**
   - Visit `https://antigravity.fyi/auth`
   - Sign up → redirects to `/search`
   - Verify "Free" plan shown at `/billing`
   - Try 11 searches → 11th fails with 429

4. **Configure payments:**
   - Log in as admin
   - Go to `/admin/billing`
   - Edit plans/prices/providers/wallets
   - Test one provider checkout

---

## Rollback (If Needed)

Localhost still works perfectly. To rollback:

```bash
# Keep local dev running
npm run dev  # Still uses http://localhost:3002 + http://localhost:8000

# Or rollback Fly apps
fly rollback -a gravity-api-prod
fly rollback -a market-server-prod

# Or rollback Vercel
# Vercel dashboard → Deployments → revert to previous
```

---

## Cost Summary

| Service | Cost/mo |
|---------|---------|
| Fly.io (2 apps, shared CPU) | $5–15 |
| Elastic Cloud (trial 14d) | $0–95 |
| Qdrant Cloud free | $0 |
| Neo4j Aura free | $0 |
| Vercel Hobby | $0 |
| **First month** | **~$5–110** |
| **Month 2+** | **~$100–110** |

No Stripe fees until you have customers. Free tier + payment splits offset costs.

---

## Next: Local Testing

After cloud deploy, keep running locally for dev:

```bash
# Terminal 1: Docker services
make infra

# Terminal 2: gravity-api
cd services/gravity-api && python -m uvicorn app.main:app --reload --port 8000

# Terminal 3: market-server
cd services/market-server && npm run dev

# Terminal 4: market-ui
cd apps/market-ui && npm run dev
```

Everything uses localhost fallbacks. Cloud doesn't interfere.

---

## Troubleshooting

**Fly deploy fails:**
```bash
fly logs -a gravity-api-prod          # See error
fly secrets list -a gravity-api-prod  # Check secrets set
```

**Market UI can't reach API:**
Check Vercel env vars: Dashboard → Settings → Environment Variables
- `VITE_GRAVITY_API_URL=https://gravity-api-prod.fly.dev`
- `VITE_API_URL=https://market-server-prod.fly.dev`

**Rate limit not working:**
Check `app/api/middleware/rate_limit.py` — Redis cache key format.

---

## Support

See `DEPLOY_RUNBOOK.md` for full details.
