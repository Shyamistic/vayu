/**
 * LayerStackPanel — UI panel for managing multi-variable composite overlays.
 *
 * Provides:
 *  - List of active overlay slots (up to 3) with labels, channel badges,
 *    individual opacity sliders, z-order controls (↑ ↓), and visibility toggles
 *  - "Add overlay" button to open a variable/channel picker (respects 3-slot limit)
 *  - "Bivariate Map" toggle activating 2D colour matrix mode
 *  - Inline BivariateColorLegend when bivariate mode is active
 *
 * Connects to the CompositeOverlayStore via Zustand hooks.
 *
 * Requirements: 39.1, 39.2, 39.3, 39.4
 */

import React, { useState } from 'react';
import { GlassPanel } from '../../design-system/GlassPanel';
import { BivariateColorLegend } from './layers/BivariateColorLegend';
import {
  useCompositeOverlayStore,
  CHANNEL_VARIABLE_DEFAULTS,
  type OverlayChannel,
  type OverlayEntry,
} from '../../core/state/compositeOverlayStore';
import type { VariableId } from '../../types';
import type { ColormapId } from '../../utils/colorScales';

// ── Static label maps ─────────────────────────────────────────────────────────

const CHANNEL_LABELS: Record<OverlayChannel, string> = {
  color_fill: 'Color Fill',
  contours: 'Contours',
  arrows: 'Arrows',
};

const CHANNEL_COLORS: Record<OverlayChannel, string> = {
  color_fill: 'rgba(0,180,255,0.25)',
  contours: 'rgba(255,200,0,0.25)',
  arrows: 'rgba(100,255,180,0.25)',
};

const VARIABLE_LABELS: Record<VariableId, string> = {
  rainfall: 'Rainfall',
  temp_max: 'Max Temp',
  temp_min: 'Min Temp',
};

const COLORMAP_OPTIONS: Array<{ id: ColormapId; label: string }> = [
  { id: 'imd_rain', label: 'IMD Rain' },
  { id: 'viridis', label: 'Viridis' },
  { id: 'plasma', label: 'Plasma' },
  { id: 'blues', label: 'Blues' },
  { id: 'reds', label: 'Reds' },
  { id: 'earth_temp', label: 'Earth Temp' },
  { id: 'cividis', label: 'Cividis ♿' },
];

// ── Slot row ──────────────────────────────────────────────────────────────────

interface SlotRowProps {
  entry: OverlayEntry;
  isFirst: boolean;
  isLast: boolean;
}

