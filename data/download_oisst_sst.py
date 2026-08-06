"""Download NOAA OISST v2.1 daily sea-surface-temperature data for 2010-2025 from the
NOAA CDR AWS Open Data S3 bucket, one NetCDF file per day.

MOSDAC substitute source (see DATA_ACQUISITION_TASKS.md and IMPLEMENTATION_CONTEXT.md):
this feeds the model's `insat_sst` slot until/unless a real MOSDAC `3RIMG_L2B_SST` or
`3RIMG_L3B_SST_DLY` order is approved and downloaded. OISST is a reanalysis-style
optimum-interpolation SST product blending AVHRR + in-situ observations, NOT the same
sensor/product as INSAT-3D SST — this substitution must be disclosed in any manifest,
data-readiness report, or demo narration rather than silently presented as "MOSDAC data".

No registration, API key, or AWS credentials are required — this is a public
"Requester Pays: No" AWS Open Data bucket served over plain HTTPS.
(Registry: https://registry.opendata.aws/noaa-cdr-sea-surface-temp-optimum-interpolation/)

Two other sources were tried first and rejected for today's window:
  - NCEI's own HTTPS archive (ncei.noaa.gov/data/.../avhrr/) is real but was
    measured throttled to ~13 KB/s — a 16-year daily download would take over a
    week at that rate.
  - The NOAA PSL yearly-file mirror (downloads.psl.noaa.gov, ~450 MB/year) was
    faster per-byte but its connections were unstable over a long-running
    Windows/urllib session (repeated ConnectionResetError/SSL errors mid-year).
This S3 bucket has small per-day files (~1.6 MB each) and was measured stable at
~300 KB/s with no connection drops, so it is used for the full run.

Files are global 0.25 deg grid (not pre-clipped to India); clipping happens in the
data_ingestion preprocessing step, matching the ERA5/NCEP/CHIRPS pattern in this repo.
Re-running skips files that already exist and pass a basic size sanity check, so it
is safe to stop and resume.

Usage:
    .venv\\Scripts\\python.exe data\\download_oisst_sst.py --years 2010-2025 --out data\\oisst_sst
"""
import argparse
import datetime as _dt
import os
import time
import urllib.error
import urllib.request

BASE_URL = "https://noaa-cdr-sea-surface-temp-optimum-interpolation-pds.s3.amazonaws.com/data/v2.1/avhrr"
# A short-read daily file is almost certainly a truncated/failed download —
# real files are consistently ~1.6-1.7 MB.
MIN_EXPECTED_BYTES = 500_000

# Verified via byte-range probe: 1981-06-01 and 1981-08-01 both 404, while
# 1981-09-01 returns 206. The daily AVHRR OISST v2.1 record begins here; dates
# before this will always 404, so daterange() clamps to it rather than
# spending retries/log noise on requests that can never succeed.
RECORD_START = _dt.date(1981, 9, 1)


def daterange(start_year: int, end_year: int):
    current = max(_dt.date(start_year, 1, 1), RECORD_START)
    end = _dt.date(end_year, 12, 31)
    while current <= end:
        yield current
        current += _dt.timedelta(days=1)


def download_day(day: _dt.date, out_dir: str, timeout: float = 30.0, retries: int = 3) -> str:
    yyyymm = day.strftime("%Y%m")
    yyyymmdd = day.strftime("%Y%m%d")
    filename = f"oisst-avhrr-v02r01.{yyyymmdd}.nc"
    target = os.path.join(out_dir, filename)
    if os.path.exists(target) and os.path.getsize(target) >= MIN_EXPECTED_BYTES:
        return "skip"
    url = f"{BASE_URL}/{yyyymm}/{filename}"
    tmp_path = target + ".part"
    last_error = ""
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as response, open(tmp_path, "wb") as handle:
                while True:
                    chunk = response.read(1024 * 64)
                    if not chunk:
                        break
                    handle.write(chunk)
            size = os.path.getsize(tmp_path)
            if size < MIN_EXPECTED_BYTES:
                os.remove(tmp_path)
                last_error = f"too_small_{size}"
                continue
            os.replace(tmp_path, target)
            return "ok"
        except urllib.error.HTTPError as exc:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
            return f"http_error_{exc.code}"  # 404s won't succeed on retry
        except Exception as exc:  # noqa: BLE001
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
            last_error = f"error_{type(exc).__name__}: {exc}"
            time.sleep(2.0)
    return f"failed_after_{retries}_attempts_{last_error}"


def parse_year_range(spec: str) -> tuple[int, int]:
    start, end = spec.split("-")
    return int(start), int(end)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--years", default="2010-2025")
    parser.add_argument("--out", default="data/oisst_sst")
    args = parser.parse_args()

    os.makedirs(args.out, exist_ok=True)
    start_year, end_year = parse_year_range(args.years)

    counts = {"ok": 0, "skip": 0, "failed": 0}
    total = 0
    for day in daterange(start_year, end_year):
        total += 1
        result = download_day(day, args.out)
        if result == "ok":
            counts["ok"] += 1
        elif result == "skip":
            counts["skip"] += 1
        else:
            counts["failed"] += 1
            print(f"[failed] {day.isoformat()}: {result}", flush=True)
        if total % 100 == 0:
            print(f"[progress] {total} days processed (through {day.isoformat()}) — ok={counts['ok']} skip={counts['skip']} failed={counts['failed']}", flush=True)

    print(f"OISST_DOWNLOAD_COMPLETE total={total} ok={counts['ok']} skip={counts['skip']} failed={counts['failed']}", flush=True)


if __name__ == "__main__":
    main()
