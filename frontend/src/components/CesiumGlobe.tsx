import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Ref } from 'react';
import * as Cesium from 'cesium';
import { WindLayer } from 'cesium-wind-layer';
import type { WindData } from 'cesium-wind-layer';
import type { GridCell, IoTStation, IoTStationStatus, RegionId, ScenarioResponse, VariableId } from '../types';
import { calculateStationPredictionError, formatSignedError } from '../features/sensors/sensorNetwork';
import { getCenterFacingView } from '../features/globe/cameraCentering';
import {
  createPostZoomCenteringController,
  type ManualInteractionKind,
  type PostZoomCenteringController,
} from '../features/globe/postZoomCentering';
import {
  createResizeCompletionController,
  type ResizeCompletionController,
} from '../features/globe/resizeCompletion';
import { REGIONS } from './RegionSelector';
import { mapColor, COLOR_SCALES, rainfallToT } from '../utils/colorScales';
import type { ColormapId } from '../utils/colorScales';
import { TerminatorLayer } from '../features/globe/layers/TerminatorLayer';
import {
  clipCanvasToIndia,
  parseIndiaOutline,
  pointInIndia,
  polygonBBox,
  type Polygon as IndiaPolygon,
} from '../features/globe/indiaClip';

// ── Constants ──────────────────────────────────────────────────────────────────

const INDIA_CENTER  = { lat: 20.5, lon: 78.9, alt: 3_500_000 }; // Pan-India view
// A camera-only overview; it deliberately does not imply that a national model
// result is available. Data coverage remains governed by the selected region.
const INDIA_OVERVIEW_BOUNDS = { latMin: 6.0, latMax: 38.0, lonMin: 66.0, lonMax: 100.0 };
// Near-top-down rectangle framing keeps the full target inside the clear canvas.
const REGION_PITCH_DEGREES = -89;

// NASA GIBS WMTS — completely free, no API key required
// Docs: https://wiki.earthdata.nasa.gov/display/GIBS
// Using epsg3857 (Web Mercator) — compatible with Cesium's WebMercatorTilingScheme
// IMPORTANT: Not all layers support all zoom levels. Use maximumLevel per layer.
const GIBS_BASE = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
const GIBS_LAYERS = {
  // These use standard GoogleMapsCompatible (up to zoom 9)
  MODIS_TrueColor: `${GIBS_BASE}/MODIS_Terra_CorrectedReflectance_TrueColor/default/{Time}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
  VIIRS_TrueColor: `${GIBS_BASE}/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/{Time}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
  Precipitation:   `${GIBS_BASE}/IMERG_Precipitation_Rate/default/{Time}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`,
  CloudFraction:   `${GIBS_BASE}/MODIS_Terra_Cloud_Fraction_Day/default/{Time}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`,
  Fires:           `${GIBS_BASE}/MODIS_Fire_Radiative_Power_Day/default/{Time}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`,
  SST:             `${GIBS_BASE}/GHRSST_L4_MUR_Sea_Surface_Temperature/default/{Time}/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png`,
  Aerosol:         `${GIBS_BASE}/MODIS_Combined_Value_Added_AOD/default/{Time}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`,
  NDVI:            `${GIBS_BASE}/MODIS_Terra_NDVI_8Day/default/{Time}/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`,
};

// IMD standard colormap for rainfall (matches operational IMD usage)
const IMD_RAIN_COLORS: [number, string][] = [
  [0,    '#FFFFFF'],  // dry
  [0.05, '#B4F0A7'],  // trace
  [0.15, '#66CC00'],  // light
  [0.30, '#0099FF'],  // moderate
  [0.50, '#0000FF'],  // heavy
  [0.70, '#FF6600'],  // very heavy
  [0.85, '#FF0000'],  // extremely heavy
  [1.00, '#990099'],  // exceptional
];

// ── IoT station pin markers ─────────────────────────────────────────────────
// Custom SVG markers (gradient fill, glow ring, drop shadow, per-status glyph)
// replacing Cesium's PinBuilder default, which renders as a flat, unstyled
// teardrop that reads poorly against the satellite basemap. Generated once per
// status and cached — status only has 3 states, no need to rebuild per station.

type StationStatus = IoTStationStatus;

const STATION_STATUS_STYLE: Record<StationStatus, { base: string; light: string; glyph: string }> = {
  online: {
    base: '#16a34a',
    light: '#4ade80',
    // Three ascending signal bars
    glyph: '<rect x="15" y="18" width="3.4" height="7" rx="1" fill="white"/><rect x="20.3" y="14" width="3.4" height="11" rx="1" fill="white"/><rect x="25.6" y="9" width="3.4" height="16" rx="1" fill="white"/>',
  },
  low_battery: {
    base: '#d97706',
    light: '#fbbf24',
    // Battery outline with a low internal fill
    glyph: '<rect x="13" y="13" width="18" height="11" rx="2.5" fill="none" stroke="white" stroke-width="2"/><rect x="31.5" y="16.5" width="2.4" height="4" rx="1" fill="white"/><rect x="15.5" y="15.5" width="4.5" height="6.5" rx="0.8" fill="white"/>',
  },
  offline: {
    base: '#475569',
    light: '#94a3b8',
    // No-signal: slashed circle
    glyph: '<circle cx="22" cy="18.5" r="8.5" fill="none" stroke="white" stroke-width="2.4"/><line x1="16.5" y1="13" x2="27.5" y2="24" stroke="white" stroke-width="2.4" stroke-linecap="round"/>',
  },
};

function buildStationPinSvg(status: StationStatus): string {
  const { base, light, glyph } = STATION_STATUS_STYLE[status];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="56" viewBox="0 0 44 56">
    <defs>
      <radialGradient id="fill-${status}" cx="38%" cy="30%" r="75%">
        <stop offset="0%" stop-color="${light}"/>
        <stop offset="100%" stop-color="${base}"/>
      </radialGradient>
      <filter id="shadow-${status}" x="-60%" y="-40%" width="220%" height="220%">
        <feDropShadow dx="0" dy="2" stdDeviation="2.2" flood-color="#000" flood-opacity="0.5"/>
      </filter>
    </defs>
    <path
      d="M22 2C11.5 2 3 10.4 3 20.7c0 14.2 19 31.8 19 31.8s19-17.6 19-31.8C41 10.4 32.5 2 22 2z"
      fill="url(#fill-${status})"
      stroke="rgba(255,255,255,0.92)"
      stroke-width="1.6"
      filter="url(#shadow-${status})"
    />
    <circle cx="22" cy="18.5" r="12.5" fill="rgba(6,10,22,0.28)"/>
    ${glyph}
  </svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

/** Generated once at module load — 3 fixed statuses, no per-station work. */
const STATION_PIN_IMAGES: Record<StationStatus, string> = {
  online: buildStationPinSvg('online'),
  low_battery: buildStationPinSvg('low_battery'),
  offline: buildStationPinSvg('offline'),
};

// Wind particle animation style presets — density/speed/colour, in the spirit
// of Ventusky's "Wind Animation: Normal / Soft / Dark / Fast-motion" selector.
export type WindAnimationStyle = 'normal' | 'soft' | 'dark' | 'fast';

const WIND_STYLE_PRESETS: Record<WindAnimationStyle, Pick<
  import('cesium-wind-layer').WindLayerOptions,
  'particlesTextureSize' | 'lineWidth' | 'lineLength' | 'speedFactor' | 'dropRate' | 'dropRateBump' | 'colors'
>> = {
  normal: {
    particlesTextureSize: 40,   // 1600 particles — good perf/visual balance
    lineWidth: { min: 2.0, max: 4.0 },
    // lineLength (not lineWidth) is what determines the drawn trail segment
    // length in cesium-wind-layer's vertex shader (extendedPosition = current
    // + direction * lengthFactor). It's scaled by a data-bounds-relative
    // pixelSize that shrinks the more you zoom into a sub-region of
    // wind_field.json's bounding box, so values that looked fine zoomed out
    // can collapse to sub-pixel "dots" once zoomed into e.g. Western Ghats.
    lineLength: { min: 60, max: 240 },
    speedFactor: 3.0,
    dropRate: 0.006,
    dropRateBump: 0.02,
    colors: ['rgba(150,200,255,0.5)', 'rgba(210,230,255,0.8)', 'rgba(255,255,255,0.95)'],
  },
  soft: {
    particlesTextureSize: 30,   // fewer, thinner, slower — a gentle haze
    lineWidth: { min: 1.2, max: 2.4 },
    lineLength: { min: 45, max: 150 },
    speedFactor: 1.6,
    dropRate: 0.01,
    dropRateBump: 0.03,
    colors: ['rgba(180,215,255,0.3)', 'rgba(220,235,255,0.5)', 'rgba(255,255,255,0.7)'],
  },
  dark: {
    particlesTextureSize: 55,   // dense, high-contrast — matches Ventusky's "Dark" storm look
    lineWidth: { min: 2.4, max: 5.2 },
    lineLength: { min: 75, max: 270 },
    speedFactor: 2.6,
    dropRate: 0.005,
    dropRateBump: 0.018,
    colors: ['rgba(120,160,220,0.65)', 'rgba(190,210,240,0.9)', 'rgba(255,255,255,1.0)'],
  },
  fast: {
    particlesTextureSize: 45,   // longer, faster-moving trails
    lineWidth: { min: 2.0, max: 4.4 },
    lineLength: { min: 90, max: 330 },
    speedFactor: 6.0,
    dropRate: 0.008,
    dropRateBump: 0.025,
    colors: ['rgba(150,200,255,0.5)', 'rgba(210,230,255,0.8)', 'rgba(255,255,255,0.95)'],
  },
};

// Variable display configuration. extrudeScale is the 3D column's max height
// (meters, at t=1) — same budget for all three so switching variables in 3D
// mode doesn't also change the vertical scale being compared.
const VARIABLE_CONFIG = {
  rainfall: { label: 'Rainfall', unit: 'mm/day', min: 0,  max: 50, extrudeScale: 80_000 },
  temp_max: { label: 'Tmax',     unit: '°C',     min: 20, max: 45, extrudeScale: 80_000 },
  temp_min: { label: 'Tmin',     unit: '°C',     min: 10, max: 35, extrudeScale: 80_000 },
};

/** Is (lon,lat) inside India? `polygons` null means "outline not loaded yet",
 *  treated as "don't hide anything" rather than clipping everything out before
 *  the fetch resolves.
 *
 *  Delegates to `pointInIndia` in features/globe/indiaClip.ts rather than
 *  testing each ring independently. Two reasons that matters:
 *
 *   - Holes. "Inside ANY ring" returns true for a point in the middle of a lake,
 *     because that point is inside both the exterior ring and the interior one.
 *     `pointInIndia` counts crossings across every ring and takes odd/even, so a
 *     lake correctly reads as outside — matching `ctx.fill('evenodd')` used for
 *     the raster mask, so the 3D columns, the heatmap, and the scenario overlay
 *     all agree on the same coastline.
 *   - Cost. It takes a precomputed per-polygon bounding box and rejects most of
 *     the outline's ~144 polygons before touching their vertices, which matters
 *     when this runs per grid cell over a 4,288-cell national grid.
 */
function isInsideIndia(
  lon: number,
  lat: number,
  polygons: IndiaPolygon[] | null,
  bboxes?: ReturnType<typeof polygonBBox>[],
): boolean {
  if (!polygons) return true;
  return pointInIndia(lon, lat, polygons, bboxes);
}

/**
 * Return CSS color string for heatmap canvas rendering — uses fluid-earth colormaps.
 * `edgeFactor` (0–1) fades the cell toward transparent near the data domain's
 * boundary so the overlay reads as a soft field rather than a pasted rectangle.
 */
function _heatmapColor(t: number, variable: VariableId, colormapId: ColormapId, edgeFactor = 1): string {
  if (variable === 'rainfall' && t < 0.04) return 'rgba(255,255,255,0)';
  const baseAlpha = variable === 'rainfall' && t < 0.05 ? 0 : 0.85;
  return mapColor(t, colormapId, baseAlpha * edgeFactor);
}

/** Interpolate the IMD standard colormap for rainfall, perceptual colormaps for temperature */
function valueToColor(value: number, variable: VariableId): Cesium.Color {
  const cfg = VARIABLE_CONFIG[variable];
  // Rainfall is heavily zero-skewed (median 0mm/day) and its extremes run
  // past any sane linear max, so it's mapped through the real IMD category
  // thresholds instead of a plain (value-min)/(max-min) division.
  const t = variable === 'rainfall'
    ? rainfallToT(value)
    : Math.max(0, Math.min(1, (value - cfg.min) / (cfg.max - cfg.min)));

  if (variable === 'rainfall') {
    // Walk through the IMD colormap stops
    const stops = IMD_RAIN_COLORS;
    let lo = stops[0], hi = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) {
      if (t >= stops[i][0] && t <= stops[i + 1][0]) {
        lo = stops[i]; hi = stops[i + 1]; break;
      }
    }
    const frac = hi[0] === lo[0] ? 0 : (t - lo[0]) / (hi[0] - lo[0]);
    const from = Cesium.Color.fromCssColorString(lo[1]);
    const to   = Cesium.Color.fromCssColorString(hi[1]);
    return Cesium.Color.lerp(from, to, frac, new Cesium.Color()).withAlpha(t < 0.04 ? 0.0 : 0.78);
  } else if (variable === 'temp_max') {
    // Viridis-like: deep-blue → teal → yellow → orange → red
    const r = Math.min(1, t * 2.0);
    const g = t < 0.5 ? t * 2.0 : 2.0 - t * 2.0;
    const b = Math.max(0, 1.0 - t * 2.0);
    return new Cesium.Color(r, g, b, 0.72);
  } else {
    // Cool: white → cyan → blue → purple
    return new Cesium.Color(0.5 - t * 0.3, 0.8 - t * 0.4, 1.0, 0.72);
  }
}

