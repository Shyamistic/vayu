$tiles = Get-Content C:\Users\shyam.BATCONSOLE\Desktop\isro\data\dem_tile_list.txt
$outDir = "C:\Users\shyam.BATCONSOLE\Desktop\isro\data\copernicus_dem_90m"
$throttle = 12
$jobs = @()

foreach ($t in $tiles) {
    $dest = Join-Path $outDir "$t.tif"
    if (Test-Path $dest) { continue }

    while (@(Get-Job -State Running).Count -ge $throttle) {
        Start-Sleep -Milliseconds 300
        Get-Job -State Completed | Remove-Job
    }

    Start-Job -ScriptBlock {
        param($tile, $dest)
        aws s3 cp "s3://copernicus-dem-90m/$tile/$tile.tif" $dest --no-sign-request 2>&1 | Out-Null
    } -ArgumentList $t, $dest | Out-Null
}

Write-Output "All jobs dispatched. Waiting for completion..."
Get-Job | Wait-Job | Out-Null
Get-Job | Remove-Job
$count = (Get-ChildItem $outDir -Filter *.tif).Count
Write-Output "DEM_DOWNLOAD_COMPLETE total_downloaded=$count expected=$($tiles.Count)"
