# VAYU Complete Training To-Do (Local-First + Kaggle Fallback + Foundation Model)

Date: 2026-06-21
Owner: Team VAYU
Goal: Produce a judge-ready, benchmarked climate model checkpoint and regional validation report even if Kaggle upload fails.

## 1. Decide Primary Training Track

- [ ] If Kaggle dataset upload works: run Kaggle track for rapid GPU runs.
- [ ] If Kaggle upload fails or is blocked: run local track end-to-end.
- [ ] In parallel, start foundation-model exploration track (Aurora) for performance upside.

Decision rule:
- If Kaggle dataset upload fails twice, switch to local-first immediately and do not wait.

## 2. Data Preparation (Mandatory for all tracks)

- [ ] Ensure raw data files exist in data/imd:
  - rainfall_2010-2025.nc
  - tmax_2010-2025.nc
  - tmin_2010-2025.nc
- [ ] Run preprocessing for Western Ghats (regional-first).
- [ ] Verify outputs include normalization params for denormalized metrics.
- [ ] Build sequence tensors.
- [ ] Package bundle if Kaggle is available.

Commands (Windows PowerShell):

```powershell
.\.venv\Scripts\Activate.ps1
python -m data_ingestion.cli preprocess --data-dir .\data\imd --output-dir .\data\processed_western_ghats --start-year 2010 --end-year 2025 --region western_ghats --resolution 0.25
python -m data_ingestion.cli build-sequences --normalized-file .\data\processed_western_ghats\normalized_2010-2025.nc --output-dir .\data\processed_western_ghats --input-window 30 --target-window 7 --max-train 512 --max-val 128 --stride 3 --fillna-value 0.0
```

Kaggle-only packaging:

```powershell
python -m data_ingestion.cli package-dataset --raw-dir .\data\imd --processed-dir .\data\processed_western_ghats --output-dir .\data\kaggle_bundle_western_ghats
```

## 3. Local Training Track (Kaggle fallback)

- [ ] Run smoke check first.
- [ ] Run baseline suite (persistence/climatology/RF/XGBoost).
- [ ] Run benchmark-enforced training.
- [ ] Ensure denormalized metrics are generated.
- [ ] Keep best checkpoint and reports.

Smoke:

```powershell
python -m ai_engine.trainer --data-dir .\data\processed_western_ghats --checkpoint-dir .\checkpoints\wg_smoke --epochs 1 --device cuda --smoke-only
```

Baseline + train (recommended):

```powershell
python -m ai_engine.trainer --data-dir .\data\processed_western_ghats --checkpoint-dir .\checkpoints\wg_main --epochs 50 --device cuda --norm-params-file .\data\processed_western_ghats\norm_params_2010-2025.nc --run-baselines --require-benchmarks
```

Artifacts to verify:
- checkpoint: checkpoints/wg_main/vayu_best.pt
- training history: checkpoints/wg_main/training_history.json
- benchmark report: checkpoints/wg_main/benchmark_report.json
- baseline report: checkpoints/wg_main/baseline_benchmark_report.json

## 4. Kaggle Track (if upload works)

- [ ] Use notebook in notebooks/vayu_kaggle_training.ipynb.
- [ ] Point DATA_DIR to uploaded dataset path.
- [ ] Run 3-epoch smoke first.
- [ ] Run 30-50 epoch main training.
- [ ] Download checkpoint and reports from /kaggle/working.

Checklist:
- [ ] GPU enabled (T4/P100)
- [ ] Internet enabled (if cloning repo)
- [ ] Correct dataset mounted path

## 5. Mandatory Scientific Validation

- [ ] Confirm RMSE, MAE, R2, skill vs persistence, skill vs climatology.
- [ ] Confirm denormalized metrics present.
- [ ] Confirm regional metrics can be queried for:
  - western_ghats
  - north_east_india
  - indo_gangetic_plain
  - central_india

API examples:

```powershell
curl "http://localhost:8000/api/metrics?variable=rainfall&region=western_ghats&source_model=vayu&denormalized=true"
curl "http://localhost:8000/api/metrics?variable=rainfall&region=western_ghats&source_model=random_forest&lead_time=t3"
```

## 6. Foundation Model Track (Best model to download now)

Recommended model to try first: Microsoft Aurora Small (state-of-the-art foundation weather model, practical fine-tuning route already scaffolded in repo).

- [ ] Install Aurora package in a dedicated experiment environment.
- [ ] Run Aurora load check and parameter-freeze validation.
- [ ] Fine-tune on regional IMD split (small epochs first).
- [ ] Compare against VAYU baseline with same metrics and regions.

Local prep command:

```powershell
.\.venv\Scripts\Activate.ps1
pip install microsoft-aurora
```

Code path:
- ai_engine/aurora_finetuner.py

Aurora experiment gate:
- Continue only if Aurora validation R2 and denormalized RMSE beat VAYU regional baseline by >= 5% relative on temp_max or rainfall.

## 7. Promotion Criteria (Go/No-Go)

Promote model to deployment candidate only if all are true:
- [ ] Beats persistence and climatology on target variables.
- [ ] Regional metrics are stable (no severe collapse in any key region).
- [ ] Denormalized metrics are physically plausible.
- [ ] Artifact bundle contains checkpoint + benchmark reports.

## 8. Deployment Readiness

- [ ] Upload best checkpoint to S3.
- [ ] Deploy backend/frontend infra.
- [ ] Verify /health and /api/metrics endpoints in production.

Commands:

```powershell
aws s3 cp .\checkpoints\wg_main\vayu_best.pt s3://<model-bucket>/checkpoints/vayu_best.pt
.\scripts\deploy_aws.ps1 -AccountId <AWS_ACCOUNT_ID> -Region ap-south-1
```

## 9. Immediate Execution Order (Today)

- [ ] Step A: Preprocess + sequence build for western_ghats.
- [ ] Step B: Run local smoke.
- [ ] Step C: Run local 50-epoch training with baselines and denormalized metrics.
- [ ] Step D: Extract metric summary and pick best candidate checkpoint.
- [ ] Step E: Start Aurora install + 5-epoch feasibility run.
- [ ] Step F: Compare VAYU vs Aurora and decide final model for demo.

## 10. Risks and Mitigations

- Risk: Kaggle upload blocked
  - Mitigation: local-first track above; no dependency on Kaggle publishing.
- Risk: GPU OOM
  - Mitigation: use smaller config or kaggle_medium profile flags in trainer.
- Risk: Negative R2 despite lower loss
  - Mitigation: rely on denormalized + baseline-relative metrics for model acceptance.
- Risk: XGBoost unavailable
  - Mitigation: baseline suite already skips gracefully and continues.
