foreach ($port in 5173,5174,5175,5176,5177) {
    try {
        $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop
        foreach ($c in $conns) {
            Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
            Write-Host "killed pid $($c.OwningProcess) on port $port"
        }
    } catch {}
}
Write-Host "done"
