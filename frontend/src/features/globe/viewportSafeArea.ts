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

const BOTTOM_CLEARANCE_PX = 10;

/** Returns the part of the viewport that is visually clear of persistent UI.
 *  The desktop analytics panel (formerly a toggleable right-side drawer) is
 *  now an always-visible *floating* translucent panel on the left — same
 *  treatment as the sidebar and the variable data panel — so it no longer
 *  reserves dedicated canvas width (`right` stays 0). On mobile it's still a
 *  bottom sheet that pushes the globe up, since floating a large panel over
 *  a small touch screen would cover too much of the interactive globe. */
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
    right: 0,
  };
}
