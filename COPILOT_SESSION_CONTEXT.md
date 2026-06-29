# Copilot Session Context

Purpose: persistent project context for future Copilot sessions.
Update this file at the end of every session.

---

## Current State Snapshot (2026-06-27)

### Project
- Name: VAYU — India's first AI Climate Digital Twin (ISRO BAH 2026)
- Repo: https://github.com/Shyamistic/vayu
- Primary branch: main
- Competition deadline: ~July 1, 2026

### Core stack
- Python backend/training: PyTorch + PyTorch Geometric + FastAPI
- Frontend: React 18 + TypeScript + Vite + CesiumJS 1.118 + Tailwind CSS
- Data: xarray + NetCDF (IMD + NCEP + CHIRPS + GEBCO)
- Infra: Docker Compose locally; Railway (backend) + Vercel (frontend)

---

## Model — VAYU v2 (current, being trained on Kaggle)

### Architecture (VayuClimateModelV2 — defined inline in notebook)
- **9.5M params** (up from 6.56M v1)
- Spatial encoder: **GATv2Conv** 4 layers × 4 heads (dynamic attention, direction-aware)
  - Replaces SAGEConv mean aggregation → learns windward/leeward orographic asymmetry
  - `hidden_dim=192`, `edge_dim=hidden_dim`
- Temporal encoder: **Transformer 6L**, d_model=384, 8 heads, pre-norm, **45-day** input window
- Rainfall head: **Two-stage** — BCE occurrence + Tweedie(p=1.5) amount
- Loss: Tweedie(50%) + CRPS(50%) + BCE(30%), `w_rain=1.8` (was 0.3 — 6× increase)
- Training: 3-phase curriculum (T-only ep 1–15 → T+Rain ep 16–50 → Full ep 51–100)

### Root cause of v1 R²_rain = 0.11
1. Gradient starvation: rain weight=0.3 → only 7.9% of gradient
2. MSE on zero-inflated distribution (92% dry days → model predicts near-zero always)
3. SAGEConv mean aggregation loses windward/leeward direction
4. Smoothness loss penalized sharp rain gradients (physically expected from orography)

### v2 fixes in ai_engine/
- `ai_engine/loss_functions.py`: `w_rain 0.3 → 1.8`, `TweedieLoss`, `WeightedCRPSLoss` added
- Smoothness: temperature only (NOT rainfall)
- `ai_engine/trainer.py`: checkpoint resilience — copies to `/kaggle/working/vayu_best.pt` on Kaggle

### Node features (17, all non-zero since NCEP enrichment)
- Dynamic (5): rainfall, tmax, tmin, insat_lst(=0), insat_sst(=0)
- Temporal (2): day_sin, day_cos
- Monsoon (2): jjas_flag, monsoon_progress
- NCEP 850 hPa (3): **uwnd_850, vwnd_850, shum_850** — REAL VALUES from enrichment
- CHIRPS (1): chirps_rain (auxiliary predictor, NOT target)
- Static (4): elevation, land_sea_mask, lat_norm, lon_norm

### Training status (2026-06-27)
- **FRESH_V2 Session 1 RUNNING on Kaggle T4×2** — epochs 1–50, ~9 hrs
- NCEP enrichment confirmed working: uwnd mean=1.876 std=5.928, vwnd mean=-0.895
- Sequences: 1641 train / 290 val, 45-day window, 1311 nodes
- Best checkpoint auto-saved to `/kaggle/working/vayu_best.pt` after every improvement
- **Expected results**: R²_rain 0.40–0.55 | R²_tmax 0.88–0.92

### Local v1 checkpoint
- `vayu_best (1).pt` — **INCOMPATIBLE** (2.36M hidden=128 vs 6.56M hidden=192)
  - Cannot load with `strict=False`, fresh training required

---

## Training Notebook (notebooks/vayu_v2_training.ipynb)

### Training modes
```python
TRAINING_MODE = 'FRESH_V2'   # current (Session 1)
# WARM_V2  : Session 2 — continue GATv2 from checkpoint
# WARM_V1  : Continue SAGEConv v1 checkpoint with new loss
# FRESH_V1 : SAGEConv v1 + new loss (~8 hrs)
FRESH_TOTAL_EPOCHS = 50  # Session 1; set to 100 for Session 2
```

