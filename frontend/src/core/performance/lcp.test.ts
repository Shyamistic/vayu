import { afterEach, describe, expect, it, vi } from 'vitest';
import { LCP_TARGET_MS, observeLargestContentfulPaint } from './lcp';

const originalObserver = globalThis.PerformanceObserver;

describe('observeLargestContentfulPaint', () => {
  afterEach(() => {
    Object.defineProperty(globalThis, 'PerformanceObserver', { configurable: true, value: originalObserver });
    Reflect.deleteProperty(document, 'visibilityState');
  });

  it('reports the latest LCP entry and whether it meets the 2.5 second target', () => {
    let callback: PerformanceObserverCallback | undefined;
    const disconnect = vi.fn();
    class TestObserver {
      static supportedEntryTypes = ['largest-contentful-paint'];
      constructor(next: PerformanceObserverCallback) { callback = next; }
      observe = vi.fn();
      disconnect = disconnect;
    }
    Object.defineProperty(globalThis, 'PerformanceObserver', { configurable: true, value: TestObserver });

    const report = vi.fn();
    observeLargestContentfulPaint(report);
    callback?.({ getEntries: () => [{ startTime: 1_200 }, { startTime: 2_600 }] } as PerformanceObserverEntryList, {} as PerformanceObserver);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(report).toHaveBeenCalledWith({ value: 2_600, targetMet: false });
    expect(disconnect).toHaveBeenCalledOnce();
    expect(LCP_TARGET_MS).toBe(2_500);
  });
});
