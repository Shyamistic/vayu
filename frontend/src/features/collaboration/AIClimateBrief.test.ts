/**
 * Unit tests for AIClimateBrief pure functions.
 * Requirements: 64.1, 64.2, 64.3, 64.4
 */
import { describe, it, expect } from 'vitest';
import {
  mean,
  max,
  pctAbove,
  formatDate,
  buildRainfallOutlook,
  buildTemperatureOutlook,
  buildHazardHighlight,
  buildRecommendedActions,
  buildHeadline,
  generateClimateBrief,
  exportBriefAsEmailHtml,
} from './AIClimateBrief';
import type { GridCell } from '../../types';

// ── Fixture helpers ───────────────────────────────────────────────────────────

function makeCell(overrides: Partial<GridCell> = {}): GridCell {
  return {
    lat: 15.0,
    lon: 74.0,
    node_idx: 0,
    rainfall: 5,
    temp_max: 32,
    temp_min: 22,
    rainfall_uncertainty: 1,
    temp_max_uncertainty: 0.5,
    temp_min_uncertainty: 0.5,
    ...overrides,
  };
}

function makeCells(count: number, overrides: Partial<GridCell> = {}): GridCell[] {
  return Array.from({ length: count }, (_, i) =>
    makeCell({ node_idx: i, lat: 15 + i * 0.25, ...overrides }),
  );
}

// ── Utility function tests ────────────────────────────────────────────────────

describe('mean()', () => {
  it('returns 0 for empty array', () => {
    expect(mean([])).toBe(0);
  });
  it('computes correct mean', () => {
    expect(mean([2, 4, 6])).toBeCloseTo(4);
  });
});

describe('max()', () => {
  it('returns 0 for empty array', () => {
    expect(max([])).toBe(0);
  });
  it('returns maximum value', () => {
    expect(max([10, 5, 20, 3])).toBe(20);
  });
});

describe('pctAbove()', () => {
  it('returns 0 for empty array', () => {
    expect(pctAbove([], 10)).toBe(0);
  });
  it('returns 50 when half exceed threshold', () => {
    expect(pctAbove([5, 15], 10)).toBeCloseTo(50);
  });
  it('returns 0 when none exceed threshold', () => {
    expect(pctAbove([5, 8], 10)).toBe(0);
  });
  it('returns 100 when all exceed threshold', () => {
    expect(pctAbove([20, 30], 10)).toBe(100);
  });
});

describe('formatDate()', () => {
  it('formats ISO date as readable string', () => {
    const result = formatDate('2025-06-15');
    expect(result).toContain('2025');
    expect(result).toContain('Jun');
    expect(result).toContain('15');
  });
  it('returns original string for invalid date', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });
});

// ── Rainfall outlook tests ────────────────────────────────────────────────────

describe('buildRainfallOutlook()', () => {
  it('returns dry conditions message for low rainfall', () => {
    const cells = makeCells(5, { rainfall: 1 });
    const result = buildRainfallOutlook(cells);
    expect(result.toLowerCase()).toContain('dry');
  });

  it('returns light-to-moderate message for rainfall 5–14mm', () => {
    const cells = makeCells(5, { rainfall: 8 });
    const result = buildRainfallOutlook(cells);
    expect(result).toMatch(/light|moderate/i);
  });

  it('mentions heavy rainfall when >30% cells exceed 64.5mm', () => {
    const cells = [
      ...makeCells(4, { rainfall: 70 }), // 4 heavy
      makeCell({ node_idx: 99, rainfall: 10 }), // 1 normal
    ];
    const result = buildRainfallOutlook(cells);
    expect(result).toMatch(/heavy/i);
  });
});

// ── Temperature outlook tests ─────────────────────────────────────────────────

describe('buildTemperatureOutlook()', () => {
  it('mentions extreme heat when >20% cells exceed 40°C', () => {
    const cells = [
      ...makeCells(4, { temp_max: 42, temp_min: 28 }),
      makeCell({ node_idx: 99, temp_max: 32, temp_min: 22 }),
    ];
    const result = buildTemperatureOutlook(cells);
    expect(result).toMatch(/extreme heat/i);
  });

  it('mentions mild for cool conditions', () => {
    const cells = makeCells(5, { temp_max: 26, temp_min: 18 });
    const result = buildTemperatureOutlook(cells);
    expect(result).toMatch(/mild/i);
  });

  it('includes average temperatures in output', () => {
    const cells = makeCells(4, { temp_max: 35, temp_min: 24 });
    const result = buildTemperatureOutlook(cells);
    expect(result).toContain('35');
    expect(result).toContain('24');
  });
});

// ── Hazard highlight tests ────────────────────────────────────────────────────

describe('buildHazardHighlight()', () => {
  it('uses active hazard descriptions when provided', () => {
    const cells = makeCells(5, { rainfall: 5 });
    const hazards = [{ type: 'flood' as const, severity: 'emergency' as const, description: 'Brahmaputra in spate' }];
    const result = buildHazardHighlight(cells, hazards);
    expect(result).toContain('Brahmaputra in spate');
    expect(result).toContain('Emergency');
  });

  it('detects flood risk from cell data when no hazards provided', () => {
    const cells = makeCells(5, { rainfall: 80 }); // all above heavy threshold
    const result = buildHazardHighlight(cells, []);
    expect(result).toMatch(/flood|heavy rainfall/i);
  });

  it('returns no-hazards message for calm conditions', () => {
    const cells = makeCells(5, { rainfall: 5, temp_max: 30 });
    const result = buildHazardHighlight(cells, []);
    expect(result).toMatch(/no significant hazards/i);
  });
});

