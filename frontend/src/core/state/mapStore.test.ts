import { describe, it, expect, beforeEach } from 'vitest';
import { useMapStore } from './mapStore';

describe('mapStore', () => {
  beforeEach(() => {
    useMapStore.setState({
      camera: {
        latitude: 20.5937,
        longitude: 78.9629,
        altitude: 5_000_000,
        heading: 0,
        pitch: -90,
        roll: 0,
      },
      activeLayer: 'satellite',
      showHeatmap: true,
      terrainExaggeration: 1,
      tourStep: null,
      regionFlyTrigger: 0,
    });
  });

  it('should initialize with default camera centered on India', () => {
    const state = useMapStore.getState();
    expect(state.camera.latitude).toBeCloseTo(20.5937);
    expect(state.camera.longitude).toBeCloseTo(78.9629);
    expect(state.activeLayer).toBe('satellite');
  });

  it('setActiveLayer should update the active layer', () => {
    useMapStore.getState().setActiveLayer('precipitation');
    expect(useMapStore.getState().activeLayer).toBe('precipitation');
  });

  it('toggleLayer should toggle between layer and satellite', () => {
    useMapStore.getState().toggleLayer('cloud');
    expect(useMapStore.getState().activeLayer).toBe('cloud');

    // Toggling same layer again should revert to satellite
    useMapStore.getState().toggleLayer('cloud');
    expect(useMapStore.getState().activeLayer).toBe('satellite');
  });

  it('setTerrainExaggeration should clamp between 1 and 5', () => {
    useMapStore.getState().setTerrainExaggeration(3);
    expect(useMapStore.getState().terrainExaggeration).toBe(3);

    useMapStore.getState().setTerrainExaggeration(0);
    expect(useMapStore.getState().terrainExaggeration).toBe(1);

    useMapStore.getState().setTerrainExaggeration(10);
    expect(useMapStore.getState().terrainExaggeration).toBe(5);
  });

  it('setCamera should merge partial camera state', () => {
    useMapStore.getState().setCamera({ altitude: 1_000_000, heading: 45 });
    const cam = useMapStore.getState().camera;
    expect(cam.altitude).toBe(1_000_000);
    expect(cam.heading).toBe(45);
    expect(cam.latitude).toBeCloseTo(20.5937); // unchanged
  });

  it('triggerRegionFly should increment the trigger counter', () => {
    expect(useMapStore.getState().regionFlyTrigger).toBe(0);
    useMapStore.getState().triggerRegionFly();
    expect(useMapStore.getState().regionFlyTrigger).toBe(1);
    useMapStore.getState().triggerRegionFly();
    expect(useMapStore.getState().regionFlyTrigger).toBe(2);
  });

  it('setTourStep should set and clear tour steps', () => {
    const step = { lat: 12.97, lon: 77.59, altitude: 500_000, pitch: -45, duration: 2 };
    useMapStore.getState().setTourStep(step);
    expect(useMapStore.getState().tourStep).toEqual(step);

    useMapStore.getState().setTourStep(null);
    expect(useMapStore.getState().tourStep).toBeNull();
  });
});
