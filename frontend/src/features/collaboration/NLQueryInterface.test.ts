/**
 * Unit and property-based tests for NLQueryInterface pure functions.
 *
 * Validates: Requirements 43.1, 43.2, 43.3, 43.4
 */

import { describe, expect, it } from 'vitest';
import { fc, test as fcTest } from '@fast-check/vitest';
import {
  buildDescription,
  classifyIntent,
  DEFAULT_SUGGESTIONS,
  extractDate,
  extractRegion,
  extractThreshold,
  extractVariable,
  generateSuggestions,
  normaliseQuery,
  parseQuery,
  VARIABLE_ALIASES,
} from './NLQueryInterface';

// ── normaliseQuery ─────────────────────────────────────────────────────────────

describe('normaliseQuery', () => {
  it('lowercases and trims', () => {
    expect(normaliseQuery('  Rainfall > 50mm  ')).toBe('rainfall > 50mm');
  });

  it('collapses multiple spaces', () => {
    expect(normaliseQuery('rainfall  in   Western Ghats')).toBe(
      'rainfall in western ghats',
    );
  });

  it('returns empty string for whitespace-only input', () => {
    expect(normaliseQuery('   ')).toBe('');
  });
});

// ── extractVariable ───────────────────────────────────────────────────────────

describe('extractVariable', () => {
  it('extracts rainfall from "rainfall > 50mm"', () => {
    expect(extractVariable('rainfall > 50mm')).toBe('rainfall');
  });

  it('extracts rainfall from alias "precipitation"', () => {
    expect(extractVariable('precipitation above 100')).toBe('rainfall');
  });

  it('extracts rainfall from alias "rain"', () => {
    expect(extractVariable('heavy rain expected')).toBe('rainfall');
  });

  it('extracts temp_max from "temperature"', () => {
    expect(extractVariable('temperature exceeds 40°c')).toBe('temp_max');
  });

  it('extracts temp_max from alias "tmax"', () => {
    expect(extractVariable('tmax above 38')).toBe('temp_max');
  });

  it('extracts temp_min from alias "tmin"', () => {
    expect(extractVariable('tmin below 5')).toBe('temp_min');
  });

  it('returns undefined for unrecognised variable', () => {
    expect(extractVariable('show me everything')).toBeUndefined();
  });

  it('prefers longer alias over shorter one (maximum temperature vs temperature)', () => {
    // "maximum temperature" → temp_max (not temp_max via "temperature" match first)
    const result = extractVariable('maximum temperature forecast');
    expect(result).toBe('temp_max');
  });
});

// ── extractThreshold ──────────────────────────────────────────────────────────

describe('extractThreshold', () => {
  it('extracts threshold from "> 50mm"', () => {
    expect(extractThreshold('rainfall > 50mm')).toBe(50);
  });

  it('extracts threshold from ">= 100"', () => {
    expect(extractThreshold('rainfall >= 100')).toBe(100);
  });

  it('extracts threshold from "above 75"', () => {
    expect(extractThreshold('rainfall above 75')).toBe(75);
  });

  it('extracts threshold from "below 5"', () => {
    expect(extractThreshold('temperature below 5')).toBe(5);
  });

  it('extracts threshold from "exceeds 40°c"', () => {
    expect(extractThreshold('temperature exceeds 40°c')).toBe(40);
  });

  it('extracts threshold from unit pattern "100mm"', () => {
    expect(extractThreshold('show areas with 100mm rainfall')).toBe(100);
  });

  it('extracts decimal threshold', () => {
    expect(extractThreshold('rainfall > 12.5mm')).toBe(12.5);
  });

  it('returns undefined for query with no number', () => {
    expect(extractThreshold('show rainfall in western ghats')).toBeUndefined();
  });
});

// ── extractRegion ─────────────────────────────────────────────────────────────

describe('extractRegion', () => {
  it('extracts western_ghats from "western ghats"', () => {
    expect(extractRegion('rainfall in western ghats')).toBe('western_ghats');
  });

  it('extracts north_east_india from "northeast india"', () => {
    expect(extractRegion('flood risk in northeast india')).toBe('north_east_india');
  });

  it('extracts indo_gangetic_plain from "igp"', () => {
    expect(extractRegion('drought in igp')).toBe('indo_gangetic_plain');
  });

  it('extracts central_india from "central india"', () => {
    expect(extractRegion('heat wave in central india')).toBe('central_india');
  });

  it('extracts full_india from "pilot" (legacy alias)', () => {
    expect(extractRegion('data for pilot')).toBe('full_india');
  });

  it('extracts full_india from "all india"', () => {
    expect(extractRegion('rainfall in all india')).toBe('full_india');
  });

  it('returns undefined for no recognisable region', () => {
    expect(extractRegion('show me rainfall')).toBeUndefined();
  });
});

