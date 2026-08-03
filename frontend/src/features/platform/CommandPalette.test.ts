/**
 * Unit tests for CommandPalette pure utilities.
 *
 * Validates: Requirements 48.1, 48.2, 58.1, 58.3
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { test } from '@fast-check/vitest';
import * as fc from 'fast-check';
import {
  levenshteinDistance,
  fuzzyScore,
  fuzzyFilter,
  recordRecentAction,
  getRecentActions,
  clearRecentActions,
} from './CommandPalette';

// ── levenshteinDistance ───────────────────────────────────────────────────────

describe('levenshteinDistance', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshteinDistance('rainfall', 'rainfall')).toBe(0);
  });

  it('returns string length for empty other string', () => {
    expect(levenshteinDistance('rain', '')).toBe(4);
    expect(levenshteinDistance('', 'rain')).toBe(4);
  });

  it('returns 0 for two empty strings', () => {
    expect(levenshteinDistance('', '')).toBe(0);
  });

  it('returns 1 for single substitution', () => {
    expect(levenshteinDistance('rain', 'rein')).toBe(1);
  });

  it('returns 1 for single insertion', () => {
    expect(levenshteinDistance('rai', 'rain')).toBe(1);
  });

  it('returns 1 for single deletion', () => {
    expect(levenshteinDistance('rain', 'rin')).toBe(1);
  });

  it('handles typical typo distance', () => {
    expect(levenshteinDistance('layar', 'layer')).toBe(1);
  });
});

// ── fuzzyScore ────────────────────────────────────────────────────────────────

describe('fuzzyScore', () => {
  it('returns 1 for empty query', () => {
    expect(fuzzyScore('', 'Rainfall Layer')).toBe(1);
  });

  it('returns 1 for exact substring match (case-insensitive)', () => {
    expect(fuzzyScore('rain', 'Rainfall Layer')).toBe(1);
    expect(fuzzyScore('Rainfall', 'Rainfall Layer')).toBe(1);
  });

  it('returns 1 for exact substring match', () => {
    expect(fuzzyScore('layer', 'Rainfall Layer')).toBe(1);
  });

  it('returns 0.6 for subsequence match', () => {
    // "rnl" is a subsequence of "rainfall"
    expect(fuzzyScore('rnl', 'rainfall')).toBe(0.6);
  });

  it('returns 0.4 for edit-distance-1 word match', () => {
    // "layar" is within edit distance 1 of "layer"
    expect(fuzzyScore('layar', 'Rainfall Layer')).toBe(0.4);
  });

  it('returns 0 for completely unrelated query', () => {
    expect(fuzzyScore('xyz123', 'Rainfall Layer')).toBe(0);
  });

  it('is case-insensitive for substring matching', () => {
    expect(fuzzyScore('RAIN', 'rainfall layer')).toBe(1);
  });
});

// ── fuzzyFilter ───────────────────────────────────────────────────────────────

describe('fuzzyFilter', () => {
  const items = [
    { id: '1', name: 'Rainfall Layer',         type: 'layer' as const },
    { id: '2', name: 'Max Temperature Layer',  type: 'layer' as const },
    { id: '3', name: 'Wind Layer',              type: 'layer' as const },
    { id: '4', name: 'Western Ghats',           type: 'location' as const },
    { id: '5', name: 'Flood Risk Panel',        type: 'feature' as const },
  ];

  it('returns all items with score 1 for empty query', () => {
    const results = fuzzyFilter(items, '');
    expect(results.length).toBe(items.length);
    expect(results.every((r) => r._score === 1)).toBe(true);
  });

  it('filters by substring match', () => {
    const results = fuzzyFilter(items, 'layer');
    expect(results.length).toBe(3);
    expect(results.every((r) => r.name.toLowerCase().includes('layer'))).toBe(true);
  });

  it('sorts by descending score', () => {
    const results = fuzzyFilter(items, 'rain');
    // Rainfall Layer has substring match (score 1.0) and should be first
    expect(results[0].id).toBe('1');
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]._score).toBeGreaterThanOrEqual(results[i]._score);
    }
  });

  it('excludes items with zero score', () => {
    const results = fuzzyFilter(items, 'xyzzy_never_match_99');
    expect(results.length).toBe(0);
  });

  it('finds item by substring of length 2', () => {
    const results = fuzzyFilter(items, 'gh');
    // "Western Ghats" contains "gh"
    expect(results.some((r) => r.name === 'Western Ghats')).toBe(true);
  });

  it('preserves extra properties on matched items', () => {
    const results = fuzzyFilter(items, 'wind');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe('3');
    expect(results[0].type).toBe('layer');
  });
});

// ── Property-Based Tests ───────────────────────────────────────────────────────
/**
 * Property 20: Command Palette Search Completeness
 *
 * For any item in a collection and any substring of length ≥2 extracted from
 * that item's name, `fuzzyFilter` must include that item in the results
 * (score > 0). This validates both direct substring matching and fuzzy
 * variants within edit distance 1.
 *
 * Validates: Requirements 58.1, 58.3
 */

