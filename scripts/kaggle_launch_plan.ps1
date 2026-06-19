param(
    [string]$KaggleUser = "shyam31415"
)

Write-Host "Kaggle Launch Plan for @$KaggleUser" -ForegroundColor Cyan
Write-Host ""
Write-Host "1) Create a new Kaggle Notebook (GPU: T4 or P100, Internet ON)."
Write-Host "2) Add your dataset(s): IMD + MOSDAC processed tensors."
Write-Host "3) In first cell install deps:" -ForegroundColor Yellow
Write-Host "   !pip install torch-geometric==2.5.3 xarray netcdf4" -ForegroundColor Gray
Write-Host "4) Upload project code zip or attach via Dataset source."
Write-Host "5) Run training with reduced config first (smoke test 3 epochs)."
Write-Host "6) Scale to full run (30-50 epochs), save checkpoint to /kaggle/working."
Write-Host "7) Publish model artifact as Kaggle Dataset output." -ForegroundColor Yellow
Write-Host ""
Write-Host "Recommended model path for Kaggle quota:" -ForegroundColor Green
Write-Host "  Regional GraphSAGE + Temporal Transformer (current VAYU architecture)"
Write-Host "  Avoid full GraphCast pretraining on Kaggle free quota (too heavy)."
