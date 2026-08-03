/**
 * INSATLayer — INSAT-3D/3DR Satellite Imagery Layer
 *
 * Provides satellite imagery overlays from INSAT-3D (VIS, IR, WV, Color Composite)
 * with animation loop support (last 6 hours at configurable fps).
 *
 * Primary source: NASA GIBS VIIRS/MODIS True Color (publicly available).
 * Structured so MOSDAC/IMD INSAT-3D URLs can be swapped in when available.
 *
 * Fallback: When INSAT imagery is unavailable, falls back to NASA GIBS
 * VIIRS/MODIS imagery with a substitution notice logged.
 *
 * Requirements: 16.1, 16.2, 16.3, 16.4, 49.1, 49.2, 49.4
 */

import * as Cesium from 'cesium';
import type { LayerPlugin, LayerState } from '../types';

// ── Types ────────────────────────────────────────────────────────────────────

/** INSAT imagery channel types */
export type INSATChannel = 'VIS' | 'IR' | 'WV' | 'COLOR';

/** Configuration for INSAT animation playback */
export interface INSATAnimationConfig {
  /** Frames per second (1–10) */
  fps: number;
  /** Number of hours of history to animate */
  hoursBack: number;
  /** Whether to loop continuously */
  loop: boolean;
}

/** Imagery frame metadata */
export interface ImageryFrame {
  /** Acquisition timestamp */
  timestamp: Date;
  /** Imagery provider for this frame */
  provider: Cesium.ImageryProvider | null;
  /** Source identifier */
  source: 'INSAT' | 'GIBS';
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Default animation configuration */
const DEFAULT_ANIMATION_CONFIG: INSATAnimationConfig = {
  fps: 4,
  hoursBack: 6,
  loop: true,
};

/** INSAT interval between frames (minutes) */
const INSAT_FRAME_INTERVAL_MINUTES = 30;

/**
 * NASA GIBS WMTS base URL.
 * Used as primary source (INSAT direct URLs not publicly available).
 */
const GIBS_WMTS_BASE =
  'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best';

/**
 * GIBS layer identifiers by channel type.
 * Maps each INSAT channel to the closest GIBS equivalent.
 */
const GIBS_LAYER_MAP: Record<INSATChannel, string> = {
  VIS: 'VIIRS_SNPP_CorrectedReflectance_TrueColor',
  IR: 'VIIRS_SNPP_Brightness_Temp_BandI5_Night',
  WV: 'MODIS_Aqua_Water_Vapor_5km_Night',
  COLOR: 'VIIRS_SNPP_CorrectedReflectance_TrueColor',
};

/**
 * MOSDAC/IMD INSAT-3D URL templates (placeholder — not publicly available).
 * Structured for future integration when ISRO provides API access.
 * {channel} = TIR1, VIS, WV, etc.
 * {timestamp} = YYYYMMDD_HHMM format
 */
const INSAT_URL_TEMPLATE =
  'https://mosdac.gov.in/data/INSAT3D/{channel}/{timestamp}_L1B.tif';

/** Tile matrix set for GIBS WMTS */
const GIBS_TILE_MATRIX_SET = '250m';

/** GIBS max zoom level */
const GIBS_MAX_ZOOM = 9;

// ── INSATLayer Class ─────────────────────────────────────────────────────────

export class INSATLayer implements LayerPlugin {
  public readonly id = 'insat-imagery';
  public readonly priority = 15; // Above base terrain, below data overlays

  private viewer: Cesium.Viewer | null = null;
  private activeImageryLayer: Cesium.ImageryLayer | null = null;
  private animationFrames: ImageryFrame[] = [];
  private animationTimer: ReturnType<typeof setInterval> | null = null;
  private currentFrameIndex = 0;
  private currentChannel: INSATChannel = 'COLOR';
  private animationConfig: INSATAnimationConfig = { ...DEFAULT_ANIMATION_CONFIG };
  private isAnimating = false;
  private usingFallback = false;

  /** Last acquisition timestamp displayed (for data freshness) */
  private lastAcquisitionTimestamp: Date | null = null;

  // ── Lifecycle ────────────────────────────────────────────────────────────

  init(viewer: Cesium.Viewer): void {
    this.viewer = viewer;
  }

  update(state: LayerState): void {
    if (!this.viewer) return;

    // Use gibsDate from state to determine imagery date
    const imageryDate = state.gibsDate || this.formatDate(new Date());

    // Load imagery for the current channel
    this.loadImagery(this.currentChannel, imageryDate);
  }

