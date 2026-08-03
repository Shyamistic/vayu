/**
 * Unit tests — LayerStackPanel React component.
 *
 * Validates:
 *  - Panel renders with initial overlay slot
 *  - Opacity slider is present and labelled
 *  - "Add Overlay" button is present when < 3 overlays
 *  - "Add Overlay" button is absent when 3 overlays active
 *  - Bivariate toggle is rendered
 *  - BivariateColorLegend appears when bivariate mode is on
 *  - Individual remove (✕) buttons are rendered per slot
 *
 * Requirements: 39.1, 39.2, 39.3, 39.4
 */

import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LayerStackPanel } from './LayerStackPanel';
import { useCompositeOverlayStore } from '../../core/state/compositeOverlayStore';

// Reset store before each test
beforeEach(() => {
  useCompositeOverlayStore.getState().reset();
});

describe('LayerStackPanel', () => {
  it('renders the panel heading', () => {
    render(<LayerStackPanel />);
    expect(screen.getByText(/Layer Stack/i)).toBeDefined();
  });

  it('shows "1/3 active" by default', () => {
    render(<LayerStackPanel />);
    expect(screen.getByText(/1\/3 active/i)).toBeDefined();
  });

  it('renders the default color_fill slot label', () => {
    render(<LayerStackPanel />);
    expect(screen.getByText(/Color Fill/i)).toBeDefined();
  });

  it('renders an opacity slider for the default slot', () => {
    render(<LayerStackPanel />);
    const slider = screen.getByRole('slider');
    expect(slider).toBeDefined();
  });

  it('renders "Add Overlay" button when < 3 overlays', () => {
    render(<LayerStackPanel />);
    expect(screen.getByText(/\+ Add Overlay/i)).toBeDefined();
  });

  it('does not render panel when visible=false', () => {
    const { container } = render(<LayerStackPanel visible={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders Bivariate Map toggle', () => {
    render(<LayerStackPanel />);
    expect(screen.getByText(/Bivariate Map/i)).toBeDefined();
  });

  it('shows bivariate config when toggle is clicked', () => {
    render(<LayerStackPanel />);
    const toggle = screen.getByRole('switch', { name: /bivariate map mode/i });
    fireEvent.click(toggle);
    expect(screen.getByText(/Bivariate Map Settings/i)).toBeDefined();
  });

  it('hides the layer slot list in bivariate mode', () => {
    // Turn on bivariate before render
    useCompositeOverlayStore.getState().setBivariateMode(true);
    render(<LayerStackPanel />);
    // Color Fill slot row should not be visible in bivariate mode
    expect(screen.queryByText(/\+ Add Overlay/i)).toBeNull();
  });

  it('renders a remove button (✕) per slot', () => {
    render(<LayerStackPanel />);
    const removeBtns = screen.getAllByTitle('Remove');
    expect(removeBtns.length).toBe(1); // 1 slot by default
  });

  it('shows "Max 3 overlays" notice when at capacity', () => {
    const store = useCompositeOverlayStore.getState();
    store.addOverlay({ variable: 'temp_max', channel: 'contours', opacity: 0.8, visible: true, colormap: 'plasma' });
    store.addOverlay({ variable: 'temp_min', channel: 'arrows',   opacity: 0.6, visible: true, colormap: 'viridis' });
    render(<LayerStackPanel />);
    expect(screen.getByText(/Max 3 overlays/i)).toBeDefined();
    expect(screen.queryByText(/\+ Add Overlay/i)).toBeNull();
  });

  it('opacity slider updates store when changed', () => {
    render(<LayerStackPanel />);
    const slider = screen.getByRole('slider') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '0.4' } });
    const store = useCompositeOverlayStore.getState();
    expect(store.overlays[0].opacity).toBeCloseTo(0.4, 3);
  });
});
