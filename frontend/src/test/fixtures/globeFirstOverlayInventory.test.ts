import { describe, expect, it } from 'vitest';
import {
  APP_OVERLAY_INVENTORY,
  REQUIRED_OVERLAY_SURFACE_IDS,
  overlayInventoryById,
} from './globeFirstOverlayInventory';

describe('globe-first overlay inventory fixture', () => {
  it('maps every audited App surface to exactly one intended role with required audit fields', () => {
    expect(APP_OVERLAY_INVENTORY).toHaveLength(REQUIRED_OVERLAY_SURFACE_IDS.length);
    expect(new Set(APP_OVERLAY_INVENTORY.map(({ id }) => id))).toEqual(new Set(REQUIRED_OVERLAY_SURFACE_IDS));

    for (const surface of APP_OVERLAY_INVENTORY) {
      expect(surface.component).not.toHaveLength(0);
      expect(surface.source).not.toHaveLength(0);
      expect(surface.trigger).not.toHaveLength(0);
      expect(surface.currentStacking).not.toHaveLength(0);
      expect(surface.viewportFootprint.desktop).not.toHaveLength(0);
      expect(surface.viewportFootprint.mobile).not.toHaveLength(0);
      expect(surface.intendedRole).not.toHaveLength(0);
    }
  });

  it('preserves the current modal and focus limitations as refactor inputs', () => {
    expect(overlayInventoryById('cinematic-intro')).toMatchObject({
      appMountStatus: 'mounted-by-app', intendedRole: 'intro',
      currentModalBehavior: 'modal-semantics-without-focus-isolation', currentFocusBehavior: 'no-focus-management',
    });
    expect(overlayInventoryById('drawer')).toMatchObject({
      intendedRole: 'non-modal-sheet', currentModalBehavior: 'not-modal',
    });
    expect(overlayInventoryById('cell-info-card')).toMatchObject({ intendedRole: 'inspect-card' });
    expect(overlayInventoryById('command-palette')).toMatchObject({
      appMountStatus: 'not-mounted-by-app', intendedRole: 'modal-dialog',
      currentFocusBehavior: 'focus-first-input-without-trap-or-restoration',
    });
  });
});
