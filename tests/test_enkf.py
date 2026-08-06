"""Tests for the Ensemble Kalman Filter fusion of forecasts with observations.

The EnKF has an exact analytic answer in the linear-Gaussian case, so these tests
check the implementation against that closed form rather than against its own
output. The scalar product-of-Gaussians identity

    posterior_precision = 1/sigma_model^2 + 1/sigma_obs^2

is the anchor: whatever the ensemble machinery does, a one-variable one-observation
problem must land on it.
"""

from __future__ import annotations

import numpy as np
import pytest

from backend.enkf import (
    MIN_SIGMA,
    assimilate,
    build_ensemble,
    fuse_gaussian,
)


# ══════════════════════════════════════════════════════════════════════════════
# Scalar closed form
# ══════════════════════════════════════════════════════════════════════════════


class TestFuseGaussian:

    def test_matches_the_inverse_variance_weighted_mean(self):
        """The mentor's f_final = f(x_m, s_m) . f(x_i, s_i), computed directly."""
        res = fuse_gaussian(10.0, 2.0, 14.0, 1.0)

        precision = 1 / 2.0 ** 2 + 1 / 1.0 ** 2
        expected_mean = (10.0 / 2.0 ** 2 + 14.0 / 1.0 ** 2) / precision
        expected_sigma = np.sqrt(1.0 / precision)

        assert res.posterior_value == pytest.approx(expected_mean)
        assert res.posterior_sigma == pytest.approx(expected_sigma)

    def test_posterior_is_never_less_certain_than_either_input(self):
        res = fuse_gaussian(10.0, 2.0, 14.0, 1.0)
        assert res.posterior_sigma < min(res.model_sigma, res.observed_sigma)
        assert 0.0 < res.variance_reduction < 1.0

    def test_posterior_lies_between_the_two_sources(self):
        res = fuse_gaussian(10.0, 2.0, 14.0, 1.0)
        assert 10.0 < res.posterior_value < 14.0

    def test_precise_observation_dominates(self):
        """A near-perfect observation should pull the posterior onto itself."""
        res = fuse_gaussian(10.0, 5.0, 20.0, 0.01)
        assert res.posterior_value == pytest.approx(20.0, abs=0.01)
        assert res.kalman_gain > 0.99

    def test_precise_model_dominates(self):
        res = fuse_gaussian(10.0, 0.01, 20.0, 5.0)
        assert res.posterior_value == pytest.approx(10.0, abs=0.01)
        assert res.kalman_gain < 0.01

    def test_equal_uncertainty_gives_the_midpoint_and_half_gain(self):
        res = fuse_gaussian(10.0, 3.0, 20.0, 3.0)
        assert res.posterior_value == pytest.approx(15.0)
        assert res.kalman_gain == pytest.approx(0.5)
        # Two equally good independent estimates: variance halves.
        assert res.posterior_sigma == pytest.approx(3.0 / np.sqrt(2))

    def test_innovation_is_observation_minus_model(self):
        res = fuse_gaussian(10.0, 2.0, 14.0, 1.0)
        assert res.innovation == pytest.approx(4.0)

    def test_disagreement_beyond_stated_uncertainty_is_flagged(self):
        """A 50-sigma gap means one of the two error estimates is wrong, and the
        payload has to say so rather than quietly averaging them."""
        res = fuse_gaussian(10.0, 0.1, 20.0, 0.1)
        assert abs(res.innovation_z) > 3.0
        assert res.consistent is False

    def test_agreement_within_uncertainty_is_consistent(self):
        res = fuse_gaussian(10.0, 2.0, 10.5, 2.0)
        assert res.consistent is True

    def test_zero_sigma_is_floored_rather_than_dividing_by_zero(self):
        res = fuse_gaussian(10.0, 0.0, 20.0, 0.0)
        assert res.model_sigma >= MIN_SIGMA
        assert res.observed_sigma >= MIN_SIGMA
        assert np.isfinite(res.posterior_value)

    def test_confidence_interval_brackets_the_posterior(self):
        res = fuse_gaussian(10.0, 2.0, 14.0, 1.0)
        assert res.ci95_low < res.posterior_value < res.ci95_high

    def test_payload_is_json_safe(self):
        payload = fuse_gaussian(10.0, 2.0, 14.0, 1.0, variable="rainfall", unit="mm/day").to_dict()
        assert payload["variable"] == "rainfall"
        assert payload["unit"] == "mm/day"
        assert payload["posterior"]["value"] is not None


