import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPostZoomCenteringController } from './postZoomCentering';

describe('post-zoom centering policy', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not normalize ordinary rotate or pan interactions', () => {
    const normalize = vi.fn();
    const policy = createPostZoomCenteringController(normalize);
    policy.beginManualInput('rotate');
    policy.endManualInput('rotate');
    policy.beginManualInput('pan');
    policy.endManualInput('pan');
    vi.runAllTimers();
    expect(normalize).not.toHaveBeenCalled();
  });

  it('normalizes once after a wheel burst settles and its cooldown ends', () => {
    const normalize = vi.fn();
    const policy = createPostZoomCenteringController(normalize, { settleDelayMs: 100, cooldownMs: 50 });
    policy.wheel();
    vi.advanceTimersByTime(60);
    policy.wheel();
    vi.advanceTimersByTime(149);
    expect(normalize).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(normalize).toHaveBeenCalledTimes(1);
    vi.runAllTimers();
    expect(normalize).toHaveBeenCalledTimes(1);
  });

  it('normalizes once after a pinch ends and never during active input', () => {
    const normalize = vi.fn();
    const policy = createPostZoomCenteringController(normalize, { cooldownMs: 80 });
    policy.beginManualInput('pinch');
    policy.markZoom();
    vi.runAllTimers();
    expect(normalize).not.toHaveBeenCalled();
    policy.endManualInput('pinch');
    vi.advanceTimersByTime(79);
    expect(normalize).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(normalize).toHaveBeenCalledTimes(1);
  });

  it('waits for Cesium camera motion to settle before the post-pinch cooldown', () => {
    const normalize = vi.fn();
    const policy = createPostZoomCenteringController(normalize, { cooldownMs: 80 });
    policy.beginManualInput('pinch');
    policy.beginManualInput('camera-motion');
    policy.markZoom();
    policy.endManualInput('pinch');
    vi.advanceTimersByTime(500);
    expect(normalize).not.toHaveBeenCalled();

    policy.endManualInput('camera-motion');
    vi.advanceTimersByTime(79);
    expect(normalize).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(normalize).toHaveBeenCalledTimes(1);
    vi.runAllTimers();
    expect(normalize).toHaveBeenCalledTimes(1);
  });

  it('suppresses queued and new normalization during programmatic flights', () => {
    const normalize = vi.fn();
    const policy = createPostZoomCenteringController(normalize);
    policy.wheel();
    policy.setProgrammaticFlight(true);
    policy.wheel();
    vi.runAllTimers();
    policy.setProgrammaticFlight(false);
    vi.runAllTimers();
    expect(normalize).not.toHaveBeenCalled();
  });
});
