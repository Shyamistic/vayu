# Kaggle Execution Next Steps (After Dataset Upload)

Dataset status: uploaded successfully
Dataset URL: https://www.kaggle.com/datasets/shyam31415/vayu-western-ghats-processed-v1

## 1) Create Kaggle Notebook

- Runtime: GPU (T4 or P100)
- Internet: ON
- Add dataset source:
  - shyam31415/vayu-western-ghats-processed-v1

## 2) Notebook Cell Order

Cell 1: install dependencies

```python
!pip install -q torch-geometric==2.5.3 xarray netcdf4 typer
```

Cell 2: clone repo (required so python -m data_ingestion.cli works)

```python
!rm -rf /kaggle/working/isro
!git clone https://github.com/Shyamistic/vayu.git /kaggle/working/isro
%cd /kaggle/working/isro
!pwd
!ls -lah
!python -c "import sys; print(sys.executable); print(sys.path[0])"
```

Cell 3: confirm mounted dataset path

```python
!ls -lah /kaggle/input/vayu-western-ghats-processed-v1
```

Cell 4: copy dataset into expected repo path

```python
!mkdir -p /kaggle/working/isro/data/imd
!mkdir -p /kaggle/working/isro/data/processed_western_ghats
!cp /kaggle/input/vayu-western-ghats-processed-v1/rainfall_2010-2025.nc /kaggle/working/isro/data/imd/
!cp /kaggle/input/vayu-western-ghats-processed-v1/tmax_2010-2025.nc /kaggle/working/isro/data/imd/
!cp /kaggle/input/vayu-western-ghats-processed-v1/tmin_2010-2025.nc /kaggle/working/isro/data/imd/
!cp /kaggle/input/vayu-western-ghats-processed-v1/normalized_2010-2025.nc /kaggle/working/isro/data/processed_western_ghats/
!cp /kaggle/input/vayu-western-ghats-processed-v1/pipeline_log_2010-2025.json /kaggle/working/isro/data/processed_western_ghats/
```

Cell 4b: verify project modules are visible

```python
!test -d /kaggle/working/isro/data_ingestion && echo "data_ingestion found" || echo "data_ingestion missing"
!python -c "import os,sys; os.chdir('/kaggle/working/isro'); import data_ingestion.cli as c; print('import-ok')"
```

Cell 5: regenerate norm params + sequences in Kaggle environment

```python
!python -m data_ingestion.cli preprocess --data-dir ./data/imd --output-dir ./data/processed_western_ghats --start-year 2010 --end-year 2025 --region western_ghats --resolution 0.25
!python -m data_ingestion.cli build-sequences --normalized-file ./data/processed_western_ghats/normalized_2010-2025.nc --output-dir ./data/processed_western_ghats --input-window 30 --target-window 7 --max-train 512 --max-val 128 --stride 3 --fillna-value 0.0
```

Cell 6: smoke run (quick validation)

```python
!python -m ai_engine.trainer --data-dir ./data/processed_western_ghats --checkpoint-dir ./checkpoints/wg_smoke --epochs 1 --device auto --smoke-only
```

Cell 7: real VAYU run (first priority)

```python
!python -m ai_engine.trainer --data-dir ./data/processed_western_ghats --checkpoint-dir ./checkpoints/wg_main --epochs 50 --device auto --norm-params-file ./data/processed_western_ghats/norm_params_2010-2025.nc --run-baselines --require-benchmarks
```

Cell 8: collect artifacts

```python
!ls -lah ./checkpoints/wg_main
!cp ./checkpoints/wg_main/* /kaggle/working/
```

## Ready-to-run exact cell block (copy in order)

```python
# Cell A
!pip install -q torch-geometric==2.5.3 xarray netcdf4 typer
```

```python
# Cell B
!rm -rf /kaggle/working/isro
!git clone https://github.com/Shyamistic/vayu.git /kaggle/working/isro
%cd /kaggle/working/isro
!pwd
```

```python
# Cell C
!ls -lah /kaggle/input/vayu-western-ghats-processed-v1
```

```python
# Cell D
!mkdir -p /kaggle/working/isro/data/imd
!mkdir -p /kaggle/working/isro/data/processed_western_ghats
!cp /kaggle/input/vayu-western-ghats-processed-v1/rainfall_2010-2025.nc /kaggle/working/isro/data/imd/
!cp /kaggle/input/vayu-western-ghats-processed-v1/tmax_2010-2025.nc /kaggle/working/isro/data/imd/
!cp /kaggle/input/vayu-western-ghats-processed-v1/tmin_2010-2025.nc /kaggle/working/isro/data/imd/
!cp /kaggle/input/vayu-western-ghats-processed-v1/normalized_2010-2025.nc /kaggle/working/isro/data/processed_western_ghats/
!cp /kaggle/input/vayu-western-ghats-processed-v1/pipeline_log_2010-2025.json /kaggle/working/isro/data/processed_western_ghats/
```

```python
# Cell E
!python -c "import os; os.chdir('/kaggle/working/isro'); import data_ingestion.cli; print('import-ok')"
```

```python
# Cell F
!python -m data_ingestion.cli preprocess --data-dir ./data/imd --output-dir ./data/processed_western_ghats --start-year 2010 --end-year 2025 --region western_ghats --resolution 0.25
!python -m data_ingestion.cli build-sequences --normalized-file ./data/processed_western_ghats/normalized_2010-2025.nc --output-dir ./data/processed_western_ghats --input-window 30 --target-window 7 --max-train 512 --max-val 128 --stride 3 --fillna-value 0.0
```

```python
# Cell G
!python -m ai_engine.trainer --data-dir ./data/processed_western_ghats --checkpoint-dir ./checkpoints/wg_smoke --epochs 1 --device auto --smoke-only
```

```python
# Cell H
!python -m ai_engine.trainer --data-dir ./data/processed_western_ghats --checkpoint-dir ./checkpoints/wg_main --epochs 50 --device auto --norm-params-file ./data/processed_western_ghats/norm_params_2010-2025.nc --run-baselines --require-benchmarks
```

```python
# Cell I
!ls -lah ./checkpoints/wg_main
!cp ./checkpoints/wg_main/* /kaggle/working/
```

## 3) Optional Aurora Track (only after VAYU baseline)

Cell 9: install Aurora

```python
!pip install -q microsoft-aurora
```

Cell 10: run Aurora experiments

- Use the module at ai_engine/aurora_finetuner.py
- Start with a short pilot run (5 epochs equivalent) before any full training

## 4) Budget Allocation (30 GPU Hours)

- 18 hours: VAYU runs (baseline + tuning)
- 10 hours: Aurora feasibility + comparison
- 2 hours: safety buffer and reruns

## 5) Go/No-Go Rule for Aurora

Continue Aurora only if it beats VAYU by >= 5% relative improvement on denormalized RMSE or R2 in western_ghats for rainfall or temp_max.
