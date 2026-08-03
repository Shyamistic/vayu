/**
 * Unit tests for useKeyboardShortcuts pure utilities.
 *
 * Validates: Requirements 48.1, 58.1, 58.3, 58.4
 */

import { describe, it, expect } from 'vitest';
import { test } from '@fast-check/vitest';
import * as fc from 'fast-check';
import {
  parseShortcutKey,
  matchesShortcut,
  isInputElement,
  DASHBOARD_SHORTCUTS,
} from './useKeyboardShortcuts';

// ── parseShortcutKey ──────────────────────────────────────────────────────────

describe('parseShortcutKey', () => {
  it('parses a plain letter key', () => {
    const { key, modifiers } = parseShortcutKey('R');
    expect(key).toBe('r');
    expect(modifiers.ctrl).toBeUndefined();
    expect(modifiers.shift).toBeUndefined();
  });

  it('parses Ctrl+K', () => {
    const { key, modifiers } = parseShortcutKey('Ctrl+K');
    expect(key).toBe('k');
    expect(modifiers.ctrl).toBe(true);
  });

  it('parses Ctrl+S', () => {
    const { key, modifiers } = parseShortcutKey('Ctrl+S');
    expect(key).toBe('s');
    expect(modifiers.ctrl).toBe(true);
  });

  it('parses Space → " "', () => {
    const { key } = parseShortcutKey('Space');
    expect(key).toBe(' ');
  });

  it('parses ArrowUp unchanged', () => {
    const { key } = parseShortcutKey('ArrowUp');
    expect(key).toBe('ArrowUp');
  });

  it('parses "?" as plain key', () => {
    const { key, modifiers } = parseShortcutKey('?');
    expect(key).toBe('?');
    expect(Object.keys(modifiers).length).toBe(0);
  });
});

// ── matchesShortcut ───────────────────────────────────────────────────────────

function makeEvent(
  key: string,
  mods: { ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean } = {},
) {
  return {
    key,
    ctrlKey: mods.ctrlKey ?? false,
    shiftKey: mods.shiftKey ?? false,
    altKey: mods.altKey ?? false,
    metaKey: mods.metaKey ?? false,
  };
}

describe('matchesShortcut', () => {
  it('matches plain letter key case-insensitively', () => {
    expect(matchesShortcut(makeEvent('R'), 'r')).toBe(true);
    expect(matchesShortcut(makeEvent('r'), 'r')).toBe(true);
  });

  it('matches Ctrl+K correctly', () => {
    expect(matchesShortcut(makeEvent('k', { ctrlKey: true }), 'Ctrl+K')).toBe(true);
  });

  it('does not match Ctrl+K without Ctrl modifier', () => {
    expect(matchesShortcut(makeEvent('k'), 'Ctrl+K')).toBe(false);
  });

  it('does not match Ctrl+K with extra shift modifier', () => {
    expect(matchesShortcut(makeEvent('k', { ctrlKey: true, shiftKey: true }), 'Ctrl+K')).toBe(false);
  });

  it('matches Space', () => {
    expect(matchesShortcut(makeEvent(' '), 'Space')).toBe(true);
  });

  it('matches ArrowUp', () => {
    expect(matchesShortcut(makeEvent('ArrowUp'), 'ArrowUp')).toBe(true);
  });

  it('does not match a different key', () => {
    expect(matchesShortcut(makeEvent('t'), 'r')).toBe(false);
  });

  it('matches "?" shortcut key', () => {
    expect(matchesShortcut(makeEvent('?'), '?')).toBe(true);
  });

  it('matches "1" digit key', () => {
    expect(matchesShortcut(makeEvent('1'), '1')).toBe(true);
  });

  it('does not match digit "1" against "2"', () => {
    expect(matchesShortcut(makeEvent('2'), '1')).toBe(false);
  });
});

// ── isInputElement ────────────────────────────────────────────────────────────

