# ─────────────────────────────────────────────────
#  Antigravity — Data Seed Script (Windows)
# ─────────────────────────────────────────────────
#  Usage: .\scripts\seed.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root

Write-Host ""
Write-Host "╔══════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║   🌱 Antigravity — Seeding Data              ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Seed Gravity API (SEC filings, sample documents)
Write-Host "[1/2] Seeding Gravity Search API..." -ForegroundColor Yellow
$venvPy = "services\gravity-api\.venv\Scripts\python.exe"
if (Test-Path $venvPy) {
    & $venvPy -m scripts.seed_data
    Write-Host "       Gravity seed complete ✓" -ForegroundColor Green
} else {
    Write-Host "       ⚠ Python venv not found. Run 'make install' first." -ForegroundColor Red
}

# Seed Market Server (if applicable)
Write-Host "[2/2] Market Server uses Supabase (cloud) — no local seed needed." -ForegroundColor DarkGray
Write-Host ""
Write-Host "✅ Seeding complete!" -ForegroundColor Green
Write-Host ""
