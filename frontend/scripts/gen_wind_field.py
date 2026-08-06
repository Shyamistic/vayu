"""
Synthetic placeholder wind field for the frontend's mock fallback
(frontend/public/wind_field.json), used until the backend exposes real
uwnd_850/vwnd_850 per grid cell (see frontend/public/data_parameters.json).

Grid shape/bounds match the measured `full_india` bundle exactly (0.5 deg,
64x67, cell_edge_* bounds) so swapping in real data later is a drop-in
replacement, not a reshape.

The field itself is NOT random noise -- it's a smooth synthetic approximation
of southwest-monsoon-like flow (generally SW->NE over peninsular India,
westerly aloft), scaled to roughly match the measured 850hPa magnitude
percentiles for full_india (u: p50=1.36, p99=16.21; v: p50=0.17, p99=7.87),
purely so the wind-animation UI has something visually plausible to check
before real data exists. It is not a real forecast.
"""
import os
import json
import numpy as np

n_lat, n_lon = 64, 67
lat_min, lat_max = 6.625, 38.125
lon_min, lon_max = 66.625, 99.625

lats = np.linspace(lat_min, lat_max, n_lat)
lons = np.linspace(lon_min, lon_max, n_lon)
LON, LAT = np.meshgrid(lons, lats)  # shape (n_lat, n_lon)

# Base southwesterly monsoon flow (u>0 eastward, v>0 northward), stronger
# over the Arabian Sea / west coast, weakening and curving north over the
# Gangetic plain -- smooth, large-scale, deliberately not random.
lat_n = (LAT - lat_min) / (lat_max - lat_min)
lon_n = (LON - lon_min) / (lon_max - lon_min)

u = 6.0 + 8.0 * np.sin(lon_n * np.pi * 0.8) * np.cos(lat_n * np.pi * 0.5) \
    + 3.0 * np.sin(lat_n * np.pi * 2.2 + lon_n * np.pi)
v = 3.0 + 5.0 * np.cos(lon_n * np.pi * 0.6) * np.sin(lat_n * np.pi * 0.9) \
    + 2.0 * np.cos(lon_n * np.pi * 1.7 - lat_n * np.pi)

# Mild smooth turbulence so it doesn't look like a perfect sine field
rng = np.random.default_rng(42)
noise_u = rng.normal(0, 1.2, size=u.shape)
noise_v = rng.normal(0, 1.0, size=v.shape)
# box-blur the noise for smoothness
def blur(a, k=2):
    out = a.copy()
    for _ in range(k):
        out = (out + np.roll(out, 1, 0) + np.roll(out, -1, 0) +
               np.roll(out, 1, 1) + np.roll(out, -1, 1)) / 5.0
    return out
u = u + blur(noise_u)
v = v + blur(noise_v)

data = {
    "_comment": "SYNTHETIC placeholder wind field, not real observations/forecast. See generation notes in frontend/scripts/gen_wind_field.py.",
    "width": n_lon,
    "height": n_lat,
    "uMin": float(u.min()),
    "uMax": float(u.max()),
    "vMin": float(v.min()),
    "vMax": float(v.max()),
    "u": [float(x) for x in u.flatten()],
    "v": [float(x) for x in v.flatten()],
    "bounds": {
        "west": 66.375,
        "south": 6.375,
        "east": 99.875,
        "north": 38.375,
    },
}

out_path = os.path.join(os.path.dirname(__file__), "..", "public", "wind_field.json")
with open(out_path, "w") as f:
    json.dump(data, f)

print(f"wrote {out_path}: {n_lon}x{n_lat} cells, u=[{u.min():.2f},{u.max():.2f}] v=[{v.min():.2f},{v.max():.2f}]")
