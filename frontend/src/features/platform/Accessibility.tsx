/**
 * Accessibility.tsx — WCAG 2.1 AA accessibility utilities.
 *
 * Provides composable, lightweight building blocks for accessible UI:
 *
 *  - FocusTrap           — traps keyboard focus inside a container (modal dialogs)
 *  - VisuallyHidden      — visually hides content while keeping it in the a11y tree
 *  - LiveRegion          — announces dynamic content changes to screen readers
 *  - CriticalLiveRegion  — assertive live region for critical state changes
 *                          (new data loaded, alert triggered, prediction updated)
 *  - SkipLink            — "skip to main content" jump link
 *  - a11y helpers        — pure utility functions for common a11y patterns
 *
 * All components follow WCAG 2.1 AA guidelines:
 *  - Focus indicators are visible (outline offsets, high contrast) — SC 2.4.7
 *  - Interactive elements have accessible names — SC 4.1.2
 *  - Dynamic content is announced via ARIA live regions — SC 4.1.3
 *  - Modal dialogs implement proper focus trapping — SC 2.1.2
 *
 * Validates: Requirements 32.4, 48.3, 48.4, 87.4, 88.5 (WCAG 2.1 AA compliance)
 */

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  createContext,
  useContext,
} from 'react';

// ── Constants ──────────────────────────────────────────────────────────────────

/**
 * CSS selector for all natively focusable elements.
 * Excludes disabled and hidden elements via :not() pseudo-classes.
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  'details > summary',
  'audio[controls]',
  'video[controls]',
  '[contenteditable]:not([contenteditable="false"])',
].join(', ');

// ── Pure A11y Helper Functions ─────────────────────────────────────────────────

/**
 * Get all currently focusable elements within a container, in DOM order.
 * Returns only elements that are visible and not hidden via aria-hidden.
 */
export function getFocusableElements(
  container: HTMLElement,
): HTMLElement[] {
  const all = Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  );
  return all.filter((el) => {
    // Skip aria-hidden subtrees
    if (el.getAttribute('aria-hidden') === 'true') return false;
    let node: HTMLElement | null = el;
    while (node && node !== container) {
      if (node.getAttribute('aria-hidden') === 'true') return false;
      if (getComputedStyle(node).display === 'none') return false;
      if (getComputedStyle(node).visibility === 'hidden') return false;
      node = node.parentElement;
    }
    return true;
  });
}

/**
 * Generate a unique, stable ID string with an optional prefix.
 * Relies on a simple counter — deterministic within a single session.
 */
let _idCounter = 0;
export function generateA11yId(prefix = 'a11y'): string {
  _idCounter += 1;
  return `${prefix}-${_idCounter}`;
}

/**
 * Check whether reduced-motion is preferred by the OS.
 * Pure function — reads the media query synchronously.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Check whether high-contrast mode is active.
 */
export function prefersHighContrast(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(forced-colors: active)').matches;
}

/**
 * Move focus to the given element, scrolling it into view if needed.
 * Safe to call with null (no-op).
 */
export function moveFocusTo(element: HTMLElement | null): void {
  if (!element) return;
  element.focus({ preventScroll: false });
}

/**
 * Announce a message to screen readers using a hidden live region.
 * Creates a temporary element, appends the message, then removes it.
 *
 * @param message   - Text to announce
 * @param politeness - 'polite' (default) or 'assertive'
 */
export function announceToScreenReader(
  message: string,
  politeness: 'polite' | 'assertive' = 'polite',
): void {
  if (typeof document === 'undefined') return;

  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', politeness);
  el.setAttribute('aria-atomic', 'true');

  // Must be visually hidden but present in the a11y tree
  Object.assign(el.style, {
    position: 'absolute',
    width: '1px',
    height: '1px',
    padding: '0',
    margin: '-1px',
    overflow: 'hidden',
    clip: 'rect(0,0,0,0)',
    whiteSpace: 'nowrap',
    border: '0',
  });

  document.body.appendChild(el);

  // Delay setting text so the element is registered by AT before the message
  requestAnimationFrame(() => {
    el.textContent = message;
    // Clean up after AT has time to read
    setTimeout(() => {
      if (document.body.contains(el)) {
        document.body.removeChild(el);
      }
    }, 3000);
  });
}

