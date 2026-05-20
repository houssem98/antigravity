# Sync env vars across Vercel + Fly.io from .env.production
#
# Usage:
#   .\scripts\sync-deploy.ps1                  # sync all
#   .\scripts\sync-deploy.ps1 -Target vercel   # only Vercel
#   .\scripts\sync-deploy.ps1 -Target fly      # only Fly.io
#   .\scripts\sync-deploy.ps1 -DryRun          # preview only

param(
    [ValidateSet("all", "vercel", "fly")]
    [string]$Target = "all",
    [switch]$DryRun = $false
)

$ErrorActionPreference = "Stop"
# PowerShell 5.1: treat native command stderr as informational (not fatal).
# Vercel CLI + Fly CLI both write progress messages to stderr.
$PSNativeCommandUseErrorActionPreference = $false
$repoRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repoRoot ".env.production"

if (-not (Test-Path $envFile)) {
    Write-Host "ERROR: $envFile not found" -ForegroundColor Red
    Write-Host "Generate it first: .\scripts\derive-prod-env.ps1"
    exit 1
}

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

# Vercel: frontend-only keys
$vercelKeys = @(
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_ANON_KEY",
    "VITE_API_URL",
    "VITE_GEMINI_API_KEY",
    "VITE_TAVILY_API_KEY",
    "VITE_ALPHA_VANTAGE_API_KEY",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_API_URL",
    "NEXT_PUBLIC_WS_URL"
)

# Fly.io: backend secrets
$flyKeys = @(
    "DATABASE_URL", "REDIS_URL", "QDRANT_URL", "ELASTICSEARCH_URL",
    "NEO4J_URI", "NEO4J_USER", "NEO4J_PASSWORD",
    "SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_JWT_SECRET",
    "ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY_SECONDARY",
    "OPENAI_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY",
    "DEEPSEEK_API_KEY", "GROQ_API_KEY", "VOYAGE_API_KEY", "COHERE_API_KEY",
    "TAVILY_API_KEY", "ALPHA_VANTAGE_API_KEY",
    "AUTH_JWT_SECRET", "KEY_ENCRYPTION_KEY_V1",
    "CORS_ORIGINS", "APP_URL", "APP_ENV", "LOG_LEVEL"
)

function Sync-Vercel {
    param([string]$AppPath, [string]$AppName)
    Write-Host ""
    Write-Host "Vercel: $AppName ($AppPath)" -ForegroundColor Cyan
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
                & vercel env rm $key production --yes 2>$null | Out-Null
                $val | & vercel env add $key production 2>&1 | Out-Null
                Write-Host "  OK $key" -ForegroundColor Green
            }
        }
    } finally {
        Pop-Location
    }
}

function Sync-Fly {
    param([string]$AppPath, [string]$AppName)
    Write-Host ""
    Write-Host "Fly.io: $AppName" -ForegroundColor Cyan
    if (-not (Test-Path (Join-Path $AppPath "fly.toml"))) {
        Write-Host "  SKIP: fly.toml not found" -ForegroundColor Yellow
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
            Write-Host "  No matching secrets" -ForegroundColor Yellow
            return
        }
        if ($DryRun) {
            Write-Host "  [DRY] fly secrets set $($secretArgs.Count) values:"
            $secretArgs | ForEach-Object { Write-Host "    $($_.Split('=')[0])=***" }
        } else {
            & fly secrets set @secretArgs --stage 2>&1 | Out-Null
            Write-Host "  OK Staged $($secretArgs.Count) secrets" -ForegroundColor Green
            Write-Host "  Deploy: cd $AppPath; fly deploy" -ForegroundColor Yellow
        }
    } finally {
        Pop-Location
    }
}

if ($DryRun) {
    Write-Host ""
    Write-Host "=== DRY RUN ===" -ForegroundColor Yellow
}

if ($Target -eq "all" -or $Target -eq "vercel") {
    Sync-Vercel -AppPath (Join-Path $repoRoot "apps\market-ui") -AppName "market-ui"
    Sync-Vercel -AppPath (Join-Path $repoRoot "apps\gravity-ui") -AppName "gravity-ui"
}

if ($Target -eq "all" -or $Target -eq "fly") {
    Sync-Fly -AppPath (Join-Path $repoRoot "services\gravity-api") -AppName "gravity-api"
}

Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Green
Write-Host ""
Write-Host "Manual steps:" -ForegroundColor Yellow
Write-Host "  1. Supabase Dashboard > Auth > URL Configuration:"
Write-Host "     Add redirect URLs: https://*.vercel.app/**"
Write-Host "  2. Deploy frontends: cd apps/market-ui; vercel --prod"
Write-Host "  3. Deploy backend:   cd services/gravity-api; fly deploy"