const SlotRow: React.FC<SlotRowProps> = ({ entry, isFirst, isLast }) => {
  const { setOpacity, moveUp, moveDown, toggleVisibility, removeOverlay, updateOverlay } =
    useCompositeOverlayStore();

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '8px 10px',
        borderRadius: 8,
        background: CHANNEL_COLORS[entry.channel],
        border: '1px solid rgba(255,255,255,0.08)',
        opacity: entry.visible ? 1 : 0.45,
        transition: 'opacity 0.2s',
      }}
      aria-label={`Overlay slot: ${VARIABLE_LABELS[entry.variable]} via ${CHANNEL_LABELS[entry.channel]}`}
    >
      {/* Header row: label + controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {/* Visibility toggle */}
        <button
          onClick={() => toggleVisibility(entry.slotId)}
          aria-pressed={entry.visible}
          aria-label={entry.visible ? 'Hide overlay' : 'Show overlay'}
          style={iconBtn}
          title={entry.visible ? 'Hide' : 'Show'}
        >
          {entry.visible ? '👁' : '🚫'}
        </button>

        {/* Variable name + channel badge */}
        <span style={{ flex: 1, fontSize: 12, color: '#fff', fontWeight: 500 }}>
          {VARIABLE_LABELS[entry.variable]}
          <span
            style={{
              marginLeft: 6,
              fontSize: 10,
              color: 'rgba(255,255,255,0.55)',
              fontWeight: 400,
            }}
          >
            [{CHANNEL_LABELS[entry.channel]}]
          </span>
        </span>

        {/* Z-order arrows */}
        <button
          onClick={() => moveDown(entry.slotId)}
          disabled={isFirst}
          aria-label="Move layer down in z-order"
          style={{ ...iconBtn, opacity: isFirst ? 0.3 : 1 }}
          title="Move down"
        >
          ↓
        </button>
        <button
          onClick={() => moveUp(entry.slotId)}
          disabled={isLast}
          aria-label="Move layer up in z-order"
          style={{ ...iconBtn, opacity: isLast ? 0.3 : 1 }}
          title="Move up"
        >
          ↑
        </button>

        {/* Remove */}
        <button
          onClick={() => removeOverlay(entry.slotId)}
          aria-label="Remove overlay"
          style={{ ...iconBtn, color: 'rgba(255,80,80,0.8)' }}
          title="Remove"
        >
          ✕
        </button>
      </div>

      {/* Opacity slider (Req 39.3) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <label
          htmlFor={`opacity-slider-${entry.slotId}`}
          style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', whiteSpace: 'nowrap' }}
        >
          Opacity
        </label>
        <input
          id={`opacity-slider-${entry.slotId}`}
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={entry.opacity}
          onChange={(e) => setOpacity(entry.slotId, parseFloat(e.target.value))}
          aria-label={`Opacity for ${VARIABLE_LABELS[entry.variable]}`}
          style={{ flex: 1, accentColor: '#00b4ff' }}
        />
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', width: 30, textAlign: 'right' }}>
          {Math.round(entry.opacity * 100)}%
        </span>
      </div>

      {/* Colormap selector (only for color_fill channel) */}
      {entry.channel === 'color_fill' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label
            htmlFor={`colormap-${entry.slotId}`}
            style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', whiteSpace: 'nowrap' }}
          >
            Colormap
          </label>
          <select
            id={`colormap-${entry.slotId}`}
            value={entry.colormap}
            onChange={(e) => updateOverlay(entry.slotId, { colormap: e.target.value as ColormapId })}
            aria-label="Select colormap"
            style={selectStyle}
          >
            {COLORMAP_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
};

// ── Add overlay picker ─────────────────────────────────────────────────────────

const AVAILABLE_CHANNELS: OverlayChannel[] = ['color_fill', 'contours', 'arrows'];
const AVAILABLE_VARIABLES: VariableId[] = ['rainfall', 'temp_max', 'temp_min'];

interface AddOverlayPickerProps {
  existingChannels: Set<OverlayChannel>;
  onAdd: (channel: OverlayChannel, variable: VariableId) => void;
  onCancel: () => void;
}

const AddOverlayPicker: React.FC<AddOverlayPickerProps> = ({
  existingChannels,
  onAdd,
  onCancel,
}) => {
  const [selectedChannel, setSelectedChannel] = useState<OverlayChannel>(() => {
    for (const ch of AVAILABLE_CHANNELS) {
      if (!existingChannels.has(ch)) return ch;
    }
    return 'color_fill';
  });
  const [selectedVariable, setSelectedVariable] = useState<VariableId>(
    () => CHANNEL_VARIABLE_DEFAULTS[selectedChannel].variable,
  );

  return (
    <div
      style={{
        padding: '8px 10px',
        borderRadius: 8,
        background: 'rgba(255,255,255,0.06)',
        border: '1px dashed rgba(255,255,255,0.2)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', fontWeight: 500 }}>
        Add Overlay
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <label style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', width: 56 }}>Channel</label>
        <select
          value={selectedChannel}
          onChange={(e) => {
            const ch = e.target.value as OverlayChannel;
            setSelectedChannel(ch);
            setSelectedVariable(CHANNEL_VARIABLE_DEFAULTS[ch].variable);
          }}
          style={selectStyle}
          aria-label="Select rendering channel"
        >
          {AVAILABLE_CHANNELS.map((ch) => (
            <option key={ch} value={ch} disabled={existingChannels.has(ch)}>
              {CHANNEL_LABELS[ch]}{existingChannels.has(ch) ? ' (in use)' : ''}
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <label style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', width: 56 }}>Variable</label>
        <select
          value={selectedVariable}
          onChange={(e) => setSelectedVariable(e.target.value as VariableId)}
          style={selectStyle}
          aria-label="Select climate variable"
        >
          {AVAILABLE_VARIABLES.map((v) => (
            <option key={v} value={v}>
              {VARIABLE_LABELS[v]}
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={() => onAdd(selectedChannel, selectedVariable)}
          disabled={existingChannels.has(selectedChannel)}
          style={{ ...actionBtn, flex: 1 }}
          aria-label="Confirm add overlay"
        >
          Add
        </button>
        <button onClick={onCancel} style={{ ...actionBtn, background: 'rgba(255,255,255,0.08)' }} aria-label="Cancel">
          Cancel
        </button>
      </div>
    </div>
  );
};

// ── Bivariate config section ──────────────────────────────────────────────────

const BivariatePicker: React.FC = () => {
  const { bivariateConfig, updateBivariateConfig } = useCompositeOverlayStore();

  return (
    <div
      style={{
        padding: '8px 10px',
        borderRadius: 8,
        background: 'rgba(180,0,255,0.08)',
        border: '1px solid rgba(180,0,255,0.25)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ fontSize: 11, color: 'rgba(220,180,255,0.9)', fontWeight: 500 }}>
        Bivariate Map Settings
      </div>

      {(['variableX', 'variableY'] as const).map((axis) => (
        <div key={axis} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <label style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', width: 52 }}>
            {axis === 'variableX' ? 'X-axis' : 'Y-axis'}
          </label>
          <select
            value={bivariateConfig[axis]}
            onChange={(e) =>
              updateBivariateConfig({ [axis]: e.target.value as VariableId })
            }
            style={selectStyle}
            aria-label={`Select ${axis} variable for bivariate map`}
          >
            {AVAILABLE_VARIABLES.map((v) => (
              <option key={v} value={v}>
                {VARIABLE_LABELS[v]}
              </option>
            ))}
          </select>
        </div>
      ))}

      {/* 2D colour matrix legend (Req 39.4) */}
      <div style={{ paddingTop: 4 }}>
        <BivariateColorLegend
          variableX={bivariateConfig.variableX}
          variableY={bivariateConfig.variableY}
          colormapX={bivariateConfig.colormapX}
          colormapY={bivariateConfig.colormapY}
          matrixSize={bivariateConfig.matrixSize}
          size={110}
        />
      </div>
    </div>
  );
};

// ── Main panel ────────────────────────────────────────────────────────────────

export interface LayerStackPanelProps {
  /** Whether the panel should be visible */
  visible?: boolean;
  className?: string;
}

/**
 * Layer Stack Panel — manages multi-variable composite overlays (Req 39.3).
 *
 * Validates: Requirements 39.1, 39.2, 39.3, 39.4
 */
export const LayerStackPanel: React.FC<LayerStackPanelProps> = ({
  visible = true,
  className = '',
}) => {
  const { overlays, bivariateMode, setBivariateMode, addOverlay } =
    useCompositeOverlayStore();

  const [showPicker, setShowPicker] = useState(false);

  if (!visible) return null;

  // Sort by zOrder for display
  const sorted = [...overlays].sort((a, b) => a.zOrder - b.zOrder);
  const existingChannels = new Set(overlays.map((o) => o.channel));
  const canAddMore = overlays.length < 3;

  const handleAdd = (channel: OverlayChannel, variable: VariableId) => {
    const defaults = CHANNEL_VARIABLE_DEFAULTS[channel];
    addOverlay({
      variable,
      channel,
      opacity: 0.75,
      visible: true,
      colormap: defaults.colormap,
    });
    setShowPicker(false);
  };

  return (
    <GlassPanel padding="sm" className={`layer-stack-panel ${className}`}>
      {/* Panel header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
          paddingBottom: 6,
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <span
          style={{ fontSize: 12, fontWeight: 600, color: '#fff', letterSpacing: '0.02em' }}
          aria-label="Layer Stack panel title"
        >
          🗂 Layer Stack
        </span>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>
          {overlays.length}/3 active
        </span>
      </div>

      {/* Bivariate toggle */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>
          Bivariate Map
        </span>
        <button
          role="switch"
          aria-checked={bivariateMode}
          aria-label="Toggle bivariate map mode"
          onClick={() => setBivariateMode(!bivariateMode)}
          style={{
            ...toggleBtn,
            background: bivariateMode ? 'rgba(180,0,255,0.6)' : 'rgba(255,255,255,0.1)',
          }}
        >
          {bivariateMode ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* Bivariate config section */}
      {bivariateMode && <BivariatePicker />}

      {/* Overlay slot rows (sorted low→high z-order = bottom→top) */}
      {!bivariateMode && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
          {sorted.map((entry, idx) => (
            <SlotRow
              key={entry.slotId}
              entry={entry}
              isFirst={idx === 0}
              isLast={idx === sorted.length - 1}
            />
          ))}

          {/* Add overlay button / picker */}
          {canAddMore && !showPicker && (
            <button
              onClick={() => setShowPicker(true)}
              aria-label="Add variable overlay"
              style={{
                ...actionBtn,
                marginTop: 2,
                background: 'rgba(0,180,255,0.1)',
                border: '1px dashed rgba(0,180,255,0.3)',
              }}
            >
              + Add Overlay
            </button>
          )}

          {showPicker && (
            <AddOverlayPicker
              existingChannels={existingChannels as Set<OverlayChannel>}
              onAdd={handleAdd}
              onCancel={() => setShowPicker(false)}
            />
          )}

          {!canAddMore && !showPicker && (
            <div
              style={{
                fontSize: 10,
                color: 'rgba(255,255,255,0.35)',
                textAlign: 'center',
                paddingTop: 4,
              }}
            >
              Max 3 overlays active (Req 39.1)
            </div>
          )}
        </div>
      )}
    </GlassPanel>
  );
};

// ── Shared micro-styles ────────────────────────────────────────────────────────

const iconBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: '2px 4px',
  fontSize: 13,
  color: 'rgba(255,255,255,0.7)',
  lineHeight: 1,
  borderRadius: 4,
  transition: 'background 0.15s',
};

const actionBtn: React.CSSProperties = {
  background: 'rgba(0,180,255,0.2)',
  border: '1px solid rgba(0,180,255,0.4)',
  color: '#fff',
  fontSize: 11,
  fontWeight: 500,
  padding: '5px 10px',
  borderRadius: 6,
  cursor: 'pointer',
  transition: 'background 0.15s',
};

const selectStyle: React.CSSProperties = {
  flex: 1,
  background: 'rgba(255,255,255,0.08)',
  border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: 4,
  color: '#fff',
  fontSize: 11,
  padding: '3px 6px',
};

const toggleBtn: React.CSSProperties = {
  border: '1px solid rgba(255,255,255,0.2)',
  borderRadius: 12,
  padding: '3px 10px',
  fontSize: 10,
  fontWeight: 600,
  color: '#fff',
  cursor: 'pointer',
  transition: 'background 0.2s',
};

export default LayerStackPanel;