// ── VisuallyHidden ─────────────────────────────────────────────────────────────

export interface VisuallyHiddenProps {
  /** Content accessible to screen readers but not rendered visually */
  children: React.ReactNode;
  /** HTML element to render. Defaults to 'span'. */
  as?: keyof React.JSX.IntrinsicElements;
  /** Additional class name */
  className?: string;
}

/**
 * VisuallyHidden — renders content that is invisible on screen but fully
 * accessible to assistive technologies.
 *
 * Uses the standard clip-rect technique which avoids the pitfalls of
 * `display:none` (removes from AT) and `opacity:0` (removes from AT
 * in some browsers).
 *
 * Usage:
 *   <button>
 *     <Icon aria-hidden="true" />
 *     <VisuallyHidden>Close dialog</VisuallyHidden>
 *   </button>
 *
 * Validates: Requirements 87.4 (all interactive elements must have accessible names)
 */
export const VisuallyHidden: React.FC<VisuallyHiddenProps> = ({
  children,
  as: Component = 'span',
  className = '',
}) => {
  const style: React.CSSProperties = {
    position: 'absolute',
    width: '1px',
    height: '1px',
    padding: '0',
    margin: '-1px',
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    whiteSpace: 'nowrap',
    borderWidth: '0',
  };

  return React.createElement(
    Component,
    { className: `visually-hidden ${className}`.trim(), style },
    children,
  );
};

// ── LiveRegion ─────────────────────────────────────────────────────────────────

export type LiveRegionPoliteness = 'polite' | 'assertive' | 'off';

export interface LiveRegionProps {
  /** Message to announce. Changing this value triggers a new announcement. */
  message: string;
  /**
   * ARIA live region politeness.
   * - 'polite'    — waits for idle (default; for non-urgent updates)
   * - 'assertive' — interrupts immediately (for critical alerts)
   * - 'off'       — disables announcements
   */
  politeness?: LiveRegionPoliteness;
  /**
   * When true, the entire region is read when any part changes.
   * When false (default), only the changed portion is read.
   */
  atomic?: boolean;
  /**
   * Controls whether additions, removals, or all mutations are announced.
   * Defaults to 'additions text'.
   */
  relevant?: 'additions' | 'removals' | 'text' | 'all' | 'additions text';
  /** Additional CSS class */
  className?: string;
}

/**
 * LiveRegion — a visually-hidden ARIA live region that announces dynamic
 * content changes to screen readers.
 *
 * Wrap around content that changes dynamically (new data loads, alert banners,
 * status messages) so that screen reader users are informed without needing to
 * navigate to the element.
 *
 * Usage:
 *   <LiveRegion message={statusMessage} politeness="polite" />
 *   <LiveRegion message={alertText} politeness="assertive" />
 *
 * Validates: Requirements 88.5 (dynamic content announced to screen readers)
 */
export const LiveRegion: React.FC<LiveRegionProps> = ({
  message,
  politeness = 'polite',
  atomic = true,
  relevant = 'additions text',
  className = '',
}) => {
  // The trick: clear then re-set the message so screen readers detect the change
  const [displayed, setDisplayed] = useState('');

  useEffect(() => {
    if (!message) {
      setDisplayed('');
      return;
    }
    // Brief clear so AT registers the region is mutating
    setDisplayed('');
    const id = requestAnimationFrame(() => setDisplayed(message));
    return () => cancelAnimationFrame(id);
  }, [message]);

  return (
    <div
      role={politeness === 'assertive' ? 'alert' : 'status'}
      aria-live={politeness}
      aria-atomic={atomic}
      aria-relevant={relevant}
      className={`live-region ${className}`.trim()}
      style={{
        position: 'absolute',
        width: '1px',
        height: '1px',
        padding: '0',
        margin: '-1px',
        overflow: 'hidden',
        clip: 'rect(0, 0, 0, 0)',
        whiteSpace: 'nowrap',
        borderWidth: '0',
      }}
    >
      {displayed}
    </div>
  );
};

// ── CriticalLiveRegion ────────────────────────────────────────────────────────

