/**
 * VariableDataPanel — floating top-right card summarizing the active
 * forecast variable: which dataset backs it, how it's being visualized
 * (colormap, heatmap opacity/pulse animation), and its legend — matching
 * the reference redesign mockup's DATA / VISUALIZATION / LEGEND layout.
 * Every control here is wired to a real, already-existing piece of app
 * state (colormap, heatmap layer alpha/pulse, selected variable) rather
 * than being decorative.
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronsLeft, ChevronsRight, X, Info, CloudRain, Thermometer } from 'lucide-react';
import type { VariableId } from '../types';
import type { ColormapId } from '../utils/colorScales';
import { COLORMAP_META } from '../utils/colorScales';
import ColorLegend from './ColorLegend';

interface VariableDataPanelProps {
  variable: VariableId;
  onVariableChange: (v: VariableId) => void;
  colormap: ColormapId | undefined;
  defaultColormap: ColormapId;
  onColormapChange: (id: ColormapId) => void;
  opacity: number; // 0–1
  onOpacityChange: (v: number) => void;
  animated: boolean;
  onAnimatedChange: (v: boolean) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onClose: () => void;
}

const VARIABLE_META: Record<VariableId, { label: string; icon: typeof CloudRain; source: string; unit: string; description: string }> = {
  rainfall: {
    label: 'Rainfall',
    icon: CloudRain,
    source: 'IMD Gridded Rainfall (0.25°, 2010–2025)',
    unit: 'mm/day',
    description: 'India Meteorological Department gridded daily rainfall, 0.25° resolution, 2010–2025.',
  },
  temp_max: {
    label: 'Tmax',
    icon: Thermometer,
    source: 'IMD Temperature (1.0°, 2010–2025)',
    unit: '°C',
    description: 'India Meteorological Department gridded daily maximum temperature, 1.0° resolution, 2010–2025.',
  },
  temp_min: {
    label: 'Tmin',
    icon: Thermometer,
    source: 'IMD Temperature (1.0°, 2010–2025)',
    unit: '°C',
    description: 'India Meteorological Department gridded daily minimum temperature, 1.0° resolution, 2010–2025.',
  },
};

const VARIABLE_ORDER: VariableId[] = ['rainfall', 'temp_max', 'temp_min'];

/** Collapsible section header — the DATA / VISUALIZATION / LEGEND labels
 *  in the reference mockup, each toggleable independently. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-foreground/45 hover:text-foreground/70 transition-colors"
      >
        {title}
        <ChevronDown size={12} className={`transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && children}
    </div>
  );
}

/** Small dropdown used for both the Variable and Color Scale pickers —
 *  same click-to-open/click-outside-to-close pattern as RegionSelector. */
