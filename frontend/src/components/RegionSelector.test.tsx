import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RegionSelector, { REGIONS } from './RegionSelector';

describe('RegionSelector', () => {
  it('renders all 5 regions as enabled buttons', () => {
    const onChange = vi.fn();
    render(<RegionSelector selected="full_india" onChange={onChange} />);

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(5);

    // All buttons should be clickable (no disabled/cursor-not-allowed)
    buttons.forEach((btn) => {
      expect(btn).not.toHaveAttribute('disabled');
      expect(btn.className).not.toContain('cursor-not-allowed');
      expect(btn.className).not.toContain('opacity-50');
    });
  });

  it('fires onChange for every region (none are disabled)', () => {
    const onChange = vi.fn();
    render(<RegionSelector selected="full_india" onChange={onChange} />);

    const buttons = screen.getAllByRole('button');
    buttons.forEach((btn, idx) => {
      fireEvent.click(btn);
      expect(onChange).toHaveBeenCalledWith(REGIONS[idx].id);
    });
    expect(onChange).toHaveBeenCalledTimes(5);
  });

  it('highlights the selected region with active styling', () => {
    const onChange = vi.fn();
    render(<RegionSelector selected="western_ghats" onChange={onChange} />);

    const buttons = screen.getAllByRole('button');
    const westernGhatsBtn = buttons[0];
    expect(westernGhatsBtn.className).toContain('bg-blue-500/20');
    expect(westernGhatsBtn.className).toContain('border-blue-400/60');
  });

  it('each region has center coordinates and altitude defined', () => {
    expect(REGIONS).toHaveLength(5);
    REGIONS.forEach((r) => {
      expect(r.centerLat).toBeGreaterThan(0);
      expect(r.centerLon).toBeGreaterThan(0);
      expect(r.altitude).toBeGreaterThan(0);
      expect(r.id).toBeTruthy();
      expect(r.label).toBeTruthy();
    });
  });

  it('contains all required region IDs', () => {
    const ids = REGIONS.map((r) => r.id);
    expect(ids).toContain('western_ghats');
    expect(ids).toContain('north_east_india');
    expect(ids).toContain('indo_gangetic_plain');
    expect(ids).toContain('central_india');
    expect(ids).toContain('full_india');
  });
});


describe('live-data indicator', () => {
  it('shows no indicator when realDataRegions is omitted', () => {
    const onChange = vi.fn();
    render(<RegionSelector selected="full_india" onChange={onChange} />);
    expect(document.querySelector('.animate-pulse')).toBeNull();
  });

  it('marks only the regions present in realDataRegions as live', () => {
    const onChange = vi.fn();
    render(
      <RegionSelector
        selected="full_india"
        onChange={onChange}
        realDataRegions={['western_ghats', 'central_india']}
      />,
    );

    const westernGhatsBtn = screen.getByTitle('Western Ghats — live model data');
    const centralIndiaBtn = screen.getByTitle('Central India — live model data');
    const northEastBtn = screen.getByTitle('North-East India');

    expect(westernGhatsBtn.querySelector('.animate-pulse')).not.toBeNull();
    expect(centralIndiaBtn.querySelector('.animate-pulse')).not.toBeNull();
    expect(northEastBtn.querySelector('.animate-pulse')).toBeNull();
  });
});

describe('regional camera bounds', () => {
  it('uses the authoritative North-East model extent and a full-India overview extent', () => {
    const northEast = REGIONS.find((region) => region.id === 'north_east_india');
    const overview = REGIONS.find((region) => region.id === 'full_india');

    expect(northEast?.bounds).toEqual({ latMin: 22.0, latMax: 29.5, lonMin: 88.0, lonMax: 97.5 });
    expect(overview?.bounds).toEqual({ latMin: 6.0, latMax: 38.0, lonMin: 66.0, lonMax: 100.0 });
  });
});