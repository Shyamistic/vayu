"""Verify the per-region inference caches stay bounded across every region.

Walking all five regions in one process is exactly what OOM-killed the deployed
container (exit 137) before MAX_CACHED_REGIONS existed, so this asserts the
bound holds after each request rather than only at the end.

    python scripts/check_cache_bounds.py
"""

from __future__ import annotations

import sys

from fastapi.testclient import TestClient

from backend import main
from backend.main import app

REGIONS = [
    "western_ghats",
    "north_east_india",
    "indo_gangetic_plain",
    "central_india",
    "full_india",
]


def main_check() -> int:
    limit = main.MAX_CACHED_REGIONS
    print(f"MAX_CACHED_REGIONS = {limit}\n")

    failures: list[str] = []
    with TestClient(app) as client:
        for region in REGIONS:
            resp = client.get(
                f"/api/predict?date=2025-06-15&region={region}&lead_day=1"
            )
            cells = len(resp.json().get("grid_cells", [])) if resp.status_code == 200 else 0
            sizes = (
                len(main._region_models),
                len(main._graph_builder_cache),
                len(main._dataset_cache),
            )
            print(
                f"{region:22s} status={resp.status_code} cells={cells:5d} "
                f"models={sizes[0]} builders={sizes[1]} datasets={sizes[2]}"
            )
            if resp.status_code != 200:
                failures.append(f"{region}: HTTP {resp.status_code}")
            for name, size in zip(("models", "builders", "datasets"), sizes):
                if size > limit:
                    failures.append(f"{region}: {name} cache grew to {size} (limit {limit})")

    print()
    if failures:
        for f in failures:
            print(f"FAIL {f}")
        return 1
    print("CACHES_BOUNDED_OK - all regions served, no cache exceeded the limit")
    return 0


if __name__ == "__main__":
    sys.exit(main_check())
