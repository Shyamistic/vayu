import { useCallback, useEffect, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import type { GridCell, RegionId, ScenarioResponse, VariableId } from '../types';
import { REGIONS } from './RegionSelector';

// ── Constants ──────────────────────────────────────────────────────────────────

const INDIA_CENTER  = { lat: 20.5, lon: 78.9, alt: 3_500_000 }; // Pan-India view
const PILOT_CENTER  = { lat: 14.0, lon: 75.0, alt: 1_100_000 }; // Western Ghats

// NASA GIBS WMTS — completely free, no API key required
// Docs: https://wiki.earthdata.nasa.gov/display/GIBS
const GIBS_BASE = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
const GIBS_LAYERS = {
  MODIS_TrueColor: `${GIBS_BASE}/MODIS_Terra_CorrectedReflectance_TrueColor/default/{Time}/GoogleMapsCompatible/{z}/{y}/{x}.jpg`,
  VIIRS_TrueColor: `${GIBS_BASE}/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/{Time}/GoogleMapsCompatible/{z}/{y}/{x}.jpg`,
  Precipitation:   `${GIBS_BASE}/IMERG_Precipitation_Rate/default/{Time}/GoogleMapsCompatible/{z}/{y}/{x}.png`,
  CloudFraction:   `${GIBS_BASE}/MODIS_Terra_Cloud_Fraction_Day/default/{Time}/GoogleMapsCompatible/{z}/{y}/{x}.png`,
  Fires:           `${GIBS_BASE}/FIRMS_MODIS_Thermal_Anomalies/default/{Time}/GoogleMapsCompatible/{z}/{y}/{x}.png`,
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
export type EarthLayer = 'vayu' | 'satellite' | 'modis' | 'precipitation' | 'cloud' | 'nightlights';

// ── Props & Component ─────────────────────────────────────────────────────────

interface CesiumGlobeProps {
  gridCells: GridCell[];
  variable: VariableId;
  region: RegionId;
  scenarioData: ScenarioResponse | null;
  showSplitScreen: boolean;
  activeLayer?: EarthLayer;
  gibsDate?: string;   // 'YYYY-MM-DD' for NASA GIBS time-aware layers
  onCellClick?: (cell: GridCell) => void;
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
}: CesiumGlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef    = useRef<Cesium.Viewer | null>(null);
  const overlayRef   = useRef<Cesium.CustomDataSource | null>(null);
  const scenarioRef  = useRef<Cesium.CustomDataSource | null>(null);
  const gibsLayerRef = useRef<Cesium.ImageryLayer | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [statusMsg, setStatusMsg] = useState('Loading ISRO Earth View…');
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);

  // ── Initialize CesiumJS viewer ──────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    // Set Ion token from environment (required for world terrain + Bing imagery)
    const ionToken = import.meta.env.VITE_CESIUM_ION_TOKEN;
    if (ionToken) Cesium.Ion.defaultAccessToken = ionToken;

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
      infoBox: true,
      selectionIndicator: false,
      creditContainer: document.createElement('div'), // hide Cesium branding
    });

    // ── Atmosphere & lighting — ISRO space-to-earth aesthetic ──
    viewer.scene.globe.enableLighting = true;
    viewer.scene.globe.atmosphereLightIntensity = 2.0;
    viewer.scene.globe.atmosphereHueShift = 0.0;
    viewer.scene.globe.atmosphereSaturationShift = 0.1;
    viewer.scene.globe.atmosphereBrightnessShift = 0.05;
    viewer.scene.globe.showGroundAtmosphere = true;
    viewer.scene.globe.tileCacheSize = 200;
    viewer.scene.fog.enabled = true;
    viewer.scene.fog.density = 0.0002;
    if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true;
    viewer.scene.globe.depthTestAgainstTerrain = true;

    // ── Bing Satellite imagery (free via Cesium Ion) ──
    const bingLayer = viewer.imageryLayers.get(0); // default Ion world imagery
    bingLayer.brightness = 1.05;
    bingLayer.contrast = 1.1;
    bingLayer.saturation = 1.15;

    // ── Cinematic intro: start from space, zoom to India ──
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(INDIA_CENTER.lon, INDIA_CENTER.lat, 12_000_000),
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
    });
    setTimeout(() => {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(INDIA_CENTER.lon, INDIA_CENTER.lat, INDIA_CENTER.alt),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-55), roll: 0 },
        duration: 4.0,
        easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
      });
    }, 500);

    // ── Mouse-move coordinate tracker ──
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
      const cartesian = viewer.scene.pickPosition(movement.endPosition);
      if (cartesian) {
        const carto = Cesium.Cartographic.fromCartesian(cartesian);
        setCoords({
          lat: Cesium.Math.toDegrees(carto.latitude),
          lon: Cesium.Math.toDegrees(carto.longitude),
        });
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    // ── OSM Buildings (free, Cesium Ion asset 96188) ──
    Cesium.createOsmBuildingsAsync()
      .then((tileset) => {
        viewer.scene.primitives.add(tileset);
        setStatusMsg('ISRO Earth View ready');
      })
      .catch(() => setStatusMsg('ISRO Earth View ready'));

    // ── Data sources for climate overlays ──
    const overlaySource = new Cesium.CustomDataSource('vayu-climate');
    const scenarioSource = new Cesium.CustomDataSource('vayu-scenario');
    viewer.dataSources.add(overlaySource);
    viewer.dataSources.add(scenarioSource);
    overlayRef.current = overlaySource;
    scenarioRef.current = scenarioSource;

    viewerRef.current = viewer;
    setIsReady(true);

    return () => {
      handler.destroy();
      viewer.destroy();
      viewerRef.current = null;
    };
  }, []);

  // ── Switch NASA GIBS / background layers ────────────────────────────────────
  useEffect(() => {
    if (!isReady || !viewerRef.current) return;
    const viewer = viewerRef.current;

    // Remove previous GIBS layer
    if (gibsLayerRef.current) {
      viewer.imageryLayers.remove(gibsLayerRef.current, true);
      gibsLayerRef.current = null;
    }

    const dateStr = gibsDate || new Date().toISOString().split('T')[0];

    const addGibs = (templateUrl: string, alpha = 0.85) => {
      const url = templateUrl.replace('{Time}', dateStr);
      const layer = viewer.imageryLayers.addImageryProvider(
        new Cesium.UrlTemplateImageryProvider({
          url,
          credit: 'NASA Worldview / GIBS',
          maximumLevel: 9,
          tilingScheme: new Cesium.WebMercatorTilingScheme(),
        })
      );
      layer.alpha = alpha;
      layer.brightness = 1.0;
      gibsLayerRef.current = layer;
    };

    // Toggle base layer visibility
    const baseLayer = viewer.imageryLayers.get(0);

    switch (activeLayer) {
      case 'satellite':
        baseLayer.show = true;
        break;
      case 'modis':
        baseLayer.show = false;
        addGibs(GIBS_LAYERS.MODIS_TrueColor);
        break;
      case 'precipitation':
        baseLayer.show = true;
        addGibs(GIBS_LAYERS.Precipitation, 0.75);
        break;
      case 'cloud':
        baseLayer.show = true;
        addGibs(GIBS_LAYERS.CloudFraction, 0.65);
        break;
      case 'nightlights':
        // Cesium Ion Asset 3812 — Earth at Night (free)
        baseLayer.show = false;
        Cesium.IonImageryProvider.fromAssetId(3812)
          .then((provider) => {
            const nl = viewer.imageryLayers.addImageryProvider(provider);
            nl.brightness = 1.5;
            gibsLayerRef.current = nl;
          })
          .catch(() => { baseLayer.show = true; });
        break;
      default:
        baseLayer.show = true;
    }
  }, [isReady, activeLayer, gibsDate]);

  // ── Update climate heatmap overlay ─────────────────────────────────────────
  useEffect(() => {
    if (!isReady || !overlayRef.current || gridCells.length === 0) return;

    const source = overlayRef.current;
    source.entities.removeAll();

    const cellSize = 0.25; // degrees

    for (const cell of gridCells) {
      const val = cell[variable] as number;
      const color = valueToColor(val, variable);
      const cfg = VARIABLE_CONFIG[variable];
      const uncertainty = variable === 'rainfall' ? cell.rainfall_uncertainty
        : variable === 'temp_max' ? cell.temp_max_uncertainty
        : cell.temp_min_uncertainty;
      const t = Math.max(0, Math.min(1, (val - cfg.min) / (cfg.max - cfg.min)));
      // 3D extruded bars for rainfall — taller bars = heavier rain
      const extrudeHeight = variable === 'rainfall' ? t * cfg.extrudeScale : 0;

      source.entities.add({
        position: Cesium.Cartesian3.fromDegrees(cell.lon, cell.lat, extrudeHeight / 2),
        rectangle: {
          coordinates: Cesium.Rectangle.fromDegrees(
            cell.lon - cellSize / 2, cell.lat - cellSize / 2,
            cell.lon + cellSize / 2, cell.lat + cellSize / 2,
          ),
          material: color,
          height: 0,
          extrudedHeight: extrudeHeight,
          classificationType: extrudeHeight > 0 ? Cesium.ClassificationType.BOTH : Cesium.ClassificationType.TERRAIN,
          outline: false,
        },
        name: cfg.label,
        description: `
          <div style="font-family:monospace;padding:8px;background:#0a0f1a;color:#e2e8f0;border-radius:6px">
            <div style="font-size:14px;font-weight:600;color:#60a5fa;margin-bottom:8px">VAYU Climate Model</div>
            <table style="width:100%;border-collapse:collapse">
              <tr><td style="color:#94a3b8;padding:2px 8px">Coordinates</td><td style="color:#f1f5f9">${cell.lat.toFixed(3)}°N, ${cell.lon.toFixed(3)}°E</td></tr>
              <tr><td style="color:#94a3b8;padding:2px 8px">${cfg.label}</td><td style="color:#f1f5f9;font-weight:600">${val.toFixed(2)} ${cfg.unit}</td></tr>
              <tr><td style="color:#94a3b8;padding:2px 8px">Uncertainty (±1σ)</td><td style="color:#94a3b8">${uncertainty.toFixed(2)} ${cfg.unit}</td></tr>
            </table>
          </div>
        `,
      });
    }
  }, [gridCells, variable, isReady]);

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
  }, [region, isReady]);

  // ── Update scenario delta overlay (right half in split-screen) ─────────────
  useEffect(() => {
    if (!isReady || !scenarioRef.current) return;

    const source = scenarioRef.current;
    source.entities.removeAll();

    if (!scenarioData || !showSplitScreen) return;

    const delta = scenarioData.delta[variable];
    if (!delta) return;

    // Get lat/lon from grid cells count
    const nlat = 49, nlon = 25;
    const latMin = 8.0, lonMin = 72.0, step = 0.25;

    delta.forEach((d, idx) => {
      const lat_i = Math.floor(idx / nlon);
      const lon_j = idx % nlon;
      const lat = latMin + lat_i * step;
      const lon = lonMin + lon_j * step;

      // Diverging colormap: negative = blue, positive = red
      const absD = Math.abs(d);
      const norm = Math.min(absD / 3.0, 1.0);
      const color = d > 0
        ? new Cesium.Color(1.0, 0.3, 0.1, 0.7 * norm + 0.1)
        : new Cesium.Color(0.1, 0.4, 1.0, 0.7 * norm + 0.1);

      source.entities.add({
        rectangle: {
          coordinates: Cesium.Rectangle.fromDegrees(
            lon - 0.125, lat - 0.125, lon + 0.125, lat + 0.125,
          ),
          material: color,
          height: 0,
        },
      });
    });
  }, [scenarioData, showSplitScreen, variable, isReady]);

  return (
    <div ref={containerRef} className="w-full h-full relative">

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

      {/* ── ISRO branding HUD (top-left) ── */}
      {isReady && (
        <div className="absolute top-4 left-4 z-10 pointer-events-none">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-black/40 backdrop-blur-md border border-white/10">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-white/80 text-xs font-mono tracking-wider">VAYU CLIMATE AI</span>
            <span className="text-white/30 text-xs">|</span>
            <span className="text-blue-300/70 text-xs">INDIA DIGITAL TWIN</span>
          </div>
        </div>
      )}

      {/* ── Coordinate display (bottom-left) ── */}
      {isReady && coords && (
        <div className="absolute bottom-8 left-4 z-10 pointer-events-none">
          <div className="px-3 py-1.5 rounded bg-black/50 backdrop-blur-sm border border-white/10">
            <span className="text-green-300/70 font-mono text-xs">
              {coords.lat >= 0 ? coords.lat.toFixed(4) + '°N' : (-coords.lat).toFixed(4) + '°S'}
              {' '}
              {coords.lon >= 0 ? coords.lon.toFixed(4) + '°E' : (-coords.lon).toFixed(4) + '°W'}
            </span>
          </div>
        </div>
      )}

      {/* ── Status / data source badge ── */}
      {isReady && (
        <div className="absolute bottom-4 left-4 z-10 pointer-events-none">
          <div className="px-2.5 py-1 rounded text-xs text-white/30 bg-black/30 border border-white/5">
            {statusMsg}
          </div>
        </div>
      )}

      {/* ── Active layer indicator (bottom-right) ── */}
      {isReady && activeLayer !== 'vayu' && (
        <div className="absolute bottom-4 right-4 z-10 pointer-events-none">
          <div className="px-3 py-1.5 rounded-lg bg-blue-600/20 border border-blue-400/30 backdrop-blur-sm">
            <span className="text-blue-300 text-xs font-medium">
              {activeLayer === 'modis'         ? '🛰 MODIS Terra TrueColor' :
               activeLayer === 'precipitation' ? '🌧 NASA IMERG Precipitation' :
               activeLayer === 'cloud'         ? '☁ MODIS Cloud Fraction' :
               activeLayer === 'nightlights'   ? '🌃 Earth at Night' :
               activeLayer === 'satellite'     ? '🌍 Satellite Imagery' : activeLayer}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