### Session 2 procedure
1. When Session 1 completes → Versions → Output → download `vayu_best.pt`
2. Create Kaggle dataset: `shyam31415/vayu-v2-checkpoint`
3. Add as input to notebook
4. Set `TRAINING_MODE = 'WARM_V2'`, `FRESH_TOTAL_EPOCHS = 100`
5. Run All → epochs 51–100

### Checkpoint resilience
- Saved every improvement to `/kaggle/working/vayu_best.pt` (root, survives cancellation)
- Also at `/kaggle/working/isro/checkpoints/wg_v2/vayu_v2_best.pt`
- Training log: `/kaggle/working/training_log.json`

### Key known issues fixed
1. `SyntaxError: else:` duplicate block → removed
2. `RuntimeError mat1×mat2 (900×17 and 23×192)` → test uses `n_physics=0`
3. `FileNotFoundError norm_params_2010-2025.nc` → non-blocking try/except
4. `ForecastAnimation.onDayChange` TS type → ref pattern
5. Sequence format is TUPLES `(GraphData, target_tensor)` not single GraphData — `unpack_seq()` handles both

---

## Kaggle Datasets

| Dataset | Content | Status |
|---------|---------|--------|
| `shyam31415/vayu-western-ghats-processed-v1` | normalized_2010-2025.nc (6 vars) + pipeline logs | ✓ Available |
| `shyam31415/vayu-ancillary-wg-v1` | 64 NCEP + 16 CHIRPS + GEBCO (88 MB) | ✓ Available |
| `shyam31415/vayu-v2-checkpoint` | vayu_best.pt from Session 1 | **Pending** |

---

## Frontend (frontend/)

### Build status
- TypeScript: **0 errors** (`npx tsc --noEmit`) ✓
- Vite build: **✓** (CSS 28.6 kB gz, JS 348.6 kB gz)
- Dev server: `cd frontend && npm run dev` → http://localhost:5173

### New components (2026-06-27)
| Component | Feature |
|-----------|---------|
| `ExtremeAlerts.tsx` | IMD threshold alerts (≥150mm/day, ≥45°C) |
| `CellInfoCard.tsx` | Click-to-query with 7-day sparkline |
| `ForecastAnimation.tsx` | T+1→T+7 animated playback with speed control |
| `TrendSparklines.tsx` | 30-day canvas sparklines (no Plotly overhead) |
| `GuidedTour.tsx` | 6-step scripted camera tour for judges |
| `AgriculturePanel.tsx` | Rice/wheat/cotton/sugarcane/soybean advisories |
| `MonsoonTracker.tsx` | Monsoon onset progress bar (IMD normals) |
| `ColormapSelector.tsx` | 12 scientific colormaps (fluid-earth ported) |
| `AQIPanel.tsx` | OWM Air Pollution API, CPCB color coding |
| `CyclonePanel.tsx` | Historical cyclone tracks (Amphan, Tauktae, Biparjoy…) |
| `DroughtSPIPanel.tsx` | SPI-1/3/6 drought index (McKee 1993) |
| `FloodRiskPanel.tsx` | IMD flash flood guidance thresholds |
| `NWPComparisonPanel.tsx` | VAYU vs ECMWF/IMD/persistence |
| `ExportTools.tsx` | Screenshot + CSV/JSON export |
| `IoTSensorPanel.tsx` | 20 simulated IoT sensors, live 5s updates |
| `utils/colorScales.ts` | fluid-earth colormaps: viridis, plasma, earth_temp, IMD rain, etc. |

### CesiumGlobe.tsx major changes
- **India boundaries FIXED**: `GroundPolylinePrimitive` ring-by-ring (was `GeoJsonDataSource.clampToGround` which silently drops outlines)
- 3D extruded rainfall columns (`show3D` prop, up to 80 km height)
- Day/night terminator line (solar declination formula)
- `terrainExaggeration` prop → `scene.verticalExaggeration` (1×–5×)
- `tourStep` prop for guided camera flights
- OWM live tiles, FIRMS fires, SMAP soil moisture layers
- Click-to-query with nearest-cell snap, `onCellClick` callback
- Colormap prop using `colorScales.ts` LUTs