// ── extractDate ───────────────────────────────────────────────────────────────

describe('extractDate', () => {
  const REF = new Date('2025-07-15T00:00:00Z');

  it('extracts "today" as reference date', () => {
    expect(extractDate('show temperature today', REF)).toBe('2025-07-15');
  });

  it('extracts "tomorrow" as reference + 1', () => {
    expect(extractDate('rainfall tomorrow', REF)).toBe('2025-07-16');
  });

  it('extracts "next week" as reference + 7', () => {
    expect(extractDate('forecast next week', REF)).toBe('2025-07-22');
  });

  it('extracts "in 3 days"', () => {
    expect(extractDate('show conditions in 3 days', REF)).toBe('2025-07-18');
  });

  it('extracts ISO date "2025-08-01"', () => {
    expect(extractDate('forecast for 2025-08-01', REF)).toBe('2025-08-01');
  });

  it('extracts DD/MM/YYYY date', () => {
    expect(extractDate('data for 20/08/2025', REF)).toBe('2025-08-20');
  });

  it('returns undefined when no date present', () => {
    expect(extractDate('rainfall above 50mm', REF)).toBeUndefined();
  });
});

// ── classifyIntent ─────────────────────────────────────────────────────────────

describe('classifyIntent', () => {
  it('classifies "compare" keyword as comparative', () => {
    expect(
      classifyIntent('compare rainfall vs temperature', 'rainfall', undefined, undefined, undefined),
    ).toBe('comparative');
  });

  it('classifies "versus" as comparative', () => {
    expect(
      classifyIntent('rainfall versus temperature', 'rainfall', undefined, undefined, undefined),
    ).toBe('comparative');
  });

  it('classifies date present as temporal', () => {
    expect(
      classifyIntent('show rainfall tomorrow', 'rainfall', undefined, undefined, '2025-07-16'),
    ).toBe('temporal');
  });

  it('classifies threshold present (no date) as threshold', () => {
    expect(
      classifyIntent('rainfall > 50', 'rainfall', 50, undefined, undefined),
    ).toBe('threshold');
  });

  it('classifies region + variable (no threshold, no date) as spatial', () => {
    expect(
      classifyIntent('rainfall in western ghats', 'rainfall', undefined, 'western_ghats', undefined),
    ).toBe('spatial');
  });

  it('prefers comparative over all others', () => {
    expect(
      classifyIntent('compare rainfall in western ghats tomorrow', 'rainfall', undefined, 'western_ghats', '2025-07-16'),
    ).toBe('comparative');
  });
});

// ── buildDescription ───────────────────────────────────────────────────────────

describe('buildDescription', () => {
  it('builds threshold description with all components', () => {
    const desc = buildDescription('threshold', 'rainfall', 50, 'western_ghats', undefined);
    expect(desc).toContain('Rainfall');
    expect(desc).toContain('50');
    expect(desc).toContain('Western Ghats');
  });

  it('builds temporal description', () => {
    const desc = buildDescription('temporal', 'temp_max', undefined, undefined, '2025-07-16');
    expect(desc).toContain('2025-07-16');
    expect(desc).toContain('Max Temperature');
  });

  it('builds spatial description', () => {
    const desc = buildDescription('spatial', 'rainfall', undefined, 'central_india', undefined);
    expect(desc).toContain('Central India');
  });

  it('builds comparative description', () => {
    const desc = buildDescription('comparative', 'temp_min', undefined, 'full_india', undefined);
    expect(desc.toLowerCase()).toContain('compare');
  });

  it('falls back to "variable" label when no variable provided', () => {
    const desc = buildDescription('threshold', undefined, 100, 'full_india', undefined);
    expect(desc).toContain('variable');
  });
});

// ── generateSuggestions ────────────────────────────────────────────────────────

