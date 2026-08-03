import type { RegionId } from '../types';

export interface RegionBounds {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}

export interface RegionOption {
  id: RegionId;
  label: string;
  centerLat: number;
  centerLon: number;
  altitude: number;
  /** Authoritative geographic extent — must match `ai_engine/regions.py`
   *  `REGION_BOUNDS` so the camera frames the exact same area the model
   *  trains/predicts on. Used for rectangle-based camera framing so every
   *  region (regardless of its lat/lon aspect ratio) is centered correctly
   *  instead of relying on a hand-tuned point + pitch + altitude. */
  bounds: RegionBounds;
}

// Camera framing extents. The four regional entries mirror `ai_engine/regions.py`.
// `pilot` is an all-India display overview; model coverage must always be read
// from runtime provenance metadata rather than inferred from this camera extent.
export const REGIONS: RegionOption[] = [
  {
    id: 'western_ghats',
    label: 'Western Ghats',
    centerLat: 14.5,
    centerLon: 74.75,
    altitude: 900_000,
    bounds: { latMin: 7.5, latMax: 21.5, lonMin: 72.0, lonMax: 77.5 },
  },
  {
    id: 'north_east_india',
    label: 'North-East India',
    centerLat: 25.75,
    centerLon: 92.75,
    altitude: 900_000,
    bounds: { latMin: 22.0, latMax: 29.5, lonMin: 88.0, lonMax: 97.5 },
  },
  {
    id: 'indo_gangetic_plain',
    label: 'Indo-Gangetic Plain',
    centerLat: 27.25,
    centerLon: 81.75,
    altitude: 1_100_000,
    bounds: { latMin: 23.0, latMax: 31.5, lonMin: 74.0, lonMax: 89.5 },
  },
  {
    id: 'central_india',
    label: 'Central India',
    centerLat: 21.25,
    centerLon: 79.25,
    altitude: 1_000_000,
    bounds: { latMin: 17.0, latMax: 25.5, lonMin: 74.0, lonMax: 84.5 },
  },
  {
    id: 'pilot',
    label: 'All India (Pilot)',
    centerLat: 22.0,
    centerLon: 82.0,
    altitude: 2_200_000,
    // Full national extent (6-38°N, 66-100°E) — a zoomed-out view of the
    // whole country, NOT the old ML "pilot region" training box (that was
    // just the Western Ghats and made this selector zoom to the wrong area).
    bounds: { latMin: 6.0, latMax: 38.0, lonMin: 66.0, lonMax: 100.0 },
  },
];

interface RegionSelectorProps {
  selected: RegionId;
  onChange: (region: RegionId) => void;
}

export default function RegionSelector({ selected, onChange }: RegionSelectorProps) {
  return (
    <div className="panel-tight px-2 py-1.5 flex items-center gap-1.5">
      <span className="text-xs text-white/40 font-medium uppercase tracking-wider pr-1">Region</span>
      {REGIONS.map((r) => (
        <button
          key={r.id}
          onClick={() => onChange(r.id)}
          title={r.label}
          className={`text-xs px-2.5 py-1 rounded-md border transition-all duration-200 whitespace-nowrap ${
            selected === r.id
              ? 'bg-blue-500/20 border-blue-400/60 text-blue-300 font-medium shadow-[0_0_8px_rgba(59,130,246,0.3)] hover:scale-[1.03] active:scale-95'
              : 'border-white/10 text-white/40 hover:text-white/70 hover:border-white/20 hover:bg-white/5 hover:scale-[1.03] active:scale-95'
          }`}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}
