"""Classical baseline models for climate forecasting benchmarks.

Implements:
- Persistence baseline
- Climatology baseline
- Random Forest baseline
- XGBoost baseline (optional if xgboost is installed)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np

from .regions import available_regions, region_mask

logger = logging.getLogger(__name__)


@dataclass
class BaselineArtifacts:
    model_name: str
    predictions: np.ndarray  # shape: (samples, nodes, horizon, variables)
    targets: np.ndarray      # shape: (samples, nodes, horizon, variables)


def _r2_score(pred: np.ndarray, true: np.ndarray) -> float:
    mask = ~np.isnan(pred) & ~np.isnan(true)
    if mask.sum() == 0:
        return float("nan")
    p = pred[mask]
    t = true[mask]
    ss_res = float(np.sum((t - p) ** 2))
    ss_tot = float(np.sum((t - np.mean(t)) ** 2))
    return 1.0 - ss_res / (ss_tot + 1e-10)


def _rmse(pred: np.ndarray, true: np.ndarray) -> float:
    return float(np.sqrt(np.nanmean((pred - true) ** 2)))


def _mae(pred: np.ndarray, true: np.ndarray) -> float:
    return float(np.nanmean(np.abs(pred - true)))


def _as_arrays(sequences: list[tuple]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Convert sequence tuples into dense arrays.

    Returns:
        x_last: (samples, nodes, features)
        x_mean: (samples, nodes, features)
        y: (samples, nodes, horizon, 3)
    """
    x_last = []
    x_mean = []
    y = []
    for graph, target in sequences:
        gx = graph.x.detach().cpu().numpy()  # (nodes, seq, feat)
        ty = target.detach().cpu().numpy().transpose(1, 0, 2)  # (nodes, horizon, 3)
        x_last.append(gx[:, -1, :])
        x_mean.append(gx.mean(axis=1))
        y.append(ty)
    return np.stack(x_last), np.stack(x_mean), np.stack(y)


def _compute_metrics(pred: np.ndarray, true: np.ndarray) -> dict[str, float]:
    """Compute T+1, T+3, T+7 metrics for rainfall/tmax/tmin."""
    var_names = ["rainfall", "temp_max", "temp_min"]
    lead_map = {"t1": 0, "t3": 2, "t7": 6}
    out: dict[str, float] = {}
    for v_idx, vname in enumerate(var_names):
        for lead_label, lead_idx in lead_map.items():
            if lead_idx >= pred.shape[2]:
                continue
            p = pred[:, :, lead_idx, v_idx].ravel()
            t = true[:, :, lead_idx, v_idx].ravel()
            out[f"r2_{vname}_{lead_label}"] = _r2_score(p, t)
            out[f"rmse_{vname}_{lead_label}"] = _rmse(p, t)
            out[f"mae_{vname}_{lead_label}"] = _mae(p, t)
    return out


def _compute_regional_metrics(
    pred: np.ndarray,
    true: np.ndarray,
    node_latlon: np.ndarray,
) -> dict[str, float]:
    """Compute the same T+1/T+3/T+7 metrics per named region.

    Output keys use suffixes: ..._<lead>_<region>
    """
    var_names = ["rainfall", "temp_max", "temp_min"]
    lead_map = {"t1": 0, "t3": 2, "t7": 6}
    out: dict[str, float] = {}

    for region in available_regions():
        if region == "pilot":
            continue
        mask = region_mask(node_latlon, region)
        if not mask.any():
            continue
        for v_idx, vname in enumerate(var_names):
            for lead_label, lead_idx in lead_map.items():
                if lead_idx >= pred.shape[2]:
                    continue
                p = pred[:, mask, lead_idx, v_idx].ravel()
                t = true[:, mask, lead_idx, v_idx].ravel()
                out[f"r2_{vname}_{lead_label}_{region}"] = _r2_score(p, t)
                out[f"rmse_{vname}_{lead_label}_{region}"] = _rmse(p, t)
                out[f"mae_{vname}_{lead_label}_{region}"] = _mae(p, t)
    return out


def persistence_baseline(val_sequences: list[tuple]) -> BaselineArtifacts:
    x_last, _, y_true = _as_arrays(val_sequences)
    pred = np.repeat(x_last[:, :, None, :3], y_true.shape[2], axis=2)
    return BaselineArtifacts("persistence", pred, y_true)


