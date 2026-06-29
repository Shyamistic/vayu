#!/bin/bash
# ══════════════════════════════════════════════════════════════════════════════
# VAYU Climate Digital Twin — Full AWS Deployment Script
# ══════════════════════════════════════════════════════════════════════════════
#
# Prerequisites:
#   1. AWS CLI configured (aws configure) with credentials that have admin access
#   2. Node.js + npm installed (for CDK and frontend build)
#   3. Python 3.11+ with pip
#   4. Docker running (for ECS container build)
#
# Usage:
#   chmod +x deploy.sh
#   ./deploy.sh
#
# What this does:
#   1. Installs CDK CLI + Python CDK dependencies
#   2. Bootstraps CDK in your AWS account (ap-south-1)
#   3. Builds the frontend (Vite → dist/)
#   4. Deploys all CDK stacks (VPC, Storage, Data, Backend, CDN)
#   5. Uploads model checkpoint to S3
#   6. Uploads frontend build to S3
#   7. Prints the live CloudFront URL
#
# Estimated time: 15-25 minutes (first deploy)
# Estimated cost: ~$41/month with $300 AWS credits → 7 months runway
# ══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  VAYU Climate Digital Twin — AWS Deployment${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo ""

# ── Step 0: Preflight checks ─────────────────────────────────────────────────
echo -e "${YELLOW}[0/7] Preflight checks...${NC}"

command -v aws >/dev/null 2>&1 || { echo -e "${RED}Error: AWS CLI not found. Install: https://aws.amazon.com/cli/${NC}"; exit 1; }
command -v node >/dev/null 2>&1 || { echo -e "${RED}Error: Node.js not found. Install: https://nodejs.org${NC}"; exit 1; }
command -v python3 >/dev/null 2>&1 || command -v python >/dev/null 2>&1 || { echo -e "${RED}Error: Python 3 not found${NC}"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo -e "${RED}Error: Docker not found. Install: https://docker.com${NC}"; exit 1; }

# Check AWS credentials
AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text 2>/dev/null) || {
    echo -e "${RED}Error: AWS credentials not configured. Run 'aws configure' first.${NC}"
    exit 1
}
AWS_REGION="${AWS_REGION:-ap-south-1}"
echo -e "  AWS Account: ${GREEN}${AWS_ACCOUNT}${NC}"
echo -e "  AWS Region:  ${GREEN}${AWS_REGION}${NC}"
echo ""

# ── Step 1: Install CDK dependencies ─────────────────────────────────────────
echo -e "${YELLOW}[1/7] Installing CDK dependencies...${NC}"

# Install CDK CLI globally if not present
if ! command -v cdk >/dev/null 2>&1; then
    npm install -g aws-cdk
fi
echo "  CDK version: $(cdk --version)"

# Install Python CDK libs
pip install -q -r infra/requirements.txt
echo -e "  ${GREEN}✓ CDK dependencies ready${NC}"
echo ""

# ── Step 2: Bootstrap CDK ─────────────────────────────────────────────────────
echo -e "${YELLOW}[2/7] Bootstrapping CDK (if needed)...${NC}"
cdk bootstrap "aws://${AWS_ACCOUNT}/${AWS_REGION}" --app "python3 infra/app.py" \
    -c account="${AWS_ACCOUNT}" -c region="${AWS_REGION}" 2>/dev/null || true
echo -e "  ${GREEN}✓ CDK bootstrapped${NC}"
echo ""

# ── Step 3: Build frontend ────────────────────────────────────────────────────
echo -e "${YELLOW}[3/7] Building frontend...${NC}"
cd frontend

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    npm install
fi

# Build with production API URL pointing to CloudFront (relative /api path)
VITE_API_URL="" npm run build
echo -e "  ${GREEN}✓ Frontend built → frontend/dist/ ($(du -sh dist | cut -f1))${NC}"
cd "$SCRIPT_DIR"
echo ""

# ── Step 4: Deploy CDK stacks ────────────────────────────────────────────────
echo -e "${YELLOW}[4/7] Deploying CDK stacks (VPC, Storage, Data, Backend, CDN)...${NC}"
echo -e "  ${BLUE}This takes 10-20 minutes on first deploy...${NC}"

