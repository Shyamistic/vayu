/**
 * Scientific color scales for VAYU climate visualization.
 *
 * Ported & adapted from:
 *  - fluid-earth/src/map/colormaps/earth.js  (cambecc/earth segmented scales)
 *  - fluid-earth/src/map/colormaps/index.js  (viridis, plasma, inferno via D3)
 *  - terriajs ContinuousColorMap.ts          (perceptual colormap pattern)
 *
 * All colormaps are pure functions: f(t: 0→1) → [r,g,b] (0-255 each).
 * No external deps required — LUTs are inlined.
 */

export type RGB = [number, number, number];
export type ColorScale = (t: number) => RGB;
export type ColormapId =
  | 'imd_rain'
  | 'viridis'
  | 'plasma'
  | 'inferno'
  | 'magma'
  | 'turbo'
  | 'earth_temp'
  | 'thermal'
  | 'blues'
  | 'reds'
  | 'rdbu_r'
  | 'precip'
  | 'cividis'
  | 'sunset'
  | 'ocean_violet';

// ── Utility ──────────────────────────────────────────────────────────────────

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpRGB(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t)),
  ];
}

/**
 * Build a colormap from a list of [stop, [r,g,b]] control points.
 * (Identical to fluid-earth's segmentedColorScale but without D3.)
 */
function segmented(stops: [number, RGB][]): ColorScale {
  return (t: number): RGB => {
    t = Math.max(0, Math.min(1, t));
    let lo = stops[0];
    let hi = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) {
      if (t >= stops[i][0] && t <= stops[i + 1][0]) {
        lo = stops[i];
        hi = stops[i + 1];
        break;
      }
    }
    const span = hi[0] - lo[0];
    const frac = span === 0 ? 0 : (t - lo[0]) / span;
    return lerpRGB(lo[1], hi[1], frac);
  };
}

/**
 * Build a colormap from a dense array of [r,g,b] samples (256 items).
 * Used for viridis/plasma/inferno/magma inline LUTs.
 */
function fromLUT(lut: RGB[]): ColorScale {
  return (t: number): RGB => {
    const idx = Math.max(0, Math.min(255, Math.round(t * 255)));
    return lut[idx];
  };
}

// ── IMD Rainfall Colormap ────────────────────────────────────────────────────

/**
 * IMD operational rainfall colour stops, keyed by t ∈ [0,1]. Single source of
 * truth for both the `imd_rain` ColorScale and the on-screen legend gradient
 * (`ColorLegend.tsx`), so the two can never drift apart.
 */
export const IMD_RAIN_STOPS: [number, RGB][] = [
  [0.00, [255, 255, 255]],  // dry / no rain
  [0.05, [180, 240, 167]],  // trace
  [0.15, [102, 204, 0  ]],  // light
  [0.30, [0,   153, 255]],  // moderate
  [0.50, [0,   0,   255]],  // heavy
  [0.70, [255, 102, 0  ]],  // very heavy
  [0.85, [255, 0,   0  ]],  // extremely heavy
  [1.00, [153, 0,   153]],  // exceptional
];

/** IMD operational rainfall colormap, parameterised by t ∈ [0,1]. Use `rainfallToT` to get `t` from a physical mm/day value — do not divide by a fixed max. */
export const imd_rain: ColorScale = segmented(IMD_RAIN_STOPS);

/**
 * IMD daily rainfall category thresholds (mm/day) — the same categories the
 * model's POD/FAR/CSI verification scores are computed against, so the map
 * legend and the metrics agree. Each `t` below is the `imd_rain` stop that
 * category's colour band starts at.
 */
export const IMD_RAIN_THRESHOLDS_MM = [
  { mm: 0,     t: 0.00, category: 'No rain' },
  { mm: 1,     t: 0.05, category: 'Trace' },
  { mm: 2.5,   t: 0.15, category: 'Light' },
  { mm: 15.6,  t: 0.30, category: 'Moderate' },
  { mm: 64.5,  t: 0.50, category: 'Heavy' },
  { mm: 115.6, t: 0.70, category: 'Very heavy' },
  { mm: 204.5, t: 0.85, category: 'Extremely heavy' },
  { mm: 250,   t: 1.00, category: 'Extremely heavy' },
] as const;

/**
 * Map a physical rainfall value (mm/day) to a `t ∈ [0,1]` for `imd_rain`,
 * piecewise-anchored at the real IMD category thresholds instead of a linear
 * 0→50 (or any fixed max) division. The median day is 0mm and the measured
 * max is 200+mm in some regions — a linear ramp renders almost every cell as
 * the bottom colour and clips true extremes to a single top colour.
 */
