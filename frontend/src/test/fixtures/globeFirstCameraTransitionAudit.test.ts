import { describe, expect, it } from 'vitest';
import {
  CAMERA_AUDIT_LIMITATIONS,
  CAMERA_TRANSITION_TABLE,
  REQUIRED_ACTIVE_CAMERA_API_CALLS,
  REQUIRED_CAMERA_TRANSITION_IDS,
  cameraTransitionById,
} from './globeFirstCameraTransitionAudit';

describe('globe-first camera-transition audit fixture', () => {
  it('maps every requested caller once and retains the fields needed for a controller policy', () => {
    expect(CAMERA_TRANSITION_TABLE).toHaveLength(REQUIRED_CAMERA_TRANSITION_IDS.length);
    expect(new Set(CAMERA_TRANSITION_TABLE.map(({ id }) => id))).toEqual(new Set(REQUIRED_CAMERA_TRANSITION_IDS));
    for (const entry of CAMERA_TRANSITION_TABLE) {
      expect(entry.caller).not.toHaveLength(0); expect(entry.trigger).not.toHaveLength(0);
      expect(entry.source).not.toHaveLength(0); expect(entry.currentPriority).not.toHaveLength(0);
      expect(entry.cancellation).not.toHaveLength(0); expect(entry.completion).not.toHaveLength(0);
    }
  });

  it('accounts for every active Cesium transition API and preserves current cancellation behavior', () => {
    const calls = new Set(CAMERA_TRANSITION_TABLE.flatMap(({ cameraCalls }) => cameraCalls));
    expect(calls).toEqual(new Set(REQUIRED_ACTIVE_CAMERA_API_CALLS));
    expect(cameraTransitionById('intro-overview').cancellation).toMatch(/cancelFlight/);
    expect(cameraTransitionById('region-sync').cancellation).toMatch(/unconditionally cancels the active flight/);
    expect(cameraTransitionById('guided-tour').cancellation).toMatch(/does not cancel an already-running flight/);
  });

  it('records the unresolved manual-input and duplicate-tour ownership conflicts', () => {
    expect(cameraTransitionById('pre-render-auto-pitch').manualInteractionBehavior).toMatch(/not detected/);
    expect(cameraTransitionById('touch-inspection').manualInteractionBehavior).toMatch(/no manual ref\/cooldown/);
    expect(cameraTransitionById('guided-tour').conflicts).toContain('Two mounted GuidedTour instances can emit duplicate step-zero requests.');
    expect(CAMERA_AUDIT_LIMITATIONS).toHaveLength(2);
  });
});
