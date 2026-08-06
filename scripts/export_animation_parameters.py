#!/usr/bin/env python3
"""Export the real, measured parameter space of every processed bundle.

Purpose: give the frontend/animation work a single authoritative source for what
data exists, in what units, over what range, so colour scales, particle speeds and
legends are derived from measurements rather than guessed.

Why this script is necessary rather than reading the NetCDF directly:

1. `rainfall`, `tmax`, `tmin` and `chirps_rain` are stored **z-scored per cell**
   against `norm_params_*.nc`. Their raw min/max are standard deviations, not
   mm/day or degrees C. A colour ramp built on the stored values is meaningless.
   This script denormalizes (value * std + mean) before reporting.
2. The reanalysis channels (`uwnd_850`, `vwnd_850`, `shum_850`, `insat_sst`,
   `insat_lst`) are merged AFTER normalization and are already physical.
   Treating both groups the same way is the mistake to avoid.
3. Rainfall is extremely right-skewed, so max is a poor scale ceiling — one cell
   on one day sets it. Percentiles are reported so the ramp can be built on p99
   with an explicit overflow bucket.

Percentiles come from every Nth day (default 5) to bound memory; min/max are exact
over the full record. The subsample stride is recorded in the output.

Usage:
    python scripts/export_animation_parameters.py
    python scripts/export_animation_parameters.py --regions full_india --stride 10
"""

from __future__ import annotations

import argparse
import glob
import json
from pathlib import Path

import numpy as np
import xarray as xr

#: region -> processed directory. Mirrors build_kaggle_bundles_1981.REGION_DIRS.
REGION_DIRS = {
    "western_ghats": "D:/vayu_data/processed_western_ghats_1981",
    "north_east_india": "D:/vayu_data/processed_north_east_india_1981",
    "indo_gangetic_plain": "D:/vayu_data/processed_indo_gangetic_plain_1981",
    "central_india": "D:/vayu_data/processed_central_india_1981",
    "full_india": "D:/vayu_data/processed_full_india_05",
}

#: Channels stored z-scored -> the norm_params variable prefix used to invert it.
Z_SCORED = {
    "rainfall": "rainfall",
    "tmax": "tmax",
    "tmin": "tmin",
    "chirps_rain": "chirps_rain",
}

#: Physical units for every channel, and what the value actually represents.
UNITS = {
    "rainfall": ("mm/day", "IMD gauge-interpolated daily rainfall (the model target)"),
    "tmax": ("degC", "IMD daily maximum 2 m air temperature (model target)"),
    "tmin": ("degC", "IMD daily minimum 2 m air temperature (model target)"),
    "chirps_rain": ("mm/day", "CHIRPS v2.0 satellite-gauge rainfall (auxiliary input)"),
    "uwnd_850": ("m/s", "NCEP/NCAR R1 850 hPa zonal wind, +ve eastward"),
    "vwnd_850": ("m/s", "NCEP/NCAR R1 850 hPa meridional wind, +ve northward"),
    "shum_850": ("kg/kg", "NCEP/NCAR R1 850 hPa specific humidity"),
    "insat_sst": ("degC", "NOAA OISST v2.1 sea-surface temperature (SUBSTITUTE for INSAT-3D SST)"),
    "insat_lst": ("degC", "ERA5-Land daily-MEAN skin temperature (SUBSTITUTE for INSAT-3D LST)"),
}

#: Flag channels: 1 = the source had data for that cell/day, 0 = it did not.
FLAG_SUFFIXES = ("_available", "_qc_flag")

PERCENTILES = [1, 5, 25, 50, 75, 90, 95, 99, 99.9]


def _find(directory: str, pattern: str) -> str | None:
    matches = sorted(glob.glob(f"{directory}/{pattern}"))
    return matches[-1] if matches else None


def _stats(values: np.ndarray, sample: np.ndarray) -> dict:
    finite = np.isfinite(values)
    if not finite.any():
        return {"all_nan": True}
    v = values[finite]
    s = sample[np.isfinite(sample)]
    out = {
        "min": round(float(v.min()), 4),
        "max": round(float(v.max()), 4),
        "mean": round(float(v.mean()), 4),
        "std": round(float(v.std()), 4),
        "nan_fraction": round(float(1.0 - finite.mean()), 4),
    }
    if s.size:
        pcts = np.percentile(s, PERCENTILES)
        out["percentiles"] = {f"p{p}": round(float(x), 4) for p, x in zip(PERCENTILES, pcts)}
    return out


