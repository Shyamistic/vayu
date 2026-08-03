import { describe, expect, it } from 'vitest';
import { getGlobeViewportInsets } from './viewportSafeArea';

const base = {
  headerHeight: 56,
  bottomChromeHeight: 140,
  mobileDrawerHeight: 0,
  drawerOpen: false,
  isDesktop: true,
  focusMode: false,
};

describe('getGlobeViewportInsets', () => {
  it('centers the usable canvas between persistent desktop chrome', () => {
    expect(getGlobeViewportInsets(base)).toEqual({ top: 56, bottom: 156, right: 0 });
  });

  it('reserves the open desktop drawer without changing vertical clearance', () => {
    expect(getGlobeViewportInsets({ ...base, drawerOpen: true })).toEqual({ top: 56, bottom: 156, right: 392 });
  });

  it('uses the taller mobile drawer rather than allowing it to cover the globe', () => {
    expect(getGlobeViewportInsets({ ...base, isDesktop: false, drawerOpen: true, mobileDrawerHeight: 250 }))
      .toEqual({ top: 56, bottom: 266, right: 0 });
  });

  it('restores the full canvas in globe focus mode', () => {
    expect(getGlobeViewportInsets({ ...base, drawerOpen: true, focusMode: true }))
      .toEqual({ top: 0, bottom: 0, right: 0 });
  });
});
