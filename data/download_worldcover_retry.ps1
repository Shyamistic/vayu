$tiles = Get-Content C:\Users\shyam.BATCONSOLE\Desktop\isro\data\worldcover_india_tiles.txt
$outDir = "C:\Users\shyam.BATCONSOLE\Desktop\isro\data\esa_worldcover_2021"
$logDir = "C:\Users\shyam.BATCONSOLE\Desktop\isro\data\worldcover_retry_logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$throttle = 5
$missing = @()
foreach ($t in $tiles) {
    $dest = Join-Path $outDir $t
    if (-not (Test-Path $dest)) { $missing += $t }
}
Write-Output "Missing tiles to retry: $($missing.Count)"

foreach ($t in $missing) {
    $dest = Join-Path $outDir $t
    while (@(Get-Job -State Running).Count -ge $throttle) {
        Start-Sleep -Milliseconds 500
        Get-Job -State Completed | Remove-Job
    }
    Start-Job -ScriptBlock {
        param($tile, $dest, $logDir)
        $err = aws s3 cp "s3://esa-worldcover/v200/2021/map/$tile" $dest --no-sign-request 2>&1
        if ($LASTEXITCODE -ne 0) {
            $err | Out-File (Join-Path $logDir "$tile.err.txt")
        }
    } -ArgumentList $t, $dest, $logDir | Out-Null
}

Get-Job | Wait-Job | Out-Null
Get-Job | Remove-Job
$count = (Get-ChildItem $outDir -Filter *.tif).Count
Write-Output "WORLDCOVER_RETRY_COMPLETE total_downloaded=$count expected=$($tiles.Count)"