/**
 * Types of critical state-change events that must be announced to screen
 * readers immediately (assertive politeness) per WCAG 2.1 SC 4.1.3.
 *
 * Validates: Requirements 48.4 (ARIA live regions for critical state changes)
 */
export type CriticalEventType =
  | 'data_loaded'        // New prediction data arrived from the server
  | 'alert_triggered'    // Hazard / extreme event alert activated
  | 'prediction_updated' // Forecast updated with latest model run
  | 'connection_change'  // Connection status changed (online ↔ offline)
  | 'export_complete'    // Export / download finished
  | 'error';             // Critical error occurred

export interface CriticalLiveRegionProps {
  /**
   * The event type that just occurred. Changing this value triggers
   * an assertive announcement to screen readers.
   */
  eventType: CriticalEventType | null;
  /**
   * Human-readable description of the state change.
   * e.g. "7-day forecast updated for Western Ghats"
   */
  message: string;
  /** Additional CSS class for the wrapper element. */
  className?: string;
}

/**
 * CriticalLiveRegion — an assertive ARIA live region for immediately
 * announcing critical state changes to screen readers.
 *
 * Unlike the polite `LiveRegion`, this component uses `aria-live="assertive"`
 * which interrupts any ongoing screen reader speech. Use only for genuinely
 * time-sensitive information:
 *   - New prediction data loaded
 *   - Hazard alert triggered
 *   - Connection status change
 *   - Critical errors
 *
 * Usage:
 *   <CriticalLiveRegion eventType={lastEvent} message={eventMessage} />
 *
 * Validates: Requirements 48.4 (ARIA live regions for critical state changes)
 */
export const CriticalLiveRegion: React.FC<CriticalLiveRegionProps> = ({
  eventType,
  message,
  className = '',
}) => {
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    if (!eventType || !message) {
      setAnnouncement('');
      return;
    }
    const prefix: Record<CriticalEventType, string> = {
      data_loaded:          'New data loaded:',
      alert_triggered:      'Alert:',
      prediction_updated:   'Forecast updated:',
      connection_change:    'Connection status:',
      export_complete:      'Download ready:',
      error:                'Error:',
    };
    const full = `${prefix[eventType]} ${message}`;
    setAnnouncement('');
    const id = requestAnimationFrame(() => setAnnouncement(full));
    return () => cancelAnimationFrame(id);
  }, [eventType, message]);

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      aria-relevant="additions text"
      className={`critical-live-region ${className}`.trim()}
      style={{
        position: 'absolute',
        width: '1px',
        height: '1px',
        padding: '0',
        margin: '-1px',
        overflow: 'hidden',
        clip: 'rect(0, 0, 0, 0)',
        whiteSpace: 'nowrap',
        borderWidth: '0',
      }}
    >
      {announcement}
    </div>
  );
};

// ── useAnnounceCritical ───────────────────────────────────────────────────────

/**
 * Programmatic hook for firing critical ARIA announcements from any component.
 *
 * Returns an `announceCritical` function that drives a `CriticalLiveRegion`.
 * The announcement auto-clears after 5s so repeat identical messages still
 * trigger a new AT read.
 *
 * Usage:
 *   const { announceCritical, currentEventType, currentMessage } =
 *     useAnnounceCritical();
 *
 *   // When prediction data loads:
 *   announceCritical('data_loaded', 'Western Ghats 7-day forecast updated');
 *
 *   // Render the live region somewhere in the tree:
 *   <CriticalLiveRegion
 *     eventType={currentEventType}
 *     message={currentMessage}
 *   />
 *
 * Validates: Requirements 48.4 (ARIA live regions for critical state changes)
 */
export type AnnounceCriticalFn = (eventType: CriticalEventType, message: string) => void;

export interface UseAnnounceCriticalReturn {
  /** Trigger an assertive screen-reader announcement for a critical event. */
  announceCritical: AnnounceCriticalFn;
  /** Current event type (null when no announcement is active). */
  currentEventType: CriticalEventType | null;
  /** Current announcement message. */
  currentMessage: string;
}

