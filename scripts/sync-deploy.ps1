# Sync env vars across Vercel + Fly.io + Supabase
#
# Reads .env.production from repo root and pushes:
#   - VITE_* / NEXT_PUBLIC_* → Vercel (market-ui + gravity-ui)
#   - SUPABASE_* / DATABASE_URL / API keys → Fly.io (gravity-api)
#
# Usage:
#   .\scripts\sync-deploy.ps1                  # sync everything
#   .\scripts\sync-deploy.ps1 -Target vercel   # only Vercel
#   .\scripts\sync-deploy.ps1 -Target fly      # only Fly.io
#   .\scripts\sync-deploy.ps1 -DryRun          # show what would happen
#
# Requires:
#   - vercel CLI logged in (vercel login)
#   - fly CLI logged in (fly auth login)
#   - .env.production at repo root

param(
    [ValidateSet("all", "vercel", "fly")]
    [string]$Target = "all",
    [switch]$DryRun = $false
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repoRoot ".env.production"

if (-not (Test-Path $envFile)) {
    Write-Host "ERROR: $envFile not found" -ForegroundColor Red
    Write-Host "Create it first: cp .env.example .env.production && edit values"
    exit 1
}

# ── Parse .env.production into hashtable ──────────────────────────────────
$envVars = @{}
Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
        $parts = $line -split "=", 2
        $key = $parts[0].Trim()
        $val = $parts[1].Trim().Trim('"').Trim("'")
        $envVars[$key] = $val
    }
}

Write-Host "Loaded $($envVars.Count) variables from .env.production" -ForegroundColor Green

# ── Vercel env keys (frontend) ────────────────────────────────────────────
$vercelKeys = @(
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_ANON_KEY",
    "VITE_API_URL",
    "VITE_GEMINI_API_KEY",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_API_URL",
    "NEXT_PUBLIC_WS_URL"
)

# ── Fly.io secret keys (backend) ──────────────────────────────────────────
$flyKeys = @(
    "DATABASE_URL",
    "REDIS_URL",
    "QDRANT_URL",
    "ELASTICSEARCH_URL",
    "NEO4J_URI",
    "NEO4J_USER",
    "NEO4J_PASSWORD",
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_KEY",
    "SUPABASE_JWT_SECRET",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GOOGLE_API_KEY",
    "VOYAGE_API_KEY",
    "COHERE_API_KEY",
    "CLERK_SECRET_KEY",
    "STRIPE_SECRET_KEY",
    "PADDLE_API_KEY",
    "JWT_SECRET"
)

# ── Sync to Vercel ────────────────────────────────────────────────────────
function Sync-Vercel {
    param([string]$AppPath, [string]$AppName)

    Write-Host "`n→ Vercel: $AppName ($AppPath)" -ForegroundColor Cyan

    if (-not (Test-Path $AppPath)) {
        Write-Host "  SKIP: $AppPath not found" -ForegroundColor Yellow
        return
    }

    Push-Location $AppPath
    try {
        foreach ($key in $vercelKeys) {
            if (-not $envVars.ContainsKey($key) -or -not $envVars[$key]) { continue }
            $val = $envVars[$key]

            if ($DryRun) {
                Write-Host "  [DRY] vercel env add $key production"
            } else {
                # Remove existing first (vercel env add fails if exists)
                & vercel env rm $key production --yes 2>$null | Out-Null
                $val | & vercel env add $key production 2>&1 | Out-Null
                Write-Host "  ✓ $key" -ForegroundColor Green
            }
        }
    } finally {
        Pop-Location
    }
}

# ── Sync to Fly.io ────────────────────────────────────────────────────────
function Sync-Fly {
    param([string]$AppPath, [string]$AppName)

    Write-Host "`n→ Fly.io: $AppName" -ForegroundColor Cyan

    if (-not (Test-Path (Join-Path $AppPath "fly.toml"))) {
        Write-Host "  SKIP: fly.toml not found in $AppPath" -ForegroundColor Yellow
        return
    }

    Push-Location $AppPath
    try {
        $secretArgs = @()
        foreach ($key in $flyKeys) {
            if (-not $envVars.ContainsKey($key) -or -not $envVars[$key]) { continue }
            $val = $envVars[$key]
            $secretArgs += "$key=$val"
        }

        if ($secretArgs.Count -eq 0) {
            Write-Host "  No matching secrets found" -ForegroundColor Yellow
            return
        }

        if ($DryRun) {
            Write-Host "  [DRY] fly secrets set $($secretArgs.Count) values:"
            $secretArgs | ForEach-Object { Write-Host "    $($_.Split('=')[0])=***" }
        } else {
            & fly secrets set @secretArgs --stage 2>&1 | Out-Null
            Write-Host "  ✓ Staged $($secretArgs.Count) secrets (not yet deployed)" -ForegroundColor Green
            Write-Host "  Deploy now? Run: cd $AppPath && fly deploy" -ForegroundColor Yellow
        }
    } finally {
        Pop-Location
    }
}

# ── Main ──────────────────────────────────────────────────────────────────
if ($DryRun) {
    Write-Host "`n=== DRY RUN — no changes will be made ===" -ForegroundColor Yellow
}

if ($Target -in "all", "vercel") {
    Sync-Vercel -AppPath (Join-Path $repoRoot "apps\market-ui") -AppName "market-ui"
    Sync-Vercel -AppPath (Join-Path $repoRoot "apps\gravity-ui") -AppName "gravity-ui"
}

if ($Target -in "all", "fly") {
    Sync-Fly -AppPath (Join-Path $repoRoot "services\gravity-api") -AppName "gravity-api"
}

Write-Host "`n=== Done ===" -ForegroundColor Green
Write-Host ""
Write-Host "Manual steps remaining:" -ForegroundColor Yellow
Write-Host "  1. Supabase Dashboard → Auth → URL Configuration:"
Write-Host "     Add redirect URLs: https://*.vercel.app/**"
Write-Host "  2. Deploy frontends: cd apps/market-ui && vercel --prod"
Write-Host "  3. Deploy backend:   cd services/gravity-api && fly deploy"
