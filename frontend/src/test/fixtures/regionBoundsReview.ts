import type { RegionId } from '../../types';
import type { RegionBounds } from '../../components/RegionSelector';

/**
 * Reviewed against ai_engine/regions.py REGION_BOUNDS.
 * Keep this snapshot explicit so camera bounds cannot silently drift from the
 * model-region source of truth.
 */
export const MODEL_REGION_BOUNDS = {
  western_ghats: { latMin: 7.5, latMax: 21.5, lonMin: 72.0, lonMax: 77.5 },
  north_east_india: { latMin: 22.0, latMax: 29.5, lonMin: 88.0, lonMax: 97.5 },
  indo_gangetic_plain: { latMin: 23.0, latMax: 31.5, lonMin: 74.0, lonMax: 89.5 },
  central_india: { latMin: 17.0, latMax: 25.5, lonMin: 74.0, lonMax: 84.5 },
} as const satisfies Record<Exclude<RegionId, 'full_india'>, RegionBounds>;

/** The model's pilot box is not the same thing as the product's overview. */
export const MODEL_PILOT_BOUNDS = {
  latMin: 8.0,
  latMax: 20.0,
  lonMin: 72.0,
  lonMax: 78.0,
} as const satisfies RegionBounds;

export const ALL_INDIA_OVERVIEW_BOUNDS = {
  latMin: 6.0,
  latMax: 38.0,
  lonMin: 66.0,
  lonMax: 100.0,
} as const satisfies RegionBounds;

export const REGION_BOUNDS_REVIEW = {
  source: 'ai_engine/regions.py: REGION_BOUNDS',
  allIndiaOverview: ALL_INDIA_OVERVIEW_BOUNDS,
  northEastModelExtent: MODEL_REGION_BOUNDS.north_east_india,
  coverageCaveat:
    'full_india is a display overview only; it must not be presented as model coverage. Read supported coverage from runtime provenance metadata.',
} as const;
