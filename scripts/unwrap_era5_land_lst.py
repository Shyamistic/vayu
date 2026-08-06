"""Unwrap the CDS ERA5-Land LST archives and report what is inside.

The files arrived named ``era5_land_lst_india_YYYY.nc`` but their magic bytes
are ``PK\\x03\\x04`` -- they are ZIP archives, each containing a single
``data_0.nc``. This is standard CDS behaviour: a request with
``data_format: netcdf`` is still delivered zipped. xarray cannot open them
directly, so they are extracted in place to ``<year>.nc``.

Safe to re-run: already-extracted years are skipped.
"""
from __future__ import annotations

import io
import sys
import zipfile
from pathlib import Path

import numpy as np
import xarray as xr

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

SRC = Path("D:/vayu_data/lst_india")
DST = Path("D:/vayu_data/lst_india_nc")


def main() -> int:
    DST.mkdir(parents=True, exist_ok=True)
    archives = sorted(SRC.glob("era5_land_lst_india_*.nc"))
    print(f"found {len(archives)} archives in {SRC}")

    written = 0
    for a in archives:
        year = a.stem.split("_")[-1]
        out = DST / f"era5_land_lst_india_{year}.nc"
        if out.exists() and out.stat().st_size > 1_000_000:
            continue
        with zipfile.ZipFile(a) as zf:
            names = [n for n in zf.namelist() if n.endswith(".nc")]
            if len(names) != 1:
                print(f"  {a.name}: expected 1 .nc, found {names}")
                continue
            with zf.open(names[0]) as src, open(out, "wb") as dst:
                while chunk := src.read(1 << 20):
                    dst.write(chunk)
        written += 1
        print(f"  unwrapped {year} -> {out.name} "
              f"({out.stat().st_size/1e6:.0f} MB)", flush=True)

    print(f"\nunwrapped={written}  total={len(list(DST.glob('*.nc')))}")

    # Inspect one year in detail: the model needs DAILY fields, so temporal
    # resolution is the thing that decides whether this is usable as-is.
    sample = sorted(DST.glob("*.nc"))[0]
    print(f"\n--- {sample.name} ---")
    with xr.open_dataset(sample) as ds:
        print(f"dims       = {dict(ds.sizes)}")
        print(f"data_vars  = {list(ds.data_vars)}")
        print(f"coords     = {list(ds.coords)}")
        tname = next((c for c in ("valid_time", "time") if c in ds.coords), None)
        if tname:
            t = ds[tname].values
            print(f"{tname}: n={len(t)}  {str(t[0])[:19]} .. {str(t[-1])[:19]}")
            if len(t) > 1:
                step_h = (t[1] - t[0]) / np.timedelta64(1, "h")
                kind = "DAILY" if 23 <= step_h <= 25 else (
                    "HOURLY" if step_h <= 1.01 else f"{step_h:.0f}-hourly")
                print(f"step       = {step_h:.0f} h  -> {kind}")
        for c in ("latitude", "lat", "longitude", "lon"):
            if c in ds.coords:
                v = ds[c].values
                print(f"{c}: n={v.size}  {float(v.min()):.2f}..{float(v.max()):.2f}")
        for name in ds.data_vars:
            a = ds[name]
            unit = a.attrs.get("units", "?")
            long = a.attrs.get("long_name", "")
            # Sample a slice rather than loading a full year into memory.
            sl = a.isel({d: slice(0, 3) for d in a.dims if d in (tname,)}) \
                if tname in a.dims else a
            vals = np.asarray(sl.values, dtype="float64")
            fin = vals[np.isfinite(vals)]
            if fin.size:
                print(f"{name}: {fin.min():.2f}..{fin.max():.2f} [{unit}] "
                      f"mean={fin.mean():.2f}  ({long})")
            nan_frac = float(np.isnan(vals).mean())
            print(f"  NaN fraction in sample = {nan_frac:.1%} "
                  f"(ERA5-Land is land-only, so ocean is NaN)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
