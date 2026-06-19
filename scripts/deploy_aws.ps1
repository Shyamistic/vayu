#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Deploy VAYU Climate Digital Twin to AWS production using CDK.

.DESCRIPTION
    Full end-to-end deployment:
      1. Install AWS CDK dependencies
      2. Bootstrap CDK (first time only)
      3. Build frontend
      4. Deploy all stacks (VPC, Data, Storage, Backend, CDN)
      5. Upload frontend assets to S3
      6. Print live URLs

.PREREQUISITES
    - AWS CLI configured: aws configure
    - Node.js >= 18 (for CDK CLI)
    - Docker running (for building container image)
    - AWS Account ID and region set in infra/cdk.json

.EXAMPLE
    .\scripts\deploy_aws.ps1 -AccountId 123456789012 -Region ap-south-1 -ModelS3Uri s3://your-bucket/vayu_best.pt

.NOTES
    Estimated deploy time: 20-30 minutes (first deploy, RDS takes longest)
    Estimated cost: ~$41/month with $300 credits → ~7 months runway
#>
param(
    [Parameter(Mandatory=$true)]
    [string]$AccountId,

    [string]$Region = "ap-south-1",

    [string]$ModelS3Uri = "",

    [switch]$BootstrapOnly = $false
)

$ErrorActionPreference = "Stop"

Write-Host "=== VAYU AWS Production Deployment ===" -ForegroundColor Cyan
Write-Host "Account : $AccountId"
Write-Host "Region  : $Region"
Write-Host ""

# ── 1. Verify prerequisites ───────────────────────────────────────────────────
Write-Host "[1/8] Checking prerequisites..." -ForegroundColor Yellow

$awsVersion = aws --version 2>&1
if ($LASTEXITCODE -ne 0) { throw "AWS CLI not found. Install from https://aws.amazon.com/cli/" }
Write-Host "  AWS CLI: $awsVersion"

$nodeVersion = node --version 2>&1
if ($LASTEXITCODE -ne 0) { throw "Node.js not found. Install from https://nodejs.org" }
Write-Host "  Node.js: $nodeVersion"

$dockerInfo = docker info 2>&1
if ($LASTEXITCODE -ne 0) { throw "Docker not running. Start Docker Desktop." }
Write-Host "  Docker: OK"

# Verify AWS credentials
$callerIdentity = aws sts get-caller-identity --query Account --output text 2>&1
if ($LASTEXITCODE -ne 0) { throw "AWS credentials not configured. Run: aws configure" }
Write-Host "  AWS Account: $callerIdentity"

# ── 2. Install CDK dependencies ───────────────────────────────────────────────
Write-Host "[2/8] Installing CDK Python dependencies..." -ForegroundColor Yellow
Push-Location ".\infra"
pip install -r requirements.txt -q
Pop-Location

# Install CDK CLI if needed
$cdkVersion = npx cdk --version 2>&1
Write-Host "  CDK: $cdkVersion"

# ── 3. Bootstrap CDK (first-time only) ────────────────────────────────────────
Write-Host "[3/8] Bootstrapping CDK environment..." -ForegroundColor Yellow
npx cdk bootstrap "aws://$AccountId/$Region" `
    --app "python3 infra/app.py" `
    --toolkit-stack-name CDKToolkit `
    -c account=$AccountId -c region=$Region

if ($BootstrapOnly) {
    Write-Host "Bootstrap complete. Run without -BootstrapOnly to continue deployment." -ForegroundColor Green
    exit 0
}

# ── 4. Build frontend ─────────────────────────────────────────────────────────
Write-Host "[4/8] Building React frontend..." -ForegroundColor Yellow
Push-Location ".\frontend"
npm install --silent
npm run build
Pop-Location
Write-Host "  Frontend built: .\frontend\dist"

# ── 5. Deploy AWS stacks ──────────────────────────────────────────────────────
Write-Host "[5/8] Deploying AWS infrastructure stacks..." -ForegroundColor Yellow
Write-Host "  This takes 20-30 minutes on first deploy (RDS provisioning takes ~15 min)"

$cdkArgs = @(
    "deploy", "--all",
    "--app", "python3 infra/app.py",
    "-c", "account=$AccountId",
    "-c", "region=$Region",
    "--require-approval", "never",
    "--outputs-file", ".\infra\cdk-outputs.json"
)
npx cdk @cdkArgs

if ($LASTEXITCODE -ne 0) { throw "CDK deployment failed" }

# ── 6. Read outputs ───────────────────────────────────────────────────────────
Write-Host "[6/8] Reading stack outputs..." -ForegroundColor Yellow
$outputs = Get-Content ".\infra\cdk-outputs.json" | ConvertFrom-Json
$frontendBucket = $outputs.VayuStorage.FrontendBucketName
$modelBucket    = $outputs.VayuStorage.ModelBucketName
$cfUrl          = $outputs.VayuCdn.CloudFrontUrl
$backendUrl     = $outputs.VayuBackend.BackendUrl

Write-Host "  Frontend bucket : $frontendBucket"
Write-Host "  Model bucket    : $modelBucket"
Write-Host "  Backend URL     : $backendUrl"
Write-Host "  CloudFront URL  : $cfUrl"

# ── 7. Upload frontend assets to S3 ──────────────────────────────────────────
Write-Host "[7/8] Uploading frontend to S3..." -ForegroundColor Yellow
aws s3 sync ".\frontend\dist" "s3://$frontendBucket" `
    --delete `
    --cache-control "public,max-age=31536000,immutable" `
    --exclude "*.html"

aws s3 sync ".\frontend\dist" "s3://$frontendBucket" `
    --delete `
    --cache-control "no-cache,no-store,must-revalidate" `
    --include "*.html"

Write-Host "  Frontend deployed to S3"

# ── 8. Upload model checkpoint (optional) ─────────────────────────────────────
if ($ModelS3Uri -ne "" -and (Test-Path ".\checkpoints\vayu_best.pt")) {
    Write-Host "[8/8] Uploading model checkpoint to S3..." -ForegroundColor Yellow
    aws s3 cp ".\checkpoints\vayu_best.pt" "s3://$modelBucket/checkpoints/vayu_best.pt"
    Write-Host "  Model uploaded to s3://$modelBucket/checkpoints/vayu_best.pt"
} else {
    Write-Host "[8/8] Skipping model upload (no checkpoint found or no URI specified)" -ForegroundColor Gray
    Write-Host "  After training on Kaggle, run:"
    Write-Host "    aws s3 cp vayu_best.pt s3://$modelBucket/checkpoints/vayu_best.pt"
}

# ── Summary ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "=== DEPLOYMENT COMPLETE ===" -ForegroundColor Green
Write-Host ""
Write-Host "Live URLs:" -ForegroundColor Cyan
Write-Host "  Platform  : $cfUrl" -ForegroundColor White
Write-Host "  API docs  : $backendUrl/docs" -ForegroundColor White
Write-Host "  Health    : $cfUrl/health" -ForegroundColor White
Write-Host ""
Write-Host "Post-deploy checklist:" -ForegroundColor Yellow
Write-Host "  1. Set Cesium token in frontend .env: VITE_CESIUM_ION_TOKEN=..."
Write-Host "  2. Set Google Maps key:              VITE_GOOGLE_MAPS_API_KEY=..."
Write-Host "  3. Verify health: curl $cfUrl/health"
Write-Host "  4. Upload model after Kaggle training: aws s3 cp vayu_best.pt s3://$modelBucket/checkpoints/"
Write-Host ""
Write-Host "Estimated monthly cost: ~\$41 (within your \$300 credit budget for 7+ months)" -ForegroundColor Green
