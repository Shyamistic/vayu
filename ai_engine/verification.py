"""Literature-comparable verification metrics for regional climate forecasts.

Why this module exists
----------------------
The v3 runs reported a single R² per variable, pooled over all 7 lead days and
the whole calendar year. Measured consequence on Western Ghats held-out test
(2023-2025): rainfall R² = -0.019, which reads as "no skill" and is not
comparable to any published result.

The monsoon forecasting literature does not evaluate that way. The closest
benchmark to this project — Narula et al., "Comparing skill of historical
rainfall data based monsoon rainfall prediction in India with NWP forecasts"
(arXiv:2402.07851, v2 2025) — evaluates IMD 0.25 deg daily rainfall at
**1-day and 3-day lead times**, over **monsoon months**, and reports
**relative error against NWP baselines** (they find HRES has ~22% higher error
at 1 day and ~27% at 3 days than their Autoformer).

Operational rainfall verification additionally uses **categorical scores at
warning thresholds** (POD/FAR/CSI/HSS) rather than variance-explained, because
what matters is whether an exceedance was called correctly.

So this module reports, per variable:
  - metrics broken out BY LEAD TIME (day 1, 2, 3, 5, 7), not pooled
  - metrics restricted to the monsoon season (JJAS) as well as all-year
  - multi-day ACCUMULATION skill (3-day, 5-day), the flood-relevant quantity
  - categorical scores at IMD rainfall-warning thresholds
  - relative error vs persistence and climatology, in the same currency the
    benchmark paper uses

Nothing here changes the model. It changes what is measured, so that a real
result is visible and a weak one is not hidden.
"""

from __future__ import annotations

import numpy as np

# ── IMD daily-rainfall warning categories (mm/day) ────────────────────────────
# Source: India Meteorological Department rainfall classification.
IMD_RAIN_THRESHOLDS_MM = {
    "light": 2.5,
    "moderate": 15.6,
    "heavy": 64.5,
    "very_heavy": 115.6,
    "extremely_heavy": 204.5,
}

MONSOON_MONTHS = (6, 7, 8, 9)  # JJAS
LEAD_DAYS_REPORTED = (1, 2, 3, 5, 7)


