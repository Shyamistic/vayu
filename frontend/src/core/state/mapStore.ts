import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

// ── Earth layer types ────────────────────────────────────────────────────────

export type EarthLayer =
  | 'satellite'
  | 'modis'
  | 'precipitation'
  | 'cloud'
  | 'sst'
  | 'photorealistic';

// ── Camera state ─────────────────────────────────────────────────────────────

export interface CameraState {
  latitude: number;
  longitude: number;
  altitude: number;
  heading: number;
  pitch: number;
  roll: number;
}

// ── Tour camera step (for guided tour flyTo) ─────────────────────────────────

export interface TourCameraStep {
  lat: number;
  lon: number;
  altitude: number;
  pitch: number;
  duration: number;
}

// ── MapStore interface ───────────────────────────────────────────────────────

export interface MapStore {
  // Camera
  camera: CameraState;

  // Layer visibility
  activeLayer: EarthLayer;
  showHeatmap: boolean;
  terrainExaggeration: number;

  // GIBS imagery date
  gibsDate: string;

  // Tour navigation
  tourStep: TourCameraStep | null;

  // Region fly trigger (incremented to trigger flyTo)
  regionFlyTrigger: number;

  // Actions
  setCamera: (camera: Partial<CameraState>) => void;
  setActiveLayer: (layer: EarthLayer) => void;
  toggleLayer: (layer: EarthLayer) => void;
  setShowHeatmap: (show: boolean) => void;
  setTerrainExaggeration: (value: number) => void;
  setGibsDate: (date: string) => void;
  setTourStep: (step: TourCameraStep | null) => void;
  triggerRegionFly: () => void;
}

// ── Default camera (centered on India) ───────────────────────────────────────

const DEFAULT_CAMERA: CameraState = {
  latitude: 20.5937,
  longitude: 78.9629,
  altitude: 5_000_000,
  heading: 0,
  pitch: -90,
  roll: 0,
};

// ── Default GIBS date (14 days ago for availability) ─────────────────────────

function getDefaultGibsDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 14);
  return d.toISOString().split('T')[0];
}

// ── Store creation ───────────────────────────────────────────────────────────

export const useMapStore = create<MapStore>()(
  devtools(
    (set) => ({
      // Camera defaults
      camera: DEFAULT_CAMERA,

      // Layer defaults
      activeLayer: 'satellite',
      showHeatmap: true,
      terrainExaggeration: 1,

      // GIBS date
      gibsDate: getDefaultGibsDate(),

      // Tour
      tourStep: null,

      // Region fly
      regionFlyTrigger: 0,

      // Actions
      setCamera: (patch) =>
        set(
          (state) => ({ camera: { ...state.camera, ...patch } }),
          false,
          'setCamera',
        ),
      setActiveLayer: (layer) => set({ activeLayer: layer }, false, 'setActiveLayer'),
      toggleLayer: (layer) =>
        set(
          (state) => ({
            activeLayer: state.activeLayer === layer ? 'satellite' : layer,
          }),
          false,
          'toggleLayer',
        ),
      setShowHeatmap: (show) => set({ showHeatmap: show }, false, 'setShowHeatmap'),
      setTerrainExaggeration: (value) =>
        set(
          { terrainExaggeration: Math.max(1, Math.min(5, value)) },
          false,
          'setTerrainExaggeration',
        ),
      setGibsDate: (date) => set({ gibsDate: date }, false, 'setGibsDate'),
      setTourStep: (step) => set({ tourStep: step }, false, 'setTourStep'),
      triggerRegionFly: () =>
        set(
          (state) => ({ regionFlyTrigger: state.regionFlyTrigger + 1 }),
          false,
          'triggerRegionFly',
        ),
    }),
    { name: 'MapStore' },
  ),
);
