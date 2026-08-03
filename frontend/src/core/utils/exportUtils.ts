/**
 * Data Export Utilities
 *
 * Pure functions for exporting climate data in various formats:
 * CSV, GeoTIFF, globe screenshot (PNG), and WebM animation recording.
 *
 * Requirements: 28.1, 28.2, 28.4, 28.5
 */

import type { GridCell } from '../../types';

// ── Types ─────────────────────────────────────────────────────────────────────

/** A single row in the exported CSV */
export interface CsvRow {
  lat: number;
  lon: number;
  date: string;
  rainfall: number;
  temp_max: number;
  temp_min: number;
  rainfall_uncertainty: number;
  temp_max_uncertainty: number;
  temp_min_uncertainty: number;
}

/** Options for CSV export */
export interface CsvExportOptions {
  /** ISO-8601 date string (e.g. "2025-07-15") written into every row */
  date: string;
  /** Decimal places to round numeric values (default: 4) */
  precision?: number;
}

/** GeoTIFF bounding box derived from grid cells */
export interface GeoBounds {
  west: number;
  east: number;
  south: number;
  north: number;
}

/** Minimal GeoTIFF metadata record (EPSG:4326) */
export interface GeoTiffMetadata {
  crs: string;
  bounds: GeoBounds;
  width: number;
  height: number;
  pixelWidth: number;
  pixelHeight: number;
  variable: string;
  generatedAt: string;
}

// ── CSV Export ────────────────────────────────────────────────────────────────

/** CSV header columns, matching Requirement 28.2 */
export const CSV_COLUMNS = [
  'lat',
  'lon',
  'date',
  'rainfall',
  'temp_max',
  'temp_min',
  'rainfall_uncertainty',
  'temp_max_uncertainty',
  'temp_min_uncertainty',
] as const;

/**
 * Convert a single GridCell to a CsvRow.
 */
export function gridCellToCsvRow(cell: GridCell, date: string): CsvRow {
  return {
    lat: cell.lat,
    lon: cell.lon,
    date,
    rainfall: cell.rainfall,
    temp_max: cell.temp_max,
    temp_min: cell.temp_min,
    rainfall_uncertainty: cell.rainfall_uncertainty,
    temp_max_uncertainty: cell.temp_max_uncertainty,
    temp_min_uncertainty: cell.temp_min_uncertainty,
  };
}

/**
 * Round a number to the given number of decimal places.
 */
function round(value: number, precision: number): number {
  const factor = Math.pow(10, precision);
  return Math.round(value * factor) / factor;
}

/**
 * Escape a CSV field value — wraps in quotes if it contains comma, quote, or newline.
 */
function escapeCsvField(value: string | number): string {
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Serialize a CsvRow to a single CSV line (no newline at end).
 */
export function csvRowToLine(row: CsvRow, precision = 4): string {
  return [
    round(row.lat, precision),
    round(row.lon, precision),
    escapeCsvField(row.date),
    round(row.rainfall, precision),
    round(row.temp_max, precision),
    round(row.temp_min, precision),
    round(row.rainfall_uncertainty, precision),
    round(row.temp_max_uncertainty, precision),
    round(row.temp_min_uncertainty, precision),
  ]
    .map(escapeCsvField)
    .join(',');
}

/**
 * Generate a complete CSV string from an array of GridCells.
 *
 * Produces a header row followed by one data row per cell.
 * All numeric values are rounded to `precision` decimal places.
 *
 * @param cells - Array of GridCell objects to export
 * @param options - Export options including date and precision
 * @returns Full CSV string (header + rows), CRLF line endings per RFC 4180
 */
export function generateCsv(cells: GridCell[], options: CsvExportOptions): string {
  const { date, precision = 4 } = options;
  const header = CSV_COLUMNS.join(',');
  const rows = cells.map(cell => {
    const row = gridCellToCsvRow(cell, date);
    return csvRowToLine(row, precision);
  });
  return [header, ...rows].join('\r\n');
}

/**
 * Parse a CSV string back into an array of CsvRow objects.
 *
 * Supports RFC 4180 quoting. Returns empty array for empty/header-only input.
 * Used for round-trip validation and data inspection.
 */
export function parseCsv(csv: string): CsvRow[] {
  const lines = csv.split('\r\n').filter(l => l.trim().length > 0);
  if (lines.length < 2) return [];

  // Skip header
  const dataLines = lines.slice(1);

  return dataLines.map(line => {
    const fields = parseCsvLine(line);
    return {
      lat: parseFloat(fields[0]),
      lon: parseFloat(fields[1]),
      date: fields[2],
      rainfall: parseFloat(fields[3]),
      temp_max: parseFloat(fields[4]),
      temp_min: parseFloat(fields[5]),
      rainfall_uncertainty: parseFloat(fields[6]),
      temp_max_uncertainty: parseFloat(fields[7]),
      temp_min_uncertainty: parseFloat(fields[8]),
    };
  });
}

/**
 * Parse a single CSV line into fields, handling RFC 4180 quoting.
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Trigger a browser file download for the given CSV string.
 *
 * Creates a temporary Blob URL, clicks it programmatically, then cleans up.
 * No-op in non-browser environments (SSR/test).
 *
 * @param csv - Full CSV string to download
 * @param filename - Desired download filename (default: "climate-data.csv")
 */
export function downloadCsv(csv: string, filename = 'climate-data.csv'): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, filename);
}

