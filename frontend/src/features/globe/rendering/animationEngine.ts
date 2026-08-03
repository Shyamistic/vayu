/**
 * Temporal Animation Engine for 7-day forecast playback.
 *
 * Preloads predictions for all 7 forecast days in parallel, then animates
 * through them using requestAnimationFrame with configurable FPS and smooth
 * interpolation between adjacent timesteps.
 *
 * Requirements: 11.1, 11.2, 11.3
 */

import type { GridCell, RegionId } from '../../../types';
import { fetchPrediction } from '../../../api/client';

// ── Public interfaces ────────────────────────────────────────────────────────

export interface AnimationConfig {
  /** First forecast day (inclusive, typically 1) */
  startDay: number;
  /** Last forecast day (inclusive, typically 7) */
  endDay: number;
  /** Frames per second (1–10) */
  fps: number;
  /** Enable smooth color interpolation between adjacent timesteps */
  interpolate: boolean;
  /** Loop the animation when reaching the end */
  loop: boolean;
  /** Callback invoked on each frame with current day and interpolation fraction */
  onFrame: (day: number, fraction: number, cells?: GridCell[]) => void;
}

// ── Interpolation utility ────────────────────────────────────────────────────

/**
 * Linearly interpolates between two sets of grid cells.
 *
 * For each pair of cells at the same index, the interpolated value is:
 *   cellsA[i].value × (1 - t) + cellsB[i].value × t
 *
 * The result is bounded between min and max of the two source values.
 *
 * @param cellsA - Grid cells from the earlier timestep
 * @param cellsB - Grid cells from the later timestep
 * @param t - Interpolation fraction in [0, 1]
 * @returns New array of interpolated grid cells
 */
export function interpolateGridCells(
  cellsA: GridCell[],
  cellsB: GridCell[],
  t: number,
): GridCell[] {
  // Clamp t to [0, 1] for safety
  const clampedT = Math.max(0, Math.min(1, t));

  const length = Math.min(cellsA.length, cellsB.length);
  const result: GridCell[] = new Array(length);

  for (let i = 0; i < length; i++) {
    const a = cellsA[i];
    const b = cellsB[i];

    result[i] = {
      lat: a.lat,
      lon: a.lon,
      node_idx: a.node_idx,
      rainfall: lerp(a.rainfall, b.rainfall, clampedT),
      temp_max: lerp(a.temp_max, b.temp_max, clampedT),
      temp_min: lerp(a.temp_min, b.temp_min, clampedT),
      rainfall_uncertainty: lerp(a.rainfall_uncertainty, b.rainfall_uncertainty, clampedT),
      temp_max_uncertainty: lerp(a.temp_max_uncertainty, b.temp_max_uncertainty, clampedT),
      temp_min_uncertainty: lerp(a.temp_min_uncertainty, b.temp_min_uncertainty, clampedT),
    };
  }

  return result;
}

/**
 * Linear interpolation bounded between the two source values.
 * Ensures the result never exceeds the range [min(a,b), max(a,b)].
 */
function lerp(a: number, b: number, t: number): number {
  const value = a * (1 - t) + b * t;
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  return Math.max(min, Math.min(max, value));
}

// ── Animation Engine ─────────────────────────────────────────────────────────

export class TemporalAnimationEngine {
  /** Preloaded prediction data keyed by forecast day (1–7) */
  private predictions: Map<number, GridCell[]> = new Map();

  /** Active animation frame request ID */
  private frameId: number | null = null;

  /** Whether animation is currently playing */
  private _isPlaying = false;

  /** Current animation state for external queries */
  private _currentDay = 1;
  private _currentFraction = 0;

  get isPlaying(): boolean {
    return this._isPlaying;
  }

  get currentDay(): number {
    return this._currentDay;
  }

  get currentFraction(): number {
    return this._currentFraction;
  }

  /**
   * Returns the number of preloaded days.
   */
  get preloadedDays(): number {
    return this.predictions.size;
  }

  /**
   * Fetches prediction data for all 7 forecast days in parallel.
   * After completion, the engine is ready to play.
   *
   * @param region - The region to fetch predictions for
   * @param date - The base date (ISO string, e.g. "2025-01-15")
   */
  async preloadAll(region: RegionId, date: string): Promise<void> {
    const promises = Array.from({ length: 7 }, (_, i) =>
      fetchPrediction(date, region, i + 1),
    );

    const results = await Promise.all(promises);

    this.predictions.clear();
    results.forEach((response, index) => {
      this.predictions.set(index + 1, response.grid_cells);
    });
  }

  /**
   * Returns the preloaded grid cells for a specific day.
   */
  getCells(day: number): GridCell[] | undefined {
    return this.predictions.get(day);
  }

  /**
   * Starts the animation loop with the given configuration.
   * The animation advances through forecast days at the configured FPS,
   * optionally interpolating between adjacent timesteps.
   */
  play(config: AnimationConfig): void {
    // Stop any existing animation
    this.stop();

    const { startDay, endDay, fps, interpolate, loop, onFrame } = config;
    const clampedFps = Math.max(1, Math.min(10, fps));

    // Duration in ms to spend on each day
    const dayDuration = 1000 / clampedFps;

    // Total days in the animation range
    const totalDays = endDay - startDay + 1;

    let elapsed = 0;
    let lastTimestamp: number | null = null;

    this._isPlaying = true;

    const tick = (timestamp: number) => {
      if (!this._isPlaying) return;

      if (lastTimestamp === null) {
        lastTimestamp = timestamp;
      }

      const delta = timestamp - lastTimestamp;
      lastTimestamp = timestamp;
      elapsed += delta;

      // Calculate which day we're on and the fraction into that day
      const totalDuration = totalDays * dayDuration;
      let position = elapsed % totalDuration;

      // Check if we've completed one cycle
      if (elapsed >= totalDuration && !loop) {
        // Final frame: show last day
        this._currentDay = endDay;
        this._currentFraction = 0;
        onFrame(endDay, 0, this.predictions.get(endDay));
        this.stop();
        return;
      }

      // Determine the current day index and fraction
      const dayIndex = Math.floor(position / dayDuration);
      const fraction = (position % dayDuration) / dayDuration;

      const currentDay = startDay + dayIndex;
      const nextDay = currentDay < endDay ? currentDay + 1 : (loop ? startDay : currentDay);

      this._currentDay = currentDay;
      this._currentFraction = fraction;

      if (interpolate && this.predictions.has(currentDay) && this.predictions.has(nextDay) && currentDay !== nextDay) {
        const interpolatedCells = interpolateGridCells(
          this.predictions.get(currentDay)!,
          this.predictions.get(nextDay)!,
          fraction,
        );
        onFrame(currentDay + fraction, fraction, interpolatedCells);
      } else {
        onFrame(currentDay, 0, this.predictions.get(currentDay));
      }

      this.frameId = requestAnimationFrame(tick);
    };

    this.frameId = requestAnimationFrame(tick);
  }

  /**
   * Stops the animation loop and cancels any pending animation frame.
   */
  stop(): void {
    this._isPlaying = false;
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
  }

  /**
   * Clears all preloaded prediction data.
   */
  clear(): void {
    this.stop();
    this.predictions.clear();
  }
}
