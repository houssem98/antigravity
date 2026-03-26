# ─────────────────────────────────────────────────
#  Antigravity — Health Check (Windows)
# ─────────────────────────────────────────────────
#  Usage: .\scripts\health-check.ps1
#  Pings all service and infrastructure endpoints
# ─────────────────────────────────────────────────

$ErrorActionPreference = "SilentlyContinue"

Write-Host ""
Write-Host "╔══════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║   🏥 Antigravity — Health Check              ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

function Check-Endpoint {
    param([string]$Name, [string]$Url, [string]$Color)
    try {
        $response = Invoke-RestMethod -Uri $Url -TimeoutSec 3 -ErrorAction Stop
        Write-Host "  ✅ $Name" -ForegroundColor $Color -NoNewline
        Write-Host " → $Url" -ForegroundColor DarkGray
        return $true
    } catch {
        Write-Host "  ❌ $Name" -ForegroundColor Red -NoNewline
        Write-Host " → $Url (unreachable)" -ForegroundColor DarkGray
        return $false
    }
}

Write-Host "  ── Application Services ──" -ForegroundColor White
Check-Endpoint "Gravity API     " "http://localhost:8000/health" "Cyan"
Check-Endpoint "Market Server   " "http://localhost:3001/api/health" "Yellow"
Check-Endpoint "Gravity UI      " "http://localhost:3000" "Green"
Check-Endpoint "Market UI       " "http://localhost:5173" "Magenta"

Write-Host ""
Write-Host "  ── Infrastructure ──" -ForegroundColor White
Check-Endpoint "PostgreSQL      " "http://localhost:5432" "Blue"
Check-Endpoint "Redis           " "http://localhost:6379" "Red"
Check-Endpoint "Qdrant          " "http://localhost:6333/healthz" "DarkCyan"
Check-Endpoint "Elasticsearch   " "http://localhost:9200/_cluster/health" "DarkYellow"
Check-Endpoint "Neo4j           " "http://localhost:7474" "DarkGreen"

Write-Host ""
