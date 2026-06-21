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
- Full-India training now runs on Kaggle with GPU using reduced-memory presets.
- `kaggle_lite` and `kaggle_medium` presets added in `ai_engine/trainer.py`.
- JSON serialization issue in training history fixed (NumPy/Torch scalar conversion).
- Recent completed run (64/16 sequences, 30 epochs) showed best val_loss around 0.0825, but R² remained negative.
- New run in progress with `kaggle_medium` and 128/32 sequences; loss continues improving but R² remains negative so far.

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