export function useAnnounceCritical(): UseAnnounceCriticalReturn {
  const [eventType, setEventType] = useState<CriticalEventType | null>(null);
  const [message, setMessage] = useState('');
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const announceCritical = useCallback<AnnounceCriticalFn>(
    (type, msg) => {
      if (clearTimerRef.current !== null) {
        clearTimeout(clearTimerRef.current);
      }
      setEventType(type);
      setMessage(msg);
      clearTimerRef.current = setTimeout(() => {
        setEventType(null);
        setMessage('');
      }, 5000);
    },
    [],
  );

  useEffect(() => {
    return () => {
      if (clearTimerRef.current !== null) {
        clearTimeout(clearTimerRef.current);
      }
    };
  }, []);

  return { announceCritical, currentEventType: eventType, currentMessage: message };
}

// ── FocusTrap ─────────────────────────────────────────────────────────────────

export interface FocusTrapProps {
  /** Content inside the trap — all focusable children are trapped. */
  children: React.ReactNode;
  /**
   * Whether the focus trap is active.
   * When false, the component renders children without trapping focus.
   */
  active?: boolean;
  /**
   * When true, focus is moved to the first focusable child on activation.
   * Defaults to true.
   */
  autoFocus?: boolean;
  /**
   * When true, focus is restored to the element that had focus before the
   * trap was activated, on deactivation.
   * Defaults to true.
   */
  restoreFocus?: boolean;
  /**
   * Element to return focus to when trap deactivates.
   * Falls back to document.activeElement at mount time.
   */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  /** Called when the user presses Escape inside the trap. */
  onEscape?: () => void;
  /** Additional class name for the wrapper div. */
  className?: string;
  /** Additional inline style for the wrapper div. */
  style?: React.CSSProperties;
}

/**
 * FocusTrap — confines keyboard focus within a container.
 *
 * Required for accessible modal dialogs, drawers, and pop-up panels.
 * When active:
 *   - Tab from the last focusable element wraps to the first.
 *   - Shift+Tab from the first focusable element wraps to the last.
 *   - Escape calls onEscape (caller should set active=false).
 *   - Focus is moved to the first focusable child automatically.
 *   - On deactivation, focus is restored to the triggering element.
 *
 * Usage:
 *   <FocusTrap active={isOpen} onEscape={() => setIsOpen(false)}>
 *     <dialog role="dialog" aria-modal="true">
 *       ...
 *     </dialog>
 *   </FocusTrap>
 *
 * Validates: Requirements 87.4 (modal dialogs must implement focus trapping)
 */
export const FocusTrap: React.FC<FocusTrapProps> = ({
  children,
  active = true,
  autoFocus = true,
  restoreFocus = true,
  returnFocusRef,
  onEscape,
  className,
  style,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<Element | null>(null);

  // Capture the currently focused element before activation
  useEffect(() => {
    if (active) {
      previousFocusRef.current = returnFocusRef?.current ?? document.activeElement;
    }
  }, [active, returnFocusRef]);

  // Auto-focus first focusable child on activation
  useEffect(() => {
    if (!active || !autoFocus || !containerRef.current) return;

    const focusables = getFocusableElements(containerRef.current);
    if (focusables.length > 0) {
      // Defer to allow the DOM to settle (e.g. after CSS transitions)
      const id = setTimeout(() => focusables[0].focus(), 50);
      return () => clearTimeout(id);
    }
  }, [active, autoFocus]);

  // Restore focus on deactivation
  useEffect(() => {
    return () => {
      if (restoreFocus && previousFocusRef.current instanceof HTMLElement) {
        previousFocusRef.current.focus();
      }
    };
  }, [restoreFocus]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!active || !containerRef.current) return;

      if (event.key === 'Escape') {
        onEscape?.();
        return;
      }

      if (event.key !== 'Tab') return;

      const focusables = getFocusableElements(containerRef.current);
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active_el = document.activeElement;

      if (event.shiftKey) {
        // Shift+Tab: if on first element, wrap to last
        if (active_el === first || !containerRef.current.contains(active_el)) {
          event.preventDefault();
          last.focus();
        }
      } else {
        // Tab: if on last element, wrap to first
        if (active_el === last || !containerRef.current.contains(active_el)) {
          event.preventDefault();
          first.focus();
        }
      }
    },
    [active, onEscape],
  );

  return (
    <div
      ref={containerRef}
      onKeyDown={handleKeyDown}
      className={className}
      style={style}
      // Container itself should not be focusable
      tabIndex={-1}
      data-focus-trap={active ? 'active' : 'inactive'}
    >
      {children}
    </div>
  );
};

