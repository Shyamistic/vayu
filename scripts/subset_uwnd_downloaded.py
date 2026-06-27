"""Subset downloaded NCEP uwnd full files to 850 hPa + Western Ghats region.
Place downloaded uwnd.YYYY.nc files in data/ncep_raw_download/ then run this script.
Replaces the zero-filled placeholders in data/ncep_wind_subset/.
"""
import xarray as xr
import numpy as np
from pathlib import Path

RAW_DIR = Path("data/ncep_raw_download")
OUT_DIR = Path("data/ncep_wind_subset")

# Western Ghats bounds (include slight margin for interpolation)
LAT_SLICE = slice(25.0, 5.0)   # descending → high to low
LON_SLICE = slice(70.0, 80.0)

YEARS = [2016, 2017, 2018, 2019, 2020]

for year in YEARS:
    src = RAW_DIR / f"uwnd.{year}.nc"
    if not src.exists():
        print(f"SKIP {src.name} — not downloaded yet")
        continue

    out = OUT_DIR / f"uwnd_{year}_850hPa_WG.nc"
    print(f"Processing {src.name} ...", flush=True)
    ds = xr.open_dataset(src)

    # Select 850 hPa
    if "level" in ds.dims:
        ds = ds.sel(level=850, method="nearest")

    # Subset to WG region (lat descending in NCEP)
    sub = ds.sel(lat=LAT_SLICE, lon=LON_SLICE).load()

    # Overwrite the zero-filled placeholder
    sub.to_netcdf(out)
    size_kb = out.stat().st_size // 1024
    print(f"  Saved {out.name} ({size_kb} KB, lat={list(sub.lat.values)}, time={len(sub.time)})")

print("\nDone. Verify:")
for year in YEARS:
    f = OUT_DIR / f"uwnd_{year}_850hPa_WG.nc"
    if f.exists():
        ds = xr.open_dataset(f)
        hits = [v for v in ds.data_vars if "uwnd" in v.lower()]
        is_zero = hits and float(ds[hits[0]].mean()) == 0.0
        print(f"  {f.name}: vars={hits} time={len(ds.time)} {'[ZERO-FILLED]' if is_zero else '[REAL DATA]'}")
