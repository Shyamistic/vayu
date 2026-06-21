import type { RegionId } from '../types';

export interface RegionOption {
  id: RegionId;
  label: string;
  centerLat: number;
  centerLon: number;
  altitude: number;
}

export const REGIONS: RegionOption[] = [
  {
    id: 'western_ghats',
    label: 'Western Ghats',
    centerLat: 14.0,
    centerLon: 75.0,
    altitude: 900_000,
  },
  {
    id: 'north_east_india',
    label: 'North-East India',
    centerLat: 26.0,
    centerLon: 93.0,
    altitude: 900_000,
  },
  {
    id: 'indo_gangetic_plain',
    label: 'Indo-Gangetic Plain',
    centerLat: 27.0,
    centerLon: 80.0,
    altitude: 1_100_000,
  },
  {
    id: 'central_india',
    label: 'Central India',
    centerLat: 22.0,
    centerLon: 79.0,
    altitude: 1_000_000,
  },
  {
    id: 'pilot',
    label: 'All India (Pilot)',
    centerLat: 22.0,
    centerLon: 80.0,
    altitude: 2_200_000,
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
          className={`text-xs px-2.5 py-1 rounded-md border transition-colors whitespace-nowrap ${
            selected === r.id
              ? 'bg-blue-500/20 border-blue-400/60 text-blue-300 font-medium'
              : 'border-white/10 text-white/40 hover:text-white/70 hover:border-white/20'
          }`}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}