describe('isInputElement', () => {
  it('returns false for null', () => {
    expect(isInputElement(null)).toBe(false);
  });

  it('returns true for <input>', () => {
    const input = document.createElement('input');
    expect(isInputElement(input)).toBe(true);
  });

  it('returns true for <textarea>', () => {
    const textarea = document.createElement('textarea');
    expect(isInputElement(textarea)).toBe(true);
  });

  it('returns true for <select>', () => {
    const select = document.createElement('select');
    expect(isInputElement(select)).toBe(true);
  });

  it('returns false for <div>', () => {
    const div = document.createElement('div');
    expect(isInputElement(div)).toBe(false);
  });

  it('returns true for contentEditable element', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    // Use setAttribute to ensure jsdom reflects the attribute correctly
    div.setAttribute('contenteditable', 'true');
    expect(isInputElement(div)).toBe(true);
    document.body.removeChild(div);
  });
});

// ── DASHBOARD_SHORTCUTS coverage ─────────────────────────────────────────────

describe('DASHBOARD_SHORTCUTS', () => {
  it('includes Ctrl+K shortcut', () => {
    const found = DASHBOARD_SHORTCUTS.find((s) => s.key === 'Ctrl+K');
    expect(found).toBeDefined();
    expect(found?.category).toBe('Platform');
  });

  it('includes "?" shortcut', () => {
    const found = DASHBOARD_SHORTCUTS.find((s) => s.key === '?');
    expect(found).toBeDefined();
  });

  it('includes shortcuts for R, T, M variables', () => {
    const keys = DASHBOARD_SHORTCUTS.map((s) => s.key.toLowerCase());
    expect(keys).toContain('r');
    expect(keys).toContain('t');
    expect(keys).toContain('m');
  });

  it('includes shortcuts for forecast days 1-7', () => {
    for (let d = 1; d <= 7; d++) {
      const found = DASHBOARD_SHORTCUTS.find((s) => s.key === String(d));
      expect(found).toBeDefined();
    }
  });

  it('includes Space shortcut for animation', () => {
    const found = DASHBOARD_SHORTCUTS.find((s) => s.key === 'Space');
    expect(found).toBeDefined();
    expect(found?.category).toBe('Playback');
  });

  it('includes Ctrl+S shortcut', () => {
    const found = DASHBOARD_SHORTCUTS.find((s) => s.key === 'Ctrl+S');
    expect(found).toBeDefined();
  });

  it('has no duplicate keys', () => {
    const keys = DASHBOARD_SHORTCUTS.map((s) => s.key);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });
});

// ── Property-Based Tests ──────────────────────────────────────────────────────

/**
 * Property 19: Keyboard Shortcut Mapping Correctness
 *
 * For any registered shortcut key in DASHBOARD_SHORTCUTS:
 *   1. A synthetic event that exactly matches that key's combination returns true.
 *   2. A synthetic event with a *different* key (but otherwise valid) returns false.
 *   3. A synthetic event with an incorrect modifier combination returns false.
 *
 * **Validates: Requirements 48.1**
 */
