export interface GlobeViewportMetrics {
  headerHeight: number;
  bottomChromeHeight: number;
  mobileDrawerHeight: number;
  drawerOpen: boolean;
  isDesktop: boolean;
  focusMode: boolean;
}

export interface GlobeViewportInsets {
  top: number;
  bottom: number;
  right: number;
}

const BOTTOM_CLEARANCE_PX = 16;
const DESKTOP_DRAWER_WIDTH_PX = 392;

/** Returns the part of the viewport that is visually clear of persistent UI. */
export function getGlobeViewportInsets({
  headerHeight,
  bottomChromeHeight,
  mobileDrawerHeight,
  drawerOpen,
  isDesktop,
  focusMode,
}: GlobeViewportMetrics): GlobeViewportInsets {
  if (focusMode) return { top: 0, bottom: 0, right: 0 };

  return {
    top: Math.max(0, Math.ceil(headerHeight)),
    bottom: Math.max(
      0,
      Math.ceil(bottomChromeHeight + BOTTOM_CLEARANCE_PX),
      !isDesktop && drawerOpen ? Math.ceil(mobileDrawerHeight + BOTTOM_CLEARANCE_PX) : 0,
    ),
    right: isDesktop && drawerOpen ? DESKTOP_DRAWER_WIDTH_PX : 0,
  };
}
