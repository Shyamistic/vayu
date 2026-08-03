/**
 * ConnectionStatus — Header status indicator and offline banner.
 *
 * Provides two exported components:
 *
 * 1. `ConnectionStatusIndicator` — compact pill for the header bar showing
 *    one of three states:
 *      • connected    → solid green dot + "Live" label
 *      • reconnecting → pulsing amber dot + "Reconnecting…" label
 *      • offline      → solid red dot + "Offline" label
 *    When data is current (last update < 2 minutes ago), a freshness badge
 *    with a pulse animation is shown next to the timestamp.
 *
 * 2. `OfflineBanner` — persistent full-width banner (below the header) that
 *    appears only when `connectionStatus === 'offline'`.  It shows the
 *    last-known data timestamp and provides a Retry button.
 *
 * 3. `DataLoadingOverlay` — thin wrapper that renders skeleton placeholders
 *    while data is loading (Req 88.1, 88.2).
 *
 * Validates: Requirements 30.1, 30.2, 30.3, 30.4, 88.1, 88.2, 88.3, 88.4
 */

import React, { useMemo } from 'react';
import { useConnectionStatus } from '../../core/hooks/useOfflineStatus';
import SkeletonLoader from '../../design-system/SkeletonLoader';
import type { ConnectionStatus as ConnectionStatusType } from '../../core/hooks/useOfflineStatus';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTimestamp(date: Date | null): string {
  if (!date) return 'Unknown';
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function isDataFresh(date: Date | null, maxAgeMs = 120_000): boolean {
  if (!date) return false;
  return Date.now() - date.getTime() < maxAgeMs;
}

// ── Status colours ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  ConnectionStatusType,
  { dotColor: string; textColor: string; label: string; bgColor: string; borderColor: string }
> = {
  connected: {
    dotColor: '#10b981',
    textColor: '#10b981',
    label: 'Live',
    bgColor: 'rgba(16, 185, 129, 0.12)',
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  reconnecting: {
    dotColor: '#f59e0b',
    textColor: '#f59e0b',
    label: 'Reconnecting…',
    bgColor: 'rgba(245, 158, 11, 0.12)',
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  offline: {
    dotColor: '#ef4444',
    textColor: '#ef4444',
    label: 'Offline',
    bgColor: 'rgba(239, 68, 68, 0.12)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
};

// ── ConnectionStatusIndicator ─────────────────────────────────────────────────

export interface ConnectionStatusIndicatorProps {
  /** Whether to show the freshness badge / last-update timestamp. Defaults to true. */
  showFreshness?: boolean;
  /** Optional extra CSS class for the outermost element. */
  className?: string;
}

/**
 * ConnectionStatusIndicator
 *
 * Compact pill to sit in the dashboard header.
 * Shows current connection state and, if data is fresh, a pulsing badge.
 *
 * Validates: Requirements 30.1, 30.2
 */
export const ConnectionStatusIndicator: React.FC<ConnectionStatusIndicatorProps> = ({
  showFreshness = true,
  className = '',
}) => {
  const { connectionStatus, lastUpdated } = useConnectionStatus();
  const config = STATUS_CONFIG[connectionStatus];
  const fresh = useMemo(() => isDataFresh(lastUpdated), [lastUpdated]);
  const timestampLabel = useMemo(() => formatTimestamp(lastUpdated), [lastUpdated]);

  return (
    <div
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 10px',
        borderRadius: '9999px',
        background: config.bgColor,
        border: `1px solid ${config.borderColor}`,
        fontSize: '11px',
        fontWeight: 600,
        lineHeight: 1,
        userSelect: 'none',
        transition: 'background 300ms ease, border-color 300ms ease',
      }}
      role="status"
      aria-live="polite"
      aria-label={`Connection status: ${connectionStatus}`}
    >
      {/* Animated dot */}
      <span
        style={{
          display: 'inline-block',
          width: '7px',
          height: '7px',
          borderRadius: '50%',
          backgroundColor: config.dotColor,
          flexShrink: 0,
          animation:
            connectionStatus === 'reconnecting'
              ? 'connection-dot-pulse 1.2s ease-in-out infinite'
              : connectionStatus === 'connected'
              ? undefined
              : undefined,
          boxShadow:
            connectionStatus === 'connected'
              ? `0 0 6px ${config.dotColor}`
              : connectionStatus === 'offline'
              ? 'none'
              : undefined,
        }}
        aria-hidden="true"
      />

      {/* Status label */}
      <span style={{ color: config.textColor }}>{config.label}</span>

      {/* Freshness badge — only when connected and data is recent */}
      {showFreshness && lastUpdated && connectionStatus !== 'offline' && (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            paddingLeft: '6px',
            borderLeft: '1px solid rgba(255,255,255,0.12)',
            color: 'rgba(255,255,255,0.5)',
          }}
          title={lastUpdated.toLocaleTimeString()}
        >
          {/* Pulse dot — glows when data is fresh */}
          <span
            style={{
              display: 'inline-block',
              width: '5px',
              height: '5px',
              borderRadius: '50%',
              backgroundColor: fresh ? '#22d3ee' : 'rgba(255,255,255,0.25)',
              animation: fresh ? 'freshness-pulse 2s ease-in-out infinite' : undefined,
            }}
            aria-hidden="true"
          />
          <span style={{ fontSize: '10px', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
            {timestampLabel}
          </span>
        </span>
      )}
    </div>
  );
};

// ── OfflineBanner ─────────────────────────────────────────────────────────────

export interface OfflineBannerProps {
  /** Called when the user clicks the Retry button. */
  onRetry?: () => void;
}

/**
 * OfflineBanner
 *
 * Persistent full-width strip shown below the header when the app is offline.
 * Displays the last-known data timestamp and a Retry button.
 *
 * Renders nothing when the connection is not 'offline'.
 *
 * Validates: Requirements 30.3
 */
export const OfflineBanner: React.FC<OfflineBannerProps> = ({ onRetry }) => {
  const { connectionStatus, lastUpdated } = useConnectionStatus();

  if (connectionStatus !== 'offline') return null;

  const lastKnown = lastUpdated
    ? lastUpdated.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Unknown';

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        position: 'fixed',
        top: 56, // below the 56px header
        left: 0,
        right: 0,
        zIndex: 999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        padding: '8px 16px',
        background: 'rgba(239, 68, 68, 0.15)',
        borderBottom: '1px solid rgba(239, 68, 68, 0.35)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        animation: 'slideInDown 0.25s ease-out',
      }}
    >
      {/* Icon */}
      <span style={{ fontSize: '14px', flexShrink: 0 }} aria-hidden="true">
        📡
      </span>

      {/* Message */}
      <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.85)', fontWeight: 500 }}>
        You're offline — showing last known data
      </span>

      {/* Timestamp */}
      <span
        style={{
          fontSize: '11px',
          color: 'rgba(255,255,255,0.45)',
          fontVariantNumeric: 'tabular-nums',
          flexShrink: 0,
        }}
      >
        Last updated: {lastKnown}
      </span>

      {/* Retry button */}
      {onRetry && (
        <button
          onClick={onRetry}
          style={{
            marginLeft: '4px',
            padding: '3px 12px',
            borderRadius: '6px',
            background: 'rgba(239, 68, 68, 0.25)',
            border: '1px solid rgba(239, 68, 68, 0.5)',
            color: '#fca5a5',
            fontSize: '11px',
            fontWeight: 600,
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'background 150ms',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239, 68, 68, 0.4)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239, 68, 68, 0.25)';
          }}
        >
          Retry
        </button>
      )}
    </div>
  );
};

