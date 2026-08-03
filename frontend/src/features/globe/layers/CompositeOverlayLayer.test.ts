/**
 * Unit tests — CompositeOverlayLayer helpers + compositeOverlayStore.
 *
 * Validates:
 *  - normalise() correctly maps raw values to [0, 1]
 *  - getVariableValue() reads the correct GridCell field
 *  - blendRGB() produces the average of two colours
 *  - bivariateColor() returns an RGB within each component's range
 *  - CompositeOverlayStore: addOverlay, removeOverlay, setOpacity, swapZOrder, moveUp/Down
 *
 * Requirements: 39.1, 39.2, 39.3, 39.4
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  normalise,
  getVariableValue,
  blendRGB,
  bivariateColor,
  VAR_RANGES,
} from './CompositeOverlayLayer';
import type { GridCell } from '../../../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

const mockCell = (overrides: Partial<GridCell> = {}): GridCell => ({
  lat: 15,
  lon: 75,
  node_idx: 0,
  rainfall: 25,
  temp_max: 35,
  temp_min: 20,
  rainfall_uncertainty: 1,
  temp_max_uncertainty: 0.5,
  temp_min_uncertainty: 0.5,
  ...overrides,
});

// ── normalise ─────────────────────────────────────────────────────────────────

describe('normalise()', () => {
  it('maps the minimum range value to 0', () => {
    const { min } = VAR_RANGES.rainfall;
    expect(normalise(min, 'rainfall')).toBe(0);
  });

  it('maps the maximum range value to 1', () => {
    const { max } = VAR_RANGES.rainfall;
    expect(normalise(max, 'rainfall')).toBe(1);
  });

  it('maps a mid-range value to ~0.5 for rainfall', () => {
    const { min, max } = VAR_RANGES.rainfall;
    const mid = (min + max) / 2;
    expect(normalise(mid, 'rainfall')).toBeCloseTo(0.5, 5);
  });

  it('clamps values below range minimum to 0', () => {
    expect(normalise(-100, 'temp_max')).toBe(0);
  });

  it('clamps values above range maximum to 1', () => {
    expect(normalise(999, 'temp_max')).toBe(1);
  });

  it('handles temp_min midpoint correctly', () => {
    const { min, max } = VAR_RANGES.temp_min;
    expect(normalise((min + max) / 2, 'temp_min')).toBeCloseTo(0.5, 5);
  });
});

// ── getVariableValue ──────────────────────────────────────────────────────────

describe('getVariableValue()', () => {
  it('reads rainfall from a GridCell', () => {
    const cell = mockCell({ rainfall: 42 });
    expect(getVariableValue(cell, 'rainfall')).toBe(42);
  });

  it('reads temp_max from a GridCell', () => {
    const cell = mockCell({ temp_max: 38 });
    expect(getVariableValue(cell, 'temp_max')).toBe(38);
  });

  it('reads temp_min from a GridCell', () => {
    const cell = mockCell({ temp_min: 14 });
    expect(getVariableValue(cell, 'temp_min')).toBe(14);
  });
});

// ── blendRGB ──────────────────────────────────────────────────────────────────

describe('blendRGB()', () => {
  it('returns the average of two identical colours unchanged', () => {
    const c: [number, number, number] = [100, 150, 200];
    expect(blendRGB(c, c)).toEqual(c);
  });

  it('averages two distinct colours component-wise', () => {
    const a: [number, number, number] = [0, 0, 0];
    const b: [number, number, number] = [200, 100, 50];
    const result = blendRGB(a, b);
    expect(result[0]).toBe(100);
    expect(result[1]).toBe(50);
    expect(result[2]).toBe(25);
  });

  it('keeps all components within [0, 255]', () => {
    const a: [number, number, number] = [255, 255, 255];
    const b: [number, number, number] = [0, 0, 0];
    const result = blendRGB(a, b);
    result.forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    });
  });
});

// ── bivariateColor ────────────────────────────────────────────────────────────

describe('bivariateColor()', () => {
  it('returns a 3-element RGB tuple', () => {
    const cell = mockCell();
    const result = bivariateColor(cell, 'rainfall', 'temp_max', 'blues', 'reds');
    expect(result).toHaveLength(3);
  });

  it('all components are within [0, 255]', () => {
    const cell = mockCell({ rainfall: 10, temp_max: 40 });
    const [r, g, b] = bivariateColor(cell, 'rainfall', 'temp_max', 'blues', 'reds');
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(255);
    expect(g).toBeGreaterThanOrEqual(0);
    expect(g).toBeLessThanOrEqual(255);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThanOrEqual(255);
  });

  it('produces distinct colours for distinct (x, y) combinations', () => {
    const cellLowLow  = mockCell({ rainfall: 0, temp_max: 20 });
    const cellHighHigh = mockCell({ rainfall: 50, temp_max: 45 });
    const colorLL  = bivariateColor(cellLowLow,   'rainfall', 'temp_max', 'blues', 'reds');
    const colorHH  = bivariateColor(cellHighHigh, 'rainfall', 'temp_max', 'blues', 'reds');
    // The two colours should differ in at least one channel
    const different = colorLL.some((v, i) => v !== colorHH[i]);
    expect(different).toBe(true);
  });
});

// ── CompositeOverlayStore ─────────────────────────────────────────────────────

import { useCompositeOverlayStore } from '../../../core/state/compositeOverlayStore';

describe('CompositeOverlayStore', () => {
  beforeEach(() => {
    useCompositeOverlayStore.getState().reset();
  });

  // Req 39.3 — Layer Stack panel with individual opacity sliders
  it('initial state has one color_fill overlay', () => {
    const { overlays } = useCompositeOverlayStore.getState();
    expect(overlays).toHaveLength(1);
    expect(overlays[0].channel).toBe('color_fill');
  });

  // Req 39.1 — Up to 3 variables simultaneously
  it('addOverlay adds up to 3 entries', () => {
    const store = useCompositeOverlayStore.getState();
    store.addOverlay({ variable: 'temp_max', channel: 'contours', opacity: 0.8, visible: true, colormap: 'plasma' });
    store.addOverlay({ variable: 'temp_min', channel: 'arrows',   opacity: 0.6, visible: true, colormap: 'viridis' });
    expect(useCompositeOverlayStore.getState().overlays).toHaveLength(3);
  });

  it('addOverlay does not exceed 3 overlays', () => {
    const store = useCompositeOverlayStore.getState();
    store.addOverlay({ variable: 'temp_max', channel: 'contours', opacity: 0.8, visible: true, colormap: 'plasma' });
    store.addOverlay({ variable: 'temp_min', channel: 'arrows',   opacity: 0.6, visible: true, colormap: 'viridis' });
    // Attempt a 4th (should be ignored; channel constraint also blocks, but test count)
    store.addOverlay({ variable: 'rainfall', channel: 'color_fill', opacity: 0.5, visible: true, colormap: 'imd_rain' });
    expect(useCompositeOverlayStore.getState().overlays).toHaveLength(3);
  });

  it('removeOverlay removes the correct entry', () => {
    const store = useCompositeOverlayStore.getState();
    store.addOverlay({ variable: 'temp_max', channel: 'contours', opacity: 0.8, visible: true, colormap: 'plasma' });
    const slotIdToRemove = useCompositeOverlayStore.getState().overlays[1].slotId;
    store.removeOverlay(slotIdToRemove);
    const overlays = useCompositeOverlayStore.getState().overlays;
    expect(overlays).toHaveLength(1);
    expect(overlays.every((o) => o.slotId !== slotIdToRemove)).toBe(true);
  });

  // Req 39.2 — Individual opacity sliders
  it('setOpacity clamps to [0, 1]', () => {
    const store = useCompositeOverlayStore.getState();
    const slotId = store.overlays[0].slotId;
    store.setOpacity(slotId, 1.5);
    expect(useCompositeOverlayStore.getState().overlays[0].opacity).toBe(1);
    store.setOpacity(slotId, -0.5);
    expect(useCompositeOverlayStore.getState().overlays[0].opacity).toBe(0);
  });

  it('setOpacity sets exact value within [0, 1]', () => {
    const store = useCompositeOverlayStore.getState();
    const slotId = store.overlays[0].slotId;
    store.setOpacity(slotId, 0.45);
    expect(useCompositeOverlayStore.getState().overlays[0].opacity).toBeCloseTo(0.45, 5);
  });

  // Z-order controls
  it('swapZOrder exchanges zOrder between two slots', () => {
    const store = useCompositeOverlayStore.getState();
    store.addOverlay({ variable: 'temp_max', channel: 'contours', opacity: 0.8, visible: true, colormap: 'plasma' });
    const [a, b] = useCompositeOverlayStore.getState().overlays;
    const zOrderA = a.zOrder;
    const zOrderB = b.zOrder;
    store.swapZOrder(a.slotId, b.slotId);
    const updated = useCompositeOverlayStore.getState().overlays;
    expect(updated.find((o) => o.slotId === a.slotId)!.zOrder).toBe(zOrderB);
    expect(updated.find((o) => o.slotId === b.slotId)!.zOrder).toBe(zOrderA);
  });

  it('moveUp increases a slot z-order above its current neighbour', () => {
    const store = useCompositeOverlayStore.getState();
    store.addOverlay({ variable: 'temp_max', channel: 'contours', opacity: 0.8, visible: true, colormap: 'plasma' });
    const sorted = [...useCompositeOverlayStore.getState().overlays].sort((a, b) => a.zOrder - b.zOrder);
    const bottom = sorted[0];
    const top = sorted[1];
    const bottomZOrder = bottom.zOrder;
    const topZOrder = top.zOrder;
    store.moveUp(bottom.slotId);
    const updated = useCompositeOverlayStore.getState().overlays;
    expect(updated.find((o) => o.slotId === bottom.slotId)!.zOrder).toBe(topZOrder);
    expect(updated.find((o) => o.slotId === top.slotId)!.zOrder).toBe(bottomZOrder);
  });

  it('moveDown decreases a slot z-order below its current neighbour', () => {
    const store = useCompositeOverlayStore.getState();
    store.addOverlay({ variable: 'temp_max', channel: 'contours', opacity: 0.8, visible: true, colormap: 'plasma' });
    const sorted = [...useCompositeOverlayStore.getState().overlays].sort((a, b) => a.zOrder - b.zOrder);
    const bottom = sorted[0];
    const top = sorted[1];
    store.moveDown(top.slotId);
    const updated = useCompositeOverlayStore.getState().overlays;
    expect(updated.find((o) => o.slotId === top.slotId)!.zOrder).toBe(bottom.zOrder);
    expect(updated.find((o) => o.slotId === bottom.slotId)!.zOrder).toBe(top.zOrder);
  });

  it('toggleVisibility flips the visible flag', () => {
    const store = useCompositeOverlayStore.getState();
    const slotId = store.overlays[0].slotId;
    expect(store.overlays[0].visible).toBe(true);
    store.toggleVisibility(slotId);
    expect(useCompositeOverlayStore.getState().overlays[0].visible).toBe(false);
    store.toggleVisibility(slotId);
    expect(useCompositeOverlayStore.getState().overlays[0].visible).toBe(true);
  });

  // Req 39.4 — Bivariate mode
  it('setBivariateMode updates the flag', () => {
    const store = useCompositeOverlayStore.getState();
    expect(store.bivariateMode).toBe(false);
    store.setBivariateMode(true);
    expect(useCompositeOverlayStore.getState().bivariateMode).toBe(true);
  });

  it('updateBivariateConfig patches only specified fields', () => {
    const store = useCompositeOverlayStore.getState();
    const original = { ...store.bivariateConfig };
    store.updateBivariateConfig({ variableX: 'temp_min' });
    const updated = useCompositeOverlayStore.getState().bivariateConfig;
    expect(updated.variableX).toBe('temp_min');
    expect(updated.variableY).toBe(original.variableY); // unchanged
  });

  it('reset restores to default single color_fill overlay', () => {
    const store = useCompositeOverlayStore.getState();
    store.addOverlay({ variable: 'temp_max', channel: 'contours', opacity: 0.8, visible: true, colormap: 'plasma' });
    store.setBivariateMode(true);
    store.reset();
    const { overlays, bivariateMode } = useCompositeOverlayStore.getState();
    expect(overlays).toHaveLength(1);
    expect(bivariateMode).toBe(false);
  });

  it('prevents duplicate channels in the stack', () => {
    const store = useCompositeOverlayStore.getState();
    // color_fill already in default state
    store.addOverlay({ variable: 'temp_max', channel: 'color_fill', opacity: 0.8, visible: true, colormap: 'plasma' });
    expect(useCompositeOverlayStore.getState().overlays).toHaveLength(1);
  });
});
