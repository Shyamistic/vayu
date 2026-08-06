/**
 * ExportTools — Feature 27
 * Screenshot capture of the globe + overlays, and CSV/JSON data export.
 * Uses html2canvas for screenshotting and native browser download for CSV.
 */
import { useState, useCallback } from 'react';
import { Camera, Download, FileText, Loader } from 'lucide-react';
import { format } from 'date-fns';
import type { GridCell, VariableId } from '../types';

interface ExportToolsProps {
  gridCells: GridCell[];
  variable: VariableId;
  selectedDate: Date;
  region: string;
}

function downloadText(content: string, filename: string, mime = 'text/plain') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ExportTools({ gridCells, variable, selectedDate, region }: ExportToolsProps) {
  const [screenshotting, setScreenshotting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const handleScreenshot = useCallback(async () => {
    setScreenshotting(true);
    try {
      // Find the Cesium canvas
      const canvas = document.querySelector('.cesium-widget canvas') as HTMLCanvasElement | null;
      if (!canvas) throw new Error('Globe canvas not found');

      // Get the WebGL context and read pixels
      const w = canvas.width;
      const h = canvas.height;

      // Create an offscreen canvas and copy
      const offscreen = document.createElement('canvas');
      offscreen.width = w;
      offscreen.height = h;
      const ctx = offscreen.getContext('2d')!;

      // Draw the cesium canvas first
      ctx.drawImage(canvas, 0, 0);

      // Add a watermark
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, h - 32, 320, 32);
      ctx.fillStyle = 'rgba(var(--fg-rgb),var(--fg-a75))';
      ctx.font = '12px JetBrains Mono, monospace';
      ctx.fillText(
        `VAYU Climate AI · ${format(selectedDate, 'dd MMM yyyy')} · ${region}`,
        8,
        h - 10,
      );

      const dataURL = offscreen.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataURL;
      a.download = `vayu_globe_${format(selectedDate, 'yyyyMMdd')}.png`;
      a.click();
      showToast('Screenshot saved');
    } catch (err) {
      showToast('Screenshot failed — try from browser devtools');
      console.warn('[VAYU Export]', err);
    } finally {
      setScreenshotting(false);
    }
  }, [selectedDate, region]);

  const handleCSVExport = useCallback(() => {
    if (gridCells.length === 0) {
      showToast('No prediction data to export');
      return;
    }
    const header = 'lat,lon,node_idx,rainfall_mm,temp_max_c,temp_min_c,rain_uncertainty,tmax_uncertainty,tmin_uncertainty';
    const rows = gridCells.map(
      (c) =>
        `${c.lat.toFixed(4)},${c.lon.toFixed(4)},${c.node_idx},` +
        `${c.rainfall.toFixed(3)},${c.temp_max.toFixed(3)},${c.temp_min.toFixed(3)},` +
        `${c.rainfall_uncertainty.toFixed(3)},${c.temp_max_uncertainty.toFixed(3)},${c.temp_min_uncertainty.toFixed(3)}`,
    );
    const csv = [header, ...rows].join('\n');
    const filename = `vayu_prediction_${region}_${format(selectedDate, 'yyyyMMdd')}.csv`;
    downloadText(csv, filename, 'text/csv');
    showToast(`Exported ${gridCells.length} grid cells`);
  }, [gridCells, selectedDate, region]);

  const handleJSONExport = useCallback(() => {
    if (gridCells.length === 0) {
      showToast('No prediction data to export');
      return;
    }
    const payload = {
      meta: {
        source: 'VAYU Climate AI',
        version: '1.0',
        date: format(selectedDate, 'yyyy-MM-dd'),
        region,
        variable,
        grid_resolution: '0.25deg',
        exported_at: new Date().toISOString(),
      },
      grid_cells: gridCells,
    };
    const json = JSON.stringify(payload, null, 2);
    const filename = `vayu_prediction_${region}_${format(selectedDate, 'yyyyMMdd')}.json`;
    downloadText(json, filename, 'application/json');
    showToast('JSON exported');
  }, [gridCells, selectedDate, region, variable]);

  return (
    <div className="panel-tight p-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Download size={12} className="text-foreground/40" />
        <span className="text-[10px] text-foreground/40 uppercase tracking-wider font-medium">Export</span>
      </div>

      <div className="flex gap-1.5">
        <button
          onClick={handleScreenshot}
          disabled={screenshotting}
          className="flex items-center gap-1.5 flex-1 px-2.5 py-2 rounded-lg text-[11px] font-medium transition-all active:scale-95"
          style={{
            background: 'rgba(14,165,233,0.12)',
            border: '1px solid rgba(14,165,233,0.3)',
            color: '#38bdf8',
          }}
        >
          {screenshotting ? (
            <Loader size={11} className="animate-spin" />
          ) : (
            <Camera size={11} />
          )}
          Screenshot
        </button>
        <button
          onClick={handleCSVExport}
          className="flex items-center gap-1.5 flex-1 px-2.5 py-2 rounded-lg text-[11px] font-medium transition-all active:scale-95"
          style={{
            background: 'rgba(34,197,94,0.10)',
            border: '1px solid rgba(34,197,94,0.25)',
            color: '#86efac',
          }}
        >
          <FileText size={11} />
          CSV
        </button>
        <button
          onClick={handleJSONExport}
          className="flex items-center gap-1.5 flex-1 px-2.5 py-2 rounded-lg text-[11px] font-medium transition-all active:scale-95"
          style={{
            background: 'rgba(168,85,247,0.10)',
            border: '1px solid rgba(168,85,247,0.25)',
            color: '#d8b4fe',
          }}
        >
          <Download size={11} />
          JSON
        </button>
      </div>

      {toast && (
        <div
          className="text-[10px] text-center py-1 rounded animate-slide-in-up"
          style={{ background: 'rgba(34,197,94,0.12)', color: '#86efac', border: '1px solid rgba(34,197,94,0.2)' }}
        >
          ✓ {toast}
        </div>
      )}

      <p className="text-[9px] text-foreground/20 text-center">
        {gridCells.length} cells · {format(selectedDate, 'dd MMM yyyy')}
      </p>
    </div>
  );
}
