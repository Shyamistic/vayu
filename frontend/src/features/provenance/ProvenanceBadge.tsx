/**
 * Renders a panel's declared data provenance.
 *
 * The point is that a viewer can tell, without reading code, whether a number came
 * from the model or from a placeholder. `demo` is styled to be noticed — the
 * failure mode being prevented is fabricated data reading as real output.
 */
import type React from 'react';

import { PROVENANCE_LABEL, getProvenance } from './registry';
import type { DataProvenance } from './registry';

const STYLES: Record<DataProvenance, { bg: string; fg: string; border: string }> = {
  model: { bg: 'rgba(34,197,94,0.12)', fg: '#4ade80', border: 'rgba(34,197,94,0.35)' },
  derived: { bg: 'rgba(59,130,246,0.12)', fg: '#60a5fa', border: 'rgba(59,130,246,0.35)' },
  observed: { bg: 'rgba(168,85,247,0.12)', fg: '#c084fc', border: 'rgba(168,85,247,0.35)' },
  literature: { bg: 'rgba(148,163,184,0.12)', fg: '#cbd5e1', border: 'rgba(148,163,184,0.35)' },
  // Amber, not red: it is a legitimate state, but it must not be mistaken for output.
  demo: { bg: 'rgba(245,158,11,0.16)', fg: '#fbbf24', border: 'rgba(245,158,11,0.45)' },
};

export interface ProvenanceBadgeProps {
  /** Panel id, must exist in PANEL_PROVENANCE. */
  panelId: string;
  className?: string;
}

export const ProvenanceBadge: React.FC<ProvenanceBadgeProps> = ({ panelId, className }) => {
  const entry = getProvenance(panelId);
  if (!entry) return null;

  const style = STYLES[entry.provenance];
  const tooltip = entry.note
    ? `${entry.source} — ${entry.note}`
    : entry.source;

  return (
    <span
      className={className}
      title={tooltip}
      data-testid={`provenance-${panelId}`}
      data-provenance={entry.provenance}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 7px',
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.01em',
        whiteSpace: 'nowrap',
        background: style.bg,
        color: style.fg,
        border: `1px solid ${style.border}`,
      }}
    >
      {PROVENANCE_LABEL[entry.provenance]}
    </span>
  );
};

export interface FeaturePanelProps {
  panelId: string;
  children: React.ReactNode;
  /** Override the header label; defaults to the registry label. */
  title?: string;
}

/**
 * Wraps a feature panel with its title and provenance badge, so mounting a panel
 * and declaring its provenance are the same action and cannot drift apart.
 */
export const FeaturePanel: React.FC<FeaturePanelProps> = ({ panelId, children, title }) => {
  const entry = getProvenance(panelId);
  return (
    <section
      data-panel-id={panelId}
      aria-label={title ?? entry?.label ?? panelId}
      style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>
          {title ?? entry?.label ?? panelId}
        </h3>
        <ProvenanceBadge panelId={panelId} />
      </header>
      {children}
    </section>
  );
};

export default ProvenanceBadge;
