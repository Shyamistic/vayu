# ── Stage 1: builder ──────────────────────────────────────────────────────────
FROM python:3.11-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ libgdal-dev libpq-dev git \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml .
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

RUN pip install --no-cache-dir \
    xarray netCDF4 scipy numpy pandas \
    httpx tenacity tqdm imdlib

RUN pip install --no-cache-dir \
    shapely pyproj rasterio \
    structlog boto3 Pillow matplotlib

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
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", \
     "--workers", "2", "--log-level", "info"]