/** Layer type for the layer switcher */
export type EarthLayer =
  | 'vayu' | 'satellite' | 'modis' | 'precipitation' | 'cloud'
  | 'nightlights' | 'sst' | 'aerosol' | 'ndvi'
  | 'fires' | 'owm_precip' | 'owm_temp' | 'owm_wind' | 'modis_lst';

// OWM tile templates
const OWM_KEY = import.meta.env.VITE_OPENWEATHERMAP_KEY ?? '';
const OWM_LAYERS: Partial<Record<EarthLayer, string>> = {
  owm_precip: `https://tile.openweathermap.org/map/precipitation_new/{z}/{x}/{y}.png?appid=${OWM_KEY}`,
  owm_temp:   `https://tile.openweathermap.org/map/temp_new/{z}/{x}/{y}.png?appid=${OWM_KEY}`,
  owm_wind:   `https://tile.openweathermap.org/map/wind_new/{z}/{x}/{y}.png?appid=${OWM_KEY}`,
};

// ── Props & Component ─────────────────────────────────────────────────────────

export interface TourCameraStep {
  lat: number;
  lon: number;
  altitude: number;
  pitch: number; // degrees
  duration: number;
}

interface CesiumGlobeProps {
  gridCells: GridCell[];
  variable: VariableId;
  region: RegionId;
  scenarioData: ScenarioResponse | null;
  showSplitScreen: boolean;
  activeLayer?: EarthLayer;
  gibsDate?: string;   // 'YYYY-MM-DD' for NASA GIBS time-aware layers
  onCellClick?: (cell: GridCell, screenX: number, screenY: number) => void;
  /** Invoked by a touch long-press even when desktop inspect mode is off. */
  onLongPress?: (cell: GridCell, screenX: number, screenY: number) => void;
  /** Invoked on a plain left-click that lands off the globe (empty starfield),
   *  used to drive the app's focus-mode UI toggle. */
  onBackgroundClick?: () => void;
  terrainExaggeration?: number; // 1–5
  tourStep?: TourCameraStep | null;
  colormap?: ColormapId;   // scientific colormap selection
  show3D?: boolean;         // 3D extruded rainfall columns
  selectedDate?: Date;      // for day/night terminator
  showWind?: boolean;       // toggle wind particle layer
  windStyle?: WindAnimationStyle; // wind particle density/speed/colour preset
  showTerminator?: boolean; // toggle day/night terminator line + nightside shading
  /** Toggle IoT sensor station pins — hidden by default (opt-in via toolbar),
   *  same "hidden until you ask for it" treatment as Wind/Terminator. */
  showIoT?: boolean;
  mapMode?: '3d' | '2d';    // '2d' morphs to a top-down orthographic map focused on India
  /** One-time auto-rotate + auto-play-forecast hero sequence (e.g. right after
   *  the cinematic intro). Cancels immediately on any real user input and
   *  hands off cleanly to the normal static, user-controlled camera. */
  heroMode?: boolean;
  /** Called periodically during hero mode to advance the forecast day (T+1..T+7). */
  onHeroDayChange?: (day: number) => void;
  /** Called once when the hero sequence ends — i.e. the user touched the globe. */
  onHeroComplete?: () => void;
  regionFlyTrigger?: number; // increment to force fly-to even same region
  /** Changes whenever persistent UI changes the usable globe viewport. */
  viewportKey?: string;
  /** Base alpha (0–1) for the heatmap imagery layer — the "Opacity" control
   *  in VariableDataPanel. Defaults to the layer's original baseline. */
  heatmapOpacity?: number;
  /** Whether the heatmap's ambient "breathing" alpha pulse animates. Off
   *  pins alpha to `heatmapOpacity` with no oscillation. Defaults on. */
  heatmapAnimated?: boolean;
}

/** Imperative controls exposed to the parent via ref — e.g. toolbar zoom buttons. */
export interface CesiumGlobeHandle {
  /** Zoom in. Works correctly in both 3D (perspective) and 2D (orthographic) — Cesium's
   *  Camera.zoomIn dispatches to the right implementation for the current scene mode. */
  zoomIn: (amount?: number) => void;
  zoomOut: (amount?: number) => void;
}

