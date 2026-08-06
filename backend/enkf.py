"""Ensemble Kalman Filter for fusing VAYU forecasts with observations.

The model produces a forecast; stations and reanalysis produce observations. Both
are wrong, in different ways and by different amounts, and the useful state
estimate is neither of them alone. This module implements the update that
combines them by their respective uncertainties, which is what the mentor's

    f_final = f(x_m, sigma_m) . f(x_i, sigma_i)

sketch describes: the product of the model's distribution and the observation's
distribution, normalised back to a distribution.

Two entry points, deliberately:

:func:`fuse_gaussian`
    The scalar closed form. For a single variable at a single point the product of
    two Gaussians is another Gaussian whose mean is the inverse-variance weighted
    average, so no ensemble is needed and none is invented. This is exact.

:func:`assimilate`
    The stochastic Ensemble Kalman Filter (Evensen 1994; Burgers et al. 1998) for
    the multivariate case. The covariance is estimated from the ensemble rather
    than assumed diagonal, so an observation of temperature can correct rainfall
    through their sampled cross-covariance - the property that makes an EnKF worth
    running instead of updating each variable independently.

Why stochastic (perturbed-observation) rather than the deterministic form: the
plain update ``X_a = X + K(y - HX)`` applied to every member with the *same* y
collapses the ensemble spread far below the true posterior variance, which would
report false confidence. Perturbing each member's observation with noise drawn
from R keeps the posterior spread statistically consistent with the analysis
covariance.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)

#: Floor applied to any supplied standard deviation. A zero-variance input claims
#: the value is known exactly, which makes the Kalman gain degenerate (it would
#: discard the other source outright) and can divide by zero.
MIN_SIGMA = 1e-6


def _f(value: Any) -> float | None:
    """JSON-safe float: NaN/inf become None rather than invalid JSON literals."""
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if np.isfinite(out) else None


# ── Scalar closed form ────────────────────────────────────────────────────────


@dataclass
class GaussianFusion:
    """Posterior from combining one model estimate with one observation."""

    variable: str
    unit: str
    model_value: float
    model_sigma: float
    observed_value: float
    observed_sigma: float

    posterior_value: float
    posterior_sigma: float
    #: Weight given to the observation, 0 = trust the model entirely, 1 = trust
    #: the observation entirely.
    kalman_gain: float
    #: observation minus model, the quantity the update is driven by.
    innovation: float
    #: Innovation divided by its own expected spread. |z| > ~3 means the two
    #: sources disagree by more than their stated uncertainties can explain.
    innovation_z: float
    #: Fraction of the model variance removed by assimilating.
    variance_reduction: float
    ci95_low: float
    ci95_high: float
    consistent: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "variable": self.variable,
            "unit": self.unit,
            "model": {"value": _f(self.model_value), "sigma": _f(self.model_sigma)},
            "observed": {
                "value": _f(self.observed_value), "sigma": _f(self.observed_sigma),
            },
            "posterior": {
                "value": _f(self.posterior_value),
                "sigma": _f(self.posterior_sigma),
                "ci95_low": _f(self.ci95_low),
                "ci95_high": _f(self.ci95_high),
            },
            "kalman_gain": _f(self.kalman_gain),
            "innovation": _f(self.innovation),
            "innovation_z": _f(self.innovation_z),
            "variance_reduction": _f(self.variance_reduction),
            "consistent": bool(self.consistent),
            "definition": (
                "product of the model and observation Gaussians: "
                "posterior precision is the sum of the two precisions"
            ),
        }


def fuse_gaussian(
    model_value: float,
    model_sigma: float,
    observed_value: float,
    observed_sigma: float,
    *,
    variable: str = "value",
    unit: str = "",
) -> GaussianFusion:
    """Combine one model estimate with one observation, exactly.

    The product of ``N(x_m, s_m^2)`` and ``N(x_o, s_o^2)`` is Gaussian with

        precision = 1/s_m^2 + 1/s_o^2
        mean      = (x_m/s_m^2 + x_o/s_o^2) / precision

    which is algebraically identical to the scalar Kalman update
    ``x_m + K (x_o - x_m)`` with ``K = s_m^2 / (s_m^2 + s_o^2)``. Both forms are
    computed below and the gain is reported, because the gain is the number that
    explains *why* the posterior landed where it did.

    Args:
        model_value: forecast value.
        model_sigma: forecast standard deviation, same units.
        observed_value: observed value.
        observed_sigma: observation standard deviation, same units.
        variable: label carried through to the payload.
        unit: physical unit, for labelling.

    Returns:
        A :class:`GaussianFusion`.
    """
    s_m = max(float(model_sigma), MIN_SIGMA)
    s_o = max(float(observed_sigma), MIN_SIGMA)
    var_m, var_o = s_m ** 2, s_o ** 2

    gain = var_m / (var_m + var_o)
    innovation = float(observed_value) - float(model_value)
    posterior = float(model_value) + gain * innovation
    post_var = (1.0 - gain) * var_m
    post_sigma = float(np.sqrt(max(post_var, 0.0)))

    # Expected spread of the innovation if both stated uncertainties are honest.
    innov_sigma = float(np.sqrt(var_m + var_o))
    innov_z = innovation / innov_sigma if innov_sigma > 0 else float("nan")

    return GaussianFusion(
        variable=variable,
        unit=unit,
        model_value=float(model_value),
        model_sigma=s_m,
        observed_value=float(observed_value),
        observed_sigma=s_o,
        posterior_value=posterior,
        posterior_sigma=post_sigma,
        kalman_gain=gain,
        innovation=innovation,
        innovation_z=innov_z,
        variance_reduction=1.0 - post_var / var_m if var_m > 0 else float("nan"),
        ci95_low=posterior - 1.96 * post_sigma,
        ci95_high=posterior + 1.96 * post_sigma,
        consistent=bool(np.isfinite(innov_z) and abs(innov_z) <= 3.0),
    )


# ── Multivariate stochastic EnKF ──────────────────────────────────────────────


@dataclass
class EnKFResult:
    """Prior and posterior ensemble statistics for one assimilation step."""

    state_names: list[str]
    n_members: int
    n_observations: int

    prior_mean: list[float]
    prior_sigma: list[float]
    posterior_mean: list[float]
    posterior_sigma: list[float]

    observed: list[float]
    observed_sigma: list[float]
    #: Observation minus the prior projected into observation space.
    innovation: list[float]
    innovation_z: list[float]

    #: Kalman gain, shaped (n_state, n_obs), flattened row-major for transport.
    gain: list[list[float]]
    #: Prior covariance, for the covariance panel.
    prior_covariance: list[list[float]]
    posterior_covariance: list[list[float]]
    #: Per-variable fraction of prior variance removed.
    variance_reduction: list[float]
    #: Analysis increment: posterior mean minus prior mean.
    increment: list[float]
    posterior_members: list[list[float]] | None
    diagnostics: dict[str, Any] = field(default_factory=dict)

    def to_dict(self, include_members: bool = False) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "state_names": self.state_names,
            "n_members": int(self.n_members),
            "n_observations": int(self.n_observations),
            "prior": {
                "mean": [_f(v) for v in self.prior_mean],
                "sigma": [_f(v) for v in self.prior_sigma],
            },
            "posterior": {
                "mean": [_f(v) for v in self.posterior_mean],
                "sigma": [_f(v) for v in self.posterior_sigma],
            },
            "observed": {
                "value": [_f(v) for v in self.observed],
                "sigma": [_f(v) for v in self.observed_sigma],
            },
            "innovation": [_f(v) for v in self.innovation],
            "innovation_z": [_f(v) for v in self.innovation_z],
            "increment": [_f(v) for v in self.increment],
            "variance_reduction": [_f(v) for v in self.variance_reduction],
            "gain": [[_f(v) for v in row] for row in self.gain],
            "prior_covariance": [[_f(v) for v in row] for row in self.prior_covariance],
            "posterior_covariance": [
                [_f(v) for v in row] for row in self.posterior_covariance
            ],
            "diagnostics": self.diagnostics,
        }
        if include_members and self.posterior_members is not None:
            payload["posterior_members"] = [
                [_f(v) for v in row] for row in self.posterior_members
            ]
        return payload


def assimilate(
    ensemble: np.ndarray,
    observations: np.ndarray,
    observation_sigma: np.ndarray,
    *,
    observation_operator: np.ndarray | None = None,
    state_names: list[str] | None = None,
    inflation: float = 1.0,
    seed: int | None = 0,
    keep_members: bool = False,
) -> EnKFResult:
    """Run one stochastic Ensemble Kalman Filter update.

    Args:
        ensemble: prior ensemble, shaped ``(n_state, n_members)``.
        observations: observed values, shaped ``(n_obs,)``.
        observation_sigma: observation standard deviations, shaped ``(n_obs,)``.
        observation_operator: ``H``, shaped ``(n_obs, n_state)``. Defaults to
            observing the first ``n_obs`` state variables directly.
        state_names: labels for the state vector.
        inflation: multiplicative prior spread inflation applied before the
            update. A small ensemble systematically underestimates spread, and
            inflation > 1 counteracts the resulting over-confidence.
        seed: RNG seed for the observation perturbations, so a given input
            reproduces a given analysis.
        keep_members: return the posterior members as well as their statistics.

    Returns:
        An :class:`EnKFResult`.

    Raises:
        ValueError: on shape mismatches or a degenerate ensemble.
    """
    X = np.asarray(ensemble, dtype=np.float64)
    if X.ndim != 2:
        raise ValueError(f"ensemble must be 2-D (n_state, n_members), got {X.shape}")
    n_state, n_members = X.shape
    if n_members < 2:
        raise ValueError(
            f"EnKF needs at least 2 members to estimate a covariance, got {n_members}"
        )

    y = np.atleast_1d(np.asarray(observations, dtype=np.float64))
    r_sigma = np.atleast_1d(np.asarray(observation_sigma, dtype=np.float64))
    if y.shape != r_sigma.shape:
        raise ValueError(
            f"observations {y.shape} and observation_sigma {r_sigma.shape} must match"
        )
    n_obs = y.shape[0]
    r_sigma = np.maximum(r_sigma, MIN_SIGMA)

    if observation_operator is None:
        if n_obs > n_state:
            raise ValueError(
                f"{n_obs} observations but only {n_state} state variables and no "
                f"observation_operator supplied"
            )
        H = np.eye(n_obs, n_state, dtype=np.float64)
    else:
        H = np.asarray(observation_operator, dtype=np.float64)
        if H.shape != (n_obs, n_state):
            raise ValueError(
                f"observation_operator must be ({n_obs}, {n_state}), got {H.shape}"
            )

    if not np.all(np.isfinite(X)):
        raise ValueError("ensemble contains non-finite values")
    if not np.all(np.isfinite(y)):
        raise ValueError("observations contain non-finite values")

    prior_mean = X.mean(axis=1)
    anomalies = X - prior_mean[:, None]

    if inflation != 1.0:
        if inflation <= 0:
            raise ValueError(f"inflation must be positive, got {inflation}")
        anomalies = anomalies * float(inflation)
        X = prior_mean[:, None] + anomalies

    # Sample covariance with the (N-1) normalisation, the unbiased estimator.
    P = anomalies @ anomalies.T / (n_members - 1)
    R = np.diag(r_sigma ** 2)

    PHt = P @ H.T
    S = H @ PHt + R
    try:
        # solve rather than an explicit inverse: better conditioned, and S is
        # small (n_obs x n_obs) so there is no reason to form the inverse.
        gain = np.linalg.solve(S.T, PHt.T).T
    except np.linalg.LinAlgError as exc:
        raise ValueError(
            "innovation covariance is singular; check for duplicate observations "
            "or a collapsed ensemble"
        ) from exc

    # Perturbed observations, one draw per member. Without this the posterior
    # spread collapses and the filter reports more confidence than it has.
    #
    # The seed is domain-separated rather than used directly. `build_ensemble` also
    # takes a `seed`, and a caller passing the same integer to both would otherwise
    # draw the perturbations from the identical stream as the ensemble anomalies,
    # making eps perfectly correlated with the prior. That inflates the analysis
    # variance instead of leaving it at (I-KH)P - a wrong answer that still looks
    # like a plausible spread. Mixing in a fixed tag keeps the two streams
    # independent while staying reproducible.
    rng = np.random.default_rng(
        None if seed is None else [int(seed), 0x456E4B46]  # "EnKF"
    )
    noise = rng.normal(0.0, 1.0, size=(n_obs, n_members)) * r_sigma[:, None]
    # Centre the noise so a finite sample does not also shift the posterior mean.
    noise -= noise.mean(axis=1, keepdims=True)
    y_perturbed = y[:, None] + noise

    X_post = X + gain @ (y_perturbed - H @ X)

    post_mean = X_post.mean(axis=1)
    post_anom = X_post - post_mean[:, None]
    P_post = post_anom @ post_anom.T / (n_members - 1)

    prior_sigma = np.sqrt(np.clip(np.diag(P), 0.0, None))
    post_sigma = np.sqrt(np.clip(np.diag(P_post), 0.0, None))

    innovation = y - H @ prior_mean
    innov_sigma = np.sqrt(np.clip(np.diag(S), 0.0, None))
    with np.errstate(divide="ignore", invalid="ignore"):
        innov_z = np.where(innov_sigma > 0, innovation / innov_sigma, np.nan)
        var_reduction = np.where(
            np.diag(P) > 0, 1.0 - np.diag(P_post) / np.diag(P), np.nan
        )

    names = state_names or [f"x{i}" for i in range(n_state)]
    if len(names) != n_state:
        raise ValueError(f"state_names must have {n_state} entries, got {len(names)}")

    # A chi-square-like consistency check on the innovations. If the model and
    # observation uncertainties are honest, the normalised innovations should be
    # order 1; persistently larger means one of the two is understated.
    finite_z = innov_z[np.isfinite(innov_z)]
    rmse_z = float(np.sqrt(np.mean(finite_z ** 2))) if finite_z.size else float("nan")

    return EnKFResult(
        state_names=list(names),
        n_members=int(n_members),
        n_observations=int(n_obs),
        prior_mean=prior_mean.tolist(),
        prior_sigma=prior_sigma.tolist(),
        posterior_mean=post_mean.tolist(),
        posterior_sigma=post_sigma.tolist(),
        observed=y.tolist(),
        observed_sigma=r_sigma.tolist(),
        innovation=innovation.tolist(),
        innovation_z=innov_z.tolist(),
        gain=gain.tolist(),
        prior_covariance=P.tolist(),
        posterior_covariance=P_post.tolist(),
        variance_reduction=var_reduction.tolist(),
        increment=(post_mean - prior_mean).tolist(),
        posterior_members=X_post.tolist() if keep_members else None,
        diagnostics={
            "method": "stochastic Ensemble Kalman Filter (perturbed observations)",
            "covariance_normalisation": "N-1 (unbiased sample covariance)",
            "inflation": float(inflation),
            "innovation_rmse_z": _f(rmse_z),
            "innovations_consistent": bool(np.isfinite(rmse_z) and rmse_z <= 3.0),
            "seed": seed,
            "note": (
                "cross-covariance in the prior lets an observation of one variable "
                "correct the others; a diagonal prior would not"
            ),
        },
    )


def build_ensemble(
    mean: np.ndarray,
    sigma: np.ndarray,
    n_members: int = 64,
    *,
    correlation: np.ndarray | None = None,
    seed: int | None = 0,
) -> np.ndarray:
    """Draw a Gaussian prior ensemble around ``mean``.

    Used where the forecast supplies a mean and a per-variable uncertainty but no
    ensemble of its own, which is the case for a single deterministic VAYU run.
    The draw is explicit rather than hidden inside :func:`assimilate` so it is
    obvious that the ensemble is a *representation* of the stated uncertainty and
    not an independently generated forecast spread.

    Args:
        mean: state mean, shaped ``(n_state,)``.
        sigma: per-variable standard deviation, shaped ``(n_state,)``.
        n_members: ensemble size.
        correlation: optional ``(n_state, n_state)`` correlation matrix. Without
            it the members are drawn independently, and the filter can only
            correct observed variables.
        seed: RNG seed.

    Returns:
        An ``(n_state, n_members)`` ensemble.
    """
    mu = np.atleast_1d(np.asarray(mean, dtype=np.float64))
    sd = np.maximum(np.atleast_1d(np.asarray(sigma, dtype=np.float64)), MIN_SIGMA)
    if mu.shape != sd.shape:
        raise ValueError(f"mean {mu.shape} and sigma {sd.shape} must match")
    if n_members < 2:
        raise ValueError(f"n_members must be at least 2, got {n_members}")

    n_state = mu.shape[0]
    rng = np.random.default_rng(seed)
    z = rng.normal(0.0, 1.0, size=(n_state, n_members))

    if correlation is not None:
        C = np.asarray(correlation, dtype=np.float64)
        if C.shape != (n_state, n_state):
            raise ValueError(f"correlation must be ({n_state}, {n_state}), got {C.shape}")
        # Cholesky imposes the requested correlation. Jitter the diagonal if the
        # supplied matrix is only positive semi-definite.
        try:
            L = np.linalg.cholesky(C)
        except np.linalg.LinAlgError:
            L = np.linalg.cholesky(C + np.eye(n_state) * 1e-8)
        z = L @ z

    # Centre so the sample mean is exactly the requested mean.
    z -= z.mean(axis=1, keepdims=True)
    return mu[:, None] + sd[:, None] * z