// ── SkipLink ──────────────────────────────────────────────────────────────────

export interface SkipLinkProps {
  /** ID of the main content element to skip to. Defaults to 'main-content'. */
  targetId?: string;
  /** Label text. Defaults to 'Skip to main content'. */
  label?: string;
}

/**
 * SkipLink — a "skip navigation" link that appears on keyboard focus.
 *
 * Allows keyboard and screen reader users to bypass repetitive navigation
 * and jump directly to the main content. Must be the first focusable element
 * in the page.
 *
 * Usage:
 *   // At the very top of <App />:
 *   <SkipLink targetId="globe-container" />
 *   // On the target element:
 *   <main id="globe-container" tabIndex={-1}>...</main>
 *
 * Validates: Requirements 87.4 (keyboard navigation support)
 */
export const SkipLink: React.FC<SkipLinkProps> = ({
  targetId = 'main-content',
  label = 'Skip to main content',
}) => {
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    const target = document.getElementById(targetId);
    if (target) {
      target.focus();
      target.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  };

  return (
    <a
      href={`#${targetId}`}
      onClick={handleClick}
      style={{
        position: 'fixed',
        top: '0',
        left: '0',
        zIndex: 99999,
        padding: '10px 20px',
        background: 'var(--color-accent-blue, #3b82f6)',
        color: '#ffffff',
        fontSize: '14px',
        fontWeight: 600,
        borderRadius: '0 0 8px 0',
        textDecoration: 'none',
        // Hidden until focused
        transform: 'translateY(-100%)',
        transition: 'transform 200ms ease',
        outline: 'none',
      }}
      onFocus={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
      }}
      onBlur={(e) => {
        e.currentTarget.style.transform = 'translateY(-100%)';
      }}
    >
      {label}
    </a>
  );
};

// ── FocusRing ─────────────────────────────────────────────────────────────────

export interface FocusRingProps {
  /** The interactive element to wrap with a visible focus ring. */
  children: React.ReactNode;
  /**
   * Focus ring color. Defaults to the design system accent blue.
   */
  color?: string;
  /**
   * Focus ring offset in pixels. Defaults to 2.
   */
  offset?: number;
  /**
   * Focus ring width in pixels. Defaults to 2.
   */
  width?: number;
  /** Additional class name. */
  className?: string;
}

/**
 * FocusRing — wraps an interactive element to apply a clearly visible focus
 * indicator that meets WCAG 2.1 Success Criterion 2.4.7 (Focus Visible).
 *
 * The ring uses a CSS outline rather than box-shadow so it respects
 * forced-colors / high-contrast mode automatically.
 *
 * Usage:
 *   <FocusRing>
 *     <button onClick={...}>Action</button>
 *   </FocusRing>
 *
 * Validates: Requirements 87.4 (visible focus indicators)
 */
export const FocusRing: React.FC<FocusRingProps> = ({
  children,
  color = 'var(--color-accent-blue, #3b82f6)',
  offset = 2,
  width = 2,
  className = '',
}) => {
  const [focused, setFocused] = useState(false);

  return (
    <div
      className={`focus-ring-wrapper ${className}`.trim()}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        display: 'contents',
        outline: focused
          ? `${width}px solid ${color}`
          : 'none',
        outlineOffset: `${offset}px`,
        borderRadius: 'inherit',
      }}
    >
      {children}
    </div>
  );
};

// ── A11yContext ────────────────────────────────────────────────────────────────

export interface A11yContextValue {
  /** Whether the user prefers reduced motion (synced from OS). */
  reducedMotion: boolean;
  /** Whether high-contrast forced-colors mode is active. */
  highContrast: boolean;
  /**
   * Announce a message to screen readers via a shared live region.
   * @param message     - Text to announce
   * @param politeness  - 'polite' (default) or 'assertive'
   */
  announce: (message: string, politeness?: 'polite' | 'assertive') => void;
}

const A11yContext = createContext<A11yContextValue>({
  reducedMotion: false,
  highContrast: false,
  announce: () => {},
});

