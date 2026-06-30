<h1 align="center">
  <img src="https://img.shields.io/badge/🌏-MAUSAM-0ea5e9?style=for-the-badge" alt="MAUSAM"/>
  <br/>
  <strong>MAUSAM — AI-Powered Climate Digital Twin</strong>
</h1>

<p align="center">
  <em>Multi-scale Atmospheric Understanding through Spatio-temporal AI Modeling</em><br/>
  India's first GNN + Transformer climate prediction system with immersive 3D visualization
</p>

<p align="center">
  <a href="http://vayu-frontend-275688773412.s3-website.ap-south-1.amazonaws.com">🌐 Live Dashboard</a> •
  <a href="http://VayuBa-Servi-BQWXLMKK2Pfg-1942012735.ap-south-1.elb.amazonaws.com/docs">📚 API Docs</a> •
  <a href="https://www.kaggle.com/code/shyam31415/vayuv2test">🔬 Training Notebook</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Problem_Statement-PS5-orange?style=flat-square"/>
  <img src="https://img.shields.io/badge/PyTorch-2.2-ee4c2c?style=flat-square&logo=pytorch"/>
  <img src="https://img.shields.io/badge/CesiumJS-1.118-0ea5e9?style=flat-square"/>
  <img src="https://img.shields.io/badge/FastAPI-0.111-009688?style=flat-square&logo=fastapi"/>
  <img src="https://img.shields.io/badge/AWS-ECS+CloudFront-FF9900?style=flat-square&logo=amazonaws"/>
  <img src="https://img.shields.io/badge/R²_Tmax-0.817-brightgreen?style=flat-square"/>
</p>

---

## 🎯 Problem Statement

**PS-5: AI-Powered Digital Twin of India's Climate using India's National Data**

> Design and develop a scalable framework for an AI-driven digital twin of India's climate using national datasets (satellite, ground observations, and reanalysis). Demonstrate a Proof of Concept with high-resolution analysis, short-term predictions, interactive geospatial visualization, and "What-If" scenario simulation.

**Mentors:** Dr. K.V. Subrahmanyam (Sci/Eng-SF, NRSC/ISRO) • Mr. Syed Shadab (Sci/Eng-SF, NRSC/ISRO) • Mr. C. Sarat (Sci/Eng-SC, NRSC/ISRO)

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        DATA INGESTION LAYER                             │
├─────────────────────────────────────────────────────────────────────────┤
│  IMD Gridded Rainfall (0.25°)  │  IMD Temperature (1.0° → 0.25°)      │
│  MOSDAC INSAT-3D (LST, SST)   │  NCEP 850hPa Wind (uwnd, vwnd, shum) │
│  CHIRPS Satellite Precip       │  GEBCO Elevation (30m → 0.25°)       │
└──────────────────────────────┬──────────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     PREPROCESSING PIPELINE                              │
├─────────────────────────────────────────────────────────────────────────┤
│  • Bilinear regridding (1.0° → 0.25° for temperature)                  │
│  • Quality control: 3σ outlier removal + 5-day gap interpolation        │
│  • Z-score normalization (1981-2010 WMO climatology baseline)           │
│  • Cyclical temporal encoding (day-of-year sin/cos)                     │
│  • Monsoon phase indicators (JJAS flag + onset progress)                │
│  • PyTorch Geometric graph construction (8-connectivity, 1311 nodes)    │
└──────────────────────────────┬──────────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    VayuClimateModel (2.35M parameters)                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ┌──────────────────┐   ┌────────────────────┐   ┌────────────────┐   │
│   │  Graph Encoder   │   │ Temporal Transformer│   │ Prediction     │   │
│   │  3-layer         │──▶│ 4-layer, 8-head    │──▶│ Heads          │   │
│   │  GraphSAGE       │   │ d_model=256        │   │ rainfall, tmax │   │
│   │  hidden=128      │   │ 30-day window      │   │ tmin (T+1→T+7) │   │
│   └──────────────────┘   └────────────────────┘   └────────────────┘   │
│                                                                         │
│   Physics-Informed Loss: MSE + Water Balance + Spatial Smoothness       │
│   Uncertainty: Monte Carlo Dropout (10 forward passes)                  │
│   Training: 27 epochs on Kaggle T4 GPU (AMP fp16)                       │
└──────────────────────────────┬──────────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      SCENARIO ENGINE                                    │
├─────────────────────────────────────────────────────────────────────────┤
│  4 What-If Scenarios:                                                   │
│  1. Temperature Offset (+1°C to +4°C uniform warming)                   │
│  2. Rainfall Scaling (±20% monsoon intensification/weakening)           │
│  3. Monsoon Delay (onset shifted by 7-21 days)                          │
│  4. SST Anomaly (El Niño-like Arabian Sea warming)                      │
│  Output: Per-cell delta, hotspot identification (90th percentile)       │
└──────────────────────────────┬──────────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    PRODUCTION BACKEND (AWS)                              │
├─────────────────────────────────────────────────────────────────────────┤
│  FastAPI on ECS Fargate │ RDS PostgreSQL │ Redis Cache │ ALB + Auto-scale│
│  Endpoints: /api/predict, /api/scenario, /api/metrics, /health          │
│  Real-time inference: <3s per 1311-node 7-day forecast                  │
└──────────────────────────────┬──────────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│               VISUALIZATION DASHBOARD (CesiumJS 3D)                     │
├─────────────────────────────────────────────────────────────────────────┤
│  • 3D Globe with NASA satellite imagery (GIBS MODIS/IMERG)              │
│  • Real-time climate heatmap overlays (IMD operational colormaps)        │
│  • Timeline playback 2010-2025 (daily granularity)                      │
│  • What-If split-screen comparison                                      │
│  • Monsoon tracker, flood risk, drought SPI, agriculture panels         │
│  • IoT sensor network integration (ground truth validation)             │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 📊 Model Performance

