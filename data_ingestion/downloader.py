"""IMD and MOSDAC data downloaders with retry logic.

IMD gridded data is distributed as binary .grd files (imdlib format).
MOSDAC INSAT products are distributed as HDF5 files via their web portal.
"""

from __future__ import annotations

import logging
import time
from pathlib import Path

import httpx
import numpy as np
import xarray as xr
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
    before_sleep_log,
)

logger = logging.getLogger(__name__)

# ── IMD data endpoints ──────────────────────────────────────────────────────
# IMD distributes gridded data via their FTP/HTTP portal
IMD_BASE_URL = "https://imdpune.gov.in/cmpg/Griddata"
# Rainfall: subdirectory "Rainfall/<year>.GRD"
# Temperature: subdirectory "Tmax/<year>.GRD" and "Tmin/<year>.GRD"

# IMD grid specification (full India domain)
IMD_RAIN_LAT = (6.5, 38.5, 0.25)   # (min, max, step)
IMD_RAIN_LON = (66.5, 100.0, 0.25)
IMD_TEMP_LAT = (7.5, 37.5, 1.0)
IMD_TEMP_LON = (67.5, 99.5, 1.0)

# MOSDAC endpoints
MOSDAC_BASE_URL = "https://mosdac.gov.in/catalog/dataaccess"
MOSDAC_FTP_HOST = "ftp.mosdac.gov.in"


class DownloadError(RuntimeError):
    """Raised when a download fails after all retries."""


def _retry_decorator():
    """Exponential backoff: 1s → 2s → 4s over 3 attempts."""
    return retry(
        retry=retry_if_exception_type((httpx.RequestError, httpx.HTTPStatusError)),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=8),
        before_sleep=before_sleep_log(logger, logging.WARNING),
        reraise=True,
    )


class IMDDownloader:
    """Downloads IMD gridded rainfall and temperature .grd binary files.

    IMD .grd files are flat binary arrays of float32 values stored in
    row-major order (lat × lon), with missing values encoded as -999.0.

    Usage::

        dl = IMDDownloader(output_dir="./data/imd")
        ds = dl.download_rainfall(start_year=2020, end_year=2022)
    """

    MISSING_VALUE = -999.0

    def __init__(self, output_dir: str | Path = "./data/imd"):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

    # ── Rainfall ──────────────────────────────────────────────────────────────

    def download_rainfall(self, start_year: int, end_year: int) -> xr.Dataset:
        """Download daily gridded rainfall at 0.25° resolution.

        Returns xarray Dataset with dims (time, lat, lon) and variable
        'rainfall' in mm/day, clipped to the pilot region.
        """
        datasets = []
        for year in range(start_year, end_year + 1):
            local_path = self.output_dir / "rainfall" / f"Rainfall_{year}.GRD"
            local_path.parent.mkdir(parents=True, exist_ok=True)
            if not local_path.exists():
                self._download_imd_file("Rainfall", year, local_path)
            try:
                ds = self._parse_imd_grd(
                    local_path,
                    variable="rainfall",
                    lat_spec=IMD_RAIN_LAT,
                    lon_spec=IMD_RAIN_LON,
                    year=year,
                )
                datasets.append(ds)
            except Exception as exc:
                logger.error("Failed to parse rainfall %d: %s", year, exc)
        if not datasets:
            raise DownloadError(f"No rainfall data loaded for {start_year}-{end_year}")
        return xr.concat(datasets, dim="time")

    def download_temperature(
        self, var: str, start_year: int, end_year: int
    ) -> xr.Dataset:
        """Download daily max/min temperature at 1.0° resolution.

        Args:
            var: 'tmax' or 'tmin'

        Returns xarray Dataset with dims (time, lat, lon) and variable in °C.
        """
        if var not in ("tmax", "tmin"):
            raise ValueError(f"var must be 'tmax' or 'tmin', got '{var}'")

        subdir = "Tmax" if var == "tmax" else "Tmin"
        datasets = []
        for year in range(start_year, end_year + 1):
            local_path = self.output_dir / var / f"{subdir}_{year}.GRD"
            local_path.parent.mkdir(parents=True, exist_ok=True)
            if not local_path.exists():
                self._download_imd_file(subdir, year, local_path)
            try:
                ds = self._parse_imd_grd(
                    local_path,
                    variable=var,
                    lat_spec=IMD_TEMP_LAT,
                    lon_spec=IMD_TEMP_LON,
                    year=year,
                )
                datasets.append(ds)
            except Exception as exc:
                logger.error("Failed to parse %s %d: %s", var, year, exc)
        if not datasets:
            raise DownloadError(f"No {var} data loaded for {start_year}-{end_year}")
        return xr.concat(datasets, dim="time")

    # ── Internal helpers ──────────────────────────────────────────────────────

    @_retry_decorator()
    def _download_imd_file(self, subdir: str, year: int, dest: Path) -> None:
        """Download a single IMD .grd file with retry/backoff."""
        url = f"{IMD_BASE_URL}/{subdir}/{subdir}_{year}.GRD"
        logger.info("Downloading %s", url)
        with httpx.stream("GET", url, timeout=120.0, follow_redirects=True) as resp:
            resp.raise_for_status()
            with open(dest, "wb") as f:
                for chunk in resp.iter_bytes(chunk_size=65536):
                    f.write(chunk)
        logger.info("Saved → %s", dest)

    def _parse_imd_grd(
        self,
        path: Path,
        variable: str,
        lat_spec: tuple[float, float, float],
        lon_spec: tuple[float, float, float],
        year: int,
    ) -> xr.Dataset:
        """Parse IMD binary .grd file into an xarray Dataset.

        IMD .grd format:
        - 32-bit floats, little-endian, row-major (lat × lon × time)
        - Year has (366 if leap else 365) daily slices
        - Missing value: -999.0 → converted to NaN
        """
        import calendar

        lat_min, lat_max, lat_step = lat_spec
        lon_min, lon_max, lon_step = lon_spec

        lats = np.arange(lat_min, lat_max + lat_step / 2, lat_step)
        lons = np.arange(lon_min, lon_max + lon_step / 2, lon_step)
        nlat, nlon = len(lats), len(lons)

        is_leap = calendar.isleap(year)
        ndays = 366 if is_leap else 365

        data = np.fromfile(str(path), dtype="<f4")
        expected = nlat * nlon * ndays
        if data.size != expected:
            raise ValueError(
                f"GRD size mismatch for {path.name}: "
                f"expected {expected}, got {data.size}"
            )

        data = data.reshape(ndays, nlat, nlon).astype(np.float32)
        data[data == self.MISSING_VALUE] = np.nan

        import pandas as pd

        start_date = f"{year}-01-01"
        times = pd.date_range(start_date, periods=ndays, freq="D")

        return xr.Dataset(
            {variable: xr.DataArray(data, dims=["time", "lat", "lon"])},
            coords={"time": times, "lat": lats, "lon": lons},
        )


