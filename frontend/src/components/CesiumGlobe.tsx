import { useCallback, useEffect, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import { buildTileUrl } from '../api/client';
import type { GridCell, RegionId, ScenarioResponse, VariableId } from '../types';
import { REGIONS } from './RegionSelector';

// ── Constants ──────────────────────────────────────────────────────────────────

const PILOT_CENTER = { lat: 14.0, lon: 75.0, alt: 1_200_000 }; // 1200km altitude
const GOOGLE_3D_TILES_URL =
  `https://tile.googleapis.com/v1/3dtiles/root.json?key=${import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''}`;

// Colormap config per variable
const VARIABLE_CONFIG = {
  rainfall: {
    label: 'Rainfall (mm/day)',
    unit: 'mm/day',
    min: 0,
    max: 50,
    color: Cesium.Color.fromCssColorString('#3b82f6'),
  },
  temp_max: {
    label: 'Max Temperature (°C)',
    unit: '°C',
    min: 20,
    max: 45,
    color: Cesium.Color.fromCssColorString('#ef4444'),
  },
  temp_min: {
    label: 'Min Temperature (°C)',
    unit: '°C',
    min: 10,
    max: 35,
    color: Cesium.Color.fromCssColorString('#8b5cf6'),
  },
};

function valueToColor(value: number, variable: VariableId): Cesium.Color {
  const cfg = VARIABLE_CONFIG[variable];
  const t = Math.max(0, Math.min(1, (value - cfg.min) / (cfg.max - cfg.min)));

  if (variable === 'rainfall') {
    // Blues: white → light blue → deep blue
    return new Cesium.Color(1 - t * 0.8, 1 - t * 0.5, 1.0, 0.7);
  } else if (variable === 'temp_max') {
    // Yellow → orange → red
    return new Cesium.Color(1.0, 1.0 - t * 0.8, 0.1 + (1 - t) * 0.4, 0.7);
  } else {
    // Blue → purple → red
    return new Cesium.Color(t * 0.8, 0.1, 1 - t * 0.5, 0.7);
  }
}

// ── Props & Component ─────────────────────────────────────────────────────────

interface CesiumGlobeProps {
  gridCells: GridCell[];
  variable: VariableId;
  region: RegionId;
  scenarioData: ScenarioResponse | null;
  showSplitScreen: boolean;
  onCellClick?: (cell: GridCell) => void;
}

export default function CesiumGlobe({
  gridCells,
  variable,
  region,
  scenarioData,
  showSplitScreen,
  onCellClick,
}: CesiumGlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const overlaySourceRef = useRef<Cesium.CustomDataSource | null>(null);
  const scenarioSourceRef = useRef<Cesium.CustomDataSource | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [statusMsg, setStatusMsg] = useState('Initializing globe…');

  // ── Initialize CesiumJS viewer ──────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    const viewer = new Cesium.Viewer(containerRef.current, {
      terrain: Cesium.Terrain.fromWorldTerrain(),
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
      creditContainer: document.createElement('div'), // hide credits
    });

    // Atmosphere and lighting for space-to-earth feel
    viewer.scene.globe.enableLighting = true;
    viewer.scene.globe.atmosphereLightIntensity = 1.5;
    viewer.scene.skyBox = new Cesium.SkyBox({
      sources: {
        positiveX: '/cesium/Assets/Textures/SkyBox/tycho2t3_80_px.jpg',
        negativeX: '/cesium/Assets/Textures/SkyBox/tycho2t3_80_mx.jpg',
        positiveY: '/cesium/Assets/Textures/SkyBox/tycho2t3_80_py.jpg',
        negativeY: '/cesium/Assets/Textures/SkyBox/tycho2t3_80_my.jpg',
        positiveZ: '/cesium/Assets/Textures/SkyBox/tycho2t3_80_pz.jpg',
        negativeZ: '/cesium/Assets/Textures/SkyBox/tycho2t3_80_mz.jpg',
      },
    });

    // Fly to pilot region
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        PILOT_CENTER.lon,
        PILOT_CENTER.lat,
        PILOT_CENTER.alt,
      ),
      orientation: {
        heading: Cesium.Math.toRadians(0),
        pitch: Cesium.Math.toRadians(-45),
        roll: 0,
      },
      duration: 3.0,
    });

    // Add climate tile overlay layer
    const tileProvider = new Cesium.UrlTemplateImageryProvider({
      url: buildTileUrl(variable),
      credit: 'VAYU Climate Model / IMD',
      maximumLevel: 12,
    });
    viewer.imageryLayers.addImageryProvider(tileProvider);

    // Try loading Google 3D Tiles (graceful fallback if no API key)
    if (import.meta.env.VITE_GOOGLE_MAPS_API_KEY) {
      Cesium.Cesium3DTileset.fromUrl(GOOGLE_3D_TILES_URL)
        .then((tileset) => {
          viewer.scene.primitives.add(tileset);
          setStatusMsg('3D terrain loaded');
        })
        .catch(() => {
          setStatusMsg('World terrain active');
        });
    } else {
      setStatusMsg('World terrain active — add GOOGLE_MAPS_API_KEY for 3D cities');
    }

    // Data sources for grid cell overlays
    const overlaySource = new Cesium.CustomDataSource('climate-overlay');
    const scenarioSource = new Cesium.CustomDataSource('scenario-overlay');
    viewer.dataSources.add(overlaySource);
    viewer.dataSources.add(scenarioSource);
    overlaySourceRef.current = overlaySource;
    scenarioSourceRef.current = scenarioSource;

    viewerRef.current = viewer;
    setIsReady(true);

    return () => {
      viewer.destroy();
      viewerRef.current = null;
    };
  }, []);

  // ── Update climate heatmap overlay ─────────────────────────────────────────
  useEffect(() => {
    if (!isReady || !overlaySourceRef.current || gridCells.length === 0) return;

    const source = overlaySourceRef.current;
    source.entities.removeAll();

    const cellSize = 0.25; // degrees

    for (const cell of gridCells) {
      const val = cell[variable] as number;
      const color = valueToColor(val, variable);
      const varCfg = VARIABLE_CONFIG[variable];
      const uncertainty = variable === 'rainfall'
        ? cell.rainfall_uncertainty
        : variable === 'temp_max'
        ? cell.temp_max_uncertainty
        : cell.temp_min_uncertainty;

      source.entities.add({
        position: Cesium.Cartesian3.fromDegrees(cell.lon, cell.lat),
        rectangle: {
          coordinates: Cesium.Rectangle.fromDegrees(
            cell.lon - cellSize / 2,
            cell.lat - cellSize / 2,
            cell.lon + cellSize / 2,
            cell.lat + cellSize / 2,
          ),
          material: color,
          height: 0,
          classificationType: Cesium.ClassificationType.TERRAIN,
        },
        name: `${varCfg.label}`,
        description: `
          <table class="cesium-infoBox-defaultTable">
            <tr><td>Lat</td><td>${cell.lat.toFixed(2)}°N</td></tr>
            <tr><td>Lon</td><td>${cell.lon.toFixed(2)}°E</td></tr>
            <tr><td>${varCfg.label}</td><td>${val.toFixed(2)} ${varCfg.unit}</td></tr>
            <tr><td>Uncertainty (±1σ)</td><td>${uncertainty.toFixed(2)} ${varCfg.unit}</td></tr>
          </table>
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
      destination: Cesium.Cartesian3.fromDegrees(
        regionOpt.centerLon,
        regionOpt.centerLat,
        regionOpt.altitude,
      ),
      orientation: {
        heading: Cesium.Math.toRadians(0),
        pitch: Cesium.Math.toRadians(-45),
        roll: 0,
      },
      duration: 2.0,
    });
  }, [region, isReady]);

  // ── Update scenario delta overlay (right half in split-screen) ─────────────
  useEffect(() => {
    if (!isReady || !scenarioSourceRef.current) return;

    const source = scenarioSourceRef.current;
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
      {/* Loading overlay */}
      {!isReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-vayu-dark z-10">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-vayu-blue border-t-transparent rounded-full animate-spin" />
            <span className="text-white/70 text-sm">Loading 3D globe…</span>
          </div>
        </div>
      )}
      {/* Status badge */}
      {isReady && (
        <div className="absolute bottom-4 left-4 panel-tight px-3 py-1.5 text-xs text-white/50 pointer-events-none">
          {statusMsg}
        </div>
      )}
    </div>
  );
}
