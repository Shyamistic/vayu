/**
 * Lightweight animated wind-particle flow, standing in for the real
 * cesium-wind-layer package (file:../cesium-wind-layer/packages/cesium-wind-layer),
 * whose source directory is not present in this checkout.
 *
 * The real package advects particles on the GPU via a WebGL shader. This is a
 * simpler CPU-driven equivalent: a fixed pool of particles is advected through
 * the u/v field each clock tick and rendered as short fading polyline streaks,
 * which is enough to read as flowing wind (Ventusky/Windy-style) rather than a
 * static field. It implements the same constructor/API surface CesiumGlobe.tsx
 * already calls, so no call-site changes were needed.
 */
import * as Cesium from 'cesium';
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

// ── Tuning constants ─────────────────────────────────────────────────────────

/** Hard cap on particle count regardless of requested texture size (CPU-driven, not GPU). */
const MAX_PARTICLES = 500;
/**
 * Visual speed exaggeration. A few m/s of real wind is imperceptible when
 * displayed across a continent-scale map, so displacement is scaled up by a
 * large constant purely for legibility (the real GPU-based cesium-wind-layer
 * does the same via its `speedFactor` option) — this is not a physical unit.
 */
const VISUAL_SPEED_SCALE = 2500;
const METERS_PER_DEG_LAT = 110_540;

interface Particle {
  lon: number;
  lat: number;
  prevCartesian: Cesium.Cartesian3 | null;
  age: number;
  maxAge: number;
}

function pickColor(colors: string[], t: number): Cesium.Color {
  const stops = colors.map((c) => Cesium.Color.fromCssColorString(c));
  const scaled = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.floor(scaled);
  const frac = scaled - i;
  const from = stops[i];
  const to = stops[Math.min(i + 1, stops.length - 1)];
  return Cesium.Color.lerp(from, to, frac, new Cesium.Color());
}

export class WindLayer {
  private _show = true;
  private viewer: Viewer;
  private data: WindData;
  private colors: string[];
  private speedFactor: number;
  private particleHeight: number;
  private dropRate: number;
  private maxSpeed: number;

  private particles: Particle[];
  private polylines: Cesium.PolylineCollection;
  private polylineHandles: Cesium.Polyline[] = [];
  private removeTickListener: (() => void) | null = null;
  private lastTime = performance.now();

  constructor(viewer: Viewer, data: WindData, options: WindLayerOptions = {}) {
    this.viewer = viewer;
    this.data = data;
    this.colors = options.colors && options.colors.length > 0 ? options.colors : ['rgba(255,255,255,0.8)'];
    this.speedFactor = options.speedFactor ?? 2;
    this.particleHeight = options.particleHeight ?? 5000;
    this.dropRate = options.dropRate ?? 0.003;

    this.maxSpeed = Math.max(
      Math.abs(data.u.min), Math.abs(data.u.max),
      Math.abs(data.v.min), Math.abs(data.v.max),
      1
    );

    const requested = (options.particlesTextureSize ?? 24) ** 2;
    const count = Math.max(32, Math.min(MAX_PARTICLES, requested));

    this.polylines = new Cesium.PolylineCollection();
    this.viewer.scene.primitives.add(this.polylines);

    this.particles = Array.from({ length: count }, () => this.spawnParticle());
    for (const particle of this.particles) {
      const position = Cesium.Cartesian3.fromDegrees(particle.lon, particle.lat, this.particleHeight);
      const handle = this.polylines.add({
        positions: [position, position],
        width: 1.5,
        material: Cesium.Material.fromType('Color', { color: Cesium.Color.WHITE.withAlpha(0) }),
      });
      this.polylineHandles.push(handle);
    }

    this.removeTickListener = viewer.clock.onTick.addEventListener(() => this.tick());
  }

  get show(): boolean {
    return this._show;
  }

  set show(value: boolean) {
    this._show = value;
    this.polylines.show = value;
  }

  private spawnParticle(): Particle {
    const { bounds } = this.data;
    return {
      lon: bounds.west + Math.random() * (bounds.east - bounds.west),
      lat: bounds.south + Math.random() * (bounds.north - bounds.south),
      prevCartesian: null,
      // Age/maxAge are in seconds of wall-clock lifetime — long enough that
      // particles trace continuous flowing streaks rather than flickering.
      age: Math.random() * 8,
      maxAge: 8 + Math.random() * 8,
    };
  }

  private sampleWind(lon: number, lat: number): { u: number; v: number } | null {
    const { width, height, bounds, u, v } = this.data;
    if (lon < bounds.west || lon > bounds.east || lat < bounds.south || lat > bounds.north) return null;
    const col = Math.min(width - 1, Math.max(0, Math.round(((lon - bounds.west) / (bounds.east - bounds.west)) * (width - 1))));
    const row = Math.min(height - 1, Math.max(0, Math.round(((bounds.north - lat) / (bounds.north - bounds.south)) * (height - 1))));
    const idx = row * width + col;
    const uVal = u.array[idx];
    const vVal = v.array[idx];
    if (uVal === undefined || vVal === undefined) return null;
    return { u: uVal, v: vVal };
  }

  private tick(): void {
    if (!this._show) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    if (dt <= 0) return;

    for (let i = 0; i < this.particles.length; i++) {
      const particle = this.particles[i];
      const handle = this.polylineHandles[i];
      particle.age += dt;

      const wind = this.sampleWind(particle.lon, particle.lat);
      const outOfBounds = wind === null;
      const expired = particle.age > particle.maxAge;
      // dropRate is a per-second probability, not per-frame, so it stays
      // framerate-independent and rare enough not to dominate particle lifetime.
      const randomDrop = Math.random() < this.dropRate * dt;

      if (outOfBounds || expired || randomDrop) {
        Object.assign(particle, this.spawnParticle());
        particle.prevCartesian = null;
        (handle.material.uniforms as { color: Cesium.Color }).color = Cesium.Color.WHITE.withAlpha(0);
        continue;
      }

      const { u, v } = wind as { u: number; v: number };
      const metersPerDegLon = METERS_PER_DEG_LAT * Math.cos(particle.lat * (Math.PI / 180));
      const dLon = (u * this.speedFactor * VISUAL_SPEED_SCALE * dt) / Math.max(metersPerDegLon, 1);
      const dLat = (v * this.speedFactor * VISUAL_SPEED_SCALE * dt) / METERS_PER_DEG_LAT;

      const nextLon = particle.lon + dLon;
      const nextLat = particle.lat + dLat;
      const currentCartesian = Cesium.Cartesian3.fromDegrees(particle.lon, particle.lat, this.particleHeight);

      const speed = Math.sqrt(u * u + v * v);
      const speedT = Math.min(1, speed / this.maxSpeed);
      const fadeIn = Math.min(1, particle.age / 1.5);
      const baseColor = pickColor(this.colors, speedT);
      const color = baseColor.withAlpha(baseColor.alpha * fadeIn);

      handle.positions = particle.prevCartesian
        ? [particle.prevCartesian, currentCartesian]
        : [currentCartesian, currentCartesian];
      (handle.material.uniforms as { color: Cesium.Color }).color = color;

      particle.prevCartesian = currentCartesian;
      particle.lon = nextLon;
      particle.lat = nextLat;
    }
  }

  destroy(): void {
    if (this.removeTickListener) {
      this.removeTickListener();
      this.removeTickListener = null;
    }
    try {
      this.viewer.scene.primitives.remove(this.polylines);
    } catch {
      /* already removed */
    }
    this.particles = [];
    this.polylineHandles = [];
  }
}