// ── GeoTIFF Export ────────────────────────────────────────────────────────────

/**
 * Compute geographic bounding box from an array of grid cells.
 *
 * Assumes cells are 0.25° grid points; extends bounds by half a cell (0.125°)
 * so the bounding box represents cell edges rather than centres.
 */
export function computeGeoBounds(cells: GridCell[]): GeoBounds {
  if (cells.length === 0) {
    return { west: 0, east: 0, south: 0, north: 0 };
  }
  const halfCell = 0.125;
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  for (const cell of cells) {
    if (cell.lon - halfCell < west) west = cell.lon - halfCell;
    if (cell.lon + halfCell > east) east = cell.lon + halfCell;
    if (cell.lat - halfCell < south) south = cell.lat - halfCell;
    if (cell.lat + halfCell > north) north = cell.lat + halfCell;
  }
  return { west, east, south, north };
}

/**
 * Build GeoTIFF metadata describing EPSG:4326 grid raster properties.
 *
 * This metadata can be used by GIS tools to properly geo-reference the raster.
 * For actual binary GeoTIFF generation, a server-side or WASM-based library
 * (e.g. geotiff.js write support) would encode this into the TIFF IFD tags.
 *
 * @param cells - Grid cells to derive spatial extent from
 * @param variable - The climate variable being exported
 * @returns GeoTiffMetadata describing the raster's CRS and transform
 */
