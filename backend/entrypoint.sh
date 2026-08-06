#!/bin/bash
# backend/entrypoint.sh — Download model + datasets from S3, construct DATABASE_URL, start app
#
# Everything is driven by environment variables so the same image runs against any
# account. Nothing here is account-specific: an unset bucket is reported loudly
# rather than silently degrading the API to synthetic output.
#
#   MODEL_PATH        local checkpoint path                (default /app/checkpoints/vayu_best.pt)
#   MODEL_S3_URI      s3:// URI of the checkpoint          (required for real predictions)
#   CLIMATE_DATA_ROOT local dataset root                   (default /app/data)
#   DATA_S3_PREFIX    s3:// prefix holding processed_<region>/ dirs
#   DATA_REGIONS      space-separated region dir names to pull
#                     (default "processed_western_ghats")

set -e

MODEL_PATH="${MODEL_PATH:-/app/checkpoints/vayu_best.pt}"
MODEL_S3="${MODEL_S3_URI:-}"
DATA_ROOT="${CLIMATE_DATA_ROOT:-/app/data}"
DATA_S3_PREFIX="${DATA_S3_PREFIX:-}"
DATA_REGIONS="${DATA_REGIONS:-processed_western_ghats}"

mkdir -p "$(dirname "$MODEL_PATH")"
mkdir -p "$DATA_ROOT"

# ── Download model from S3 if not present locally ─────────────────────────────
if [ -f "$MODEL_PATH" ]; then
    echo "[entrypoint] Model checkpoint found at $MODEL_PATH"
elif [ -z "$MODEL_S3" ]; then
    echo "[entrypoint] WARNING: MODEL_S3_URI unset and no local checkpoint — starting in mock mode"
else
    echo "[entrypoint] Downloading model from $MODEL_S3 ..."
    if aws s3 cp "$MODEL_S3" "$MODEL_PATH"; then
        echo "[entrypoint] Model downloaded: $(du -sh "$MODEL_PATH" | cut -f1)"
    else
        echo "[entrypoint] WARNING: model download FAILED — starting in mock mode"
    fi
fi

# ── Download processed climate bundles ────────────────────────────────────────
# Only normalized_*.nc is needed for inference; the graph/static files are
# rebuilt in-process, so we avoid pulling the whole multi-hundred-MB bundle.
if [ -z "$DATA_S3_PREFIX" ]; then
    echo "[entrypoint] WARNING: DATA_S3_PREFIX unset — /api/predict will return synthetic grids"
else
    for region_dir in $DATA_REGIONS; do
        target="$DATA_ROOT/$region_dir"
        mkdir -p "$target"
        if ls "$target"/normalized_*.nc >/dev/null 2>&1; then
            echo "[entrypoint] $region_dir already present, skipping download"
            continue
        fi
        echo "[entrypoint] Syncing $region_dir from ${DATA_S3_PREFIX%/}/$region_dir/ ..."
        if aws s3 sync "${DATA_S3_PREFIX%/}/$region_dir/" "$target/" \
             --exclude "*" --include "normalized_*.nc"; then
            if ls "$target"/normalized_*.nc >/dev/null 2>&1; then
                echo "[entrypoint] $region_dir ready: $(du -sh "$target" | cut -f1)"
            else
                echo "[entrypoint] WARNING: no normalized_*.nc under ${DATA_S3_PREFIX%/}/$region_dir/"
            fi
        else
            echo "[entrypoint] WARNING: sync FAILED for $region_dir"
        fi
    done
fi

# ── Construct DATABASE_URL from individual env vars if not already set ────────
if [ -z "$DATABASE_URL" ] && [ -n "$DB_HOST" ]; then
    export DATABASE_URL="postgresql://${DB_USERNAME}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT:-5432}/${DB_NAME:-vayu_climate}"
    echo "[entrypoint] DATABASE_URL constructed from DB_* env vars"
elif [ -z "$DATABASE_URL" ]; then
    echo "[entrypoint] No DB_HOST set — historical/IoT persistence disabled (endpoints serve computed data)"
fi

exec "$@"
