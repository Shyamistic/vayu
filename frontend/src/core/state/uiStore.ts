import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { GridCell } from '../../types';
import type { ColormapId } from '../../utils/colorScales';

// ── Selected cell info (for inspect tool) ────────────────────────────────────

export interface SelectedCellInfo {
  cell: GridCell;
  x: number;
  y: number;
}

// ── UIStore interface ────────────────────────────────────────────────────────

export interface UIStore {
  // Panel visibility (Req 29.1, 29.2)
  drawerOpen: boolean;
  leftToolbarCollapsed: boolean;

  // Tour state
  showTour: boolean;
  tourStepIndex: number;

  // Inspect tool
  selectedCell: SelectedCellInfo | null;

  // Colormap selection
  colormap: ColormapId | undefined;

  // Keyboard hint visibility
  showKeyboardHint: boolean;

  // Actions
  setDrawerOpen: (open: boolean) => void;
  toggleDrawer: () => void;
  setLeftToolbarCollapsed: (collapsed: boolean) => void;
  toggleLeftToolbar: () => void;
  setShowTour: (show: boolean) => void;
  setTourStepIndex: (index: number) => void;
  setSelectedCell: (cell: SelectedCellInfo | null) => void;
  setColormap: (colormap: ColormapId | undefined) => void;
  setShowKeyboardHint: (show: boolean) => void;
}

// ── Store creation ───────────────────────────────────────────────────────────

export const useUIStore = create<UIStore>()(
  devtools(
    (set) => ({
      // Panel visibility defaults
      drawerOpen: false,
      leftToolbarCollapsed: false,

      // Tour defaults
      showTour: false,
      tourStepIndex: 0,

      // Inspect tool defaults
      selectedCell: null,

      // Colormap
      colormap: undefined,

      // Keyboard hint
      showKeyboardHint: true,

      // Actions
      setDrawerOpen: (open) => set({ drawerOpen: open }, false, 'setDrawerOpen'),
      toggleDrawer: () =>
        set((state) => ({ drawerOpen: !state.drawerOpen }), false, 'toggleDrawer'),
      setLeftToolbarCollapsed: (collapsed) =>
        set({ leftToolbarCollapsed: collapsed }, false, 'setLeftToolbarCollapsed'),
      toggleLeftToolbar: () =>
        set(
          (state) => ({ leftToolbarCollapsed: !state.leftToolbarCollapsed }),
          false,
          'toggleLeftToolbar',
        ),
      setShowTour: (show) => set({ showTour: show }, false, 'setShowTour'),
      setTourStepIndex: (index) =>
        set({ tourStepIndex: index }, false, 'setTourStepIndex'),
      setSelectedCell: (cell) => set({ selectedCell: cell }, false, 'setSelectedCell'),
      setColormap: (colormap) => set({ colormap }, false, 'setColormap'),
      setShowKeyboardHint: (show) =>
        set({ showKeyboardHint: show }, false, 'setShowKeyboardHint'),
    }),
    { name: 'UIStore' },
  ),
);
