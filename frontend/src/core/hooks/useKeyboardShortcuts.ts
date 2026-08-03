/**
 * useKeyboardShortcuts — Keyboard shortcut registration system.
 *
 * Provides a central hook for registering and managing keyboard shortcuts
 * throughout the dashboard. Shortcuts are ignored when the user is typing
 * in an input, textarea, or contentEditable element.
 *
 * Exports pure functions for shortcut matching (testable without React).
 *
 * Validates: Requirements 48.1, 58.1, 58.2, 58.3, 58.4
 */

import { useEffect, useCallback } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

/** A descriptor for a single keyboard shortcut. */
export interface ShortcutDescriptor {
  /** Display key label, e.g. "R", "Space", "Ctrl+K", "?" */
  key: string;
  /** Human-readable description for the shortcut reference overlay */
  description: string;
  /** Optional category for grouping in the shortcut overlay */
  category?: ShortcutCategory;
}

/** Categories for grouping shortcuts in the reference overlay */
export type ShortcutCategory =
  | 'Variables'
  | 'Forecast'
  | 'Playback'
  | 'Navigation'
  | 'Platform'
  | 'Layers'
  | 'Export';

/** Registered shortcut entry combining descriptor with action */
export interface ShortcutEntry extends ShortcutDescriptor {
  /** Callback fired when the shortcut is triggered */
  action: () => void;
  /**
   * Whether this shortcut should fire even when an input element is focused.
   * Defaults to false.
   */
  allowInInputs?: boolean;
}

/**
 * Modifier keys that can be part of a shortcut combination.
 * Stored as a bitmask-style record for fast comparison.
 */
export interface ModifierState {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

// ── Pure Utility Functions ────────────────────────────────────────────────────

/**
 * Parse a shortcut key string into its component parts.
 *
 * Supports formats:
 *  - "R"         → { key: "r", modifiers: {} }
 *  - "Ctrl+K"    → { key: "k", modifiers: { ctrl: true } }
 *  - "Ctrl+S"    → { key: "s", modifiers: { ctrl: true } }
 *  - "Shift+?"   → { key: "?", modifiers: { shift: true } }
 *  - "Space"     → { key: " ", modifiers: {} }
 *  - "ArrowUp"   → { key: "ArrowUp", modifiers: {} }
 *
 * Returns a normalised canonical form used for matching.
 */
export function parseShortcutKey(raw: string): {
  key: string;
  modifiers: Partial<ModifierState>;
} {
  const parts = raw.split('+');
  const modifiers: Partial<ModifierState> = {};
  let baseKey = '';

  for (const part of parts) {
    switch (part.toLowerCase()) {
      case 'ctrl':
      case 'control':
        modifiers.ctrl = true;
        break;
      case 'shift':
        modifiers.shift = true;
        break;
      case 'alt':
        modifiers.alt = true;
        break;
      case 'meta':
      case 'cmd':
      case 'command':
        modifiers.meta = true;
        break;
      case 'space':
        baseKey = ' ';
        break;
      default:
        baseKey = part;
    }
  }

  // Normalise single characters to lowercase for case-insensitive matching
  if (baseKey.length === 1 && baseKey !== ' ') {
    baseKey = baseKey.toLowerCase();
  }

  return { key: baseKey, modifiers };
}

/**
 * Check whether a KeyboardEvent matches a given shortcut key string.
 *
 * Pure function — fully testable without DOM.
 *
 * Validates: Requirements 48.1, 58.1
 */
export function matchesShortcut(
  event: {
    key: string;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
    metaKey: boolean;
  },
  shortcutKey: string,
): boolean {
  const { key: parsedKey, modifiers } = parseShortcutKey(shortcutKey);

  // Normalise the event key for comparison
  const eventKey =
    event.key === ' '
      ? ' '
      : event.key.length === 1
        ? event.key.toLowerCase()
        : event.key;

  if (eventKey !== parsedKey) return false;

  // Check modifier keys — only the explicitly required modifiers need to match
  if ((modifiers.ctrl ?? false) !== event.ctrlKey) return false;
  if ((modifiers.shift ?? false) !== event.shiftKey) return false;
  if ((modifiers.alt ?? false) !== event.altKey) return false;
  if ((modifiers.meta ?? false) !== event.metaKey) return false;

  return true;
}

/**
 * Check if a DOM element is a text-input-like element where shortcuts should
 * be suppressed by default to avoid interfering with typing.
 */
export function isInputElement(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) return false;

