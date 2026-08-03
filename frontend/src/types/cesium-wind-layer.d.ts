/**
 * Type declarations for cesium-wind-layer (local package stub).
 * The actual package is linked via file: protocol from ../cesium-wind-layer
 * but may not always be available in all environments.
 */
declare module 'cesium-wind-layer' {
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
    show: boolean;
    constructor(viewer: Viewer, data: WindData, options?: WindLayerOptions);
    destroy(): void;
  }
}
