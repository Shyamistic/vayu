"""Retarget the four regional Kaggle notebooks at the 1981-2025 datasets.

Why each change is needed (all four notebooks were built for the 2010-2025
bundles and will FAIL against the new ones):

1. FILENAMES. The new bundles hold normalized_1981-2025.nc /
   norm_params_1981-2025.nc, not the 2010-2025 names.

2. sequence_manifest.json IS GONE. It was in REQUIRED_FILES, so the staging
   cell would raise "Missing required files" and abort before training. The
   1981-2025 bundles are built for the lazy-window path only and contain
   exactly: normalized, norm_params, pipeline_log, elevation, lsm,
   static_raster_manifest.

3. THE SMOKE CELL READ FILES THAT NO LONGER EXIST. It loaded
   sequence_manifest.json and train_sequences.pt to check the feature count.
   Both are absent, so it is replaced by a check that reads the channel count
   straight from normalized_*.nc and runs a wide-stride --all-windows smoke.

4. SPLIT YEARS. The trainer defaults to train 2010-2021, so without explicit
   --train-start-year the run would silently discard 29 of the 45 years.

5. LOSS WEIGHTS. scripts/linear_headroom_probe.py measured temperature as
   SATURATED in every region (ridge beats the best persistence/climatology
   blend by at most +0.004, one region -0.001, against a lead-1 blend already
   at +0.889..+0.983). Rainfall is the only target with real headroom
   (+0.027..+0.099 from a merely linear model). So the Indo-Gangetic
   notebook's --tmax-weight 2.0 was optimising the one variable that cannot
   improve; every region now prioritises rainfall instead.

6. rain_heavy_alpha -> 0.0. R2 is an UNWEIGHTED squared-error score, so a
   heavy-rain emphasis term optimises a different objective than the reported
   metric. Since the measured blend floor (R2_rain +0.191..+0.263) already
   meets this project's stated target, the model has to beat it on R2 itself,
   so the objective is aligned exactly with the metric. A follow-up run with
   alpha 3.0 would trade R2 for extreme-event detection (POD/FAR/CSI/HSS) --
   worth doing second, not first.

7. STRIDES AND EPOCHS. 1981-2021 is 14,975 days vs 4,383 for 2010-2021, i.e.
   ~3.4x more windows per epoch at the same stride. Left at stride 3 a Kaggle
   session would not finish. Strides are widened per region, scaled by node
   count so each region gets comparable wall-clock:
       western_ghats   1311 nodes -> stride 5
       north_east      1209 nodes -> stride 5
       central_india   1505 nodes -> stride 6
       indo_gangetic   2205 nodes -> stride 8

Usage:
    python scripts/patch_notebooks_1981.py            # patch all four
    python scripts/patch_notebooks_1981.py --dry-run
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

NB_DIR = Path("notebooks")

# region -> (notebook filename, kaggle slug, train stride, eval stride, rain weight)
REGIONS = {
    "western_ghats": ("vayu_kaggle_training.ipynb",
                      "vayu-western-ghats-1981-2025", 5, 5, "2.5"),
    "north_east_india": ("vayu_kaggle_training_north_east_india.ipynb",
                         "vayu-north-east-india-1981-2025", 5, 5, "2.5"),
    "indo_gangetic_plain": ("vayu_kaggle_training_indo_gangetic_plain.ipynb",
                            "vayu-indo-gangetic-plain-1981-2025", 8, 8, "2.5"),
    "central_india": ("vayu_kaggle_training_central_india.ipynb",
                      "vayu-central-india-1981-2025", 6, 6, "2.5"),
}

# Measured floors from scripts/skill_ceiling_probe.py on the 1981-2025 data
# (train 1981-2021, val 2022, leads 1-7 pooled). The model must BEAT these.
FLOORS = {
    "western_ghats": (0.235, 0.807, 0.818),
    "north_east_india": (0.201, 0.753, 0.959),
    "indo_gangetic_plain": (0.191, 0.893, 0.944),
    "central_india": (0.263, 0.879, 0.905),
}

EPOCHS = "25"


def staging_cell(region: str) -> str:
    return f'''# -- Stage bundle files (resilient to multi-folder Kaggle datasets) --------
# Files are located individually rather than from one DATASET_DIR, because a
# bundle can be split across sibling folders (...-1-001 / ...-1-002). Copying
# from a single folder silently skipped files in earlier runs.
#
# NOTE the 1981-2025 bundles intentionally contain NO sequence_manifest.json
# and NO *_sequences.pt. Windows are sliced lazily from normalized_1981-2025.nc
# via --all-windows, so the pre-built tensors are dead weight. Requiring
# sequence_manifest.json here (as the 2010-2025 notebooks did) aborts the run
# before training with "Missing required files".
import shutil
from pathlib import Path as _P

_ROOT = _P('/kaggle/input')

REQUIRED_FILES = [
    NORM_PARAMS_FILE,
    NORMALIZED_FILE,
    'elevation.nc',
    'lsm.nc',
]
OPTIONAL_FILES = ['pipeline_log_1981-2025.json', 'static_raster_manifest.json']


def _locate(name):
    """Find `name` anywhere under /kaggle/input, preferring this region's bundle."""
    matches = sorted(_ROOT.rglob(name))
    if not matches:
        stem, dot, ext = name.rpartition('.')
        if dot:
            matches = sorted(_ROOT.rglob(f'{{stem}}-[0-9][0-9][0-9].{{ext}}'))
        if matches:
            print(f'note: {{name}} not found; using suffixed variant {{matches[0].name}}')
    if not matches:
        return None
    preferred = [m for m in matches if '{region}' in str(m).replace('-', '_')]
    return (preferred or matches)[0]


