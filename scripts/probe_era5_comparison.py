"""Probe /api/era5-comparison against the running backend and print a compact report.

Kept as a script rather than a shell one-liner because PowerShell mangles both
long JSON output and `$_`, and because the numbers this prints are the ones that
go on a slide - they need to be reproducible by re-running one command.

Usage:
    .venv\\Scripts\\python.exe scripts/probe_era5_comparison.py [region] [variable]
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8000"


def get(path: str, timeout: float = 180.0) -> dict:
    try:
        with urllib.request.urlopen(f"{BASE}{path}", timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")[:400]
        return {"__http_error__": exc.code, "__body__": body}
    except Exception as exc:  # noqa: BLE001 - probe script, report anything
        return {"__error__": repr(exc)}


def show(region: str, variable: str, start: str, end: str) -> None:
    path = (
        f"/api/era5-comparison?region={region}&variable={variable}"
        f"&start_date={start}&end_date={end}&include_daily=false"
    )
    data = get(path)
    print(f"\n=== {region} / {variable} / {start}..{end} ===")
    if "__http_error__" in data:
        print(f"  HTTP {data['__http_error__']}: {data['__body__']}")
        return
    if "__error__" in data:
        print(f"  ERROR {data['__error__']}")
        return

    cell = data["our_grid_cell"]
    d = data["daily_stats"]
    m = (data["monthly"] or {}).get("stats")
    print(
        f"  cell {cell['cell_lat']} N {cell['cell_lon']} E "
        f"({cell['distance_from_request_km']} km off) "
        f"denormalized={cell['denormalized']} unit={data['unit']}"
    )
    print(
        f"  daily   n={d['n']:4d} bias={d['bias']:+.4f} mae={d['mae']:.4f} "
        f"rmse={d['rmse']:.4f} r={d['pearson_r']:.4f} r2={d['r_squared']:.4f} "
        f"p={d['pearson_p']:.3g}"
    )
    if d.get("total_ratio") is not None:
        print(
            f"  totals  ours={d['observed_total']:.1f} era5={d['reference_total']:.1f} "
            f"ratio={d['total_ratio']:.4f}"
        )
    if m:
        print(
            f"  monthly n={m['n']:4d} bias={m['bias']:+.4f} mae={m['mae']:.4f} "
            f"rmse={m['rmse']:.4f} r={m['pearson_r']:.4f} r2={m['r_squared']:.4f} "
            f"p={m['pearson_p']:.3g}"
        )
    else:
        print("  monthly (not enough complete months)")


def main() -> None:
    health = get("/health", timeout=30.0)
    print("health:", health.get("status"), "regions:", health.get("real_data_regions"))

    if len(sys.argv) > 2:
        show(sys.argv[1], sys.argv[2], "2024-06-01", "2024-09-30")
        return

    # Monsoon 2024 across variables, then the two-year window for stability.
    for variable in ("rainfall", "tmax", "tmin"):
        show("western_ghats", variable, "2024-06-01", "2024-09-30")
    show("indo_gangetic_plain", "rainfall", "2024-06-01", "2024-09-30")
    show("north_east_india", "rainfall", "2024-06-01", "2024-09-30")
    show("western_ghats", "rainfall", "2023-01-01", "2024-12-31")


if __name__ == "__main__":
    main()
