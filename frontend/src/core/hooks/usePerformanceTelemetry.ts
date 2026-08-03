/**
 * usePerformanceTelemetry — Real-time performance metrics hook.
 *
 * Collects and exposes:
 *  - FPS (frames per second) via requestAnimationFrame loop
 *  - JS heap memory (used, total, limit) via performance.memory when available
 *  - API latency history (last N samples) via a module-level recorder
 *  - CesiumJS render statistics (triangles, draw calls, texture memory)
 *  - Auto quality-reduction trigger when FPS < 30 for > 5 seconds (Req 46.3)
 *
 * Validates: Requirements 46.1, 46.2, 46.3, 46.4
 */

import { useEffect, useRef, useState, useCallback } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HeapMemory {
  /** Bytes currently used */
  usedJSHeapSize: number;
  /** Total JS heap allocated */
  totalJSHeapSize: number;
  /** Browser-imposed heap limit */
  jsHeapSizeLimit: number;
}

export interface CesiumRenderStats {
  /** Number of draw calls per frame */
  drawCalls: number;
  /** Approximate triangle count in frame */
  triangles: number;
  /** Texture memory estimate (MB) */
  textureMemoryMB: number;
}

export interface PerformanceTelemetry {
  /** Frames per second (rolling average over last 60 frames) */
  fps: number;
  /** GPU / JS heap memory info — null when performance.memory is unavailable */
  memory: HeapMemory | null;
  /** API latency sparkline samples (ms, most recent last) */
  apiLatencySamples: number[];
  /** Most recent API round-trip latency in ms */
  apiLatencyMs: number | null;
  /** CesiumJS render statistics — null until a Viewer reference is provided */
  cesiumStats: CesiumRenderStats | null;
  /** Whether FPS is below threshold long enough to trigger quality reduction */
  lowFpsDetected: boolean;
}

/** Maximum number of API latency samples to retain for sparkline */
const MAX_LATENCY_SAMPLES = 60;

/** FPS below this value is considered low (Req 46.3) */
const LOW_FPS_THRESHOLD = 30;

/** Seconds of sustained low FPS before triggering quality reduction (Req 46.3) */
const LOW_FPS_SECONDS = 5;

// ── Module-level API latency recorder (shared across hook instances) ───────────

const latencySamples: number[] = [];
let latencyListeners: Array<(samples: number[]) => void> = [];

/**
 * Record an API round-trip latency sample.
 * Call this from any TanStack Query/fetch wrapper to feed the telemetry panel.
 */
export function recordApiLatency(ms: number): void {
  latencySamples.push(ms);
  if (latencySamples.length > MAX_LATENCY_SAMPLES) {
    latencySamples.shift();
  }
  latencyListeners.forEach((cb) => cb([...latencySamples]));
}

/** Subscribe to latency updates; returns an unsubscribe function */
function subscribeLatency(cb: (samples: number[]) => void): () => void {
  latencyListeners.push(cb);
  return () => {
    latencyListeners = latencyListeners.filter((l) => l !== cb);
  };
}

/** Clear all stored latency samples — useful for testing */
export function clearLatencySamples(): void {
  latencySamples.length = 0;
  latencyListeners.forEach((cb) => cb([]));
}

// ── CesiumJS viewer reference (optional integration) ─────────────────────────

// We use `unknown` here because CesiumJS types are optional in this environment
let cesiumViewerRef: unknown = null;

/**
 * Register a CesiumJS Viewer instance for render-stat collection.
 * Call from CesiumGlobe once the viewer is initialised.
 */
export function registerCesiumViewer(viewer: unknown): void {
  cesiumViewerRef = viewer;
}

/** Unregister the Viewer (call on unmount) */
export function unregisterCesiumViewer(): void {
  cesiumViewerRef = null;
}

