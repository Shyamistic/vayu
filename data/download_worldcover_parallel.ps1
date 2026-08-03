$tiles = Get-Content C:\Users\shyam.BATCONSOLE\Desktop\isro\data\worldcover_india_tiles.txt
$outDir = "C:\Users\shyam.BATCONSOLE\Desktop\isro\data\esa_worldcover_2021"
$throttle = 10
$jobs = @()

foreach ($t in $tiles) {
    $dest = Join-Path $outDir $t
    if (Test-Path $dest) { continue }

    while (@(Get-Job -State Running).Count -ge $throttle) {
        Start-Sleep -Milliseconds 500
        Get-Job -State Completed | Remove-Job
    }

    Start-Job -ScriptBlock {
        param($tile, $dest)
        aws s3 cp "s3://esa-worldcover/v200/2021/map/$tile" $dest --no-sign-request 2>&1 | Out-Null
    } -ArgumentList $t, $dest | Out-Null
}

Write-Output "All jobs dispatched. Waiting for completion..."
Get-Job | Wait-Job | Out-Null
Get-Job | Remove-Job
$count = (Get-ChildItem $outDir -Filter *.tif).Count
Write-Output "WORLDCOVER_DOWNLOAD_COMPLETE total_downloaded=$count expected=$($tiles.Count)"
