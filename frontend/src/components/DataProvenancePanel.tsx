import { Database, Satellite, Globe, GitBranch } from 'lucide-react';

export default function DataProvenancePanel() {
  return (
    <div className="panel p-4 flex flex-col gap-4 w-full">
      <h2 className="text-foreground font-semibold text-sm flex items-center gap-2">
        <Database size={14} className="text-vayu-accent" />
        Data Provenance
      </h2>

      {/* IMD Source */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <Globe size={12} className="text-vayu-blue" />
          <span className="text-xs font-medium text-foreground/80">IMD Gridded Data</span>
        </div>
        <div className="pl-5 flex flex-col gap-1">
          <ProvRow label="Rainfall" value="0.25°×0.25° · 1901–2025 · Daily" />
          <ProvRow label="Tmax/Tmin" value="1.0°×1.0° · 1951–2025 · Daily" />
          <ProvRow label="Source" value="imdpune.gov.in" link="https://imdpune.gov.in/cmpg/Griddata/" />
          <ProvRow label="Format" value="Binary .grd (float32, LE)" />
        </div>
      </div>

      {/* MOSDAC Source */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <Satellite size={12} className="text-vayu-accent" />
          <span className="text-xs font-medium text-foreground/80">INSAT-3D/3DR (MOSDAC)</span>
        </div>
        <div className="pl-5 flex flex-col gap-1">
          <ProvRow label="LST" value="3RIMG_L2B_LST · ~4km · Daily" />
          <ProvRow label="SST" value="3RIMG_L2B_SST · ~4km · Daily" />
          <ProvRow label="Rainfall" value="3RIMG_L2B_IMC · ~4km · Daily" />
          <ProvRow label="Source" value="mosdac.gov.in" link="https://mosdac.gov.in" />
          <ProvRow label="Format" value="HDF5" />
        </div>
      </div>

      {/* Model info */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <GitBranch size={12} className="text-green-400" />
          <span className="text-xs font-medium text-foreground/80">AI Model</span>
        </div>
        <div className="pl-5 flex flex-col gap-1">
          <ProvRow label="Architecture" value="GraphSAGE (3L) + Transformer (4L)" />
          <ProvRow label="Parameters" value="~10M (RTX 4050 compatible)" />
          <ProvRow label="Train period" value="1951–2020" />
          <ProvRow label="Test period" value="2024–2025" />
          <ProvRow label="Pilot region" value="8–20°N, 72–78°E (Western India)" />
          <ProvRow label="Spatial res." value="0.25° (~28 km)" />
          <ProvRow label="Forecast" value="T+1 to T+7 days" />
        </div>
      </div>

      {/* Limitations */}
      <div className="p-2.5 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
        <p className="text-xs text-yellow-300/70 font-medium mb-1">Limitations</p>
        <ul className="text-xs text-foreground/40 space-y-0.5 list-disc list-inside">
          <li>Pilot region only (Western India)</li>
          <li>Extreme events may be under-predicted</li>
          <li>Accuracy decreases at T+5 to T+7</li>
          <li>Not validated for cyclone prediction</li>
        </ul>
      </div>
    </div>
  );
}

function ProvRow({
  label,
  value,
  link,
}: {
  label: string;
  value: string;
  link?: string;
}) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-xs text-foreground/30 shrink-0">{label}</span>
      {link ? (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-vayu-blue hover:text-vayu-accent truncate"
        >
          {value}
        </a>
      ) : (
        <span className="text-xs text-foreground/60 truncate text-right">{value}</span>
      )}
    </div>
  );
}
