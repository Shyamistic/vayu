/**
 * SplitViewContainer — Unit Tests
 *
 * Tests the split-view comparison mode including:
 * - Draggable divider constrained to [20%, 80%]
 * - Camera synchronization between viewports
 * - Label rendering with scenario parameters
 * - Layout width computation
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SplitViewContainer, {
  clampDividerPosition,
  computeLeftWidth,
  syncCamera,
  MIN_DIVIDER_POSITION,
  MAX_DIVIDER_POSITION,
  DEFAULT_DIVIDER_POSITION,
} from './SplitViewContainer';
import type { SplitViewCameraState } from './SplitViewContainer';
import type { ScenarioResponse } from '../../types';

// ── Pure function tests ──────────────────────────────────────────────────────

describe('clampDividerPosition', () => {
  it('returns value unchanged when within [0.2, 0.8]', () => {
    expect(clampDividerPosition(0.5)).toBe(0.5);
    expect(clampDividerPosition(0.2)).toBe(0.2);
    expect(clampDividerPosition(0.8)).toBe(0.8);
  });

  it('clamps values below 0.2 to 0.2', () => {
    expect(clampDividerPosition(0)).toBe(MIN_DIVIDER_POSITION);
    expect(clampDividerPosition(0.1)).toBe(MIN_DIVIDER_POSITION);
    expect(clampDividerPosition(-0.5)).toBe(MIN_DIVIDER_POSITION);
  });

  it('clamps values above 0.8 to 0.8', () => {
    expect(clampDividerPosition(1.0)).toBe(MAX_DIVIDER_POSITION);
    expect(clampDividerPosition(0.95)).toBe(MAX_DIVIDER_POSITION);
    expect(clampDividerPosition(2.0)).toBe(MAX_DIVIDER_POSITION);
  });
});

describe('computeLeftWidth', () => {
  it('computes correct pixel width from position and total width', () => {
    expect(computeLeftWidth(0.5, 1000)).toBe(500);
    expect(computeLeftWidth(0.2, 1000)).toBe(200);
    expect(computeLeftWidth(0.8, 1000)).toBe(800);
  });

  it('clamps position before computing width', () => {
    // Position below min should use MIN
    expect(computeLeftWidth(0.0, 1000)).toBe(200);
    // Position above max should use MAX
    expect(computeLeftWidth(1.0, 1000)).toBe(800);
  });

  it('rounds to nearest pixel', () => {
    expect(computeLeftWidth(0.333, 1000)).toBe(333);
    expect(computeLeftWidth(0.666, 1000)).toBe(666);
  });
});

describe('syncCamera', () => {
  it('produces an identical camera state from source', () => {
    const source: SplitViewCameraState = {
      latitude: 20.5,
      longitude: 78.9,
      altitude: 5_000_000,
      heading: 45,
      pitch: -30,
      roll: 0,
    };

    const synced = syncCamera(source);

    expect(synced.latitude).toBe(source.latitude);
    expect(synced.longitude).toBe(source.longitude);
    expect(synced.altitude).toBe(source.altitude);
    expect(synced.heading).toBe(source.heading);
    expect(synced.pitch).toBe(source.pitch);
    expect(synced.roll).toBe(source.roll);
  });

  it('returns a new object (not the same reference)', () => {
    const source: SplitViewCameraState = {
      latitude: 14.0,
      longitude: 75.0,
      altitude: 1_100_000,
      heading: 0,
      pitch: -45,
      roll: 0,
    };

    const synced = syncCamera(source);
    expect(synced).not.toBe(source);
    expect(synced).toEqual(source);
  });
});

// ── Component rendering tests ────────────────────────────────────────────────

describe('SplitViewContainer', () => {
  const baselineView = <div data-testid="baseline-content">Baseline Globe</div>;
  const scenarioView = <div data-testid="scenario-content">Scenario Globe</div>;

  it('renders both viewports with baseline and scenario content', () => {
    render(
      <SplitViewContainer
        baselineView={baselineView}
        scenarioView={scenarioView}
      />,
    );

    expect(screen.getByTestId('baseline-content')).toBeDefined();
    expect(screen.getByTestId('scenario-content')).toBeDefined();
  });

  it('renders the "Baseline" label on the left viewport', () => {
    render(
      <SplitViewContainer
        baselineView={baselineView}
        scenarioView={scenarioView}
      />,
    );

    expect(screen.getByTestId('split-view-label-baseline').textContent).toBe('Baseline');
  });

  it('renders "Scenario" label with default text when no scenario data', () => {
    render(
      <SplitViewContainer
        baselineView={baselineView}
        scenarioView={scenarioView}
        scenarioData={null}
      />,
    );

    expect(screen.getByTestId('split-view-label-scenario').textContent).toBe('Scenario');
  });

  it('renders scenario label with type and magnitude when data provided', () => {
    const mockScenario: ScenarioResponse = {
      scenario_type: 'temperature_offset',
      magnitude: 2.5,
      baseline: {},
      scenario: {},
      delta: {},
      hotspots: [],
      summary: {},
      clamped: false,
      computation_time_s: 0.5,
    };

    render(
      <SplitViewContainer
        baselineView={baselineView}
        scenarioView={scenarioView}
        scenarioData={mockScenario}
      />,
    );

    const label = screen.getByTestId('split-view-label-scenario').textContent;
    expect(label).toContain('temperature offset');
    expect(label).toContain('+2.5');
  });

  it('renders the draggable divider with separator role', () => {
    render(
      <SplitViewContainer
        baselineView={baselineView}
        scenarioView={scenarioView}
      />,
    );

    const divider = screen.getByTestId('split-view-divider');
    expect(divider.getAttribute('role')).toBe('separator');
    expect(divider.getAttribute('aria-orientation')).toBe('vertical');
    expect(divider.getAttribute('aria-valuenow')).toBe('50');
    expect(divider.getAttribute('aria-valuemin')).toBe('20');
    expect(divider.getAttribute('aria-valuemax')).toBe('80');
  });

  it('starts with default divider position at 50%', () => {
    render(
      <SplitViewContainer
        baselineView={baselineView}
        scenarioView={scenarioView}
      />,
    );

    const leftViewport = screen.getByTestId('split-view-left');
    expect(leftViewport.style.width).toBe('50%');
  });

  it('renders the split-view container with correct test-id', () => {
    render(
      <SplitViewContainer
        baselineView={baselineView}
        scenarioView={scenarioView}
      />,
    );

    expect(screen.getByTestId('split-view-container')).toBeDefined();
  });

  it('applies custom className to the container', () => {
    render(
      <SplitViewContainer
        baselineView={baselineView}
        scenarioView={scenarioView}
        className="custom-split"
      />,
    );

    const container = screen.getByTestId('split-view-container');
    expect(container.className).toContain('custom-split');
  });

  it('formats negative magnitude correctly in scenario label', () => {
    const mockScenario: ScenarioResponse = {
      scenario_type: 'rainfall_scaling',
      magnitude: -0.3,
      baseline: {},
      scenario: {},
      delta: {},
      hotspots: [],
      summary: {},
      clamped: false,
      computation_time_s: 0.2,
    };

    render(
      <SplitViewContainer
        baselineView={baselineView}
        scenarioView={scenarioView}
        scenarioData={mockScenario}
      />,
    );

    const label = screen.getByTestId('split-view-label-scenario').textContent;
    expect(label).toContain('rainfall scaling');
    expect(label).toContain('-0.3');
  });
});

// ── Constants tests ──────────────────────────────────────────────────────────

describe('SplitView constants', () => {
  it('has correct constraint boundaries', () => {
    expect(MIN_DIVIDER_POSITION).toBe(0.2);
    expect(MAX_DIVIDER_POSITION).toBe(0.8);
    expect(DEFAULT_DIVIDER_POSITION).toBe(0.5);
  });

  it('default position is within valid range', () => {
    expect(DEFAULT_DIVIDER_POSITION).toBeGreaterThanOrEqual(MIN_DIVIDER_POSITION);
    expect(DEFAULT_DIVIDER_POSITION).toBeLessThanOrEqual(MAX_DIVIDER_POSITION);
  });
});