  const tagName = (target as Element).tagName.toLowerCase();
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
    return true;
  }
  // Check via property (browsers) or attribute (jsdom / older environments)
  const el = target as HTMLElement;
  if (el.isContentEditable) return true;
  const ceAttr = el.getAttribute('contenteditable');
  if (ceAttr !== null && ceAttr !== 'false') return true;

  return false;
}

// ── Default Shortcut Definitions ──────────────────────────────────────────────

/**
 * The canonical shortcut map for the MAUSAM dashboard.
 * Each entry is a ShortcutDescriptor — actions are bound at hook call time.
 *
 * Validates: Requirements 58.1, 58.2 (display reference overlay)
 */
export const DASHBOARD_SHORTCUTS: ReadonlyArray<ShortcutDescriptor> = [
  // Variables
  { key: 'r', description: 'Switch to Rainfall layer', category: 'Variables' },
  { key: 't', description: 'Switch to Temperature (max) layer', category: 'Variables' },
  { key: 'm', description: 'Switch to Wind / Wind speed layer', category: 'Variables' },
  // Forecast days
  { key: '1', description: 'Forecast Day 1', category: 'Forecast' },
  { key: '2', description: 'Forecast Day 2', category: 'Forecast' },
  { key: '3', description: 'Forecast Day 3', category: 'Forecast' },
  { key: '4', description: 'Forecast Day 4', category: 'Forecast' },
  { key: '5', description: 'Forecast Day 5', category: 'Forecast' },
  { key: '6', description: 'Forecast Day 6', category: 'Forecast' },
  { key: '7', description: 'Forecast Day 7', category: 'Forecast' },
  // Playback
  { key: 'Space', description: 'Play / Pause temporal animation', category: 'Playback' },
  // Navigation
  { key: 'ArrowUp', description: 'Tilt globe up', category: 'Navigation' },
  { key: 'ArrowDown', description: 'Tilt globe down', category: 'Navigation' },
  { key: 'ArrowLeft', description: 'Rotate globe left', category: 'Navigation' },
  { key: 'ArrowRight', description: 'Rotate globe right', category: 'Navigation' },
  { key: 'Tab', description: 'Cycle through active panels', category: 'Navigation' },
  // Platform
  { key: 'Ctrl+K', description: 'Open Command Palette', category: 'Platform' },
  { key: 'Ctrl+S', description: 'Save / Export current view', category: 'Export' },
  { key: '?', description: 'Show keyboard shortcut reference', category: 'Platform' },
];

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * useKeyboardShortcuts — registers an array of keyboard shortcuts as a
 * window-level keydown listener.
 *
 * @param shortcuts - Array of ShortcutEntry objects pairing descriptors with actions.
 * @param enabled   - Master switch; when false no handlers are registered (default: true).
 *
 * Validates: Requirements 48.1, 58.1, 58.3, 58.4
 */
export function useKeyboardShortcuts(
  shortcuts: ShortcutEntry[],
  enabled = true,
): void {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      for (const shortcut of shortcuts) {
        if (!shortcut.allowInInputs && isInputElement(event.target)) continue;
        if (matchesShortcut(event, shortcut.key)) {
          // Prevent browser defaults for handled shortcuts (e.g. Ctrl+S save dialog)
          event.preventDefault();
          shortcut.action();
          // Stop after first match
          break;
        }
      }
    },
    [shortcuts],
  );

  useEffect(() => {
    if (!enabled) return;
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled, handleKeyDown]);
}

export default useKeyboardShortcuts;
