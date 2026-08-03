import { renderToStaticMarkup } from 'react-dom/server';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AUDIT_CASES } from './fixtures/globeFirstViewportAudit';
import {
  DETERMINISTIC_VISUAL_BASELINE_STATE,
  VisualBaselineHarness,
} from './VisualBaselineHarness';

afterEach(cleanup);

const TEST_ID_BY_CONTROL = {
  header: 'header',
  'globe-viewport': 'globe-viewport',
  'show-panels': 'show-panels',
  timeline: 'timeline',
  drawer: 'drawer',
  'data-disclosure': 'data-disclosure',
} as const;

describe('VisualBaselineHarness', () => {
  it('renders every Task 0.1 audit case identically on repeated renders', () => {
    for (const auditCase of AUDIT_CASES) {
      const first = renderToStaticMarkup(<VisualBaselineHarness auditCase={auditCase} />);
      const second = renderToStaticMarkup(<VisualBaselineHarness auditCase={auditCase} />);

      expect(first, auditCase.id).toBe(second);
      expect(first).toContain(`data-intro="${DETERMINISTIC_VISUAL_BASELINE_STATE.intro}"`);
      expect(first).toContain(`data-polling="${DETERMINISTIC_VISUAL_BASELINE_STATE.polling}"`);
      expect(first).toContain(`data-imagery="${DETERMINISTIC_VISUAL_BASELINE_STATE.imagery}"`);
      expect(first).toContain(DETERMINISTIC_VISUAL_BASELINE_STATE.date);
      expect(first).not.toMatch(/https?:\/\//);
    }
  });

  it('uses the audited control bounds while replacing WebGL with fixed imagery', () => {
    for (const auditCase of AUDIT_CASES) {
      const result = render(<VisualBaselineHarness auditCase={auditCase} />);

      for (const [controlName, contract] of Object.entries(auditCase.controls)) {
        const testId = TEST_ID_BY_CONTROL[controlName as keyof typeof TEST_ID_BY_CONTROL];
        const control = screen.getByTestId(testId);
        expect(control.style.left, `${auditCase.id} ${controlName} left`).toBe(`${contract.expected.x}px`);
        expect(control.style.top, `${auditCase.id} ${controlName} top`).toBe(`${contract.expected.y}px`);
        expect(control.style.width, `${auditCase.id} ${controlName} width`).toBe(`${contract.expected.width}px`);
        expect(control.style.height, `${auditCase.id} ${controlName} height`).toBe(`${contract.expected.height}px`);
      }

      expect(screen.getByTestId('deterministic-globe')).toHaveAttribute('data-imagery', 'fixed-css');
      result.unmount();
    }
  });
});
