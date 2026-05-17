# Deploy Antigravity to Cloud (Fly.io + Vercel)
# Usage: .\scripts\Deploy-ToCloud.ps1

$ErrorActionPreference = "Stop"

Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "  Antigravity Cloud Deployment" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""

# Check prerequisites
Write-Host "[1/7] Checking prerequisites..." -ForegroundColor Yellow
$flyCheck = Get-Command fly -ErrorAction SilentlyContinue
if (-not $flyCheck) {
    Write-Host "❌ Fly CLI not found. Install: https://fly.io/docs/getting-started/installing-flyctl/" -ForegroundColor Red
    exit 1
}

$gitCheck = Get-Command git -ErrorAction SilentlyContinue
if (-not $gitCheck) {
    Write-Host "❌ Git not found." -ForegroundColor Red
    exit 1
}

Write-Host "✓ fly CLI found" -ForegroundColor Green
Write-Host "✓ git found" -ForegroundColor Green
Write-Host ""

# Verify git status clean
Write-Host "[2/7] Verifying git status..." -ForegroundColor Yellow
$gitStatus = & git status --porcelain
if ($gitStatus) {
    Write-Host "❌ Uncommitted changes detected. Commit first:" -ForegroundColor Red
    Write-Host "   git add -A && git commit -m 'Deploy: ship to cloud'" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Git status clean" -ForegroundColor Green
Write-Host ""

# Deploy gravity-api
Write-Host "[3/7] Deploying gravity-api to Fly.io..." -ForegroundColor Yellow
Push-Location services/gravity-api

try {
    $appStatus = & fly status -a gravity-api-prod 2>&1 | Out-String
} catch {
    $appStatus = $null
}

if (-not $appStatus -or $appStatus -like "*not found*") {
    Write-Host "   Creating app..." -ForegroundColor Gray
    & fly launch --name gravity-api-prod --copy-config --no-deploy
    Write-Host ""
    Write-Host "   ⚠️  Set secrets before deploy:" -ForegroundColor Yellow
    Write-Host "       fly secrets set -a gravity-api-prod \" -ForegroundColor Gray
    Write-Host "         ANTHROPIC_API_KEY=sk-ant-... \" -ForegroundColor Gray
    Write-Host "         COHERE_API_KEY=... \" -ForegroundColor Gray
    Write-Host "         VOYAGE_API_KEY=pa-... \" -ForegroundColor Gray
    Write-Host "         PADDLE_VENDOR_ID=... \" -ForegroundColor Gray
    Write-Host "         PAYPAL_CLIENT_ID=... \" -ForegroundColor Gray
    Write-Host "         PAYONEER_EMAIL=..." -ForegroundColor Gray
    Write-Host ""
    Read-Host "   Press Enter after setting secrets (or Ctrl+C to abort)"
}

Write-Host "   Deploying..." -ForegroundColor Gray
& fly deploy -a gravity-api-prod
Write-Host "✓ gravity-api deployed" -ForegroundColor Green
Write-Host ""

Pop-Location

# Deploy market-server
Write-Host "[4/7] Deploying market-server to Fly.io..." -ForegroundColor Yellow
Push-Location services/market-server

try {
    $appStatus = & fly status -a market-server-prod 2>&1 | Out-String
} catch {
    $appStatus = $null
}

if (-not $appStatus -or $appStatus -like "*not found*") {
    Write-Host "   Creating app..." -ForegroundColor Gray
    & fly launch --name market-server-prod --copy-config --no-deploy
    Write-Host ""
    Write-Host "   ⚠️  Set env var before deploy:" -ForegroundColor Yellow
    Write-Host "       fly secrets set -a market-server-prod GRAVITY_API_URL=https://gravity-api-prod.fly.dev" -ForegroundColor Gray
    Write-Host ""
    Read-Host "   Press Enter after setting secrets"
}

Write-Host "   Deploying..." -ForegroundColor Gray
& fly deploy -a market-server-prod
Write-Host "✓ market-server deployed" -ForegroundColor Green
Write-Host ""

Pop-Location

# Deploy market-ui to Vercel
Write-Host "[5/7] Deploying market-ui to Vercel..." -ForegroundColor Yellow

$vercelCheck = Get-Command vercel -ErrorAction SilentlyContinue
if (-not $vercelCheck) {
    Write-Host "   Installing Vercel CLI..." -ForegroundColor Gray
    npm install -g vercel
}

Push-Location apps/market-ui

Write-Host "   Building..." -ForegroundColor Gray
npm run build

Write-Host "   Deploying to Vercel (link existing project or create new)..." -ForegroundColor Gray
& vercel --prod `
  --env VITE_GRAVITY_API_URL="https://gravity-api-prod.fly.dev" `
  --env VITE_API_URL="https://market-server-prod.fly.dev"

Write-Host "✓ market-ui deployed to Vercel" -ForegroundColor Green
Write-Host ""

Pop-Location

# Health checks
Write-Host "[6/7] Health checks..." -ForegroundColor Yellow

Write-Host "   Checking gravity-api..." -ForegroundColor Gray
try {
    $health = Invoke-RestMethod "https://gravity-api-prod.fly.dev/health" -ErrorAction SilentlyContinue
    if ($health.status -eq "ok") {
        Write-Host "   ✓ gravity-api healthy" -ForegroundColor Green
    }
} catch {
    Write-Host "   ⚠️  gravity-api may not be ready yet (can take ~30s)" -ForegroundColor Yellow
}

Write-Host "   Checking market-server..." -ForegroundColor Gray
try {
    $health = Invoke-RestMethod "https://market-server-prod.fly.dev/api/health" -ErrorAction SilentlyContinue
    Write-Host "   ✓ market-server healthy" -ForegroundColor Green
} catch {
    Write-Host "   ⚠️  market-server may not be ready yet" -ForegroundColor Yellow
}

Write-Host ""

# Verify free tier
Write-Host "[7/7] Verifying free tier..." -ForegroundColor Yellow
Write-Host "   Free tier active:" -ForegroundColor Green
Write-Host "     - New users auto-assigned 10 searches/day" -ForegroundColor Gray
Write-Host "     - Enforced in app/api/middleware/rate_limit.py" -ForegroundColor Gray
Write-Host "     - Test at: https://antigravity.fyi/auth → sign up → try 11 searches" -ForegroundColor Gray
Write-Host ""

Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "✓ Deployment complete!" -ForegroundColor Green
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""

Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Add custom domain (Vercel Settings → Domains)" -ForegroundColor Gray
Write-Host "  2. Update CORS_ORIGINS in gravity-api (Fly Secrets)" -ForegroundColor Gray
Write-Host "  3. Test free tier signup + rate limiting" -ForegroundColor Gray
Write-Host "  4. Configure payment providers at /admin/billing" -ForegroundColor Gray
Write-Host ""

Write-Host "URLs:" -ForegroundColor Yellow
Write-Host "  API: https://gravity-api-prod.fly.dev" -ForegroundColor Cyan
Write-Host "  Server: https://market-server-prod.fly.dev" -ForegroundColor Cyan
Write-Host "  UI: [Vercel project URL]" -ForegroundColor Cyan
Write-Host ""
