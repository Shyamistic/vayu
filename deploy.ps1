# ══════════════════════════════════════════════════════════════════════════════
# VAYU Climate Digital Twin — Full AWS Deployment (PowerShell)
# ══════════════════════════════════════════════════════════════════════════════
#
# Prerequisites:
#   1. AWS CLI configured (aws configure)
#   2. Node.js + npm installed
#   3. Python 3.11+ with pip
#   4. Docker Desktop running
#
# Usage:
#   .\deploy.ps1
# ══════════════════════════════════════════════════════════════════════════════

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

Write-Host ""
Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  VAYU Climate Digital Twin — AWS Deployment" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# ── Step 0: Preflight ─────────────────────────────────────────────────────────
Write-Host "[0/7] Preflight checks..." -ForegroundColor Yellow

$null = Get-Command aws -ErrorAction SilentlyContinue
if (-not $?) { Write-Host "Error: AWS CLI not found. Install: https://aws.amazon.com/cli/" -ForegroundColor Red; exit 1 }
$null = Get-Command node -ErrorAction SilentlyContinue
if (-not $?) { Write-Host "Error: Node.js not found. Install: https://nodejs.org" -ForegroundColor Red; exit 1 }
$null = Get-Command docker -ErrorAction SilentlyContinue
if (-not $?) { Write-Host "Error: Docker not found. Install: https://docker.com" -ForegroundColor Red; exit 1 }

try {
    $AWS_ACCOUNT = (aws sts get-caller-identity --query Account --output text)
} catch {
    Write-Host "Error: AWS credentials not configured. Run 'aws configure' first." -ForegroundColor Red
    exit 1
}
$AWS_REGION = if ($env:AWS_REGION) { $env:AWS_REGION } else { "ap-south-1" }

Write-Host "  AWS Account: $AWS_ACCOUNT" -ForegroundColor Green
Write-Host "  AWS Region:  $AWS_REGION" -ForegroundColor Green
Write-Host ""

# ── Step 1: Install CDK ──────────────────────────────────────────────────────
Write-Host "[1/7] Installing CDK dependencies..." -ForegroundColor Yellow

$cdkInstalled = Get-Command cdk -ErrorAction SilentlyContinue
if (-not $cdkInstalled) {
    npm install -g aws-cdk
}
Write-Host "  CDK version: $(cdk --version)"

pip install -q -r infra/requirements.txt
Write-Host "  ✓ CDK dependencies ready" -ForegroundColor Green
Write-Host ""

# ── Step 2: Bootstrap CDK ─────────────────────────────────────────────────────
Write-Host "[2/7] Bootstrapping CDK..." -ForegroundColor Yellow
cdk bootstrap "aws://${AWS_ACCOUNT}/${AWS_REGION}" --app "python infra/app.py" `
    -c account="$AWS_ACCOUNT" -c region="$AWS_REGION" 2>$null
Write-Host "  ✓ CDK bootstrapped" -ForegroundColor Green
Write-Host ""

# ── Step 3: Build frontend ────────────────────────────────────────────────────
Write-Host "[3/7] Building frontend..." -ForegroundColor Yellow
Set-Location frontend

if (-not (Test-Path "node_modules")) {
    npm install
}

$env:VITE_API_URL = ""
npm run build
Write-Host "  ✓ Frontend built → frontend/dist/" -ForegroundColor Green
Set-Location $ScriptDir
Write-Host ""

# ── Step 4: Deploy CDK stacks ────────────────────────────────────────────────
Write-Host "[4/7] Deploying CDK stacks (VPC, Storage, Data, Backend, CDN)..." -ForegroundColor Yellow
Write-Host "  This takes 10-20 minutes on first deploy..." -ForegroundColor Blue

cdk deploy --all --require-approval never `
    --app "python infra/app.py" `
    -c account="$AWS_ACCOUNT" `
    -c region="$AWS_REGION" `
    --outputs-file cdk-outputs.json

Write-Host "  ✓ All stacks deployed" -ForegroundColor Green
Write-Host ""

# ── Step 5: Upload model to S3 ───────────────────────────────────────────────
Write-Host "[5/7] Uploading model checkpoint to S3..." -ForegroundColor Yellow

$MODEL_BUCKET = "vayu-climate-models-$AWS_ACCOUNT"

$modelCandidates = @(
    "./checkpoints/vayu_best.pt",
    "./checkpoints/local_test_5ep/vayu_best.pt",
    "./checkpoints/v2_sanity/vayu_best.pt",
    "./vayu_best (3).pt",
    "./vayu_best (2).pt",
    "./vayu_best (1).pt"
)

$modelFile = $null
foreach ($candidate in $modelCandidates) {
    if (Test-Path $candidate) {
        $modelFile = $candidate
        break
    }
}

if ($modelFile) {
    aws s3 cp $modelFile "s3://${MODEL_BUCKET}/checkpoints/vayu_best.pt"
    Write-Host "  ✓ Model uploaded: $modelFile" -ForegroundColor Green
} else {
    Write-Host "  ⚠ No model checkpoint found — backend will run in mock mode" -ForegroundColor Yellow
}
Write-Host ""

# ── Step 6: Upload frontend to S3 ────────────────────────────────────────────
Write-Host "[6/7] Uploading frontend to S3..." -ForegroundColor Yellow

$FRONTEND_BUCKET = "vayu-frontend-$AWS_ACCOUNT"
aws s3 sync frontend/dist/ "s3://${FRONTEND_BUCKET}/" --delete `
    --cache-control "public, max-age=31536000, immutable" `
    --exclude "index.html"

aws s3 cp frontend/dist/index.html "s3://${FRONTEND_BUCKET}/index.html" `
    --cache-control "public, max-age=0, must-revalidate"

Write-Host "  ✓ Frontend deployed to S3" -ForegroundColor Green
Write-Host ""

# ── Step 7: Print outputs ────────────────────────────────────────────────────
Write-Host "[7/7] Deployment complete!" -ForegroundColor Yellow

if (Test-Path cdk-outputs.json) {
    $outputs = Get-Content cdk-outputs.json | ConvertFrom-Json
    $cfUrl = ""
    $backendUrl = ""
    
    foreach ($stack in $outputs.PSObject.Properties) {
        foreach ($output in $stack.Value.PSObject.Properties) {
            if ($output.Name -match "CloudFrontUrl") { $cfUrl = $output.Value }
            if ($output.Name -match "BackendUrl") { $backendUrl = $output.Value }
        }
    }
}

Write-Host ""
Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  ✅ VAYU IS LIVE!" -ForegroundColor Green
Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
if ($cfUrl) {
    Write-Host "  🌐 Frontend:    $cfUrl" -ForegroundColor Cyan
}
if ($backendUrl) {
    Write-Host "  🔧 API Docs:    $backendUrl/docs" -ForegroundColor Cyan
    Write-Host "  💚 Health:      $backendUrl/health" -ForegroundColor Cyan
}
Write-Host ""
Write-Host "  📊 Model Bucket:    s3://$MODEL_BUCKET"
Write-Host "  🪣 Frontend Bucket: s3://$FRONTEND_BUCKET"
Write-Host "  ☁️  Region:          $AWS_REGION"
Write-Host "  💳 Account:         $AWS_ACCOUNT"
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor Blue
Write-Host "    • Open the CloudFront URL above in your browser"
Write-Host "    • Custom domain? Add Route53 + ACM certificate"
Write-Host "    • Monitor: aws logs tail /vayu/backend --follow"
Write-Host "    • Redeploy: .\deploy.ps1 (incremental ~3 min)"
Write-Host ""
Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Green
