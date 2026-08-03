/**
 * Animation Controls component for temporal forecast playback.
 *
 * Provides play/pause button, speed selector (1–10 fps), and a progress bar
 * showing the current forecast day during animation.
 *
 * Requirements: 11.1, 11.2
 */

import { useState, useCallback } from 'react';

export interface AnimationControlsProps {
  /** Whether the animation is currently playing */
  isPlaying: boolean;
  /** Current forecast day being displayed (1–7) */
  currentDay: number;
  /** Total number of forecast days (typically 7) */
  totalDays?: number;
  /** Current FPS setting */
  fps: number;
  /** Whether data is preloaded and ready for playback */
  isReady: boolean;
  /** Called when user clicks play */
  onPlay: (fps: number) => void;
  /** Called when user clicks pause/stop */
  onStop: () => void;
  /** Called when user changes the speed setting */
  onSpeedChange: (fps: number) => void;
}

export function AnimationControls({
  isPlaying,
  currentDay,
  totalDays = 7,
  fps,
  isReady,
  onPlay,
  onStop,
  onSpeedChange,
}: AnimationControlsProps) {
  const [localFps, setLocalFps] = useState(fps);

  const handlePlayPause = useCallback(() => {
    if (isPlaying) {
      onStop();
    } else {
      onPlay(localFps);
    }
  }, [isPlaying, localFps, onPlay, onStop]);

  const handleSpeedChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const newFps = Number(e.target.value);
      setLocalFps(newFps);
      onSpeedChange(newFps);
    },
    [onSpeedChange],
  );

  // Progress as a percentage (0–100)
  const progress = ((currentDay - 1) / (totalDays - 1)) * 100;

  return (
    <div
      className="animation-controls"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '8px 16px',
        borderRadius: '8px',
        background: 'rgba(15, 23, 42, 0.85)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        color: '#e2e8f0',
        fontSize: '13px',
        fontFamily: 'Inter, sans-serif',
      }}
    >
      {/* Play/Pause Button */}
      <button
        onClick={handlePlayPause}
        disabled={!isReady}
        aria-label={isPlaying ? 'Pause animation' : 'Play animation'}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '32px',
          height: '32px',
          borderRadius: '50%',
          border: 'none',
          background: isPlaying
            ? 'rgba(239, 68, 68, 0.8)'
            : 'rgba(59, 130, 246, 0.8)',
          color: '#ffffff',
          cursor: isReady ? 'pointer' : 'not-allowed',
          opacity: isReady ? 1 : 0.5,
          fontSize: '14px',
          transition: 'background 200ms cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        {isPlaying ? '⏸' : '▶'}
      </button>

      {/* Progress Bar */}
      <div
        style={{
          flex: 1,
          minWidth: '120px',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '11px',
            color: '#94a3b8',
          }}
        >
          <span>Day {Math.floor(currentDay)}</span>
          <span>{totalDays} days</span>
        </div>
        <div
          role="progressbar"
          aria-valuenow={currentDay}
          aria-valuemin={1}
          aria-valuemax={totalDays}
          aria-label={`Animation progress: Day ${Math.floor(currentDay)} of ${totalDays}`}
          style={{
            width: '100%',
            height: '4px',
            borderRadius: '2px',
            background: 'rgba(255, 255, 255, 0.1)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${progress}%`,
              height: '100%',
              borderRadius: '2px',
              background: 'linear-gradient(90deg, #3b82f6, #06b6d4)',
              transition: 'width 100ms linear',
            }}
          />
        </div>
      </div>

      {/* Speed Selector */}
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: '12px',
          color: '#94a3b8',
        }}
      >
        Speed:
        <select
          value={localFps}
          onChange={handleSpeedChange}
          aria-label="Animation speed (frames per second)"
          style={{
            background: 'rgba(30, 41, 59, 0.9)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            borderRadius: '4px',
            color: '#e2e8f0',
            padding: '2px 6px',
            fontSize: '12px',
            cursor: 'pointer',
          }}
        >
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) => (
            <option key={value} value={value}>
              {value} fps
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