// ── DataLoadingOverlay ────────────────────────────────────────────────────────

export interface DataLoadingOverlayProps {
  /** Whether data is currently loading. */
  isLoading: boolean;
  /**
   * Children to render when NOT loading.
   * When loading, skeleton placeholders are shown instead.
   */
  children: React.ReactNode;
  /**
   * Variant of skeleton to show.
   * Defaults to 'card' for panel-level loading.
   */
  skeletonVariant?: 'text' | 'card' | 'circle';
  /**
   * Number of skeleton rows (text variant only).
   */
  skeletonCount?: number;
  /** Optional accessible label for the loading state. */
  loadingLabel?: string;
}

/**
 * DataLoadingOverlay
 *
 * Renders skeleton placeholder(s) while `isLoading` is true, then switches
 * to rendering `children` once loading is complete.
 *
 * Validates: Requirements 30.4, 88.1, 88.2, 88.3, 88.4
 */
export const DataLoadingOverlay: React.FC<DataLoadingOverlayProps> = ({
  isLoading,
  children,
  skeletonVariant = 'card',
  skeletonCount = 1,
  loadingLabel = 'Loading data…',
}) => {
  if (!isLoading) {
    return <>{children}</>;
  }

  return (
    <div
      role="status"
      aria-label={loadingLabel}
      aria-busy="true"
      style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}
    >
      {Array.from({ length: skeletonCount }, (_, i) => (
        <SkeletonLoader key={i} variant={skeletonVariant} />
      ))}
    </div>
  );
};

// ── FreshnessBadge ─────────────────────────────────────────────────────────────

export interface FreshnessBadgeProps {
  /** The timestamp to display. */
  lastUpdated: Date | null;
  /** Whether to animate the pulse. Auto-computed from lastUpdated if not set. */
  isPulse?: boolean;
  className?: string;
}

/**
 * FreshnessBadge
 *
 * Standalone freshness indicator for individual data cards (Req 88.3).
 * Shows a pulsing cyan dot + relative timestamp when data is current,
 * or a muted grey dot when data is stale.
 *
 * Validates: Requirements 30.2, 88.3
 */
export const FreshnessBadge: React.FC<FreshnessBadgeProps> = ({
  lastUpdated,
  isPulse,
  className = '',
}) => {
  const fresh = useMemo(() => isDataFresh(lastUpdated), [lastUpdated]);
  const pulse = isPulse ?? fresh;
  const label = useMemo(() => formatTimestamp(lastUpdated), [lastUpdated]);

  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        fontSize: '10px',
        color: 'rgba(255,255,255,0.45)',
        fontVariantNumeric: 'tabular-nums',
      }}
      title={lastUpdated ? lastUpdated.toLocaleString() : 'No data'}
    >
      <span
        style={{
          display: 'inline-block',
          width: '5px',
          height: '5px',
          borderRadius: '50%',
          backgroundColor: pulse ? '#22d3ee' : 'rgba(255,255,255,0.2)',
          animation: pulse ? 'freshness-pulse 2s ease-in-out infinite' : undefined,
          flexShrink: 0,
        }}
        aria-hidden="true"
      />
      {label}
    </span>
  );
};

export default ConnectionStatusIndicator;
