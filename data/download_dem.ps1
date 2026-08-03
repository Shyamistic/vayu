$tiles = Get-Content C:\Users\shyam.BATCONSOLE\Desktop\isro\data\dem_tile_list.txt
$i = 0
foreach ($t in $tiles) {
    $i++
    $dest = "C:\Users\shyam.BATCONSOLE\Desktop\isro\data\copernicus_dem_90m\$t.tif"
    if (-not (Test-Path $dest)) {
        aws s3 cp "s3://copernicus-dem-90m/$t/$t.tif" $dest --no-sign-request 2>&1 | Out-Null
    }
    if ($i % 25 -eq 0) {
        Write-Output "Progress: $i/$($tiles.Count)"
    }
}
Write-Output "DEM_DOWNLOAD_COMPLETE total=$($tiles.Count)"