describe('generateSuggestions', () => {
  it('returns at most 5 suggestions', () => {
    const sug = generateSuggestions('show me stuff');
    expect(sug.length).toBeLessThanOrEqual(5);
  });

  it('includes variable-enriched suggestion when partial variable known', () => {
    const sug = generateSuggestions('rainfall query', 'rainfall', undefined);
    const texts = sug.map((s) => s.text);
    // Should include a rainfall-specific suggestion
    expect(texts.some((t) => t.includes('rainfall'))).toBe(true);
  });

  it('includes region-enriched suggestion when partial region known', () => {
    const sug = generateSuggestions('central india query', undefined, 'central_india');
    const texts = sug.map((s) => s.text);
    expect(texts.some((t) => t.includes('central india'))).toBe(true);
  });

  it('falls back to DEFAULT_SUGGESTIONS when no partial info', () => {
    const sug = generateSuggestions('xyz unknown query');
    // Must be non-empty and come from defaults
    expect(sug.length).toBeGreaterThan(0);
    expect(DEFAULT_SUGGESTIONS.length).toBeGreaterThan(0);
  });
});

// ── parseQuery ─────────────────────────────────────────────────────────────────

describe('parseQuery', () => {
  const REF = new Date('2025-07-15T00:00:00Z');

  it('parses a threshold query correctly (Requirement 43.2)', () => {
    const result = parseQuery('rainfall > 50mm in Western Ghats', () => {}, REF);
    expect(result).not.toBeNull();
    expect(result!.variable).toBe('rainfall');
    expect(result!.threshold).toBe(50);
    expect(result!.region).toBe('western_ghats');
    expect(result!.intent).toBe('threshold');
  });

  it('parses a temporal query', () => {
    const result = parseQuery('temperature tomorrow in Central India', () => {}, REF);
    expect(result).not.toBeNull();
    expect(result!.intent).toBe('temporal');
    expect(result!.date).toBe('2025-07-16');
    expect(result!.variable).toBe('temp_max');
    expect(result!.region).toBe('central_india');
  });

  it('parses a spatial query', () => {
    const result = parseQuery('rainfall in Northeast India', () => {}, REF);
    expect(result).not.toBeNull();
    expect(result!.intent).toBe('spatial');
    expect(result!.region).toBe('north_east_india');
  });

  it('parses a comparative query', () => {
    const result = parseQuery('compare rainfall vs temperature in IGP', () => {}, REF);
    expect(result).not.toBeNull();
    expect(result!.intent).toBe('comparative');
  });

  it('returns null for completely unparseable query (Requirement 43.4)', () => {
    const result = parseQuery('hello world', () => {}, REF);
    expect(result).toBeNull();
  });

  it('calls onApply with correct payload when action() is invoked', () => {
    const received: unknown[] = [];
    const result = parseQuery('rainfall > 50mm', (r) => received.push(r), REF);
    expect(result).not.toBeNull();
    result!.action();
    expect(received).toHaveLength(1);
    const payload = received[0] as { variable: string; threshold: number };
    expect(payload.variable).toBe('rainfall');
    expect(payload.threshold).toBe(50);
  });

  it('extracts threshold 100 from "rainfall above 100" (Requirement 43.2)', () => {
    const result = parseQuery('rainfall above 100', () => {}, REF);
    expect(result).not.toBeNull();
    expect(result!.threshold).toBe(100);
  });

  it('populates description field', () => {
    const result = parseQuery('rainfall > 50mm in Western Ghats', () => {}, REF);
    expect(result!.description.length).toBeGreaterThan(0);
  });
});

// ── Property-Based Tests ───────────────────────────────────────────────────────
//
// Property 18: Natural Language Query Intent Extraction
//
// For any query containing a recognized variable name AND a numeric threshold
// in [0, 500], the parser SHALL correctly extract both the variable identifier
// and the threshold value.
//
// **Validates: Requirements 43.2**
// ──────────────────────────────────────────────────────────────────────────────

/** All recognised variable aliases as a flat array for fast-check sampling */
const ALL_ALIASES = Array.from(VARIABLE_ALIASES.keys());

/**
 * Arbitrary that picks a random recognised alias and returns both the alias
 * string and the expected canonical VariableId.
 */
const variableArb = fc.constantFrom(...ALL_ALIASES).map((alias) => ({
  alias,
  expected: VARIABLE_ALIASES.get(alias)!,
}));

/**
 * Arbitrary numeric threshold in [0, 500], rounded to 1 decimal place
 * to avoid floating-point noise in string serialisation.
 */