// ── Recommended actions tests ─────────────────────────────────────────────────

describe('buildRecommendedActions()', () => {
  it('returns at least one action', () => {
    const cells = makeCells(5);
    const actions = buildRecommendedActions(cells, []);
    expect(actions.length).toBeGreaterThanOrEqual(1);
  });

  it('includes flood actions when peak rainfall is extreme', () => {
    const cells = makeCells(5, { rainfall: 130 });
    const actions = buildRecommendedActions(cells, []);
    expect(actions.some((a) => a.toLowerCase().includes('flood'))).toBe(true);
  });

  it('includes heat action when avg temp exceeds 40°C', () => {
    const cells = makeCells(5, { temp_max: 43, temp_min: 30 });
    const actions = buildRecommendedActions(cells, []);
    expect(actions.some((a) => a.toLowerCase().includes('heat'))).toBe(true);
  });
});

// ── Headline tests ────────────────────────────────────────────────────────────

describe('buildHeadline()', () => {
  it('includes emergency label for emergency hazard', () => {
    const cells = makeCells(5);
    const hazards = [{ type: 'cyclone' as const, severity: 'emergency' as const, description: 'Cyclone imminent' }];
    const headline = buildHeadline(cells, 'western_ghats', hazards);
    expect(headline).toMatch(/emergency/i);
  });

  it('includes region name in headline', () => {
    const cells = makeCells(5);
    const headline = buildHeadline(cells, 'north_east_india', []);
    expect(headline).toContain('North-East India');
  });

  it('mentions heavy rainfall when peak >64.5mm', () => {
    const cells = makeCells(5, { rainfall: 120 });
    const headline = buildHeadline(cells, 'central_india', []);
    expect(headline).toMatch(/heavy rainfall|extremely heavy/i);
  });
});

// ── generateClimateBrief tests ────────────────────────────────────────────────

describe('generateClimateBrief()', () => {
  const cells = makeCells(10, { rainfall: 25, temp_max: 34, temp_min: 24 });
  const brief = generateClimateBrief({
    cells,
    region: 'western_ghats',
    forecastDate: '2025-06-15',
    activeHazards: [],
  });

  it('returns correct region and forecastDate', () => {
    expect(brief.region).toBe('western_ghats');
    expect(brief.forecastDate).toBe('2025-06-15');
  });

  it('sections contain non-empty strings', () => {
    const { sections } = brief;
    expect(sections.headline.length).toBeGreaterThan(5);
    expect(sections.keySummary.length).toBeGreaterThan(10);
    expect(sections.rainfallOutlook.length).toBeGreaterThan(10);
    expect(sections.temperatureOutlook.length).toBeGreaterThan(10);
    expect(sections.hazardHighlight.length).toBeGreaterThan(10);
    expect(sections.recommendedActions.length).toBeGreaterThan(0);
  });

  it('keySummary mentions region label', () => {
    expect(brief.sections.keySummary).toContain('Western Ghats');
  });

  it('keySummary mentions average rainfall', () => {
    expect(brief.sections.keySummary).toMatch(/25\.0\s*mm/);
  });

  it('generatedAt is a valid ISO date', () => {
    expect(() => new Date(brief.sections.generatedAt).toISOString()).not.toThrow();
  });
});

// ── exportBriefAsEmailHtml tests ──────────────────────────────────────────────

describe('exportBriefAsEmailHtml()', () => {
  const cells = makeCells(5, { rainfall: 20, temp_max: 33, temp_min: 23 });
  const brief = generateClimateBrief({
    cells,
    region: 'indo_gangetic_plain',
    forecastDate: '2025-07-01',
  });

  it('returns a string starting with DOCTYPE', () => {
    const html = exportBriefAsEmailHtml(brief);
    expect(html.trimStart()).toMatch(/^<!DOCTYPE html>/i);
  });

  it('includes region label', () => {
    const html = exportBriefAsEmailHtml(brief);
    expect(html).toContain('Indo-Gangetic Plain');
  });

  it('includes MAUSAM branding', () => {
    const html = exportBriefAsEmailHtml(brief);
    expect(html).toContain('MAUSAM');
  });

  it('includes all section headings', () => {
    const html = exportBriefAsEmailHtml(brief);
    expect(html).toContain('Rainfall Outlook');
    expect(html).toContain('Temperature Outlook');
    expect(html).toContain('Hazard Highlight');
    expect(html).toContain('Recommended Actions');
  });

  it('includes the brief headline text', () => {
    const html = exportBriefAsEmailHtml(brief);
    expect(html).toContain(brief.sections.headline);
  });

  it('is valid HTML structure with closing tags', () => {
    const html = exportBriefAsEmailHtml(brief);
    expect(html).toContain('</html>');
    expect(html).toContain('</body>');
  });
});
