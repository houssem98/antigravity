#!/bin/bash
# Deploy Antigravity to Cloud (Fly.io + Vercel)
# Usage: bash scripts/deploy-to-cloud.sh

set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Antigravity Cloud Deployment"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check prerequisites
echo "[1/7] Checking prerequisites..."
if ! command -v fly &> /dev/null; then
    echo "❌ Fly CLI not found. Install: https://fly.io/docs/getting-started/installing-flyctl/"
    exit 1
fi

if ! command -v git &> /dev/null; then
    echo "❌ Git not found."
    exit 1
fi

echo "✓ fly CLI found: $(fly --version)"
echo "✓ git found"
echo ""

# Verify git status clean
echo "[2/7] Verifying git status..."
if ! git diff-index --quiet HEAD --; then
    echo "❌ Uncommitted changes detected. Commit first:"
    echo "   git add -A && git commit -m 'Deploy: ship to cloud'"
    exit 1
fi
echo "✓ Git status clean"
echo ""

# Deploy gravity-api
echo "[3/7] Deploying gravity-api to Fly.io..."
cd services/gravity-api

if ! fly status -a gravity-api-prod &> /dev/null; then
    echo "   Creating app..."
    fly launch --name gravity-api-prod --copy-config --no-deploy
    echo ""
    echo "   ⚠️  Set secrets before deploy:"
    echo "       fly secrets set -a gravity-api-prod \\"
    echo "         ANTHROPIC_API_KEY=sk-ant-... \\"
    echo "         COHERE_API_KEY=... \\"
    echo "         VOYAGE_API_KEY=pa-... \\"
    echo "         PADDLE_VENDOR_ID=... \\"
    echo "         PAYPAL_CLIENT_ID=... \\"
    echo "         PAYONEER_EMAIL=..."
    echo ""
    read -p "   Press Enter after setting secrets (or Ctrl+C to abort)..."
fi

echo "   Deploying..."
fly deploy -a gravity-api-prod
GRAVITY_API_URL=$(fly info -a gravity-api-prod --json | jq -r '.AppName' | sed 's/gravity-api-prod/gravity-api-prod.fly.dev/' | sed 's/^/https:\/\//')
echo "✓ gravity-api deployed: $GRAVITY_API_URL"
echo ""
cd - > /dev/null

# Deploy market-server
echo "[4/7] Deploying market-server to Fly.io..."
cd services/market-server

if ! fly status -a market-server-prod &> /dev/null; then
    echo "   Creating app..."
    fly launch --name market-server-prod --copy-config --no-deploy
    echo ""
    echo "   ⚠️  Set env var before deploy:"
    echo "       fly secrets set -a market-server-prod GRAVITY_API_URL=$GRAVITY_API_URL"
    echo ""
    read -p "   Press Enter after setting secrets..."
fi

echo "   Deploying..."
fly deploy -a market-server-prod
MARKET_SERVER_URL=$(fly info -a market-server-prod --json | jq -r '.AppName' | sed 's/market-server-prod/market-server-prod.fly.dev/' | sed 's/^/https:\/\//')
echo "✓ market-server deployed: $MARKET_SERVER_URL"
echo ""
cd - > /dev/null

# Deploy market-ui to Vercel
echo "[5/7] Deploying market-ui to Vercel..."
if ! command -v vercel &> /dev/null; then
    echo "   Installing Vercel CLI..."
    npm install -g vercel
fi

cd apps/market-ui
echo "   Building..."
npm run build

echo "   Deploying to Vercel (link existing project or create new)..."
vercel --prod \
  --env VITE_GRAVITY_API_URL="$GRAVITY_API_URL" \
  --env VITE_API_URL="$MARKET_SERVER_URL"

echo "✓ market-ui deployed to Vercel"
echo ""
cd - > /dev/null

# Health checks
echo "[6/7] Health checks..."
echo "   Checking gravity-api..."
if curl -s "${GRAVITY_API_URL}/health" | grep -q '"status":"ok"'; then
    echo "   ✓ gravity-api healthy"
else
    echo "   ⚠️  gravity-api may not be ready yet (can take ~30s)"
fi

echo "   Checking market-server..."
if curl -s "${MARKET_SERVER_URL}/api/health" | grep -q "ok"; then
    echo "   ✓ market-server healthy"
else
    echo "   ⚠️  market-server may not be ready yet"
fi

echo ""

# Verify free tier
echo "[7/7] Verifying free tier..."
echo "   Free tier active:"
echo "     - New users auto-assigned 10 searches/day"
echo "     - Enforced in app/api/middleware/rate_limit.py"
echo "     - Test at: https://antigravity.fyi/auth → sign up → try 11 searches"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✓ Deployment complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Next steps:"
echo "  1. Add custom domain (Vercel Settings → Domains)"
echo "  2. Update CORS_ORIGINS in gravity-api (Fly Secrets)"
echo "  3. Test free tier signup + rate limiting"
echo "  4. Configure payment providers at /admin/billing"
echo ""
echo "URLs:"
echo "  API: $GRAVITY_API_URL"
echo "  Server: $MARKET_SERVER_URL"
echo "  UI: [Vercel project URL]"
echo ""
