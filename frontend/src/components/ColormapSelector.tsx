/**
 * ColormapSelector — Scientific colormap picker for VAYU
 * Ported colormap concepts from fluid-earth colormaps/index.js
 */
import { COLORMAP_META, mapColor } from '../utils/colorScales';
import type { ColormapId } from '../utils/colorScales';
import type { VariableId } from '../types';

interface ColormapSelectorProps {
  variable: VariableId;
  selected: ColormapId;
  onChange: (id: ColormapId) => void;
}

function ColormapSwatch({ id }: { id: ColormapId }) {
  const stops = Array.from({ length: 20 }, (_, i) => mapColor(i / 19, id, 1));
  return (
    <div
      className="h-2.5 rounded-sm w-full"
      style={{
        background: `linear-gradient(to right, ${stops.join(', ')})`,
      }}
    />
  );
}

export default function ColormapSelector({ variable, selected, onChange }: ColormapSelectorProps) {
  const available = COLORMAP_META.filter((m) => m.forVariable.includes(variable));

  return (
    <div className="panel-tight p-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-white/40 uppercase tracking-wider font-medium">Colormap</span>
        <span
          className="text-[9px] px-1.5 py-0.5 rounded font-mono ml-auto"
          style={{ background: 'rgba(14,165,233,0.1)', color: '#38bdf8', border: '1px solid rgba(14,165,233,0.2)' }}
        >
          fluid-earth
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        {available.map((meta) => (
          <button
            key={meta.id}
            onClick={() => onChange(meta.id)}
            className="flex flex-col gap-0.5 rounded-lg p-1.5 text-left transition-all"
            style={{
              background: selected === meta.id ? 'rgba(14,165,233,0.12)' : 'rgba(255,255,255,0.03)',
              border: selected === meta.id ? '1px solid rgba(14,165,233,0.35)' : '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <ColormapSwatch id={meta.id} />
            <div className="flex items-center justify-between mt-0.5">
              <span className={`text-[10px] font-medium ${selected === meta.id ? 'text-white/90' : 'text-white/55'}`}>
                {meta.label}
              </span>
              <span className="text-[9px] text-white/25">{meta.desc}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
