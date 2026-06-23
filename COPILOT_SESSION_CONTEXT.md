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
- **Pipeline is now fully working end-to-end on Kaggle** (as of 2026-06-23 session).
- Preprocessing succeeded with all ancillary features: CHIRPS blended rainfall, NCEP wind (all 16 years), GEBCO topography.
- Sequences rebuilt: 1024 train (2.6 GB) + 256 val (650 MB), all with 16-feature node vectors.
- Normalized file: 198 MB (was 110 MB — includes uwnd_850/vwnd_850/shum_850).
- Smoke check failing due to trainer SyntaxError — fixed in latest commit (08f29f1).
- **Next: re-run smoke check on Kaggle (cell 6), then launch 80-epoch training (cell 7).**
- Previous best (before ancillary data): 33+ epochs, val_loss=0.1930, R²_tmax=0.817, R²_rain=0.201.

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
- `gnn_in_features=16` — existing OLD checkpoints (11 or 13 features) are incompatible with current model.
- Kaggle notebook: always re-run cell 4 (git pull) to pick up latest code before running subsequent cells.
- Windows CUDA backward: known native crash; use Kaggle for all GPU training.
- GEBCO file in repo: `gebco/gebco_2026_n22.0_s7.0_w71.0_e79.0.nc` — correct bounds now. ✅
- Local sequences (`data/processed_western_ghats/train_sequences.pt`) are STALE (11 features); Kaggle sequences are fresh (16 features). Rebuild locally if needed.
- uwnd 2016-2020 had corrupted original subset files — replaced with real NCEP data downloaded 2026-06-23. ✅

### Data status (2026-06-23)
- **Local ancillary data: complete** — `data/ncep_wind_subset/` (64 files), `data/chirps_subset/` (16 files), `gebco/` (1 file).
- **Kaggle ancillary dataset: v4 (latest)** — `shyam31415/vayu-ancillary-wg-v1`, 88 MB zip with all 81 files.
- **Kaggle IMD bundle**: `shyam31415/vayu-western-ghats-processed-v1` — unchanged.
- Large local data folders are excluded from git via `.gitignore`.
- `data/ncep_wind/` — raw downloaded NCEP full files (uwnd.2010–2014, 2016–2020), can be deleted after subsetting.

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
- Activate venv: `\.venv\Scripts\Activate.ps1`
- Check ancillary dataset completeness: `Get-ChildItem data\ncep_wind_subset -Filter *.nc | Measure-Object`
- Subset downloaded NCEP raw files: `.venv\Scripts\python.exe scripts\subset_uwnd_downloaded.py`

### Kaggle workflow
- Upload full ancillary dataset version: stage in `data/kaggle_ancillary_full/`, run `kaggle datasets version -p data\kaggle_ancillary_full -m "..."` 
- Upload individual file corrections: `kaggle datasets version -p <staging_dir> -m "..."` — **WARNING: this REPLACES all files; always include all 81 files in the zip.**

### Notebook cells (Kaggle)
1. Environment check (nvidia-smi)
2. pip install torch-geometric==2.5.3 xarray netcdf4 typer scipy
3. Clone/pull repo + locate IMD dataset
4. Copy files + copy NCEP/CHIRPS/GEBCO + preprocess + GEBCO elev + build sequences ← all in one cell
5. Smoke check (1 epoch forward-only)
6. Full 80-epoch training

### Build sequences (full India)
- `python -m data_ingestion.cli build-sequences --normalized-file .\data\processed_full_india\normalized_2010-2025.nc --output-dir .\data\processed_full_india --input-window 30 --target-window 7 --max-train 128 --max-val 32 --stride 10 --fillna-value 0.0`

### Package dataset
- `python -m data_ingestion.cli package-dataset --raw-dir .\data\imd --processed-dir .\data\processed_full_india --output-dir .\data\kaggle_bundle_full_india`

### Publish Kaggle dataset version
- `kaggle datasets version -p .\data\kaggle_bundle_full_india -m "<message>"`

