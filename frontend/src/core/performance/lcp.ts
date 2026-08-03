export const LCP_TARGET_MS = 2_500;

export interface LcpMeasurement {
  value: number;
  targetMet: boolean;
}

/**
 * Reports the final largest-contentful-paint candidate when the page is hidden.
 * Browsers without the PerformanceObserver LCP entry type are intentionally ignored.
 */
export function observeLargestContentfulPaint(
  report: (measurement: LcpMeasurement) => void,
  targetMs = LCP_TARGET_MS,
): () => void {
  if (
    typeof PerformanceObserver === 'undefined' ||
    !PerformanceObserver.supportedEntryTypes?.includes('largest-contentful-paint')
  ) {
    return () => undefined;
  }

  let latest: PerformanceEntry | undefined;
  const observer = new PerformanceObserver((list) => {
    const entries = list.getEntries();
    latest = entries[entries.length - 1];
  });
  observer.observe({ type: 'largest-contentful-paint', buffered: true });

  const flush = () => {
    if (latest) report({ value: latest.startTime, targetMet: latest.startTime <= targetMs });
    observer.disconnect();
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') flush();
  };

  document.addEventListener('visibilitychange', onVisibilityChange, { once: true });
  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    observer.disconnect();
  };
}