describe('Property 19: Keyboard Shortcut Mapping Correctness', () => {
  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Build a synthetic keyboard-event-like object that perfectly matches a
   * given shortcut descriptor's key string.
   */
  function makeSyntheticEvent(shortcutKey: string) {
    const { key: parsedKey, modifiers } = parseShortcutKey(shortcutKey);
    // Re-serialise the parsed key back to a real KeyboardEvent.key value.
    // parseShortcutKey normalises ' ' and lower-cases single chars.
    const eventKey = parsedKey;
    return {
      key: eventKey,
      ctrlKey: modifiers.ctrl ?? false,
      shiftKey: modifiers.shift ?? false,
      altKey: modifiers.alt ?? false,
      metaKey: modifiers.meta ?? false,
    };
  }

  // Arbitrary that picks a random shortcut from DASHBOARD_SHORTCUTS.
  const shortcutArb = fc.constantFrom(...DASHBOARD_SHORTCUTS);

  // Arbitrary for a modifier-free printable ASCII letter that is not a
  // single-character key present in DASHBOARD_SHORTCUTS, so we can build
  // "different key" events without accidental collisions.
  const registeredSingleCharKeys = new Set(
    DASHBOARD_SHORTCUTS
      .map((shortcut) => parseShortcutKey(shortcut.key).key)
      .filter((key) => key.length === 1),
  );

  /** Arbitrary for a single letter key NOT registered as a shortcut. */
  const unregisteredLetterArb = fc
    .integer({ min: 97, max: 122 }) // 'a'–'z'
    .map((code) => String.fromCharCode(code))
    .filter((ch) => !registeredSingleCharKeys.has(ch));

  // ── Sub-properties ─────────────────────────────────────────────────────────

  /**
   * 19a: Exact match — for any shortcut, the perfectly-matching synthetic
   * event returns true from matchesShortcut.
   */
  test.prop([shortcutArb], { numRuns: 100 })(
    '19a: exact synthetic event matches its shortcut key',
    (shortcut) => {
      const event = makeSyntheticEvent(shortcut.key);
      return matchesShortcut(event, shortcut.key) === true;
    },
  );

  /**
   * 19b: Wrong key — for any shortcut that maps to a single character,
   * substituting an unregistered letter key returns false.
   */
  test.prop(
    [
      shortcutArb.filter((s) => {
        const { key } = parseShortcutKey(s.key);
        return key.length === 1 && key !== ' ';
      }),
      unregisteredLetterArb,
    ],
    { numRuns: 100 },
  )(
    '19b: event with a different key does not match the shortcut',
    (shortcut, differentKey) => {
      const { modifiers } = parseShortcutKey(shortcut.key);
      const event = {
        key: differentKey,
        ctrlKey: modifiers.ctrl ?? false,
        shiftKey: modifiers.shift ?? false,
        altKey: modifiers.alt ?? false,
        metaKey: modifiers.meta ?? false,
      };
      return matchesShortcut(event, shortcut.key) === false;
    },
  );

  /**
   * 19c: Wrong modifier — for any shortcut that does NOT require Ctrl,
   * adding the Ctrl modifier to an otherwise-correct event returns false
   * (spurious modifier causes mismatch).
   */
  test.prop(
    [
      shortcutArb.filter((s) => {
        const { modifiers } = parseShortcutKey(s.key);
        return !(modifiers.ctrl ?? false);
      }),
    ],
    { numRuns: 100 },
  )(
    '19c: adding an unexpected Ctrl modifier causes a non-match',
    (shortcut) => {
      const base = makeSyntheticEvent(shortcut.key);
      const eventWithExtraCtrl = { ...base, ctrlKey: true };
      return matchesShortcut(eventWithExtraCtrl, shortcut.key) === false;
    },
  );

  /**
   * 19d: No cross-triggering — for any two *distinct* shortcuts A and B,
   * the event that exactly matches A does not match B.
   */
  test.prop(
    [
      fc
        .tuple(
          fc.integer({ min: 0, max: DASHBOARD_SHORTCUTS.length - 1 }),
          fc.integer({ min: 0, max: DASHBOARD_SHORTCUTS.length - 1 }),
        )
        .filter(([i, j]) => i !== j),
    ],
    { numRuns: 200 },
  )(
    '19d: exact event for shortcut A does not match shortcut B',
    ([indexA, indexB]) => {
      const shortcutA = DASHBOARD_SHORTCUTS[indexA];
      const shortcutB = DASHBOARD_SHORTCUTS[indexB];
      const eventForA = makeSyntheticEvent(shortcutA.key);
      // The event that perfectly matches A should NOT match B (different shortcut).
      return matchesShortcut(eventForA, shortcutB.key) === false;
    },
  );
});