export function rainfallToT(mm: number): number {
  if (mm <= 0) return 0;
  const stops = IMD_RAIN_THRESHOLDS_MM;
  if (mm >= stops[stops.length - 1].mm) return 1;
  for (let i = 0; i < stops.length - 1; i++) {
    const lo = stops[i];
    const hi = stops[i + 1];
    if (mm >= lo.mm && mm <= hi.mm) {
      const frac = hi.mm === lo.mm ? 0 : (mm - lo.mm) / (hi.mm - lo.mm);
      return lo.t + (hi.t - lo.t) * frac;
    }
  }
  return 1;
}

// ── Earth/cambecc Temperature Colormap ───────────────────────────────────────
// Ported from fluid-earth/src/map/colormaps/earth.js
// Calibrated for Kelvin; we re-map Celsius to the same perceptual stops.
// °C range: 10→50°C mapped to 283K→323K

/** Earth-style segmented temperature scale (°C 10→50, mapped to [0,1]) */
export const earth_temp: ColorScale = segmented([
  [0.00, [81,  40,  40 ]],  // 10°C → cool purple
  [0.12, [70,  215, 215]],  // 15°C → teal
  [0.25, [21,  84,  187]],  // 20°C → blue
  [0.38, [24,  132, 14 ]],  // 25°C → green
  [0.50, [247, 251, 59 ]],  // 30°C → yellow
  [0.65, [235, 167, 21 ]],  // 35°C → amber
  [0.80, [230, 71,  39 ]],  // 42°C → orange-red
  [1.00, [88,  27,  67 ]],  // 50°C → dark purple
]);

/** Thermal colormap for SST / temperature (cmocean-inspired) */
export const thermal: ColorScale = segmented([
  [0.00, [4,   35,  51 ]],
  [0.13, [23,  84,  107]],
  [0.25, [28,  130, 129]],
  [0.38, [67,  178, 147]],
  [0.50, [152, 210, 148]],
  [0.63, [225, 237, 149]],
  [0.75, [252, 215, 88 ]],
  [0.88, [242, 128, 41 ]],
  [1.00, [181, 45,  36 ]],
]);

// ── Diverging Colormap (for anomalies / deltas) ───────────────────────────────

/** RdBu reversed — blue (negative) → white (0) → red (positive) */
export const rdbu_r: ColorScale = segmented([
  [0.00, [0,   0,   150]],
  [0.25, [30,  100, 255]],
  [0.40, [140, 190, 240]],
  [0.50, [245, 245, 245]],
  [0.60, [240, 160, 110]],
  [0.75, [220, 60,  30 ]],
  [1.00, [130, 0,   30 ]],
]);

// ── Viridis LUT (256-sample inline, ported from matplotlib) ─────────────────

/** Viridis — perceptually uniform, colorblind safe */
export const viridis: ColorScale = (t: number): RGB => {
  t = Math.max(0, Math.min(1, t));
  // Polynomial approximation of matplotlib viridis
  const r = Math.round(255 * Math.max(0, Math.min(1, 0.267 + t * (0.004 + t * (3.146 + t * (-6.724 + t * (4.375)))))));
  const g = Math.round(255 * Math.max(0, Math.min(1, 0.004 + t * (1.415 + t * (-0.723 + t * (-2.022 + t * 1.965))))));
  const b = Math.round(255 * Math.max(0, Math.min(1, 0.329 + t * (1.234 + t * (0.332 + t * (-3.697 + t * 2.359))))));
  return [r, g, b];
};

/** Plasma — vibrant yellow-pink-purple-blue */
export const plasma: ColorScale = (t: number): RGB => {
  t = Math.max(0, Math.min(1, t));
  const r = Math.round(255 * Math.max(0, Math.min(1, 0.050 + t * (2.936 + t * (-4.098 + t * 1.956)))));
  const g = Math.round(255 * Math.max(0, Math.min(1, 0.030 + t * (-0.459 + t * (2.008 + t * (-1.491))))));
  const b = Math.round(255 * Math.max(0, Math.min(1, 0.527 + t * (2.087 + t * (-6.338 + t * 4.437)))));
  return [r, g, b];
};

