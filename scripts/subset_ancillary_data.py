"""
Subset NCEP-NCAR wind/humidity and CHIRPS rainfall to the Western Ghats region.
Download full global file -> subset -> delete full file (no OPeNDAP).
"""
from __future__ import annotations
import logging, urllib.request as _urllib
from pathlib import Path
import xarray as xr

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

LAT_MIN, LAT_MAX = 7.0, 22.0
LON_MIN, LON_MAX = 71.0, 79.0
ROOT = Path(__file__).resolve().parents[1]
NCEP_SUBSET_DIR  = ROOT / "data" / "ncep_wind_subset"
CHIRPS_SUBSET_DIR= ROOT / "data" / "chirps_subset"
CHIRPS_RAW_DIR   = ROOT / "chirps"
NCEP_EXISTING_DIR= ROOT / "data" / "ncep_wind"
NCEP_SUBSET_DIR.mkdir(parents=True, exist_ok=True)
CHIRPS_SUBSET_DIR.mkdir(parents=True, exist_ok=True)

BASE_P = "https://downloads.psl.noaa.gov/Datasets/ncep.reanalysis.dailyavgs/pressure"
BASE_S = "https://downloads.psl.noaa.gov/Datasets/ncep.reanalysis.dailyavgs/surface"
YEARS  = list(range(2010, 2026))

def _clip(ds):
    lats = ds.lat.values
    if lats[0] > lats[-1]:
        return ds.sel(lat=slice(LAT_MAX,LAT_MIN), lon=slice(LON_MIN,LON_MAX))
    return ds.sel(lat=slice(LAT_MIN,LAT_MAX), lon=slice(LON_MIN,LON_MAX))

def _get(local, url):
    if local.exists():
        try: return xr.open_dataset(str(local)), None
        except: local.unlink()
    tmp = NCEP_EXISTING_DIR / ("_tmp_" + local.name)
    NCEP_EXISTING_DIR.mkdir(exist_ok=True)
    logger.info("  Downloading %s ...", local.name)
    _urllib.urlretrieve(url, tmp)
    return xr.open_dataset(str(tmp)), tmp

def do_pressure(var, year):
    out = NCEP_SUBSET_DIR / f"{var}_{year}_850hPa_WG.nc"
    if out.exists(): logger.info("SKIP %s", out.name); return
    ds, tmp = _get(NCEP_EXISTING_DIR/f"{var}.{year}.nc", f"{BASE_P}/{var}.{year}.nc")
    try:
        s = _clip(ds.sel(level=850, method="nearest") if "level" in ds.dims else ds)
        s.load()
    finally:
        ds.close()
        if tmp and tmp.exists(): tmp.unlink()
    s.to_netcdf(out)
    logger.info("  -> %s  (%.0f KB)", out.name, out.stat().st_size/1024)

def do_prwtr(year):
    out = NCEP_SUBSET_DIR / f"pr_wtr_{year}_WG.nc"
    if out.exists(): logger.info("SKIP %s", out.name); return
    ds, tmp = _get(NCEP_EXISTING_DIR/f"pr_wtr.{year}.nc", f"{BASE_S}/pr_wtr.eatm.{year}.nc")
    try:
        s = _clip(ds); s.load()
    finally:
        ds.close()
        if tmp and tmp.exists(): tmp.unlink()
    s.to_netcdf(out)
    logger.info("  -> %s  (%.0f KB)", out.name, out.stat().st_size/1024)

def do_chirps(year):
    out = CHIRPS_SUBSET_DIR / f"chirps_{year}_WG.nc"
    if out.exists(): logger.info("SKIP chirps %d", year); return
    cands = sorted(CHIRPS_RAW_DIR.glob(f"chirps-v2.0.{year}*.nc"))
    if not cands: logger.warning("No CHIRPS %d", year); return
    ds = xr.open_dataset(str(cands[0]))
    r = {}
    if "latitude" in ds.dims: r["latitude"]="lat"
    if "longitude" in ds.dims: r["longitude"]="lon"
    if r: ds = ds.rename(r)
    s = _clip(ds)
    for v in list(s.data_vars):
        if v.lower() in ("precip","precipitation","prcp","p","rr"):
            s = s.rename({v:"rainfall"}); break
    s.load(); ds.close(); s.to_netcdf(out)
    logger.info("  -> %s  (%.0f KB)", out.name, out.stat().st_size/1024)

logger.info("=== NCEP 850hPa ===")
for v in ["uwnd","vwnd","shum"]:
    for y in YEARS:
        try: do_pressure(v, y)
        except Exception as e: logger.error("FAIL %s %d: %s", v, y, e)

logger.info("=== NCEP pr_wtr ===")
for y in YEARS:
    try: do_prwtr(y)
    except Exception as e: logger.error("FAIL pr_wtr %d: %s", y, e)

logger.info("=== CHIRPS ===")
for y in YEARS:
    try: do_chirps(y)
    except Exception as e: logger.error("FAIL chirps %d: %s", y, e)

nf = list(NCEP_SUBSET_DIR.glob("*.nc"))
cf = list(CHIRPS_SUBSET_DIR.glob("*.nc"))
logger.info("DONE | NCEP:%d files %.1fMB | CHIRPS:%d files %.1fMB",
    len(nf), sum(f.stat().st_size for f in nf)/1e6,
    len(cf), sum(f.stat().st_size for f in cf)/1e6)
