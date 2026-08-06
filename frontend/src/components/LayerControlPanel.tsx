/**
 * LayerControlPanel — NASA WorldView-style layer switcher.
 *
 * Switches the CesiumGlobe background between:
 *  - Bing satellite imagery (default)
 *  - MODIS Terra true-colour (NASA GIBS, free)
 *  - NASA IMERG precipitation rate (NASA GIBS, free)
 *  - MODIS cloud fraction (NASA GIBS, free)
 *  - Earth at Night (Cesium Ion asset 3812, free)
 *  - VAYU climate model output only
 *  - FIRMS Active Fires (NASA GIBS, free) — Feature 17
 *  - OpenWeatherMap live tiles — Feature 12
 *  - MODIS Land Surface Temperature (NASA GIBS, free) — Feature 16
 */
import { Layers, Satellite, CloudRain, Cloud, Activity, Thermometer, TreePine, Wind, Droplets } from 'lucide-react';
import type { EarthLayer } from './CesiumGlobe';

interface LayerOption {
  id: EarthLayer;
  label: string;
  sublabel: string;
  icon: React.ReactNode;
  color: string;
  badge?: string;
  group?: string;
}

const LAYER_OPTIONS: LayerOption[] = [
  // ── Base / Satellite ───────────────────────────────────────────────────────
  {
    id: 'satellite',
    label: 'Satellite',
    sublabel: 'Bing/Cesium Ion high-res',
    icon: <Satellite size={13} />,
    color: '#60a5fa',
    group: 'Base',
  },
  {
    id: 'vayu',
    label: 'VAYU Only',
    sublabel: 'Model output, no base',
    icon: <Activity size={13} />,
    color: '#f472b6',
    group: 'Base',
  },
  // ── Climate / NASA GIBS ────────────────────────────────────────────────────
  {
    id: 'precipitation',
    label: 'IMERG Rain',
    sublabel: 'NASA precipitation rate',
    icon: <CloudRain size={13} />,
    color: '#818cf8',
    badge: 'NASA GIBS',
    group: 'NASA',
  },
  {
    id: 'cloud',
    label: 'Cloud Cover',
    sublabel: 'MODIS cloud fraction',
    icon: <Cloud size={13} />,
    color: '#94a3b8',
    badge: 'NASA GIBS',
    group: 'NASA',
  },
  {
    id: 'sst',
    label: 'Sea Surface T.',
    sublabel: 'GHRSST MUR SST',
    icon: <Thermometer size={13} />,
    color: '#f97316',
    badge: 'NASA GIBS',
    group: 'NASA',
  },
  {
    id: 'aerosol',
    label: 'Aerosol Depth',
    sublabel: 'MODIS AOD 3km',
    icon: <Wind size={13} />,
    color: '#a78bfa',
    badge: 'NASA GIBS',
    group: 'NASA',
  },
  {
    id: 'ndvi',
    label: 'Vegetation',
    sublabel: 'MODIS NDVI 8-day',
    icon: <TreePine size={13} />,
    color: '#22c55e',
    badge: 'NASA GIBS',
    group: 'NASA',
  },
  {
    id: 'modis_lst',
    label: 'Land Surface T.',
    sublabel: 'MODIS Terra LST Day',
    icon: <Thermometer size={13} />,
    color: '#eab308',
    badge: 'NASA GIBS',
    group: 'NASA',
  },
  // ── Live Weather (OWM) ─────────────────────────────────────────────────────
  {
    id: 'owm_precip',
    label: 'Rain (Live)',
    sublabel: 'OpenWeatherMap live',
    icon: <CloudRain size={13} />,
    color: '#38bdf8',
    badge: 'OWM Live',
    group: 'Live',
  },
  {
    id: 'owm_temp',
    label: 'Temp (Live)',
    sublabel: 'OpenWeatherMap live',
    icon: <Thermometer size={13} />,
    color: '#fb923c',
    badge: 'OWM Live',
    group: 'Live',
  },
  {
    id: 'owm_wind',
    label: 'Wind (Live)',
    sublabel: 'OpenWeatherMap live',
    icon: <Droplets size={13} />,
    color: '#a5f3fc',
    badge: 'OWM Live',
    group: 'Live',
  },
];

const GROUPS = ['Base', 'NASA', 'Live'];

