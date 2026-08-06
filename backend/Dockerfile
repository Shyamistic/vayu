# ── Stage 1: builder ──────────────────────────────────────────────────────────
FROM python:3.11-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ libgdal-dev libpq-dev git \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml .

# NumPy must be pinned below 2.0 and installed BEFORE torch.
#
# torch 2.2.2 ships extension modules compiled against the NumPy 1.x C ABI. With
# NumPy 2.x present, `import torch` still succeeds but its array bridge silently
# fails to initialise ("Failed to initialize NumPy: _ARRAY_API not found"), and
# every `tensor.numpy()` then raises "Numpy is not available". That is the exact
# call every prediction path makes (main.py `_get_real_predictions` does
# `.cpu().numpy()`), so an unpinned build produces a container that passes
# /health and fails every actual forecast.
RUN pip install --no-cache-dir "numpy<2"

# Install PyTorch separately with retries (avoids timeout on large downloads)
RUN pip install --no-cache-dir --timeout=300 --retries=3 \
    --extra-index-url https://download.pytorch.org/whl/cpu \
    torch==2.2.2+cpu

# Install torch-geometric
RUN pip install --no-cache-dir torch-geometric

# Install other dependencies in smaller chunks
RUN pip install --no-cache-dir \
    fastapi uvicorn[standard] pydantic python-dotenv \
    sqlalchemy geoalchemy2 asyncpg psycopg2-binary alembic \
    redis hiredis

# numpy is re-pinned here because several of these declare `numpy` as a
# dependency and pip would otherwise resolve it back up to 2.x, undoing the pin
# above and re-breaking torch's array bridge.
RUN pip install --no-cache-dir \
    xarray netCDF4 scipy "numpy<2" pandas \
    httpx tenacity tqdm imdlib

RUN pip install --no-cache-dir \
    shapely pyproj rasterio \
    structlog boto3 Pillow matplotlib "numpy<2"

# Fail the build rather than ship a container whose tensor->numpy bridge is dead.
# This has to run in the builder stage, where the packages are installed.
RUN python -c "import numpy, torch; \
    assert numpy.__version__.startswith('1.'), f'numpy must be <2, got {numpy.__version__}'; \
    torch.zeros(3).numpy(); \
    print(f'verified numpy {numpy.__version__} with torch {torch.__version__}')"

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM python:3.11-slim AS runtime

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgdal-dev libpq5 curl awscli \
    && rm -rf /var/lib/apt/lists/*

# Copy installed packages from builder
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Copy source
COPY ai_engine/     ai_engine/
COPY backend/       backend/
COPY scenario_engine/ scenario_engine/
COPY data_ingestion/ data_ingestion/

# Download model checkpoint from S3 on startup (if not already present)
COPY backend/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

RUN useradd --create-home --no-log-init appuser && \
    mkdir -p /app/data/processed_western_ghats /app/checkpoints && \
    chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

ENTRYPOINT ["/entrypoint.sh"]
# Single worker on purpose. Each uvicorn worker is a separate process that loads
# its own copy of the torch model, the per-region checkpoints and the graph
# builder, so two workers double the resident set without adding throughput on a
# 1 vCPU task. At 2 GB with two workers the kernel OOM-killed the worker on the
# first real /api/predict call while /health kept returning 200, which reads as
# an intermittent 502 rather than as an out-of-memory condition.
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", \
     "--workers", "1", "--log-level", "info"]