_missing = []
for _f in REQUIRED_FILES + OPTIONAL_FILES:
    _src = _locate(_f)
    if _src is None:
        if _f in REQUIRED_FILES:
            _missing.append(_f)
        else:
            print(f'optional, not found: {{_f}}')
        continue
    shutil.copy(_src, _P(PROCESSED_DIR) / _f)
    print(f'staged {{_f:32s}} <- {{_src.parent.name}}/{{_src.name}}')

if _missing:
    raise RuntimeError(
        'Missing required files: ' + ', '.join(_missing) +
        '. Attach the complete {region} 1981-2025 dataset via "Add Input".'
    )

os.system(f'ls -lah {{PROCESSED_DIR}}')
'''


def smoke_cell(region: str) -> str:
    return f'''# -- Smoke check: verify model and data before full training ---------------
# Rewritten for the 1981-2025 bundles. The old check loaded
# sequence_manifest.json and train_sequences.pt to read the feature count;
# neither exists any more, so the channel count is read straight from the
# normalized dataset and the smoke run uses --all-windows at a wide stride.
import subprocess, sys
import xarray as _xr
PY = sys.executable

_ds = _xr.open_dataset(f'{{PROCESSED_DIR}}/{{NORMALIZED_FILE}}')
print('time steps :', _ds.sizes['time'])
print('grid       :', _ds.sizes['lat'], 'x', _ds.sizes['lon'])
print('data_vars  :', list(_ds.data_vars))
if _ds.sizes['time'] < 16000:
    raise RuntimeError(
        f"expected ~16436 daily steps for 1981-2025, got {{_ds.sizes['time']}} - "
        "stale dataset attached?"
    )
_ds.close()
print('OK: 1981-2025 normalized dataset present')

_r = subprocess.run([PY, '-m', 'ai_engine.trainer',
    '--data-dir',        PROCESSED_DIR,
    '--checkpoint-dir',  f'{{REPO_DIR}}/checkpoints/{{REGION}}_smoke',
    '--epochs',          '1',
    '--device',          'auto',
    '--smoke-only',
    '--normalized-file', f'{{PROCESSED_DIR}}/{{NORMALIZED_FILE}}',
    '--elevation-file',  f'{{PROCESSED_DIR}}/elevation.nc',
    '--lsm-file',        f'{{PROCESSED_DIR}}/lsm.nc',
    '--all-windows',
    '--train-start-year', '1981', '--train-end-year', '2021',
    '--val-start-year',   '2022', '--val-end-year',   '2022',
    '--test-start-year',  '2023', '--test-end-year',  '2025',
    '--train-stride',     '60',
    '--eval-stride',      '60'],
    cwd=REPO_DIR, capture_output=True, text=True)
print(_r.stdout[-3000:] if _r.stdout else '')
if _r.returncode != 0:
    print('\\n=== smoke STDERR ===')
    print(_r.stderr[-4000:] if _r.stderr else '(empty)')
    raise RuntimeError(f'Smoke check failed (exit {{_r.returncode}})')
