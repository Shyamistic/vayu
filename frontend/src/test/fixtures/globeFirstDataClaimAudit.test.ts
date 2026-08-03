import { describe, expect, it } from 'vitest';
import { DATA_CLAIM_CLASSIFICATIONS, REQUIRED_DATA_CLAIM_IDS, USER_VISIBLE_DATA_CLAIMS, dataClaimById, validateDataClaimAudit } from './globeFirstDataClaimAudit';

describe('globe-first user-visible data claim audit', () => {
  it('gives every audited claim one supported classification and a traceable contract', () => {
    expect(() => validateDataClaimAudit()).not.toThrow();
    expect(new Set(USER_VISIBLE_DATA_CLAIMS.map(({ id }) => id)).size).toBe(USER_VISIBLE_DATA_CLAIMS.length);
    expect(USER_VISIBLE_DATA_CLAIMS).toHaveLength(REQUIRED_DATA_CLAIM_IDS.length);
    for (const claim of USER_VISIBLE_DATA_CLAIMS) expect(DATA_CLAIM_CLASSIFICATIONS).toContain(claim.classification);
  });
  it('covers the required App, imagery, provenance, model, sensor, flood, case-study, and fallback surfaces', () => {
    for (const id of ['app-health-device-version', 'client-prediction-fallback', 'cesium-gibs-catalog', 'provenance-panel-datasets', 'model-info-architecture', 'sensor-station-fields', 'flood-skill-counterfactual', 'case-study-replay']) expect(dataClaimById(id).source).toBeTruthy();
  });
  it('keeps static fallbacks and fabricated evidence out of verified-runtime classifications', () => {
    for (const id of ['client-prediction-fallback', 'client-scenario-fallback', 'client-metrics-fallback', 'satellite-feed-status', 'metrics-observed-chart', 'nwp-benchmarks', 'case-study-replay']) expect(dataClaimById(id).classification).toBe('demo fixture');
    for (const id of ['app-data-source-summary', 'model-info-architecture', 'flood-skill-counterfactual', 'case-study-imd-validation']) expect(dataClaimById(id).classification).toBe('unsupported');
  });
});
