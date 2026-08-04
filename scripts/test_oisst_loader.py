"""Fast, small-scope test of ClimatePreprocessor._load_oisst_sst against real files.

Full-year loading is expensive (450+ individual global 720x1440 regrids), so this
copies 3 known-present files into an isolated temp dir and loads just those,
rather than pointing the loader at the whole D:\\vayu_data\\oisst_sst directory.
"""
from __future__ import annotations

import shutil
import tempfile
from pathlib import Path

from data_ingestion.preprocessor import ClimatePreprocessor

SRC = Path("D:/vayu_data/oisst_sst")
FILES = [
    "oisst-avhrr-v02r01.20100101.nc",
    "oisst-avhrr-v02r01.20100102.nc",
    "oisst-avhrr-v02r01.20100103.nc",
]


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        for f in FILES:
            shutil.copy(SRC / f, tmp_path / f)

        region = {"lat_min": 7.5, "lat_max": 21.5, "lon_min": 72.0, "lon_max": 77.5}
        p = ClimatePreprocessor(region=region, resolution=0.25)
        ds = p._load_oisst_sst(str(tmp_path), 2010, 2010)

        print("result is not None:", ds is not None)
        if ds is not None:
            print("dims:", dict(ds.sizes))
            print("sst range:", float(ds.sst.min()), float(ds.sst.max()))
            print("nan frac:", float(ds.sst.isnull().mean()))
            print("lat range:", float(ds.lat.min()), float(ds.lat.max()))
            print("lon range:", float(ds.lon.min()), float(ds.lon.max()))


if __name__ == "__main__":
    main()
