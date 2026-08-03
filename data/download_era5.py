"""Download ERA5 daily-statistics pressure-level and single-level data for India, 2010-2025.

Prerequisite (manual, cannot be automated):
  1. Log in at https://cds.climate.copernicus.eu
  2. Visit and accept the "Terms of use" at the bottom of the download form for:
     - https://cds.climate.copernicus.eu/datasets/derived-era5-pressure-levels-daily-statistics
     - https://cds.climate.copernicus.eu/datasets/derived-era5-single-levels-daily-statistics
  3. Confirm ~/.cdsapirc exists with your url/key (already written for this account).

Usage:
    .venv\\Scripts\\python.exe data\\download_era5.py --years 2010-2025 --out data\\era5

This downloads ONE NetCDF file PER YEAR per variable group (not per day) to stay
within reasonable request sizes. Re-running skips files that already exist, so it
is safe to stop and resume.
"""
import argparse
import os
import time

import cdsapi

# India bounding box target: 6-38 N, 66-100 E.
# CDS "area" is [North, West, South, East].
AREA = [39, 65, 5, 101]

# CDS enforces a per-request "cost" limit. A single variable, full year,
# full India bbox, daily-mean/6-hourly request is accepted; requesting all
# 4 pressure variables together (even for one month) is rejected with
# "403 cost limits exceeded". So each variable is downloaded in its own
# request, one full year at a time (16 years x 4 vars = 64 requests instead
# of 16 years x 12 months x 4 vars combined).
PRESSURE_LEVEL_VARIABLES = {
    "uwnd": "u_component_of_wind",
    "vwnd": "v_component_of_wind",
    "rhum": "relative_humidity",
    "shum": "specific_humidity",
}
PRESSURE_LEVEL = ["850"]

SINGLE_LEVEL_VARIABLES = {
    "msl": "mean_sea_level_pressure",
    "tcwv": "total_column_water_vapour",
    # MOSDAC substitute (see DATA_ACQUISITION_TASKS.md and
    # isro-bah-2026-finals-roadmap/requirements.md Req 8): ERA5 skin
    # temperature is a documented, widely-used proxy for land/sea surface
    # temperature (see e.g. ECMWF SKT-vs-LSA-SAF LST evaluation studies).
    # It is NOT the same sensor/product as INSAT-3D LST/SST — this
    # substitution must be disclosed in any manifest, data-readiness report,
    # or demo narration rather than silently presented as "MOSDAC data".
    # Uses the same CDS account/API key as the other ERA5 variables above,
    # so no new registration is required.
    "skt": "skin_temperature",
}

MONTHS = [f"{m:02d}" for m in range(1, 13)]
DAYS = [f"{d:02d}" for d in range(1, 32)]


def download_pressure_levels(client: cdsapi.Client, year: int, out_dir: str) -> None:
    for short_name, cds_name in PRESSURE_LEVEL_VARIABLES.items():
        target = os.path.join(out_dir, f"era5_{short_name}_{year}_850hPa.nc")
        if os.path.exists(target):
            print(f"[skip] {target} already exists")
            continue
        request = {
            "product_type": ["reanalysis"],
            "variable": [cds_name],
            "pressure_level": PRESSURE_LEVEL,
            "year": [str(year)],
            "month": MONTHS,
            "day": DAYS,
            "daily_statistic": "daily_mean",
            "time_zone": "utc+00:00",
            "frequency": "6_hourly",
            "area": AREA,
            "data_format": "netcdf",
        }
        print(f"[request] pressure-levels {short_name} {year} -> {target}")
        client.retrieve("derived-era5-pressure-levels-daily-statistics", request, target)


def download_single_levels(client: cdsapi.Client, year: int, out_dir: str) -> None:
    for short_name, cds_name in SINGLE_LEVEL_VARIABLES.items():
        target = os.path.join(out_dir, f"era5_{short_name}_{year}.nc")
        if os.path.exists(target):
            print(f"[skip] {target} already exists")
            continue
        request = {
            "product_type": ["reanalysis"],
            "variable": [cds_name],
            "year": [str(year)],
            "month": MONTHS,
            "day": DAYS,
            "daily_statistic": "daily_mean",
            "time_zone": "utc+00:00",
            "frequency": "6_hourly",
            "area": AREA,
            "data_format": "netcdf",
        }
        print(f"[request] single-levels {short_name} {year} -> {target}")
        client.retrieve("derived-era5-single-levels-daily-statistics", request, target)


def parse_year_range(spec: str) -> list[int]:
    start, end = spec.split("-")
    return list(range(int(start), int(end) + 1))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--years", default="2010-2025")
    parser.add_argument("--out", default="data/era5")
    parser.add_argument("--skip-pressure", action="store_true")
    parser.add_argument("--skip-single", action="store_true")
    args = parser.parse_args()

    os.makedirs(args.out, exist_ok=True)
    client = cdsapi.Client()
    years = parse_year_range(args.years)

    for year in years:
        if not args.skip_pressure:
            try:
                download_pressure_levels(client, year, args.out)
            except Exception as exc:  # noqa: BLE001
                print(f"[error] pressure-levels {year}: {exc}")
            time.sleep(1)
        if not args.skip_single:
            try:
                download_single_levels(client, year, args.out)
            except Exception as exc:  # noqa: BLE001
                print(f"[error] single-levels {year}: {exc}")
            time.sleep(1)

    print("ERA5_DOWNLOAD_COMPLETE")


if __name__ == "__main__":
    main()