print('\\nSmoke check PASSED - model + lazy windows + loss all wired correctly')
'''


def training_cell(region: str, train_stride: int, eval_stride: int,
                   rain_weight: str) -> str:
    rain_floor, tmax_floor, tmin_floor = FLOORS[region]
    return f'''# -- FINAL training run (1981-2025, 45 years) ------------------------------
# Measured floors for this region BEFORE training, from
# scripts/skill_ceiling_probe.py (best fixed persistence/climatology blend,
# leads 1-7 pooled, train 1981-2021 / val 2022):
#
#     R2_rain {rain_floor:+.3f}    R2_tmax {tmax_floor:+.3f}    R2_tmin {tmin_floor:+.3f}
#
# These are the numbers to BEAT. The blend alone already meets this project's
# nominal R2_rain >= 0.20 / R2_tmax >= 0.80 targets in most regions, so hitting
# those thresholds is not evidence of a working model - only a positive skill
# score over the blend is.
#
# --rain-weight {rain_weight}: rainfall is the ONLY target with measured headroom
# (linear_headroom_probe: rain +0.027..+0.099 vs temperature +/-0.004).
# --rain-heavy-alpha 0.0: plain weighted MSE, exactly aligned with the R2 being
# reported. A second run at alpha 3.0 would trade R2 for extreme-event scores.
# --train-stride {train_stride}: 1981-2021 is 14,975 days (3.4x the old 2010-2021 record),
# so stride 3 would not finish inside a Kaggle session.
import os, subprocess, sys
PY = sys.executable
os.environ['PYTORCH_CUDA_ALLOC_CONF'] = 'expandable_segments:True'

subprocess.run([PY, '-m', 'ai_engine.trainer',
    '--data-dir',               PROCESSED_DIR,
    '--checkpoint-dir',         CHECKPOINT_DIR,
    '--epochs',                 '{EPOCHS}',
    '--device',                 'auto',
    '--amp',
    '--batch-size',             '1',
    '--grad-accum-steps',       '8',
    '--cosine-lr',
    '--early-stopping-patience','8',
    '--weight-decay',           '1e-4',
    '--gnn-dropout',            '0.12',
    '--lambda-conservation',    '0.0',
    '--lambda-smoothness',      '0.0',
    '--rain-weight',            '{rain_weight}',
    '--rain-heavy-alpha',       '0.0',
    '--norm-params-file',       f'{{PROCESSED_DIR}}/{{NORM_PARAMS_FILE}}',
    '--normalized-file',        f'{{PROCESSED_DIR}}/{{NORMALIZED_FILE}}',
    '--elevation-file',         f'{{PROCESSED_DIR}}/elevation.nc',
    '--lsm-file',               f'{{PROCESSED_DIR}}/lsm.nc',
    '--all-windows',
    '--train-start-year',       '1981',
    '--train-end-year',         '2021',
    '--val-start-year',         '2022',
    '--val-end-year',           '2022',
    '--test-start-year',        '2023',
    '--test-end-year',          '2025',
    '--train-stride',           '{train_stride}',
    '--eval-stride',            '{eval_stride}',
    '--run-baselines',
    '--require-benchmarks'],
    check=True, cwd=REPO_DIR)

os.system(f'ls -lah {{CHECKPOINT_DIR}}')
'''


def results_cell(region: str) -> str:
    rain_floor, tmax_floor, tmin_floor = FLOORS[region]
    return f'''# -- Held-out test results (2023-2025, never seen in training/validation) --
# Read against the MEASURED blend floors, not against the nominal thresholds.
import json
from pathlib import Path

FLOORS = {{'rainfall': {rain_floor}, 'temp_max': {tmax_floor}, 'temp_min': {tmin_floor}}}

test_report_path = Path(CHECKPOINT_DIR) / 'test_report.json'
if not test_report_path.exists():
    print('No test_report.json - check the training cell output for errors.')
