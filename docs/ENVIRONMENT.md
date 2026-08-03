# Local Python environment

## Reproducible setup

This project uses CPython 3.13 only (`>=3.13,<3.14`). The pinned direct dependencies and test extras are in the project-level `pyproject.toml`; the full, platform-specific resolved set is recorded in `requirements.lock` after setup.

```powershell
$python = "C:\Users\shyam.BATCONSOLE\AppData\Local\Programs\Python\Python313\python.exe"
& $python -m venv .venv
& .\.venv\Scripts\python.exe -m pip install --upgrade pip==26.1.2 setuptools==81.0.0 wheel==0.47.0
& .\.venv\Scripts\python.exe -m pip install --extra-index-url https://download.pytorch.org/whl/cu124 -e ".[dev]"
```

The CUDA 12.4 PyTorch wheel is pinned to the previously installed `torch==2.6.0+cu124`. It can run on CPU when CUDA is unavailable. The `aurora` model package and `xgboost` remain deliberately optional because the application handles their absence and neither is required by the test suites.

## Repair record

The previous `.venv\Scripts\python.exe` was CPython 3.13.9 but its mandatory `.venv\pyvenv.cfg` was missing, making every launcher unusable. The repair replaces `.venv` only; it does not edit raw data, processed data, checkpoints, or task metadata.

Run the verification commands from the repository root after setup:

```powershell
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\python.exe -m ai_engine --help
.\.venv\Scripts\python.exe -m ai_engine discover
```