export interface A11yProviderProps {
  children: React.ReactNode;
}

/**
 * A11yProvider — context provider that exposes accessibility preferences
 * and a shared `announce()` function throughout the component tree.
 *
 * Mount once near the application root:
 *   <A11yProvider>
 *     <App />
 *   </A11yProvider>
 *
 * Consumers:
 *   const { reducedMotion, announce } = useA11yContext();
 *
 * Validates: Requirements 87.4, 88.5
 */
export const A11yProvider: React.FC<A11yProviderProps> = ({ children }) => {
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);
  const [highContrast, setHighContrast] = useState(prefersHighContrast);
  const [announcement, setAnnouncement] = useState('');
  const [politeness, setPoliteness] = useState<'polite' | 'assertive'>('polite');

  // Track OS preference changes in real time
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const motionMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
    const contrastMQ = window.matchMedia('(forced-colors: active)');

    const handleMotionChange = (e: MediaQueryListEvent) =>
      setReducedMotion(e.matches);
    const handleContrastChange = (e: MediaQueryListEvent) =>
      setHighContrast(e.matches);

    motionMQ.addEventListener('change', handleMotionChange);
    contrastMQ.addEventListener('change', handleContrastChange);

    return () => {
      motionMQ.removeEventListener('change', handleMotionChange);
      contrastMQ.removeEventListener('change', handleContrastChange);
    };
  }, []);

  const announce = useCallback(
    (message: string, p: 'polite' | 'assertive' = 'polite') => {
      setPoliteness(p);
      // Clear then set to ensure the AT picks up identical consecutive messages
      setAnnouncement('');
      requestAnimationFrame(() => setAnnouncement(message));
    },
    [],
  );

  return (
    <A11yContext.Provider value={{ reducedMotion, highContrast, announce }}>
      {children}
      {/* Shared live region for announcements */}
      <LiveRegion message={announcement} politeness={politeness} />
    </A11yContext.Provider>
  );
};

/**
 * useA11yContext — consume the A11yContext values from any component.
 */
export function useA11yContext(): A11yContextValue {
  return useContext(A11yContext);
}

// ── AccessibleIconButton ───────────────────────────────────────────────────────

export interface AccessibleIconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible label (required — appears as tooltip and screen reader text). */
  label: string;
  /** Icon content — should have aria-hidden="true" on the icon element. */
  children: React.ReactNode;
  /** Additional class name. */
  className?: string;
}

/**
 * AccessibleIconButton — a button that contains only an icon, with a proper
 * accessible name provided via aria-label and a visible tooltip.
 *
 * Usage:
 *   <AccessibleIconButton label="Close panel" onClick={onClose}>
 *     <CloseIcon aria-hidden="true" />
 *   </AccessibleIconButton>
 *
 * Validates: Requirements 87.4 (all interactive elements must have accessible names)
 */
export const AccessibleIconButton: React.FC<AccessibleIconButtonProps> = ({
  label,
  children,
  className = '',
  style,
  ...rest
}) => {
  return (
    <button
      aria-label={label}
      title={label}
      className={`accessible-icon-btn ${className}`.trim()}
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '6px',
        borderRadius: '6px',
        // Ensure focus ring is visible
        outline: 'none',
        ...style,
      }}
      onFocus={(e) => {
        e.currentTarget.style.outline = '2px solid var(--color-accent-blue, #3b82f6)';
        e.currentTarget.style.outlineOffset = '2px';
        rest.onFocus?.(e);
      }}
      onBlur={(e) => {
        e.currentTarget.style.outline = 'none';
        rest.onBlur?.(e);
      }}
      {...rest}
    >
      {children}
    </button>
  );
};

// ── Exports ───────────────────────────────────────────────────────────────────

export default {
  FocusTrap,
  VisuallyHidden,
  LiveRegion,
  CriticalLiveRegion,
  SkipLink,
  FocusRing,
  A11yProvider,
  AccessibleIconButton,
  useA11yContext,
  useAnnounceCritical,
  // Helper functions
  getFocusableElements,
  generateA11yId,
  prefersReducedMotion,
  prefersHighContrast,
  moveFocusTo,
  announceToScreenReader,
};