else:
    test_results = json.loads(test_report_path.read_text())
    print(f"{{'variable':10s}} {{'R2':>8s}} {{'floor':>8s}} {{'vs floor':>9s}} "
          f"{{'skill_clim':>11s}}  verdict")
    for var, metrics in test_results.items():
        if not isinstance(metrics, dict) or 'r2' not in metrics:
            continue
        floor = FLOORS.get(var)
        r2 = metrics['r2']
        sk = metrics.get('skill_vs_climatology', float('nan'))
        if floor is None:
            print(f'{{var:10s}} {{r2:>+8.3f}}')
            continue
        delta = r2 - floor
        verdict = 'BEATS blend' if delta > 0.005 else (
            'matches blend' if delta > -0.005 else 'BELOW blend')
        print(f'{{var:10s}} {{r2:>+8.3f}} {{floor:>+8.3f}} {{delta:>+9.3f}} '
              f'{{sk:>+11.3f}}  {{verdict}}')

    print()
    print('Per-lead / JJAS / extreme-event metrics are in the same report under')
    print('the verification block - read those for literature comparison')
    print('(Narula et al. arXiv:2402.07851 report per-lead JJAS relative error,')
    print('not pooled all-year R2).')
'''


def header_cell(region: str, slug: str, train_stride: int, rain_weight: str) -> str:
    rain_floor, tmax_floor, tmin_floor = FLOORS[region]
    pretty = region.replace('_', ' ').title()
    return f'''# VAYU Climate Digital Twin - Kaggle GPU Training ({pretty}) **1981-2025**

**Accelerator**: GPU T4 x2 (recommended) or T4 x1 / P100
**Dataset to attach**: `shyam31415/{slug}`

## What changed from the 2010-2025 runs

**45 years instead of 16.** IMD rainfall/tmax/tmin now span 1981-2025, and every
auxiliary source was extended to match, so training windows go from ~4,350 to
~14,900 (stride 1).

**All 17 input channels are populated for the first time.** Previously
`insat_lst`, `insat_sst` and `chirps_rain` were constant zero in every region,
and `uwnd_850`/`vwnd_850`/`shum_850` were additionally dead in Indo-Gangetic
Plain and Central India - meaning those two regions had no moisture or
circulation predictor at all. Now:

| channel | source | note |
|---|---|---|
| `insat_lst` | ERA5-Land skin temperature | **substitute** for INSAT-3D LST (MOSDAC never approved) |
| `insat_sst` | NOAA OISST v2.1 | **substitute** for INSAT-3D SST (MOSDAC never approved) |
| `uwnd_850`, `vwnd_850`, `shum_850` | NCEP/NCAR R1, India subset | server-side subset, 1981-2025 |
| `chirps_rain` | CHIRPS v2.0 | auxiliary predictor; IMD stays the target |

`shum_850` is the strongest non-climatology predictor of next-day rainfall in
every region - it was the dead channel that mattered most.

## Measured baselines BEFORE training (the numbers to beat)

Best fixed persistence/climatology blend, leads 1-7 pooled, train 1981-2021 /
val 2022 (`scripts/skill_ceiling_probe.py`):

| | R2_rain | R2_tmax | R2_tmin |
|---|---|---|---|
| **{pretty}** | **{rain_floor:+.3f}** | **{tmax_floor:+.3f}** | **{tmin_floor:+.3f}** |

**Read this carefully:** the untrained blend already clears the nominal
R2_rain >= 0.20 / R2_tmax >= 0.80 targets in most regions. Hitting those
thresholds therefore proves nothing - a day-of-year lookup table plus
yesterday's observation gets there. Success is a **positive skill score over
the blend**.

`scripts/linear_headroom_probe.py` additionally measured, at lead-1, that
**temperature is saturated** (a ridge regression on all live channels beats the
blend by at most +0.004, and by -0.001 in one region) while **rainfall has real
headroom** (+0.027 to +0.099). This run therefore prioritises rainfall
(`--rain-weight {rain_weight}`) and treats "do not regress below the temperature
blend" as the temperature goal.