describe('Property 20: Command Palette Search Completeness', () => {
  // Arbitrary for a non-empty name string (printable ASCII, no control chars)
  const printableName = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{1,28}[A-Za-z0-9]$/)
    .filter((s) => s.trim().length >= 3); // must be long enough to extract a ≥2 char substring

  // Given a name, pick a contiguous substring of length ≥2
  const nameWithSubstring = printableName.chain((name) =>
    fc.tuple(
      fc.constant(name),
      // start index in [0, name.length - 2]
      fc.integer({ min: 0, max: name.length - 2 }).chain((start) =>
        fc.integer({ min: start + 2, max: name.length }).map((end) => ({
          start,
          end,
        }))
      ),
    ).map(([n, { start, end }]) => ({ name: n, substring: n.slice(start, end) }))
  ).filter(({ substring }) => substring.trim().length >= 2);

  test.prop(
    [nameWithSubstring],
    { numRuns: 200 },
  )(
    'exact substring of length ≥2 from an item name always yields that item in results',
    ({ name, substring }) => {
      const items = [{ id: 'target', name, type: 'feature' as const }];
      const results = fuzzyFilter(items, substring);

      // The item must appear in results with score > 0
      const found = results.find((r) => r.id === 'target');
      return found !== undefined && found._score > 0;
    },
  );

  test.prop(
    [nameWithSubstring],
    { numRuns: 200 },
  )(
    'exact substring match always receives score 1.0',
    ({ name, substring }) => {
      // Substring is literally contained in the lowercased name — score must be 1.0
      const score = fuzzyScore(substring, name);
      return score === 1.0;
    },
  );

  test.prop(
    [
      // An item name containing only a single word of ≥3 chars
      fc.stringMatching(/^[A-Za-z]{3,12}$/).chain((word) =>
        // A fuzzy variant: mutate one character (substitution) → edit distance 1
        fc.integer({ min: 0, max: word.length - 1 }).map((pos) => {
          const chars = word.split('');
          // Replace char at pos with a letter that differs from original
          const original = chars[pos].toLowerCase();
          const replacement = original === 'a' ? 'e' : 'a';
          chars[pos] = replacement;
          return { word: word.toLowerCase(), variant: chars.join('') };
        })
      ).filter(({ word, variant }) => word !== variant),
    ],
    { numRuns: 200 },
  )(
    'single-character edit-distance-1 variant of a word in an item name returns score ≥ 0.4',
    ({ word, variant }) => {
      // Item whose name is exactly the word
      const items = [{ id: 'target', name: word, type: 'feature' as const }];
      const results = fuzzyFilter(items, variant);

      // The item must appear (edit distance 1 ≤ 1 → score 0.4)
      const found = results.find((r) => r.id === 'target');
      return found !== undefined && found._score >= 0.4;
    },
  );

  test.prop(
    [
      // A collection of 1–5 named items
      fc.array(
        fc.record({
          id: fc.uuid(),
          name: fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{2,20}$/).filter((s) => s.trim().length >= 3),
          type: fc.constantFrom('layer', 'feature', 'location') as fc.Arbitrary<'layer' | 'feature' | 'location'>,
        }),
        { minLength: 1, maxLength: 5 },
      ),
      fc.integer({ min: 0 }), // index selector
    ],
    { numRuns: 150 },
  )(
    'for any item in a collection, a 2-char substring from its name guarantees that item is found',
    (items, indexSeed) => {
      // Deduplicate ids so we can reliably look up the target
      const unique = items.filter(
        (item, idx, arr) => arr.findIndex((o) => o.id === item.id) === idx,
      );
      if (unique.length === 0) return true;

      const target = unique[indexSeed % unique.length];
      const name = target.name;

      // Pick first 2-char substring from the target name (guaranteed length ≥ 3)
      const substring = name.slice(0, 2);
      if (substring.trim().length < 2) return true; // skip edge case whitespace

      const results = fuzzyFilter(unique, substring);
      const found = results.find((r) => r.id === target.id);
      return found !== undefined && found._score > 0;
    },
  );
});

// ── Recent Actions ────────────────────────────────────────────────────────────

describe('recent actions', () => {
  beforeEach(() => {
    clearRecentActions();
  });

  it('records an action', () => {
    recordRecentAction('loc-western_ghats');
    expect(getRecentActions()).toContain('loc-western_ghats');
  });

  it('keeps most recent first', () => {
    recordRecentAction('item-a');
    recordRecentAction('item-b');
    expect(getRecentActions()[0]).toBe('item-b');
  });

  it('deduplicates on re-record (moves to front)', () => {
    recordRecentAction('item-a');
    recordRecentAction('item-b');
    recordRecentAction('item-a');
    const recent = getRecentActions();
    expect(recent[0]).toBe('item-a');
    expect(recent.filter((id) => id === 'item-a').length).toBe(1);
  });

  it('caps at 5 entries', () => {
    for (let i = 0; i < 10; i++) {
      recordRecentAction(`item-${i}`);
    }
    expect(getRecentActions().length).toBeLessThanOrEqual(5);
  });
});
