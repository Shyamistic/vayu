/**
 * ConnectionStatus.test.tsx
 *
 * Unit tests for the ConnectionStatus components and the useOfflineStatus hook.
 *
 * Validates: Requirements 30.1, 30.2, 30.3, 30.4, 88.1, 88.2, 88.3, 88.4
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';

// ── We test the pure helper logic without needing React for most assertions ───

// Pull in the module to test internal helpers via a re-export barrel approach.
// Since the helpers are not exported, we test them indirectly through rendered output.

import ConnectionStatusIndicator, {
  OfflineBanner,
  DataLoadingOverlay,
  FreshnessBadge,
} from './ConnectionStatus';

// ── Zustand store mock ─────────────────────────────────────────────────────────

// Zustand stores are module-level singletons. We reset state between tests by
// importing the real store and calling its actions directly.
import { useAppStore } from '../../core/state/appStore';

// Helper to set store state directly in tests
function setStoreState(patch: {
  connectionStatus?: 'connected' | 'reconnecting' | 'offline';
  lastUpdated?: Date | null;
}) {
  const store = useAppStore.getState();
  if (patch.connectionStatus !== undefined) {
    store.setConnectionStatus(patch.connectionStatus);
  }
  if ('lastUpdated' in patch) {
    store.setLastUpdated(patch.lastUpdated ?? null);
  }
}

// Reset store before each test
beforeEach(() => {
  setStoreState({ connectionStatus: 'connected', lastUpdated: null });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── ConnectionStatusIndicator ─────────────────────────────────────────────────

describe('ConnectionStatusIndicator', () => {
  it('shows "Live" label when status is connected', () => {
    setStoreState({ connectionStatus: 'connected' });
    render(<ConnectionStatusIndicator />);
    expect(screen.getByText('Live')).toBeTruthy();
  });

  it('shows "Reconnecting…" label when status is reconnecting', () => {
    setStoreState({ connectionStatus: 'reconnecting' });
    render(<ConnectionStatusIndicator />);
    expect(screen.getByText('Reconnecting…')).toBeTruthy();
  });

  it('shows "Offline" label when status is offline', () => {
    setStoreState({ connectionStatus: 'offline' });
    render(<ConnectionStatusIndicator />);
    expect(screen.getByText('Offline')).toBeTruthy();
  });

  it('has role="status" and aria-live for screen reader support', () => {
    setStoreState({ connectionStatus: 'connected' });
    render(<ConnectionStatusIndicator />);
    const indicator = screen.getByRole('status');
    expect(indicator).toBeTruthy();
    expect(indicator.getAttribute('aria-live')).toBe('polite');
  });

  it('shows "Just now" freshness badge when lastUpdated is very recent', () => {
    setStoreState({
      connectionStatus: 'connected',
      lastUpdated: new Date(),
    });
    render(<ConnectionStatusIndicator showFreshness />);
    expect(screen.getByText('Just now')).toBeTruthy();
  });

  it('does not show freshness badge when showFreshness=false', () => {
    setStoreState({
      connectionStatus: 'connected',
      lastUpdated: new Date(),
    });
    render(<ConnectionStatusIndicator showFreshness={false} />);
    expect(screen.queryByText('Just now')).toBeNull();
  });

  it('does not show freshness badge when offline', () => {
    setStoreState({
      connectionStatus: 'offline',
      lastUpdated: new Date(),
    });
    render(<ConnectionStatusIndicator showFreshness />);
    // Freshness badge is hidden when offline (requirement: show last-known in banner)
    expect(screen.queryByText('Just now')).toBeNull();
  });

  it('shows relative time label for older timestamps', () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1_000);
    setStoreState({ connectionStatus: 'connected', lastUpdated: fiveMinutesAgo });
    render(<ConnectionStatusIndicator showFreshness />);
    expect(screen.getByText('5m ago')).toBeTruthy();
  });
});

// ── OfflineBanner ─────────────────────────────────────────────────────────────

describe('OfflineBanner', () => {
  it('renders nothing when connected', () => {
    setStoreState({ connectionStatus: 'connected' });
    const { container } = render(<OfflineBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when reconnecting', () => {
    setStoreState({ connectionStatus: 'reconnecting' });
    const { container } = render(<OfflineBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the offline banner when offline', () => {
    setStoreState({ connectionStatus: 'offline', lastUpdated: null });
    render(<OfflineBanner />);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(/You're offline/)).toBeTruthy();
  });

  it('displays "Last updated: Unknown" when lastUpdated is null', () => {
    setStoreState({ connectionStatus: 'offline', lastUpdated: null });
    render(<OfflineBanner />);
    expect(screen.getByText(/Last updated: Unknown/)).toBeTruthy();
  });

  it('renders the Retry button when onRetry is provided', () => {
    setStoreState({ connectionStatus: 'offline', lastUpdated: null });
    const onRetry = vi.fn();
    render(<OfflineBanner onRetry={onRetry} />);
    const btn = screen.getByRole('button', { name: /Retry/i });
    expect(btn).toBeTruthy();
    btn.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not render the Retry button when onRetry is not provided', () => {
    setStoreState({ connectionStatus: 'offline', lastUpdated: null });
    render(<OfflineBanner />);
    expect(screen.queryByRole('button', { name: /Retry/i })).toBeNull();
  });

  it('shows a formatted timestamp when lastUpdated is known', () => {
    const knownDate = new Date('2025-07-15T10:30:00');
    setStoreState({ connectionStatus: 'offline', lastUpdated: knownDate });
    render(<OfflineBanner />);
    // The banner should contain "Last updated:" followed by a date string
    const text = screen.getByText(/Last updated:/);
    expect(text).toBeTruthy();
  });

  it('has aria-live="assertive" for urgent screen reader announcement', () => {
    setStoreState({ connectionStatus: 'offline', lastUpdated: null });
    render(<OfflineBanner />);
    const banner = screen.getByRole('alert');
    expect(banner.getAttribute('aria-live')).toBe('assertive');
  });
});

// ── DataLoadingOverlay ────────────────────────────────────────────────────────

describe('DataLoadingOverlay', () => {
  it('renders children when isLoading=false', () => {
    render(
      <DataLoadingOverlay isLoading={false}>
        <span data-testid="child">Hello</span>
      </DataLoadingOverlay>
    );
    expect(screen.getByTestId('child')).toBeTruthy();
  });

  it('renders skeleton placeholders when isLoading=true', () => {
    const { container } = render(
      <DataLoadingOverlay isLoading skeletonVariant="card" skeletonCount={2}>
        <span data-testid="child">Hello</span>
      </DataLoadingOverlay>
    );
    // Children should NOT be rendered while loading
    expect(screen.queryByTestId('child')).toBeNull();
    // Two skeleton elements should be present
    const skeletons = container.querySelectorAll('.skeleton-loader');
    expect(skeletons.length).toBe(2);
  });

  it('has role="status" and aria-busy="true" when loading', () => {
    render(
      <DataLoadingOverlay isLoading loadingLabel="Fetching forecast…">
        <span>Content</span>
      </DataLoadingOverlay>
    );
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(status.getAttribute('aria-label')).toBe('Fetching forecast…');
  });

  it('defaults to a single skeleton card', () => {
    const { container } = render(
      <DataLoadingOverlay isLoading>
        <span>Content</span>
      </DataLoadingOverlay>
    );
    const skeletons = container.querySelectorAll('.skeleton-loader');
    expect(skeletons.length).toBe(1);
  });
});

// ── FreshnessBadge ────────────────────────────────────────────────────────────

describe('FreshnessBadge', () => {
  it('renders "Just now" for a brand-new timestamp', () => {
    render(<FreshnessBadge lastUpdated={new Date()} />);
    expect(screen.getByText('Just now')).toBeTruthy();
  });

  it('renders "Unknown" when lastUpdated is null', () => {
    render(<FreshnessBadge lastUpdated={null} />);
    expect(screen.getByText('Unknown')).toBeTruthy();
  });

  it('renders a relative time string for older timestamps', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1_000);
    render(<FreshnessBadge lastUpdated={twoHoursAgo} />);
    expect(screen.getByText('2h ago')).toBeTruthy();
  });

  it('uses pulse animation when data is fresh', () => {
    const { container } = render(<FreshnessBadge lastUpdated={new Date()} isPulse />);
    // The inner dot span should have the freshness-pulse animation applied via inline style
    const dot = container.querySelector('[aria-hidden="true"]');
    expect(dot).toBeTruthy();
    // animation style should include freshness-pulse
    expect((dot as HTMLElement).style.animation).toContain('freshness-pulse');
  });

  it('does not animate when isPulse=false', () => {
    const { container } = render(<FreshnessBadge lastUpdated={new Date()} isPulse={false} />);
    const dot = container.querySelector('[aria-hidden="true"]');
    expect((dot as HTMLElement).style.animation).toBeFalsy();
  });
});

// ── Timestamp formatting (indirect via rendered output) ───────────────────────

describe('Timestamp formatting', () => {
  it('renders "Xm ago" for timestamps in the recent past', () => {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1_000);
    render(<FreshnessBadge lastUpdated={thirtyMinutesAgo} />);
    expect(screen.getByText('30m ago')).toBeTruthy();
  });

  it('renders "Xh ago" for timestamps several hours in the past', () => {
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1_000);
    render(<FreshnessBadge lastUpdated={sixHoursAgo} />);
    expect(screen.getByText('6h ago')).toBeTruthy();
  });

  it('renders a date string for timestamps more than 24h ago', () => {
    const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1_000);
    render(<FreshnessBadge lastUpdated={yesterday} />);
    // Shouldn't show "Just now", "Xm ago", or "Xh ago"
    const el = screen.getByTitle(yesterday.toLocaleString());
    const text = el.textContent ?? '';
    expect(text).not.toContain('ago');
    expect(text).not.toContain('Just now');
  });
});