# ══════════════════════════════════════════════════════════════════════════════
# Multivariate EnKF
# ══════════════════════════════════════════════════════════════════════════════


class TestAssimilate:

    def test_single_variable_reproduces_the_scalar_solution(self):
        """With a large ensemble the EnKF must converge on the exact answer."""
        ens = build_ensemble(np.array([10.0]), np.array([2.0]), n_members=20_000, seed=1)
        res = assimilate(ens, np.array([14.0]), np.array([1.0]), seed=1)

        exact = fuse_gaussian(10.0, 2.0, 14.0, 1.0)
        assert res.posterior_mean[0] == pytest.approx(exact.posterior_value, rel=0.02)
        assert res.posterior_sigma[0] == pytest.approx(exact.posterior_sigma, rel=0.05)

    def test_prior_statistics_match_the_requested_ensemble(self):
        ens = build_ensemble(
            np.array([5.0, 30.0]), np.array([1.0, 2.0]), n_members=5000, seed=3
        )
        res = assimilate(
            ens, np.array([6.0]), np.array([0.5]),
            observation_operator=np.array([[1.0, 0.0]]), seed=3,
        )
        assert res.prior_mean[0] == pytest.approx(5.0, abs=1e-9)
        assert res.prior_mean[1] == pytest.approx(30.0, abs=1e-9)
        assert res.prior_sigma[0] == pytest.approx(1.0, rel=0.05)
        assert res.prior_sigma[1] == pytest.approx(2.0, rel=0.05)

    def test_assimilation_reduces_variance_of_the_observed_variable(self):
        ens = build_ensemble(np.array([5.0]), np.array([2.0]), n_members=2000, seed=4)
        res = assimilate(ens, np.array([7.0]), np.array([0.5]), seed=4)

        assert res.posterior_sigma[0] < res.prior_sigma[0]
        assert res.variance_reduction[0] > 0.5

    def test_posterior_spread_does_not_collapse(self):
        """The whole reason for perturbed observations. A deterministic update
        applied to every member with the same y would drive this toward zero and
        report false confidence."""
        ens = build_ensemble(np.array([5.0]), np.array([2.0]), n_members=4000, seed=5)
        res = assimilate(ens, np.array([7.0]), np.array([0.5]), seed=5)

        expected = fuse_gaussian(5.0, 2.0, 7.0, 0.5).posterior_sigma
        assert res.posterior_sigma[0] == pytest.approx(expected, rel=0.1)
        assert res.posterior_sigma[0] > 0.3 * expected

    def test_cross_covariance_corrects_an_unobserved_variable(self):
        """This is the point of an EnKF over independent per-variable updates:
        observing tmax must move rainfall when the prior says they co-vary."""
        corr = np.array([[1.0, 0.9], [0.9, 1.0]])
        ens = build_ensemble(
            np.array([5.0, 30.0]), np.array([1.0, 1.0]),
            n_members=8000, correlation=corr, seed=6,
        )
        # Observe only the second variable, 3 sigma high.
        res = assimilate(
            ens, np.array([33.0]), np.array([0.2]),
            observation_operator=np.array([[0.0, 1.0]]),
            state_names=["rainfall", "tmax"], seed=6,
        )
        # The unobserved variable must have moved in the correlated direction.
        assert res.increment[0] > 0.5
        assert res.prior_covariance[0][1] == pytest.approx(0.9, rel=0.1)

    def test_independent_prior_leaves_unobserved_variable_untouched(self):
        """The mirror of the previous test: no correlation, no cross-correction."""
        ens = build_ensemble(
            np.array([5.0, 30.0]), np.array([1.0, 1.0]), n_members=8000, seed=7,
        )
        res = assimilate(
            ens, np.array([33.0]), np.array([0.2]),
            observation_operator=np.array([[0.0, 1.0]]), seed=7,
        )
        assert res.increment[0] == pytest.approx(0.0, abs=0.1)
        assert res.increment[1] > 2.0

    def test_covariance_matrices_are_symmetric(self):
        ens = build_ensemble(
            np.array([5.0, 30.0, 20.0]), np.array([1.0, 2.0, 1.5]),
            n_members=1000, seed=8,
        )
        res = assimilate(
            ens, np.array([6.0, 31.0]), np.array([0.5, 0.5]),
            observation_operator=np.array([[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]), seed=8,
        )
        P = np.array(res.prior_covariance)
        Pa = np.array(res.posterior_covariance)
        assert np.allclose(P, P.T, atol=1e-10)
        assert np.allclose(Pa, Pa.T, atol=1e-10)

    def test_gain_has_the_documented_shape(self):
        ens = build_ensemble(
            np.array([5.0, 30.0, 20.0]), np.array([1.0, 2.0, 1.5]),
            n_members=500, seed=9,
        )
        res = assimilate(
            ens, np.array([6.0, 31.0]), np.array([0.5, 0.5]),
            observation_operator=np.array([[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]), seed=9,
        )
        gain = np.array(res.gain)
        assert gain.shape == (3, 2)

    def test_inflation_widens_the_prior(self):
        base = build_ensemble(np.array([5.0]), np.array([1.0]), n_members=3000, seed=10)
        plain = assimilate(base, np.array([6.0]), np.array([1.0]), seed=10)
        inflated = assimilate(
            base, np.array([6.0]), np.array([1.0]), inflation=2.0, seed=10
        )
        assert inflated.prior_sigma[0] == pytest.approx(2 * plain.prior_sigma[0], rel=0.05)
        # A wider prior trusts the observation more.
        assert inflated.posterior_mean[0] > plain.posterior_mean[0]

    def test_innovation_consistency_is_reported(self):
        ens = build_ensemble(np.array([5.0]), np.array([1.0]), n_members=1000, seed=11)
        agree = assimilate(ens, np.array([5.2]), np.array([1.0]), seed=11)
        disagree = assimilate(ens, np.array([80.0]), np.array([0.1]), seed=11)

        assert agree.diagnostics["innovations_consistent"] is True
        assert disagree.diagnostics["innovations_consistent"] is False

    def test_results_are_reproducible_for_a_fixed_seed(self):
        ens = build_ensemble(np.array([5.0]), np.array([1.0]), n_members=200, seed=12)
        a = assimilate(ens, np.array([6.0]), np.array([0.5]), seed=42)
        b = assimilate(ens, np.array([6.0]), np.array([0.5]), seed=42)
        assert a.posterior_mean == b.posterior_mean
        assert a.posterior_sigma == b.posterior_sigma

    def test_state_names_are_carried_through(self):
        ens = build_ensemble(
            np.array([5.0, 30.0]), np.array([1.0, 1.0]), n_members=100, seed=13
        )
        res = assimilate(
            ens, np.array([6.0]), np.array([0.5]),
            observation_operator=np.array([[1.0, 0.0]]),
            state_names=["rainfall", "tmax"], seed=13,
        )
        assert res.state_names == ["rainfall", "tmax"]
        assert res.to_dict()["state_names"] == ["rainfall", "tmax"]

    def test_members_returned_only_on_request(self):
        ens = build_ensemble(np.array([5.0]), np.array([1.0]), n_members=50, seed=14)
        without = assimilate(ens, np.array([6.0]), np.array([0.5]), seed=14)
        with_members = assimilate(
            ens, np.array([6.0]), np.array([0.5]), seed=14, keep_members=True
        )
        assert "posterior_members" not in without.to_dict(include_members=True)
        payload = with_members.to_dict(include_members=True)
        assert len(payload["posterior_members"][0]) == 50


class TestAssimilateValidation:

    def test_single_member_rejected(self):
        with pytest.raises(ValueError, match="at least 2 members"):
            assimilate(np.array([[5.0]]), np.array([6.0]), np.array([1.0]))

    def test_one_dimensional_ensemble_rejected(self):
        with pytest.raises(ValueError, match="2-D"):
            assimilate(np.array([5.0, 6.0]), np.array([6.0]), np.array([1.0]))

    def test_mismatched_observation_shapes_rejected(self):
        ens = build_ensemble(np.array([5.0]), np.array([1.0]), n_members=10)
        with pytest.raises(ValueError, match="must match"):
            assimilate(ens, np.array([6.0, 7.0]), np.array([1.0]))

    def test_more_observations_than_state_without_operator_rejected(self):
        ens = build_ensemble(np.array([5.0]), np.array([1.0]), n_members=10)
        with pytest.raises(ValueError, match="observation_operator"):
            assimilate(ens, np.array([6.0, 7.0]), np.array([1.0, 1.0]))

    def test_wrong_operator_shape_rejected(self):
        ens = build_ensemble(np.array([5.0, 6.0]), np.array([1.0, 1.0]), n_members=10)
        with pytest.raises(ValueError, match="observation_operator must be"):
            assimilate(
                ens, np.array([6.0]), np.array([1.0]),
                observation_operator=np.array([[1.0, 0.0, 0.0]]),
            )

    def test_non_finite_ensemble_rejected(self):
        ens = np.array([[1.0, np.nan, 3.0]])
        with pytest.raises(ValueError, match="non-finite"):
            assimilate(ens, np.array([2.0]), np.array([1.0]))

    def test_non_finite_observation_rejected(self):
        ens = build_ensemble(np.array([5.0]), np.array([1.0]), n_members=10)
        with pytest.raises(ValueError, match="non-finite"):
            assimilate(ens, np.array([np.inf]), np.array([1.0]))

    def test_wrong_state_names_length_rejected(self):
        ens = build_ensemble(np.array([5.0, 6.0]), np.array([1.0, 1.0]), n_members=10)
        with pytest.raises(ValueError, match="state_names"):
            assimilate(
                ens, np.array([6.0]), np.array([1.0]),
                observation_operator=np.array([[1.0, 0.0]]),
                state_names=["only_one"],
            )

    def test_negative_inflation_rejected(self):
        ens = build_ensemble(np.array([5.0]), np.array([1.0]), n_members=10)
        with pytest.raises(ValueError, match="inflation"):
            assimilate(ens, np.array([6.0]), np.array([1.0]), inflation=-1.0)


class TestBuildEnsemble:

    def test_sample_mean_is_exact(self):
        ens = build_ensemble(np.array([5.0, 30.0]), np.array([1.0, 2.0]), n_members=64)
        assert ens.mean(axis=1) == pytest.approx([5.0, 30.0], abs=1e-9)

    def test_shape_is_state_by_members(self):
        ens = build_ensemble(np.array([1.0, 2.0, 3.0]), np.array([1.0, 1.0, 1.0]), 32)
        assert ens.shape == (3, 32)

    def test_spread_approximates_requested_sigma(self):
        ens = build_ensemble(np.array([0.0]), np.array([3.0]), n_members=20_000, seed=2)
        assert ens.std(axis=1, ddof=1)[0] == pytest.approx(3.0, rel=0.05)

    def test_correlation_is_imposed(self):
        corr = np.array([[1.0, 0.8], [0.8, 1.0]])
        ens = build_ensemble(
            np.array([0.0, 0.0]), np.array([1.0, 1.0]),
            n_members=20_000, correlation=corr, seed=15,
        )
        observed = np.corrcoef(ens)[0, 1]
        assert observed == pytest.approx(0.8, abs=0.05)

    def test_semi_definite_correlation_is_tolerated(self):
        """A perfectly collinear request must not raise; it is jittered instead."""
        corr = np.array([[1.0, 1.0], [1.0, 1.0]])
        ens = build_ensemble(
            np.array([0.0, 0.0]), np.array([1.0, 1.0]),
            n_members=100, correlation=corr, seed=16,
        )
        assert ens.shape == (2, 100)
        assert np.all(np.isfinite(ens))

    def test_mismatched_shapes_rejected(self):
        with pytest.raises(ValueError, match="must match"):
            build_ensemble(np.array([1.0, 2.0]), np.array([1.0]))

    def test_too_few_members_rejected(self):
        with pytest.raises(ValueError, match="n_members"):
            build_ensemble(np.array([1.0]), np.array([1.0]), n_members=1)

    def test_wrong_correlation_shape_rejected(self):
        with pytest.raises(ValueError, match="correlation must be"):
            build_ensemble(
                np.array([1.0, 2.0]), np.array([1.0, 1.0]),
                correlation=np.eye(3),
            )
