/**
 * useA11y.ts — Accessibility hook providing:
 *
 *   - Reduced-motion detection (OS preference sync)
 *   - High-contrast mode detection
 *   - Focus management utilities (capture, restore, cycle)
 *   - Screen reader announcement helper
 *   - Keyboard navigation helpers
 *
 * This hook is designed to be composable and side-effect free unless
 * explicitly called. It reads OS media queries and optionally syncs state
 * changes in real time.
 *
 * Validates: Requirements 87.4, 88.5 (WCAG 2.1 AA compliance)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getFocusableElements,
  announceToScreenReader,
  prefersReducedMotion,
  prefersHighContrast,
  moveFocusTo,
} from '../../features/platform/Accessibility';

// ── Types ─────────────────────────────────────────────────────────────────────

export type AnnouncePoliteness = 'polite' | 'assertive';

export interface FocusManagerOptions {
  /**
   * When true, wraps focus: Tab on last element moves to first, and
   * Shift+Tab on first moves to last.
   * Defaults to false (useful for toolbars/menubars, not modals).
   */
  wrap?: boolean;
  /**
   * When true, prevents focus from leaving the container entirely.
   * Required for modal dialogs.
   */
  trap?: boolean;
}

export interface UseA11yReturn {
  // ── Preferences ────────────────────────────────────────────────────────────
  /** True when the OS/browser prefers reduced motion. */
  reducedMotion: boolean;
  /** True when forced-colors / high-contrast mode is active. */
  highContrast: boolean;

  // ── Screen Reader Announcements ────────────────────────────────────────────
  /**
   * Announce a message to screen readers.
   * Use 'polite' for non-urgent updates, 'assertive' for critical alerts.
   */
  announce: (message: string, politeness?: AnnouncePoliteness) => void;

  // ── Focus Management ───────────────────────────────────────────────────────
  /**
   * Ref to attach to a container element. All focus management methods
   * operate within this container.
   */
  containerRef: React.RefObject<HTMLElement | null>;
  /**
   * Move focus to the first focusable element in containerRef.
   */
  focusFirst: () => void;
  /**
   * Move focus to the last focusable element in containerRef.
   */
  focusLast: () => void;
  /**
   * Move focus to a specific element by index within the container's
   * focusable elements.
   */
  focusByIndex: (index: number) => void;
  /**
   * Capture the currently focused element and return a restore function.
   * Call restore() to move focus back to the captured element.
   */
  captureFocus: () => () => void;
  /**
   * Get all currently focusable elements within containerRef.
   */
  getFocusables: () => HTMLElement[];

  // ── Keyboard Helpers ───────────────────────────────────────────────────────
  /**
   * Returns true if the current device is primarily a keyboard/touch device
   * (detected via pointer media query). Useful for showing focus rings.
   */
  isKeyboardUser: boolean;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * useA11y — comprehensive accessibility hook.
 *
 * Provides reduced-motion and high-contrast detection, screen reader
 * announcement helpers, and focus management utilities for accessible
 * interactive components.
 *
 * Usage:
 *   const { reducedMotion, announce, containerRef, focusFirst } = useA11y();
 *
 *   // Announce data changes
 *   useEffect(() => {
 *     if (data) announce(`Loaded ${data.length} results`);
 *   }, [data, announce]);
 *
 *   // Manage focus in a panel
 *   useEffect(() => {
 *     if (panelOpen) focusFirst();
 *   }, [panelOpen, focusFirst]);
 *
 * Validates: Requirements 87.4, 88.5
 */
export function useA11y(): UseA11yReturn {
  // ── OS preference state ───────────────────────────────────────────────────
  const [reducedMotion, setReducedMotion] = useState<boolean>(
    prefersReducedMotion,
  );
  const [highContrast, setHighContrast] = useState<boolean>(
    prefersHighContrast,
  );
  const [isKeyboardUser, setIsKeyboardUser] = useState<boolean>(false);

  // Container ref for focus management
  const containerRef = useRef<HTMLElement | null>(null);

  // ── Media query listeners ─────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const motionMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
    const contrastMQ = window.matchMedia('(forced-colors: active)');
    // Coarse pointer usually means touch; absence means keyboard/mouse
    const pointerMQ = window.matchMedia('(pointer: coarse)');

    const handleMotion = (e: MediaQueryListEvent) =>
      setReducedMotion(e.matches);
    const handleContrast = (e: MediaQueryListEvent) =>
      setHighContrast(e.matches);

    motionMQ.addEventListener('change', handleMotion);
    contrastMQ.addEventListener('change', handleContrast);

    // Detect keyboard usage: switch on Tab press, revert on pointer events
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Tab') setIsKeyboardUser(true);
    };
    const handlePointerDown = () => {
      if (!pointerMQ.matches) setIsKeyboardUser(false);
    };

    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('pointerdown', handlePointerDown);

