# GPM IMERG preprocessing — steps for [teammate]

You already have the raw GPM IMERG rainfall archive (~158 GB). We don't need
the whole thing in Kaggle — we need it clipped down to 5 small regional
files. This doc walks through doing that with the script already in this
repo: `data/preprocess_gpm_imerg.py`.

You can absolutely paste this whole file into an AI assistant (Claude/ChatGPT/Kiro)
and ask it to walk you through the steps live if anything below doesn't match
what you see on your machine — that's expected, environments differ.

## What this produces

5 small NetCDF files (one per region) + a matching JSON sidecar each:

| Output file | Region | Bounds (lat, lon) |
|---|---|---|
| `gpm_imerg_western_ghats_daily.nc` | Western Ghats | 7.5–21.5°N, 72–77.5°E |
| `gpm_imerg_north_east_india_daily.nc` | North-East India | 22–29.5°N, 88–97.5°E |
| `gpm_imerg_indo_gangetic_plain_daily.nc` | Indo-Gangetic Plain | 23–31.5°N, 74–89.5°E |
| `gpm_imerg_central_india_daily.nc` | Central India | 17–25.5°N, 74–84.5°E |
| `gpm_imerg_pilot_daily.nc` | Pilot (ML training box) | 8–20°N, 72–78°E |
| `gpm_imerg_full_india_daily.nc` | All-India overview | 6–38°N, 66–100°E |

These bounds are copied directly from `ai_engine/regions.py` — they are the
exact same numbers the model and frontend use everywhere else, so nothing
will silently mismatch later.

**Important — what this data is for:** GPM IMERG is a validation/comparison
dataset, not one of the model's 17 training input features. It gives us a
third independent rainfall estimate (alongside IMD and CHIRPS) so we can
report a real multi-source rainfall verification comparison. Don't worry
about matching model training conventions exactly — the goal is a clean,
correctly-clipped, correctly-dated NetCDF per region.

## Step 1 — Confirm what your raw files look like

Open the folder where the 158 GB of IMERG data is and check a few filenames.
They should look like:

```
3B-DAY.MS.MRG.3IMERG.20230615-S000000-E235959.V07B.nc4
```

(`.nc4` daily files — "3B-DAY" means daily Final Run product). If your files
instead look like `3B-HHR...` (half-hourly) or end in `.HDF5`, tell us before
continuing — the script assumes daily files. If you only have half-hourly
files, that's fine too, just flag it and we'll adjust the script to do the
daily aggregation step instead of assuming it's already done.

## Step 2 — Set up Python

If you don't already have a Python environment for this:

```powershell
python -m venv gpm_env
gpm_env\Scripts\activate
pip install xarray netCDF4 h5netcdf numpy
```

(On Kaggle you can skip this — Kaggle notebooks already have all of these
installed. See "Option B" below if you'd rather run this directly on Kaggle
instead of your own machine.)

## Step 3 — Run the script

From the repo root (or copy `data/preprocess_gpm_imerg.py` anywhere convenient
— it has no other dependency on the rest of the repo):

```powershell
python data/preprocess_gpm_imerg.py --input-dir "D:\path\to\your\gpm_imerg_raw" --output-dir "./gpm_imerg_processed"
```

Replace `D:\path\to\your\gpm_imerg_raw` with wherever your raw files actually
are. This will:

1. Scan every `.nc4`/`.nc`/`.hdf5`/`.h5` file in that folder (and subfolders).
2. Read the rainfall variable from each (it auto-detects the variable name —
   IMERG sometimes calls it `precipitationCal`, sometimes `precipitation`).
3. Clip each file down to the 6 region boxes above.
4. Combine all days into one file per region, sorted and deduplicated by date.
5. Write the 6 output `.nc` files plus their `.json` provenance sidecars into
   `--output-dir`.

**This will print progress every 200 files.** With 158 GB of daily files this
will likely take a while (reading + clipping + writing) — let it run. It's
safe to stop and re-run: it skips any region file that already exists in the
output directory (delete a specific one if you need to regenerate it after
adding more raw files).

If it errors on a specific file, it prints the error and **keeps going** —
check the printed log at the end for any `ERROR reading ...` or `SKIP ...`
lines and send those to us.

## Step 4 — Sanity-check the output

After it finishes, you should have something like:

```
gpm_imerg_processed/
  gpm_imerg_western_ghats_daily.nc
  gpm_imerg_western_ghats_daily.json
  gpm_imerg_north_east_india_daily.nc
  gpm_imerg_north_east_india_daily.json
  gpm_imerg_indo_gangetic_plain_daily.nc
  gpm_imerg_indo_gangetic_plain_daily.json
  gpm_imerg_central_india_daily.nc
  gpm_imerg_central_india_daily.json
  gpm_imerg_pilot_daily.nc
  gpm_imerg_pilot_daily.json
  gpm_imerg_full_india_daily.nc
  gpm_imerg_full_india_daily.json
```

Open one `.json` sidecar (any text editor) and check it looks sane, e.g.:

```json
{
  "region": "western_ghats",
  "bounds": {"lat_min": 7.5, "lat_max": 21.5, "lon_min": 72.0, "lon_max": 77.5},
  "variable": "rainfall",
  "units": "mm/day",
  "time_range": {"start": "2010-01-01", "end": "2025-12-31"},
  "day_count": 5843,
  "grid_shape": {"lat": 140, "lon": 55}
}
```

Send us the `.json` sidecars (they're tiny — just paste the contents in
Slack/Discord/whatever) so we can validate coverage and date range before
you upload anything to Kaggle.

## Step 5 — Upload to Kaggle

1. Go to https://www.kaggle.com/ → your profile → "Datasets" → "New Dataset".
2. Drag in the **entire `gpm_imerg_processed/` folder contents** (all 6 `.nc`
   files + all 6 `.json` sidecars) as one dataset. Suggested dataset title:
   `gpm-imerg-india-regional-rainfall`.
3. Set visibility to **Private** (not Public) unless told otherwise.
4. Once uploaded, share the Kaggle dataset link/slug with us — we'll attach it
   in the training notebook the same way the other regional datasets are
   attached.

## Option B — running the whole thing on Kaggle instead

If moving 158 GB off your machine is painful, you can run this same script in
a Kaggle notebook instead:

1. Upload the raw IMERG archive to a private Kaggle dataset first (Kaggle
   allows large uploads via their CLI: `pip install kaggle`, then
   `kaggle datasets create -p <folder> -r zip` — the same 20 GB/dataset limit
   applies as usual, so you may need to split the raw upload into a few
   dataset parts if it's bigger than that per-file).
2. In a new Kaggle notebook, add that raw dataset as input, then copy the
   contents of `data/preprocess_gpm_imerg.py` into a notebook cell and run:
   ```python
   !python preprocess_gpm_imerg.py --input-dir /kaggle/input/<your-raw-dataset> --output-dir /kaggle/working/gpm_imerg_processed
   ```
3. Once it finishes, use "Save Version" → "New Dataset" from the notebook's
   output to publish `gpm_imerg_processed/` as its own dataset directly from
   Kaggle, no re-download needed.

Feel free to ask an AI assistant to help adapt these exact commands to
whatever you see on screen — the script itself doesn't need to change.

## Questions to answer before you start (so we don't redo this)

- Are your raw files daily (`3B-DAY...`) or half-hourly (`3B-HHR...`)? Tell us
  if it's the latter.
- What version tag do the filenames show (`V06B`, `V07A`, `V07B`, etc.)? Just
  read it off one filename.
- What's the full date range you actually have (check the earliest and latest
  filename dates)?