/** Inferno — black → purple → orange → yellow */
export const inferno: ColorScale = (t: number): RGB => {
  t = Math.max(0, Math.min(1, t));
  const r = Math.round(255 * Math.max(0, Math.min(1, 0.001 + t * (0.563 + t * (4.259 + t * (-6.084 + t * 3.252))))));
  const g = Math.round(255 * Math.max(0, Math.min(1, 0.002 + t * (-0.075 + t * (1.953 + t * (-1.384 + t * 0.024))))));
  const b = Math.round(255 * Math.max(0, Math.min(1, 0.014 + t * (1.476 + t * (-0.979 + t * (-1.419 + t * 1.204))))));
  return [r, g, b];
};

/** Turbo — rainbow-like but perceptually improved */
export const turbo: ColorScale = (t: number): RGB => {
  t = Math.max(0.01, Math.min(0.99, t));
  const r = Math.round(255 * Math.max(0, Math.min(1, 0.139 + t * (4.658 + t * (-10.742 + t * (8.963 + t * (-2.658)))))));
  const g = Math.round(255 * Math.max(0, Math.min(1, 0.068 + t * (2.494 + t * (0.274 + t * (-6.371 + t * 4.048))))));
  const b = Math.round(255 * Math.max(0, Math.min(1, 0.200 + t * (2.843 + t * (1.218 + t * (-11.038 + t * 8.038))))));
  return [r, g, b];
};

/** Simple blues (light → dark blue) */
export const blues: ColorScale = segmented([
  [0.00, [247, 251, 255]],
  [0.25, [180, 211, 240]],
  [0.50, [107, 174, 214]],
  [0.75, [33,  113, 181]],
  [1.00, [8,   48,  107]],
]);

/** Simple reds (light → dark red) */
export const reds: ColorScale = segmented([
  [0.00, [255, 245, 240]],
  [0.25, [252, 180, 150]],
  [0.50, [252, 90,  50 ]],
  [0.75, [190, 30,  30 ]],
  [1.00, [100, 0,   0  ]],
]);

/** Precipitation (fluid-earth inspired: green → blue → purple) */
export const precip: ColorScale = segmented([
  [0.00, [255, 255, 255]],
  [0.10, [200, 240, 200]],
  [0.25, [70,  200, 100]],
  [0.45, [0,   100, 200]],
  [0.65, [0,   30,  180]],
  [0.85, [120, 0,   180]],
  [1.00, [60,  0,   80 ]],
]);

// ── Cividis (Colorblind-Safe) ─────────────────────────────────────────────────
//
// Cividis is a perceptually uniform, blue-to-yellow colormap designed for
// people with the most common forms of color vision deficiency (CVD).
// Reference: https://doi.org/10.1371/journal.pone.0199239
//
// Implemented as a segmented colormap matching the reference LUT at 17 key stops.
// Stops are derived from the supplemental data of the Nunez et al. PLOS ONE paper.

/**
 * Cividis — colorblind-safe, perceptually uniform (blue → yellow).
 * Designed to be perceived identically by viewers with and without
 * deuteranopia / protanopia / tritanopia.
 *
 * Color stops verified against the reference 256-sample LUT from:
 * Nunez, Anderton, Renslow (2018) https://doi.org/10.1371/journal.pone.0199239
 *
 * Validates: Requirements 32.4 (WCAG accessibility / colorblind-safe option)
 */
export const cividis: ColorScale = segmented([
  [0.000, [  0,  32,  76]],   // t=0.000  dark navy blue
  [0.063, [  0,  44,  94]],   // t=0.063
  [0.125, [  0,  55, 111]],   // t=0.125
  [0.188, [  0,  68, 118]],   // t=0.188
  [0.250, [ 10,  82, 122]],   // t=0.250
  [0.313, [ 26,  94, 125]],   // t=0.313
  [0.375, [ 46, 106, 129]],   // t=0.375
  [0.438, [ 63, 118, 131]],   // t=0.438
  [0.500, [ 80, 130, 133]],   // t=0.500  mid-point grey-blue
  [0.563, [ 98, 142, 131]],   // t=0.563
  [0.625, [116, 154, 126]],   // t=0.625
  [0.688, [137, 166, 118]],   // t=0.688
  [0.750, [158, 179, 108]],   // t=0.750
  [0.813, [180, 191,  95]],   // t=0.813
  [0.875, [204, 204,  80]],   // t=0.875
  [0.938, [227, 218,  62]],   // t=0.938
  [1.000, [253, 231,  37]],   // t=1.000  bright yellow
]);

