# Fetch the missing Copernicus DEM GLO-90 N38 tile band.
#
# Why: build-static-rasters refuses to write when WorldCover reports land but the
# DEM has no finite value there, because elevation would be silently zeroed on
# real terrain. On the full-India 0.5 deg grid that fired for 67 cells, and all 67
# are the single northernmost row (lat 38.125, cell edges 37.875-38.375). The
# original download stopped at the N37 band: N37 has 35 tiles, N38 had exactly 1
# (E100).
#
# The alternative was trimming the grid's north edge. Rejected: lat 38.125 and
# 37.625 carry no IMD target data in any of the 45 years, but they still serve as
# graph neighbours for lat 37.125, which does have data and is the Himalayan
# rainfall boundary. Keeping them costs ~34 small tiles; dropping them costs
# context exactly where extremes matter.
#
# s3://copernicus-dem-90m is AWS Open Data and is read with --no-sign-request:
# anonymous, no credentials used, no charge to any account.
#
# Resumable: existing files are skipped, so re-running after a dropped connection
# only fetches what is still missing.

$ErrorActionPreference = 'Stop'

$outDir = 'D:\copernicus_dem_90m'
$logDir = 'D:\vayu_data\logs\dem_n38'
New-Item -ItemType Directory -Force -Path $outDir, $logDir | Out-Null

# Grid lon cell edges are 66.375-99.875, so tiles E066..E099 are needed.
$lonStart = 66
$lonEnd   = 99

$needed = @()
for ($lon = $lonStart; $lon -le $lonEnd; $lon++) {
    $needed += 'Copernicus_DSM_COG_30_N38_00_E{0:D3}_00_DEM' -f $lon
}

$present = 0; $fetched = 0; $failed = @()
foreach ($tile in $needed) {
    $dest = Join-Path $outDir "$tile.tif"
    if (Test-Path $dest) { $present++; continue }

    $uri = "s3://copernicus-dem-90m/$tile/$tile.tif"
    $err = aws s3 cp $uri $dest --no-sign-request 2>&1
    if ($LASTEXITCODE -eq 0 -and (Test-Path $dest)) {
        $fetched++
        Write-Host ("fetched  {0}  ({1:N1} MB)" -f $tile, ((Get-Item $dest).Length / 1MB))
    } else {
        # A genuinely absent tile means the archive has no land there. That is only
        # a problem if WorldCover still calls it land, which build-static-rasters
        # re-checks, so record and continue rather than aborting the band.
        $failed += $tile
        $err | Out-File (Join-Path $logDir "$tile.err.txt")
        Write-Host "MISSING  $tile (logged)"
    }
}

Write-Host ''
Write-Host "already present : $present"
Write-Host "newly fetched   : $fetched"
Write-Host "not retrieved   : $($failed.Count)"
if ($failed.Count -gt 0) { Write-Host ($failed -join ', ') }

$total = (Get-ChildItem $outDir -Filter '*_N38_*.tif' | Measure-Object).Count
Write-Host "N38 tiles now on disk: $total"
