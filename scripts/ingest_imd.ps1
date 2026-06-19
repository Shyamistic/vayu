#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Download and preprocess 15 years (2010-2025) of IMD gridded climate data.

.DESCRIPTION
    Uses imdlib to fetch rainfall (0.25°) and temperature max/min (1.0°) from IMD.
    Clips to pilot region (8-20°N, 72-78°E), converts to NetCDF, and stores
    ready for Kaggle upload or local preprocessing.

.EXAMPLE
    .\scripts\ingest_imd.ps1 -StartYear 2010 -EndYear 2025 -OutputDir .\data\imd

.NOTES
    Rainfall data: ~200 MB/year → ~3 GB total for 2010-2025
    Temperature:   ~50 MB/year  → ~750 MB total
    Total estimated: ~3.75 GB
#>
param(
    [int]$StartYear = 2010,
    [int]$EndYear   = 2025,
    [string]$OutputDir = ".\data\imd"
)

$ErrorActionPreference = "Stop"
$python = ".\.venv\Scripts\python.exe"

if (!(Test-Path $python)) {
    throw "Virtual environment not found. Run .\scripts\setup_windows.ps1 first."
}

Write-Host "=== VAYU IMD Data Ingestion ===" -ForegroundColor Cyan
Write-Host "Range  : $StartYear - $EndYear"
Write-Host "Output : $OutputDir"
Write-Host ""

$OutputDir | ForEach-Object { New-Item -ItemType Directory -Force -Path $_ | Out-Null }

function Invoke-ImdDownload {
    param(
        [Parameter(Mandatory = $true)][string]$Variable,
        [Parameter(Mandatory = $true)][string]$OutputName
    )

    $downloadScript = @'
import pathlib
import sys

import imdlib as imd

variable = sys.argv[1]
start_yr = int(sys.argv[2])
end_yr = int(sys.argv[3])
out_dir = sys.argv[4]
output_name = sys.argv[5]

print(f"Downloading {variable} {start_yr}-{end_yr} to {out_dir}")

try:
    data = imd.get_data(variable, start_yr, end_yr, fn_format="yearwise", file_dir=out_dir)
    ds = data.get_xarray()
    out_path = pathlib.Path(out_dir) / f"{output_name}_{start_yr}-{end_yr}.nc"
    ds.to_netcdf(str(out_path))
    print(f"Saved: {out_path}")
except Exception as ex:
    print(f"ERROR {variable}: {ex}", file=sys.stderr)
    sys.exit(1)
'@

    $tmpScript = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "imd_download_$Variable.py")
    Set-Content -Path $tmpScript -Value $downloadScript -Encoding UTF8

    try {
        & $python $tmpScript $Variable $StartYear $EndYear $OutputDir $OutputName
        if ($LASTEXITCODE -ne 0) {
            throw "IMD download failed for '$Variable'."
        }
    }
    finally {
        if (Test-Path $tmpScript) {
            Remove-Item -Path $tmpScript -Force
        }
    }
}

Write-Host "[1/4] Downloading IMD rainfall (0.25deg)..." -ForegroundColor Yellow
Invoke-ImdDownload -Variable "rain" -OutputName "rainfall"

Write-Host "[2/4] Downloading IMD temperature max (1.0deg)..." -ForegroundColor Yellow
Invoke-ImdDownload -Variable "tmax" -OutputName "tmax"

Write-Host "[3/4] Downloading IMD temperature min (1.0deg)..." -ForegroundColor Yellow
Invoke-ImdDownload -Variable "tmin" -OutputName "tmin"

Write-Host "[4/4] Clipping + preprocessing to pilot region and saving sequences..." -ForegroundColor Yellow
& $python -m data_ingestion.cli preprocess `
    --data-dir $OutputDir `
    --output-dir ".\data\processed" `
    --start-year $StartYear `
    --end-year $EndYear

if ($LASTEXITCODE -ne 0) {
    throw "Preprocessing failed. See traceback above."
}

Write-Host ""
Write-Host "=== Ingestion Complete ===" -ForegroundColor Green
Write-Host "Next steps:"
Write-Host "  1. Zip .\data\processed and upload to Kaggle Dataset"
Write-Host "  2. Run training:  .\scripts\train_kaggle.ps1"
Write-Host "  3. Download checkpoint and run:  .\scripts\train_local.ps1 --force-backprop"
