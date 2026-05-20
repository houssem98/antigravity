# Auto-derive .env.production from live Fly.io + Vercel state.
#
# Usage:
#   .\scripts\derive-prod-env.ps1
#   .\scripts\derive-prod-env.ps1 -DryRun

param(
    [switch]$DryRun = $false,
    [string]$FlyApp = "gravity-api-prod",
    [string]$VercelMarketProject = "market-ui",
    [string]$VercelGravityProject = "antigravity-gravity-ui"
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
$repoRoot = Split-Path -Parent $PSScriptRoot
$srcEnv = Join-Path $repoRoot ".env"
$dstEnv = Join-Path $repoRoot ".env.production"

if (-not (Test-Path $srcEnv)) {
    Write-Host "ERROR: $srcEnv not found" -ForegroundColor Red
    exit 1
}

Write-Host "Discovering production endpoints..." -ForegroundColor Cyan

# Fly.io API hostname
$flyHostname = "$FlyApp.fly.dev"
try {
    $flyStatus = & fly status -a $FlyApp --json 2>$null | ConvertFrom-Json
    if ($flyStatus.Hostname) { $flyHostname = $flyStatus.Hostname }
} catch {}
Write-Host "  Fly API: https://$flyHostname" -ForegroundColor Green

# Vercel project URLs
function Get-VercelProductionUrl {
    param([string]$ProjectName)
    try {
        $output = & vercel ls $ProjectName --prod 2>&1 | Out-String
        $match = [regex]::Match($output, "https://[a-z0-9\-]+\.vercel\.app")
        if ($match.Success) { return $match.Value }
    } catch {}
    return $null
}

$marketUiUrl = Get-VercelProductionUrl -ProjectName $VercelMarketProject
$gravityUiUrl = Get-VercelProductionUrl -ProjectName $VercelGravityProject

if (-not $marketUiUrl) { $marketUiUrl = "https://market-ui-self.vercel.app" }
if (-not $gravityUiUrl) { $gravityUiUrl = "https://antigravity-gravity-ui.vercel.app" }

Write-Host "  market-ui:  $marketUiUrl" -ForegroundColor Green
Write-Host "  gravity-ui: $gravityUiUrl" -ForegroundColor Green

# CORS origins
$corsOrigins = "$marketUiUrl,$gravityUiUrl,https://*.vercel.app"

# Overrides
$overrides = @{
    "APP_ENV"      = "production"
    "LOG_LEVEL"    = "INFO"
    "VITE_API_URL" = "https://$flyHostname"
    "CORS_ORIGINS" = $corsOrigins
    "APP_URL"      = $marketUiUrl
}

# External services: comment out (provisioned separately)
$externalNeeded = @("DATABASE_URL", "REDIS_URL", "QDRANT_URL", "ELASTICSEARCH_URL")

# Build output
$outLines = New-Object System.Collections.ArrayList
[void]$outLines.Add("# .env.production - auto-derived $(Get-Date -Format 'yyyy-MM-dd HH:mm')")
[void]$outLines.Add("# Source: .env")
[void]$outLines.Add("# Generator: scripts/derive-prod-env.ps1")
[void]$outLines.Add("#")
[void]$outLines.Add("# External services (DB/Redis/Qdrant/ES) commented out.")
[void]$outLines.Add("# Provision via Fly secrets: fly secrets set DATABASE_URL=...")
[void]$outLines.Add("")

$seen = @{}
Get-Content $srcEnv | ForEach-Object {
    $line = $_.TrimEnd()
    if ($line -match '^([A-Z_][A-Z0-9_]*)=') {
        $key = $matches[1]
        $seen[$key] = $true
        if ($overrides.ContainsKey($key)) {
            [void]$outLines.Add("$key=$($overrides[$key])")
        } elseif ($externalNeeded -contains $key) {
            [void]$outLines.Add("# $line  # provision via fly secrets")
        } else {
            [void]$outLines.Add($line)
        }
    } else {
        [void]$outLines.Add($line)
    }
}

# Append overrides not in source
foreach ($key in $overrides.Keys) {
    if (-not $seen.ContainsKey($key)) {
        [void]$outLines.Add("$key=$($overrides[$key])")
    }
}

$output = $outLines -join "`r`n"

if ($DryRun) {
    Write-Host "`n=== DRY RUN ===" -ForegroundColor Yellow
    Write-Host "Would write: $dstEnv"
    Write-Host ""
    Write-Host "Overrides:"
    foreach ($key in $overrides.Keys) {
        Write-Host "  $key = $($overrides[$key])"
    }
    Write-Host ""
    Write-Host "Commented out:"
    foreach ($key in $externalNeeded) {
        Write-Host "  $key"
    }
} else {
    Set-Content -Path $dstEnv -Value $output -Encoding utf8
    Write-Host "`nWrote: $dstEnv" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next:"
    Write-Host "  .\scripts\sync-deploy.ps1 -DryRun"
    Write-Host "  .\scripts\sync-deploy.ps1"
}
