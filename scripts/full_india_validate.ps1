#!/usr/bin/env pwsh
param(
    [int]$StartYear = 2010,
    [int]$EndYear = 2025,
    [string]$RawDir = ".\data\imd",
    [string]$ProcessedDir = ".\data\processed_full_india",
    [string]$BundleDir = ".\data\kaggle_bundle_full_india",
    [int]$InputWindow = 30,
    [int]$TargetWindow = 7,
    [int]$MaxTrainSequences = 512,
    [int]$MaxValSequences = 128,
    [int]$Stride = 3,
    [int]$SmokeEpochs = 1
)

$ErrorActionPreference = "Stop"
$python = ".\.venv\Scripts\python.exe"

if (!(Test-Path $python)) {
    throw "Virtual environment not found. Run .\scripts\setup_windows.ps1 first."
}

Write-Host "=== VAYU Full India Validation Pipeline ===" -ForegroundColor Cyan
Write-Host "Years      : $StartYear-$EndYear"
Write-Host "Raw Dir    : $RawDir"
Write-Host "Processed  : $ProcessedDir"
Write-Host "Bundle Dir : $BundleDir"
Write-Host ""

New-Item -ItemType Directory -Force -Path $ProcessedDir | Out-Null
New-Item -ItemType Directory -Force -Path $BundleDir | Out-Null

Write-Host "[1/4] Preprocessing full India dataset..." -ForegroundColor Yellow
& $python -m data_ingestion.cli preprocess `
    --data-dir $RawDir `
    --output-dir $ProcessedDir `
    --start-year $StartYear `
    --end-year $EndYear `
    --region india `
    --resolution 0.25
if ($LASTEXITCODE -ne 0) { throw "Full India preprocessing failed." }

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

Write-Host "[4/4] Smoke validation training (full India tensors)..." -ForegroundColor Yellow
& $python -m ai_engine.trainer `
    --data-dir $ProcessedDir `
    --checkpoint-dir ".\checkpoints\full_india_smoke" `
    --epochs $SmokeEpochs `
    --smoke-only
if ($LASTEXITCODE -ne 0) { throw "Smoke validation training failed." }

Write-Host ""
Write-Host "=== Full India Validation Ready ===" -ForegroundColor Green
Write-Host "Created artifacts:"
Write-Host "  - $normalizedPath"
Write-Host "  - $(Join-Path $ProcessedDir 'train_sequences.pt')"
Write-Host "  - $(Join-Path $ProcessedDir 'val_sequences.pt')"
Write-Host "  - $(Join-Path $BundleDir 'bundle_manifest.json')"
Write-Host "  - .\checkpoints\full_india_smoke\smoke_summary.json"
