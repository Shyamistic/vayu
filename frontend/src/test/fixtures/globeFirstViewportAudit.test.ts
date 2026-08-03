import { describe, expect, it } from 'vitest';
import {
  AUDIT_CASES,
  AUDIT_STATES,
  REGION_CHANGE_CONTRACT,
  VIDEO_WALKTHROUGHS,
  VIEWPORTS,
} from './globeFirstViewportAudit';

describe('globe-first viewport audit fixture', () => {
  it('covers every requested viewport and UI/data state with a screenshot and video path', () => {
    expect(AUDIT_CASES).toHaveLength(VIEWPORTS.length * AUDIT_STATES.length);
    expect(new Set(AUDIT_CASES.map((audit) => audit.screenshot)).size).toBe(AUDIT_CASES.length);
    expect(new Set(AUDIT_CASES.map((audit) => audit.video)).size).toBe(AUDIT_CASES.length);
    for (const audit of AUDIT_CASES) {
      expect(audit.screenshot).toMatch(/\.png$/);
      expect(audit.video).toMatch(/\.webm$/);
      expect(audit.controls['globe-viewport']).toBeDefined();
    }
  });

  it('keeps audited controls within the viewport and restores focus mode to the full globe', () => {
    for (const audit of AUDIT_CASES) {
      for (const control of Object.values(audit.controls)) {
        const { x, y, width, height } = control.expected;
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x + width).toBeLessThanOrEqual(audit.viewport.width);
        expect(y + height).toBeLessThanOrEqual(audit.viewport.height);
      }
      if (audit.state === 'focused-globe') {
        expect(audit.controls['globe-viewport'].expected).toEqual({ x: 0, y: 0, width: audit.viewport.width, height: audit.viewport.height });
      }
    }
  });

  it('defines one walkthrough per viewport and preserves the authoritative North-East bounds', () => {
    expect(VIDEO_WALKTHROUGHS).toHaveLength(VIEWPORTS.length);
    expect(REGION_CHANGE_CONTRACT.bounds).toEqual({ latMin: 22, latMax: 29.5, lonMin: 88, lonMax: 97.5 });
  });
});
