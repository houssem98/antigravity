# Cloud Deployment — Status & Quick Start

**Last updated:** 2026-05-25
**Live URL:** https://market-ui-self.vercel.app
**API:** https://gravity-api-prod.fly.dev

---

## Architecture (current)

```
Browser → Vercel (market-ui static SPA)
            ├── Supabase Auth (login, session, JWT ES256)
            ├── Supabase Postgres (research_reports, billing, auth.users)
            └── Fly gravity-api-prod (FastAPI + ML)
                  ├── Supabase Postgres (DATABASE_URL)
                  ├── Qdrant Cloud (vectors, eu-central-1)
                  ├── Voyage AI (voyage-finance-2 embeddings)
                  ├── Google Gemini 2.5 (primary LLM, free tier)
                  ├── Cohere rerank-v3.5
                  ├── DeepSeek + Groq (fallback LLMs)
                  └── Anthropic Claude (DEGRADED — no credit)
            └── Fly market-server-prod (Express, auto-sleep)
                  └── Crypto/social/LLM-chat sidecar APIs
```

---

## Deployed ✅

| Component | Provider | URL/ID | Cost |
|---|---|---|---|
| Frontend (market-ui) | Vercel | `market-ui-self.vercel.app` | $0 |
| API backend (gravity-api) | Fly.io | `gravity-api-prod.fly.dev` (4GB, 2 cores, always-on) | ~$10-15/mo |
| Sidecar (market-server) | Fly.io | `market-server-prod.fly.dev` (1GB, auto-sleep) | ~$0-2/mo |
| Database | Supabase Postgres | `ueuznqilkhyszhgbmpyk.supabase.co` | $0 (free) |
| Auth | Supabase Auth | (same project) | $0 (free, ES256 JWT) |
| Vector DB | Qdrant Cloud | `343ab8f1-...eu-central-1.aws.cloud.qdrant.io` (1GB free) | $0 |
| Email | Gmail SMTP via Supabase custom SMTP | `smtp.gmail.com:587` | $0 |
| **Total** | | | **~$10-17/mo** |

---

## Working ✅

- Signup / login via Supabase Auth (ES256 JWT)
- gravity-api validates Supabase JWT via JWKS
- Research history (85 reports for `jmonticarlo@yahoo.com`) loads
- Search pipeline (Gemini 2.5 + Voyage + Qdrant + Cohere rerank)
- Forgot password emails via Gmail SMTP (no more bounces)
- Reset password flow (recovery session or any active session)
- Settings page w/ Sign out button
- Landing page w/ Open app / Switch account when authenticated
- Rate limit (10/min free tier, in-memory fallback when Redis down)
- SEC EDGAR background polling → auto-ingests to Qdrant

---

## Degraded / Pending ⚠️

| Item | Status | Impact | Fix |
|---|---|---|---|
| **Anthropic credits** | $0 balance | HyDE + RAPTOR summaries fail (Gemini covers main flow) | https://console.anthropic.com/settings/billing |
| **Redis** | Not provisioned | Rate limit + cache use in-memory fallback (per-machine) | Upstash Redis free tier |
| **Elasticsearch** | Not provisioned | Sparse/BM25 channel disabled | Elastic Cloud trial 14d |
| **Neo4j** | Not provisioned | Graph channel disabled | Neo4j Aura free |
| **SPLADE** | Gated off (`SPLADE_ENABLED=false`) | Saves RAM, sparse-learned channel disabled | Bump machine to 8GB + enable |
| **Custom domain** | Not configured | Still on `*.vercel.app` | Buy domain + Vercel → Settings → Domains |
| **Payment providers** | Not configured | Free tier only, no upgrade path | Paddle/PayPal account setup |
| **CI on push** | Disabled (workflows renamed `.disabled`) | No auto-tests, no auto-deploy on push | Fix GH Actions billing + restore workflows |

---

## Environment Variables

