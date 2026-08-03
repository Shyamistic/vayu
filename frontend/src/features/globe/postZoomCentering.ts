export type ManualInteractionKind = 'rotate' | 'pan' | 'zoom-drag' | 'pinch' | 'camera-motion';

export interface PostZoomCenteringController {
  beginManualInput(kind: ManualInteractionKind): void;
  markZoom(): void;
  endManualInput(kind: ManualInteractionKind): void;
  wheel(): void;
  setProgrammaticFlight(active: boolean): void;
  dispose(): void;
}

export interface PostZoomCenteringOptions {
  settleDelayMs?: number;
  cooldownMs?: number;
}

/** Debounces zoom gestures and performs one idle-only orientation normalization. */
export function createPostZoomCenteringController(
  normalizeOrientation: () => void,
  options: PostZoomCenteringOptions = {},
): PostZoomCenteringController {
  const settleDelayMs = options.settleDelayMs ?? 180;
  const cooldownMs = options.cooldownMs ?? 120;
  const active = new Map<ManualInteractionKind, number>();
  let transientWheel = false;
  let pendingZoom = false;
  let programmaticFlight = false;
  let disposed = false;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let cooldownTimer: ReturnType<typeof setTimeout> | null = null;
  const clear = (timer: ReturnType<typeof setTimeout> | null) => {
    if (timer !== null) clearTimeout(timer);
  };
  const isManualInputActive = () => transientWheel || [...active.values()].some((count) => count > 0);
  const scheduleNormalization = () => {
    clear(cooldownTimer);
    cooldownTimer = setTimeout(() => {
      cooldownTimer = null;
      if (disposed || programmaticFlight || isManualInputActive() || !pendingZoom) return;
      pendingZoom = false;
      normalizeOrientation();
    }, cooldownMs);
  };
  const finishTransientWheel = () => {
    transientWheel = false;
    settleTimer = null;
    if (pendingZoom && !programmaticFlight) scheduleNormalization();
  };

  return {
    beginManualInput(kind) {
      clear(cooldownTimer);
      cooldownTimer = null;
      active.set(kind, (active.get(kind) ?? 0) + 1);
    },
    markZoom() {
      if (!disposed && !programmaticFlight) pendingZoom = true;
    },
    endManualInput(kind) {
      const count = active.get(kind) ?? 0;
      if (count <= 1) active.delete(kind); else active.set(kind, count - 1);
      if (pendingZoom && !programmaticFlight && !isManualInputActive()) scheduleNormalization();
    },
    wheel() {
      if (disposed || programmaticFlight) return;
      pendingZoom = true;
      transientWheel = true;
      clear(settleTimer);
      clear(cooldownTimer);
      settleTimer = setTimeout(finishTransientWheel, settleDelayMs);
    },
    setProgrammaticFlight(isActive) {
      programmaticFlight = isActive;
      if (isActive) {
        pendingZoom = false;
        transientWheel = false;
        clear(settleTimer);
        clear(cooldownTimer);
        settleTimer = null;
        cooldownTimer = null;
      }
    },
    dispose() {
      disposed = true;
      clear(settleTimer);
      clear(cooldownTimer);
      active.clear();
    },
  };
}