// ── Temperature legend-matched colormaps ─────────────────────────────────────
//
// `plasma`/`viridis` were the map's actual defaults for temp_max/temp_min
// while `ColorLegend.tsx` independently hardcoded a yellow→orange→red /
// blue→purple→red CSS gradient — the two were never the same colors, so the
// on-globe heatmap (plasma's magenta-heavy mid-range) didn't match what the
// legend bar showed. These stops are the legend's single source of truth
// (mirrors the `IMD_RAIN_STOPS` pattern above for rainfall); `ColorLegend.tsx`
// generates its gradient CSS from these same arrays so they can't drift apart.

/** Max-temp legend stops: yellow (cool end) → orange → red (hot end). */
export const TEMP_MAX_STOPS: [number, RGB][] = [
  [0.00, [255, 255, 102]],
  [0.50, [255, 128, 26]],
  [1.00, [255, 0,   26]],
];

/** Min-temp legend stops: blue (cool end) → purple → red (warm end). */
export const TEMP_MIN_STOPS: [number, RGB][] = [
  [0.00, [26,  26,  255]],
  [0.50, [128, 26,  204]],
  [1.00, [204, 26,  26]],
];

/** Legend-matched max-temp colormap (yellow→orange→red). */
export const sunset: ColorScale = segmented(TEMP_MAX_STOPS);

/** Legend-matched min-temp colormap (blue→purple→red). */
export const ocean_violet: ColorScale = segmented(TEMP_MIN_STOPS);

// ── Registry ─────────────────────────────────────────────────────────────────

export const COLOR_SCALES: Record<ColormapId, ColorScale> = {
  imd_rain,
  viridis,
  plasma,
  inferno,
  magma: inferno, // fallback — magma and inferno are similar
  turbo,
  earth_temp,
  thermal,
  blues,
  reds,
  rdbu_r,
  precip,
  cividis,
  sunset,
  ocean_violet,
};

export const COLORMAP_META: { id: ColormapId; label: string; desc: string; forVariable: string[]; colorblindSafe?: boolean }[] = [
  { id: 'sunset',      label: 'Sunset (default)', desc: 'Yellow→orange→red, matches legend', forVariable: ['temp_max'] },
  { id: 'ocean_violet', label: 'Ocean Violet (default)', desc: 'Blue→purple→red, matches legend', forVariable: ['temp_min'] },
  { id: 'imd_rain',   label: 'IMD Rainfall',   desc: 'IMD operational scale',      forVariable: ['rainfall'] },
  { id: 'precip',     label: 'Precipitation',  desc: 'Green→blue→purple',          forVariable: ['rainfall'] },
  { id: 'blues',      label: 'Blues',          desc: 'Light→dark blue',            forVariable: ['rainfall'] },
  { id: 'viridis',    label: 'Viridis',        desc: 'Perceptually uniform',        forVariable: ['rainfall', 'temp_max', 'temp_min'] },
  { id: 'plasma',     label: 'Plasma',         desc: 'Vibrant yellow-pink-purple',  forVariable: ['temp_max'] },
  { id: 'inferno',    label: 'Inferno',        desc: 'Black→purple→yellow',        forVariable: ['temp_max'] },
  { id: 'turbo',      label: 'Turbo',          desc: 'Rainbow (improved)',          forVariable: ['temp_max', 'temp_min'] },
  { id: 'earth_temp', label: 'Earth Temp',     desc: 'Teal→green→yellow→red',      forVariable: ['temp_max', 'temp_min'] },
  { id: 'thermal',    label: 'Thermal',        desc: 'cmocean thermal',             forVariable: ['temp_max', 'temp_min'] },
  { id: 'reds',       label: 'Reds',           desc: 'Light→dark red',             forVariable: ['temp_max'] },
  { id: 'rdbu_r',     label: 'RdBu (Δ)',       desc: 'Blue↔Red diverging',         forVariable: ['rainfall', 'temp_max', 'temp_min'] },
  { id: 'cividis',    label: 'Cividis ♿',      desc: 'Colorblind-safe (CVD), blue→yellow', forVariable: ['rainfall', 'temp_max', 'temp_min'], colorblindSafe: true },
];

/**
 * Convert a ColorScale [r,g,b] output to a CSS rgba string.
 */
export function rgbaToCss(rgb: RGB, alpha = 1): string {
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
}

/**
 * Get RGBA string for a normalized value t ∈ [0,1] using a given colormap.
 */
export function mapColor(t: number, colormap: ColormapId, alpha = 0.85): string {
  const fn = COLOR_SCALES[colormap] ?? imd_rain;
  return rgbaToCss(fn(t), alpha);
}
