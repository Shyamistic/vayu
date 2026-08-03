/**
 * Composite Overlay Store — Zustand state for multi-variable composite overlays.
 *
 * Manages up to 3 simultaneous variable overlays using different visualization
 * channels:
 *   slot 0 (primary)   → color fill (heatmap)
 *   slot 1 (secondary) → contour lines
 *   slot 2 (tertiary)  → arrows / barbs (wind)
 *
 * Supports individual opacity sliders and z-order (priority) controls per overlay,
 * plus a bivariate map mode encoding two variables in a single 2D color matrix.
 *
 * Requirements: 39.1, 39.2, 39.3, 39.4
 */

import { create } from 'zustand';
import { devtools, subscribeWithSelector } from 'zustand/middleware';
import type { VariableId } from '../../types';
import type { ColormapId } from '../../utils/colorScales';

// ── Types ────────────────────────────────────────────────────────────────────

/** Visual channel used to render a variable */
export type OverlayChannel = 'color_fill' | 'contours' | 'arrows';

/** One entry in the layer stack */
export interface OverlayEntry {
  /** Unique slot id (0, 1, 2) */
  slotId: number;
  /** Which climate variable this slot displays */
  variable: VariableId;
  /** Rendering channel */
  channel: OverlayChannel;
  /** Opacity 0–1 (applied via alpha blending, Req 39.2) */
  opacity: number;
  /** Z-order (render priority). Lower = rendered first = behind others. */
  zOrder: number;
  /** Whether this slot is currently visible */
  visible: boolean;
  /** Colormap for color_fill channel */
  colormap: ColormapId;
}

/** Mode for 2D bivariate color matrix (Req 39.4) */
export interface BivariateConfig {
  /** First variable (x-axis of 2D color matrix) */
  variableX: VariableId;
  /** Second variable (y-axis of 2D color matrix) */
  variableY: VariableId;
  /** Resolution of 2D matrix grid (n×n swatches) */
  matrixSize: number;
  /** Colormap for X-axis (low end) */
  colormapX: ColormapId;
  /** Colormap for Y-axis (low end) */
  colormapY: ColormapId;
}

// ── Store interface ──────────────────────────────────────────────────────────

export interface CompositeOverlayStore {
  /** Active overlay entries (max 3) */
  overlays: OverlayEntry[];

  /** Whether bivariate map mode is active (Req 39.4) */
  bivariateMode: boolean;

  /** Bivariate configuration (used when bivariateMode is true) */
  bivariateConfig: BivariateConfig;

  // ── Actions ─────────────────────────────────────────────────────────────

  /** Add an overlay to the stack (ignored if already 3 slots used) */
  addOverlay: (entry: Omit<OverlayEntry, 'slotId' | 'zOrder'>) => void;

  /** Remove overlay by slotId */
  removeOverlay: (slotId: number) => void;

  /** Update a specific overlay's properties */
  updateOverlay: (slotId: number, patch: Partial<Omit<OverlayEntry, 'slotId'>>) => void;

  /** Set opacity for a specific slot (clamped to [0, 1]) */
  setOpacity: (slotId: number, opacity: number) => void;

  /** Swap z-order between two slots */
  swapZOrder: (slotIdA: number, slotIdB: number) => void;

  /** Move a slot one step up in z-order (increases zOrder by 1) */
  moveUp: (slotId: number) => void;

  /** Move a slot one step down in z-order (decreases zOrder by 1) */
  moveDown: (slotId: number) => void;

  /** Toggle visibility of a slot */
  toggleVisibility: (slotId: number) => void;

  /** Enable/disable bivariate mode */
  setBivariateMode: (active: boolean) => void;

  /** Update bivariate configuration */
  updateBivariateConfig: (patch: Partial<BivariateConfig>) => void;

  /** Reset the layer stack to default (single rainfall/color_fill) */
  reset: () => void;
}

// ── Default state ─────────────────────────────────────────────────────────────

const DEFAULT_OVERLAYS: OverlayEntry[] = [
  {
    slotId: 0,
    variable: 'rainfall',
    channel: 'color_fill',
    opacity: 0.85,
    zOrder: 0,
    visible: true,
    colormap: 'imd_rain',
  },
];

const DEFAULT_BIVARIATE_CONFIG: BivariateConfig = {
  variableX: 'rainfall',
  variableY: 'temp_max',
  matrixSize: 4,
  colormapX: 'blues',
  colormapY: 'reds',
};

// ── Channel constraints ────────────────────────────────────────────────────────

/** Each channel may appear at most once in the stack */
const CHANNEL_VARIABLE_DEFAULTS: Record<OverlayChannel, { variable: VariableId; colormap: ColormapId }> = {
  color_fill: { variable: 'rainfall', colormap: 'imd_rain' },
  contours: { variable: 'temp_max', colormap: 'plasma' },
  arrows: { variable: 'temp_min', colormap: 'viridis' },
};

