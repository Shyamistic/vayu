#!/bin/bash
# backend/entrypoint.sh — Download model + dataset from S3, construct DATABASE_URL, start app

set -e

MODEL_PATH="${MODEL_PATH:-/app/checkpoints/vayu_best.pt}"
MODEL_S3="${MODEL_S3_URI:-s3://vayu-climate-models/checkpoints/vayu_best.pt}"
DATA_DIR="/app/data/processed_western_ghats"
DATA_S3="s3://vayu-climate-models-275688773412/data/processed_western_ghats/normalized_2010-2025.nc"

mkdir -p "$(dirname "$MODEL_PATH")"
mkdir -p "$DATA_DIR"

# ── Download model from S3 if not present locally ─────────────────────────────
if [ ! -f "$MODEL_PATH" ]; then
    echo "[entrypoint] Model not found at $MODEL_PATH — attempting S3 download..."
    if aws s3 cp "$MODEL_S3" "$MODEL_PATH" 2>/dev/null; then
        echo "[entrypoint] Model downloaded from S3: $(du -sh "$MODEL_PATH" | cut -f1)"
    else
        echo "[entrypoint] S3 download failed — starting without checkpoint (mock mode)"
    fi
else
    echo "[entrypoint] Model checkpoint found at $MODEL_PATH"
fi

# ── Download climate dataset from S3 if not present ───────────────────────────
DATA_FILE="$DATA_DIR/normalized_2010-2025.nc"
if [ ! -f "$DATA_FILE" ]; then
    echo "[entrypoint] Dataset not found — downloading from S3..."
    if aws s3 cp "$DATA_S3" "$DATA_FILE" 2>/dev/null; then
        echo "[entrypoint] Dataset downloaded: $(du -sh "$DATA_FILE" | cut -f1)"
    else
        echo "[entrypoint] Dataset download failed — model inference will use mock data"
    fi
else
    echo "[entrypoint] Dataset found at $DATA_FILE"
fi

# ── Construct DATABASE_URL from individual env vars if not already set ────────
if [ -z "$DATABASE_URL" ] && [ -n "$DB_HOST" ]; then
    export DATABASE_URL="postgresql://${DB_USERNAME}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT:-5432}/${DB_NAME:-vayu_climate}"
    echo "[entrypoint] DATABASE_URL constructed from DB_* env vars"
fi

exec "$@"
