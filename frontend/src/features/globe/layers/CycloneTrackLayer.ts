/**
 * CycloneTrackLayer — CZML-animated cyclone track visualization.
 *
 * Renders predicted cyclone tracks on the CesiumJS globe with:
 * - Polyline path colored by Saffir-Simpson intensity scale
 * - Cone-of-uncertainty polygon (66% probability envelope)
 * - Animated cyclone position billboard synchronized with timeline
 * - Metadata info card (name, category, max wind, central pressure)
 *
 * Requirements: 22.1, 22.2, 22.3, 22.4
 */

import * as Cesium from 'cesium';
import type { LayerPlugin, LayerState } from '../types';

// ── Saffir-Simpson Category Colors ──────────────────────────────────────────
// Category 0 (Tropical Depression) through 5 (Cat 5)

const SAFFIR_SIMPSON_COLORS: Record<number, Cesium.Color> = {
  0: new Cesium.Color(0.4, 0.7, 1.0, 1.0),   // Tropical Depression — light blue
  1: new Cesium.Color(1.0, 1.0, 0.4, 1.0),   // Category 1 — yellow
  2: new Cesium.Color(1.0, 0.8, 0.2, 1.0),   // Category 2 — orange-yellow
  3: new Cesium.Color(1.0, 0.5, 0.1, 1.0),   // Category 3 — orange
  4: new Cesium.Color(1.0, 0.2, 0.1, 1.0),   // Category 4 — red-orange
  5: new Cesium.Color(0.8, 0.0, 0.2, 1.0),   // Category 5 — deep red
};

/** Get Saffir-Simpson color for a given wind intensity (knots) */
function getIntensityColor(intensityKts: number): Cesium.Color {
  if (intensityKts >= 137) return SAFFIR_SIMPSON_COLORS[5];
  if (intensityKts >= 113) return SAFFIR_SIMPSON_COLORS[4];
  if (intensityKts >= 96) return SAFFIR_SIMPSON_COLORS[3];
  if (intensityKts >= 83) return SAFFIR_SIMPSON_COLORS[2];
  if (intensityKts >= 64) return SAFFIR_SIMPSON_COLORS[1];
  return SAFFIR_SIMPSON_COLORS[0];
}

/** Get Saffir-Simpson category number from wind speed in knots */
function getCategory(windKts: number): number {
  if (windKts >= 137) return 5;
  if (windKts >= 113) return 4;
  if (windKts >= 96) return 3;
  if (windKts >= 83) return 2;
  if (windKts >= 64) return 1;
  return 0;
}

/** Get category display label */
function getCategoryLabel(category: number): string {
  if (category === 0) return 'Tropical Depression';
  return `Category ${category}`;
}

// ── Cyclone Track Data Interface ─────────────────────────────────────────────

export interface CycloneTrackPoint {
  lat: number;
  lon: number;
  time: string; // ISO 8601
  intensity: number; // wind speed in knots
}

export interface CycloneTrackData {
  id: string;
  name: string;
  category: number;
  maxWind_kts: number;
  centralPressure_hPa: number;
  track: CycloneTrackPoint[];
}

// ── Mock Cyclone Data — Bay of Bengal Sample ─────────────────────────────────
// Simulates Cyclone "VAYU" track across the Bay of Bengal toward Odisha coast

const MOCK_CYCLONE: CycloneTrackData = {
  id: 'cyclone-vayu-2024',
  name: 'VAYU',
  category: 3,
  maxWind_kts: 105,
  centralPressure_hPa: 958,
  track: [
    { lat: 10.5, lon: 88.0, time: '2024-10-01T00:00:00Z', intensity: 35 },
    { lat: 11.2, lon: 87.5, time: '2024-10-01T06:00:00Z', intensity: 45 },
    { lat: 12.0, lon: 87.0, time: '2024-10-01T12:00:00Z', intensity: 55 },
    { lat: 12.8, lon: 86.3, time: '2024-10-01T18:00:00Z', intensity: 65 },
    { lat: 13.5, lon: 85.8, time: '2024-10-02T00:00:00Z', intensity: 75 },
    { lat: 14.3, lon: 85.2, time: '2024-10-02T06:00:00Z', intensity: 85 },
    { lat: 15.0, lon: 84.5, time: '2024-10-02T12:00:00Z', intensity: 95 },
    { lat: 15.8, lon: 84.0, time: '2024-10-02T18:00:00Z', intensity: 105 },
    { lat: 16.5, lon: 83.5, time: '2024-10-03T00:00:00Z', intensity: 100 },
    { lat: 17.2, lon: 83.0, time: '2024-10-03T06:00:00Z', intensity: 90 },
    { lat: 18.0, lon: 82.5, time: '2024-10-03T12:00:00Z', intensity: 75 },
    { lat: 18.8, lon: 82.0, time: '2024-10-03T18:00:00Z', intensity: 60 },
    { lat: 19.5, lon: 81.8, time: '2024-10-04T00:00:00Z', intensity: 45 },
  ],
};

