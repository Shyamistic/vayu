/**
 * useOfflineStatus — Real-time browser connectivity hook.
 *
 * Monitors the browser's online/offline events and the navigator.onLine API,
 * then syncs the derived connection status into the Zustand AppStore so that
 * all consumers can read a consistent `connectionStatus` value:
 *
 *   'connected'    — navigator.onLine === true  and at least one successful
 *                    network probe has been received since mount.
 *   'reconnecting' — navigator.onLine === true  but the last API probe failed
 *                    (or we have not yet confirmed connectivity).
 *   'offline'      — navigator.onLine === false  (OS-level disconnect).
 *
 * The hook also exposes `lastUpdated`, pulled directly from the store so that
 * any component can show "Last updated: <timestamp>" without subscribing to
 * the full AppStore shape.
 *
 * Validates: Requirements 30.1, 30.2, 30.3, 30.4
 */

import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../state/appStore';

// ── Configuration ─────────────────────────────────────────────────────────────

/** How often (ms) to actively probe the backend health endpoint. */
const PROBE_INTERVAL_MS = 30_000;

/** The endpoint used to verify server reachability. */
const HEALTH_ENDPOINT = '/api/health';

/** Timeout (ms) for each probe request. Keeps probes snappy. */
const PROBE_TIMEOUT_MS = 5_000;

// ── Types ─────────────────────────────────────────────────────────────────────

export type ConnectionStatus = 'connected' | 'reconnecting' | 'offline';

export interface OfflineStatusResult {
  /** Current connection status derived from browser events + API probes. */
  connectionStatus: ConnectionStatus;
  /** Timestamp of the last successful API response (null if not yet known). */
  lastUpdated: Date | null;
  /** True while `connectionStatus === 'offline'`. Convenience alias. */
  isOffline: boolean;
  /** True while `connectionStatus === 'reconnecting'`. */
  isReconnecting: boolean;
  /** Manually trigger a connectivity probe (e.g. after the user clicks Retry). */
  retryNow: () => void;
}

// ── Hook ───────────────────────────────────────────────────────────────────────

/**
 * useOfflineStatus
 *
 * Registers window online/offline listeners and a periodic API probe.
 * Writes `connectionStatus` and `lastUpdated` into the global AppStore so
 * that the values are accessible from anywhere, not just from the component
 * that mounts this hook.
 *
 * Intended to be called ONCE near the root of the app (e.g. in App.tsx or
 * providers.tsx). Multiple calls are safe — each instance independently
 * tracks events, but they all write to the same Zustand slice.
 */
export function useOfflineStatus(): OfflineStatusResult {
  const setConnectionStatus = useAppStore((s) => s.setConnectionStatus);
  const setLastUpdated = useAppStore((s) => s.setLastUpdated);
  const connectionStatus = useAppStore((s) => s.connectionStatus);
  const lastUpdated = useAppStore((s) => s.lastUpdated);

  // Track whether the component is still mounted to prevent stale state writes.
  const isMountedRef = useRef(true);

  // ── Probe helper ──────────────────────────────────────────────────────────

  const probe = useCallback(async (): Promise<void> => {
    // No point probing if the OS already reports offline.
    if (!navigator.onLine) {
      if (isMountedRef.current) {
        setConnectionStatus('offline');
      }
      return;
    }

    // Transition to 'reconnecting' while the probe is in flight (only if we
    // weren't already 'connected', to avoid a visible flicker on good connections).
    if (isMountedRef.current) {
      const current = useAppStore.getState().connectionStatus;
      if (current !== 'connected') {
        setConnectionStatus('reconnecting');
      }
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

      const response = await fetch(HEALTH_ENDPOINT, {
        method: 'GET',
        signal: controller.signal,
        // Bypass service-worker cache so we actually hit the network.
        cache: 'no-store',
      });
      clearTimeout(timeoutId);

      if (isMountedRef.current) {
        if (response.ok) {
          setConnectionStatus('connected');
          setLastUpdated(new Date());
        } else {
          // Server reachable but returned an error — still mark reconnecting.
          setConnectionStatus('reconnecting');
        }
      }
    } catch {
      // Fetch failed (network error, timeout, or AbortError).
      if (isMountedRef.current) {
        setConnectionStatus(navigator.onLine ? 'reconnecting' : 'offline');
      }
    }
  }, [setConnectionStatus, setLastUpdated]);

  // ── Event-driven online/offline handlers ─────────────────────────────────

  useEffect(() => {
    isMountedRef.current = true;

    const handleOnline = () => {
      // Browser says we're back — kick off a probe to confirm.
      if (isMountedRef.current) {
        setConnectionStatus('reconnecting');
        void probe();
      }
    };

    const handleOffline = () => {
      if (isMountedRef.current) {
        setConnectionStatus('offline');
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // ── Periodic probe ──────────────────────────────────────────────────────
    // Do an immediate probe on mount to establish initial state.
    void probe();
    const intervalId = setInterval(() => void probe(), PROBE_INTERVAL_MS);

    return () => {
      isMountedRef.current = false;
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(intervalId);
    };
  }, [probe, setConnectionStatus]);

  return {
    connectionStatus,
    lastUpdated,
    isOffline: connectionStatus === 'offline',
    isReconnecting: connectionStatus === 'reconnecting',
    retryNow: probe,
  };
}

// ── Helper: expose connection status without registering event listeners ───────

/**
 * useConnectionStatus
 *
 * Lightweight selector hook — reads `connectionStatus` and `lastUpdated` from
 * the AppStore without registering any listeners. Use this in leaf components
 * that only need to *display* the status, not drive the polling logic.
 */
export function useConnectionStatus(): Pick<OfflineStatusResult, 'connectionStatus' | 'lastUpdated' | 'isOffline' | 'isReconnecting'> {
  const connectionStatus = useAppStore((s) => s.connectionStatus);
  const lastUpdated = useAppStore((s) => s.lastUpdated);
  return {
    connectionStatus,
    lastUpdated,
    isOffline: connectionStatus === 'offline',
    isReconnecting: connectionStatus === 'reconnecting',
  };
}

export default useOfflineStatus;