// ── Store ─────────────────────────────────────────────────────────────────────

export const useCompositeOverlayStore = create<CompositeOverlayStore>()(
  devtools(
    subscribeWithSelector((set, get) => ({
      overlays: DEFAULT_OVERLAYS,
      bivariateMode: false,
      bivariateConfig: DEFAULT_BIVARIATE_CONFIG,

      addOverlay: (entry) => {
        set((state) => {
          if (state.overlays.length >= 3) return state; // max 3 overlays (Req 39.1)

          // Prevent duplicate channels
          if (state.overlays.some((o) => o.channel === entry.channel)) return state;

          const nextSlotId = Math.max(-1, ...state.overlays.map((o) => o.slotId)) + 1;
          const nextZOrder = Math.max(-1, ...state.overlays.map((o) => o.zOrder)) + 1;

          return {
            overlays: [
              ...state.overlays,
              { ...entry, slotId: nextSlotId, zOrder: nextZOrder },
            ],
          };
        }, false, 'addOverlay');
      },

      removeOverlay: (slotId) => {
        set((state) => ({
          overlays: state.overlays.filter((o) => o.slotId !== slotId),
        }), false, 'removeOverlay');
      },

      updateOverlay: (slotId, patch) => {
        set((state) => ({
          overlays: state.overlays.map((o) =>
            o.slotId === slotId ? { ...o, ...patch } : o
          ),
        }), false, 'updateOverlay');
      },

      setOpacity: (slotId, opacity) => {
        const clamped = Math.max(0, Math.min(1, opacity));
        set((state) => ({
          overlays: state.overlays.map((o) =>
            o.slotId === slotId ? { ...o, opacity: clamped } : o
          ),
        }), false, 'setOpacity');
      },

      swapZOrder: (slotIdA, slotIdB) => {
        set((state) => {
          const a = state.overlays.find((o) => o.slotId === slotIdA);
          const b = state.overlays.find((o) => o.slotId === slotIdB);
          if (!a || !b) return state;
          const zOrderA = a.zOrder;
          const zOrderB = b.zOrder;
          return {
            overlays: state.overlays.map((o) => {
              if (o.slotId === slotIdA) return { ...o, zOrder: zOrderB };
              if (o.slotId === slotIdB) return { ...o, zOrder: zOrderA };
              return o;
            }),
          };
        }, false, 'swapZOrder');
      },

      moveUp: (slotId) => {
        set((state) => {
          const overlay = state.overlays.find((o) => o.slotId === slotId);
          if (!overlay) return state;
          const sorted = [...state.overlays].sort((a, b) => a.zOrder - b.zOrder);
          const idx = sorted.findIndex((o) => o.slotId === slotId);
          if (idx >= sorted.length - 1) return state; // already at top
          const above = sorted[idx + 1];
          return {
            overlays: state.overlays.map((o) => {
              if (o.slotId === slotId) return { ...o, zOrder: above.zOrder };
              if (o.slotId === above.slotId) return { ...o, zOrder: overlay.zOrder };
              return o;
            }),
          };
        }, false, 'moveUp');
      },

      moveDown: (slotId) => {
        set((state) => {
          const overlay = state.overlays.find((o) => o.slotId === slotId);
          if (!overlay) return state;
          const sorted = [...state.overlays].sort((a, b) => a.zOrder - b.zOrder);
          const idx = sorted.findIndex((o) => o.slotId === slotId);
          if (idx <= 0) return state; // already at bottom
          const below = sorted[idx - 1];
          return {
            overlays: state.overlays.map((o) => {
              if (o.slotId === slotId) return { ...o, zOrder: below.zOrder };
              if (o.slotId === below.slotId) return { ...o, zOrder: overlay.zOrder };
              return o;
            }),
          };
        }, false, 'moveDown');
      },

      toggleVisibility: (slotId) => {
        set((state) => ({
          overlays: state.overlays.map((o) =>
            o.slotId === slotId ? { ...o, visible: !o.visible } : o
          ),
        }), false, 'toggleVisibility');
      },

      setBivariateMode: (active) => {
        set({ bivariateMode: active }, false, 'setBivariateMode');
      },

      updateBivariateConfig: (patch) => {
        set((state) => ({
          bivariateConfig: { ...state.bivariateConfig, ...patch },
        }), false, 'updateBivariateConfig');
      },

      reset: () => {
        set({
          overlays: DEFAULT_OVERLAYS,
          bivariateMode: false,
          bivariateConfig: DEFAULT_BIVARIATE_CONFIG,
        }, false, 'reset');
      },
    })),
    { name: 'CompositeOverlayStore' },
  ),
);

// ── Exported default channel info ──────────────────────────────────────────────
export { CHANNEL_VARIABLE_DEFAULTS };
