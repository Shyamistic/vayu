/**
 * ModelInfoCard — Compact VAYU model architecture summary.
 * Designed for hackathon judges: shows architecture diagram, key stats,
 * training data sources, and research references.
 */
import { Brain, Database, BookOpen, Cpu, Layers, GitBranch } from 'lucide-react';

export default function ModelInfoCard() {
  return (
    <div className="panel p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Brain size={14} className="text-[#22d3ee]" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground/70">
          VAYU Model Architecture
        </h3>
        <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded-full bg-[#0ea5e9]/15 text-[#22d3ee] font-mono">
          v2.1
        </span>
      </div>

      {/* Architecture pipeline */}
      <div className="px-2 py-2.5 rounded-lg" style={{ background: 'rgba(14,165,233,0.05)' }}>
        <div className="flex items-center gap-1 text-[10px] font-mono overflow-x-auto">
          <span className="px-2 py-1 rounded bg-foreground/5 text-[#22d3ee] whitespace-nowrap">
            Input (17F)
          </span>
          <span className="text-foreground/30">→</span>
          <span className="px-2 py-1 rounded bg-foreground/5 text-[#0ea5e9] whitespace-nowrap">
            GATv2Conv(4L)
          </span>
          <span className="text-foreground/30">→</span>
          <span className="px-2 py-1 rounded bg-foreground/5 text-violet-400 whitespace-nowrap">
            Transformer(6L)
          </span>
          <span className="text-foreground/30">→</span>
          <span className="px-2 py-1 rounded bg-foreground/5 text-emerald-400 whitespace-nowrap">
            Pred Heads
          </span>
        </div>
      </div>

      {/* Key statistics */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <Cpu size={11} className="text-foreground/40" />
          <div>
            <p className="text-[10px] text-foreground/50">Parameters</p>
            <p className="text-xs font-mono font-medium text-foreground/85">9.5M</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Layers size={11} className="text-foreground/40" />
          <div>
            <p className="text-[10px] text-foreground/50">Window</p>
            <p className="text-xs font-mono font-medium text-foreground/85">45 days</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <GitBranch size={11} className="text-foreground/40" />
          <div>
            <p className="text-[10px] text-foreground/50">Graph Nodes</p>
            <p className="text-xs font-mono font-medium text-foreground/85">1,311</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Database size={11} className="text-foreground/40" />
          <div>
            <p className="text-[10px] text-foreground/50">Features</p>
            <p className="text-xs font-mono font-medium text-foreground/85">17 / node</p>
          </div>
        </div>
      </div>

      {/* Training data sources */}
      <div className="border-t border-foreground/5 pt-2">
        <div className="flex items-center gap-1.5 mb-1.5">
          <Database size={10} className="text-foreground/40" />
          <span className="text-[10px] text-foreground/50 uppercase tracking-wide">Training Data (2010–2025)</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[
            { name: 'IMD', desc: 'Gridded Rain/Temp' },
            { name: 'NCEP/NCAR', desc: 'Reanalysis' },
            { name: 'CHIRPS', desc: 'Satellite Precip' },
            { name: 'GEBCO', desc: 'Bathymetry/DEM' },
            { name: 'ERA5', desc: 'Pressure/Humidity' },
          ].map((src) => (
            <span
              key={src.name}
              className="text-[9px] px-1.5 py-0.5 rounded bg-foreground/5 text-foreground/60"
              title={src.desc}
            >
              {src.name}
            </span>
          ))}
        </div>
      </div>

      {/* Loss functions & innovations */}
      <div className="border-t border-foreground/5 pt-2">
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className="text-[10px] text-foreground/50 uppercase tracking-wide">Key Innovations</span>
        </div>
        <ul className="space-y-0.5 text-[10px] text-foreground/55 list-none">
          <li className="flex items-center gap-1.5">
            <span className="w-1 h-1 rounded-full bg-[#22d3ee]" />
            Tweedie loss for zero-inflated rainfall
          </li>
          <li className="flex items-center gap-1.5">
            <span className="w-1 h-1 rounded-full bg-[#0ea5e9]" />
            Multi-scale graph (district + state edges)
          </li>
          <li className="flex items-center gap-1.5">
            <span className="w-1 h-1 rounded-full bg-violet-400" />
            Learned uncertainty via β-NLL
          </li>
        </ul>
      </div>

      {/* Research references */}
      <div className="border-t border-foreground/5 pt-2">
        <div className="flex items-center gap-1.5 mb-1">
          <BookOpen size={10} className="text-foreground/40" />
          <span className="text-[10px] text-foreground/50 uppercase tracking-wide">References</span>
        </div>
        <div className="space-y-0.5 text-[9px] text-foreground/40 font-mono">
          <p>• GATv2 — Brody et al., ICLR 2022</p>
          <p>• Tweedie Loss — Jørgensen, 1997</p>
          <p>• β-NLL — Seitzer et al., NeurIPS 2022</p>
          <p>• GraphCast — Lam et al., Science 2023</p>
        </div>
      </div>
    </div>
  );
}
