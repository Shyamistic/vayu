# Proves /health stays responsive while a slow /api/predict is in flight.
#
# This is the exact failure mode that produced 502/504s after the OOM fix
# dropped the container to a single uvicorn worker: _get_real_predictions is
# synchronous CPU/IO-bound code, and calling it inline from an `async def`
# route blocks the whole event loop, so nothing else - including the ALB's
# /health poll - gets serviced until it returns. asyncio.to_thread moves it off
# the loop.
#
#   .\scripts\check_concurrency.ps1

$base = 'http://127.0.0.1:8000'

$predictJob = Start-Job -ScriptBlock {
    param($base)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        Invoke-RestMethod -Uri "$base/api/predict?date=2025-06-15&region=full_india&lead_day=1" -TimeoutSec 120 | Out-Null
        "predict finished in $([math]::Round($sw.Elapsed.TotalSeconds,2))s"
    } catch {
        "predict FAILED after $([math]::Round($sw.Elapsed.TotalSeconds,2))s: $($_.Exception.Message)"
    }
} -ArgumentList $base

Start-Sleep -Milliseconds 300  # let the predict request actually start

$healthTimes = @()
for ($i = 0; $i -lt 8; $i++) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        Invoke-RestMethod -Uri "$base/health" -TimeoutSec 10 | Out-Null
        $healthTimes += $sw.Elapsed.TotalMilliseconds
    } catch {
        $healthTimes += -1
    }
    Start-Sleep -Milliseconds 400
}

$predictResult = Receive-Job -Job $predictJob -Wait
Remove-Job -Job $predictJob

Write-Host "Predict result: $predictResult"
Write-Host "Health check latencies while predict was in flight (ms):"
$healthTimes | ForEach-Object { Write-Host ("  {0,8:N0}" -f $_) }

$maxHealth = ($healthTimes | Measure-Object -Maximum).Maximum
if ($maxHealth -lt 0) {
    Write-Host "FAIL: a health check errored out" -ForegroundColor Red
    exit 1
} elseif ($maxHealth -gt 2000) {
    Write-Host "FAIL: health check took ${maxHealth}ms - event loop was blocked" -ForegroundColor Red
    exit 1
} else {
    Write-Host "PASS: health stayed responsive (max ${maxHealth}ms) during a concurrent predict" -ForegroundColor Green
    exit 0
}