export function buildGeoTiffMetadata(
  cells: GridCell[],
  variable: string
): GeoTiffMetadata {
  const bounds = computeGeoBounds(cells);
  const uniqueLats = Array.from(new Set(cells.map(c => c.lat)));
  const uniqueLons = Array.from(new Set(cells.map(c => c.lon)));
  const height = uniqueLats.length;
  const width = uniqueLons.length;
  // Pixel size = spatial extent / number of pixels (degrees per pixel)
  const pixelWidth = width > 1 ? (bounds.east - bounds.west) / width : 0.25;
  const pixelHeight = height > 1 ? (bounds.north - bounds.south) / height : 0.25;

  return {
    crs: 'EPSG:4326',
    bounds,
    width,
    height,
    pixelWidth,
    pixelHeight,
    variable,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Export grid cells as a GeoTIFF-compatible JSON metadata file.
 *
 * Because writing binary GeoTIFF in the browser requires a WASM library not
 * currently in the dependency tree, this function exports a lightweight JSON
 * sidecar containing EPSG:4326 metadata alongside the raw data values.  A
 * receiving GIS workflow can ingest this sidecar to reconstruct a proper GeoTIFF.
 *
 * @param cells - Grid cells to export
 * @param variable - Climate variable name
 * @param filename - Download filename (default: "climate-data.geotiff.json")
 */
export function downloadGeoTiff(
  cells: GridCell[],
  variable: string,
  filename = 'climate-data.geotiff.json'
): void {
  if (typeof document === 'undefined') return;
  const meta = buildGeoTiffMetadata(cells, variable);

  // Build a row-major value grid (north to south, west to east)
  const sortedLats = Array.from(new Set(cells.map(c => c.lat))).sort((a, b) => b - a);
  const sortedLons = Array.from(new Set(cells.map(c => c.lon))).sort((a, b) => a - b);
  const cellMap = new Map(cells.map(c => [`${c.lat},${c.lon}`, c[variable as keyof GridCell] as number]));

  const values: number[][] = sortedLats.map(lat =>
    sortedLons.map(lon => cellMap.get(`${lat},${lon}`) ?? 0)
  );

  const payload = { metadata: meta, values };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  triggerDownload(blob, filename);
}

// ── Screenshot Export ─────────────────────────────────────────────────────────

/**
 * Capture the current Cesium globe canvas as a high-resolution PNG.
 *
 * Cesium renders into a <canvas> element.  This function reads back the pixel
 * data via toDataURL and triggers a browser download.
 *
 * @param canvas - The Cesium WebGL canvas element
 * @param filename - Download filename (default: "globe-screenshot.png")
 * @returns true if capture succeeded, false if canvas was unavailable
 */
export function captureGlobeScreenshot(
  canvas: HTMLCanvasElement | null | undefined,
  filename = 'globe-screenshot.png'
): boolean {
  if (!canvas || typeof document === 'undefined') return false;

  try {
    // toDataURL works on same-origin canvases; Cesium honours preserveDrawingBuffer
    const dataUrl = canvas.toDataURL('image/png');
    if (!dataUrl || dataUrl === 'data:,') return false;

    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return true;
  } catch {
    return false;
  }
}

// ── WebM Animation Recording ──────────────────────────────────────────────────

/**
 * Configuration for WebM animation recording.
 */
export interface RecordingConfig {
  /** Frames per second for the recorded video (default: 30) */
  fps?: number;
  /** Video bitrate in bits per second (default: 2_500_000 = 2.5 Mbps) */
  videoBitsPerSecond?: number;
  /** Download filename (default: "climate-animation.webm") */
  filename?: string;
}

/**
 * WebM animation recorder that captures frames from a Cesium globe canvas.
 *
 * Usage:
 *   const recorder = new GlobeAnimationRecorder(canvas, { fps: 24 });
 *   recorder.start();
 *   // ... run animation loop, call recorder.captureFrame() each frame ...
 *   recorder.stop(); // triggers download automatically
 */
export class GlobeAnimationRecorder {
  private canvas: HTMLCanvasElement;
  private config: Required<RecordingConfig>;
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;

  constructor(canvas: HTMLCanvasElement, config: RecordingConfig = {}) {
    this.canvas = canvas;
    this.config = {
      fps: config.fps ?? 30,
      videoBitsPerSecond: config.videoBitsPerSecond ?? 2_500_000,
      filename: config.filename ?? 'climate-animation.webm',
    };
  }

  /** Returns true if the browser supports MediaRecorder with WebM/VP9. */
  static isSupported(): boolean {
    if (typeof MediaRecorder === 'undefined') return false;
    return (
      MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ||
      MediaRecorder.isTypeSupported('video/webm;codecs=vp8') ||
      MediaRecorder.isTypeSupported('video/webm')
    );
  }

  /** Start recording. Throws if MediaRecorder is unavailable. */
  start(): void {
    if (typeof MediaRecorder === 'undefined') {
      throw new Error('MediaRecorder API is not available in this environment.');
    }

    this.chunks = [];
    this.stream = this.canvas.captureStream(this.config.fps);

    // Prefer VP9 for quality, fall back to VP8, then generic WebM
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
      ? 'video/webm;codecs=vp8'
      : 'video/webm';

    this.mediaRecorder = new MediaRecorder(this.stream, {
      mimeType,
      videoBitsPerSecond: this.config.videoBitsPerSecond,
    });

    this.mediaRecorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) {
        this.chunks.push(event.data);
      }
    };

    this.mediaRecorder.onstop = () => {
      const blob = new Blob(this.chunks, { type: 'video/webm' });
      triggerDownload(blob, this.config.filename);
      this.chunks = [];
    };

    this.mediaRecorder.start();
  }

  /** Stop recording and trigger download of the WebM file. */
  stop(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
  }

  /** Returns whether the recorder is currently active. */
  get isRecording(): boolean {
    return this.mediaRecorder?.state === 'recording';
  }
}

// ── Internal Helpers ──────────────────────────────────────────────────────────

/**
 * Trigger a browser file download for the given Blob.
 * No-op in non-browser environments.
 */
function triggerDownload(blob: Blob, filename: string): void {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Clean up the object URL after a short delay
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