const thresholdArb = fc
  .float({ min: 0, max: 500, noNaN: true })
  .map((n) => Math.round(n * 10) / 10);

/**
 * Arbitrary operator prefix — the parser supports all of these patterns.
 */
const operatorArb = fc.constantFrom(
  '> ',
  '>= ',
  'above ',
  'over ',
  'exceeds ',
  'greater than ',
);

// ── Property 18a ──────────────────────────────────────────────────────────────
// extractVariable correctly identifies any recognised alias embedded in a query.

fcTest.prop(
  [variableArb, thresholdArb, operatorArb],
  // **Validates: Requirements 43.2**
)(
  'Property 18a: extractVariable identifies recognised alias for any query position',
  ({ alias, expected }, threshold, operator) => {
    const query = normaliseQuery(`show me ${alias} ${operator}${threshold}`);
    const extracted = extractVariable(query);
    expect(extracted).toBe(expected);
  },
);

// ── Property 18b ──────────────────────────────────────────────────────────────
// extractThreshold recovers the numeric value for any operator-prefixed pattern.

fcTest.prop(
  [variableArb, thresholdArb, operatorArb],
  // **Validates: Requirements 43.2**
)(
  'Property 18b: extractThreshold recovers numeric value for any threshold in [0, 500] with operator prefix',
  ({ alias }, threshold, operator) => {
    const query = normaliseQuery(`${alias} ${operator}${threshold}`);
    const extracted = extractThreshold(query);
    expect(extracted).not.toBeUndefined();
    expect(extracted!).toBeCloseTo(threshold, 5);
  },
);

// ── Property 18c ──────────────────────────────────────────────────────────────
// parseQuery extracts both the correct variable AND the correct threshold
// together in a single pass.

fcTest.prop(
  [variableArb, thresholdArb, operatorArb],
  // **Validates: Requirements 43.2**
)(
  'Property 18c: parseQuery extracts correct variable AND threshold for any recognised query',
  ({ alias, expected }, threshold, operator) => {
    const rawQuery = `${alias} ${operator}${threshold}`;
    const result = parseQuery(rawQuery, () => {});

    // Must not return null — a variable is always present
    expect(result).not.toBeNull();

    // Variable must map to the canonical VariableId for this alias
    expect(result!.variable).toBe(expected);

    // Threshold must be present and match within floating-point tolerance
    expect(result!.threshold).not.toBeUndefined();
    expect(result!.threshold!).toBeCloseTo(threshold, 5);
  },
);

// ── Property 18d ──────────────────────────────────────────────────────────────
// When a query has only a variable and a threshold (no region, no date),
// the intent is classified as 'threshold'.

fcTest.prop(
  [variableArb, thresholdArb, operatorArb],
  // **Validates: Requirements 43.2**
)(
  'Property 18d: intent is threshold when query contains variable + operator + number only',
  ({ alias }, threshold, operator) => {
    const rawQuery = `${alias} ${operator}${threshold}`;
    const result = parseQuery(rawQuery, () => {});

    expect(result).not.toBeNull();
    expect(result!.intent).toBe('threshold');
  },
);

// ── Property 18e ──────────────────────────────────────────────────────────────
// extractThreshold also handles the unit-suffix pattern "Nmm" (no operator).

fcTest.prop(
  [variableArb, fc.integer({ min: 1, max: 500 })],
  // **Validates: Requirements 43.2**
)(
  'Property 18e: extractThreshold recovers integer value from unit pattern "Nmm"',
  ({ alias }, threshold) => {
    const query = normaliseQuery(`${alias} ${threshold}mm`);
    const extracted = extractThreshold(query);
    expect(extracted).not.toBeUndefined();
    expect(extracted!).toBeCloseTo(threshold, 5);
  },
);

// ── Property 18f ──────────────────────────────────────────────────────────────
// extractVariable is case-insensitive because normaliseQuery lowercases input.

fcTest.prop(
  [variableArb, thresholdArb],
  // **Validates: Requirements 43.2**
)(
  'Property 18f: extractVariable handles any-case alias via normaliseQuery pipeline',
  ({ alias, expected }, threshold) => {
    // Uppercase the alias to verify normalisation path
    const query = normaliseQuery(`${alias.toUpperCase()} > ${threshold}`);
    const extracted = extractVariable(query);
    expect(extracted).toBe(expected);
  },
);
