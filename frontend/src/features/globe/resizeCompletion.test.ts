import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createResizeCompletionController } from './resizeCompletion';

describe('resize completion policy', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('resizes immediately and once at the deterministic fallback without a flight', () => {
    const resize = vi.fn();
    const fly = vi.fn();
    const policy = createResizeCompletionController(resize, 350);
    policy.requestCompletion();
    expect(resize).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(349);
    expect(resize).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(resize).toHaveBeenCalledTimes(2);
    expect(fly).not.toHaveBeenCalled();
  });

  it('uses final measured size changes without changing camera state or invoking flight', () => {
    const camera = {
      position: { x: 1, y: 2, z: 3 },
      direction: { x: -1, y: 0, z: 0 },
      up: { x: 0, y: 0, z: 1 },
    };
    const before = structuredClone(camera);
    const resize = vi.fn();
    const fly = vi.fn();
    const policy = createResizeCompletionController(resize, 350);
    policy.observed(1280, 720);
    policy.observed(1280, 720);
    policy.observed(888, 504);
    expect(resize).toHaveBeenCalledTimes(2);
    policy.transitionEnded();
    expect(resize).toHaveBeenCalledTimes(3);
    vi.runAllTimers();
    expect(resize).toHaveBeenCalledTimes(3);
    expect(camera).toEqual(before);
    expect(fly).not.toHaveBeenCalled();
  });

  it('cleans up its delayed fallback', () => {
    const resize = vi.fn();
    const policy = createResizeCompletionController(resize);
    policy.requestCompletion();
    policy.dispose();
    vi.runAllTimers();
    expect(resize).toHaveBeenCalledTimes(1);
  });
});