// ── Cone of Uncertainty Constants ────────────────────────────────────────────

/** Base radius of the cone at the start (in degrees) */
const CONE_BASE_RADIUS_DEG = 0.3;

/** Growth rate per track point (degrees per step) */
const CONE_GROWTH_RATE_DEG = 0.15;

/** Cone polygon opacity */
const CONE_OPACITY = 0.2;

/** Number of points to generate per cone cross-section */
const CONE_CROSS_SECTION_POINTS = 16;

// ── CycloneTrackLayer ────────────────────────────────────────────────────────

/**
 * CycloneTrackLayer implements the LayerPlugin interface for rendering
 * CZML-animated cyclone tracks with cone-of-uncertainty visualization.
 */
export class CycloneTrackLayer implements LayerPlugin {
  public readonly id = 'cyclone-track';
  public readonly priority = 55; // Above terminator, below UI

  private viewer: Cesium.Viewer | null = null;
  private trackEntity: Cesium.Entity | null = null;
  private coneEntity: Cesium.Entity | null = null;
  private positionEntity: Cesium.Entity | null = null;
  private metadataEntity: Cesium.Entity | null = null;
  private segmentEntities: Cesium.Entity[] = [];
  private lastUpdateTime = 0;

  // ── Lifecycle ────────────────────────────────────────────────────────────

  init(viewer: Cesium.Viewer): void {
    this.viewer = viewer;
  }

  update(state: LayerState): void {
    if (!this.viewer) return;

    const { selectedDate } = state;
    const dateMs = selectedDate.getTime();

    // Skip redundant updates within 1-second tolerance
    if (Math.abs(dateMs - this.lastUpdateTime) < 1000) return;
    this.lastUpdateTime = dateMs;

    // Clear previous entities
    this.clearEntities();

    // Render cyclone track using mock data
    const cyclone = MOCK_CYCLONE;

    this.renderTrackPolylines(cyclone);
    this.renderConeOfUncertainty(cyclone);
    this.renderAnimatedPosition(cyclone, selectedDate);
    this.renderMetadataLabel(cyclone, selectedDate);
  }

  destroy(): void {
    this.clearEntities();
    this.viewer = null;
    this.lastUpdateTime = 0;
  }

  // ── Track Polyline Rendering ───────────────────────────────────────────────