function InlineDropdown<T extends string>({
  value,
  label,
  options,
  onChange,
}: {
  value: T;
  label: string;
  options: { id: T; label: string }[];
  onChange: (id: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between gap-2 w-full text-xs px-2.5 py-1.5 rounded-lg transition-colors"
        style={{ background: 'rgba(var(--fg-rgb),var(--fg-a05))', color: 'rgba(var(--fg-rgb),var(--fg-a85))' }}
      >
        {label}
        <ChevronDown size={12} className={`text-foreground/40 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          className="absolute top-full mt-1 right-0 z-50 min-w-full max-w-[240px] rounded-xl p-1 flex flex-col gap-0.5 shadow-2xl max-h-64 overflow-y-auto"
          style={{
            background: 'rgba(var(--panel-bg-rgb),0.98)',
            border: '1px solid rgba(var(--fg-rgb),var(--fg-a12))',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
          }}
        >
          {options.map((opt) => (
            <button
              key={opt.id}
              onClick={() => { onChange(opt.id); setOpen(false); }}
              className={`text-xs px-2.5 py-1.5 rounded-lg text-left transition-colors whitespace-nowrap ${
                opt.id === value ? 'bg-blue-500/20 text-blue-300 font-medium' : 'text-foreground/70 hover:bg-foreground/10 hover:text-foreground/90'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className="relative w-9 h-5 rounded-full transition-colors shrink-0"
      style={{ background: on ? '#0ea5e9' : 'rgba(var(--fg-rgb),var(--fg-a15))' }}
      role="switch"
      aria-checked={on}
    >
      <span
        className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all"
        style={{ left: on ? 18 : 2 }}
      />
    </button>
  );
}

export default function VariableDataPanel({
  variable,
  onVariableChange,
  colormap,
  defaultColormap,
  onColormapChange,
  opacity,
  onOpacityChange,
  animated,
  onAnimatedChange,
  collapsed,
  onToggleCollapsed,
  onClose,
}: VariableDataPanelProps) {
  const [aboutOpen, setAboutOpen] = useState(false);
  const meta = VARIABLE_META[variable];
  const Icon = meta.icon;
  const activeColormap = colormap ?? defaultColormap;
  const colormapOptions = COLORMAP_META.filter((m) => m.forVariable.includes(variable));

  if (collapsed) {
    return (
      <div
        className="flex flex-col items-center gap-2 p-2 rounded-2xl"
        style={{
          background: 'rgba(var(--panel-bg-rgb),0.92)',
          border: '1px solid rgba(var(--fg-rgb),var(--fg-a08))',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
        }}
      >
        <Icon size={16} className="text-foreground/70" />
        <button onClick={onToggleCollapsed} title="Expand" className="text-foreground/40 hover:text-foreground/70">
          <ChevronsLeft size={14} />
        </button>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-3 p-3.5 w-[300px] rounded-2xl"
      style={{
        background: 'rgba(var(--panel-bg-rgb),0.92)',
        border: '1px solid rgba(var(--fg-rgb),var(--fg-a08))',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <Icon size={16} className="text-vayu-blue shrink-0" />
        <span className="text-sm font-semibold text-foreground/90 flex-1">{meta.label}</span>
        <button onClick={onToggleCollapsed} title="Collapse" className="text-foreground/40 hover:text-foreground/70">
          <ChevronsRight size={15} />
        </button>
        <button onClick={onClose} title="Close" className="text-foreground/40 hover:text-foreground/70">
          <X size={15} />
        </button>
      </div>

      {/* DATA */}
      <Section title="Data">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-foreground/50 shrink-0">Source</span>
            <span className="text-xs text-foreground/80 text-right truncate" title={meta.source}>{meta.source}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-foreground/50 shrink-0">Variable</span>
            <div className="w-[150px]">
              <InlineDropdown
                value={variable}
                label={meta.label}
                options={VARIABLE_ORDER.map((id) => ({ id, label: VARIABLE_META[id].label }))}
                onChange={onVariableChange}
              />
            </div>
          </div>
        </div>
      </Section>

      {/* VISUALIZATION */}
      <Section title="Visualization">
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-foreground/50">Opacity</span>
            <div className="flex items-center gap-2 flex-1 max-w-[160px]">
              <input
                type="range"
                min={0.2}
                max={1}
                step={0.01}
                value={opacity}
                onChange={(e) => onOpacityChange(Number(e.target.value))}
                className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer accent-vayu-blue"
                style={{ background: 'rgba(var(--fg-rgb),var(--fg-a15))' }}
              />
              <span className="text-[10px] font-mono text-foreground/50 w-8 text-right">{Math.round(opacity * 100)}%</span>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-foreground/50">Color Scale</span>
            <div className="w-[150px]">
              <InlineDropdown
                value={activeColormap}
                label={colormapOptions.find((c) => c.id === activeColormap)?.label ?? activeColormap}
                options={colormapOptions.map((c) => ({ id: c.id, label: c.label }))}
                onChange={onColormapChange}
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-foreground/50">Animation</span>
            <Toggle on={animated} onChange={onAnimatedChange} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-foreground/50">Units</span>
            <span className="text-xs text-foreground/70 font-mono">{meta.unit}</span>
          </div>
        </div>
      </Section>

      {/* LEGEND */}
      <Section title="Legend">
        <ColorLegend variable={variable} bare />
      </Section>

      {/* About Dataset */}
      <div className="pt-1" style={{ borderTop: '1px solid rgba(var(--fg-rgb),var(--fg-a08))' }}>
        <button
          onClick={() => setAboutOpen((v) => !v)}
          className="flex items-center gap-1.5 text-xs text-foreground/50 hover:text-foreground/80 transition-colors"
        >
          <Info size={12} />
          About Dataset
          <ChevronDown size={11} className={`transition-transform ${aboutOpen ? 'rotate-180' : ''}`} />
        </button>
        {aboutOpen && (
          <p className="text-[11px] text-foreground/50 leading-relaxed mt-1.5">{meta.description}</p>
        )}
      </div>
    </div>
  );
}
