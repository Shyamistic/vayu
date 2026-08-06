"""Read the four test_report.json files against the MEASURED blend floors.

Why this exists: the project's nominal targets (R2_rain >= 0.20,
R2_tmax >= 0.80) are already met by an untrained persistence/climatology blend
in three of four regions (see research/VALIDATION_1981_PRETRAINING.md), so a
raw R2 number cannot tell you whether the model learned anything. This prints
the achieved R2 next to the floor it has to beat and labels the outcome, plus
the literature-comparable per-lead / JJAS / extreme-event fields when the
verification block is present.

Usage:
    # after downloading each run's checkpoint dir output from Kaggle
    python scripts/compare_test_reports.py --root D:/vayu_data/kaggle_results
    python scripts/compare_test_reports.py --report path/to/test_report.json --region western_ghats
"""
from __future__ import annotations

import argparse
import io
import json
import sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

# Measured on the 1981-2025 data, train 1981-2021 / val 2022, leads 1-7 pooled
# (scripts/skill_ceiling_probe.py). Best fixed persistence/climatology blend.
FLOORS = {
    "western_ghats": {"rainfall": 0.235, "temp_max": 0.807, "temp_min": 0.818},
    "north_east_india": {"rainfall": 0.201, "temp_max": 0.753, "temp_min": 0.959},
    "indo_gangetic_plain": {"rainfall": 0.191, "temp_max": 0.893, "temp_min": 0.944},
    "central_india": {"rainfall": 0.263, "temp_max": 0.879, "temp_min": 0.905},
}

# Realistic / stretch rainfall targets from the same validation.
RAIN_TARGETS = {
    "western_ghats": (0.28, 0.32),
    "north_east_india": (0.23, 0.27),
    "indo_gangetic_plain": (0.23, 0.27),
    "central_india": (0.31, 0.36),
}


def verdict(delta: float) -> str:
    if delta > 0.005:
        return "BEATS blend"
    if delta > -0.005:
        return "matches blend"
    return "BELOW blend"


def show(region: str, report: dict) -> dict:
    floors = FLOORS.get(region, {})
    print(f"\n{'=' * 82}")
    print(f"{region}")
    print("=" * 82)
    print(f"{'variable':10s} {'R2':>8s} {'floor':>8s} {'vs floor':>9s} "
          f"{'skill_clim':>11s} {'skill_pers':>11s}  verdict")

    summary = {}
    for var in ("rainfall", "temp_max", "temp_min"):
        m = report.get(var)
        if not isinstance(m, dict) or "r2" not in m:
            continue
        r2 = float(m["r2"])
        floor = floors.get(var)
        sk_c = m.get("skill_vs_climatology", float("nan"))
        sk_p = m.get("skill_vs_persistence", float("nan"))
        if floor is None:
            print(f"{var:10s} {r2:>+8.3f}")
            continue
        d = r2 - floor
        print(f"{var:10s} {r2:>+8.3f} {floor:>+8.3f} {d:>+9.3f} "
              f"{sk_c:>+11.3f} {sk_p:>+11.3f}  {verdict(d)}")
        summary[var] = {"r2": r2, "floor": floor, "delta": d,
                         "verdict": verdict(d)}

    if "rainfall" in summary and region in RAIN_TARGETS:
        realistic, stretch = RAIN_TARGETS[region]
        r2 = summary["rainfall"]["r2"]
        band = ("STRETCH met" if r2 >= stretch else
                "realistic met" if r2 >= realistic else
                "above floor, below realistic" if r2 > floors["rainfall"] else
                "at or below floor")
        print(f"\n  rainfall target band: realistic >= {realistic:.2f}, "
              f"stretch >= {stretch:.2f}  ->  {band}")

    # Literature-comparable block, when ai_engine/verification.py populated it.
    ver = report.get("verification") or report.get("by_lead")
    if ver:
        print("\n  verification block present - per-lead / JJAS / extreme scores:")
        _print_verification(report)
    else:
        print("\n  NOTE no verification block found. Pooled all-year R2 is NOT")
        print("  comparable with Narula et al. (arXiv:2402.07851), who report")
        print("  per-lead JJAS relative error vs NWP.")

    return summary


def _print_verification(report: dict) -> None:
    for key in ("by_lead", "by_lead_jjas"):
        block = report.get(key) or (report.get("verification") or {}).get(key)
        if not block:
            continue
        print(f"    {key}:")
        for lead, vars_ in sorted(block.items(), key=lambda kv: str(kv[0])):
            if not isinstance(vars_, dict):
                continue
            bits = []
            for var, m in vars_.items():
                if isinstance(m, dict) and "r2" in m:
                    bits.append(f"{var}={m['r2']:+.3f}")
            if bits:
                print(f"      lead {lead}: " + "  ".join(bits))

    ext = report.get("extremes") or (report.get("verification") or {}).get("extremes")
    if ext:
        print("    extremes (POD/FAR/CSI/HSS at IMD warning thresholds):")
        for thr, m in ext.items():
            if isinstance(m, dict):
                got = {k: m.get(k) for k in ("pod", "far", "csi", "hss")
                       if m.get(k) is not None}
                if got:
                    print(f"      {thr}: " +
                          "  ".join(f"{k.upper()}={v:.3f}" for k, v in got.items()))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", type=Path, default=None,
                     help="Directory containing <region>/test_report.json")
    ap.add_argument("--report", type=Path, default=None)
    ap.add_argument("--region", default=None)
    args = ap.parse_args()

    found = {}
    if args.report:
        if not args.region:
            print("--report requires --region")
            return 1
        found[args.region] = json.loads(args.report.read_text(encoding="utf-8-sig"))
    elif args.root:
        for region in FLOORS:
            for cand in (args.root / region / "test_report.json",
                          args.root / f"{region}_test_report.json",
                          args.root / region / f"{region}_main" / "test_report.json"):
                if cand.exists():
                    found[region] = json.loads(cand.read_text(encoding="utf-8-sig"))
                    break
        if not found:
            print(f"No test_report.json found under {args.root}")
            print("Expected <root>/<region>/test_report.json")
            return 1
    else:
        print("Provide --root or --report/--region")
        return 1

    results = {r: show(r, rep) for r, rep in found.items()}

    print(f"\n{'=' * 82}")
    print("SUMMARY - rainfall is the metric that matters (temperature is")
    print("saturated: ridge beat the blend by at most +0.004 in validation)")
    print("=" * 82)
    print(f"{'region':22s} {'rain R2':>9s} {'floor':>8s} {'delta':>8s}  verdict")
    for region, s in results.items():
        if "rainfall" not in s:
            continue
        r = s["rainfall"]
        print(f"{region:22s} {r['r2']:>+9.3f} {r['floor']:>+8.3f} "
              f"{r['delta']:>+8.3f}  {r['verdict']}")

    missing = [r for r in FLOORS if r not in results]
    if missing:
        print(f"\nstill missing: {', '.join(missing)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
