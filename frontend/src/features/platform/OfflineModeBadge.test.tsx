import { afterAll, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import OfflineModeBadge from './OfflineModeBadge';
import {
  OFFLINE_CACHE_HIT_MESSAGE,
  isOfflineCacheHitMessage,
} from '../../core/offline/serviceWorker';

const serviceWorkerEvents = new EventTarget();
const originalServiceWorker = navigator.serviceWorker;

Object.defineProperty(navigator, 'serviceWorker', {
  configurable: true,
  value: serviceWorkerEvents,
});

afterAll(() => {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: originalServiceWorker,
  });
});

describe('OfflineModeBadge', () => {
  it('recognizes only the worker message used for offline cache responses', () => {
    expect(isOfflineCacheHitMessage({ type: OFFLINE_CACHE_HIT_MESSAGE })).toBe(true);
    expect(isOfflineCacheHitMessage({ type: 'other-message' })).toBe(false);
    expect(isOfflineCacheHitMessage(null)).toBe(false);
  });

  it('appears after the service worker serves a cached response offline', () => {
    render(<OfflineModeBadge />);
    expect(screen.queryByText('Offline Mode')).toBeNull();

    act(() => {
      serviceWorkerEvents.dispatchEvent(new MessageEvent('message', {
        data: { type: OFFLINE_CACHE_HIT_MESSAGE },
      }));
    });

    expect(screen.getByRole('status')).toHaveTextContent('Offline Mode');
  });

  it('is removed when connectivity is restored', () => {
    render(<OfflineModeBadge />);
    act(() => {
      serviceWorkerEvents.dispatchEvent(new MessageEvent('message', {
        data: { type: OFFLINE_CACHE_HIT_MESSAGE },
      }));
      window.dispatchEvent(new Event('online'));
    });

    expect(screen.queryByText('Offline Mode')).toBeNull();
  });
});