/** Read render stats from Cesium's internal performance display counters */
function readCesiumStats(): CesiumRenderStats | null {
  if (!cesiumViewerRef) return null;

  try {
    // Access via the scene's performanceDisplay or frameState if available.
    // We cast through any to avoid Cesium type dependency in this core hook.
    const viewer = cesiumViewerRef as {
      scene?: {
        frameState?: {
          commandList?: unknown[];
        };
        context?: {
          drawingBufferWidth?: number;
          drawingBufferHeight?: number;
          _gl?: { getParameter?: (param: number) => number };
        };
        primitives?: { length?: number };
      };
    };

    const commandList = viewer?.scene?.frameState?.commandList;
    const drawCalls = Array.isArray(commandList) ? commandList.length : 0;

    // Estimate triangles — crude approximation using draw calls * 500 average
    const triangles = drawCalls * 500;

    // Attempt to read WebGL texture memory via gl.getParameter if available
    let textureMemoryMB = 0;
    const gl = viewer?.scene?.context?._gl;
    if (gl?.getParameter) {
      // 0x9049 = TEXTURE_FREE_MEMORY_ATI (driver-specific, may return 0)
      const freeKb = gl.getParameter(0x9049);
      if (typeof freeKb === 'number' && freeKb > 0) {
        // This gives free memory; we report it as an estimate of total used
        textureMemoryMB = Math.round((1024 * 1024 - freeKb) / 1024);
      }
    }

    return { drawCalls, triangles, textureMemoryMB: Math.max(0, textureMemoryMB) };
  } catch {
    return null;
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UsePerformanceTelemetryOptions {
  /**
   * Whether to actively poll for metrics.
   * Useful to set `false` when the overlay is hidden to avoid unnecessary work.
   * Defaults to `true`.
   */
  enabled?: boolean;

  /**
   * Callback fired when FPS drops below 30 for more than 5 seconds (Req 46.3).
   * The consumer (e.g. CesiumGlobe) should reduce visual quality in response.
   */
  onLowFps?: () => void;
}

/**
 * usePerformanceTelemetry
 *
 * Returns real-time performance metrics. Safe to call even when
 * `performance.memory` is unavailable (returns null for memory fields).
 *
 * Validates: Requirements 46.1, 46.2, 46.3, 46.4
 */
export function usePerformanceTelemetry(
  options: UsePerformanceTelemetryOptions = {},
): PerformanceTelemetry {
  const { enabled = true, onLowFps } = options;

  const [fps, setFps] = useState(0);
  const [memory, setMemory] = useState<HeapMemory | null>(null);
  const [apiLatencySamples, setApiLatencySamples] = useState<number[]>([...latencySamples]);
  const [cesiumStats, setCesiumStats] = useState<CesiumRenderStats | null>(null);
  const [lowFpsDetected, setLowFpsDetected] = useState(false);

  // FPS calculation state (stored in refs to avoid stale closure issues)
  const frameTimestamps = useRef<number[]>([]);
  const rafHandle = useRef<number | null>(null);
  const lowFpsStartRef = useRef<number | null>(null);
  const onLowFpsRef = useRef(onLowFps);
  const lowFpsTriggeredRef = useRef(false);

  useEffect(() => {
    onLowFpsRef.current = onLowFps;
  }, [onLowFps]);

  // ── rAF loop for FPS measurement ─────────────────────────────────────────
  const tick = useCallback(
    (timestamp: number) => {
      if (!enabled) return;

      const frames = frameTimestamps.current;
      frames.push(timestamp);

      // Keep only the last 60 frame timestamps for rolling average
      const windowMs = 1000;
      const cutoff = timestamp - windowMs;
      const start = frames.findIndex((t) => t > cutoff);
      if (start > 0) frames.splice(0, start);

      const currentFps = frames.length; // frames in the last second

      setFps(currentFps);

      // ── Low-FPS detection (Req 46.3) ───────────────────────────────────
      if (currentFps < LOW_FPS_THRESHOLD && currentFps > 0) {
        if (lowFpsStartRef.current === null) {
          lowFpsStartRef.current = timestamp;
          lowFpsTriggeredRef.current = false;
        } else if (
          !lowFpsTriggeredRef.current &&
          timestamp - lowFpsStartRef.current >= LOW_FPS_SECONDS * 1000
        ) {
          lowFpsTriggeredRef.current = true;
          setLowFpsDetected(true);
          onLowFpsRef.current?.();
        }
      } else {
        lowFpsStartRef.current = null;
        lowFpsTriggeredRef.current = false;
        setLowFpsDetected(false);
      }

      // ── Memory snapshot (every frame is cheap) ─────────────────────────
      const perf = performance as Performance & {
        memory?: {
          usedJSHeapSize: number;
          totalJSHeapSize: number;
          jsHeapSizeLimit: number;
        };
      };
      if (perf.memory) {
        setMemory({
          usedJSHeapSize: perf.memory.usedJSHeapSize,
          totalJSHeapSize: perf.memory.totalJSHeapSize,
          jsHeapSizeLimit: perf.memory.jsHeapSizeLimit,
        });
      }

      // ── Cesium stats (every frame) ─────────────────────────────────────
      setCesiumStats(readCesiumStats());

      rafHandle.current = requestAnimationFrame(tick);
    },
    [enabled],
  );

  useEffect(() => {
    if (!enabled) return;
    rafHandle.current = requestAnimationFrame(tick);
    return () => {
      if (rafHandle.current !== null) {
        cancelAnimationFrame(rafHandle.current);
      }
    };
  }, [enabled, tick]);

  // ── Subscribe to API latency updates ────────────────────────────────────
  useEffect(() => {
    const unsub = subscribeLatency((samples) => {
      setApiLatencySamples(samples);
    });
    return unsub;
  }, []);

  const apiLatencyMs =
    apiLatencySamples.length > 0
      ? apiLatencySamples[apiLatencySamples.length - 1]
      : null;

  return {
    fps,
    memory,
    apiLatencySamples,
    apiLatencyMs,
    cesiumStats,
    lowFpsDetected,
  };
}

export default usePerformanceTelemetry;
