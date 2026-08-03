/**
 * CesiumGlobe — Plugin-Based Globe Shell
 *
 * Thin shell component that:
 * 1. Creates and manages the Cesium Viewer instance
 * 2. Subscribes to Zustand stores for state changes
 * 3. Uses LayerRegistry to init/update/destroy layers
 * 4. Delegates ALL rendering to registered LayerPlugin instances
 *
 * This replaces the monolithic 866-line component with a clean architecture
 * where each rendering concern lives in its own plugin.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import * as Cesium from 'cesium';
import { useAppStore } from '../../core/state/appStore';
import { useMapStore } from '../../core/state/mapStore';
import { LayerRegistry } from './LayerRegistry';
import type { LayerPlugin, LayerState } from './types';
import type { ColormapId } from '../../utils/colorScales';

// ── Constants ──────────────────────────────────────────────────────────────────

const INDIA_CENTER = { lat: 20.5, lon: 78.9, alt: 3_500_000 };
const PILOT_CENTER = { lat: 14.0, lon: 75.0, alt: 1_100_000 };

// ── Props ──────────────────────────────────────────────────────────────────────

export interface CesiumGlobeProps {
  /** Layer plugins to register on mount */
  plugins?: LayerPlugin[];
  /** Optional colormap override (defaults to store value or 'imd_rain') */
  colormap?: ColormapId;
  /** Heatmap opacity when photorealistic tiles are active (0.3–0.9) */
  heatmapOpacity?: number;
  /** CSS class for the container */
  className?: string;
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function CesiumGlobe({
  plugins = [],
  colormap = 'imd_rain',
  heatmapOpacity = 0.78,
  className,
}: CesiumGlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const registryRef = useRef<LayerRegistry>(new LayerRegistry());
  const [isReady, setIsReady] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);

  // ── Zustand subscriptions ──────────────────────────────────────────────────
  const gridCells = useAppStore((s) => s.activePrediction?.grid_cells ?? []);
  const variable = useAppStore((s) => s.selectedVariable);
  const region = useAppStore((s) => s.selectedRegion);
  const forecastDay = useAppStore((s) => s.forecastDay);
  const show3D = useAppStore((s) => s.show3D);
  const showWind = useAppStore((s) => s.showWind);
  const showContours = useAppStore((s) => s.showContours);
  const showBoundaries = useAppStore((s) => s.showBoundaries);
  const showUncertainty = useAppStore((s) => s.showUncertainty);
  const scenarioData = useAppStore((s) => s.activeScenario);
  const selectedDate = useAppStore((s) => s.timeState.selectedDate);

  const terrainExaggeration = useMapStore((s) => s.terrainExaggeration);
  const gibsDate = useMapStore((s) => s.gibsDate);

  // ── Build LayerState from store values ─────────────────────────────────────

  const buildLayerState = useCallback((): LayerState => ({
    gridCells,
    variable,
    region,
    forecastDay,
    terrainExaggeration,
    colormap,
    show3D,
    showWind,
    showContours,
    showBoundaries,
    showUncertainty,
    scenarioData,
    gibsDate,
    selectedDate,
    heatmapOpacity,
  }), [
    gridCells, variable, region, forecastDay, terrainExaggeration,
    colormap, show3D, showWind, showContours, showBoundaries,
    showUncertainty, scenarioData, gibsDate, selectedDate, heatmapOpacity,
  ]);

  // ── Initialize Cesium Viewer ───────────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    // Set Ion token
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
      infoBox: false,
      selectionIndicator: false,
      creditContainer: document.createElement('div'),
    });

    // Suppress Cesium error panel
    try {
      const widget = viewer.cesiumWidget as unknown as {
        _showRenderLoopError: boolean;
        showErrorPanel: (...args: unknown[]) => void;
      };
      widget.showErrorPanel = () => {};
      widget._showRenderLoopError = false;
    } catch { /* ignore */ }

    // Auto-restart render loop on error
    viewer.scene.renderError.addEventListener(() => {
      console.warn('[VAYU Globe] Render error — restarting render loop');
      try {
        viewer.useDefaultRenderLoop = false;
        setTimeout(() => {
          if (!viewer.isDestroyed()) {
            viewer.useDefaultRenderLoop = true;
          }
        }, 100);
      } catch { /* ignore */ }
    });

    // ── Scene configuration ──────────────────────────────────────────────────
    viewer.scene.globe.enableLighting = false;
    viewer.scene.globe.showGroundAtmosphere = true;
    viewer.scene.globe.tileCacheSize = 200;
    viewer.scene.fog.enabled = true;
    viewer.scene.fog.density = 0.0001;
    if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true;

    // Camera constraints
    viewer.scene.screenSpaceCameraController.minimumZoomDistance = 500;
    viewer.scene.screenSpaceCameraController.maximumZoomDistance = 50_000_000;

    // Auto-pitch when zoomed far out
    viewer.scene.preRender.addEventListener(() => {
      try {
        const cameraHeight = viewer.camera.positionCartographic.height;
        if (cameraHeight > 4_000_000) {
          const currentPitch = viewer.camera.pitch;
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
      } catch { /* ignore camera errors during transitions */ }
    });

    // ── Cinematic intro: space → India ───────────────────────────────────────
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(INDIA_CENTER.lon, INDIA_CENTER.lat, 8_000_000),
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(-89), roll: 0 },
    });
    setTimeout(() => {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
          PILOT_CENTER.lon, PILOT_CENTER.lat, PILOT_CENTER.alt,
        ),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-45), roll: 0 },
        duration: 3.0,
        easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
      });
    }, 800);

    // ── Coordinate tracker ───────────────────────────────────────────────────
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction(
      (movement: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
        try {
          const cartesian = viewer.scene.pickPosition(movement.endPosition);
          if (cartesian) {
            const carto = Cesium.Cartographic.fromCartesian(cartesian);
            setCoords({
              lat: Cesium.Math.toDegrees(carto.latitude),
              lon: Cesium.Math.toDegrees(carto.longitude),
            });
          }
        } catch { /* pickPosition can throw when depth buffer isn't ready */ }
      },
      Cesium.ScreenSpaceEventType.MOUSE_MOVE,
    );

    viewerRef.current = viewer;

    // ── Initialize all registered plugins ────────────────────────────────────
    const registry = registryRef.current;
    registry.initAll(viewer).then(() => {
      setIsReady(true);
    });

    // ── Cleanup ──────────────────────────────────────────────────────────────
    return () => {
      registry.destroyAll();
      handler.destroy();
      if (!viewer.isDestroyed()) {
        viewer.destroy();
      }
      viewerRef.current = null;
      setIsReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Register plugins on mount / when plugins prop changes ──────────────────

  useEffect(() => {
    const registry = registryRef.current;

    const registerAll = async () => {
      for (const plugin of plugins) {
        await registry.register(plugin);
      }
      // Trigger initial update if viewer is ready
      if (viewerRef.current) {
        registry.updateAll(buildLayerState());
      }
    };

    registerAll();

    return () => {
      // Unregister plugins from this prop set on cleanup
      for (const plugin of plugins) {
        registry.unregister(plugin.id);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plugins]);

  // ── Dispatch state updates to all layers ───────────────────────────────────

  useEffect(() => {
    if (!isReady) return;
    registryRef.current.updateAll(buildLayerState());
  }, [isReady, buildLayerState]);

  // ── Terrain exaggeration ───────────────────────────────────────────────────

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    viewer.scene.verticalExaggeration = terrainExaggeration;
  }, [terrainExaggeration]);

  // ── Expose viewer ref for imperative access (inspect tool, etc.) ───────────

  const getViewer = useCallback(() => viewerRef.current, []);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className={className} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%' }}
        data-testid="cesium-globe-container"
      />

      {/* Coordinate display */}
      {coords && (
        <div
          style={{
            position: 'absolute',
            bottom: 8,
            left: 8,
            padding: '4px 8px',
            borderRadius: 4,
            background: 'rgba(0,0,0,0.7)',
            color: '#fff',
            fontSize: 11,
            fontFamily: 'monospace',
            pointerEvents: 'none',
          }}
        >
          {coords.lat.toFixed(4)}°, {coords.lon.toFixed(4)}°
        </div>
      )}

      {/* Loading indicator */}
      {!isReady && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.8)',
            color: '#fff',
            fontSize: 14,
          }}
        >
          Loading ISRO Earth View…
        </div>
      )}
    </div>
  );
}

// Re-export types for convenience
export type { LayerPlugin, LayerState, LayerConfig } from './types';
export { LayerRegistry } from './LayerRegistry';
