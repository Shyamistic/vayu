"""Verify the LST and SST datasets that arrived from Google Drive.

Three things need confirming before any of this can feed the insat_lst /
insat_sst channels:

1. OISST: is the daily record complete for 1981-09-01..2025-12-31, and does
   the "_india" filename suffix still match the glob that
   preprocessor._load_oisst_sst() already uses?
2. ERA5-Land LST: what is the variable name, the temporal resolution (the
   model needs DAILY fields), and the units?
3. India_MODIS_LST_Mean_2000_2025.tif: the filename says "Mean", which would
   make it a single time-averaged composite rather than a time series. If so
   it cannot fill the 2000-2025 daily LST gap.
"""
from __future__ import annotations

import datetime as dt
import glob as _glob
import io
import sys
from pathlib import Path

import numpy as np
import xarray as xr

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path("D:/vayu_data")
RECORD_START = dt.date(1981, 9, 1)
RECORD_END = dt.date(2025, 12, 31)


def section(t: str) -> None:
    print("\n" + "=" * 68)
    print(t)
    print("=" * 68)


# ---------------------------------------------------------------- OISST
section("1. OISST daily (India-subsetted)")
oisst = ROOT / "oisst_sst_india"
files = sorted(oisst.glob("*.nc"))
expected = (RECORD_END - RECORD_START).days + 1
print(f"files on disk : {len(files)}")
print(f"expected days : {expected}  ({RECORD_START} .. {RECORD_END})")

have = set()
for f in files:
    # oisst-avhrr-v02r01.YYYYMMDD_india.nc
    stamp = f.name.split(".")[1].split("_")[0]
    have.add(stamp)
missing = []
d = RECORD_START
while d <= RECORD_END:
    if d.strftime("%Y%m%d") not in have:
        missing.append(d.isoformat())
    d += dt.timedelta(days=1)
print(f"missing days  : {len(missing)}")
if missing:
    print(f"  first few: {missing[:10]}")

# Does the loader's existing glob still find these?
pat = str(oisst / "oisst-avhrr-v02r01.1995*.nc")
n_1995 = len(_glob.glob(pat))
print(f"loader glob for 1995 matches {n_1995} files "
      f"({'OK' if n_1995 >= 365 else 'PROBLEM'})")

with xr.open_dataset(files[len(files) // 2]) as ds:
    print(f"sample        : {files[len(files)//2].name}")
    print(f"  dims={dict(ds.sizes)}  vars={list(ds.data_vars)}")
    sst = ds["sst"]
    if "zlev" in sst.dims:
        sst = sst.isel(zlev=0, drop=True)
    lat, lon = ds["lat"].values, ds["lon"].values
    print(f"  lat {lat.min():.2f}..{lat.max():.2f}   "
          f"lon {lon.min():.2f}..{lon.max():.2f}")
    v = sst.values
    print(f"  sst {np.nanmin(v):.2f}..{np.nanmax(v):.2f} degC  "
          f"nan={int(np.isnan(v).sum())}/{v.size} (NaN = land, expected)")

# ------------------------------------------------------- ERA5-Land LST
section("2. ERA5-Land LST 1981-1999")
lst = sorted((ROOT / "lst_india").glob("*.nc"))
print(f"files: {len(lst)}  ({lst[0].name} .. {lst[-1].name})")
with xr.open_dataset(lst[0]) as ds:
    print(f"  dims={dict(ds.sizes)}")
    print(f"  data_vars={list(ds.data_vars)}")
    print(f"  coords={list(ds.coords)}")
    tname = "time" if "time" in ds.coords else (
        "valid_time" if "valid_time" in ds.coords else None)
    if tname:
        t = ds[tname].values
        print(f"  {tname}: n={len(t)}  {str(t[0])[:19]} .. {str(t[-1])[:19]}")
        if len(t) > 1:
            step_h = (t[1] - t[0]) / np.timedelta64(1, "h")
            print(f"  step = {step_h:.0f} h  -> "
                  f"{'DAILY' if 23 <= step_h <= 25 else 'NOT daily'}")
    for name in ds.data_vars:
        a = ds[name]
        vals = np.asarray(a.values, dtype="float64")
        finite = vals[np.isfinite(vals)]
        if finite.size:
            unit = ds[name].attrs.get("units", "?")
            print(f"  {name}: {finite.min():.2f}..{finite.max():.2f} [{unit}]  "
                  f"mean={finite.mean():.2f}")
    for c in ("latitude", "lat", "longitude", "lon"):
        if c in ds.coords:
            v = ds[c].values
            print(f"  {c}: n={v.size}  {v.min():.2f}..{v.max():.2f}")

# ------------------------------------------------------- MODIS mean TIF
section("3. India_MODIS_LST_Mean_2000_2025.tif")
tif = next((ROOT / "lst_static").glob("*.tif"), None)
if tif is None:
    print("  NOT FOUND")
else:
    try:
        import rasterio
        with rasterio.open(tif) as src:
            print(f"  size={src.width}x{src.height}  bands={src.count}")
            print(f"  crs={src.crs}  dtype={src.dtypes[0]}")
            b = src.bounds
            print(f"  bounds lon {b.left:.2f}..{b.right:.2f}  "
                  f"lat {b.bottom:.2f}..{b.top:.2f}")
            print(f"  res={src.res}")
            arr = src.read(1, out_shape=(1, min(512, src.height),
                                         min(512, src.width)))
            arr = arr.astype("float64")
            nod = src.nodata
            if nod is not None:
                arr = arr[arr != nod]
            arr = arr[np.isfinite(arr)]
            if arr.size:
                print(f"  values {arr.min():.2f}..{arr.max():.2f}  "
                      f"mean={arr.mean():.2f}")
            print(f"\n  -> {src.count} band(s): this is a "
                  f"{'SINGLE time-averaged composite' if src.count == 1 else 'multi-band stack'}"
                  f", NOT a daily time series.")
    except ImportError:
        print("  rasterio not installed; skipping raster inspection")

print("\nVERIFY_DONE")