const GROUP_LABELS: Record<string, string> = {
  Base: 'Base Imagery',
  NASA: 'NASA / GIBS',
  Live: 'Live Weather',
};

interface LayerControlPanelProps {
  activeLayer: EarthLayer;
  onLayerChange: (layer: EarthLayer) => void;
  gibsDate?: string;
  onDateChange?: (date: string) => void;
}

export default function LayerControlPanel({
  activeLayer,
  onLayerChange,
  gibsDate,
  onDateChange,
}: LayerControlPanelProps) {
  const today = new Date().toISOString().split('T')[0];
  const timeAwareLayers = ['modis', 'precipitation', 'cloud', 'sst', 'aerosol', 'ndvi', 'fires', 'modis_lst'];

  return (
    <div className="flex flex-col gap-2">

      {/* Header */}
      <div className="flex items-center gap-2 px-1">
        <Layers size={11} className="text-white/40" />
        <span className="text-[10px] text-white/40 uppercase tracking-wider font-medium">Earth Layers</span>
      </div>

      {/* Grouped layer buttons */}
      {GROUPS.map((group) => {
        const opts = LAYER_OPTIONS.filter((o) => o.group === group);
        return (
          <div key={group} className="flex flex-col gap-1">
            <div className="px-1 text-[9px] text-white/25 uppercase tracking-widest font-semibold">
              {GROUP_LABELS[group]}
            </div>
            <div className="grid grid-cols-2 gap-1">
              {opts.map((opt) => {
                const active = activeLayer === opt.id;
                return (
                  <button
                    key={opt.id}
                    onClick={() => onLayerChange(opt.id)}
                    title={opt.label + ': ' + opt.sublabel}
                    className={`
                      relative flex items-start gap-1.5 p-2 rounded-lg border text-left transition-all duration-200 cursor-pointer
                      ${active
                        ? 'border-blue-500/60 bg-blue-500/15 shadow-[0_0_8px_rgba(59,130,246,0.15)]'
                        : 'border-white/10 bg-white/5 hover:bg-white/8 hover:border-white/20 hover:scale-[1.02]'}
                    `}
                    style={{
                      borderColor: active ? opt.color + '80' : undefined,
                      background: active ? opt.color + '18' : undefined,
                      boxShadow: active ? `0 0 8px ${opt.color}25` : undefined,
                    }}
                  >
                    <span style={{ color: active ? opt.color : '#6b7280' }} className="mt-0.5 shrink-0">
                      {opt.icon}
                    </span>
                    <div className="min-w-0">
                      <div className={`text-[10px] font-medium truncate leading-tight ${active ? 'text-white' : 'text-white/60'}`}>
                        {opt.label}
                      </div>
                      <div className="text-[9px] text-white/30 truncate leading-tight">{opt.sublabel}</div>
                      {opt.badge && (
                        <span
                          className="inline-block mt-0.5 px-1 py-px text-[8px] rounded border"
                          style={{
                            background: opt.color + '15',
                            color: opt.color + 'cc',
                            borderColor: opt.color + '30',
                          }}
                        >
                          {opt.badge}
                        </span>
                      )}
                    </div>
                    {active && (
                      <div
                        className="absolute right-1.5 top-1.5 w-1.5 h-1.5 rounded-full animate-pulse"
                        style={{ backgroundColor: opt.color }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Date picker for time-aware NASA GIBS layers */}
      {timeAwareLayers.includes(activeLayer) && onDateChange && (
        <div className="mt-1">
          <label className="block text-[10px] text-white/40 mb-1">
            Layer Date
          </label>
          <input
            type="date"
            value={gibsDate || today}
            max={today}
            min="2012-01-01"
            onChange={(e) => onDateChange(e.target.value)}
            className="w-full text-[11px] bg-white/5 border border-white/15 rounded px-2 py-1 text-white/70 focus:outline-none focus:border-blue-500/50"
          />
          <div className="text-[9px] text-white/25 mt-0.5">NASA GIBS imagery is delayed ~3 days</div>
        </div>
      )}

      {/* Free tier info */}
      <div className="px-2 py-1.5 rounded" style={{ background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.12)' }}>
        <div className="text-[9px] text-green-400/60 leading-tight">
          ✓ NASA GIBS layers are <strong className="text-green-400/80">completely free</strong>, no API key required.
        </div>
      </div>
    </div>
  );
}
