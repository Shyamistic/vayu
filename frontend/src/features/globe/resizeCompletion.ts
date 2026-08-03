export interface ResizeCompletionController {
  requestCompletion(): void;
  observed(width: number, height: number): void;
  transitionEnded(): void;
  dispose(): void;
}

/** Coordinates immediate, measured, and post-transition Cesium resize calls only. */
export function createResizeCompletionController(
  resize: () => void,
  finalDelayMs = 350,
): ResizeCompletionController {
  let finalTimer: ReturnType<typeof setTimeout> | null = null;
  let lastWidth = -1;
  let lastHeight = -1;
  let disposed = false;
  const clearFinal = () => {
    if (finalTimer !== null) clearTimeout(finalTimer);
    finalTimer = null;
  };
  const run = () => { if (!disposed) resize(); };
  const scheduleFinal = () => {
    clearFinal();
    finalTimer = setTimeout(() => {
      finalTimer = null;
      run();
    }, finalDelayMs);
  };
  return {
    requestCompletion() {
      run();
      scheduleFinal();
    },
    observed(width, height) {
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
      if (width === lastWidth && height === lastHeight) return;
      lastWidth = width;
      lastHeight = height;
      run();
      scheduleFinal();
    },
    transitionEnded() {
      clearFinal();
      run();
    },
    dispose() {
      disposed = true;
      clearFinal();
    },
  };
}
