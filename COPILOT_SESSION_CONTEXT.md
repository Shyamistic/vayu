# Copilot Session Context

Purpose: persistent project context for future Copilot sessions.
Update this file at the end of every session.

How to update each session:
1. Add a new entry under "Session Log" at the top (most recent first).
2. Update "Current State Snapshot" if architecture/status changed.
3. Keep entries factual and concise.
4. Include blockers, decisions, and exact run commands.

## Current State Snapshot

### Project
- Name: VAYU climate digital twin
- Repo: https://github.com/Shyamistic/vayu
- Primary branch: main

### Core stack
- Python backend/training: PyTorch + PyTorch Geometric + FastAPI
- Frontend: React + TypeScript + Cesium
- Data: xarray + NetCDF (IMD pipelines)
- Infra: Docker Compose locally; AWS/CDK scaffolds present

### Training status (latest known)
- Western Ghats run on Kaggle T4×2: 33+ epochs completed, best val_loss=0.1930 (epoch 27).
- R²_tmax=0.817, R²_rain=0.201 after 33 epochs. Model is learning; rain still below target.
- Next run queued: GEBCO elevation (re-download N=22,S=7,W=71,E=79), ERA5 wind features, full quality stack.
- Kaggle notebook: `notebooks/vayu_kaggle_training.ipynb` — fully self-contained, uses sys.executable.

### Model architecture (current)
- VayuClimateModel: 2.3M params (GraphSAGE 3L hidden=128 + Transformer 4L d_model=256 8h)
- Node features: **16** (was 13; added uwnd_850/vwnd_850/shum_850 in 2026-06-23 session)
  - Dynamic (5): rainfall, tmax, tmin, insat_lst, insat_sst
  - Temporal (2): day_sin, day_cos
  - Monsoon (2): jjas_flag, monsoon_progress
  - Wind/humidity (3): uwnd_850, vwnd_850, shum_850 (NCEP 850 hPa; fallback 0 when absent)
  - Static (4): elevation, land_sea_mask, lat_norm, lon_norm
- Loss: PhysicsInformedLoss — focal regression for rainfall (gamma=1.5), temp MSE
- Training: AMP fp16, grad-accum×8, cosine LR, weight_decay=1e-4, stochastic depth
- Sequences: 1024 train / 256 val, stride=2, 30-day input → 7-day forecast

### Quality improvements implemented (2026-06-22 session)
- `--kaggle-medium`/`--kaggle-lite` presets: physics constraints RESTORED (was wrongly zeroed)
- `--grad-accum-steps N`: gradient accumulation, effective batch = N×batch_size
- Focal regression loss for rainfall (replaces log1p MSE), weight=1.5, gamma=1.5
- Rainfall loss weight: 0.5 → 1.5
- Stochastic depth in TemporalTransformer (linear drop 0→0.2 across layers)
- Monsoon JJAS flag + monsoon_progress added as node features (gnn_in_features: 11→13)
- Feature noise augmentation (std=0.02) in _train_epoch
- Cosine annealing LR (replaces ReduceLROnPlateau)
- `--weight-decay`, `--gnn-dropout`, `--early-stopping-patience`, `--cosine-lr` CLI flags
- `--elevation-file` / `--lsm-file` flags in `build-sequences` CLI (GEBCO support)
- GEBCO file downloaded: `gebco/gebco_2026_n20.0_s8.0_w72.0_e78.0.nc` (needs re-download: N=22,S=7)

### Data sources to integrate (next session)
- ERA5 u850/v850/q850/msl: Copernicus CDS (cds.climate.copernicus.eu), free account
  - Adds monsoon low-level jet — single biggest R²_rain improvement after GEBCO
  - Download: ERA5 single levels, 7.5–22°N 71–79°E, 2010–2025, daily
- CHIRPS rainfall: chc.ucsb.edu/data/chirps — no login, better than IMD for Ghats
- NCEP NOAA wind: psl.noaa.gov/data/gridded/data.ncep.reanalysis.html

### Known active constraints
- gnn_in_features now 13 — existing checkpoints with 11 features are INCOMPATIBLE
- Kaggle notebook: requires git pull to pick up latest code before running
- Windows CUDA backward: known native crash; use Kaggle for all training
- GEBCO bounds were wrong (n20 s8); re-download with N=22 S=7 W=71 E=79

### Data status
- Large local data folders are excluded from git via `.gitignore`.
- Kaggle dataset exists: `shyam31415/vayu-full-india-bundle-2010-2025`.
- Dataset versions include sequence tensors (`train_sequences.pt`, `val_sequences.pt`) and normalized/raw files.