### Validated Results (Epoch 27, Western Ghats Pilot Region)

| Variable | R² Score | RMSE | Skill vs Persistence | Skill vs Climatology |
|----------|----------|------|---------------------|---------------------|
| **Temperature Max** | **0.817** | 1.4°C | +81.0% | +36.5% |
| **Temperature Min** | **~0.79** | 1.3°C | +78.0% | +23.5% |
| **Rainfall** | **0.200** | 8.3 mm/day | +19.4% | +15.2% |

### Training Progression (Best Checkpoint: `vayu_best.pt`)
- **Architecture**: GraphSAGE(3L, h=128) + Transformer(4L, 8-head, d=256)
- **Input features**: 11 (rainfall, tmax, tmin, day_sin, day_cos, jjas_flag, monsoon_progress, elevation, land_sea, lat_enc, lon_enc)
- **Training data**: IMD 2010-2020 (Western Ghats, 0.25° resolution)
- **Validation data**: IMD 2021-2023
- **Best val_loss**: 0.193 at epoch 27 (early-stopped at 37)
- **Seasonal discrimination**: Monsoon (Jul) = 41.87 mm/day vs Winter (Jan) = 4.45 mm/day ✓

---

## 🛰️ Data Sources

| Dataset | Resolution | Period | Source |
|---------|-----------|--------|--------|
| IMD Gridded Rainfall | 0.25° × 0.25° | 1901-2025 | [imdpune.gov.in](https://imdpune.gov.in/cmpg/Griddata/Rainfall_25_Bin.html) |
| IMD Max Temperature | 1.0° × 1.0° | 1951-2025 | [imdpune.gov.in](https://imdpune.gov.in/cmpg/Griddata/Max_1_Bin.html) |
| IMD Min Temperature | 1.0° × 1.0° | 1951-2025 | [imdpune.gov.in](https://imdpune.gov.in/cmpg/Griddata/Min_1_Bin.html) |
| MOSDAC INSAT-3D LST | 4km | 2014-2025 | [mosdac.gov.in](https://mosdac.gov.in) |
| MOSDAC INSAT-3D SST | 4km | 2014-2025 | [mosdac.gov.in](https://mosdac.gov.in) |
| NCEP/NCAR 850hPa Wind | 2.5° → 0.25° | 2010-2025 | [psl.noaa.gov](https://psl.noaa.gov/data/gridded/data.ncep.reanalysis.html) |
| CHIRPS Rainfall | 0.05° | 2010-2025 | [chc.ucsb.edu](https://www.chc.ucsb.edu/data/chirps) |
| GEBCO Bathymetry/DEM | 15 arc-sec | 2024 | [gebco.net](https://www.gebco.net) |

---

## 🌍 Pilot Region

**Western Ghats (Maharashtra, Karnataka, Kerala, Goa)**
- Latitude: 8°N – 20°N (49 grid points at 0.25°)
- Longitude: 72°E – 78°E (25 grid points at 0.25°)
- Total: **1,225+ graph nodes** with 8-connectivity edges
- Rationale: Orographic rainfall enhancement, monsoon variability, flood/drought extremes

---

## 🔗 Live Deployment

| Component | URL | Status |
|-----------|-----|--------|
| **3D Dashboard** | [vayu-frontend S3](http://vayu-frontend-275688773412.s3-website.ap-south-1.amazonaws.com) | ✅ Live |
| **API Health** | [/health](http://VayuBa-Servi-BQWXLMKK2Pfg-1942012735.ap-south-1.elb.amazonaws.com/health) | ✅ Healthy |
| **API Docs (Swagger)** | [/docs](http://VayuBa-Servi-BQWXLMKK2Pfg-1942012735.ap-south-1.elb.amazonaws.com/docs) | ✅ Live |
| **Kaggle Training** | [vayuv2test](https://www.kaggle.com/code/shyam31415/vayuv2test) | ✅ Complete |
| **Kaggle Dataset** | [vayu-western-ghats-processed-v1](https://www.kaggle.com/datasets/shyam31415/vayu-western-ghats-processed-v1) | ✅ Public |

---

## 🧪 Reproducibility

### Training (Kaggle — free T4 GPU)
```bash
# Clone repo on Kaggle, attach dataset, run notebook
# Training completes in ~2.5 hours (27 epochs × ~3.6 min/epoch)
# Output: vayu_best.pt (9.1 MB checkpoint)
```

### Local Development
```bash
# Backend
pip install -e ".[dev]"
docker-compose up -d postgres redis
uvicorn backend.main:app --reload

# Frontend
cd frontend && npm install && npm run dev
```

### AWS Deployment
```powershell
# One-command deploy (requires AWS CLI + CDK)
cdk deploy --all --app "python infra/app.py" -c account="YOUR_ACCOUNT" -c region="ap-south-1"
```

---

## 🏗️ IoT Ground Truth Validation (Phase 2)

**Distributed Low-Cost Climate Sensor Network**

| Component | Specification | Purpose |
|-----------|--------------|---------|
| MCU | ESP32-S3 (WiFi + BLE) | Data acquisition + edge computing |
| Temperature/Humidity | BME280 (±0.5°C, ±3% RH) | Cross-validate IMD grid predictions |
| Rainfall | Tipping bucket (0.2mm resolution) | Validate monsoon predictions |
| Solar | 6V 2W panel + 3.7V 2000mAh LiPo | Off-grid operation |
| Communication | LoRa SX1276 (15km range) | Remote deployment in Western Ghats |
| Enclosure | IP67 UV-resistant ABS | Outdoor weather station housing |
| Sampling | 15-minute intervals | Matches IMD daily aggregation |

**Deployment Plan**: 3 units across Western Ghats altitude transect (coast → ridge → leeward) for live validation during finals.

---

## 🏆 Innovation & Differentiation

| Feature | MAUSAM | Typical Submissions |
|---------|--------|-------------------|
| AI Architecture | **GNN + Transformer** (spatial-temporal) | XGBoost / LSTM |
| Physics Constraints | Water balance + smoothness loss | Pure MSE |
| Uncertainty | Monte Carlo Dropout (10 passes) | Point forecasts |
| Visualization | **CesiumJS 3D Globe** (DestinE-class) | Streamlit / Matplotlib |
| What-If Engine | 4 scenario types + split-screen | Not implemented |
| Deployment | **Live AWS production URL** | Jupyter notebook |
| Data Fusion | 6 heterogeneous sources | Single IMD dataset |
| IoT Integration | ESP32 sensor network design | Software only |

---

## 📁 Repository Structure

```
vayu/
├── ai_engine/           # GNN + Transformer model (2.35M params)
├── backend/             # FastAPI production API
├── frontend/            # React + CesiumJS 3D dashboard
├── data_ingestion/      # IMD/MOSDAC/NCEP download + preprocessing
├── scenario_engine/     # What-If simulation (4 scenario types)
├── infra/               # AWS CDK (ECS + RDS + Redis + CloudFront)
├── notebooks/           # Kaggle training notebooks
├── scripts/             # Utility scripts (setup, train, deploy)
├── tests/               # Property-based correctness tests
├── submission/          # Video script, paper, PPT content
└── .github/workflows/   # CI/CD pipeline
```

---

## 📜 License

MIT License — Built for ISRO's Bharatiya Antariksh Hackathon 2026 (PS-5)

---

<p align="center">
  <strong>Built with 🇮🇳 for India's climate resilience</strong><br/>
  <em>Team: Shyam | Bharatiya Antariksh Hackathon 2026</em>
</p>
