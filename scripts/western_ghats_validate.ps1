#!/usr/bin/env pwsh
param(
    [int]$StartYear = 2010,
    [int]$EndYear = 2025,
    [string]$RawDir = ".\data\imd",
    [string]$ProcessedDir = ".\data\processed_western_ghats",
    [string]$BundleDir = ".\data\kaggle_bundle_western_ghats",
    [int]$InputWindow = 30,
    [int]$TargetWindow = 7,
    [int]$MaxTrainSequences = 512,
    [int]$MaxValSequences = 128,
    [int]$Stride = 3,
    [int]$SmokeEpochs = 1,
    [switch]$RunBaselines = $true
)

$ErrorActionPreference = "Stop"
$python = ".\.venv\Scripts\python.exe"

if (!(Test-Path $python)) {
    throw "Virtual environment not found. Run .\scripts\setup_windows.ps1 first."
}

Write-Host "=== VAYU Western Ghats Validation Pipeline ===" -ForegroundColor Cyan
Write-Host "Years      : $StartYear-$EndYear"
Write-Host "Raw Dir    : $RawDir"
Write-Host "Processed  : $ProcessedDir"
Write-Host "Bundle Dir : $BundleDir"
Write-Host ""

New-Item -ItemType Directory -Force -Path $ProcessedDir | Out-Null
New-Item -ItemType Directory -Force -Path $BundleDir | Out-Null

Write-Host "[1/4] Preprocessing Western Ghats dataset..." -ForegroundColor Yellow
& $python -m data_ingestion.cli preprocess `
    --data-dir $RawDir `
    --output-dir $ProcessedDir `
    --start-year $StartYear `
    --end-year $EndYear `
    --region western_ghats `
    --resolution 0.25
if ($LASTEXITCODE -ne 0) { throw "Western Ghats preprocessing failed." }

$normalizedPath = Join-Path $ProcessedDir "normalized_${StartYear}-${EndYear}.nc"
if (!(Test-Path $normalizedPath)) {
    throw "Expected normalized dataset not found at $normalizedPath"
}

Write-Host "[2/4] Building train/val sequence tensors..." -ForegroundColor Yellow
& $python -m data_ingestion.cli build-sequences `
    --normalized-file $normalizedPath `
    --output-dir $ProcessedDir `
    --input-window $InputWindow `
    --target-window $TargetWindow `
    --max-train $MaxTrainSequences `
    --max-val $MaxValSequences `
    --stride $Stride
if ($LASTEXITCODE -ne 0) { throw "Sequence generation failed." }

Write-Host "[3/4] Packaging Kaggle dataset bundle..." -ForegroundColor Yellow
& $python -m data_ingestion.cli package-dataset `
    --raw-dir $RawDir `
    --processed-dir $ProcessedDir `
    --output-dir $BundleDir
if ($LASTEXITCODE -ne 0) { throw "Dataset packaging failed." }

Write-Host "[4/4] Smoke validation training (Western Ghats tensors)..." -ForegroundColor Yellow
if ($RunBaselines) {
    Write-Host "      Baseline suite enabled: persistence/climatology/RF/XGBoost(optional)" -ForegroundColor DarkYellow
}

$normParamsPath = Join-Path $ProcessedDir "norm_params_${StartYear}-${EndYear}.nc"

$trainerArgs = @(
    "-m", "ai_engine.trainer",
    "--data-dir", $ProcessedDir,
    "--checkpoint-dir", ".\checkpoints\western_ghats_smoke",
    "--epochs", "$SmokeEpochs",
    "--norm-params-file", $normParamsPath,
    "--require-benchmarks",
    "--smoke-only"
)
if ($RunBaselines) {
    $trainerArgs += "--run-baselines"
}

& $python @trainerArgs
if ($LASTEXITCODE -ne 0) { throw "Smoke validation training failed." }

Write-Host ""
Write-Host "=== Western Ghats Validation Ready ===" -ForegroundColor Green
Write-Host "Created artifacts:"
Write-Host "  - $normalizedPath"
Write-Host "  - $(Join-Path $ProcessedDir 'train_sequences.pt')"
Write-Host "  - $(Join-Path $ProcessedDir 'val_sequences.pt')"
Write-Host "  - $normParamsPath"
Write-Host "  - $(Join-Path $BundleDir 'bundle_manifest.json')"
Write-Host "  - .\checkpoints\western_ghats_smoke\smoke_summary.json"
if ($RunBaselines) {
    Write-Host "  - .\checkpoints\western_ghats_smoke\baseline_benchmark_report.json"
}
