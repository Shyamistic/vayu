import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from './appStore';

describe('appStore', () => {
  beforeEach(() => {
    // Reset store to initial state between tests
    useAppStore.setState({
      viewMode: 'prediction',
      selectedVariable: 'rainfall',
      selectedRegion: 'western_ghats',
      forecastDay: 1,
      showUncertainty: false,
      showSplitScreen: false,
      show3D: false,
      showWind: false,
      showContours: false,
      showBoundaries: false,
      inspectMode: false,
      activeScenario: null,
      activePrediction: null,
      connectionStatus: 'connected',
      lastUpdated: null,
      isLoading: false,
      error: null,
    });
  });

  it('should initialize with default values', () => {
    const state = useAppStore.getState();
    expect(state.viewMode).toBe('prediction');
    expect(state.selectedVariable).toBe('rainfall');
    expect(state.selectedRegion).toBe('western_ghats');
    expect(state.forecastDay).toBe(1);
    expect(state.connectionStatus).toBe('connected');
  });

  it('setViewMode should update viewMode', () => {
    useAppStore.getState().setViewMode('scenario');
    expect(useAppStore.getState().viewMode).toBe('scenario');
  });

  it('setVariable should update selectedVariable', () => {
    useAppStore.getState().setVariable('temp_max');
    expect(useAppStore.getState().selectedVariable).toBe('temp_max');
  });

  it('setRegion should update selectedRegion', () => {
    useAppStore.getState().setRegion('central_india');
    expect(useAppStore.getState().selectedRegion).toBe('central_india');
  });

  it('setForecastDay should clamp between 1 and 7', () => {
    useAppStore.getState().setForecastDay(5);
    expect(useAppStore.getState().forecastDay).toBe(5);

    useAppStore.getState().setForecastDay(0);
    expect(useAppStore.getState().forecastDay).toBe(1);

    useAppStore.getState().setForecastDay(10);
    expect(useAppStore.getState().forecastDay).toBe(7);
  });

  it('toggleFeature should toggle boolean feature flags', () => {
    expect(useAppStore.getState().showWind).toBe(false);
    useAppStore.getState().toggleFeature('showWind');
    expect(useAppStore.getState().showWind).toBe(true);
    useAppStore.getState().toggleFeature('showWind');
    expect(useAppStore.getState().showWind).toBe(false);
  });

  it('setTimeState should merge partial time state', () => {
    useAppStore.getState().setTimeState({ isPlaying: true, playbackSpeed: 2 });
    const ts = useAppStore.getState().timeState;
    expect(ts.isPlaying).toBe(true);
    expect(ts.playbackSpeed).toBe(2);
    expect(ts.granularity).toBe('daily'); // unchanged
  });

  it('setConnectionStatus should update connection status', () => {
    useAppStore.getState().setConnectionStatus('offline');
    expect(useAppStore.getState().connectionStatus).toBe('offline');
  });
});