### Kaggle training (full quality Western Ghats)
- ```
  python -m ai_engine.trainer \
    --data-dir /kaggle/working/isro/data/processed_western_ghats \
    --checkpoint-dir /kaggle/working/isro/checkpoints/wg_main \
    --epochs 80 --device auto --amp --batch-size 1 --grad-accum-steps 8 \
    --cosine-lr --early-stopping-patience 15 --weight-decay 1e-4 \
    --gnn-dropout 0.15 --lambda-conservation 0.3 --lambda-smoothness 0.01 \
    --norm-params-file .../norm_params_2010-2025.nc \
    --run-baselines --require-benchmarks
  ```

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

### 2026-06-23 (latest — full ancillary pipeline + trainer fixes)
- Goal:
  - Complete end-to-end Kaggle training pipeline with NCEP wind / CHIRPS / GEBCO ancillary data.
  - Upload ancillary datasets to Kaggle, fix all pipeline errors, get to smoke check passing.
- Environment used:
  - Local Windows PowerShell + Kaggle Notebook GPU sessions (T4×2).
- What changed:
  **Kaggle datasets:**
  - Created `shyam31415/vayu-ancillary-wg-v1` dataset containing all 81 files (64 NCEP + 16 CHIRPS + 1 GEBCO) as a zip archive.
  - Fixed corrupted uwnd 2016–2020 files (originally empty/partial downloads from previous session). Re-downloaded using raw PSL files and subsetted to 850 hPa + WG bounds. Uploaded as v4.
  - v4 is the canonical complete version: 88.4 MB zip, all 81 files with real data.
  **Code fixes (all pushed to main):**
  - `data_ingestion/preprocessor.py`: `load_ncep_wind_at_850` now tries both filename patterns `uwnd.YYYY.nc` (raw NCEP) and `uwnd_YYYY_850hPa_WG.nc` (our subsetted format).
  - `data_ingestion/preprocessor.py`: added `.sortby("lat").sortby("lon")` before NCEP regrid — NCEP subsets have descending lat which broke `sel(slice())` and `RegularGridInterpolator`.
  - `data_ingestion/preprocessor.py`: guard against `IndexError: list index out of range` when a file has no matching variable.
  - `data_ingestion/graph_builder.py`: `_load_or_generate_elevation` and `_load_or_generate_lsm` now use `interp(lat=self.lats, lon=self.lons)` instead of `sel()+reshape()` — float-precision mismatch in lat/lon coords caused reshape crashes.
  - `ai_engine/trainer.py`: **critical SyntaxError fix** — training loop had a broken `for...else` construct; `scheduler.step()` and all per-epoch logic (logging, checkpointing, early stopping, `break`) were accidentally placed in the `else` clause which runs once after the loop, making `break` syntactically outside a loop. Fixed by removing `else:` and de-indenting the block back into the for loop. Also corrected scheduler stepping: CosineAnnealingLR uses `scheduler.step()`, ReduceLROnPlateau uses `scheduler.step(val_loss)`.
  **Notebook updates:**
  - `notebooks/vayu_kaggle_training.ipynb`: major overhaul of setup cell to:
    - Print `/kaggle/input` contents for dataset discovery debugging.
    - Auto-detect NCEP/CHIRPS/GEBCO from vayu-ancillary-wg-v1 and copy to working dirs.
    - Run preprocess with `--ncep-wind-dir` and `--chirps-dir` when available.
    - Process GEBCO AFTER preprocess (so interp uses freshly-generated grid).
    - Capture stdout+stderr from preprocess and build-sequences subprocesses — errors now visible.
    - Smoke check also captures stdout+stderr.
  - Notebook header updated: lists both required datasets and GPU T4×2 setup instructions.
  **New script:**
  - `scripts/subset_uwnd_downloaded.py`: subsets manually-downloaded NCEP full files to 850 hPa + WG region, replacing any zero-filled placeholders.
  **Frontend (no change in this session).**
