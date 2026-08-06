/**
 * Guards the invariant that makes mounting mock-backed panels acceptable:
 * every panel rendered in the app declares where its numbers come from, and any
 * panel without a real data source is visibly labelled.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProvenanceBadge, FeaturePanel } from './ProvenanceBadge';
import { PANEL_PROVENANCE, PROVENANCE_LABEL, getProvenance, isDemo } from './registry';

const FEATURE_PANELS_SRC = join(__dirname, '..', 'FeaturePanels.tsx');

/** Panel ids actually mounted, read from the container source. */
function mountedPanelIds(): string[] {
  const src = readFileSync(FEATURE_PANELS_SRC, 'utf-8');
  return [...src.matchAll(/panelId="([A-Za-z0-9_]+)"/g)].map((m) => m[1]);
}

describe('provenance registry', () => {
  it('gives every entry a concrete source', () => {
    for (const [id, entry] of Object.entries(PANEL_PROVENANCE)) {
      expect(entry.id, `${id}.id must match its key`).toBe(id);
      expect(entry.source.trim().length, `${id} must name a source`).toBeGreaterThan(0);
      expect(entry.label.trim().length, `${id} must have a label`).toBeGreaterThan(0);
    }
  });

  it('requires a caveat note on every demo panel', () => {
    // A "Demo / simulated" badge alone does not say WHY. Without the note the
    // viewer cannot tell whether the data is missing, synthetic, or illustrative.
    for (const [id, entry] of Object.entries(PANEL_PROVENANCE)) {
      if (entry.provenance !== 'demo') continue;
      expect(entry.note?.trim().length ?? 0, `${id} is demo and must explain why`)
        .toBeGreaterThan(0);
    }
  });

  it('has a registry entry for every panel mounted in FeaturePanels', () => {
    const mounted = mountedPanelIds();
    expect(mounted.length, 'expected FeaturePanels to mount panels').toBeGreaterThan(15);
    const missing = mounted.filter((id) => !getProvenance(id));
    expect(missing, 'mounted panels missing a provenance declaration').toEqual([]);
  });

  it('does not silently drop an unknown panel id', () => {
    expect(getProvenance('NoSuchPanel')).toBeUndefined();
    expect(isDemo('NoSuchPanel')).toBe(false);
  });
});

describe('ProvenanceBadge', () => {
  it('labels a mock-backed panel as simulated', () => {
    render(<ProvenanceBadge panelId="LightningDetection" />);
    const badge = screen.getByTestId('provenance-LightningDetection');
    expect(badge).toHaveAttribute('data-provenance', 'demo');
    expect(badge.textContent).toBe(PROVENANCE_LABEL.demo);
    // The caveat must be reachable, not just the class name.
    expect(badge.getAttribute('title')).toContain('No lightning observation feed');
  });

  it('distinguishes model-derived panels from demo ones', () => {
    render(<ProvenanceBadge panelId="WatershedAnalysis" />);
    const badge = screen.getByTestId('provenance-WatershedAnalysis');
    expect(badge).toHaveAttribute('data-provenance', 'derived');
    expect(badge.textContent).not.toBe(PROVENANCE_LABEL.demo);
  });

  it('renders nothing for an unregistered panel rather than inventing a label', () => {
    const { container } = render(<ProvenanceBadge panelId="Nope" />);
    expect(container.firstChild).toBeNull();
  });

  it('FeaturePanel pairs the title with the badge', () => {
    render(
      <FeaturePanel panelId="OceanCoastal">
        <div>content</div>
      </FeaturePanel>,
    );
    expect(screen.getByText('Ocean & Coastal')).toBeInTheDocument();
    expect(screen.getByTestId('provenance-OceanCoastal')).toHaveAttribute(
      'data-provenance', 'demo',
    );
  });
});