### LayerControlPanel grouped layers (14 total)
- Base: Satellite, MODIS, Night Lights, VAYU Only
- NASA/GIBS: IMERG Rain, Cloud Cover, SST, Aerosol, NDVI, Active Fires, SMAP
- Live Weather: OWM Rain, OWM Temp, OWM Wind

### App.tsx additions
- Keyboard shortcuts: `1-7` forecast day, `R/T/M` variable, `Space` play/pause, `←/→` date
- Terrain slider (left panel, orange)
- 3D rainfall toggle
- Guided Tour button
- Agriculture + Environment view tabs
- `ForecastAnimation` replaces `ForecastDaySelector`

### index.css (Part B Polish)
- Glassmorphism panels (`backdrop-blur`)
- Button hover scale(1.03) + glow, active scale(0.95)
- Slider thumb glow shadow
- `@media (prefers-reduced-motion)` support
- Skeleton shimmer, breathing-glow keyframes
- Tabular-nums everywhere, never pure white text

---

## Backend (backend/main.py)
- Serves `VayuClimateModel` (v1 SAGEConv) from `checkpoints/vayu_best.pt`
- **Pending**: update to load `VayuClimateModelV2` once v2 training completes
- Endpoints: `/api/predict`, `/api/scenario`, `/health`, `/api/metrics`

---

## Key Commands

```powershell
# Activate venv
.\.venv\Scripts\Activate.ps1

# Run tests
.\.venv\Scripts\python.exe -m pytest tests/ -v  # 74/74 passing

# Frontend dev
cd frontend ; npm run dev

# TS check + build
cd frontend ; npx tsc --noEmit
cd frontend ; npx vite build

# Smoke test losses
.\.venv\Scripts\python.exe -c "from ai_engine.loss_functions import TweedieLoss, WeightedCRPSLoss, VARIABLE_WEIGHTS; print('rain w:', VARIABLE_WEIGHTS['rainfall'])"
```

---

## Session Log (most recent first)

### 2026-06-27 — v2 Architecture + NCEP enrichment + 30+ frontend features

**Goals achieved**:
- Designed and implemented VAYU v2 (GATv2 + Tweedie + curriculum training)
- Diagnosed v1 R²_rain=0.11 root causes; fixed all in v2 design
- NCEP wind/humidity enrichment working on Kaggle (real values, not zeros)
- v2 training Session 1 running on Kaggle T4×2
- 30+ frontend features implemented and pushed
- India boundary rendering fixed (GroundPolylinePrimitive)
- All repos gitignored (fluid-earth, terriajs, weatherlayers-gl, etc.)

**Key decisions**:
- `vayu_best (1).pt` is incompatible (2.36M vs 6.56M arch) → fresh FRESH_V2 training
- v2 = GATv2 + Tweedie + curriculum, not just loss change
- 2-session strategy for Kaggle (50+50 epochs)
- Smoothness loss temperature-only permanently
- Rain weight fixed at 1.8 in `ai_engine/loss_functions.py` for all future runs

**Next session first steps**:
1. Check Kaggle Session 1 — should be at epoch 10–30 by next check
2. When complete: download `vayu_best.pt`, upload as dataset, run Session 2 (WARM_V2)
3. Wire v2 model classes into `ai_engine/climate_model.py` for production serving
4. Update `backend/main.py` to load v2 checkpoint
5. Frontend polish: fix any remaining display issues from the new components

---

### 2026-06-25/26 — CHIRPS fix + loss overhaul + ISRO Earth View
- Root cause: CHIRPS was replacing IMD rainfall target → negative R²
- Fixed: CHIRPS now auxiliary feature only
- Two-stage loss, weight=2.5, lambda_conservation=0.05
- ISRO Earth View built with cinematic intro, NASA GIBS layers

### 2026-06-23 — Full ancillary pipeline + trainer fixes
- NCEP dataset v4 uploaded (88 MB, 81 files)
- Filename pattern, lat-sort, reshape bugs fixed in preprocessor/graph_builder
- trainer.py critical for…else SyntaxError fixed
