import React, { Component } from 'react';
import type { ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { queryClient } from './core/api/queryClient';
import { observeLargestContentfulPaint } from './core/performance/lcp';
import { registerOfflineServiceWorker } from './core/offline/serviceWorker';
import './index.css';
import './i18n'; // Initialize i18next with language detection

/**
 * Root-level safety net: if any part of the app throws during render (e.g. a
 * panel crashing because a backend feature isn't ready yet), show a
 * recoverable message instead of unmounting the whole dashboard to a blank
 * screen.
 */
class RootErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error?: Error }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[MAUSAM] Dashboard crashed:', error, info.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 12,
            background: '#060a16', color: 'rgba(255,255,255,0.85)', textAlign: 'center', padding: 24,
          }}
        >
          <div style={{ fontSize: 32 }}>⚠</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Something went wrong loading this view</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', maxWidth: 480 }}>
            {this.state.error?.message ?? 'Unknown error'}
          </div>
          <button
            onClick={() => this.setState({ hasError: false })}
            style={{
              marginTop: 8, padding: '8px 16px', borderRadius: 8,
              background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.4)',
              color: '#93c5fd', fontSize: 12, cursor: 'pointer',
            }}
          >
            Reload dashboard
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

observeLargestContentfulPaint(({ value, targetMet }) => {
  window.dispatchEvent(new CustomEvent('vayu:lcp', { detail: { value, targetMet } }));
  if (!targetMet) console.warn(`[VAYU] LCP budget exceeded: ${Math.round(value)}ms`);
});

// PWA support is progressive: registration errors never block the dashboard.
registerOfflineServiceWorker();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <RootErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </RootErrorBoundary>,
);