def _finite(pred: np.ndarray, true: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    m = np.isfinite(pred) & np.isfinite(true)
    return pred[m], true[m]


def r2(pred: np.ndarray, true: np.ndarray) -> float:
    p, t = _finite(pred, true)
    if p.size == 0:
        return float("nan")
    return float(1.0 - np.sum((t - p) ** 2) / (np.sum((t - t.mean()) ** 2) + 1e-10))


def rmse(pred: np.ndarray, true: np.ndarray) -> float:
    p, t = _finite(pred, true)
    return float(np.sqrt(np.mean((p - t) ** 2))) if p.size else float("nan")


def mae(pred: np.ndarray, true: np.ndarray) -> float:
    p, t = _finite(pred, true)
    return float(np.mean(np.abs(p - t))) if p.size else float("nan")


def anomaly_correlation(pred: np.ndarray, true: np.ndarray, clim: np.ndarray) -> float:
    """ACC — the standard NWP skill measure for a field forecast.

    Correlation of forecast and observed anomalies about climatology. Reported
    because it is the metric most readily compared against operational NWP.
    """
    m = np.isfinite(pred) & np.isfinite(true) & np.isfinite(clim)
    if m.sum() < 2:
        return float("nan")
    pa, ta = pred[m] - clim[m], true[m] - clim[m]
    denom = np.sqrt(np.sum(pa**2) * np.sum(ta**2))
    return float(np.sum(pa * ta) / (denom + 1e-12))


def relative_error_vs(pred: np.ndarray, baseline: np.ndarray, true: np.ndarray) -> float:
    """How much higher the BASELINE's RMSE is than the model's, as a fraction.

    Matches the reporting convention of arXiv:2402.07851 ("HRES has 22% higher
    error"). Positive means the model is better than the baseline.
    """
    e_model = rmse(pred, true)
    e_base = rmse(baseline, true)
    if not np.isfinite(e_model) or e_model <= 0:
        return float("nan")
    return float(e_base / e_model - 1.0)


def skill_score(pred: np.ndarray, baseline: np.ndarray, true: np.ndarray) -> float:
    """1 - MSE(model)/MSE(baseline). Positive means the model beats it."""
    p, t = _finite(pred, true)
    b, tb = _finite(baseline, true)
    if p.size == 0 or b.size == 0:
        return float("nan")
    mse_m = np.mean((pred[np.isfinite(pred) & np.isfinite(true)] - t) ** 2)
    mse_b = np.mean((baseline[np.isfinite(baseline) & np.isfinite(true)] - tb) ** 2)
    return float(1.0 - mse_m / (mse_b + 1e-12))


# ── Categorical verification (operational rainfall standard) ──────────────────

def contingency_scores(
    pred: np.ndarray, true: np.ndarray, threshold: float
) -> dict[str, float]:
    """POD / FAR / CSI / HSS / frequency bias for exceedance of `threshold`.

    These are the scores operational agencies use for rainfall warnings, and
    they remain informative when variance-explained is near zero — a forecast
    can identify heavy-rain days correctly while explaining little of the
    day-to-day variance.
    """
    p, t = _finite(pred, true)
    if p.size == 0:
        return {k: float("nan") for k in
                ("pod", "far", "csi", "hss", "frequency_bias", "base_rate")}

    fc = p >= threshold
    ob = t >= threshold
    hits = float(np.sum(fc & ob))
    misses = float(np.sum(~fc & ob))
    false_alarms = float(np.sum(fc & ~ob))
    correct_neg = float(np.sum(~fc & ~ob))
    total = hits + misses + false_alarms + correct_neg

    pod = hits / (hits + misses) if (hits + misses) > 0 else float("nan")
    far = false_alarms / (hits + false_alarms) if (hits + false_alarms) > 0 else float("nan")
    csi = hits / (hits + misses + false_alarms) if (hits + misses + false_alarms) > 0 else float("nan")

    # Heidke skill score against random chance
    expected = ((hits + misses) * (hits + false_alarms)
                + (correct_neg + misses) * (correct_neg + false_alarms)) / total
    hss = (hits + correct_neg - expected) / (total - expected) if total > expected else float("nan")

    bias = (hits + false_alarms) / (hits + misses) if (hits + misses) > 0 else float("nan")

    return {
        "pod": float(pod), "far": float(far), "csi": float(csi), "hss": float(hss),
        "frequency_bias": float(bias), "base_rate": float((hits + misses) / total),
    }


def brier_score(prob: np.ndarray, true_binary: np.ndarray) -> float:
    """Mean squared error of a probability forecast against a 0/1 outcome."""
    p, t = _finite(prob, true_binary.astype(float))
    return float(np.mean((p - t) ** 2)) if p.size else float("nan")


def brier_skill_score(prob: np.ndarray, true_binary: np.ndarray) -> float:
    """Brier score relative to always forecasting the climatological base rate."""
    p, t = _finite(prob, true_binary.astype(float))
    if p.size == 0:
        return float("nan")
    bs = np.mean((p - t) ** 2)
    base = t.mean()
    bs_ref = np.mean((base - t) ** 2)
    return float(1.0 - bs / (bs_ref + 1e-12))


# ── Aggregation helpers ───────────────────────────────────────────────────────

def accumulate(arr: np.ndarray, window: int, lead_axis: int = -1) -> np.ndarray:
    """Sum over the first `window` lead days.

    Multi-day accumulation is the hydrologically relevant quantity — floods
    respond to accumulated rainfall, not single-day totals — and it is
    substantially more predictable than any individual day.
    """
    idx = [slice(None)] * arr.ndim
    idx[lead_axis] = slice(0, window)
    return arr[tuple(idx)].sum(axis=lead_axis)


def monsoon_mask(target_dates: np.ndarray) -> np.ndarray:
    """Boolean mask selecting JJAS, the season the literature evaluates."""
    months = np.asarray([np.datetime64(d, "M").astype(int) % 12 + 1
                         for d in target_dates])
    return np.isin(months, MONSOON_MONTHS)


def evaluate_by_lead(
    pred: np.ndarray,
    true: np.ndarray,
    persistence: np.ndarray | None = None,
    climatology: np.ndarray | None = None,
    leads: tuple[int, ...] = LEAD_DAYS_REPORTED,
) -> dict[str, dict[str, float]]:
    """Per-lead-time metrics. Arrays shaped (..., horizon).

    Pooling lead days 1-7 into one number, as the v3 runs did, mixes an easy
    day-1 problem with a much harder day-7 one and reports neither.
    """
    out: dict[str, dict[str, float]] = {}
    horizon = pred.shape[-1]
    for lead in leads:
        if lead > horizon:
            continue
        i = lead - 1
        p, t = pred[..., i].ravel(), true[..., i].ravel()
        entry = {"r2": r2(p, t), "rmse": rmse(p, t), "mae": mae(p, t)}
        if persistence is not None:
            b = persistence[..., i].ravel()
            entry["skill_vs_persistence"] = skill_score(p, b, t)
            entry["persistence_error_excess"] = relative_error_vs(p, b, t)
        if climatology is not None:
            c = climatology[..., i].ravel()
            entry["skill_vs_climatology"] = skill_score(p, c, t)
            entry["climatology_error_excess"] = relative_error_vs(p, c, t)
            entry["acc"] = anomaly_correlation(p, t, c)
        out[f"day{lead}"] = entry
    return out
