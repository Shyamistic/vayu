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
 */
import { Layers, Satellite, CloudRain, Cloud, Moon, Activity } from 'lucide-react';
import type { EarthLayer } from './CesiumGlobe';

interface LayerOption {
  id: EarthLayer;
  label: string;
  sublabel: string;
  icon: React.ReactNode;
  color: string;
  badge?: string;
}

const LAYER_OPTIONS: LayerOption[] = [
  {
    id: 'satellite',
    label: 'Satellite',
    sublabel: 'Bing/Cesium Ion high-res',
    icon: <Satellite size={14} />,
    color: '#60a5fa',
  },
  {
    id: 'modis',
    label: 'MODIS Terra',
    sublabel: 'NASA daily true-colour',
    icon: <Satellite size={14} />,
    color: '#34d399',
    badge: 'NASA GIBS',
  },
  {
    id: 'precipitation',
    label: 'IMERG Rain',
    sublabel: 'NASA precipitation rate',
    icon: <CloudRain size={14} />,
    color: '#818cf8',
    badge: 'NASA GIBS',
  },
  {
    id: 'cloud',
    label: 'Cloud Cover',
    sublabel: 'MODIS cloud fraction',
    icon: <Cloud size={14} />,
    color: '#94a3b8',
    badge: 'NASA GIBS',
  },
  {
    id: 'nightlights',
    label: 'Night Lights',
    sublabel: 'Earth at Night (2016)',
    icon: <Moon size={14} />,
    color: '#fbbf24',
    badge: 'Ion',
  },
  {
    id: 'vayu',
    label: 'VAYU Only',
    sublabel: 'Model output, no base',
    icon: <Activity size={14} />,
    color: '#f472b6',
  },
];

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

  return (
    <div className="flex flex-col gap-2">

      {/* Header */}
      <div className="flex items-center gap-2 px-1 mb-1">
        <Layers size={12} className="text-white/40" />
        <span className="text-xs text-white/40 uppercase tracking-wider font-medium">Earth Layers</span>
      </div>

      {/* Layer buttons */}
      <div className="grid grid-cols-2 gap-1.5">
        {LAYER_OPTIONS.map((opt) => {
          const active = activeLayer === opt.id;
          return (
            <button
              key={opt.id}
              onClick={() => onLayerChange(opt.id)}
              className={`
                relative flex items-start gap-2 p-2.5 rounded-lg border text-left transition-all duration-200
                ${active
                  ? 'border-blue-500/60 bg-blue-500/15 shadow-[0_0_12px_rgba(59,130,246,0.2)]'
                  : 'border-white/10 bg-white/5 hover:bg-white/8 hover:border-white/20'}
              `}
            >
              <span style={{ color: active ? opt.color : '#6b7280' }} className="mt-0.5 shrink-0">
                {opt.icon}
              </span>
              <div className="min-w-0">
                <div className={`text-xs font-medium truncate ${active ? 'text-white' : 'text-white/60'}`}>
                  {opt.label}
                </div>
                <div className="text-xs text-white/30 truncate">{opt.sublabel}</div>
                {opt.badge && (
                  <span className="inline-block mt-0.5 px-1 py-px text-[9px] rounded bg-blue-500/20 text-blue-300/70 border border-blue-400/20">
                    {opt.badge}
                  </span>
                )}
              </div>
              {active && (
                <div
                  className="absolute right-2 top-2 w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: opt.color }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Date picker for time-aware NASA GIBS layers */}
      {(activeLayer === 'modis' || activeLayer === 'precipitation' || activeLayer === 'cloud') && onDateChange && (
        <div className="mt-1">
          <label className="block text-xs text-white/40 mb-1">
            Layer Date
          </label>
          <input
            type="date"
            value={gibsDate || today}
            max={today}
            min="2012-01-01"
            onChange={(e) => onDateChange(e.target.value)}
            className="w-full text-xs bg-white/5 border border-white/15 rounded px-2 py-1.5 text-white/70 focus:outline-none focus:border-blue-500/50"
          />
          <div className="text-xs text-white/25 mt-1">NASA GIBS imagery is delayed ~3 days</div>
        </div>
      )}

      {/* Free tier info */}
      <div className="mt-1 px-2 py-2 rounded bg-green-500/5 border border-green-500/15">
        <div className="text-xs text-green-400/60">
          ✓ All NASA GIBS layers are <strong className="text-green-400/80">completely free</strong>, no API key required.
          Powered by NASA Earthdata GIBS + Cesium Ion.
        </div>
      </div>
    </div>
  );
}
