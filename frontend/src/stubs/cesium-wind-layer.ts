/**
 * Stub implementation for cesium-wind-layer.
 * The actual package (file:../cesium-wind-layer/packages/cesium-wind-layer) is not
 * available in this environment. This stub provides the API surface so the build
 * succeeds and the app gracefully handles the missing wind visualization at runtime.
 */
import type { Viewer } from 'cesium';

export interface WindDataComponent {
  array: Float32Array;
  min: number;
  max: number;
}

export interface WindDataBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface WindData {
  width: number;
  height: number;
  bounds: WindDataBounds;
  u: WindDataComponent;
  v: WindDataComponent;
}

export interface WindLayerOptions {
  particlesTextureSize?: number;
  particleHeight?: number;
  lineWidth?: { min: number; max: number };
  lineLength?: { min: number; max: number };
  speedFactor?: number;
  dropRate?: number;
  dropRateBump?: number;
  colors?: string[];
  flipY?: boolean;
  useViewerBounds?: boolean;
  dynamic?: boolean;
}

export class WindLayer {
  show = true;

  constructor(_viewer: Viewer, _data: WindData, _options?: WindLayerOptions) {
    console.warn('[VAYU] cesium-wind-layer stub: wind particles not available in this build');
  }

  destroy(): void {
    // no-op
  }
}
