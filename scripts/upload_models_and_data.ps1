# Uploads model checkpoints and processed climate bundles to the VAYU model bucket.
#
# Layout expected by backend/entrypoint.sh:
#
#   s3://<bucket>/checkpoints/vayu_best.pt                   global fallback model
#   s3://<bucket>/checkpoints/regions/<region>/vayu_best.pt   per-region models
#   s3://<bucket>/data/<processed_dir>/normalized_*.nc        z-scored fields
#   s3://<bucket>/data/<processed_dir>/norm_params_*.nc       per-cell mean/std
#
# norm_params is uploaded alongside normalized on purpose. Without it the API
# denormalizes every region with flat Western Ghats constants, and
# /api/sensitivity reports slopes in z-score units rather than mm/day per degC.
#
# Re-runnable: "aws s3 sync" skips objects that already match.
#
#   . .\scripts\aws_env.ps1
#   .\scripts\upload_models_and_data.ps1              # models + all data
#   .\scripts\upload_models_and_data.ps1 -ModelsOnly  # just the checkpoints
#
# NOTE: keep this file ASCII-only. Windows PowerShell 5.1 reads .ps1 as ANSI
# unless there is a BOM, so UTF-8 punctuation (em dashes, box drawing) corrupts
# the token stream and produces misleading "missing closing brace" parse errors.

param(
    [string]$DataRoot = 'D:/vayu_data',
    [string]$StaticRoot = 'D:/',
    [string]$Bucket = '',
    [switch]$ModelsOnly,
    [string[]]$Regions = @(
        'processed_western_ghats_1981',
        'processed_north_east_india_1981',
        'processed_indo_gangetic_plain_1981',
        'processed_central_india_1981',
        'processed_full_india_05'
    ),
    # Must match main.py _REGION_STATIC_DIRS. full_india deliberately uses the
    # 0.5 deg product, which is the grid its checkpoint was trained on.
    [string[]]$StaticDirs = @(
        'static_western_ghats',
        'static_north_east_india',
        'static_indo_gangetic_plain',
        'static_central_india',
        'static_full_india_05'
    )
)

$ErrorActionPreference = 'Continue'
$repoRoot = Split-Path $PSScriptRoot -Parent

# Region id -> local checkpoint. Keys must match main.py _REGION_CHECKPOINT_DIRS.
$regionModels = [ordered]@{
    'western_ghats'       = 'checkpoints/regions/western_ghats/vayu_best.pt'
    'north_east_india'    = 'checkpoints/regions/north_east_india/vayu_best.pt'
    'indo_gangetic_plain' = 'checkpoints/regions/indo_gangetic_plain/vayu_best.pt'
    'central_india'       = 'checkpoints/regions/central_india/vayu_best.pt'
    'full_india'          = 'checkpoints/regions/full_india/vayu_best.pt'
}

if (-not $Bucket) {
    $q = "Stacks[0].Outputs[?OutputKey=='ModelBucketName'].OutputValue"
    $Bucket = (& aws cloudformation describe-stacks --stack-name VayuStorage --query $q --output text 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $Bucket) {
        throw "Could not resolve the model bucket from VayuStorage outputs: $Bucket"
    }
}
Write-Host "Target bucket: s3://$Bucket" -ForegroundColor Cyan

# Global fallback checkpoint
$globalCkpt = Join-Path $repoRoot 'checkpoints/vayu_best.pt'
Write-Host ""
Write-Host "[1] Global fallback checkpoint"
if (Test-Path $globalCkpt) {
    & aws s3 cp $globalCkpt "s3://$Bucket/checkpoints/vayu_best.pt" --only-show-errors
    if ($LASTEXITCODE -eq 0) {
        Write-Host "    ok" -ForegroundColor Green
    } else {
        Write-Host "    FAILED" -ForegroundColor Red
    }
} else {
    Write-Host "    WARNING: $globalCkpt missing" -ForegroundColor Yellow
}

# Per-region checkpoints
Write-Host ""
Write-Host "[2] Per-region checkpoints"
foreach ($region in $regionModels.Keys) {
    $local = Join-Path $repoRoot $regionModels[$region]
    if (-not (Test-Path $local)) {
        Write-Host "    $region : MISSING at $local (will fall back to global model)" -ForegroundColor Yellow
        continue
    }
    $mb = [math]::Round((Get-Item $local).Length / 1MB, 1)
    & aws s3 cp $local "s3://$Bucket/checkpoints/regions/$region/vayu_best.pt" --only-show-errors
    if ($LASTEXITCODE -eq 0) {
        Write-Host "    $region : uploaded $mb MB" -ForegroundColor Green
    } else {
        Write-Host "    $region : FAILED" -ForegroundColor Red
    }
}

# Static rasters (elevation + land-sea mask).
# These are model INPUT features. Without them ClimateGraphBuilder substitutes a
# synthetic ridge and coastline, so inference runs on different inputs than
# training. Only a few hundred KB per region, so there is no reason to omit them.
Write-Host ""
Write-Host "[3] Static rasters (elevation + land-sea mask)"
foreach ($dir in $StaticDirs) {
    $localDir = Join-Path $StaticRoot $dir
    if (-not (Test-Path $localDir)) {
        Write-Host "    $dir : MISSING locally (region will use SYNTHETIC terrain)" -ForegroundColor Yellow
        continue
    }
    $hasElev = Test-Path (Join-Path $localDir 'elevation.nc')
    $hasLsm = Test-Path (Join-Path $localDir 'lsm.nc')
    if (-not ($hasElev -and $hasLsm)) {
        Write-Host "    $dir : incomplete (elevation=$hasElev lsm=$hasLsm)" -ForegroundColor Yellow
        continue
    }
    & aws s3 sync $localDir "s3://$Bucket/static/$dir/" --exclude '*' --include 'elevation.nc' --include 'lsm.nc' --only-show-errors
    if ($LASTEXITCODE -eq 0) {
        Write-Host "    $dir : uploaded" -ForegroundColor Green
    } else {
        Write-Host "    $dir : FAILED" -ForegroundColor Red
    }
}

if ($ModelsOnly) {
    Write-Host ""
    Write-Host "Models only - skipping climate bundles."
    return
}

# Climate bundles
Write-Host ""
Write-Host "[4] Climate bundles (normalized + norm_params)"
foreach ($dir in $Regions) {
    $localDir = Join-Path $DataRoot $dir
    if (-not (Test-Path $localDir)) {
        Write-Host "    $dir : MISSING locally, skipped" -ForegroundColor Yellow
        continue
    }
    $files = Get-ChildItem $localDir -Filter '*.nc' | Where-Object {
        $_.Name -like 'normalized_*' -or $_.Name -like 'norm_params_*'
    }
    if (-not $files) {
        Write-Host "    $dir : no matching .nc files, skipped" -ForegroundColor Yellow
        continue
    }
    $mb = [math]::Round((($files | Measure-Object Length -Sum).Sum) / 1MB, 0)
    Write-Host "    $dir : syncing $($files.Count) file(s), $mb MB"

    & aws s3 sync $localDir "s3://$Bucket/data/$dir/" --exclude '*' --include 'normalized_*.nc' --include 'norm_params_*.nc' --only-show-errors
    if ($LASTEXITCODE -eq 0) {
        Write-Host "      done" -ForegroundColor Green
    } else {
        Write-Host "      FAILED" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "Upload finished." -ForegroundColor Cyan
