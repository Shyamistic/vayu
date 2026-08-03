$tiles = Get-Content C:\Users\shyam.BATCONSOLE\Desktop\isro\data\worldcover_india_tiles.txt
$i = 0
foreach ($t in $tiles) {
    $i++
    $dest = "C:\Users\shyam.BATCONSOLE\Desktop\isro\data\esa_worldcover_2021\$t"
    if (-not (Test-Path $dest)) {
        aws s3 cp "s3://esa-worldcover/v200/2021/map/$t" $dest --no-sign-request 2>&1 | Out-Null
    }
    Write-Output "Progress: $i/$($tiles.Count) $t"
}
Write-Output "WORLDCOVER_DOWNLOAD_COMPLETE total=$($tiles.Count)"
