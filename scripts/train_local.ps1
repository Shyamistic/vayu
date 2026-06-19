param(
    [int]$Epochs = 50,
    [string]$Device = "cuda"
)

$ErrorActionPreference = "Stop"

if (!(Test-Path ".venv\Scripts\python.exe")) {
    throw ".venv not found. Run .\scripts\setup_windows.ps1 first."
}

$python = ".venv\Scripts\python.exe"

Write-Host "Starting local training..." -ForegroundColor Cyan
Write-Host "Device: $Device | Epochs: $Epochs" -ForegroundColor Gray

& $python -m ai_engine.trainer --data-dir ./data/processed --checkpoint-dir ./checkpoints --epochs $Epochs --device $Device

Write-Host "Training command finished." -ForegroundColor Green