  destroy(): void {
    this.stopAnimation();
    this.removeActiveImagery();
    this.animationFrames = [];
    this.viewer = null;
    this.lastAcquisitionTimestamp = null;
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Set the active INSAT imagery channel.
   * Requirement 16.1: VIS, IR, WV, Color Composite options.
   * Requirement 49.4: Toggle between channels during animation playback.
   */
  setChannel(channel: INSATChannel): void {
    this.currentChannel = channel;

    if (this.viewer && !this.isAnimating) {
      const date = this.formatDate(new Date());
      this.loadImagery(channel, date);
    }

    // If animating, rebuild frames with new channel
    if (this.isAnimating) {
      this.stopAnimation();
      this.startAnimation(this.animationConfig);
    }
  }

  /**
   * Get the current active channel.
   */
  getChannel(): INSATChannel {
    return this.currentChannel;
  }

  /**
   * Start satellite animation loop.
   * Requirement 49.1: Last 6 hours at configurable fps (1–10).
   * Requirement 49.2: Progress indicator via timestamp callback.
   */
  startAnimation(config?: Partial<INSATAnimationConfig>): void {
    if (!this.viewer) return;

    this.animationConfig = {
      ...DEFAULT_ANIMATION_CONFIG,
      ...config,
    };

    // Clamp fps to valid range
    this.animationConfig.fps = Math.max(1, Math.min(10, this.animationConfig.fps));

    // Build animation frames for the last N hours
    this.buildAnimationFrames();

    // Start playback
    this.isAnimating = true;
    this.currentFrameIndex = 0;

    const intervalMs = 1000 / this.animationConfig.fps;

    this.animationTimer = setInterval(() => {
      this.advanceFrame();
    }, intervalMs);
  }

  /**
   * Stop satellite animation loop.
   */
  stopAnimation(): void {
    if (this.animationTimer) {
      clearInterval(this.animationTimer);
      this.animationTimer = null;
    }
    this.isAnimating = false;
    this.currentFrameIndex = 0;
  }

  /**
   * Get the current acquisition timestamp for data freshness display.
   * Requirement 16.3: Display acquisition timestamp.
   */
  getAcquisitionTimestamp(): Date | null {
    return this.lastAcquisitionTimestamp;
  }

  /**
   * Get whether the layer is using fallback GIBS imagery.
   * Requirement 16.4: Indicate substitution to user.
   */
  isUsingFallback(): boolean {
    return this.usingFallback;
  }

  /**
   * Get the current animation frame index (for progress display).
   * Requirement 49.2: Progress indicator showing current frame timestamp.
   */
  getCurrentFrameIndex(): number {
    return this.currentFrameIndex;
  }

  /**
   * Get total number of animation frames.
   */
  getTotalFrames(): number {
    return this.animationFrames.length;
  }

  /**
   * Get the timestamp of the current animation frame.
   */
  getCurrentFrameTimestamp(): Date | null {
    if (this.animationFrames.length === 0) return null;
    return this.animationFrames[this.currentFrameIndex]?.timestamp ?? null;
  }

  /**
   * Update animation FPS dynamically.
   */
  setAnimationFps(fps: number): void {
    const clampedFps = Math.max(1, Math.min(10, fps));
    this.animationConfig.fps = clampedFps;

    // Restart animation with new fps if currently playing
    if (this.isAnimating) {
      this.stopAnimation();
      this.startAnimation(this.animationConfig);
    }
  }

  /**
   * Whether animation is currently playing.
   */
  isPlaying(): boolean {
    return this.isAnimating;
  }

  // ── Private: Imagery Loading ─────────────────────────────────────────────

  /**
   * Load imagery for the specified channel and date.
   * Attempts INSAT first, falls back to NASA GIBS.
   */
  private loadImagery(channel: INSATChannel, dateStr: string): void {
    if (!this.viewer) return;

    // Remove current imagery layer
    this.removeActiveImagery();

    // Try INSAT source first (structured for future integration)
    const insatProvider = this.createINSATProvider(channel, dateStr);

    if (insatProvider) {
      this.activeImageryLayer = this.viewer.imageryLayers.addImageryProvider(insatProvider);
      this.usingFallback = false;
      this.lastAcquisitionTimestamp = new Date();
    } else {
      // Fallback to NASA GIBS (Requirement 16.4)
      const gibsProvider = this.createGIBSProvider(channel, dateStr);
      if (gibsProvider) {
        this.activeImageryLayer = this.viewer.imageryLayers.addImageryProvider(gibsProvider);
        this.usingFallback = true;
        this.lastAcquisitionTimestamp = new Date(dateStr + 'T00:00:00Z');
        console.info(
          `[INSATLayer] INSAT imagery unavailable for channel ${channel}. ` +
            'Using NASA GIBS VIIRS/MODIS as fallback.',
        );
      }
    }
  }

  /**
   * Attempt to create an INSAT imagery provider.
   * Returns null since MOSDAC URLs are not publicly accessible.
   * Structured so INSAT can be swapped in when API access is provided.
   */
  private createINSATProvider(
    _channel: INSATChannel,
    _dateStr: string,
  ): Cesium.ImageryProvider | null {
    // INSAT-3D imagery from MOSDAC is not publicly accessible via direct tile URLs.
    // When ISRO provides API access, implement here using UrlTemplateImageryProvider:
    //
    // const url = INSAT_URL_TEMPLATE
    //   .replace('{channel}', channelToINSATCode(channel))
    //   .replace('{timestamp}', formatINSATTimestamp(dateStr));
    //
    // return new Cesium.UrlTemplateImageryProvider({
    //   url,
    //   rectangle: Cesium.Rectangle.fromDegrees(44, 0, 110, 40), // Indian Ocean region
    //   tilingScheme: new Cesium.GeographicTilingScheme(),
    //   maximumLevel: 8,
    // });

    return null;
  }

  /**
   * Create a NASA GIBS imagery provider for the given channel.
   * Uses WebMapTileServiceImageryProvider for WMTS access.
   */
  private createGIBSProvider(
    channel: INSATChannel,
    dateStr: string,
  ): Cesium.ImageryProvider | null {
    const layerName = GIBS_LAYER_MAP[channel];

    try {
      const provider = new Cesium.WebMapTileServiceImageryProvider({
        url: `${GIBS_WMTS_BASE}/1.0.0/${layerName}/default/${dateStr}/${GIBS_TILE_MATRIX_SET}/{TileMatrix}/{TileRow}/{TileCol}.jpg`,
        layer: layerName,
        style: 'default',
        format: 'image/jpeg',
        tileMatrixSetID: GIBS_TILE_MATRIX_SET,
        maximumLevel: GIBS_MAX_ZOOM,
        tilingScheme: new Cesium.GeographicTilingScheme(),
        rectangle: Cesium.Rectangle.fromDegrees(-180, -90, 180, 90),
        credit: new Cesium.Credit('NASA GIBS'),
      });

      return provider;
    } catch (error) {
      console.error(
        `[INSATLayer] Failed to create GIBS provider for channel ${channel}:`,
        error,
      );
      return null;
    }
  }

  // ── Private: Animation ───────────────────────────────────────────────────

  /**
   * Build animation frames for the configured time window.
   * Generates timestamps at INSAT_FRAME_INTERVAL_MINUTES intervals
   * going back animationConfig.hoursBack hours.
   */
  private buildAnimationFrames(): void {
    this.animationFrames = [];

    const now = new Date();
    const totalMinutes = this.animationConfig.hoursBack * 60;
    const numFrames = Math.floor(totalMinutes / INSAT_FRAME_INTERVAL_MINUTES);

    for (let i = numFrames; i >= 0; i--) {
      const frameTime = new Date(
        now.getTime() - i * INSAT_FRAME_INTERVAL_MINUTES * 60 * 1000,
      );

      this.animationFrames.push({
        timestamp: frameTime,
        provider: null, // Providers are created on-demand during playback
        source: 'GIBS', // Default to GIBS since INSAT isn't available
      });
    }
  }

  /**
   * Advance to the next animation frame.
   * Swaps the imagery layer to show the next temporal frame.
   */
  private advanceFrame(): void {
    if (!this.viewer || this.animationFrames.length === 0) return;

    this.currentFrameIndex++;

    // Loop or stop at end
    if (this.currentFrameIndex >= this.animationFrames.length) {
      if (this.animationConfig.loop) {
        this.currentFrameIndex = 0;
      } else {
        this.stopAnimation();
        return;
      }
    }

    const frame = this.animationFrames[this.currentFrameIndex];
    if (!frame) return;

    // Update the displayed imagery
    const dateStr = this.formatDate(frame.timestamp);
    this.loadImagery(this.currentChannel, dateStr);

    // Update acquisition timestamp for freshness display
    this.lastAcquisitionTimestamp = frame.timestamp;
  }

  // ── Private: Cleanup ─────────────────────────────────────────────────────

  /**
   * Remove the currently active imagery layer from the viewer.
   */
  private removeActiveImagery(): void {
    if (!this.viewer || !this.activeImageryLayer) return;

    this.viewer.imageryLayers.remove(this.activeImageryLayer, true);
    this.activeImageryLayer = null;
  }

  // ── Private: Utilities ───────────────────────────────────────────────────

  /**
   * Format a Date as 'YYYY-MM-DD' for GIBS date parameter.
   */
  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
