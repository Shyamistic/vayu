$tiles = Get-Content C:\Users\shyam.BATCONSOLE\Desktop\isro\data\dem_tile_list.txt
$outDir = "C:\Users\shyam.BATCONSOLE\Desktop\isro\data\copernicus_dem_90m"
$logDir = "C:\Users\shyam.BATCONSOLE\Desktop\isro\data\dem_retry_logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$throttle = 6
$missing = @()
foreach ($t in $tiles) {
    $dest = Join-Path $outDir "$t.tif"
    if (-not (Test-Path $dest)) { $missing += $t }
}
Write-Output "Missing tiles to retry: $($missing.Count)"

foreach ($t in $missing) {
    $dest = Join-Path $outDir "$t.tif"
    while (@(Get-Job -State Running).Count -ge $throttle) {
        Start-Sleep -Milliseconds 400
        Get-Job -State Completed | Remove-Job
    }
    Start-Job -ScriptBlock {
        param($tile, $dest, $logDir)
        $err = aws s3 cp "s3://copernicus-dem-90m/$tile/$tile.tif" $dest --no-sign-request 2>&1
        if ($LASTEXITCODE -ne 0) {
            $err | Out-File (Join-Path $logDir "$tile.err.txt")
        }
    } -ArgumentList $t, $dest, $logDir | Out-Null
}

Get-Job | Wait-Job | Out-Null
Get-Job | Remove-Job
$count = (Get-ChildItem $outDir -Filter *.tif).Count
Write-Output "DEM_RETRY_COMPLETE total_downloaded=$count expected=$($tiles.Count)"
