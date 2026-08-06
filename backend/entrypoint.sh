#!/bin/bash
# backend/entrypoint.sh — Download model + datasets from S3, construct DATABASE_URL, start app
#
# Everything is driven by environment variables so the same image runs against any
# account. Nothing here is account-specific: an unset bucket is reported loudly
# rather than silently degrading the API to synthetic output.
#
#   MODEL_PATH        local checkpoint path                (default /app/checkpoints/vayu_best.pt)
#   MODEL_S3_URI      s3:// URI of the checkpoint          (required for real predictions)
#   REGION_MODELS_S3_PREFIX
#                     s3:// prefix holding regions/<region>/vayu_best.pt
#   REGION_MODELS     space-separated region ids whose checkpoints to pull
#   STATIC_RASTER_ROOT local static raster root            (default /app/static)
#   STATIC_S3_PREFIX  s3:// prefix holding static_<region>/ dirs
#   STATIC_REGIONS    space-separated static dir names to pull
#   CLIMATE_DATA_ROOT local dataset root                   (default /app/data)
#   DATA_S3_PREFIX    s3:// prefix holding processed_<region>/ dirs
#   DATA_REGIONS      space-separated region dir names to pull
#                     (default "processed_western_ghats")

set -e

MODEL_PATH="${MODEL_PATH:-/app/checkpoints/vayu_best.pt}"
MODEL_S3="${MODEL_S3_URI:-}"
REGION_MODELS_S3_PREFIX="${REGION_MODELS_S3_PREFIX:-}"
REGION_MODELS="${REGION_MODELS:-}"
STATIC_ROOT="${STATIC_RASTER_ROOT:-/app/static}"
STATIC_S3_PREFIX="${STATIC_S3_PREFIX:-}"
STATIC_REGIONS="${STATIC_REGIONS:-}"
DATA_ROOT="${CLIMATE_DATA_ROOT:-/app/data}"
DATA_S3_PREFIX="${DATA_S3_PREFIX:-}"
DATA_REGIONS="${DATA_REGIONS:-processed_western_ghats}"

mkdir -p "$(dirname "$MODEL_PATH")"
mkdir -p "$DATA_ROOT"
mkdir -p "$STATIC_ROOT"

# ── Download model from S3 if not present locally ─────────────────────────────
if [ -f "$MODEL_PATH" ]; then
    echo "[entrypoint] Model checkpoint found at $MODEL_PATH"
elif [ -z "$MODEL_S3" ]; then
    echo "[entrypoint] WARNING: MODEL_S3_URI unset and no local checkpoint — starting in mock mode"
else
    echo "[entrypoint] Downloading model from $MODEL_S3 ..."
    if aws s3 cp "$MODEL_S3" "$MODEL_PATH" --only-show-errors; then
        echo "[entrypoint] Model downloaded: $(du -sh "$MODEL_PATH" | cut -f1)"
    else
        echo "[entrypoint] WARNING: model download FAILED — starting in mock mode"
    fi
fi

# ── Download per-region checkpoints ───────────────────────────────────────────
# Each region was trained separately (notebooks/vayu_kaggle_training_*.ipynb) and
# main.py looks for checkpoints/regions/<region>/vayu_best.pt. Without these, every
# region silently falls back to the single global checkpoint above — i.e. Western
# Ghats weights answering a Central India request, labelled as Central India.
# The fallback is deliberate (better than no forecast) but it must not be the
# default in a deployment that claims per-region models.
if [ -z "$REGION_MODELS_S3_PREFIX" ] || [ -z "$REGION_MODELS" ]; then
    echo "[entrypoint] NOTE: REGION_MODELS_S3_PREFIX/REGION_MODELS unset — all regions will share $MODEL_PATH"
else
    for region in $REGION_MODELS; do
        region_ckpt="/app/checkpoints/regions/$region/vayu_best.pt"
        if [ -f "$region_ckpt" ]; then
            echo "[entrypoint] Region model $region already present"
            continue
        fi
        mkdir -p "$(dirname "$region_ckpt")"
        src="${REGION_MODELS_S3_PREFIX%/}/$region/vayu_best.pt"
        echo "[entrypoint] Downloading region model $region from $src ..."
        if aws s3 cp "$src" "$region_ckpt" --only-show-errors; then
            echo "[entrypoint] Region model $region ready: $(du -sh "$region_ckpt" | cut -f1)"
        else
            echo "[entrypoint] WARNING: region model download FAILED for $region — it will fall back to the global checkpoint"
            rm -f "$region_ckpt"
        fi
    done