### Vercel (production, market-ui)
- `VITE_SUPABASE_URL=https://ueuznqilkhyszhgbmpyk.supabase.co`
- `VITE_SUPABASE_ANON_KEY=sb_publishable_VA5WT8uZBRYb54U1sJG51g_LAf4nF8H`
- `VITE_AUTH_BACKEND=supabase`
- `VITE_GRAVITY_API_URL=https://gravity-api-prod.fly.dev`
- `VITE_API_URL=https://market-server-prod.fly.dev`

### Fly secrets (gravity-api-prod)
- `DATABASE_URL=postgresql://postgres:...@db.ueuznqilkhyszhgbmpyk.supabase.co:5432/postgres`
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`
- `QDRANT_URL`, `QDRANT_API_KEY`
- `VOYAGE_API_KEY`, `COHERE_API_KEY`, `GOOGLE_API_KEY`, `GEMINI_API_KEY`
- `DEEPSEEK_API_KEY`, `GROQ_API_KEY`, `ANTHROPIC_API_KEY` (no credit)
- `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_USER=houssemzitoub@gmail.com`, `SMTP_PASSWORD`, `EMAIL_FROM=Antigravity <houssemzitoub@gmail.com>`
- `AUTH_JWT_SECRET` (legacy, kept for backward compat)
- `EDGAR_POLLING_ENABLED=true`
- `SPLADE_ENABLED=false`, `SPLADE_WARMUP_ENABLED=false`

---

## Common Commands

### Deploy gravity-api
```bash
cd services/gravity-api
flyctl deploy --app gravity-api-prod --remote-only
```

### Deploy market-ui (frontend)
```bash
vercel --prod --yes --force
```

### Wake market-server (auto-stopped)
```bash
curl -s https://market-server-prod.fly.dev/api/health  # triggers auto-start (~5-10s)
```

### Watch Fly logs
```bash
flyctl logs -a gravity-api-prod
```

### Trigger Supabase password reset (admin, bypasses email rate limit)
```bash
SRK=$(flyctl ssh console -a gravity-api-prod --command "bash -c 'echo \$SUPABASE_SERVICE_ROLE_KEY'")
curl -s -X POST "https://ueuznqilkhyszhgbmpyk.supabase.co/auth/v1/admin/generate_link" \
  -H "apikey: $SRK" -H "Authorization: Bearer $SRK" -H "Content-Type: application/json" \
  -d '{"type":"recovery","email":"user@example.com","redirect_to":"https://market-ui-self.vercel.app/reset-password"}'
```

---

## Rollback

```bash
# Vercel: dashboard → Deployments → "Promote to production" on older
# Fly:
flyctl releases -a gravity-api-prod              # list
flyctl rollback v25 -a gravity-api-prod          # roll back to version
```

---

## Local dev (unaffected by cloud)

```bash
make infra            # Postgres/Redis/Qdrant/ES/Neo4j Docker stack
make dev              # all 4 services hot-reload
```

Local uses `localhost:*` from `.env`. Cloud uses Fly + Vercel + Supabase URLs.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Reset link → "Missing or invalid reset link" | Stale recovery link (1h TTL) or no session | Request fresh link OR sign in first |
| Search returns "No indexed documents found" | Qdrant collection empty | Wait for EDGAR polling OR manual ingest |
| `/v1/search` returns 401 | JWT validation failed | Check `SUPABASE_JWT_SECRET` on Fly |
| `/v1/search` returns 502 | Machine OOM-killed | Verify `SPLADE_ENABLED=false` |
| `/api/crypto/*` slow on first call | market-server auto-stopped | First call wakes machine (~5-10s cold start) |
| Forgot password email not received | User not in Supabase auth.users | Sign up first via `/auth` |

---

## Next Steps

Priority order:
1. **Anthropic credits** → unlock full LLM router
2. **Custom domain** → professional URL
3. **Upstash Redis** → proper distributed rate limit + cache
4. **Payment provider** → Paddle for monetization
5. **ES Cloud + Neo4j Aura** → restore sparse + graph channels