### Important repo conventions
- Do not commit large generated datasets/checkpoints.
- Keep `.kiro/` and `research/` local (ignored).
- Prefer trainer CLI for reproducible runs.

### Known active constraints
- Full-India default model can OOM on Kaggle T4 GPUs.
- Kaggle environments may show pip conflict warnings due to preinstalled RAPIDS packages; generally non-blocking for current PyTorch path.
- Current bottleneck is forecasting skill (R²) rather than optimization stability.

### Research-derived strategy (current)
- Prioritize a Western Ghats regional model before scaling back to all-India.
- Keep full-India as phase-2 scaling once positive regional R² is established.
- Frontend target remains realistic 3D weather animation stack (Cesium + GPU materials/particles).
- Continue using validated sources: ERA5 (0.25 degree hourly), IMD gridded rainfall/temperature, MOSDAC INSAT products.

## Key Commands Reference

### Local prep
- Activate venv:
  - `\.venv\Scripts\Activate.ps1`

### Build sequences (full India)
- `python -m data_ingestion.cli build-sequences --normalized-file .\data\processed_full_india\normalized_2010-2025.nc --output-dir .\data\processed_full_india --input-window 30 --target-window 7 --max-train 128 --max-val 32 --stride 10 --fillna-value 0.0`

### Package dataset
- `python -m data_ingestion.cli package-dataset --raw-dir .\data\imd --processed-dir .\data\processed_full_india --output-dir .\data\kaggle_bundle_full_india`

### Publish Kaggle dataset version
- `kaggle datasets version -p .\data\kaggle_bundle_full_india -m "<message>"`

### Kaggle training (medium preset)
- `python -m ai_engine.trainer --data-dir /kaggle/input/datasets/shyam31415/vayu-full-india-bundle-2010-2025 --checkpoint-dir /kaggle/working/checkpoints/full_india_medium --epochs 50 --device cuda --kaggle-medium --batch-size 1`

## Session Log

### Session Entry Template (copy for each new session)
- Date:
- Goal:
- Environment used:
- What changed:
  -
- Commands run:
  -
- Results/metrics:
  -
- Errors/blockers:
  -
- Decisions made:
  -
- Files touched:
  -
- Next session first steps:
  -

### 2026-06-21 (latest)
- Goal:
  - Implement phase-1 differentiators after research refresh: benchmark-enforced training and Digital Twin state layer.
- Environment used:
  - Local Windows PowerShell with project `.venv`.
- What changed:
  - Enforced mandatory persistence and climatology benchmark comparisons during validation/training loops.
  - Added automatic `benchmark_report.json` artifact generation per experiment.
  - Added Digital Twin state layer (`ClimateState`, `StateUpdater`, `TwinEngine`).
  - Integrated twin lifecycle into backend prediction/scenario flows.
  - Added new backend APIs for digital twin state retrieval and updates.
  - Added test coverage for trainer benchmark outputs and twin state engine/API.
  - Persisted full normalization parameters from preprocessing to `norm_params_YYYY-YYYY.nc` for denormalized evaluation.
  - Added denormalized RMSE/MAE/R² and denormalized skill metrics in trainer eval/test paths when norm params are provided.
  - Added classical baseline suite module (Persistence, Climatology, Random Forest, optional XGBoost) and CLI wiring to emit baseline benchmark report artifacts.
  - Replaced static backend metrics endpoint behavior with report-backed loading from `benchmark_report.json` and `baseline_benchmark_report.json` (with safe fallback).
  - Added metrics API query options: `denormalized`, `source_model`, `lead_time`.
  - Added frontend API/type support for dynamic metrics query options and metadata fields.
  - Added region-aware evaluation support for benchmark reporting across: western_ghats, north_east_india, indo_gangetic_plain, central_india.
  - Extended baseline benchmark suite to emit regional T+1/T+3/T+7 metrics when node positions are available.
  - Extended backend `/api/metrics` to accept region values beyond pilot and resolve region-suffixed report keys with safe fallback.
  - Added a complete execution playbook for local-first training, Kaggle fallback, and Aurora foundation-model track in `TRAINING_TODOS_2026-06-21.md`.
  - Successfully published Kaggle dataset bundle `shyam31415/vayu-western-ghats-processed-v1` and added notebook-ready execution runbook in `KAGGLE_EXECUTION_NEXT_STEPS_2026-06-21.md`.
