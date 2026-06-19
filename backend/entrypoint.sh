#!/bin/bash
# backend/entrypoint.sh — Download model checkpoint from S3 before starting server

set -e

MODEL_PATH="${MODEL_PATH:-/app/checkpoints/vayu_best.pt}"
MODEL_S3="${MODEL_S3_URI:-s3://vayu-climate-models/checkpoints/vayu_best.pt}"

mkdir -p "$(dirname "$MODEL_PATH")"

if [ ! -f "$MODEL_PATH" ]; then
    echo "[entrypoint] Model not found at $MODEL_PATH — attempting S3 download..."
    if aws s3 cp "$MODEL_S3" "$MODEL_PATH" 2>/dev/null; then
        echo "[entrypoint] Model downloaded from S3: $(du -sh "$MODEL_PATH" | cut -f1)"
    else
        echo "[entrypoint] S3 download failed or no MODEL_S3_URI set — starting without checkpoint (mock mode)"
    fi
else
    echo "[entrypoint] Model checkpoint found at $MODEL_PATH"
fi

exec "$@"