## Literature context
- Narula et al., [arXiv:2402.07851](https://arxiv.org/abs/2402.07851) (NeurIPS 2025 CCAI): Autoformers on IMD 0.25 deg 1901-2023 beat ECMWF HRES by ~22% lower error at 1 day, ~27% at 3 days. They report **per-lead JJAS relative error vs NWP**, not pooled all-year R2.
- Ghosh et al., [arXiv:2607.26581](https://arxiv.org/abs/2607.26581) (Jul 2026): across ten methods on daily Indian rainfall grids, ConvLSTM did **not** consistently beat simpler baselines, and **persistence had the best high-rainfall detection in all four cities tested**. Beating persistence here is a real result, not a low bar.
- IMD 0.25 deg rainfall dataset: cite **Pai et al. (2014), MAUSAM 65(1), pp. 1-18**.

## Steps
1. Settings -> Accelerator -> **GPU T4 x2**
2. Add Input -> `shyam31415/{slug}`
3. Run all cells top to bottom

Train stride is {train_stride} for this region (scaled by node count so the session
finishes); 1981-2021 is 14,975 days, so the old stride 3 would not complete.
'''


def patch(region: str, dry_run: bool) -> bool:
    nb_name, slug, tr_stride, ev_stride, rain_w = REGIONS[region]
    path = NB_DIR / nb_name
    if not path.exists():
        print(f"  MISSING notebook: {path}")
        return False

    nb = json.loads(path.read_text(encoding="utf-8"))
    cells = nb["cells"]

    def set_source(idx: int, text: str) -> None:
        lines = text.splitlines(keepends=True)
        cells[idx]["source"] = lines
        if cells[idx]["cell_type"] == "code":
            cells[idx]["outputs"] = []
            cells[idx]["execution_count"] = None

    # Locate cells by content rather than fixed index, since the four
    # notebooks have slightly different markdown counts.
    idx_mount = idx_stage = idx_smoke = idx_train = idx_results = None
    for i, c in enumerate(cells):
        src = "".join(c["source"])
        if c["cell_type"] != "code":
            continue
        if "REGION = " in src and "REPO_DIR" in src:
            idx_mount = i
        elif "REQUIRED_FILES" in src:
            idx_stage = i
        elif "--smoke-only" in src:
            idx_smoke = i
        elif "--all-windows" in src and "--run-baselines" in src:
            idx_train = i
        elif "test_report.json" in src:
            idx_results = i

    for label, idx in (("mount", idx_mount), ("stage", idx_stage),
                        ("smoke", idx_smoke), ("train", idx_train),
                        ("results", idx_results)):
        if idx is None:
            print(f"  could not locate {label} cell in {nb_name}")
            return False

    # Mount cell: inject the 1981-2025 filenames so every later cell shares them.
    mount_src = "".join(cells[idx_mount]["source"])
    if "NORMALIZED_FILE" not in mount_src:
        mount_src = mount_src.replace(
            "print('Working dir:', os.getcwd())",
            "print('Working dir:', os.getcwd())\n\n"
            "# Filenames for the 1981-2025 rebuild (the 2010-2025 names are gone).\n"
            "NORMALIZED_FILE = 'normalized_1981-2025.nc'\n"
            "NORM_PARAMS_FILE = 'norm_params_1981-2025.nc'",
            1,
        )
    mount_src = mount_src.replace("2010-2025", "1981-2025")
    set_source(idx_mount, mount_src)

    set_source(idx_stage, staging_cell(region))
    set_source(idx_smoke, smoke_cell(region))
    set_source(idx_train, training_cell(region, tr_stride, ev_stride, rain_w))
    set_source(idx_results, results_cell(region))

    # Replace the first markdown cell with an accurate header; drop any other
    # leading markdown cells that describe the superseded 2010-2025 setup.
    first_md = next((i for i, c in enumerate(cells)
                     if c["cell_type"] == "markdown"), None)
    if first_md is not None:
        set_source(first_md, header_cell(region, slug, tr_stride, rain_w))
        stale = [i for i, c in enumerate(cells)
                 if c["cell_type"] == "markdown" and i != first_md
                 and i < min(idx_mount, idx_stage)]
        for i in reversed(stale):
            del cells[i]

    if dry_run:
        print(f"  [dry-run] would patch {nb_name} "
              f"(slug={slug}, stride={tr_stride}, rain_weight={rain_w})")
        return True

    path.write_text(json.dumps(nb, indent=1, ensure_ascii=False) + "\n",
                     encoding="utf-8")
    print(f"  patched {nb_name}  slug={slug} stride={tr_stride} rain_weight={rain_w}")
    return True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--regions", nargs="*", default=list(REGIONS))
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    ok = True
    for region in args.regions:
        if region not in REGIONS:
            print(f"unknown region: {region}")
            return 1
        print(f"=== {region} ===")
        ok &= patch(region, args.dry_run)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