- Commands run:
  - `python -m pytest tests/test_trainer_benchmarks.py tests/test_twin_state.py tests/test_api.py -q`
  - `python -m pytest tests/test_preprocessor.py tests/test_trainer_benchmarks.py tests/test_model.py -q`
  - `python -m pytest tests/test_baselines.py tests/test_trainer_benchmarks.py tests/test_api.py -q`
  - Created training execution checklist document: `TRAINING_TODOS_2026-06-21.md`
  - Created Kaggle notebook execution checklist document: `KAGGLE_EXECUTION_NEXT_STEPS_2026-06-21.md`
  - `python -m pytest tests/test_api.py -q`
  - `python -m pytest tests/test_baselines.py tests/test_trainer_benchmarks.py tests/test_api.py -q`
- Results/metrics:
  - Focused verification suite passed: 22 tests passed.
  - Training pipeline now emits benchmark metrics including skill vs persistence and skill vs climatology.
  - Regression and feature suites for denormalized metric path and baseline suite passed (23 and 27 test subsets green).
  - Metrics API test suite remains fully passing with report-backed metrics behavior (20 passed).
  - Regional metrics extension verified with focused suite (28 passed).
  - End-to-end training plan now codified with concrete command sequence and promotion gates.
  - Kaggle data pipeline is now unblocked and ready for GPU training runs.
- Errors/blockers:
  - Initial twin API tests returned 503 under TestClient without lifespan startup.
  - Resolved via lazy twin engine initialization.
- Decisions made:
  - Keep regional-first execution track and enforce benchmark comparisons for every experiment by default.
  - Treat twin state as first-class API object to reinforce true digital-twin judge narrative.
- Files touched:
  - `ai_engine/trainer.py`
  - `ai_engine/baselines.py`
  - `scenario_engine/twin_state.py`
  - `scenario_engine/__init__.py`
  - `backend/main.py`
  - `frontend/src/api/client.ts`
  - `frontend/src/types/index.ts`
  - `data_ingestion/cli.py`
  - `pyproject.toml`
  - `tests/test_api.py`
  - `tests/test_twin_state.py`
  - `tests/test_trainer_benchmarks.py`
  - `tests/test_baselines.py`
  - `ai_engine/regions.py`
  - `TRAINING_TODOS_2026-06-21.md`
  - `KAGGLE_EXECUTION_NEXT_STEPS_2026-06-21.md`
  - `COPILOT_SESSION_CONTEXT.md`
- Next session first steps:
  - Add denormalized benchmark reporting and regional benchmark dashboard integration.
  - Extend twin state variables with explicit soil moisture and vegetation inputs from data products (instead of proxy-only fallback).
  - Begin regional baseline model pack (Persistence, Climatology, RF, XGBoost) with unified evaluator output.

### 2026-06-21 (latest)
- Goal:
  - Stabilize full-India Kaggle training and improve continuity.
- Environment used:
  - Local Windows PowerShell + Kaggle Notebook GPU sessions.
- What changed:
  - Added low-memory trainer presets for Kaggle.
  - Fixed training history JSON serialization error.
  - Rebuilt full-India sequences multiple times; settled on uploadable sequence sizes.
  - Updated git hygiene to avoid tracking massive datasets.
- Commands run:
  - `python -m data_ingestion.cli build-sequences ...`
  - `python -m data_ingestion.cli package-dataset ...`
  - `kaggle datasets version -p .\data\kaggle_bundle_full_india -m "..."`
  - `python -m ai_engine.trainer ... --kaggle-lite ...`
  - `python -m ai_engine.trainer ... --kaggle-medium ...`
- Results/metrics:
  - Training completed on Kaggle for 30 epochs in low-memory mode.
  - Best val_loss reached approximately 0.0825 in one run.
  - OOM errors resolved with reduced configs.
  - Despite lower loss, R² for tmax/rainfall remained below zero.
  - Expanded run started with 128/32 sequences and larger preset (`kaggle_medium`), still showing negative R² trend so far.
- Errors/blockers:
  - Early OOM on default full-India model.
  - Dataset mount/path confusion in Kaggle sessions.
  - Non-fatal Kaggle pip resolver warnings.
- Decisions made:
  - Keep Aurora path experimental for now.
  - Use VAYU baseline trainer path for competition baseline.
  - Shift execution strategy toward Western Ghats-first detailed modeling and validation.
- Files touched:
  - `ai_engine/trainer.py`
  - `.gitignore`
  - `data_ingestion/cli.py`
  - `data_ingestion/preprocessor.py`
  - `data_ingestion/graph_builder.py`
- Next session first steps:
  - Pull latest repo in Kaggle runtime.
  - Confirm dataset path via `/kaggle/input` discovery cell.
  - Run `--kaggle-medium` 50-epoch training and compare against prior best.
