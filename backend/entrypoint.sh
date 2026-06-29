#!/bin/bash
# backend/entrypoint.sh — Download model from S3 + construct DATABASE_URL before starting

set -e

MODEL_PATH="${MODEL_PATH:-/app/checkpoints/vayu_best.pt}"
MODEL_S3="${MODEL_S3_URI:-s3://vayu-climate-models/checkpoints/vayu_best.pt}"

mkdir -p "$(dirname "$MODEL_PATH")"

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

# ── Construct DATABASE_URL from individual env vars if not already set ────────
if [ -z "$DATABASE_URL" ] && [ -n "$DB_HOST" ]; then
    export DATABASE_URL="postgresql://${DB_USERNAME}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT:-5432}/${DB_NAME:-vayu_climate}"
    echo "[entrypoint] DATABASE_URL constructed from DB_* env vars"
fi

exec "$@"
