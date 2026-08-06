import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RegionSelector, { REGIONS } from './RegionSelector';

describe('RegionSelector', () => {
  it('renders closed by default, showing only the trigger with the selected label', () => {
    const onChange = vi.fn();
    render(<RegionSelector selected="full_india" onChange={onChange} />);

    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button')).toHaveTextContent('All India');
  });

  it('opens the dropdown on trigger click and lists all 5 regions', () => {
    const onChange = vi.fn();
    render(<RegionSelector selected="full_india" onChange={onChange} />);

    fireEvent.click(screen.getByRole('button'));

    // 1 trigger + 5 options
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(6);
    REGIONS.forEach((r) => {
      expect(screen.getByTitle(r.label)).toBeInTheDocument();
    });
  });

  it('fires onChange and closes the dropdown when an option is picked', () => {
    const onChange = vi.fn();
    render(<RegionSelector selected="full_india" onChange={onChange} />);

    fireEvent.click(screen.getByRole('button')); // open
    fireEvent.click(screen.getByText('Central India'));

    expect(onChange).toHaveBeenCalledWith('central_india');
    // Dropdown closed again — back to just the trigger
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('highlights the selected region in the open list', () => {
    const onChange = vi.fn();
    render(<RegionSelector selected="western_ghats" onChange={onChange} />);

    fireEvent.click(screen.getByRole('button'));
    const westernGhatsOption = screen.getByTitle('Western Ghats');
    expect(westernGhatsOption.className).toContain('bg-blue-500/20');
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
    fireEvent.click(screen.getByRole('button'));
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
    fireEvent.click(screen.getByRole('button'));

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