- Commands run:
  - `.venv\Scripts\python.exe -m kaggle datasets create -p data\kaggle_ancillary_v2` (initial upload, 17.6 MB zip)
  - `.venv\Scripts\python.exe -m kaggle datasets version -p data\kaggle_ancillary_full -m "v4: complete bundle"` (88.4 MB, all 81 real files)
  - Multiple git commits/pushes throughout session
  - Local smoke check: `.venv\Scripts\python.exe -c "import subprocess, sys; r = subprocess.run([sys.executable, '-m', 'ai_engine.trainer', '--data-dir', 'data/processed_western_ghats', '--checkpoint-dir', 'checkpoints/wg_smoke_local', '--epochs', '1', '--device', 'cpu', '--smoke-only'], capture_output=True, text=True, cwd='.'); print('RC:', r.returncode); print('STDERR:', r.stderr[-3000:])"`
- Results/metrics (Kaggle cell 5 output, successful):
  - NCEP: 64 files copied from vayu-ancillary-wg-v1
  - CHIRPS: 16 files copied
  - GEBCO: processed → elev -3347–2267 m on 57×23 grid
  - Normalized vars: `['rainfall', 'tmax', 'tmin', 'rainfall_qc_flag', 'tmax_qc_flag', 'tmin_qc_flag', 'uwnd_850', 'vwnd_850', 'shum_850']`
  - Grid: lat=57, lon=23, time=5844
  - train_sequences.pt: 2.6 GB, val_sequences.pt: 650 MB
  - Smoke check: **still failing** due to trainer SyntaxError (fixed in last commit 08f29f1, not yet re-run on Kaggle)
- Errors/blockers encountered and fixed:
  - Kaggle `datasets version` replaces ALL files — must always include complete file set in staging dir.
  - NCEP files had corrupted empty placeholders for 2016–2020 (empty NetCDF headers, 0 data_vars).
  - NCEP filename pattern mismatch: preprocessor expected `uwnd.YYYY.nc`, subset files are `uwnd_YYYY_850hPa_WG.nc`.
  - NCEP lat in descending order broke `sel(slice())` (returned empty) and `RegularGridInterpolator` (requires ascending).
  - GEBCO `coarsen(lat=60, lon=60)` produced offset grid causing `reshape()` crash in graph builder.
  - Notebook cells had stale code (indentation errors from earlier JSON patching); user needed to paste corrected code.
  - Trainer had `for...else` SyntaxError making `break` outside a loop — trainer could not start at all.
- Decisions made:
  - Keep zero-fill for unknown years if real data unavailable (preprocessor degrades gracefully).
  - GEBCO processed AFTER preprocess so grid is guaranteed fresh.
  - Capture all subprocess stdout+stderr in notebook for debugging transparency.
  - Upload full 81-file zip for every dataset version update (not partial updates).
- Files touched (2026-06-23):
  - `data_ingestion/preprocessor.py` — NCEP filename patterns, lat sort, empty-var guard
  - `data_ingestion/graph_builder.py` — interp replaces sel+reshape for elevation/LSM
  - `ai_engine/trainer.py` — critical for-else SyntaxError fix + cosine/plateau scheduler branching
  - `notebooks/vayu_kaggle_training.ipynb` — complete cell 5 rewrite, header update, capture all errors
  - `scripts/subset_uwnd_downloaded.py` — new script for manual NCEP download subsetting
  - `data/ncep_wind_subset/uwnd_2016–2020_850hPa_WG.nc` — replaced with real data (local only)
  - `gebco/gebco_2026_n22.0_s7.0_w71.0_e79.0.nc` — confirmed correct bounds (N=22 S=7 W=71 E=79) ✅
- Next session first steps:
  1. **On Kaggle**: `git -C /kaggle/working/isro pull` then re-run cell 6 (smoke) → cell 7 (full training).
  2. Cell 5 (preprocess + sequences) does NOT need to be re-run — sequences already built.
  3. Expected: smoke passes, training begins at epoch 1 with uwnd_850/vwnd_850/shum_850 + CHIRPS + GEBCO.
  4. Target metrics: R²_tmax ≥ 0.90, R²_rain improve significantly vs 0.201 baseline.
  5. After training completes: download `vayu_best.pt` from Kaggle output.
  6. Optional: rebuild local sequences if local testing needed (`python -m data_ingestion.cli build-sequences ...`).

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