    return () => {
      motionMQ.removeEventListener('change', handleMotion);
      contrastMQ.removeEventListener('change', handleContrast);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('pointerdown', handlePointerDown);
    };
  }, []);

  // ── Screen reader announcement ────────────────────────────────────────────
  const announce = useCallback(
    (message: string, politeness: AnnouncePoliteness = 'polite') => {
      announceToScreenReader(message, politeness);
    },
    [],
  );

  // ── Focus management ──────────────────────────────────────────────────────

  const getFocusables = useCallback((): HTMLElement[] => {
    if (!containerRef.current) return [];
    return getFocusableElements(containerRef.current);
  }, []);

  const focusFirst = useCallback(() => {
    const focusables = getFocusables();
    moveFocusTo(focusables[0] ?? null);
  }, [getFocusables]);

  const focusLast = useCallback(() => {
    const focusables = getFocusables();
    moveFocusTo(focusables[focusables.length - 1] ?? null);
  }, [getFocusables]);

  const focusByIndex = useCallback(
    (index: number) => {
      const focusables = getFocusables();
      if (index < 0 || index >= focusables.length) return;
      moveFocusTo(focusables[index]);
    },
    [getFocusables],
  );

  const captureFocus = useCallback((): (() => void) => {
    const previous = document.activeElement as HTMLElement | null;
    return () => {
      moveFocusTo(previous);
    };
  }, []);

  return {
    reducedMotion,
    highContrast,
    announce,
    containerRef,
    focusFirst,
    focusLast,
    focusByIndex,
    captureFocus,
    getFocusables,
    isKeyboardUser,
  };
}

// ── Specialized sub-hooks ─────────────────────────────────────────────────────

/**
 * useReducedMotion — lightweight hook that only tracks reduced-motion preference.
 * Use this when you don't need the full useA11y surface.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(prefersReducedMotion);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return reduced;
}

/**
 * useFocusVisible — returns true when focus should be visibly indicated.
 *
 * Follows the :focus-visible CSS pseudo-class semantics: shows focus rings
 * for keyboard navigation but suppresses them for pointer (mouse/touch) input.
 *
 * @param ref - ref to the element to track focus on
 */
export function useFocusVisible(
  ref: React.RefObject<HTMLElement | null>,
): boolean {
  const [visible, setVisible] = useState(false);
  const isKeyboard = useRef(false);

  useEffect(() => {
    const handleKeyDown = () => {
      isKeyboard.current = true;
    };
    const handlePointerDown = () => {
      isKeyboard.current = false;
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    window.addEventListener('pointerdown', handlePointerDown, { capture: true });

    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
      window.removeEventListener('pointerdown', handlePointerDown, {
        capture: true,
      });
    };
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const handleFocus = () => setVisible(isKeyboard.current);
    const handleBlur = () => setVisible(false);

    el.addEventListener('focus', handleFocus);
    el.addEventListener('blur', handleBlur);

    return () => {
      el.removeEventListener('focus', handleFocus);
      el.removeEventListener('blur', handleBlur);
    };
  }, [ref]);

  return visible;
}

/**
 * useAnnounce — minimal hook that returns just the announce function.
 * Useful in components that only need to push screen reader announcements
 * without managing focus or reading motion preferences.
 */
export function useAnnounce(): (
  message: string,
  politeness?: AnnouncePoliteness,
) => void {
  return useCallback(
    (message: string, politeness: AnnouncePoliteness = 'polite') => {
      announceToScreenReader(message, politeness);
    },
    [],
  );
}

export default useA11y;
