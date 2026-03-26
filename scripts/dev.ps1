# -------------------------------------------------
#  Antigravity - Unified Dev Starter (Windows)
# -------------------------------------------------
#  Usage: .\scripts\dev.ps1
#  Starts Docker infra + all 4 services with colored output
# -------------------------------------------------

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host ""
Write-Host "==============================" -ForegroundColor Cyan
Write-Host "  Antigravity - Starting Dev  " -ForegroundColor Cyan
Write-Host "==============================" -ForegroundColor Cyan
Write-Host ""

# -- Step 1: Start Docker infrastructure --
Write-Host "[1/3] Starting Docker infrastructure..." -ForegroundColor Yellow
try {
    $dockerCheck = docker compose -f infra/docker-compose.yml ps --format json 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "       Docker Compose starting fresh..." -ForegroundColor DarkGray
        docker compose -f infra/docker-compose.yml up -d
    }
    else {
        Write-Host "       Docker services already running" -ForegroundColor Green
    }
}
catch {
    Write-Host "       Docker not available, skipping..." -ForegroundColor DarkGray
}

# -- Step 2: Check Python venv --
Write-Host "[2/3] Checking Python virtual environment..." -ForegroundColor Yellow
$venvPath = "services\gravity-api\.venv"
if (-not (Test-Path "$venvPath\Scripts\python.exe")) {
    Write-Host "       Creating Python venv..." -ForegroundColor DarkGray
    python -m venv $venvPath
    & "$venvPath\Scripts\pip" install -r "services\gravity-api\requirements.txt" -q
    Write-Host "       Python venv ready" -ForegroundColor Green
}
else {
    Write-Host "       Python venv found" -ForegroundColor Green
}

# -- Step 3: Start all services --
Write-Host "[3/3] Starting all services..." -ForegroundColor Yellow
Write-Host ""
Write-Host "  Service          Port    URL" -ForegroundColor White
Write-Host "  -------------    ----    ---" -ForegroundColor DarkGray
Write-Host "  Gravity API      8000    http://localhost:8000/docs" -ForegroundColor Cyan
Write-Host "  Market Server    3001    http://localhost:3001/api/health" -ForegroundColor Yellow
Write-Host "  Market UI        5173    http://localhost:5173" -ForegroundColor Magenta
Write-Host ""
Write-Host "  Press Ctrl+C to stop all services" -ForegroundColor DarkGray
Write-Host ""

npx concurrently --kill-others-on-fail `
    --names "GRAVITY-API,MARKET-SRV,MARKET-UI" `
    --prefix-colors "cyan.bold,yellow.bold,magenta.bold" `
    "cd services/gravity-api && .venv\Scripts\python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000" `
    "npm -w market-server run dev" `
    "npm -w market-ui run dev"
