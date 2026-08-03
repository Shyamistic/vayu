import type { CSSProperties } from 'react';
import {
  AUDIT_CASES,
  type AuditCase,
  type ControlContract,
} from './fixtures/globeFirstViewportAudit';

/**
 * Test-only visual state used for repeatable browser/manual captures. It is not
 * imported by the production entry point, so it cannot alter application defaults.
 */
export const DETERMINISTIC_VISUAL_BASELINE_STATE = Object.freeze({
  date: '2025-06-15',
  intro: 'disabled',
  polling: 'disabled',
  imagery: 'fixed-css',
} as const);

export const VISUAL_BASELINE_CASES = AUDIT_CASES;

export interface VisualBaselineHarnessProps {
  auditCase: AuditCase;
}

function controlStyle(control: ControlContract): CSSProperties {
  const { x, y, width, height } = control.expected;
  return {
    position: 'absolute',
    left: x,
    top: y,
    width,
    height,
    boxSizing: 'border-box',
  };
}

function FixedGlobe({ auditCase }: { auditCase: AuditCase }) {
  const region = auditCase.state === 'region-change' ? 'North-East India' : 'Pilot overview';

  return (
    <div
      className="visual-baseline-globe"
      data-testid="deterministic-globe"
      data-imagery={DETERMINISTIC_VISUAL_BASELINE_STATE.imagery}
      aria-label={`Fixed globe imagery for ${region}`}
      style={{
        width: '100%',
        height: '100%',
        background: 'radial-gradient(circle at 52% 46%, #2563eb 0 16%, #0f766e 17% 24%, #06101f 50%)',
        color: '#e2f7ff',
        display: 'grid',
        placeItems: 'center',
        font: '600 12px/1 ui-monospace, monospace',
      }}
    >
      {region} · {DETERMINISTIC_VISUAL_BASELINE_STATE.date}
    </div>
  );
}

/** Renders an audit case without timers, requests, WebGL, or date-derived inputs. */
export function VisualBaselineHarness({ auditCase }: VisualBaselineHarnessProps) {
  const { viewport, controls, state } = auditCase;
  const isFocused = state === 'focused-globe';

  return (
    <main
      data-testid="visual-baseline-harness"
      data-audit-case={auditCase.id}
      data-intro={DETERMINISTIC_VISUAL_BASELINE_STATE.intro}
      data-polling={DETERMINISTIC_VISUAL_BASELINE_STATE.polling}
      data-imagery={DETERMINISTIC_VISUAL_BASELINE_STATE.imagery}
      data-date={DETERMINISTIC_VISUAL_BASELINE_STATE.date}
      style={{
        position: 'relative',
        width: viewport.width,
        height: viewport.height,
        overflow: 'hidden',
        background: '#060a16',
        color: '#e5e7eb',
      }}
    >
      {!isFocused && controls.header && (
        <header data-testid="header" style={{ ...controlStyle(controls.header), background: '#0b1220', padding: '18px 24px' }}>
          MAUSAM · stable visual baseline · {DETERMINISTIC_VISUAL_BASELINE_STATE.date}
        </header>
      )}
      <section data-testid="globe-viewport" style={controlStyle(controls['globe-viewport'])}>
        <FixedGlobe auditCase={auditCase} />
      </section>
      {isFocused && controls['show-panels'] && (
        <button data-testid="show-panels" type="button" style={controlStyle(controls['show-panels'])}>Show panels</button>
      )}
      {!isFocused && controls.timeline && (
        <footer data-testid="timeline" style={{ ...controlStyle(controls.timeline), background: '#101827', padding: '12px 16px' }}>
          Fixed timeline · {DETERMINISTIC_VISUAL_BASELINE_STATE.date}
        </footer>
      )}
      {controls.drawer && (
        <aside data-testid="drawer" style={{ ...controlStyle(controls.drawer), background: '#111827', padding: 16 }}>
          Deterministic data surface
        </aside>
      )}
      {controls['data-disclosure'] && (
        <div data-testid="data-disclosure" style={{ ...controlStyle(controls['data-disclosure']), background: '#3f2b05', padding: 8 }}>
          {state === 'error-data' ? 'Fixed request error' : 'Fixed empty response'}
        </div>
      )}
    </main>
  );
}
