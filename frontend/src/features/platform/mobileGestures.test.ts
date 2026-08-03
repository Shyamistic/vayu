import { describe, expect, it } from 'vitest';
import {
  getTimelineSwipeDirection,
  isLongPress,
  LONG_PRESS_DURATION_MS,
  MOBILE_GLOBE_VIEWPORT_RATIO,
  MOBILE_SHEET_VIEWPORT_RATIO,
} from './mobileGestures';

describe('mobile gesture classifiers', () => {
  it('advances or rewinds the timeline for deliberate horizontal swipes', () => {
    expect(getTimelineSwipeDirection(200, 120, 40, 44)).toBe(1);
    expect(getTimelineSwipeDirection(120, 200, 40, 44)).toBe(-1);
  });

  it('ignores short or vertical swipes', () => {
    expect(getTimelineSwipeDirection(100, 130, 10, 10)).toBeNull();
    expect(getTimelineSwipeDirection(100, 110, 10, 100)).toBeNull();
  });

  it('recognizes a stationary press only after the long-press duration', () => {
    expect(isLongPress(LONG_PRESS_DURATION_MS - 1, 50, 50, 50, 50)).toBe(false);
    expect(isLongPress(LONG_PRESS_DURATION_MS, 50, 50, 58, 56)).toBe(true);
    expect(isLongPress(LONG_PRESS_DURATION_MS, 50, 50, 70, 50)).toBe(false);
  });

  it('allocates the mobile viewport between globe and data sheet', () => {
    expect(MOBILE_GLOBE_VIEWPORT_RATIO + MOBILE_SHEET_VIEWPORT_RATIO).toBe(1);
    expect(MOBILE_GLOBE_VIEWPORT_RATIO).toBe(0.7);
  });
});
