/** Mobile gesture thresholds and pure classifiers for the field interface. */
export const MOBILE_BREAKPOINT_PX = 768;
export const MOBILE_GLOBE_VIEWPORT_RATIO = 0.7;
export const MOBILE_SHEET_VIEWPORT_RATIO = 0.3;
export const TIMELINE_SWIPE_THRESHOLD_PX = 48;
export const LONG_PRESS_DURATION_MS = 600;
export const LONG_PRESS_MOVE_TOLERANCE_PX = 12;

export type TimelineSwipeDirection = -1 | 1 | null;

/** Returns the timeline direction for an intentional horizontal finger swipe. */
export function getTimelineSwipeDirection(
  startX: number,
  endX: number,
  startY: number,
  endY: number,
  threshold = TIMELINE_SWIPE_THRESHOLD_PX,
): TimelineSwipeDirection {
  const horizontalDistance = endX - startX;
  const verticalDistance = endY - startY;

  if (
    Math.abs(horizontalDistance) < threshold ||
    Math.abs(horizontalDistance) <= Math.abs(verticalDistance)
  ) {
    return null;
  }

  // Dragging toward the left advances through time; dragging right goes back.
  return horizontalDistance < 0 ? 1 : -1;
}

/** True only when a press has lasted long enough without becoming a drag. */
export function isLongPress(
  elapsedMs: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  duration = LONG_PRESS_DURATION_MS,
  tolerance = LONG_PRESS_MOVE_TOLERANCE_PX,
): boolean {
  return elapsedMs >= duration && Math.hypot(endX - startX, endY - startY) <= tolerance;
}
