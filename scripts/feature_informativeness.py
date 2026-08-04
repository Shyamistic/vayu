"""Are the 17 input channels actually carrying information?

If moisture/wind/satellite channels are zero-filled, the model is being asked to
predict rainfall from little more than past rainfall + calendar + terrain, which
would explain why it cannot beat a seasonal climatology.

Also reports each channel's lagged correlation with next-day rainfall, which
shows where any real predictive signal lives.
"""
from __future__ import annotations

import sys

import numpy as np

from ai_engine.windowed_dataset import build_dense_region_tensor

REGIONS = ["western_ghats", "north_east_india", "indo_gangetic_plain", "central_india"]


def paths(region: str):
    return (
        f"data/processed_{region}_v2/normalized_2010-2025.nc",
        f"data/static_{region}/elevation.nc",
        f"data/static_{region}/lsm.nc",
    )


def probe(region: str) -> None:
    norm, elev, lsm = paths(region)
    dense = build_dense_region_tensor(norm, elevation_file=elev, lsm_file=lsm)
    x = dense.x.numpy()                      # (N, T, F)
    names = dense.feature_names

    print(f"\n{'=' * 96}")
    print(f"{region}   nodes={x.shape[0]}  time={x.shape[1]}  features={x.shape[2]}")
    print("=" * 96)
    print(f"{'#':>2} {'channel':18s} {'std':>9s} {'frac_zero':>10s} {'unique':>8s} "
          f"{'corr(t->rain t+1)':>18s}  status")

    rain_next = x[:, 1:, 0].ravel()           # rainfall at t+1

    for c in range(x.shape[2]):
        ch = x[:, :, c]
        std = float(np.nanstd(ch))
        frac_zero = float(np.mean(ch == 0.0))
        # cheap uniqueness probe on a subsample
        uniq = int(len(np.unique(np.round(ch[::7, ::13], 4))))

        cur = ch[:, :-1].ravel()
        if std < 1e-8:
            corr = float("nan")
        else:
            m = np.isfinite(cur) & np.isfinite(rain_next)
            corr = float(np.corrcoef(cur[m], rain_next[m])[0, 1])

        if std < 1e-8:
            status = "DEAD (constant)"
        elif frac_zero > 0.98:
            status = "near-dead (>98% zeros)"
        elif uniq <= 3:
            status = "quasi-binary"
        else:
            status = "ok"

        print(f"{c:>2} {names[c]:18s} {std:>9.4f} {frac_zero:>9.1%} {uniq:>8d} "
              f"{corr:>18.4f}  {status}")


def main() -> None:
    for region in (sys.argv[1:] or REGIONS):
        probe(region)


if __name__ == "__main__":
    main()