def profile_region(region: str, directory: str, stride: int) -> dict:
    normalized = _find(directory, "normalized_*.nc")
    if normalized is None:
        return {"error": f"no normalized_*.nc in {directory}"}
    norm_params_path = _find(directory, "norm_params_*.nc")

    result: dict = {
        "region": region,
        "normalized_file": normalized,
        "percentile_subsample_stride_days": stride,
        "channels": {},
    }

    norm = xr.open_dataset(norm_params_path) if norm_params_path else None

    with xr.open_dataset(normalized) as ds:
        lat = np.asarray(ds["lat"].values, dtype=float)
        lon = np.asarray(ds["lon"].values, dtype=float)
        time = ds["time"].values
        res_lat = float(np.diff(lat)[0]) if lat.size > 1 else None
        res_lon = float(np.diff(lon)[0]) if lon.size > 1 else None

        result["grid"] = {
            "n_lat": int(lat.size), "n_lon": int(lon.size),
            "n_cells": int(lat.size * lon.size),
            "lat_min": round(float(lat.min()), 4), "lat_max": round(float(lat.max()), 4),
            "lon_min": round(float(lon.min()), 4), "lon_max": round(float(lon.max()), 4),
            "resolution_deg_lat": res_lat, "resolution_deg_lon": res_lon,
            # Cell edges matter for rendering a grid as quads rather than points.
            "cell_edge_south": round(float(lat.min()) - (res_lat or 0) / 2, 4),
            "cell_edge_north": round(float(lat.max()) + (res_lat or 0) / 2, 4),
            "cell_edge_west": round(float(lon.min()) - (res_lon or 0) / 2, 4),
            "cell_edge_east": round(float(lon.max()) + (res_lon or 0) / 2, 4),
        }
        result["time"] = {
            "start": str(np.datetime_as_string(time[0], unit="D")),
            "end": str(np.datetime_as_string(time[-1], unit="D")),
            "n_steps": int(time.size),
            "cadence": "daily",
        }

        uwnd = vwnd = None
        for name in ds.data_vars:
            if "time" not in ds[name].dims:
                continue
            arr = np.asarray(ds[name].values, dtype=np.float32)

            if name.endswith(FLAG_SUFFIXES):
                uniq = np.unique(arr[np.isfinite(arr)])
                result["channels"][name] = {
                    "kind": "flag",
                    "units": "boolean" if set(uniq.tolist()) <= {0.0, 1.0} else "code",
                    "distinct_values": [float(u) for u in uniq[:8]],
                    "fraction_nonzero": round(float((arr != 0).mean()), 4),
                    "meaning": (
                        "1 = source data present for this cell/day, 0 = absent "
                        "(the paired value channel is 0 and must not be coloured "
                        "as a real measurement)"
                    ) if name.endswith("_available") else
                    "0 = observed, 1 = gap-filled, 2 = flagged by QC",
                }
                continue

            physical = arr
            denormalized = False
            if name in Z_SCORED and norm is not None:
                prefix = Z_SCORED[name]
                mean_v, std_v = f"{prefix}_mean", f"{prefix}_std"
                if mean_v in norm and std_v in norm:
                    mean = np.asarray(norm[mean_v].values, dtype=np.float32)
                    std = np.asarray(norm[std_v].values, dtype=np.float32)
                    physical = arr * std[None, :, :] + mean[None, :, :]
                    denormalized = True

            sample = physical[::stride]
            entry = _stats(physical, sample)
            units, meaning = UNITS.get(name, ("unknown", ""))
            entry.update({
                "kind": "value",
                "units": units,
                "meaning": meaning,
                "stored_z_scored": name in Z_SCORED,
                "denormalized_for_this_report": denormalized,
            })
            if name in Z_SCORED and not denormalized:
                entry["WARNING"] = (
                    "stored z-scored but norm_params was unavailable — the numbers "
                    "above are standard deviations, NOT physical units"
                )
            result["channels"][name] = entry

            if name == "uwnd_850":
                uwnd = physical
            elif name == "vwnd_850":
                vwnd = physical

        # Wind speed is what a particle layer actually needs; it is not a stored
        # channel, so report it as an explicitly derived quantity.
        if uwnd is not None and vwnd is not None:
            speed = np.sqrt(uwnd ** 2 + vwnd ** 2)
            entry = _stats(speed, speed[::stride])
            entry.update({
                "kind": "derived",
                "units": "m/s",
                "meaning": "sqrt(uwnd_850^2 + vwnd_850^2) — 850 hPa wind speed",
                "formula": "hypot(uwnd_850, vwnd_850)",
            })
            result["channels"]["wind_speed_850_derived"] = entry

    if norm is not None:
        norm.close()
    return result


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--regions", nargs="*", default=list(REGION_DIRS))
    ap.add_argument("--stride", type=int, default=5,
                    help="use every Nth day for percentiles (default 5)")
    ap.add_argument("--json-out", default="frontend/public/data_parameters.json")
    args = ap.parse_args()

    payload: dict = {
        "generated_by": "scripts/export_animation_parameters.py",
        "note": (
            "Measured from the actual processed bundles. rainfall/tmax/tmin/"
            "chirps_rain are stored z-scored and were denormalized against "
            "norm_params_*.nc before these statistics were computed, so every "
            "range here is in physical units."
        ),
        "substitution_disclosure": {
            "insat_sst": "NOAA OISST v2.1 — NOT INSAT-3D. MOSDAC access was never approved.",
            "insat_lst": (
                "ERA5-Land skin temperature, daily MEAN — NOT INSAT-3D, and not "
                "comparable to MODIS daytime LST."
            ),
        },
        "regions": {},
    }

    for region in args.regions:
        if region not in REGION_DIRS:
            print(f"unknown region: {region}")
            return 1
        print(f"profiling {region} ...", flush=True)
        payload["regions"][region] = profile_region(region, REGION_DIRS[region], args.stride)

    out = Path(args.json_out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"\nwrote {out} ({out.stat().st_size / 1e3:.1f} kB)")

    for region, info in payload["regions"].items():
        if "error" in info:
            print(f"\n{region}: {info['error']}")
            continue
        g, t = info["grid"], info["time"]
        print(f"\n{region}: {g['n_lat']}x{g['n_lon']} = {g['n_cells']} cells, "
              f"{t['n_steps']} days {t['start']}..{t['end']}")
        for name, c in info["channels"].items():
            if c.get("kind") == "value" or c.get("kind") == "derived":
                p = c.get("percentiles", {})
                print(f"  {name:26s} {c['units']:8s} "
                      f"min {c.get('min', float('nan')):9.3f}  "
                      f"p50 {p.get('p50', float('nan')):9.3f}  "
                      f"p99 {p.get('p99', float('nan')):9.3f}  "
                      f"max {c.get('max', float('nan')):9.3f}  "
                      f"nan {c.get('nan_fraction', 0) * 100:5.1f}%")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