cdk deploy --all --require-approval never \
    --app "python3 infra/app.py" \
    -c account="${AWS_ACCOUNT}" \
    -c region="${AWS_REGION}" \
    --outputs-file cdk-outputs.json

echo -e "  ${GREEN}✓ All stacks deployed${NC}"
echo ""

# ── Step 5: Upload model checkpoint to S3 ────────────────────────────────────
echo -e "${YELLOW}[5/7] Uploading model checkpoint to S3...${NC}"

MODEL_BUCKET="vayu-climate-models-${AWS_ACCOUNT}"

# Find best available checkpoint
MODEL_FILE=""
for candidate in \
    "./checkpoints/vayu_best.pt" \
    "./checkpoints/local_test_5ep/vayu_best.pt" \
    "./checkpoints/v2_sanity/vayu_best.pt" \
    "./vayu_best (3).pt" \
    "./vayu_best (2).pt" \
    "./vayu_best (1).pt"; do
    if [ -f "$candidate" ]; then
        MODEL_FILE="$candidate"
        break
    fi
done

if [ -n "$MODEL_FILE" ]; then
    aws s3 cp "$MODEL_FILE" "s3://${MODEL_BUCKET}/checkpoints/vayu_best.pt"
    echo -e "  ${GREEN}✓ Model uploaded: ${MODEL_FILE} → s3://${MODEL_BUCKET}/checkpoints/vayu_best.pt${NC}"
else
    echo -e "  ${YELLOW}⚠ No model checkpoint found — backend will run in mock mode${NC}"
fi
echo ""

# ── Step 6: Upload frontend to S3 ────────────────────────────────────────────
echo -e "${YELLOW}[6/7] Uploading frontend to S3...${NC}"

FRONTEND_BUCKET="vayu-frontend-${AWS_ACCOUNT}"
aws s3 sync frontend/dist/ "s3://${FRONTEND_BUCKET}/" --delete \
    --cache-control "public, max-age=31536000, immutable" \
    --exclude "index.html"

# index.html should NOT be cached long
aws s3 cp frontend/dist/index.html "s3://${FRONTEND_BUCKET}/index.html" \
    --cache-control "public, max-age=0, must-revalidate"

echo -e "  ${GREEN}✓ Frontend deployed to S3${NC}"
echo ""

# ── Step 7: Extract outputs and print URL ────────────────────────────────────
echo -e "${YELLOW}[7/7] Extracting deployment outputs...${NC}"

# Parse CloudFront URL from CDK outputs
if [ -f cdk-outputs.json ]; then
    CF_URL=$(python3 -c "
import json
with open('cdk-outputs.json') as f:
    outputs = json.load(f)
for stack_name, values in outputs.items():
    for key, val in values.items():
        if 'CloudFrontUrl' in key or 'CloudFront' in key:
            print(val)
            break
" 2>/dev/null || echo "")

    BACKEND_URL=$(python3 -c "
import json
with open('cdk-outputs.json') as f:
    outputs = json.load(f)
for stack_name, values in outputs.items():
    for key, val in values.items():
        if 'BackendUrl' in key:
            print(val)
            break
" 2>/dev/null || echo "")
fi

echo ""
echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ VAYU IS LIVE!${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
echo ""
if [ -n "${CF_URL:-}" ]; then
    echo -e "  🌐 ${GREEN}Frontend:${NC} ${CF_URL}"
fi
if [ -n "${BACKEND_URL:-}" ]; then
    echo -e "  🔧 ${GREEN}Backend API:${NC} ${BACKEND_URL}/docs"
    echo -e "  💚 ${GREEN}Health:${NC}      ${BACKEND_URL}/health"
fi
echo ""
echo -e "  📊 Model Bucket:    s3://${MODEL_BUCKET}"
echo -e "  🪣 Frontend Bucket: s3://${FRONTEND_BUCKET}"
echo -e "  ☁️  Region:          ${AWS_REGION}"
echo -e "  💳 Account:         ${AWS_ACCOUNT}"
echo ""
echo -e "${BLUE}  Next steps:${NC}"
echo -e "    • Open the CloudFront URL above in your browser"
echo -e "    • Custom domain? Add Route53 + ACM certificate"
echo -e "    • Monitor: aws logs tail /vayu/backend --follow"
echo -e "    • Update: git push → ./deploy.sh (incremental ~3 min)"
echo ""
echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