function CesiumGlobeInner({
  gridCells,
  variable,
  region,
  scenarioData,
  showSplitScreen,
  activeLayer = 'satellite',
  gibsDate,
  onCellClick,
  onLongPress,
  onBackgroundClick,
  terrainExaggeration = 1,
  tourStep = null,
  colormap,
  show3D = false,
  selectedDate,
  showWind = true,
  windStyle = 'normal',
  showTerminator = false,
  showIoT = false,
  mapMode = '3d',
  heroMode = false,
  onHeroDayChange,
  onHeroComplete,
  regionFlyTrigger,
  viewportKey,
  heatmapOpacity = 0.78,
  heatmapAnimated = true,
}: CesiumGlobeProps, ref: Ref<CesiumGlobeHandle>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef    = useRef<Cesium.Viewer | null>(null);
  const overlayRef   = useRef<Cesium.CustomDataSource | null>(null);
  const scenarioRef  = useRef<Cesium.CustomDataSource | null>(null);
  const gibsLayerRef = useRef<Cesium.ImageryLayer | null>(null);
  const heatmapLayerRef = useRef<Cesium.ImageryLayer | null>(null);
  const windLayerRef = useRef<WindLayer | null>(null);
  const extrude3DRef = useRef<Cesium.CustomDataSource | null>(null);
  const terminatorLayerRef = useRef<TerminatorLayer | null>(null);
  const osmBuildingsRef = useRef<Cesium.Cesium3DTileset | null>(null);
  const iotStationsSourceRef = useRef<Cesium.CustomDataSource | null>(null);
  const terminatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onHeroDayChangeRef = useRef(onHeroDayChange);
  const onHeroCompleteRef = useRef(onHeroComplete);
  // Refs for stable closure access in event handlers
  const gridCellsRef = useRef<GridCell[]>(gridCells);
  const onCellClickRef = useRef(onCellClick);
  const onLongPressRef = useRef(onLongPress);
  const onBackgroundClickRef = useRef(onBackgroundClick);
  const [isReady, setIsReady] = useState(false);
  const [statusMsg, setStatusMsg] = useState('Loading ISRO Earth View…');
  const [coords, setCoords] = useState<{ lat: number; lon: number; x: number; y: number } | null>(null);
  // India landmass outline (simplified), used to clip the heatmap raster so it
  // doesn't paint ocean/neighboring countries beyond the data bbox rectangle.
  // Each polygon retains *all* of its rings — exterior plus holes — because
  // lakes and enclaves must remain transparent in the canvas clip mask.
  const indiaOutlineRef = useRef<IndiaPolygon[] | null>(null);
  const [outlineLoaded, setOutlineLoaded] = useState(false);
  // Programmatic flights suppress post-zoom normalization until completion.
  const isCameraAnimatingRef = useRef(false);
  const zoomCenteringRef = useRef<PostZoomCenteringController | null>(null);
  const resizeCompletionRef = useRef<ResizeCompletionController | null>(null);
  const hasFlownInitialRegionRef = useRef(false);
  const mapModeRef = useRef(mapMode);
  mapModeRef.current = mapMode;
  // Read inside the data-source creation effect, which must not re-run (and
  // rebuild every pin) just because the toggle flipped.
  const showIoTRef = useRef(showIoT);
  showIoTRef.current = showIoT;
  // Latest opacity, for the one place the render effect needs it without taking
  // it as a dependency (see the heatmap effect below).
  const heatmapOpacityRef = useRef(heatmapOpacity);
  heatmapOpacityRef.current = heatmapOpacity;

  // ── Load the India outline used to clip the heatmap raster ─────────────────
  // Independent of viewer setup — a plain fetch, not a Cesium data source —
  // so it can resolve in parallel with globe initialization.
  useEffect(() => {
    let cancelled = false;
    fetch('/india_outline_simplified.geojson')
      .then((res) => res.json())
      .then((geojson) => {
        if (cancelled) return;
        // Shared parser: every ring is retained, exterior and interior, so
        // lakes and enclaves stay transparent under the even-odd fill.
        indiaOutlineRef.current = parseIndiaOutline(geojson);
        setOutlineLoaded(true);
      })
      .catch(() => { /* clip is a visual nicety — heatmap still renders unclipped if this fails */ });
    return () => { cancelled = true; };
  }, []);

  // ── Imperative zoom controls (toolbar +/- buttons) ──────────────────────────
  // Camera.zoomIn/zoomOut dispatch to Cesium's zoom3D or zoom2D internally
  // based on the scene's current mode, so the same call works whether the
  // globe is in 3D perspective or has been morphed to the 2D orthographic map.
  // The amount scales with current camera height (rather than a fixed meter
  // value) so each click feels like a consistent ~35% step at any zoom level.
  const zoomIn = useCallback((amount?: number) => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    const height = viewer.camera.positionCartographic.height;
    viewer.camera.zoomIn(amount ?? height * 0.35);
  }, []);

  const zoomOut = useCallback((amount?: number) => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    const height = viewer.camera.positionCartographic.height;
    viewer.camera.zoomOut(amount ?? height * 0.35);
  }, []);

  useImperativeHandle(ref, () => ({ zoomIn, zoomOut }), [zoomIn, zoomOut]);

  const setProgrammaticFlight = useCallback((active: boolean) => {
    isCameraAnimatingRef.current = active;
    zoomCenteringRef.current?.setProgrammaticFlight(active);
  }, []);

  /** Coordinated camera fly to a fixed point — cancels any in-flight animation
   *  first and marks the camera as "animating" so the auto-center pitch
   *  correction backs off. Used for the intro sequence and guided-tour steps,
   *  where we want an exact camera position rather than "frame this area". */
  const flyCameraTo = useCallback((
    viewer: Cesium.Viewer,
    options: {
      destination: Cesium.Cartesian3;
      orientation: { heading: number; pitch: number; roll: number };
      duration: number;
    },
  ) => {
    if (viewer.isDestroyed()) return;
    try { viewer.camera.cancelFlight(); } catch { /* no flight in progress */ }
    setProgrammaticFlight(true);
    viewer.camera.flyTo({
      ...options,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
      complete: () => { setProgrammaticFlight(false); },
      cancel: () => { setProgrammaticFlight(false); },
    });
  }, [setProgrammaticFlight]);

  /** Coordinated camera fly that *frames a geographic rectangle* at a fixed
   *  pitch, regardless of the rectangle's aspect ratio.
   *
   *  IMPORTANT: `camera.flyTo({ destination: Rectangle, orientation })` is NOT
   *  the right tool for this — Cesium first computes the camera distance
   *  needed to frame the rectangle in a top-down view, and only afterward
   *  rotates to the requested pitch. That rotation un-frames the rectangle,
   *  which is why every region (including "All India") was landing at the
   *  wrong position/zoom. `flyToBoundingSphere` with a `HeadingPitchRange`
   *  offset computes the camera distance *after* accounting for the pitch,
   *  so the rectangle is actually still in view when the flight completes. */
  const flyCameraToBounds = useCallback((
    viewer: Cesium.Viewer,
    bounds: { latMin: number; latMax: number; lonMin: number; lonMax: number },
    options: { pitchDegrees: number; duration: number },
  ) => {
    if (viewer.isDestroyed()) return;
    const rectangle = Cesium.Rectangle.fromDegrees(bounds.lonMin, bounds.latMin, bounds.lonMax, bounds.latMax);
    const boundingSphere = Cesium.BoundingSphere.fromRectangle3D(rectangle, viewer.scene.globe.ellipsoid);
    // flyToBoundingSphere's auto-computed distance fits the sphere to the
    // FULL canvas frustum — but the canvas runs edge-to-edge underneath the
    // fixed header, left toolbar, and bottom timeline/legend chrome, which
    // visually eat into that same frustum. Framing to 100% of the frustum
    // therefore looks "cut off" by that chrome. Inflating the sphere's
    // radius before framing makes Cesium back the camera off further,
    // leaving a margin that keeps the globe clear of the overlays.
    boundingSphere.radius *= 2.43;
    try { viewer.camera.cancelFlight(); } catch { /* no flight in progress */ }
    setProgrammaticFlight(true);
    viewer.camera.flyToBoundingSphere(boundingSphere, {
      // A zero range asks Cesium to compute the distance required to contain
      // the (padded) sphere in the current frustum; no hand-tuned region
      // altitude beyond the padding factor above.
      offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(options.pitchDegrees), 0),
      duration: options.duration,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
      complete: () => { setProgrammaticFlight(false); },
      cancel: () => { setProgrammaticFlight(false); },
    });
  }, [setProgrammaticFlight]);

  // ── 2D / 3D scene mode toggle ───────────────────────────────────────────────
  // Cesium's built-in 2D/3D morph keeps every existing layer, entity, and
  // interaction (heatmap, boundaries, wind particles, IoT pins) working
  // unchanged — only the projection changes — so no separate map library or
  // duplicate rendering path is needed for the 2D view.
  useEffect(() => {
    if (!isReady || !viewerRef.current) return;
    const viewer = viewerRef.current;
    if (viewer.isDestroyed()) return;

    const flyToIndiaTopDown = (duration: number) => {
      if (viewer.isDestroyed()) return;
      viewer.camera.flyTo({
        destination: Cesium.Rectangle.fromDegrees(
          INDIA_OVERVIEW_BOUNDS.lonMin,
          INDIA_OVERVIEW_BOUNDS.latMin,
          INDIA_OVERVIEW_BOUNDS.lonMax,
          INDIA_OVERVIEW_BOUNDS.latMax
        ),
        duration,
      });
    };

    // See the "OSM Buildings" comment above: 3D Tiles content can't safely
    // update in 2D/Columbus View, so hide it outside 3D rather than let it
    // crash the render loop every frame.
    if (osmBuildingsRef.current) {
      osmBuildingsRef.current.show = mapMode === '3d';
    }

    // Station pins are opt-in (showIoT) and additionally hidden in 2D — see the
    // CustomDataSource comment above.
    //
    // Read from a ref rather than the prop, and keep `showIoT` OUT of this
    // effect's dependency list. The 2D branch below calls flyToIndiaTopDown, so
    // depending on showIoT here means toggling the pins while the scene is in 2D
    // resets the camera and throws away the user's pan and zoom. The dedicated
    // effect immediately after this one owns pin visibility instead.
    if (iotStationsSourceRef.current) {
      iotStationsSourceRef.current.show = showIoTRef.current && mapMode === '3d';
    }

    if (mapMode === '2d') {
      if (viewer.scene.mode === Cesium.SceneMode.SCENE2D) {
        flyToIndiaTopDown(1.0);
      } else {
        const removeListener = viewer.scene.morphComplete.addEventListener(() => {
          removeListener();
          flyToIndiaTopDown(0.0);
        });
        viewer.scene.morphTo2D(1.0);
      }
    } else if (viewer.scene.mode !== Cesium.SceneMode.SCENE3D) {
      viewer.scene.morphTo3D(1.0);
    }
  }, [isReady, mapMode]);

  // ── Station pin visibility ──────────────────────────────────────────────────
  // Separate from the 2D/3D effect above on purpose: toggling pins must not
  // move the camera. Only flips a boolean on an existing data source, so
  // switching views never rebuilds the pins.
  useEffect(() => {
    if (!isReady || !iotStationsSourceRef.current) return;
    iotStationsSourceRef.current.show = mapMode === '3d' && showIoT;
  }, [isReady, showIoT, mapMode]);

  // ── Hero auto-rotate + auto-play forecast (indefinite, cancels on user input) ─
  // An ambient sequence — camera slowly spins over India while the forecast
  // day cycles T+1..T+7 on repeat — meant to run right after the cinematic
  // intro and for as long as nobody touches the globe. It never fights an
  // in-progress programmatic flight, and stops the instant the user touches
  // the globe, handing off to the normal static, fully user-controlled
  // camera exactly as it works outside hero mode.
  //
  // The rotation itself is 3D-only: "rotating" the camera in Cesium's 2D
  // orthographic mode just spins the flat map image in-plane, which reads as
  // broken rather than ambient — so it's skipped while mapMode is '2d' (read
  // from a ref, not a dependency, so toggling 2D/3D doesn't restart the whole
  // sequence and reset the day-cycle timing). The forecast-day auto-cycle
  // still runs in 2D since it's just data, not camera movement.
  useEffect(() => {
    if (!isReady || !viewerRef.current || !heroMode) return;
    const viewer = viewerRef.current;
    if (viewer.isDestroyed()) return;

    const HERO_DAY_INTERVAL_MS = 1_400;
    const ROTATE_TICK_MS = 50;
    const ROTATE_RADIANS_PER_SEC = Cesium.Math.toRadians(2);

    let lastTime = performance.now();
    let day = 1;
    // Driven by setInterval rather than requestAnimationFrame or
    // viewer.clock.onTick: this app runs with clock.shouldAnimate = false
    // (it's a data map, not a time-dynamic simulation) so onTick never fires
    // automatically, and rAF is throttled/paused entirely in backgrounded
    // tabs. A short setInterval isn't subject to either limitation and is
    // more than smooth enough for a slow 2°/s ambient rotation.
    const rotateTimer = window.setInterval(() => {
      if (viewer.isDestroyed() || isCameraAnimatingRef.current || mapModeRef.current === '2d') {
        lastTime = performance.now();
        return;
      }
      const now = performance.now();
      const dt = Math.min(0.2, (now - lastTime) / 1000);
      lastTime = now;
      if (dt > 0) viewer.scene.camera.rotate(Cesium.Cartesian3.UNIT_Z, -ROTATE_RADIANS_PER_SEC * dt);
    }, ROTATE_TICK_MS);

    const dayTimer = window.setInterval(() => {
      day = day >= 7 ? 1 : day + 1;
      onHeroDayChangeRef.current?.(day);
    }, HERO_DAY_INTERVAL_MS);

    // Silent teardown — removes listeners/timers only. Runs on every
    // dependency change (including React StrictMode's dev-mode double-invoke),
    // which is NOT the same event as "the hero sequence actually finished" —
    // that distinction matters because calling onHeroComplete here would let
    // StrictMode's synthetic remount cancel the sequence before it ever ran.
    const teardown = () => {
      window.clearInterval(rotateTimer);
      window.clearInterval(dayTimer);
      canvas.removeEventListener('pointerdown', onUserInput);
      canvas.removeEventListener('wheel', onUserInput);
    };

    // "complete" = the user actually touched the globe — the only path that
    // ends hero mode now that it has no fixed duration.
    let completed = false;
    const complete = () => {
      if (completed) return;
      completed = true;
      teardown();
      onHeroCompleteRef.current?.();
    };

    const onUserInput = () => complete();
    const canvas = viewer.scene.canvas;
    canvas.addEventListener('pointerdown', onUserInput, { passive: true });
    canvas.addEventListener('wheel', onUserInput, { passive: true });

    return teardown;
  }, [isReady, heroMode]);

  // ── IoT sensor pins and hover telemetry (Requirement 27) ──────────────────
  useEffect(() => {
    if (!isReady || !viewerRef.current) return;
    const viewer = viewerRef.current;
    const source = new Cesium.CustomDataSource('vayu-iot-sensors');
    // Station pins are opt-in (hidden by default, toggled on via the toolbar)
    // and additionally hidden in 2D by product decision (grouped with Wind
    // and Inspect, which are hidden for real technical reasons — see their
    // comments). The dedicated visibility effect above keeps both in sync going
    // forward; refs here so creating the pins does not depend on either value.
    source.show = showIoTRef.current && mapModeRef.current === '3d';
    iotStationsSourceRef.current = source;
    viewer.dataSources.add(source);
    const hoverHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    const controller = new AbortController();
    const apiBase = import.meta.env.VITE_API_URL || '';
    let hoverTooltip: Cesium.Entity | undefined;
    let disposed = false;

    const formatValue = (value: number | null | undefined, unit: string, digits = 1) =>
      value == null ? '—' : `${value.toFixed(digits)} ${unit}`;
    const tooltipText = (station: IoTStation) => {
      const sensors = station.sensors;
      const error = calculateStationPredictionError(station, gridCellsRef.current);
      const lines = [
        station.name,
        `Soil moisture: ${formatValue(sensors?.soil_moisture_pct, '%')}`,
        `Temperature: ${formatValue(sensors?.temperature_c, '°C')}`,
        `Humidity: ${formatValue(sensors?.humidity_pct, '%')}`,
        `Rainfall gauge: ${sensors?.rain_detected == null ? '—' : sensors.rain_detected ? 'Detected' : 'None'}`,
        `Water level: ${formatValue(sensors?.water_level_cm, 'cm')}`,
      ];
      if (error.temperatureC != null) {
        lines.push(`Temperature error (AI − sensor): ${formatSignedError(error.temperatureC)} °C`);
      }
      if (error.rainfallProxy != null) {
        lines.push(`Rainfall proxy error (AI − sensor): ${formatSignedError(error.rainfallProxy, 0)}`);
      }
      return lines.join('\n');
    };

    const loadStations = async () => {
      try {
        const response = await fetch(`${apiBase}/api/stations`, { signal: controller.signal });
        if (!response.ok) throw new Error(`Station request failed: ${response.status}`);
        const stations = await response.json() as IoTStation[];
        if (disposed || !Array.isArray(stations)) return;

        source.entities.removeAll();
        hoverTooltip = source.entities.add({
          show: false,
          label: {
            font: '12px Inter, sans-serif',
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            showBackground: true,
            backgroundColor: Cesium.Color.fromCssColorString('#08111ee8'),
            horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(14, -12),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });

        stations.forEach((station) => {
          const status = station.status;
          const isOffline = status === 'offline';
          source.entities.add({
            position: Cesium.Cartesian3.fromDegrees(station.lon, station.lat, station.alt ?? 0),
            billboard: {
              image: STATION_PIN_IMAGES[status],
              verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              scale: isOffline ? 0.72 : new Cesium.CallbackProperty(
                () => 0.9 + Math.sin(Date.now() / 280) * 0.12,
                false,
              ),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            properties: { station },
          });
        });
      } catch (error) {
        if (!controller.signal.aborted) console.warn('[VAYU] IoT station overlay unavailable:', error);
      }
    };

    hoverHandler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
      const picked = viewer.scene.pick(movement.endPosition);
      const station = (picked?.id as Cesium.Entity | undefined)?.properties?.station
        ?.getValue(Cesium.JulianDate.now()) as IoTStation | undefined;
      if (!station || !hoverTooltip) {
        if (hoverTooltip) hoverTooltip.show = false;
        return;
      }
      hoverTooltip.position = new Cesium.ConstantPositionProperty(
        Cesium.Cartesian3.fromDegrees(station.lon, station.lat, station.alt ?? 0),
      );
      if (hoverTooltip.label) hoverTooltip.label.text = new Cesium.ConstantProperty(tooltipText(station));
      hoverTooltip.show = true;
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    void loadStations();
    const refreshTimer = window.setInterval(() => void loadStations(), 30_000);
    return () => {
      disposed = true;
      controller.abort();
      window.clearInterval(refreshTimer);
      hoverHandler.destroy();
      if (!viewer.isDestroyed()) viewer.dataSources.remove(source, true);
    };
  }, [isReady]);

  // Keep refs in sync with props
  useEffect(() => { gridCellsRef.current = gridCells; }, [gridCells]);
  useEffect(() => { onCellClickRef.current = onCellClick; }, [onCellClick]);
  useEffect(() => { onLongPressRef.current = onLongPress; }, [onLongPress]);
  useEffect(() => { onBackgroundClickRef.current = onBackgroundClick; }, [onBackgroundClick]);
  useEffect(() => { onHeroDayChangeRef.current = onHeroDayChange; }, [onHeroDayChange]);
  useEffect(() => { onHeroCompleteRef.current = onHeroComplete; }, [onHeroComplete]);

  // ── Initialize CesiumJS viewer ──────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    // Set Ion token from environment (required for world terrain + Bing imagery)
    const ionToken = import.meta.env.VITE_CESIUM_ION_TOKEN;
    if (ionToken) Cesium.Ion.defaultAccessToken = ionToken;

    // Suppress Cesium DeveloperError rendering crash dialog
    // (GroundPolylineGeometry throws on degenerate boundary points)
    const origRenderError = (window as unknown as Record<string, unknown>).onerror;
    window.onerror = (msg) => {
      if (typeof msg === 'string' && msg.includes('DeveloperError')) return true;
      if (origRenderError && typeof origRenderError === 'function') {
        return (origRenderError as (...args: unknown[]) => unknown)(msg);
      }
      return false;
    };

    const viewer = new Cesium.Viewer(containerRef.current, {
      terrain: Cesium.Terrain.fromWorldTerrain({ requestVertexNormals: true }),
      timeline: false,
      animation: false,
      homeButton: false,
      sceneModePicker: false,
      baseLayerPicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      geocoder: false,
      infoBox: false,
      selectionIndicator: false,
      creditContainer: document.createElement('div'),
    });

    // Suppress Cesium's built-in render error panel
    // Override the internal error display to prevent the red overlay from appearing
    try {
      const widget = viewer.cesiumWidget as unknown as { _showRenderLoopError: boolean; showErrorPanel: (...args: unknown[]) => void };
      widget.showErrorPanel = () => {};
      widget._showRenderLoopError = false;
    } catch { /* ignore if property doesn't exist */ }
    // When a render error occurs, Cesium stops its render loop (black screen).
    // Fix: restart the loop automatically.
    viewer.scene.renderError.addEventListener((_scene: unknown, _error: unknown) => {
      console.warn('[VAYU] Cesium render error — restarting render loop', _error);
      try {
        viewer.useDefaultRenderLoop = false;
        setTimeout(() => {
          if (!viewer.isDestroyed()) {
            viewer.useDefaultRenderLoop = true;
          }
        }, 100);
      } catch {}
    });

    const terminatorLayer = new TerminatorLayer();
    terminatorLayer.init(viewer);
    terminatorLayerRef.current = terminatorLayer;

    // ── Atmosphere & lighting — ISRO space-to-earth aesthetic ──
    viewer.scene.globe.enableLighting = false; // disable lighting so globe is always visible
    viewer.scene.globe.showGroundAtmosphere = true;
    viewer.scene.globe.tileCacheSize = 200;
    viewer.scene.fog.enabled = true;
    viewer.scene.fog.density = 0.0001;
    if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true;

    // ── Camera constraints ──
    viewer.scene.screenSpaceCameraController.minimumZoomDistance = 500;
    viewer.scene.screenSpaceCameraController.maximumZoomDistance = 50_000_000;

    const normalizeAfterZoom = () => {
      if (viewer.isDestroyed() || isCameraAnimatingRef.current) return;
      const view = getCenterFacingView(viewer.camera.positionWC, viewer.camera.upWC);
      viewer.camera.setView({
        destination: new Cesium.Cartesian3(view.destination.x, view.destination.y, view.destination.z),
        orientation: {
          direction: new Cesium.Cartesian3(
            view.orientation.direction.x,
            view.orientation.direction.y,
            view.orientation.direction.z,
          ),
          up: new Cesium.Cartesian3(view.orientation.up.x, view.orientation.up.y, view.orientation.up.z),
        },
      });
      viewer.scene.requestRender();
    };
    const zoomCentering = createPostZoomCenteringController(normalizeAfterZoom);
    zoomCenteringRef.current = zoomCentering;

    const resizeCesium = () => {
      if (viewer.isDestroyed()) return;
      viewer.resize();
      viewer.scene.requestRender();
    };
    const resizeCompletion = createResizeCompletionController(resizeCesium);
    resizeCompletionRef.current = resizeCompletion;
    const globeContainer = containerRef.current;
    const boundsTransitionTarget = globeContainer?.closest('[data-testid="globe-viewport"]')
      ?? globeContainer?.parentElement
      ?? null;
    const resizeObserver = globeContainer && typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(([entry]) => {
          if (entry) resizeCompletion.observed(entry.contentRect.width, entry.contentRect.height);
        })
      : null;
    if (globeContainer) resizeObserver?.observe(globeContainer);
    const onBoundsTransitionEnd = (event: Event) => {
      const propertyName = (event as TransitionEvent).propertyName;
      if (propertyName === 'top' || propertyName === 'right' || propertyName === 'bottom') {
        resizeCompletion.transitionEnded();
      }
    };
    const onViewportResize = () => resizeCompletion.requestCompletion();
    boundsTransitionTarget?.addEventListener('transitionend', onBoundsTransitionEnd);
    window.addEventListener('resize', onViewportResize);
    window.visualViewport?.addEventListener('resize', onViewportResize);
    document.addEventListener('fullscreenchange', onViewportResize);
    resizeCompletion.requestCompletion();

    // ── NOTE: there used to be a per-frame "auto-center globe when zoomed
    // out" pitch correction here (a `preRender` listener nudging
    // `camera.pitch` toward -85° every frame). It was removed — twice
    // reworking its pivot point still produced visible globe drift/freezing
    // (walking the ground point toward the bottom of the screen, then
    // snapping the view to the Arctic when pivoting around Earth's center,
    // which is an undefined orientation at the planet's core). Cesium's
    // default camera controller already keeps the globe framed correctly
    // during manual drag/zoom/rotate; it does not need a competing
    // per-frame orientation write. Initial framing and region flights still
    // set an explicit pitch once via flyCameraTo/flyCameraToBounds below.

    // ── Cinematic intro: start from space, zoom to India ──
    setProgrammaticFlight(true);
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(INDIA_CENTER.lon, INDIA_CENTER.lat, 8_000_000),
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(-89), roll: 0 },
    });
    const introFlyTimer = window.setTimeout(() => {
      if (viewer.isDestroyed()) return;
      // Marks the initial region as already flown-to so the region-sync effect
      // below doesn't immediately re-trigger a second, competing flyTo on mount.
      hasFlownInitialRegionRef.current = true;
      // The landing view is a neutral full-India overview rather than a
      // Western-Ghats model frame. It makes no statement about model coverage;
      // selecting a region still performs the authoritative data-region flight.
      flyCameraToBounds(viewer, INDIA_OVERVIEW_BOUNDS, { pitchDegrees: REGION_PITCH_DEGREES, duration: 3.0 });
    }, 800);

    // ── Mouse-move coordinate tracker ──
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
      try {
        const cartesian = viewer.scene.pickPosition(movement.endPosition);
        if (cartesian) {
          const carto = Cesium.Cartographic.fromCartesian(cartesian);
          setCoords({
            lat: Cesium.Math.toDegrees(carto.latitude),
            lon: Cesium.Math.toDegrees(carto.longitude),
            x: movement.endPosition.x,
            y: movement.endPosition.y,
          });
        } else {
          setCoords(null);
        }
      } catch {
        // pickPosition can throw when depth buffer isn't ready
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    // Cesium's MOUSE_MOVE only fires while the cursor is over the canvas, so
    // without this the last hovered coordinate stays pinned on screen
    // indefinitely once the user moves on to other panels/controls.
    const onCanvasPointerLeave = () => setCoords(null);
    viewer.scene.canvas.addEventListener('pointerleave', onCanvasPointerLeave);

    // ── Inspect gestures: click and touch long-press use the same robust picker ──
    const inspectAt = (
      position: Cesium.Cartesian2,
      callback: ((cell: GridCell, x: number, y: number) => void) | undefined,
    ) => {
      if (!callback) return;
      try {
        let cartesian: Cesium.Cartesian3 | undefined = viewer.scene.pickPosition(position);
        if (!cartesian) {
          const ray = viewer.camera.getPickRay(position);
          cartesian = ray ? viewer.scene.globe.pick(ray, viewer.scene) : undefined;
        }
        if (!cartesian) {
          cartesian = viewer.camera.pickEllipsoid(position, viewer.scene.globe.ellipsoid);
        }
        if (!cartesian) return;

        const carto = Cesium.Cartographic.fromCartesian(cartesian);
        const clickLat = Cesium.Math.toDegrees(carto.latitude);
        const clickLon = Cesium.Math.toDegrees(carto.longitude);
        const cells = gridCellsRef.current;
        const cell = cells.reduce<GridCell | null>((closest, candidate) => {
          if (!closest) return candidate;
          return Math.hypot(candidate.lat - clickLat, candidate.lon - clickLon) <
            Math.hypot(closest.lat - clickLat, closest.lon - clickLon)
            ? candidate
            : closest;
        }, null);

        if (cell) callback(cell, position.x, position.y);
      } catch {
        // Picking can fail during an imagery/depth-buffer transition.
      }
    };

    handler.setInputAction((click: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      inspectAt(click.position, onCellClickRef.current);
      // A click that hits neither an entity nor the globe/terrain surface is a
      // click on empty starfield/sky — treat it as "focus on the globe" intent.
      const hitEntity = viewer.scene.pick(click.position);
      const hitGlobe = viewer.scene.pickPosition(click.position)
        ?? (() => {
          const ray = viewer.camera.getPickRay(click.position);
          return ray ? viewer.scene.globe.pick(ray, viewer.scene) : undefined;
        })();
      if (!hitEntity && !hitGlobe) onBackgroundClickRef.current?.();
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // Cesium handles pinch zoom and two-finger rotation. We disable browser-level
    // manipulation only, so the canvas continues receiving the underlying touches.
    const cameraController = viewer.scene.screenSpaceCameraController;
    cameraController.enableZoom = true;
    cameraController.enableRotate = true;
    cameraController.enableTilt = true;
    viewer.scene.canvas.style.touchAction = 'none';

    let longPressTimer: number | null = null;
    let longPressOrigin: { x: number; y: number } | null = null;
    const activeTouchPointers = new Set<number>();
    const touchPositions = new Map<number, { x: number; y: number }>();
    const pointerInteractions = new Map<number, ManualInteractionKind>();
    let pinchActive = false;
    let pinchDistance: number | null = null;
    const currentPinchDistance = () => {
      const [first, second] = [...touchPositions.values()];
      return first && second ? Math.hypot(second.x - first.x, second.y - first.y) : null;
    };
    const clearLongPress = () => {
      if (longPressTimer !== null) window.clearTimeout(longPressTimer);
      longPressTimer = null;
      longPressOrigin = null;
    };
    const beginPointerInteraction = (pointerId: number, kind: ManualInteractionKind) => {
      pointerInteractions.set(pointerId, kind);
      zoomCentering.beginManualInput(kind);
    };
    const endPointerInteraction = (pointerId: number) => {
      const kind = pointerInteractions.get(pointerId);
      if (!kind) return;
      pointerInteractions.delete(pointerId);
      zoomCentering.endManualInput(kind);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'touch') {
        activeTouchPointers.add(event.pointerId);
        touchPositions.set(event.pointerId, { x: event.clientX, y: event.clientY });
        beginPointerInteraction(event.pointerId, 'pan');
        clearLongPress();
        if (activeTouchPointers.size === 2 && !pinchActive) {
          pinchActive = true;
          pinchDistance = currentPinchDistance();
          zoomCentering.beginManualInput('pinch');
        }
        if (activeTouchPointers.size !== 1) return;
        longPressOrigin = { x: event.clientX, y: event.clientY };
        longPressTimer = window.setTimeout(() => {
          if (longPressOrigin && activeTouchPointers.size === 1) {
            inspectAt(new Cesium.Cartesian2(longPressOrigin.x, longPressOrigin.y), onLongPressRef.current);
          }
          clearLongPress();
        }, 600);
        return;
      }

      const kind: ManualInteractionKind | null = event.button === 2
        ? 'zoom-drag'
        : event.button === 1
          ? 'pan'
          : event.button === 0
            ? 'rotate'
            : null;
      if (kind) beginPointerInteraction(event.pointerId, kind);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') {
        touchPositions.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pinchActive && activeTouchPointers.size >= 2) {
          const nextDistance = currentPinchDistance();
          if (nextDistance !== null && pinchDistance !== null && Math.abs(nextDistance - pinchDistance) > 0.5) {
            zoomCentering.markZoom();
          }
          pinchDistance = nextDistance;
        }
        if (!longPressOrigin) return;
        if (
          activeTouchPointers.size !== 1 ||
          Math.hypot(event.clientX - longPressOrigin.x, event.clientY - longPressOrigin.y) > 12
        ) clearLongPress();
        return;
      }
      if (pointerInteractions.get(event.pointerId) === 'zoom-drag') zoomCentering.markZoom();
    };
    const onPointerEnd = (event: PointerEvent) => {
      endPointerInteraction(event.pointerId);
      if (event.pointerType !== 'touch') return;
      activeTouchPointers.delete(event.pointerId);
      touchPositions.delete(event.pointerId);
      if (pinchActive && activeTouchPointers.size < 2) {
        pinchActive = false;
        pinchDistance = null;
        zoomCentering.endManualInput('pinch');
      }
      clearLongPress();
    };
    const onWheel = () => zoomCentering.wheel();
    const onCameraMoveStart = () => zoomCentering.beginManualInput('camera-motion');
    const onCameraMoveEnd = () => zoomCentering.endManualInput('camera-motion');
    const preventNativeGesture = (event: Event) => event.preventDefault();
    viewer.camera.moveStart.addEventListener(onCameraMoveStart);
    viewer.camera.moveEnd.addEventListener(onCameraMoveEnd);
    viewer.scene.canvas.addEventListener('pointerdown', onPointerDown, { passive: true });
    viewer.scene.canvas.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerup', onPointerEnd, { passive: true });
    window.addEventListener('pointercancel', onPointerEnd, { passive: true });
    viewer.scene.canvas.addEventListener('wheel', onWheel, { passive: true });
    viewer.scene.canvas.addEventListener('gesturestart', preventNativeGesture, { passive: false });
    viewer.scene.canvas.addEventListener('gesturechange', preventNativeGesture, { passive: false });

    // ── OSM Buildings (free, Cesium Ion asset 96188) ──
    // Cesium's 3D Tiles content (b3dm building models) has broken 2D/Columbus
    // View support: updating its model matrix calls GeographicProjection.project
    // with an undefined cartographic, throwing "Cannot read properties of
    // undefined (reading 'longitude')" on every frame the tileset tries to
    // update. That crashes scene.renderError repeatedly — the render loop
    // auto-restarts (see the renderError listener above) but never stays up
    // long enough to draw anything else, which is why switching to 2D looked
    // like it broke everything (imagery, wind, station pins) at once rather
    // than just the buildings. Fix: hide the tileset outright whenever the
    // scene isn't in 3D mode (see the mapMode effect below) instead of asking
    // it to render somewhere Cesium doesn't support.
    Cesium.createOsmBuildingsAsync()
      .then((tileset) => {
        if (!viewerRef.current || viewerRef.current.isDestroyed()) return;
        tileset.show = mapModeRef.current === '3d';
        osmBuildingsRef.current = tileset;
        viewer.scene.primitives.add(tileset);
        setStatusMsg('ISRO Earth View ready');
      })
      .catch(() => setStatusMsg('ISRO Earth View ready'));

    // ── India State Boundaries — GeoJsonDataSource (stable, no workers) ─────
    Cesium.GeoJsonDataSource.load('/india_states.geojson', {
      stroke: Cesium.Color.fromCssColorString('#22d3ee').withAlpha(0.5),
      strokeWidth: 1,
      fill: Cesium.Color.TRANSPARENT,
      clampToGround: false,
    }).then((ds) => {
      if (!viewerRef.current || viewerRef.current.isDestroyed()) return;
      viewerRef.current.dataSources.add(ds);
    }).catch(() => { /* boundary file may not exist */ });

    // ── Data sources for climate overlays ──
    const overlaySource = new Cesium.CustomDataSource('vayu-climate');
    const scenarioSource = new Cesium.CustomDataSource('vayu-scenario');
    const extrude3DSource = new Cesium.CustomDataSource('vayu-3d');
    viewer.dataSources.add(overlaySource);
    viewer.dataSources.add(scenarioSource);
    viewer.dataSources.add(extrude3DSource);
    overlayRef.current = overlaySource;
    scenarioRef.current = scenarioSource;
    extrude3DRef.current = extrude3DSource;

    viewerRef.current = viewer;
    setIsReady(true);

    return () => {
      window.clearTimeout(introFlyTimer);
      clearLongPress();
      viewer.camera.moveStart.removeEventListener(onCameraMoveStart);
      viewer.camera.moveEnd.removeEventListener(onCameraMoveEnd);
      viewer.scene.canvas.removeEventListener('pointerdown', onPointerDown);
      viewer.scene.canvas.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerEnd);
      window.removeEventListener('pointercancel', onPointerEnd);
      viewer.scene.canvas.removeEventListener('wheel', onWheel);
      viewer.scene.canvas.removeEventListener('gesturestart', preventNativeGesture);
      viewer.scene.canvas.removeEventListener('gesturechange', preventNativeGesture);
      resizeObserver?.disconnect();
      boundsTransitionTarget?.removeEventListener('transitionend', onBoundsTransitionEnd);
      window.removeEventListener('resize', onViewportResize);
      window.visualViewport?.removeEventListener('resize', onViewportResize);
      document.removeEventListener('fullscreenchange', onViewportResize);
      zoomCentering.dispose();
      resizeCompletion.dispose();
      if (zoomCenteringRef.current === zoomCentering) zoomCenteringRef.current = null;
      if (resizeCompletionRef.current === resizeCompletion) resizeCompletionRef.current = null;
      handler.destroy();
      viewer.scene.canvas.removeEventListener('pointerleave', onCanvasPointerLeave);
      if (windLayerRef.current) {
        try { windLayerRef.current.destroy(); } catch {}
        windLayerRef.current = null;
      }
      if (terminatorTimerRef.current) clearTimeout(terminatorTimerRef.current);
      if (terminatorLayerRef.current) {
        try { terminatorLayerRef.current.destroy(); } catch {}
        terminatorLayerRef.current = null;
      }
      viewer.destroy();
      viewerRef.current = null;
      extrude3DRef.current = null;
    };
  }, []);

  // ── Wind particle animation (cesium-wind-layer) ─────────────────────────────
  // Kept in a ref (rather than a useEffect dependency) so changing style
  // doesn't force a full data re-fetch/layer rebuild — see the updateOptions
  // effect below, which applies style changes to the live layer in place.
  const windStyleRef = useRef(windStyle);
  windStyleRef.current = windStyle;

  // Cache the fetched field so a mode-triggered rebuild doesn't re-fetch.
  const windFieldDataRef = useRef<WindData | null>(null);
  // Rebuilding on mapMode change (below) constructs a fresh WindLayer, which
  // defaults to visible — read the current showWind here rather than relying
  // solely on the separate toggle effect, which won't re-fire on a rebuild
  // that wasn't itself triggered by a showWind change.
  const showWindRef = useRef(showWind);
  showWindRef.current = showWind;

  useEffect(() => {
    if (!isReady || !viewerRef.current) return;
    const viewer = viewerRef.current;
    if (viewer.isDestroyed()) return;
    let cancelled = false;

    // Clean up previous wind layer
    if (windLayerRef.current) {
      try { windLayerRef.current.destroy(); } catch {}
      windLayerRef.current = null;
    }

    const buildLayer = (windData: WindData) => {
      if (cancelled || !viewerRef.current || viewerRef.current.isDestroyed()) return;
      const wl = new WindLayer(viewerRef.current, windData, {
        ...WIND_STYLE_PRESETS[windStyleRef.current],
        particleHeight: 8000,
        flipY: false,
        useViewerBounds: true,
        dynamic: true,
      });
      const wlUntyped = wl as unknown as Record<string, unknown>;
      if ('show' in wlUntyped) wlUntyped.show = showWindRef.current;
      windLayerRef.current = wl;
    };

    // cesium-wind-layer allocates GPU resources (a custom depth texture among
    // them) sized/bound against whatever scene.mode is active *right now*.
    // Building it while scene.mode === MORPHING (mid 2D/3D transition) races
    // Cesium's own internal texture reallocation for the transition, which
    // silently deletes textures the freshly-built wind layer already bound —
    // surfacing later as "WebGL: bindTexture: attempt to use a deleted
    // object" with no particles ever appearing. Rebuilding on every mapMode
    // change (not just once at mount) and waiting for morphComplete when a
    // morph is genuinely in flight avoids constructing into that transition.
    const start = () => {
      if (cancelled) return;
      const proceed = (windData: WindData) => buildLayer(windData);

      const withData = (cb: (d: WindData) => void) => {
        if (windFieldDataRef.current) { cb(windFieldDataRef.current); return; }
        fetch('/wind_field.json')
          .then((r) => r.json())
          .then((raw: {
            width: number; height: number; u: number[]; v: number[];
            uMin: number; uMax: number; vMin: number; vMax: number;
            bounds: { west: number; south: number; east: number; north: number };
          }) => {
            if (cancelled) return;
            const windData: WindData = {
              width: raw.width,
              height: raw.height,
              // Mock placeholder data (frontend/public/wind_field.json) until
              // the backend exposes real uwnd_850/vwnd_850 per the
              // data-parameters doc — bounds come from the file itself so
              // real data's extent is honoured automatically once swapped in.
              bounds: raw.bounds,
              u: { array: new Float32Array(raw.u), min: raw.uMin, max: raw.uMax },
              v: { array: new Float32Array(raw.v), min: raw.vMin, max: raw.vMax },
            };
            windFieldDataRef.current = windData;
            cb(windData);
          })
          .catch((e) => console.warn('[VAYU] Wind layer init failed:', e));
      };

      withData(proceed);
    };

    if (viewer.scene.mode === Cesium.SceneMode.MORPHING) {
      const removeListener = viewer.scene.morphComplete.addEventListener(() => {
        removeListener();
        start();
      });
      return () => { cancelled = true; removeListener(); };
    }

    start();
    return () => { cancelled = true; };
  }, [isReady, mapMode]);

  // ── Apply wind style preset changes without rebuilding the whole layer ─────
  useEffect(() => {
    windLayerRef.current?.updateOptions(WIND_STYLE_PRESETS[windStyle]);
  }, [windStyle]);

  // ── Toggle wind particle visibility ─────────────────────────────────────────
  useEffect(() => {
    if (!windLayerRef.current) return;
    const wl = windLayerRef.current as unknown as Record<string, unknown>;
    // cesium-wind-layer exposes `show` on the layer object
    if ('show' in wl) wl.show = showWind;
  }, [showWind]);

  // ── Switch NASA GIBS / background layers ────────────────────────────────────
  useEffect(() => {
    if (!isReady || !viewerRef.current) return;
    const viewer = viewerRef.current;

    // Remove ALL previous GIBS layers (robust cleanup to prevent artifacts)
    if (gibsLayerRef.current) {
      try { viewer.imageryLayers.remove(gibsLayerRef.current, true); } catch {}
      gibsLayerRef.current = null;
    }
    // Remove any orphaned overlay layers (index > 0) except heatmap
    const heatmap = heatmapLayerRef.current;
    for (let i = viewer.imageryLayers.length - 1; i > 0; i--) {
      const layer = viewer.imageryLayers.get(i);
      if (layer !== heatmap) {
        try { viewer.imageryLayers.remove(layer, true); } catch {}
      }
    }

    const dateStr = gibsDate || new Date().toISOString().split('T')[0];

    const addGibs = (templateUrl: string, alpha = 0.85, maxLevel = 9) => {
      const url = templateUrl.replace('{Time}', dateStr);
      const layer = viewer.imageryLayers.addImageryProvider(
        new Cesium.UrlTemplateImageryProvider({
          url,
          credit: 'NASA Worldview / GIBS',
          maximumLevel: maxLevel,
          tilingScheme: new Cesium.WebMercatorTilingScheme(),
        })
      );
      layer.alpha = alpha;
      layer.brightness = 1.0;
      gibsLayerRef.current = layer;
    };

    // Toggle base layer visibility
    const baseLayer = viewer.imageryLayers.length > 0 ? viewer.imageryLayers.get(0) : null;

    switch (activeLayer) {
      case 'satellite':
        if (baseLayer) baseLayer.show = true;
        break;
      case 'modis':
      case 'nightlights':
      case 'fires':
        // Removed — these layers have reliability issues with GIBS
        if (baseLayer) baseLayer.show = true;
        break;
      case 'precipitation':
        if (baseLayer) baseLayer.show = true;
        addGibs(GIBS_LAYERS.Precipitation, 0.75, 6);
        break;
      case 'cloud':
        if (baseLayer) baseLayer.show = true;
        addGibs(GIBS_LAYERS.CloudFraction, 0.65, 6);
        break;
      case 'sst':
        if (baseLayer) baseLayer.show = true;
        addGibs(GIBS_LAYERS.SST, 0.80, 7);
        break;
      case 'aerosol':
        if (baseLayer) baseLayer.show = true;
        addGibs(GIBS_LAYERS.Aerosol, 0.70, 6);
        break;
      case 'ndvi': {
        if (baseLayer) baseLayer.show = true;
        // NDVI is 8-day composite — round date to nearest 8-day period start
        const ndviDate = new Date(dateStr);
        const dayOfYear = Math.floor((ndviDate.getTime() - new Date(ndviDate.getFullYear(), 0, 0).getTime()) / 86400000);
        const ndviPeriod = Math.floor((dayOfYear - 1) / 8) * 8 + 1;
        const ndviStartDate = new Date(ndviDate.getFullYear(), 0, ndviPeriod);
        const ndviDateStr = ndviStartDate.toISOString().split('T')[0];
        const ndviUrl = GIBS_LAYERS.NDVI.replace('{Time}', ndviDateStr);
        const ndviLayer = viewer.imageryLayers.addImageryProvider(
          new Cesium.UrlTemplateImageryProvider({
            url: ndviUrl,
            credit: 'NASA Worldview / GIBS',
            maximumLevel: 8,
            tilingScheme: new Cesium.WebMercatorTilingScheme(),
          })
        );
        ndviLayer.alpha = 0.75;
        gibsLayerRef.current = ndviLayer;
        break;
      }
      case 'modis_lst': {
        if (baseLayer) baseLayer.show = true;
        const lstUrl = `${GIBS_BASE}/MODIS_Terra_Land_Surface_Temp_Day/default/${dateStr}/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png`;
        addGibs(lstUrl, 0.70, 7);
        break;
      }
      case 'owm_precip':
      case 'owm_temp':
      case 'owm_wind': {
        if (baseLayer) baseLayer.show = true;
        const owmUrl = OWM_LAYERS[activeLayer];
        if (owmUrl) {
          const layer = viewer.imageryLayers.addImageryProvider(
            new Cesium.UrlTemplateImageryProvider({
              url: owmUrl,
              credit: 'OpenWeatherMap',
              maximumLevel: 9,
              tilingScheme: new Cesium.WebMercatorTilingScheme(),
            }),
          );
          layer.alpha = 0.75;
          gibsLayerRef.current = layer;
        }
        break;
      }
      default:
        if (baseLayer) baseLayer.show = true;
    }
  }, [isReady, activeLayer, gibsDate]);

  // ── Update climate heatmap overlay ──────────────────────────────────────────
  // Strategy: Use SingleTileImageryProvider (proven working) but NEVER remove
  // the old layer until the new one is fully loaded and added. This prevents
  // the render loop from encountering a frame with missing imagery.

  const heatmapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Incremented on every render request. `fromUrl()` is asynchronous, so a
  // generation token prevents an old unmasked canvas from replacing a newer
  // outline-clipped layer after the GeoJSON fetch resolves.
  const heatmapRenderGenerationRef = useRef(0);

  useEffect(() => {
    if (!isReady || !viewerRef.current || viewerRef.current.isDestroyed()) return;

    const renderGeneration = ++heatmapRenderGenerationRef.current;
    let cancelled = false;
    const isCurrentRender = () => (
      !cancelled && heatmapRenderGenerationRef.current === renderGeneration
    );

    // Debounce — wait for slider to settle
    if (heatmapTimerRef.current) clearTimeout(heatmapTimerRef.current);

    heatmapTimerRef.current = setTimeout(() => {
      if (!isCurrentRender() || !viewerRef.current || viewerRef.current.isDestroyed()) return;

      // No data → just hide existing layer
      if (gridCells.length === 0) {
        if (heatmapLayerRef.current) {
          heatmapLayerRef.current.show = false;
        }
        return;
      }

      // Filter NaN
      const validCells = gridCells.filter(c => Number.isFinite(c[variable] as number));
      if (validCells.length === 0) {
        if (heatmapLayerRef.current) heatmapLayerRef.current.show = false;
        return;
      }

      // Grid dims
      const lats = [...new Set(validCells.map(c => c.lat))].sort((a, b) => a - b);
      const lons = [...new Set(validCells.map(c => c.lon))].sort((a, b) => a - b);
      const nLat = lats.length;
      const nLon = lons.length;
      if (nLat < 2 || nLon < 2) return;

      const cellMap = new Map<string, typeof gridCells[0]>();
      for (const cell of validCells) {
        cellMap.set(`${cell.lat.toFixed(3)}_${cell.lon.toFixed(3)}`, cell);
      }

      const activeColormap: ColormapId = colormap ?? (
        variable === 'rainfall' ? 'imd_rain' : variable === 'temp_max' ? 'sunset' : 'ocean_violet'
      );

      // Paint a raw, one-pixel-per-cell raster first, then smooth-scale it
      // up. Browser image scaling bilinearly (often bicubically) blends the
      // colors *and* alpha between neighboring cells, so the discrete 0.25°
      // grid reads as a continuous spatial field (Ventusky-style) instead
      // of hard-edged blocks — with no per-point interpolation math needed.
      const raw = document.createElement('canvas');
      raw.width = nLon;
      raw.height = nLat;
      const rawCtx = raw.getContext('2d');
      if (!rawCtx) return;
      const cfg = VARIABLE_CONFIG[variable];

      // Feather the outer ~2 cells toward transparent so the domain boundary
      // reads as a soft fade instead of a hard-edged rectangle.
      const FEATHER_CELLS = 2;

      for (let latIdx = 0; latIdx < nLat; latIdx++) {
        for (let lonIdx = 0; lonIdx < nLon; lonIdx++) {
          const lat = lats[nLat - 1 - latIdx];
          const lon = lons[lonIdx];
          const cell = cellMap.get(`${lat.toFixed(3)}_${lon.toFixed(3)}`);
          if (cell) {
            const val = cell[variable] as number;
            const t = variable === 'rainfall'
              ? rainfallToT(val)
              : Math.max(0, Math.min(1, (val - cfg.min) / (cfg.max - cfg.min)));
            const distToEdge = Math.min(latIdx, nLat - 1 - latIdx, lonIdx, nLon - 1 - lonIdx);
            const edgeFactor = Math.min(1, (distToEdge + 0.5) / FEATHER_CELLS);
            rawCtx.fillStyle = _heatmapColor(t, variable, activeColormap, edgeFactor);
          } else {
            rawCtx.fillStyle = 'rgba(0,0,0,0)';
          }
          rawCtx.fillRect(lonIdx, latIdx, 1, 1);
        }
      }

      // Cap the output canvas so very large regions (e.g. full India) don't
      // produce an oversized texture — clamp the up-scale factor instead of
      // using a fixed one.
      const MAX_OUTPUT_PX = 2048;
      const smoothScale = Math.max(4, Math.min(24, Math.floor(MAX_OUTPUT_PX / Math.max(nLon, nLat))));

      const canvas = document.createElement('canvas');
      canvas.width = nLon * smoothScale;
      canvas.height = nLat * smoothScale;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(raw, 0, 0, canvas.width, canvas.height);

      const cellSize = 0.25;
      const west = lons[0] - cellSize / 2;
      const east = lons[nLon - 1] + cellSize / 2;
      const south = lats[0] - cellSize / 2;
      const north = lats[nLat - 1] + cellSize / 2;

      // ── Clip to India's landmass ──────────────────────────────────────────
      // The raster above is always a plain lon/lat rectangle, so without this
      // it paints ocean and neighboring countries wherever the data bbox
      // overhangs the coastline (e.g. Western Ghats' bbox includes Arabian
      // Sea west of the coast). Shared with the scenario overlay and the
      // before/after comparison so all three agree on the coastline.
      clipCanvasToIndia(
        ctx, canvas.width, canvas.height,
        { west, east, south, north },
        indiaOutlineRef.current,
      );

      // Create new layer FIRST, then remove old one only after new is ready
      const oldLayer = heatmapLayerRef.current;

      Cesium.SingleTileImageryProvider.fromUrl(canvas.toDataURL('image/png'), {
        rectangle: Cesium.Rectangle.fromDegrees(west, south, east, north),
      }).then((provider) => {
        if (!isCurrentRender()) return;
        const viewer = viewerRef.current;
        if (!viewer || viewer.isDestroyed()) return;

        // Add the new layer before removing the old one so no blank imagery
        // frame is exposed. Re-check the generation before publishing it: an
        // old provider resolving after a newer request must never replace the
        // current (possibly outline-clipped) raster.
        const newLayer = viewer.imageryLayers.addImageryProvider(provider);
        if (!isCurrentRender()) {
          try { viewer.imageryLayers.remove(newLayer, true); } catch {}
          return;
        }
        // Via the ref, so this effect need not depend on heatmapOpacity.
        newLayer.alpha = heatmapOpacityRef.current;
        heatmapLayerRef.current = newLayer;

        if (oldLayer && oldLayer !== newLayer) {
          try { viewer.imageryLayers.remove(oldLayer, true); } catch {}
        }
      }).catch(() => {});
    }, 500);

    return () => {
      cancelled = true;
      // Invalidate a provider promise that is already in flight; clearing the
      // debounce alone is not sufficient because fromUrl resolves later.
      if (heatmapRenderGenerationRef.current === renderGeneration) {
        heatmapRenderGenerationRef.current += 1;
      }
      if (heatmapTimerRef.current) clearTimeout(heatmapTimerRef.current);
    };
    // `heatmapOpacity` is deliberately NOT a dependency. This effect repaints the
    // whole canvas, encodes a PNG data URL, awaits SingleTileImageryProvider, and
    // swaps an imagery layer. The opacity control is a range input with
    // step=0.01, so dragging it would reset the 500 ms debounce and trigger a
    // full raster rebuild per pixel of travel — wasted work plus visible flicker
    // as layers swap. Opacity only needs `layer.alpha`, which the pulse effect
    // below applies on every tick; the initial value is read from
    // heatmapOpacityRef so a newly created layer is still correct.
  }, [gridCells, variable, isReady, colormap, outlineLoaded]);

  // ── Ambient heatmap "breathing" animation ───────────────────────────────────
  // Purely cosmetic: gently oscillates the imagery layer's alpha so a static
  // raster reads as live/updating rather than a frozen paste-on. Reads
  // heatmapLayerRef on every tick (rather than depending on it) so the same
  // interval keeps animating across canvas rebuilds when date/variable/region
  // changes swap in a new layer. Driven by setInterval, not requestAnimationFrame
  // — same reasoning as the hero rotation above (clock.shouldAnimate is false,
  // and rAF pauses in backgrounded/automated tabs).
  useEffect(() => {
    if (!isReady) return;

    // Not animated: pin alpha to the chosen opacity and skip the interval
    // entirely — no oscillation to disable mid-tick.
    if (!heatmapAnimated) {
      const layer = heatmapLayerRef.current;
      if (layer) layer.alpha = heatmapOpacity;
      return;
    }

    const PULSE_TICK_MS = 80;
    const PULSE_PERIOD_MS = 3200;
    const PULSE_AMPLITUDE = 0.12;

    let elapsed = 0;
    const pulseTimer = window.setInterval(() => {
      const layer = heatmapLayerRef.current;
      if (!layer || layer.show === false) return;
      elapsed += PULSE_TICK_MS;
      const phase = (elapsed % PULSE_PERIOD_MS) / PULSE_PERIOD_MS;
      // Clamped: ImageryLayer.alpha is defined on [0, 1], and at
      // heatmapOpacity = 1 the +0.12 pulse amplitude would push it to 1.12.
      const pulsed = heatmapOpacity + PULSE_AMPLITUDE * Math.sin(phase * Math.PI * 2);
      layer.alpha = Math.min(1, Math.max(0, pulsed));
    }, PULSE_TICK_MS);

    return () => window.clearInterval(pulseTimer);
  }, [isReady, heatmapOpacity, heatmapAnimated]);

  // Request a measured resize cycle after persistent UI changes the canvas
  // bounds. The controller performs a final resize after the 300ms shell
  // transition (or its deterministic fallback) and never touches the camera.
  useEffect(() => {
    if (!isReady) return;
    resizeCompletionRef.current?.requestCompletion();
  }, [isReady, viewportKey]);

  // ── Fly to region when region changes ─────────────────────────────────────
  useEffect(() => {
    if (!isReady || !viewerRef.current) return;
    // Skip the very first run for the default region — the cinematic intro's
    // own flyTo already takes the camera there, and racing it here was the
    // cause of the globe occasionally winding up pointed at empty space.
    if (!hasFlownInitialRegionRef.current) {
      hasFlownInitialRegionRef.current = true;
      if (!regionFlyTrigger) return;
    }
    const regionOpt = REGIONS.find((r) => r.id === region);
    if (!regionOpt) return;
    // Fly to the region's exact geographic rectangle (matching
    // ai_engine/regions.py REGION_BOUNDS) so every region — regardless of its
    // lat/lon aspect ratio (North-East India is taller/narrower than the
    // others, "All India" is much larger) — is correctly framed and centered.
    // Pitch is kept close to top-down (REGION_PITCH_DEGREES, not a shallow
    // -45/-48°) — a shallow pitch looks forward-and-down at the horizon
    // instead of straight down at the target, which pushes the visible
    // region toward the bottom of the frame with excess empty sky above.
    flyCameraToBounds(viewerRef.current, regionOpt.bounds, { pitchDegrees: REGION_PITCH_DEGREES, duration: 2.5 });
  }, [region, isReady, regionFlyTrigger, flyCameraToBounds]);

  // ── Terrain exaggeration (Feature 5) ───────────────────────────────────────
  useEffect(() => {
    if (!isReady || !viewerRef.current) return;
    const viewer = viewerRef.current;
    if (viewer.isDestroyed()) return;
    // terrainExaggeration was removed from Viewer options in Cesium 1.118+;
    // use scene.verticalExaggeration instead
    try {
      (viewer.scene as unknown as { verticalExaggeration: number }).verticalExaggeration = terrainExaggeration;
    } catch {
      // fallback: set on globe if the property exists
      try {
        (viewer.scene.globe as unknown as { terrainExaggeration: number }).terrainExaggeration = terrainExaggeration;
      } catch { /* noop */ }
    }
  }, [isReady, terrainExaggeration]);

  // ── Guided Tour camera steps (Feature 29) ─────────────────────────────────
  useEffect(() => {
    if (!isReady || !viewerRef.current || !tourStep) return;
    const viewer = viewerRef.current;
    if (viewer.isDestroyed()) return;
    flyCameraTo(viewer, {
      destination: Cesium.Cartesian3.fromDegrees(tourStep.lon, tourStep.lat, tourStep.altitude),
      orientation: {
        heading: 0,
        pitch: Cesium.Math.toRadians(tourStep.pitch),
        roll: 0,
      },
      duration: tourStep.duration,
    });
  }, [isReady, tourStep, flyCameraTo]);

  // ── 3D Extruded Grid — Rainfall, Tmax, Tmin ─────────────────────────────────
  // Column height/color use the same t-normalization and default colormap as
  // the 2D heatmap (rainfallToT for rainfall, linear min/max for temperature;
  // imd_rain/sunset/ocean_violet defaults) so switching between 2D and 3D
  // reads as the same data, not a different visualization.
  useEffect(() => {
    if (!isReady || !extrude3DRef.current) return;
    const source = extrude3DRef.current;
    source.entities.removeAll();
    if (!show3D || gridCells.length === 0) return;

    const cfg = VARIABLE_CONFIG[variable];
    const activeColormap: ColormapId = colormap ?? (
      variable === 'rainfall' ? 'imd_rain' : variable === 'temp_max' ? 'sunset' : 'ocean_violet'
    );
    // Keep the per-polygon grouping rather than flattening to a ring list: the
    // grouping is what lets holes be excluded (even-odd across a polygon's own
    // rings) and what the bounding-box fast path is keyed on. Boxes are computed
    // once here because the test below runs for every grid cell.
    const outlinePolygons = indiaOutlineRef.current;
    const outlineBoxes = outlinePolygons?.map(polygonBBox);

    gridCells.forEach((cell) => {
      const val = cell[variable] as number;
      if (!Number.isFinite(val)) return;
      // Rainfall is heavily zero-skewed — skip dry cells so the grid isn't
      // mostly near-invisible slivers. Temperature has no such "dry" concept;
      // every cell gets a column.
      if (variable === 'rainfall' && val < 1) return;
      // Clip to India's landmass — otherwise columns stand in the ocean
      // wherever the region's data bbox overhangs the coastline.
      if (!isInsideIndia(cell.lon, cell.lat, outlinePolygons, outlineBoxes)) return;

      const t = variable === 'rainfall'
        ? rainfallToT(val)
        : Math.max(0, Math.min(1, (val - cfg.min) / (cfg.max - cfg.min)));
      const height = t * cfg.extrudeScale;

      const [r, g, b] = COLOR_SCALES[activeColormap](t);
      const color = new Cesium.Color(r / 255, g / 255, b / 255, 0.8);

      source.entities.add({
        rectangle: {
          coordinates: Cesium.Rectangle.fromDegrees(
            cell.lon - 0.1, cell.lat - 0.1, cell.lon + 0.1, cell.lat + 0.1,
          ),
          material: color,
          height: 0,
          extrudedHeight: height,
          outline: false,
        },
        description: `${val.toFixed(1)} ${cfg.unit}`,
      });
    });
  }, [isReady, show3D, gridCells, variable, colormap, outlineLoaded]);

  // ── Day / Night Terminator Line + Nightside Lighting (Feature 6) ───────────
  // Re-enabled after fixing why it was disabled: (1) this effect now
  // debounces selectedDate changes (mirroring the heatmap effect below)
  // instead of redrawing on every timeline-drag tick, which is what caused
  // the render-loop crashes; (2) nightside darkening no longer uses a
  // hand-rolled polygon covering the "night hemisphere" — a first attempt at
  // that visibly blacked out nearly the entire view, because Cesium's
  // polygon triangulation targets regional shapes, not planet-scale interior
  // fills. Darkening is now done via the globe's own native per-pixel
  // lighting (enableLighting + clock.currentTime), which is what that
  // feature exists for and is guaranteed to shade the correct hemisphere.
  useEffect(() => {
    if (!isReady || !viewerRef.current) return;
    const viewer = viewerRef.current;
    const layer = terminatorLayerRef.current;

    if (terminatorTimerRef.current) clearTimeout(terminatorTimerRef.current);

    if (!showTerminator) {
      layer?.clear();
      viewer.scene.globe.enableLighting = false;
      return;
    }

    terminatorTimerRef.current = setTimeout(() => {
      if (viewer.isDestroyed()) return;
      const date = selectedDate ?? new Date();

      // Reference time for the sun direction, then enable per-pixel lighting.
      viewer.clock.currentTime = Cesium.JulianDate.fromDate(date);
      viewer.scene.globe.enableLighting = true;

      layer?.update({
        gridCells: [],
        variable,
        region,
        forecastDay: 1,
        terrainExaggeration,
        colormap: colormap ?? 'imd_rain',
        show3D,
        showWind,
        showContours: false,
        showBoundaries: false,
        showUncertainty: false,
        scenarioData,
        gibsDate: gibsDate ?? '',
        selectedDate: date,
        heatmapOpacity: 0.78,
      });
    }, 500);

    return () => {
      if (terminatorTimerRef.current) clearTimeout(terminatorTimerRef.current);
    };
  }, [isReady, showTerminator, selectedDate]);

  // ── Update scenario delta overlay (right half in split-screen) ─────────────
  useEffect(() => {
    if (!isReady || !scenarioRef.current) return;

    const source = scenarioRef.current;
    source.entities.removeAll();

    if (!scenarioData || !showSplitScreen) return;

    const delta = scenarioData.delta[variable];
    if (!delta) return;

    // Infer grid dimensions from the baseline gridCells (if available) or use defaults
    const cells = gridCellsRef.current;
    let nlat = 49, nlon = 25, latMin = 8.0, lonMin = 72.0, step = 0.25;

    if (cells.length > 0) {
      const lats = [...new Set(cells.map(c => c.lat))].sort((a, b) => a - b);
      const lons = [...new Set(cells.map(c => c.lon))].sort((a, b) => a - b);
      nlat = lats.length;
      nlon = lons.length;
      latMin = lats[0];
      lonMin = lons[0];
      if (lats.length > 1) step = lats[1] - lats[0];
    }

    // Clamp to actual delta length
    const maxIdx = Math.min(delta.length, nlat * nlon);

    // Clip the delta overlay to India, same as the heatmap raster.
    //
    // These are Cesium entities rather than an image, so there is no canvas to
    // mask — each cell centre is tested instead. Without this the scenario
    // overlay painted the full model rectangle, which for the Western Ghats box
    // put a third of the "rainfall change" over the Arabian Sea. The bboxes are
    // precomputed once here because this loop runs over every grid cell.
    const outline = indiaOutlineRef.current;
    const outlineBoxes = outline?.map(polygonBBox);

    for (let idx = 0; idx < maxIdx; idx++) {
      const d = delta[idx];
      const lat_i = Math.floor(idx / nlon);
      const lon_j = idx % nlon;
      const lat = latMin + lat_i * step;
      const lon = lonMin + lon_j * step;

      // Diverging colormap: negative = blue, positive = red
      const absD = Math.abs(d);
      const norm = Math.min(absD / 3.0, 1.0);
      if (norm < 0.05) continue; // skip tiny deltas for performance
      // Drop ocean and cross-border cells. When the outline has not loaded the
      // overlay is left unclipped rather than blanked, so a fetch failure
      // degrades to the previous behaviour instead of an empty map.
      if (outline && !pointInIndia(lon, lat, outline, outlineBoxes)) continue;
      const color = d > 0
        ? new Cesium.Color(1.0, 0.3, 0.1, 0.7 * norm + 0.15)
        : new Cesium.Color(0.1, 0.4, 1.0, 0.7 * norm + 0.15);

      source.entities.add({
        rectangle: {
          coordinates: Cesium.Rectangle.fromDegrees(
            lon - step / 2, lat - step / 2, lon + step / 2, lat + step / 2,
          ),
          material: color,
          height: 0,
        },
      });
    }
    // `outlineLoaded` is a dependency so the overlay re-renders (and gets
    // clipped) if the outline arrives after the first scenario result.
  }, [scenarioData, showSplitScreen, variable, isReady, outlineLoaded]);

  return (
    <div ref={containerRef} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' }}>

      {/* ── Loading splash ── */}
      {!isReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#030810] z-20">
          <div className="flex flex-col items-center gap-4">
            {/* ISRO-style rotating globe loader */}
            <div className="relative w-16 h-16">
              <div className="absolute inset-0 rounded-full border-2 border-blue-500/30 animate-ping" />
              <div className="absolute inset-1 rounded-full border-2 border-blue-400/60 animate-spin" style={{ borderTopColor: 'transparent' }} />
              <div className="absolute inset-3 rounded-full bg-blue-500/20" />
            </div>
            <div className="text-center">
              <div className="text-blue-300 font-semibold tracking-widest text-sm uppercase">VAYU Earth View</div>
              <div className="text-white/40 text-xs mt-1">India's Climate Digital Twin</div>
            </div>
          </div>
        </div>
      )}

      {/* ── ISRO branding HUD (top-left) ── REMOVED — App.tsx header handles branding */}

      {/* ── Coordinate tooltip (follows cursor while over the globe) ── */}
      {isReady && coords && (
        <div
          className="absolute z-10 pointer-events-none"
          style={{ left: coords.x + 16, top: coords.y + 16 }}
        >
          <div className="px-3 py-1.5 rounded bg-black/50 backdrop-blur-sm border border-white/10">
            <span className="text-green-300/70 font-mono text-xs whitespace-nowrap">
              {coords.lat >= 0 ? coords.lat.toFixed(4) + '°N' : (-coords.lat).toFixed(4) + '°S'}
              {' '}
              {coords.lon >= 0 ? coords.lon.toFixed(4) + '°E' : (-coords.lon).toFixed(4) + '°W'}
            </span>
          </div>
        </div>
      )}

      {/* ── Status badge REMOVED — reduces clutter ── */}

      {/* ── Active layer indicator — moved to App.tsx (top-left, next to the
          Region selector) so it no longer competes with the zoom controls
          and Satellite Imagery badge that used to both live bottom-right. ── */}

      {/* ── 3D mode badge ── */}
      {isReady && show3D && (
        <div className="absolute top-20 left-[140px] z-10 pointer-events-none animate-slide-in-up">
          <div className="px-3 py-1.5 rounded-lg backdrop-blur-sm" style={{ background: 'rgba(249,115,22,0.2)', border: '1px solid rgba(249,115,22,0.4)' }}>
            <span className="text-orange-300 text-xs font-medium">3D {VARIABLE_CONFIG[variable].label} Columns</span>
          </div>
        </div>
      )}
    </div>
  );
}

const CesiumGlobe = forwardRef(CesiumGlobeInner);
export default CesiumGlobe;

// This module is dynamically imported by AsyncCesiumGlobe so Cesium stays out of
// the initial bundle. Configure its token only once the renderer is requested.
const cesiumToken = import.meta.env.VITE_CESIUM_ION_TOKEN;
if (!cesiumToken || cesiumToken.includes('your_token_here')) {
  console.warn('[VAYU] No valid VITE_CESIUM_ION_TOKEN set; terrain may be unavailable.');
}
Cesium.Ion.defaultAccessToken = cesiumToken || '';