  /**
   * Render the cyclone track as segmented polylines colored by intensity
   * (Saffir-Simpson scale). Each segment between track points gets the
   * color of its starting intensity.
   */
  private renderTrackPolylines(cyclone: CycloneTrackData): void {
    if (!this.viewer || cyclone.track.length < 2) return;

    // Render individual segments for per-segment intensity coloring
    for (let i = 0; i < cyclone.track.length - 1; i++) {
      const p1 = cyclone.track[i];
      const p2 = cyclone.track[i + 1];
      const color = getIntensityColor(p1.intensity);

      const positions = [
        Cesium.Cartesian3.fromDegrees(p1.lon, p1.lat, 500),
        Cesium.Cartesian3.fromDegrees(p2.lon, p2.lat, 500),
      ];

      const entity = this.viewer.entities.add({
        polyline: {
          positions,
          width: 4.0,
          material: new Cesium.ColorMaterialProperty(color),
          clampToGround: true,
        },
      });

      this.segmentEntities.push(entity);
    }

    // Also render track point markers (small circles at each advisory position)
    for (const point of cyclone.track) {
      const entity = this.viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(point.lon, point.lat, 500),
        point: {
          pixelSize: 6,
          color: getIntensityColor(point.intensity),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 1,
        },
      });
      this.segmentEntities.push(entity);
    }
  }

  // ── Cone of Uncertainty ────────────────────────────────────────────────────

  /**
   * Render the 66% probability cone-of-uncertainty as an expanding
   * translucent polygon along the track path.
   */
  private renderConeOfUncertainty(cyclone: CycloneTrackData): void {
    if (!this.viewer || cyclone.track.length < 2) return;

    // Build cone polygon by creating outline points on both sides of the track
    const leftSide: Cesium.Cartesian3[] = [];
    const rightSide: Cesium.Cartesian3[] = [];

    for (let i = 0; i < cyclone.track.length; i++) {
      const point = cyclone.track[i];
      const radius = CONE_BASE_RADIUS_DEG + CONE_GROWTH_RATE_DEG * i;

      // Compute perpendicular direction to track
      let bearing: number;
      if (i < cyclone.track.length - 1) {
        const next = cyclone.track[i + 1];
        bearing = Math.atan2(next.lon - point.lon, next.lat - point.lat);
      } else {
        const prev = cyclone.track[i - 1];
        bearing = Math.atan2(point.lon - prev.lon, point.lat - prev.lat);
      }

      // Perpendicular offsets (90° left and right)
      const perpLeft = bearing + Math.PI / 2;
      const perpRight = bearing - Math.PI / 2;

      leftSide.push(
        Cesium.Cartesian3.fromDegrees(
          point.lon + radius * Math.sin(perpLeft),
          point.lat + radius * Math.cos(perpLeft),
          100
        )
      );

      rightSide.push(
        Cesium.Cartesian3.fromDegrees(
          point.lon + radius * Math.sin(perpRight),
          point.lat + radius * Math.cos(perpRight),
          100
        )
      );
    }

    // Build closed polygon: left side forward, right side reversed
    const positions = [...leftSide, ...rightSide.reverse()];

    this.coneEntity = this.viewer.entities.add({
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(positions),
        material: new Cesium.ColorMaterialProperty(
          new Cesium.Color(1.0, 0.6, 0.2, CONE_OPACITY)
        ),
        classificationType: Cesium.ClassificationType.BOTH,
        outline: true,
        outlineColor: new Cesium.Color(1.0, 0.6, 0.2, 0.5),
        outlineWidth: 1,
      },
    });
  }

  // ── Animated Cyclone Position ──────────────────────────────────────────────

  /**
   * Render animated cyclone position marker along the track.
   * Position is interpolated based on the current selectedDate.
   */
  private renderAnimatedPosition(
    cyclone: CycloneTrackData,
    selectedDate: Date
  ): void {
    if (!this.viewer || cyclone.track.length === 0) return;

    const currentPos = this.interpolatePosition(cyclone.track, selectedDate);

    // Cyclone eye billboard marker
    this.positionEntity = this.viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(
        currentPos.lon,
        currentPos.lat,
        1000
      ),
      billboard: {
        image: this.createCycloneIconDataUri(),
        width: 48,
        height: 48,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
      },
    });
  }

  // ── Metadata Label ─────────────────────────────────────────────────────────

  /**
   * Render cyclone metadata floating label card near the current position.
   * Displays: name, category, max wind, central pressure.
   */
  private renderMetadataLabel(
    cyclone: CycloneTrackData,
    selectedDate: Date
  ): void {
    if (!this.viewer || cyclone.track.length === 0) return;

    const currentPos = this.interpolatePosition(cyclone.track, selectedDate);
    const currentIntensity = this.interpolateIntensity(cyclone.track, selectedDate);
    const category = getCategory(currentIntensity);

    const labelText = [
      `🌀 ${cyclone.name}`,
      `${getCategoryLabel(category)}`,
      `Wind: ${currentIntensity} kts`,
      `Pressure: ${cyclone.centralPressure_hPa} hPa`,
    ].join('\n');

    this.metadataEntity = this.viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(
        currentPos.lon + 0.5, // Offset to avoid overlapping billboard
        currentPos.lat + 0.5,
        2000
      ),
      label: {
        text: labelText,
        font: '14px Inter, sans-serif',
        fillColor: Cesium.Color.WHITE,
        backgroundColor: new Cesium.Color(0.1, 0.1, 0.15, 0.85),
        showBackground: true,
        backgroundPadding: new Cesium.Cartesian2(12, 8),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
        pixelOffset: new Cesium.Cartesian2(20, -20),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }

  // ── Position Interpolation ─────────────────────────────────────────────────

  /**
   * Interpolate cyclone position along the track based on selected time.
   * Linearly interpolates between track points.
   */
  private interpolatePosition(
    track: CycloneTrackPoint[],
    date: Date
  ): { lat: number; lon: number } {
    const timeMs = date.getTime();

    // Before first point — use first position
    const firstTime = new Date(track[0].time).getTime();
    if (timeMs <= firstTime) {
      return { lat: track[0].lat, lon: track[0].lon };
    }

    // After last point — use last position
    const lastTime = new Date(track[track.length - 1].time).getTime();
    if (timeMs >= lastTime) {
      return { lat: track[track.length - 1].lat, lon: track[track.length - 1].lon };
    }

    // Find the two bracketing points
    for (let i = 0; i < track.length - 1; i++) {
      const t0 = new Date(track[i].time).getTime();
      const t1 = new Date(track[i + 1].time).getTime();

      if (timeMs >= t0 && timeMs <= t1) {
        const fraction = (timeMs - t0) / (t1 - t0);
        return {
          lat: track[i].lat + fraction * (track[i + 1].lat - track[i].lat),
          lon: track[i].lon + fraction * (track[i + 1].lon - track[i].lon),
        };
      }
    }

    // Fallback — shouldn't reach here
    return { lat: track[0].lat, lon: track[0].lon };
  }

  /**
   * Interpolate cyclone intensity (wind speed) at the current time.
   */
  private interpolateIntensity(
    track: CycloneTrackPoint[],
    date: Date
  ): number {
    const timeMs = date.getTime();

    const firstTime = new Date(track[0].time).getTime();
    if (timeMs <= firstTime) return track[0].intensity;

    const lastTime = new Date(track[track.length - 1].time).getTime();
    if (timeMs >= lastTime) return track[track.length - 1].intensity;

    for (let i = 0; i < track.length - 1; i++) {
      const t0 = new Date(track[i].time).getTime();
      const t1 = new Date(track[i + 1].time).getTime();

      if (timeMs >= t0 && timeMs <= t1) {
        const fraction = (timeMs - t0) / (t1 - t0);
        return Math.round(
          track[i].intensity + fraction * (track[i + 1].intensity - track[i].intensity)
        );
      }
    }

    return track[0].intensity;
  }

  // ── Cyclone Icon Generator ─────────────────────────────────────────────────

  /**
   * Generate a cyclone eye SVG icon as a data URI for the billboard marker.
   * Renders a spiral hurricane symbol.
   */
  private createCycloneIconDataUri(): string {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
        <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,100,50,0.8)" stroke-width="3"/>
        <circle cx="32" cy="32" r="18" fill="none" stroke="rgba(255,150,80,0.7)" stroke-width="2.5"/>
        <circle cx="32" cy="32" r="8" fill="rgba(255,200,100,0.9)" stroke="white" stroke-width="1.5"/>
        <path d="M32 4 C 50 10, 58 28, 52 40 C 46 52, 28 56, 16 48" 
              fill="none" stroke="rgba(255,120,60,0.6)" stroke-width="2" stroke-linecap="round"/>
        <path d="M32 60 C 14 54, 6 36, 12 24 C 18 12, 36 8, 48 16" 
              fill="none" stroke="rgba(255,120,60,0.6)" stroke-width="2" stroke-linecap="round"/>
      </svg>`;

    return `data:image/svg+xml;base64,${btoa(svg.trim())}`;
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  private clearEntities(): void {
    if (!this.viewer) return;

    if (this.trackEntity) {
      this.viewer.entities.remove(this.trackEntity);
      this.trackEntity = null;
    }

    if (this.coneEntity) {
      this.viewer.entities.remove(this.coneEntity);
      this.coneEntity = null;
    }

    if (this.positionEntity) {
      this.viewer.entities.remove(this.positionEntity);
      this.positionEntity = null;
    }

    if (this.metadataEntity) {
      this.viewer.entities.remove(this.metadataEntity);
      this.metadataEntity = null;
    }

    for (const entity of this.segmentEntities) {
      this.viewer.entities.remove(entity);
    }
    this.segmentEntities = [];
  }
}
