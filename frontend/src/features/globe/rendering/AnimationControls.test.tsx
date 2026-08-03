/**
 * Unit tests for AnimationControls component.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnimationControls } from './AnimationControls';

describe('AnimationControls', () => {
  const defaultProps = {
    isPlaying: false,
    currentDay: 1,
    totalDays: 7,
    fps: 2,
    isReady: true,
    onPlay: vi.fn(),
    onStop: vi.fn(),
    onSpeedChange: vi.fn(),
  };

  it('renders play button when not playing', () => {
    render(<AnimationControls {...defaultProps} />);
    expect(screen.getByLabelText('Play animation')).toBeInTheDocument();
  });

  it('renders pause button when playing', () => {
    render(<AnimationControls {...defaultProps} isPlaying={true} />);
    expect(screen.getByLabelText('Pause animation')).toBeInTheDocument();
  });

  it('calls onPlay when play button is clicked', () => {
    const onPlay = vi.fn();
    render(<AnimationControls {...defaultProps} onPlay={onPlay} />);
    
    fireEvent.click(screen.getByLabelText('Play animation'));
    expect(onPlay).toHaveBeenCalledWith(2);
  });

  it('calls onStop when pause button is clicked', () => {
    const onStop = vi.fn();
    render(<AnimationControls {...defaultProps} isPlaying={true} onStop={onStop} />);
    
    fireEvent.click(screen.getByLabelText('Pause animation'));
    expect(onStop).toHaveBeenCalled();
  });

  it('disables play button when not ready', () => {
    render(<AnimationControls {...defaultProps} isReady={false} />);
    
    const button = screen.getByLabelText('Play animation');
    expect(button).toBeDisabled();
  });

  it('displays current day in progress indicator', () => {
    render(<AnimationControls {...defaultProps} currentDay={3} />);
    expect(screen.getByText('Day 3')).toBeInTheDocument();
  });

  it('displays total days', () => {
    render(<AnimationControls {...defaultProps} totalDays={7} />);
    expect(screen.getByText('7 days')).toBeInTheDocument();
  });

  it('renders a progress bar with correct aria attributes', () => {
    render(<AnimationControls {...defaultProps} currentDay={4} totalDays={7} />);
    
    const progressbar = screen.getByRole('progressbar');
    expect(progressbar).toHaveAttribute('aria-valuenow', '4');
    expect(progressbar).toHaveAttribute('aria-valuemin', '1');
    expect(progressbar).toHaveAttribute('aria-valuemax', '7');
  });

  it('calls onSpeedChange when speed selector is changed', () => {
    const onSpeedChange = vi.fn();
    render(<AnimationControls {...defaultProps} onSpeedChange={onSpeedChange} />);
    
    const select = screen.getByLabelText('Animation speed (frames per second)');
    fireEvent.change(select, { target: { value: '5' } });
    
    expect(onSpeedChange).toHaveBeenCalledWith(5);
  });

  it('renders all 10 FPS options in the speed selector', () => {
    render(<AnimationControls {...defaultProps} />);
    
    const select = screen.getByLabelText('Animation speed (frames per second)');
    const options = select.querySelectorAll('option');
    expect(options).toHaveLength(10);
  });
});
