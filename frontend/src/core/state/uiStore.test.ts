import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore } from './uiStore';

describe('uiStore', () => {
  beforeEach(() => {
    useUIStore.setState({
      drawerOpen: false,
      leftToolbarCollapsed: false,
      showTour: false,
      tourStepIndex: 0,
      selectedCell: null,
      colormap: undefined,
      showKeyboardHint: true,
    });
  });

  it('should initialize with panels closed', () => {
    const state = useUIStore.getState();
    expect(state.drawerOpen).toBe(false);
    expect(state.leftToolbarCollapsed).toBe(false);
    expect(state.showTour).toBe(false);
  });

  it('toggleDrawer should flip drawer state', () => {
    useUIStore.getState().toggleDrawer();
    expect(useUIStore.getState().drawerOpen).toBe(true);
    useUIStore.getState().toggleDrawer();
    expect(useUIStore.getState().drawerOpen).toBe(false);
  });

  it('setDrawerOpen should set drawer state explicitly', () => {
    useUIStore.getState().setDrawerOpen(true);
    expect(useUIStore.getState().drawerOpen).toBe(true);
    useUIStore.getState().setDrawerOpen(false);
    expect(useUIStore.getState().drawerOpen).toBe(false);
  });

  it('setSelectedCell should store and clear cell info', () => {
    const cellInfo = {
      cell: { lat: 10, lon: 76, node_idx: 0, rainfall: 25, temp_max: 32, temp_min: 24, rainfall_uncertainty: 3, temp_max_uncertainty: 1, temp_min_uncertainty: 0.5 },
      x: 100,
      y: 200,
    };
    useUIStore.getState().setSelectedCell(cellInfo);
    expect(useUIStore.getState().selectedCell).toEqual(cellInfo);

    useUIStore.getState().setSelectedCell(null);
    expect(useUIStore.getState().selectedCell).toBeNull();
  });

  it('setShowTour should update tour visibility', () => {
    useUIStore.getState().setShowTour(true);
    expect(useUIStore.getState().showTour).toBe(true);
  });

  it('setTourStepIndex should update the current step', () => {
    useUIStore.getState().setTourStepIndex(3);
    expect(useUIStore.getState().tourStepIndex).toBe(3);
  });

  it('toggleLeftToolbar should flip collapsed state', () => {
    useUIStore.getState().toggleLeftToolbar();
    expect(useUIStore.getState().leftToolbarCollapsed).toBe(true);
    useUIStore.getState().toggleLeftToolbar();
    expect(useUIStore.getState().leftToolbarCollapsed).toBe(false);
  });
});