def climatology_baseline(val_sequences: list[tuple]) -> BaselineArtifacts:
    _, x_mean, y_true = _as_arrays(val_sequences)
    pred = np.repeat(x_mean[:, :, None, :3], y_true.shape[2], axis=2)
    return BaselineArtifacts("climatology", pred, y_true)


def random_forest_baseline(train_sequences: list[tuple], val_sequences: list[tuple]) -> BaselineArtifacts:
    from sklearn.ensemble import RandomForestRegressor

    x_last_train, _, y_train = _as_arrays(train_sequences)
    x_last_val, _, y_val = _as_arrays(val_sequences)

    # Flatten samples and nodes into tabular rows.
    xtr = x_last_train.reshape(-1, x_last_train.shape[-1])
    ytr = y_train.reshape(-1, y_train.shape[2] * y_train.shape[3])
    xva = x_last_val.reshape(-1, x_last_val.shape[-1])

    model = RandomForestRegressor(
        n_estimators=120,
        max_depth=14,
        random_state=42,
        n_jobs=-1,
    )
    model.fit(xtr, ytr)
    yhat = model.predict(xva)

    yhat = yhat.reshape(x_last_val.shape[0], x_last_val.shape[1], y_val.shape[2], y_val.shape[3])
    return BaselineArtifacts("random_forest", yhat, y_val)


def xgboost_baseline(train_sequences: list[tuple], val_sequences: list[tuple]) -> BaselineArtifacts | None:
    try:
        from xgboost import XGBRegressor
        from sklearn.multioutput import MultiOutputRegressor
    except Exception as exc:
        logger.warning("XGBoost baseline skipped: %s", exc)
        return None

    x_last_train, _, y_train = _as_arrays(train_sequences)
    x_last_val, _, y_val = _as_arrays(val_sequences)

    xtr = x_last_train.reshape(-1, x_last_train.shape[-1])
    ytr = y_train.reshape(-1, y_train.shape[2] * y_train.shape[3])
    xva = x_last_val.reshape(-1, x_last_val.shape[-1])

    base = XGBRegressor(
        n_estimators=180,
        max_depth=8,
        learning_rate=0.05,
        subsample=0.9,
        colsample_bytree=0.9,
        objective="reg:squarederror",
        random_state=42,
        n_jobs=4,
    )
    model = MultiOutputRegressor(base)
    model.fit(xtr, ytr)
    yhat = model.predict(xva)

    yhat = yhat.reshape(x_last_val.shape[0], x_last_val.shape[1], y_val.shape[2], y_val.shape[3])
    return BaselineArtifacts("xgboost", yhat, y_val)


def run_baseline_suite(train_sequences: list[tuple], val_sequences: list[tuple]) -> dict:
    """Run baseline suite and return benchmark metrics."""
    reports: dict[str, dict[str, float] | str] = {}

    node_latlon = None
    if val_sequences:
        first_graph = val_sequences[0][0]
        pos = getattr(first_graph, "pos", None)
        if pos is not None:
            node_latlon = pos.detach().cpu().numpy()

    p = persistence_baseline(val_sequences)
    p_metrics = _compute_metrics(p.predictions, p.targets)
    if node_latlon is not None:
        p_metrics.update(_compute_regional_metrics(p.predictions, p.targets, node_latlon))
    reports[p.model_name] = p_metrics

    c = climatology_baseline(val_sequences)
    c_metrics = _compute_metrics(c.predictions, c.targets)
    if node_latlon is not None:
        c_metrics.update(_compute_regional_metrics(c.predictions, c.targets, node_latlon))
    reports[c.model_name] = c_metrics

    try:
        rf = random_forest_baseline(train_sequences, val_sequences)
        rf_metrics = _compute_metrics(rf.predictions, rf.targets)
        if node_latlon is not None:
            rf_metrics.update(_compute_regional_metrics(rf.predictions, rf.targets, node_latlon))
        reports[rf.model_name] = rf_metrics
    except Exception as exc:
        reports["random_forest"] = f"skipped: {exc}"

    xgb = xgboost_baseline(train_sequences, val_sequences)
    if xgb is None:
        reports["xgboost"] = "skipped: xgboost not installed"
    else:
        xgb_metrics = _compute_metrics(xgb.predictions, xgb.targets)
        if node_latlon is not None:
            xgb_metrics.update(_compute_regional_metrics(xgb.predictions, xgb.targets, node_latlon))
        reports[xgb.model_name] = xgb_metrics

    return reports
