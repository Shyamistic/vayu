import { useCallback, useEffect, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import { WindLayer } from 'cesium-wind-layer';
import type { WindData } from 'cesium-wind-layer';
import type { GridCell, RegionId, ScenarioResponse, VariableId } from '../types';
import { REGIONS } from './RegionSelector';
import { mapColor, COLOR_SCALES } from '../utils/colorScales';
import type { ColormapId } from '../utils/colorScales';

// ── Constants ──────────────────────────────────────────────────────────────────

const INDIA_CENTER  = { lat: 20.5, lon: 78.9, alt: 3_500_000 }; // Pan-India view
const PILOT_CENTER  = { lat: 14.0, lon: 75.0, alt: 1_100_000 }; // Western Ghats

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

// Variable display configuration
const VARIABLE_CONFIG = {
  rainfall: { label: 'Rainfall', unit: 'mm/day', min: 0,  max: 50, extrudeScale: 8000 },
  temp_max: { label: 'Tmax',     unit: '°C',     min: 20, max: 45, extrudeScale: 0    },
  temp_min: { label: 'Tmin',     unit: '°C',     min: 10, max: 35, extrudeScale: 0    },
};

/** Return CSS color string for heatmap canvas rendering — uses fluid-earth colormaps */
function _heatmapColor(t: number, variable: VariableId, colormapId: ColormapId): string {
  if (variable === 'rainfall' && t < 0.04) return 'rgba(255,255,255,0)';
  return mapColor(t, colormapId, variable === 'rainfall' && t < 0.05 ? 0 : 0.85);
}

/** Interpolate the IMD standard colormap for rainfall, perceptual colormaps for temperature */
function valueToColor(value: number, variable: VariableId): Cesium.Color {
  const cfg = VARIABLE_CONFIG[variable];
  const t = Math.max(0, Math.min(1, (value - cfg.min) / (cfg.max - cfg.min)));

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
  | 'fires' | 'owm_precip' | 'owm_temp' | 'owm_wind' | 'smap';

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
  terrainExaggeration?: number; // 1–5
  tourStep?: TourCameraStep | null;
  colormap?: ColormapId;   // scientific colormap selection
  show3D?: boolean;         // 3D extruded rainfall columns
  selectedDate?: Date;      // for day/night terminator
  showWind?: boolean;       // toggle wind particle layer
  regionFlyTrigger?: number; // increment to force fly-to even same region
}

export default function CesiumGlobe({
  gridCells,
  variable,
  region,
  scenarioData,
  showSplitScreen,
  activeLayer = 'satellite',
  gibsDate,
  onCellClick,
  terrainExaggeration = 1,
  tourStep = null,
  colormap,
  show3D = false,
  selectedDate,
  showWind = true,
  regionFlyTrigger,
}: CesiumGlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef    = useRef<Cesium.Viewer | null>(null);
  const overlayRef   = useRef<Cesium.CustomDataSource | null>(null);
  const scenarioRef  = useRef<Cesium.CustomDataSource | null>(null);
  const gibsLayerRef = useRef<Cesium.ImageryLayer | null>(null);
  const heatmapLayerRef = useRef<Cesium.ImageryLayer | null>(null);
  const windLayerRef = useRef<WindLayer | null>(null);
  const extrude3DRef = useRef<Cesium.CustomDataSource | null>(null);
  const terminatorRef = useRef<Cesium.Entity | null>(null);
  // Refs for stable closure access in event handlers
  const gridCellsRef = useRef<GridCell[]>(gridCells);
  const onCellClickRef = useRef(onCellClick);
  const [isReady, setIsReady] = useState(false);
  const [statusMsg, setStatusMsg] = useState('Loading ISRO Earth View…');
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);

  // Keep refs in sync with props
  useEffect(() => { gridCellsRef.current = gridCells; }, [gridCells]);
  useEffect(() => { onCellClickRef.current = onCellClick; }, [onCellClick]);

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
      console.warn('[VAYU] Cesium render error — restarting render loop');
      try {
        viewer.useDefaultRenderLoop = false;
        setTimeout(() => {
          if (!viewer.isDestroyed()) {
            viewer.useDefaultRenderLoop = true;
          }
        }, 100);
      } catch {}
    });

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

    // ── Auto-center globe when zoomed out ──
    // When far from Earth, gently pitch the camera toward looking at Earth's center.
    // IMPORTANT: Never set pitch to exactly -90° (causes Cesium DeveloperError).
    viewer.scene.preRender.addEventListener(() => {
      try {
        const cameraHeight = viewer.camera.positionCartographic.height;
        if (cameraHeight > 4_000_000) {
          const currentPitch = viewer.camera.pitch;
          // Target: -85° (safe distance from -90° degenerate state)
          const targetPitch = Cesium.Math.toRadians(-85);
          const t = Math.min(1, (cameraHeight - 4_000_000) / 10_000_000);
          const lerpFactor = t * 0.02;
          const newPitch = Cesium.Math.clamp(
            currentPitch + (targetPitch - currentPitch) * lerpFactor,
            Cesium.Math.toRadians(-88),
            Cesium.Math.toRadians(-10),
          );
          viewer.camera.setView({
            orientation: {
              heading: viewer.camera.heading,
              pitch: newPitch,
              roll: viewer.camera.roll,
            },
          });
        }
      } catch {
        // Silently ignore camera errors during transitions
      }
    });

    // ── Cinematic intro: start from space, zoom to India ──
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(INDIA_CENTER.lon, INDIA_CENTER.lat, 8_000_000),
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(-89), roll: 0 },
    });
    setTimeout(() => {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(PILOT_CENTER.lon, PILOT_CENTER.lat, PILOT_CENTER.alt),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-45), roll: 0 },
        duration: 3.0,
        easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
      });
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
          });
        }
      } catch {
        // pickPosition can throw when depth buffer isn't ready
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    // ── Click handler for grid cell query (Feature 25) ──
    // We store a ref to the latest gridCells so the closure stays current
    handler.setInputAction((click: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      try {
        // Try pickPosition first (requires depth buffer), fallback to ellipsoid pick
        let cartesian = viewer.scene.pickPosition(click.position);
        if (!cartesian) {
          const ellipsoidPick = viewer.camera.pickEllipsoid(click.position, viewer.scene.globe.ellipsoid);
          if (!ellipsoidPick) return;
          cartesian = ellipsoidPick;
        }
        const carto = Cesium.Cartographic.fromCartesian(cartesian);
        const clickLat = Cesium.Math.toDegrees(carto.latitude);
        const clickLon = Cesium.Math.toDegrees(carto.longitude);

      // Find closest grid cell (nearest 0.25° node)
      const snapLat = Math.round(clickLat / 0.25) * 0.25;
      const snapLon = Math.round(clickLon / 0.25) * 0.25;
      const key = `${snapLat.toFixed(3)}_${snapLon.toFixed(3)}`;

      // Use ref so we always access the latest gridCells without re-registering
      const cells = gridCellsRef.current;
      const cell = cells.find(
        (c) => `${c.lat.toFixed(3)}_${c.lon.toFixed(3)}` === key,
      ) ?? cells.reduce<GridCell | null>((closest, c) => {
        if (!closest) return c;
        const d1 = Math.hypot(c.lat - clickLat, c.lon - clickLon);
        const d2 = Math.hypot(closest.lat - clickLat, closest.lon - clickLon);
        return d1 < d2 ? c : closest;
      }, null);

      if (cell && onCellClickRef.current) {
        onCellClickRef.current(cell, click.position.x, click.position.y);
      }
      } catch {
        // pickPosition can throw DeveloperError when depth buffer isn't ready
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // ── OSM Buildings (free, Cesium Ion asset 96188) ──
    Cesium.createOsmBuildingsAsync()
      .then((tileset) => {
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
      handler.destroy();
      if (windLayerRef.current) {
        try { windLayerRef.current.destroy(); } catch {}
        windLayerRef.current = null;
      }
      viewer.destroy();
      viewerRef.current = null;
      extrude3DRef.current = null;
      terminatorRef.current = null;
    };
  }, []);

  // ── Wind particle animation (cesium-wind-layer) ─────────────────────────────
  useEffect(() => {
    if (!isReady || !viewerRef.current) return;
    const viewer = viewerRef.current;
    if (viewer.isDestroyed()) return;

    // Clean up previous wind layer
    if (windLayerRef.current) {
      try { windLayerRef.current.destroy(); } catch {}
      windLayerRef.current = null;
    }

    fetch('/wind_field.json')
      .then((r) => r.json())
      .then((raw: { width: number; height: number; u: number[]; v: number[]; uMin: number; uMax: number; vMin: number; vMax: number }) => {
        if (!viewerRef.current || viewerRef.current.isDestroyed()) return;

        const windData: WindData = {
          width: raw.width,
          height: raw.height,
          // India extent (NCEP approximate)
          bounds: { west: 65, south: 5, east: 100, north: 40 },
          u: { array: new Float32Array(raw.u), min: raw.uMin, max: raw.uMax },
          v: { array: new Float32Array(raw.v), min: raw.vMin, max: raw.vMax },
        };

        const wl = new WindLayer(viewerRef.current, windData, {
          particlesTextureSize: 40,   // 1600 particles — good perf/visual balance
          particleHeight: 8000,
          lineWidth: { min: 1.0, max: 2.0 },
          lineLength: { min: 20, max: 80 },
          speedFactor: 3.0,
          dropRate: 0.006,
          dropRateBump: 0.02,
          colors: ['rgba(80,160,255,0.4)', 'rgba(150,210,255,0.75)', 'rgba(255,255,255,0.9)'],
          flipY: false,
          useViewerBounds: true,
          dynamic: true,
        });

        windLayerRef.current = wl;
      })
      .catch((e) => console.warn('[VAYU] Wind layer init failed:', e));
  }, [isReady]);

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
      case 'smap': {
        if (baseLayer) baseLayer.show = true;
        const smapUrl = `${GIBS_BASE}/MODIS_Terra_Land_Surface_Temp_Day/default/${dateStr}/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png`;
        addGibs(smapUrl, 0.70, 7);
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

  useEffect(() => {
    if (!isReady || !viewerRef.current) return;
    const viewer = viewerRef.current;
    if (viewer.isDestroyed()) return;

    // Debounce — wait for slider to settle
    if (heatmapTimerRef.current) clearTimeout(heatmapTimerRef.current);

    heatmapTimerRef.current = setTimeout(() => {
      if (!viewerRef.current || viewerRef.current.isDestroyed()) return;
      const v = viewerRef.current;

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
        variable === 'rainfall' ? 'imd_rain' : variable === 'temp_max' ? 'plasma' : 'viridis'
      );

      // Paint canvas
      const scale = 4;
      const canvas = document.createElement('canvas');
      canvas.width = nLon * scale;
      canvas.height = nLat * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const cfg = VARIABLE_CONFIG[variable];

      for (let latIdx = 0; latIdx < nLat; latIdx++) {
        for (let lonIdx = 0; lonIdx < nLon; lonIdx++) {
          const lat = lats[nLat - 1 - latIdx];
          const lon = lons[lonIdx];
          const cell = cellMap.get(`${lat.toFixed(3)}_${lon.toFixed(3)}`);
          if (cell) {
            const val = cell[variable] as number;
            const t = Math.max(0, Math.min(1, (val - cfg.min) / (cfg.max - cfg.min)));
            ctx.fillStyle = _heatmapColor(t, variable, activeColormap);
          } else {
            ctx.fillStyle = 'rgba(0,0,0,0)';
          }
          ctx.fillRect(lonIdx * scale, latIdx * scale, scale, scale);
        }
      }

      const cellSize = 0.25;
      const west = lons[0] - cellSize / 2;
      const east = lons[nLon - 1] + cellSize / 2;
      const south = lats[0] - cellSize / 2;
      const north = lats[nLat - 1] + cellSize / 2;

      // Create new layer FIRST, then remove old one only after new is ready
      const oldLayer = heatmapLayerRef.current;

      Cesium.SingleTileImageryProvider.fromUrl(canvas.toDataURL('image/png'), {
        rectangle: Cesium.Rectangle.fromDegrees(west, south, east, north),
      }).then((provider) => {
        if (!viewerRef.current || viewerRef.current.isDestroyed()) return;
        // Add new layer
        const newLayer = viewerRef.current.imageryLayers.addImageryProvider(provider);
        newLayer.alpha = 0.78;
        heatmapLayerRef.current = newLayer;

        // NOW remove old layer (new one is already rendering)
        if (oldLayer) {
          try { viewerRef.current!.imageryLayers.remove(oldLayer, true); } catch {}
        }
      }).catch(() => {});
    }, 500);

    return () => {
      if (heatmapTimerRef.current) clearTimeout(heatmapTimerRef.current);
    };
  }, [gridCells, variable, isReady, colormap]);

  // ── Fly to region when region changes ─────────────────────────────────────
  useEffect(() => {
    if (!isReady || !viewerRef.current) return;
    const regionOpt = REGIONS.find((r) => r.id === region);
    if (!regionOpt) return;
    viewerRef.current.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(regionOpt.centerLon, regionOpt.centerLat, regionOpt.altitude),
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(-48), roll: 0 },
      duration: 2.5,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    });
  }, [region, isReady, regionFlyTrigger]);

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
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(tourStep.lon, tourStep.lat, tourStep.altitude),
      orientation: {
        heading: 0,
        pitch: Cesium.Math.toRadians(tourStep.pitch),
        roll: 0,
      },
      duration: tourStep.duration,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    });
  }, [isReady, tourStep]);

  // ── 3D Extruded Rainfall Columns (Feature 1) ───────────────────────────────
  useEffect(() => {
    if (!isReady || !extrude3DRef.current) return;
    const source = extrude3DRef.current;
    source.entities.removeAll();
    if (!show3D || variable !== 'rainfall' || gridCells.length === 0) return;

    const cfg = VARIABLE_CONFIG.rainfall;
    const activeColormap: ColormapId = colormap ?? 'imd_rain';

    gridCells.forEach((cell) => {
      const val = cell.rainfall;
      if (val < 1) return; // skip dry cells
      const t = Math.max(0, Math.min(1, (val - cfg.min) / (cfg.max - cfg.min)));
      const height = t * 80_000; // up to 80km extrusion

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
        description: `${val.toFixed(1)} mm/day`,
      });
    });
  }, [isReady, show3D, gridCells, variable, colormap]);

  // ── Day / Night Terminator Line (Feature 6) ────────────────────────────────
  // DISABLED: This effect fires on every selectedDate change (every slider tick)
  // and creates/removes entities rapidly, causing Cesium render loop crashes.
  // The terminator polyline can also produce degenerate geometry near equinoxes.
  // TODO: Re-enable with static terminator that only updates on manual date clicks.

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
  }, [scenarioData, showSplitScreen, variable, isReady]);

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

      {/* ── Coordinate display (below header with gap) ── */}
      {isReady && coords && (
        <div className="absolute top-[85px] left-1/2 -translate-x-1/2 z-10 pointer-events-none">
          <div className="px-3 py-1.5 rounded bg-black/50 backdrop-blur-sm border border-white/10">
            <span className="text-green-300/70 font-mono text-xs">
              {coords.lat >= 0 ? coords.lat.toFixed(4) + '°N' : (-coords.lat).toFixed(4) + '°S'}
              {' '}
              {coords.lon >= 0 ? coords.lon.toFixed(4) + '°E' : (-coords.lon).toFixed(4) + '°W'}
            </span>
          </div>
        </div>
      )}

      {/* ── Status badge REMOVED — reduces clutter ── */}

      {/* ── Active layer indicator (bottom-right) ── */}
      {isReady && activeLayer !== 'vayu' && (
        <div className="absolute bottom-28 right-4 z-10 pointer-events-none animate-slide-in-up">
          <div className="px-3 py-1.5 rounded-lg bg-blue-600/20 border border-blue-400/30 backdrop-blur-sm">
            <span className="text-blue-300 text-xs font-medium">
              {activeLayer === 'modis'         ? '🛰 MODIS Terra TrueColor' :
               activeLayer === 'precipitation' ? '🌧 NASA IMERG Precipitation' :
               activeLayer === 'cloud'         ? '☁ MODIS Cloud Fraction' :
               activeLayer === 'nightlights'   ? '🌃 Earth at Night' :
               activeLayer === 'satellite'     ? '🌍 Satellite Imagery' :
               activeLayer === 'fires'         ? '🔥 MODIS Active Fires' :
               activeLayer === 'sst'           ? '🌊 Sea Surface Temp' :
               activeLayer === 'smap'          ? '🌱 SMAP Soil Moisture' :
               activeLayer === 'owm_precip'    ? '🌧 OWM Live Precipitation' :
               activeLayer === 'owm_temp'      ? '🌡 OWM Live Temperature' :
               activeLayer === 'owm_wind'      ? '💨 OWM Live Wind' : activeLayer}
            </span>
          </div>
        </div>
      )}

      {/* ── 3D mode badge ── */}
      {isReady && show3D && (
        <div className="absolute top-20 left-[140px] z-10 pointer-events-none animate-slide-in-up">
          <div className="px-3 py-1.5 rounded-lg backdrop-blur-sm" style={{ background: 'rgba(249,115,22,0.2)', border: '1px solid rgba(249,115,22,0.4)' }}>
            <span className="text-orange-300 text-xs font-medium">3D Rainfall Columns</span>
          </div>
        </div>
      )}
    </div>
  );
}
