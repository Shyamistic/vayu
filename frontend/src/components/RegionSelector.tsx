import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
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

// Camera framing extents. Mirrors `ai_engine/regions.py` REGION_BOUNDS.
// `full_india` is the all-India display overview; model coverage must always
// be read from runtime provenance metadata (see `real_data_regions` on
// `/health`) rather than inferred from this camera extent.
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
    id: 'full_india',
    label: 'All India',
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
  /** Regions currently backed by a real model checkpoint (from /health). Undefined/empty = unknown, no indicator shown. */
  realDataRegions?: RegionId[];
}

export default function RegionSelector({ selected, onChange, realDataRegions }: RegionSelectorProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedRegion = REGIONS.find((r) => r.id === selected) ?? REGIONS[REGIONS.length - 1];

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="panel-tight flex items-center gap-2 px-3 py-1.5 text-xs"
      >
        <span className="text-foreground/40 font-medium uppercase tracking-wider">Region</span>
        <span className="text-foreground/85 font-medium whitespace-nowrap">{selectedRegion.label}</span>
        <ChevronDown size={13} className={`text-foreground/40 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          className="absolute top-full mt-1.5 left-0 z-50 min-w-[200px] rounded-xl p-1 flex flex-col gap-0.5 shadow-2xl"
          style={{
            background: 'rgba(var(--panel-bg-rgb),0.98)',
            border: '1px solid rgba(var(--fg-rgb),var(--fg-a12))',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
          }}
        >
          {REGIONS.map((r) => {
            const isLive = realDataRegions?.includes(r.id) ?? false;
            const isSelected = selected === r.id;
            return (
              <button
                key={r.id}
                onClick={() => { onChange(r.id); setOpen(false); }}
                title={isLive ? `${r.label} — live model data` : r.label}
                className={`flex items-center justify-between gap-2 text-xs px-2.5 py-1.5 rounded-lg transition-colors text-left whitespace-nowrap ${
                  isSelected
                    ? 'bg-blue-500/20 text-blue-300 font-medium'
                    : 'text-foreground/70 hover:bg-foreground/10 hover:text-foreground/90'
                }`}
              >
                {r.label}
                {isLive && (
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-green-400 shadow-[0_0_4px_rgba(74,222,128,0.8)] animate-pulse shrink-0"
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