fi

# ── Download processed climate bundles ────────────────────────────────────────
# normalized_*.nc carries the z-scored fields; norm_params_*.nc carries the
# per-grid-cell mean/std needed to turn them back into mm/day and degC.
#
# norm_params is NOT optional. Without it main.py:_resolve_norm_params falls back
# to flat Western Ghats-derived scalars (rain_mean=8, tmax_mean=32) for every
# region, which yields plausible-looking but wrong physical values everywhere
# else — and /api/sensitivity + /api/what-if would report slopes in z-score
# units instead of mm/day per degC. Both files are small relative to the
# normalized cube, so pulling them together costs almost nothing.
if [ -z "$DATA_S3_PREFIX" ]; then
    echo "[entrypoint] WARNING: DATA_S3_PREFIX unset — /api/predict will return synthetic grids"
else
    for region_dir in $DATA_REGIONS; do
        target="$DATA_ROOT/$region_dir"
        mkdir -p "$target"
        if ls "$target"/normalized_*.nc >/dev/null 2>&1 && ls "$target"/norm_params_*.nc >/dev/null 2>&1; then
            echo "[entrypoint] $region_dir already present, skipping download"
            continue
        fi
        echo "[entrypoint] Syncing $region_dir from ${DATA_S3_PREFIX%/}/$region_dir/ ..."
        if aws s3 sync "${DATA_S3_PREFIX%/}/$region_dir/" "$target/" \
             --exclude "*" --include "normalized_*.nc" --include "norm_params_*.nc" --only-show-errors; then
            if ls "$target"/normalized_*.nc >/dev/null 2>&1; then
                echo "[entrypoint] $region_dir ready: $(du -sh "$target" | cut -f1)"
                if ! ls "$target"/norm_params_*.nc >/dev/null 2>&1; then
                    echo "[entrypoint] WARNING: $region_dir has no norm_params_*.nc — physical units for this region will be WRONG (flat fallback constants) and sensitivity slopes will not be in mm/day"
                fi
            else
                echo "[entrypoint] WARNING: no normalized_*.nc under ${DATA_S3_PREFIX%/}/$region_dir/"
            fi
        else
            echo "[entrypoint] WARNING: sync FAILED for $region_dir"
        fi
    done
fi

# ── Download static rasters (elevation + land-sea mask) ──────────────────────
# Elevation and the land-sea mask are model INPUT features. Without them
# ClimateGraphBuilder falls back to a synthetic Western Ghats ridge and a
# hand-drawn coastline, so inference runs on different inputs than training did.
# The output still looks plausible, which is exactly why this is worth failing
# loudly about. They are only a few hundred KB per region.
if [ -z "$STATIC_S3_PREFIX" ] || [ -z "$STATIC_REGIONS" ]; then
    echo "[entrypoint] WARNING: STATIC_S3_PREFIX/STATIC_REGIONS unset - inference will use SYNTHETIC elevation and land-sea mask"
else
    for static_dir in $STATIC_REGIONS; do
        target="$STATIC_ROOT/$static_dir"
        mkdir -p "$target"
        if [ -f "$target/elevation.nc" ] && [ -f "$target/lsm.nc" ]; then
            echo "[entrypoint] $static_dir already present, skipping download"
            continue
        fi
        echo "[entrypoint] Syncing $static_dir from ${STATIC_S3_PREFIX%/}/$static_dir/ ..."
        if aws s3 sync "${STATIC_S3_PREFIX%/}/$static_dir/" "$target/" \
             --exclude "*" --include "elevation.nc" --include "lsm.nc" --only-show-errors; then
            if [ -f "$target/elevation.nc" ] && [ -f "$target/lsm.nc" ]; then
                echo "[entrypoint] $static_dir ready"
            else
                echo "[entrypoint] WARNING: $static_dir incomplete - SYNTHETIC terrain will be used for this region"
            fi
        else
            echo "[entrypoint] WARNING: static sync FAILED for $static_dir"
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