class MOSDACDownloader:
    """Downloads INSAT satellite products from MOSDAC.

    Products: 3RIMG_L2B_LST (land surface temperature),
              3RIMG_L2B_SST (sea surface temperature),
              3RIMG_L2B_IMC (rainfall estimate).

    MOSDAC distributes HDF5 files. This downloader handles authentication
    and batch download via their REST catalog API.

    Usage::

        dl = MOSDACDownloader(username="user", password="pass",
                              output_dir="./data/mosdac")
        ds = dl.download_product("3RIMG_L2B_LST", "2023-01-01", "2023-01-31")
    """

    PRODUCT_VARIABLE_MAP = {
        "3RIMG_L2B_LST": "lst",
        "3RIMG_L2B_SST": "sst",
        "3RIMG_L2B_IMC": "rainfall",
    }

    def __init__(
        self,
        username: str = "",
        password: str = "",
        output_dir: str | Path = "./data/mosdac",
    ):
        self.username = username
        self.password = password
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self._token: str | None = None

    def download_product(
        self,
        product_id: str,
        start_date: str,
        end_date: str,
    ) -> xr.Dataset:
        """Download and aggregate INSAT product for a date range.

        Args:
            product_id: One of '3RIMG_L2B_LST', '3RIMG_L2B_SST', '3RIMG_L2B_IMC'
            start_date: ISO format (YYYY-MM-DD)
            end_date: ISO format (YYYY-MM-DD)

        Returns:
            xarray Dataset with dims (time, lat, lon).
        """
        if product_id not in self.PRODUCT_VARIABLE_MAP:
            raise ValueError(f"Unknown product_id: {product_id}")

        import pandas as pd

        dates = pd.date_range(start_date, end_date, freq="D")
        datasets = []

        for date in dates:
            date_str = date.strftime("%Y-%m-%d")
            local_path = (
                self.output_dir
                / product_id
                / date.strftime("%Y%m")
                / f"{product_id}_{date.strftime('%Y%m%d')}.h5"
            )
            local_path.parent.mkdir(parents=True, exist_ok=True)

            if not local_path.exists():
                try:
                    self._download_mosdac_file(product_id, date_str, local_path)
                except Exception as exc:
                    logger.warning("MOSDAC %s %s failed: %s", product_id, date_str, exc)
                    continue

            try:
                ds = self._parse_mosdac_h5(local_path, product_id, date)
                datasets.append(ds)
            except Exception as exc:
                logger.warning("Parse error %s %s: %s", product_id, date_str, exc)

        if not datasets:
            logger.warning("No MOSDAC data loaded for %s %s–%s", product_id, start_date, end_date)
            return self._empty_dataset(product_id)
        return xr.concat(datasets, dim="time")

    @_retry_decorator()
    def _download_mosdac_file(
        self, product_id: str, date_str: str, dest: Path
    ) -> None:
        """Authenticate and download a single MOSDAC HDF5 file."""
        if not self._token:
            self._authenticate()

        # MOSDAC catalog search API
        search_url = f"{MOSDAC_BASE_URL}/search"
        params = {
            "productId": product_id,
            "startDate": date_str,
            "endDate": date_str,
            "format": "HDF5",
        }
        headers = {"Authorization": f"Bearer {self._token}"}

        with httpx.Client(timeout=60.0) as client:
            resp = client.get(search_url, params=params, headers=headers)
            resp.raise_for_status()
            files = resp.json().get("files", [])

            if not files:
                raise DownloadError(f"No MOSDAC files for {product_id} on {date_str}")

            # Download first matching file
            file_url = files[0].get("url") or files[0].get("downloadUrl")
            dl_resp = client.get(file_url, headers=headers)
            dl_resp.raise_for_status()
            dest.write_bytes(dl_resp.content)

    def _authenticate(self) -> None:
        """Obtain a MOSDAC auth token. Skips if no credentials configured."""
        if not self.username or not self.password:
            logger.warning("No MOSDAC credentials set — downloads may fail")
            self._token = ""
            return

        auth_url = f"{MOSDAC_BASE_URL}/auth/token"
        resp = httpx.post(
            auth_url,
            data={"username": self.username, "password": self.password},
            timeout=30.0,
        )
        resp.raise_for_status()
        self._token = resp.json()["token"]
        logger.info("MOSDAC authentication successful")

    def _parse_mosdac_h5(
        self, path: Path, product_id: str, date: "pd.Timestamp"
    ) -> xr.Dataset:
        """Parse a MOSDAC HDF5 file into an xarray Dataset."""
        import h5py
        import pandas as pd

        variable = self.PRODUCT_VARIABLE_MAP[product_id]

        with h5py.File(str(path), "r") as f:
            # INSAT-3D/3DR L2B products store data in "IMG_data" or product-specific group
            # Try common HDF5 structures used by MOSDAC
            data_key = None
            for key in ["IMG_data", product_id, variable.upper(), "data"]:
                if key in f:
                    data_key = key
                    break
            if data_key is None:
                data_key = list(f.keys())[0]

            raw = f[data_key][:]
            # Get geolocation if available
            lats = f.get("lat", f.get("Latitude", None))
            lons = f.get("lon", f.get("Longitude", None))

            if lats is not None:
                lats = np.array(lats)
                lons = np.array(lons)
            else:
                # INSAT-3D standard projection: ~4km resolution, 0-82°N, 0-180°E
                # Fall back to approximate grid
                lats = np.linspace(0.0, 82.0, raw.shape[0])
                lons = np.linspace(0.0, 180.0, raw.shape[1])

            # Apply scale factor if present
            scale = float(f[data_key].attrs.get("scale_factor", 1.0))
            offset = float(f[data_key].attrs.get("add_offset", 0.0))
            fill_val = f[data_key].attrs.get("_FillValue", -9999.0)

            data = raw.astype(np.float32)
            data[data == fill_val] = np.nan
            data = data * scale + offset

        return xr.Dataset(
            {variable: xr.DataArray(data[np.newaxis, :, :], dims=["time", "lat", "lon"])},
            coords={
                "time": [date],
                "lat": lats if lats.ndim == 1 else lats[:, 0],
                "lon": lons if lons.ndim == 1 else lons[0, :],
            },
        )

    def _empty_dataset(self, product_id: str) -> xr.Dataset:
        """Return an empty dataset when no MOSDAC data is available."""
        variable = self.PRODUCT_VARIABLE_MAP[product_id]
        return xr.Dataset({variable: xr.DataArray([], dims=["time"])})
