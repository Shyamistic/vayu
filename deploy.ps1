# ══════════════════════════════════════════════════════════════════════════════
# VAYU Climate Digital Twin — AWS Deployment (PowerShell)
# ══════════════════════════════════════════════════════════════════════════════
#
# Phase 1 (NO DOCKER NEEDED):
#   - S3 buckets (model + frontend)
#   - CloudFront CDN
#   - Frontend deployed → live clickable URL
#
# Phase 2 (needs Docker OR GitHub Actions):
#   - VPC, RDS, Redis, ECS Fargate backend
#   - Run: .\deploy.ps1 -Phase 2
#   - Or just push to main → GitHub Actions handles it
#
# Usage:
#   .venv\Scripts\Activate.ps1
#   .\deploy.ps1            # Phase 1 only (frontend live instantly)
#   .\deploy.ps1 -Phase 2  # Full backend infra (needs Docker for image)
# ══════════════════════════════════════════════════════════════════════════════

param(
    [int]$Phase = 1
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

Write-Host ""
Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  VAYU Climate Digital Twin — AWS Deployment (Phase $Phase)" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# ── Preflight ─────────────────────────────────────────────────────────────────
Write-Host "[0] Preflight checks..." -ForegroundColor Yellow

try {
    $AWS_ACCOUNT = (aws sts get-caller-identity --query Account --output text 2>$null)
} catch {
    Write-Host "  ERROR: AWS CLI not configured. Run 'aws configure'" -ForegroundColor Red
    exit 1
}
$AWS_REGION = if ($env:AWS_REGION) { $env:AWS_REGION } else { "ap-south-1" }

Write-Host "  Account: $AWS_ACCOUNT" -ForegroundColor Green
Write-Host "  Region:  $AWS_REGION" -ForegroundColor Green
Write-Host ""

# ── Step 1: CDK deps ─────────────────────────────────────────────────────────
Write-Host "[1] Installing CDK dependencies..." -ForegroundColor Yellow
$cdkCheck = Get-Command cdk -ErrorAction SilentlyContinue
if (-not $cdkCheck) { npm install -g aws-cdk }
Write-Host "  CDK: $(cdk --version)" -ForegroundColor Green
Write-Host ""

# ── Step 2: Bootstrap ─────────────────────────────────────────────────────────
Write-Host "[2] CDK bootstrap..." -ForegroundColor Yellow
cdk bootstrap "aws://${AWS_ACCOUNT}/${AWS_REGION}" `
    --app "python infra/app.py" `
    -c account="$AWS_ACCOUNT" -c region="$AWS_REGION" 2>$null
Write-Host "  Done" -ForegroundColor Green
Write-Host ""

# ── Step 3: Build frontend ────────────────────────────────────────────────────
Write-Host "[3] Building frontend..." -ForegroundColor Yellow
Push-Location frontend
if (-not (Test-Path "node_modules")) { npm install }
$env:VITE_API_URL = ""
npm run build
Pop-Location
Write-Host "  ✓ frontend/dist/ ready" -ForegroundColor Green
Write-Host ""

# ── Step 4: Deploy stacks ────────────────────────────────────────────────────
if ($Phase -eq 1) {
    Write-Host "[4] Deploying Phase 1 (Storage + Frontend CDN)..." -ForegroundColor Yellow
    Write-Host "  No Docker needed!" -ForegroundColor Blue
    
    cdk deploy VayuStorage VayuFrontend --require-approval never `
        --app "python infra/app.py" `
        -c account="$AWS_ACCOUNT" -c region="$AWS_REGION" `
        --outputs-file cdk-outputs.json

} else {
    Write-Host "[4] Deploying ALL stacks (VPC + Data + Backend + Frontend)..." -ForegroundColor Yellow
    Write-Host "  This needs Docker running for backend image build" -ForegroundColor Blue
    
    cdk deploy --all --require-approval never `
        --app "python infra/app.py" `
        -c account="$AWS_ACCOUNT" -c region="$AWS_REGION" `
        --outputs-file cdk-outputs.json
}
Write-Host "  ✓ Stacks deployed" -ForegroundColor Green
Write-Host ""

# ── Step 5: Upload model to S3 ───────────────────────────────────────────────
Write-Host "[5] Uploading model checkpoint..." -ForegroundColor Yellow
$MODEL_BUCKET = "vayu-climate-models-$AWS_ACCOUNT"

$modelCandidates = @(
    "checkpoints\local_test_5ep\vayu_best.pt",
    "checkpoints\v2_sanity\vayu_best.pt",
    "checkpoints\vayu_best.pt",
    "vayu_best (3).pt",
    "vayu_best (1).pt"
)
$modelFile = $modelCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($modelFile) {
    aws s3 cp "$modelFile" "s3://${MODEL_BUCKET}/checkpoints/vayu_best.pt"
    Write-Host "  ✓ Model: $modelFile -> S3" -ForegroundColor Green
} else {
    Write-Host "  ⚠ No checkpoint found (backend will use mock mode)" -ForegroundColor Yellow
}
Write-Host ""

# ── Step 6: Sync frontend to S3 (redundant with CDK BucketDeployment but ensures latest) ──
Write-Host "[6] Syncing frontend to S3..." -ForegroundColor Yellow
$FRONTEND_BUCKET = "vayu-frontend-$AWS_ACCOUNT"
aws s3 sync frontend/dist/ "s3://${FRONTEND_BUCKET}/" --delete `
    --cache-control "public, max-age=31536000, immutable" `
    --exclude "index.html"
aws s3 cp frontend/dist/index.html "s3://${FRONTEND_BUCKET}/index.html" `
    --cache-control "public, max-age=0, must-revalidate"
Write-Host "  ✓ Frontend synced" -ForegroundColor Green
Write-Host ""

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  ✅ DEPLOYMENT COMPLETE" -ForegroundColor Green
Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""

if (Test-Path cdk-outputs.json) {
    $outputs = Get-Content cdk-outputs.json | ConvertFrom-Json
    foreach ($stack in $outputs.PSObject.Properties) {
        foreach ($out in $stack.Value.PSObject.Properties) {
            if ($out.Name -match "CloudFrontUrl") {
                Write-Host "  🌐 LIVE URL: $($out.Value)" -ForegroundColor Cyan
            }
            if ($out.Name -match "BackendUrl") {
                Write-Host "  🔧 API:      $($out.Value)/docs" -ForegroundColor Cyan
            }
            if ($out.Name -match "EcrRepoUri") {
                Write-Host "  📦 ECR:      $($out.Value)" -ForegroundColor DarkGray
            }
        }
    }
}

Write-Host ""
if ($Phase -eq 1) {
    Write-Host "  Phase 1 complete: Frontend is LIVE on CloudFront!" -ForegroundColor Green
    Write-Host "  For backend: push to GitHub → Actions builds & deploys automatically" -ForegroundColor Blue
    Write-Host "  Or run: .\deploy.ps1 -Phase 2  (requires Docker)" -ForegroundColor Blue
}
Write-Host ""
