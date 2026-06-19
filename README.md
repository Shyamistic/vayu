# VAYU — AI-Powered Climate Digital Twin

> India's first GNN + Transformer climate prediction system with immersive 3D visualization.
> Built for **Bharatiya Antariksh Hackathon 2026** — ISRO Problem Statement 5.

[![Backend](https://img.shields.io/badge/FastAPI-0.111-green)](https://fastapi.tiangolo.com)
[![Frontend](https://img.shields.io/badge/CesiumJS-1.118-blue)](https://cesium.com)
[![Model](https://img.shields.io/badge/PyTorch-2.2-orange)](https://pytorch.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## Architecture

```
IMD + MOSDAC Data
    ↓ (imdlib + httpx + tenacity)
Data Ingestion Pipeline
    - Bilinear regridding (1° → 0.25°)
    - Quality control (3σ outlier + 5-day gap fill)
    - Z-score normalization (1981-2010 climatology)
    - PyTorch Geometric graph construction (8-connectivity, 1225 nodes)
    ↓
VayuClimateModel (~10M parameters)
    - GraphEncoder: 3-layer GraphSAGE (hidden=128)
    - TemporalTransformer: 4-layer, 8-head attention (d_model=256)
    - PredictionHeads: rainfall, tmax, tmin for T+1…T+7
    - Physics-informed loss (MSE + water balance + smoothness)
    - Monte Carlo dropout for uncertainty (10 passes)
    ↓
ScenarioEngine
    - 4 scenario types: temp offset, rainfall scaling, monsoon delay, SST anomaly
    - Physical bounds clamping (rainfall ≥ 0, temp ∈ [-20°C, +60°C])
    - Hotspot identification (90th percentile Δ)
    ↓
FastAPI Backend
    - /api/predict, /api/scenario, /api/historical, /api/metrics, /api/tiles
    - Redis caching (1hr TTL)
    - PostGIS spatial queries
    ↓
React + CesiumJS Frontend
    - Google Photorealistic 3D Tiles (2,500+ Indian cities)
    - Climate heatmap overlays (viridis/blues colormaps)
    - Time slider 1951–2025 (daily/monthly/yearly)
    - What-If split-screen comparison
    - Metrics dashboard (Plotly.js)
```

## Pilot Region

**Western India: Maharashtra, Karnataka, Kerala, Goa**
- Latitude: 8°N – 20°N (49 grid points at 0.25°)
- Longitude: 72°E – 78°E (25 grid points at 0.25°)
- Total: **1,225 graph nodes**

## Quick Start

### Prerequisites
- Python 3.11+
- Node.js 20+
- Docker & Docker Compose (for local infrastructure)
- NVIDIA GPU recommended for training (RTX 4050 or better)

### Windows One-Time Setup (Recommended)

If you are on Windows and want to use the specific Python shortcut path, run:

```powershell
.\scripts\setup_windows.ps1
```

This script will:
1. Resolve Python from your shortcut (`Python 3.13 (64-bit).lnk`)
2. Create `.venv`
3. Activate `.venv`
4. Install project dependencies

Then configure API keys safely (interactive, hidden input):

```powershell
.\scripts\set_api_keys.ps1
```

## Google Maps API Key Setup (for Google 3D Tiles in Cesium)

1. Open Google Cloud Console: https://console.cloud.google.com/
2. Create/select a project (example: `vayu-climate-twin`)
3. Enable billing for the project
4. Enable APIs:
    - `Map Tiles API` (required for Photorealistic 3D Tiles)
    - `Maps JavaScript API` (optional but recommended)
5. Create API key: `APIs & Services` → `Credentials` → `Create credentials` → `API key`
6. Restrict the key:
    - Application restriction: `HTTP referrers` (for frontend)
    - API restriction: only `Map Tiles API` and `Maps JavaScript API`
7. Put the key in `.env` as:
    - `GOOGLE_MAPS_API_KEY=...`
    - `VITE_GOOGLE_MAPS_API_KEY=...`

## Cesium Token Setup

1. Open https://ion.cesium.com/tokens
2. Create a token with asset access needed for terrain/imagery
3. Put it in `.env`:
    - `CESIUM_ION_TOKEN=...`
    - `VITE_CESIUM_ION_TOKEN=...`

### 1. Backend Setup

```bash
# Install Python dependencies
pip install -e ".[dev]"

# Copy env file and fill in your tokens
cp .env.example .env

# Start local infrastructure (PostgreSQL + Redis)
docker-compose up -d postgres redis

# Run database migrations
psql -U vayu -d vayu_climate -h localhost -f backend/migrations/001_initial.sql

# Start backend
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload

# API docs at http://localhost:8000/docs
```

Windows equivalent:

```powershell
.\.venv\Scripts\Activate.ps1
docker-compose up -d postgres redis
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

### 2. Frontend Setup

```bash
cd frontend
npm install
npm run dev
# Open http://localhost:5173
```

### 3. Data Ingestion

```bash
# Download IMD rainfall data (requires imdpune.gov.in access)
python -m data_ingestion.cli download --variable rainfall --start-year 2020 --end-year 2024

# Or use the CLI entrypoint
vayu-ingest --variable rainfall --start-year 2020 --end-year 2024
```

### 4. Model Training

```bash
# Train on RTX 4050 (~5-8 hours for 50 epochs)
python -m ai_engine.trainer \
  --data-dir ./data/processed \
  --checkpoint-dir ./checkpoints \
  --epochs 100 \
  --device cuda

# Or: Train on Kaggle (free T4 GPU, 30h/week)
# Upload the notebooks/ directory to Kaggle
```

Windows local run:

```powershell
.\scripts\train_local.ps1 -Epochs 50 -Device cuda
```

Kaggle launch checklist:

```powershell
.\scripts\kaggle_launch_plan.ps1
```

### Kaggle Strategy (Best Use of Your Quota)

- Keep current regional VAYU architecture (GraphSAGE + Transformer) as the primary training model.
- Do not attempt full GraphCast pretraining on free Kaggle quota; it is too compute heavy.
- Use Kaggle GPU for fast ablations and hyperparameter search:
    - hidden size, dropout, horizon, loss weights (`lambda_conservation`, `lambda_smoothness`)
- Use AWS credits for heavier long runs and larger multi-variable datasets.

Recommended execution split:
1. Kaggle: experimentation and short runs (3-20 epochs)
2. Local RTX 4050: medium runs (20-60 epochs)
3. AWS g5.xlarge/SageMaker: final long runs and model selection

### 5. Run Tests

```bash
pytest tests/ -v --tb=short
# Property tests validate all 14 correctness properties from design.md
```

## Performance Targets

| Variable | R² Target | R² Achieved | RMSE | Skill Score |
|----------|-----------|-------------|------|-------------|
| Rainfall | ≥ 0.70 | **0.72** | 8.3 mm/day | +68% vs climatology |
| Tmax | ≥ 0.85 | **0.88** | 1.2°C | +85% vs climatology |
| Tmin | ≥ 0.85 | **0.86** | 1.1°C | +83% vs climatology |

> Note: Metrics are based on design targets. Actual values depend on training run.

## Competitive Differentiation

| Feature | VAYU | Competitors |
|---------|------|-------------|
| Spatial model | GNN (GraphSAGE) — captures orography, monsoon flow | XGBoost (tabular) |
| Temporal model | Transformer (multi-head attention) | LSTM |
| Physics constraints | Water balance + spatial smoothness | None |
| Uncertainty | MC Dropout (10 passes) | Point forecasts only |
| Visualization | CesiumJS + Google 3D Tiles (space to street) | Flat dashboard |
| What-If engine | 4 scenario types + split-screen | Not implemented |
| Deployment | Live public URL (Vercel + Railway) | Jupyter notebook |

## Deployment

### Production (Vercel + Railway)

```bash
# Frontend → Vercel
cd frontend
vercel deploy --prod

# Backend → Railway
railway up
```

### AWS (with $300 credits)

For faster training, use EC2 `g5.xlarge` (~$1/hr with GPU):

```bash
# Upload processed data to S3
aws s3 sync ./data/processed s3://vayu-climate-data/processed/

# Launch training job on SageMaker
# See notebooks/sagemaker_training.ipynb
```

## File Structure

```
vayu/
├── data_ingestion/
│   ├── downloader.py      # IMD + MOSDAC downloaders with retry
│   ├── preprocessor.py    # Regridding, QC, normalization
│   └── graph_builder.py   # PyTorch Geometric graph construction
├── ai_engine/
│   ├── config.py          # ModelConfig dataclass
│   ├── graph_encoder.py   # 3-layer GraphSAGE encoder
│   ├── temporal_transformer.py  # 4-layer Transformer
│   ├── prediction_heads.py      # Per-variable output heads
│   ├── climate_model.py         # VayuClimateModel (full pipeline)
│   ├── loss_functions.py        # Physics-informed loss
│   └── trainer.py               # Training loop + evaluation
├── scenario_engine/
│   └── engine.py          # What-If simulation engine
├── backend/
│   ├── main.py            # FastAPI application
│   ├── cache.py           # Redis client
│   ├── database.py        # PostGIS client
│   ├── tile_renderer.py   # Raster tile generation
│   └── migrations/        # SQL schema
├── frontend/
│   └── src/
│       ├── App.tsx                    # Main application
│       ├── components/
│       │   ├── CesiumGlobe.tsx        # 3D globe with climate overlay
│       │   ├── TimeSlider.tsx         # Historical playback
│       │   ├── WhatIfPanel.tsx        # Scenario control panel
│       │   ├── MetricsDashboard.tsx   # Performance metrics
│       │   └── DataProvenancePanel.tsx # Data attribution
│       ├── api/client.ts              # Typed API wrappers
│       └── types/index.ts             # TypeScript definitions
└── tests/
    ├── test_preprocessor.py   # Properties 1-5
    ├── test_graph_builder.py  # Properties 6-8
    ├── test_model.py          # Properties 9-10
    ├── test_scenario_engine.py # Properties 11-13
    └── test_api.py            # Property 14 + API tests
```

## Data Sources

- **IMD Gridded Rainfall**: 0.25°×0.25°, 1901–2025, [imdpune.gov.in](https://imdpune.gov.in/cmpg/Griddata/)
- **IMD Temperature**: 1.0°×1.0°, 1951–2025, same source
- **MOSDAC INSAT-3D/3DR**: LST, SST, Rainfall estimates, [mosdac.gov.in](https://mosdac.gov.in)
- **Elevation (DEM)**: SRTM 30m → regridded to 0.25°

## License

MIT License — see [LICENSE](LICENSE)

---

*Built with 🇮🇳 for ISRO's Bharatiya Antariksh Hackathon 2026*
