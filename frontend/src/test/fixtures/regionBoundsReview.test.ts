import { describe, expect, it } from 'vitest';
import { REGIONS } from '../../components/RegionSelector';
import {
  ALL_INDIA_OVERVIEW_BOUNDS,
  MODEL_PILOT_BOUNDS,
  MODEL_REGION_BOUNDS,
  REGION_BOUNDS_REVIEW,
} from './regionBoundsReview';

describe('reviewed region bounds fixture', () => {
  it('keeps every model region in REGIONS aligned with ai_engine/regions.py', () => {
    for (const [id, bounds] of Object.entries(MODEL_REGION_BOUNDS)) {
      expect(REGIONS.find((region) => region.id === id)?.bounds).toEqual(bounds);
    }
  });

  it('captures the All India overview and authoritative North-East extents', () => {
    expect(REGIONS.find((region) => region.id === 'pilot')?.bounds).toEqual(
      ALL_INDIA_OVERVIEW_BOUNDS,
    );
    expect(REGION_BOUNDS_REVIEW.northEastModelExtent).toEqual({
      latMin: 22.0,
      latMax: 29.5,
      lonMin: 88.0,
      lonMax: 97.5,
    });
  });

  it('preserves pilot as a display overview rather than a coverage claim', () => {
    expect(MODEL_PILOT_BOUNDS).not.toEqual(ALL_INDIA_OVERVIEW_BOUNDS);
    expect(REGION_BOUNDS_REVIEW.coverageCaveat).toContain('display overview only');
    expect(REGION_BOUNDS_REVIEW.coverageCaveat).toContain('runtime provenance metadata');
  });
});
