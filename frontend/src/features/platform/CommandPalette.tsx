/**
 * CommandPalette — Ctrl+K activated search palette.
 *
 * Searches across locations, layers, features, and recent actions using
 * fuzzy matching. Also manages the keyboard shortcut reference overlay
 * displayed on "?" key press.
 *
 * Exports pure functions for fuzzy search matching (testable without React).
 *
 * Validates: Requirements 48.1, 48.2, 58.1, 58.2, 58.3, 58.4
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GlassPanel } from '../../design-system';
import { useAppStore } from '../../core/state/appStore';
import { useUIStore } from '../../core/state/uiStore';
import { useKeyboardShortcuts, DASHBOARD_SHORTCUTS } from '../../core/hooks/useKeyboardShortcuts';
import type { ShortcutCategory, ShortcutDescriptor } from '../../core/hooks/useKeyboardShortcuts';
import type { RegionId, VariableId } from '../../types';

// ── Fuzzy Search Pure Functions ───────────────────────────────────────────────

/**
 * Compute the Levenshtein edit distance between two strings.
 * Pure function — no side effects.
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

/**
 * Determine whether `query` fuzzy-matches `target`.
 *
 * Matching rules (in priority order):
 *  1. Substring match (case-insensitive) → score 1.0
 *  2. Every character of query appears in target in order (subsequence) → score 0.6
 *  3. Levenshtein distance between query and any word in target ≤ 1 → score 0.4
 *  4. No match → score 0
 *
 * Returns a numeric score in [0, 1]; 0 means no match.
 *
 * Validates: Requirements 48.2, 58.3
 */
export function fuzzyScore(query: string, target: string): number {
  if (!query) return 1;
  const q = query.toLowerCase().trim();
  const t = target.toLowerCase();

  if (!q) return 1;

  // 1. Direct substring
  if (t.includes(q)) return 1.0;

  // 2. Subsequence — all chars of query appear in order in target
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  if (qi === q.length) return 0.6;

  // 3. Edit distance ≤ 1 against any word token in target (for short queries)
  if (q.length >= 2) {
    const words = t.split(/\W+/).filter(Boolean);
    for (const word of words) {
      if (levenshteinDistance(q, word) <= 1) return 0.4;
    }
  }

  return 0;
}

/**
 * Filter and rank a list of items by fuzzy relevance to a query.
 *
 * Returns items sorted by descending score, excluding zero-score items.
 * Stable sort preserves original ordering for equal scores.
 *
 * Validates: Requirements 48.2, 58.3
 */
export function fuzzyFilter<T extends { name: string }>(
  items: T[],
  query: string,
): Array<T & { _score: number }> {
  if (!query.trim()) {
    return items.map((item) => ({ ...item, _score: 1 }));
  }
  return items
    .map((item) => ({ ...item, _score: fuzzyScore(query, item.name) }))
    .filter((item) => item._score > 0)
    .sort((a, b) => b._score - a._score);
}

// ── Command Item Types ────────────────────────────────────────────────────────

export type CommandItemType =
  | 'location'
  | 'layer'
  | 'feature'
  | 'variable'
  | 'recent'
  | 'shortcut';

export interface CommandItem {
  id: string;
  name: string;
  description?: string;
  type: CommandItemType;
  /** Icon character / emoji for quick visual cue */
  icon?: string;
  action: () => void;
}

// ── Searchable Index Builder ──────────────────────────────────────────────────

/** Locations (regions) available in the dashboard */
const LOCATION_ITEMS: Omit<CommandItem, 'action'>[] = [
  { id: 'loc-western_ghats',       name: 'Western Ghats',         description: 'Southwest India coast range', type: 'location', icon: '🏔️' },
  { id: 'loc-north_east_india',    name: 'North East India',       description: 'Seven Sisters region',       type: 'location', icon: '🌿' },
  { id: 'loc-indo_gangetic_plain', name: 'Indo-Gangetic Plain',    description: 'North India plains belt',    type: 'location', icon: '🌾' },
  { id: 'loc-central_india',       name: 'Central India',          description: 'Deccan plateau region',      type: 'location', icon: '🗺️' },
  { id: 'loc-pilot',               name: 'Pilot Region',           description: 'Default pilot study area',  type: 'location', icon: '📍' },
];

/** Variable / layer toggle items */
const LAYER_ITEMS: Omit<CommandItem, 'action'>[] = [
  { id: 'var-rainfall',    name: 'Rainfall Layer',         description: 'Show predicted rainfall overlay',      type: 'variable', icon: '🌧️' },
  { id: 'var-temp_max',    name: 'Max Temperature Layer',  description: 'Show maximum temperature overlay',     type: 'variable', icon: '🌡️' },
  { id: 'var-temp_min',    name: 'Min Temperature Layer',  description: 'Show minimum temperature overlay',     type: 'variable', icon: '❄️' },
  { id: 'layer-wind',      name: 'Wind Layer',             description: 'Toggle wind field visualization',      type: 'layer',    icon: '💨' },
  { id: 'layer-contours',  name: 'Contour Lines',          description: 'Toggle precipitation contour lines',   type: 'layer',    icon: '〰️' },
  { id: 'layer-boundaries',name: 'Boundary Layer',         description: 'Toggle region/state boundaries',       type: 'layer',    icon: '🗾' },
  { id: 'layer-3d',        name: '3D Terrain',             description: 'Toggle Google Photorealistic 3D tiles',type: 'layer',    icon: '🌍' },
  { id: 'layer-uncertainty',name: 'Uncertainty View',      description: 'Toggle ensemble uncertainty halos',    type: 'layer',    icon: '🔮' },
];

/** Feature / panel items */
const FEATURE_ITEMS: Omit<CommandItem, 'action'>[] = [
  { id: 'feat-split-view',    name: 'Split View Mode',          description: 'Compare two scenarios side by side', type: 'feature', icon: '⬛' },
  { id: 'feat-inspect',       name: 'Inspect Tool',             description: 'Click a grid cell for detailed data',type: 'feature', icon: '🔍' },
  { id: 'feat-anomaly',       name: 'Anomaly Detection',        description: 'Highlight extreme weather events',   type: 'feature', icon: '⚠️' },
  { id: 'feat-flood',         name: 'Flood Risk Panel',         description: 'View flood early warning zones',     type: 'feature', icon: '🌊' },
  { id: 'feat-drought',       name: 'Drought Monitor',          description: 'SPI drought index visualization',    type: 'feature', icon: '🏜️' },
  { id: 'feat-heatwave',      name: 'Heat Wave Alert',          description: 'Detect and display heat waves',      type: 'feature', icon: '🔥' },
  { id: 'feat-animation',     name: 'Temporal Animation',       description: 'Play 7-day forecast animation',      type: 'feature', icon: '▶️' },
  { id: 'feat-export',        name: 'Export Data',              description: 'Export CSV, GeoTIFF, screenshot',    type: 'feature', icon: '💾' },
  { id: 'feat-report',        name: 'Generate Report',          description: 'Create PDF climate bulletin',        type: 'feature', icon: '📄' },
  { id: 'feat-nwp',           name: 'NWP Comparison',           description: 'Compare VAYU vs GFS/ECMWF/ICON',     type: 'feature', icon: '📊' },
  { id: 'feat-cyclone',       name: 'Cyclone Tracker',          description: 'View cyclone tracks and forecasts',  type: 'feature', icon: '🌀' },
  { id: 'feat-aqi',           name: 'Air Quality Panel',        description: 'View AQI overlay and alerts',        type: 'feature', icon: '😷' },
  { id: 'feat-agriculture',   name: 'Agriculture Advisory',     description: 'Crop-specific weather advisories',   type: 'feature', icon: '🌱' },
];

// ── Recent Actions Store (module-level, lightweight) ─────────────────────────

const MAX_RECENT = 5;
let recentActions: string[] = [];

export function recordRecentAction(itemId: string): void {
  recentActions = [itemId, ...recentActions.filter((id) => id !== itemId)].slice(
    0,
    MAX_RECENT,
  );
}

export function getRecentActions(): string[] {
  return [...recentActions];
}

/** Reset recent actions — used in tests to restore a clean state. */
export function clearRecentActions(): void {
  recentActions = [];
}

// ── ShortcutOverlay Sub-component ─────────────────────────────────────────────

const CATEGORY_ORDER: ShortcutCategory[] = [
  'Variables',
  'Forecast',
  'Playback',
  'Navigation',
  'Platform',
  'Layers',
  'Export',
];

const ShortcutOverlay: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const grouped = useMemo(() => {
    const map = new Map<ShortcutCategory, ShortcutDescriptor[]>();
    for (const sc of DASHBOARD_SHORTCUTS) {
      const cat = (sc.category ?? 'Platform') as ShortcutCategory;
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(sc);
    }
    return map;
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard Shortcut Reference"
      data-testid="shortcut-overlay"
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9999,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'rgba(6,10,22,0.95)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: '16px',
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
          maxWidth: '680px',
          width: '92vw',
          maxHeight: '80vh',
          overflowY: 'auto',
          padding: '24px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ color: 'rgba(255,255,255,0.9)', fontSize: '18px', fontWeight: 700, margin: 0 }}>
            ⌨️ Keyboard Shortcuts
          </h2>
          <button
            aria-label="Close shortcut reference"
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: '6px', color: 'rgba(255,255,255,0.6)',
              cursor: 'pointer', fontSize: '14px', padding: '4px 10px',
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' }}>
          {CATEGORY_ORDER.map((cat) => {
            const items = grouped.get(cat);
            if (!items?.length) return null;
            return (
              <div key={cat}>
                <h3 style={{ color: 'rgba(96,165,250,0.9)', fontSize: '12px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 10px 0' }}>
                  {cat}
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {items.map((sc) => (
                    <div key={sc.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                      <span style={{ color: 'rgba(255,255,255,0.65)', fontSize: '13px' }}>{sc.description}</span>
                      <kbd style={{
                        background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)',
                        borderRadius: '4px', color: 'rgba(255,255,255,0.85)',
                        fontFamily: 'monospace', fontSize: '12px',
                        padding: '2px 7px', whiteSpace: 'nowrap', flexShrink: 0,
                      }}>
                        {sc.key}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '12px', marginTop: '20px', textAlign: 'center' }}>
          Press <kbd style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '3px', fontFamily: 'monospace', padding: '1px 5px' }}>Esc</kbd> or click outside to close
        </p>
      </div>
    </div>
  );
};

// ── Result Item Sub-component ─────────────────────────────────────────────────

const ResultItem: React.FC<{
  item: CommandItem & { _score?: number };
  isActive: boolean;
  onSelect: () => void;
  onHover: () => void;
}> = ({ item, isActive, onSelect, onHover }) => {
  const typeColors: Record<CommandItemType, string> = {
    location: '#34d399',
    layer:    '#f97316',
    feature:  '#c084fc',
    variable: '#60a5fa',
    recent:   '#fbbf24',
    shortcut: '#94a3b8',
  };
  const color = typeColors[item.type];

  return (
    <div
      role="option"
      aria-selected={isActive}
      data-testid={`palette-item-${item.id}`}
      onClick={onSelect}
      onMouseEnter={onHover}
      style={{
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '8px 12px', borderRadius: '8px', cursor: 'pointer',
        background: isActive ? 'rgba(255,255,255,0.08)' : 'transparent',
        transition: 'background 80ms ease',
      }}
    >
      {item.icon && (
        <span aria-hidden="true" style={{ fontSize: '16px', width: '20px', textAlign: 'center', flexShrink: 0 }}>
          {item.icon}
        </span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: 'rgba(255,255,255,0.9)', fontSize: '13px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.name}
        </div>
        {item.description && (
          <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.description}
          </div>
        )}
      </div>
      <span style={{
        background: `${color}18`, border: `1px solid ${color}50`,
        borderRadius: '4px', color, fontSize: '10px',
        fontWeight: 600, letterSpacing: '0.06em',
        padding: '2px 6px', textTransform: 'uppercase', flexShrink: 0,
      }}>
        {item.type}
      </span>
    </div>
  );
};

// ── Props ─────────────────────────────────────────────────────────────────────

export interface CommandPaletteProps {
  /** Extra command items to inject (e.g. from parent context) */
  additionalItems?: Omit<CommandItem, 'action'>[];
  /** Called when the palette closes */
  onClose?: () => void;
}

// ── Main Component ────────────────────────────────────────────────────────────

/**
 * CommandPalette — activated via Ctrl+K.
 *
 * Renders a modal search overlay with fuzzy-matched results across:
 *  - Locations (regions)
 *  - Layer toggles
 *  - Features / panels
 *  - Recent actions
 *
 * Also wires up the full set of dashboard keyboard shortcuts and shows
 * the shortcut reference overlay when "?" is pressed.
 *
 * Validates: Requirements 48.1, 48.2, 58.1, 58.2, 58.3, 58.4
 */
export const CommandPalette: React.FC<CommandPaletteProps> = ({
  additionalItems = [],
  onClose,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showShortcutOverlay, setShowShortcutOverlay] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // ── Zustand actions ──────────────────────────────────────────────────────
  const setVariable = useAppStore((s) => s.setVariable);
  const setRegion   = useAppStore((s) => s.setRegion);
  const setForecastDay = useAppStore((s) => s.setForecastDay);
  const setTimeState   = useAppStore((s) => s.setTimeState);
  const toggleFeature  = useAppStore((s) => s.toggleFeature);
  const timeState      = useAppStore((s) => s.timeState);

  // ── Open / close helpers ─────────────────────────────────────────────────
  const open = useCallback(() => {
    setIsOpen(true);
    setQuery('');
    setActiveIndex(0);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setQuery('');
    onClose?.();
  }, [onClose]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [isOpen]);

  // ── Build command item list with actions ─────────────────────────────────
  const allItems: CommandItem[] = useMemo(() => {
    const locationCommands: CommandItem[] = LOCATION_ITEMS.map((loc) => ({
      ...loc,
      action: () => {
        const regionId = loc.id.replace('loc-', '') as RegionId;
        setRegion(regionId);
        recordRecentAction(loc.id);
        close();
      },
    }));

    const layerCommands: CommandItem[] = LAYER_ITEMS.map((layer) => ({
      ...layer,
      action: () => {
        if (layer.type === 'variable') {
          const varId = layer.id.replace('var-', '') as VariableId;
          setVariable(varId);
        } else {
          const featureMap: Record<string, Parameters<typeof toggleFeature>[0]> = {
            'layer-wind':         'showWind',
            'layer-contours':     'showContours',
            'layer-boundaries':   'showBoundaries',
            'layer-3d':           'show3D',
            'layer-uncertainty':  'showUncertainty',
          };
          const key = featureMap[layer.id];
          if (key) toggleFeature(key);
        }
        recordRecentAction(layer.id);
        close();
      },
    }));

    const featureCommands: CommandItem[] = FEATURE_ITEMS.map((feat) => ({
      ...feat,
      action: () => {
        const featureActionMap: Record<string, () => void> = {
          'feat-split-view':  () => toggleFeature('showSplitScreen'),
          'feat-inspect':     () => toggleFeature('inspectMode'),
          'feat-animation':   () => setTimeState({ isPlaying: !timeState.isPlaying }),
          'feat-anomaly':     () => {},
          'feat-flood':       () => {},
          'feat-drought':     () => {},
          'feat-heatwave':    () => {},
          'feat-export':      () => {},
          'feat-report':      () => {},
          'feat-nwp':         () => {},
          'feat-cyclone':     () => {},
          'feat-aqi':         () => {},
          'feat-agriculture': () => {},
        };
        featureActionMap[feat.id]?.();
        recordRecentAction(feat.id);
        close();
      },
    }));

    const additionalCommands: CommandItem[] = additionalItems.map((item) => ({
      ...item,
      action: () => {
        recordRecentAction(item.id);
        close();
      },
    }));

    return [...locationCommands, ...layerCommands, ...featureCommands, ...additionalCommands];
  }, [additionalItems, setVariable, setRegion, toggleFeature, setTimeState, timeState.isPlaying, close]);

  // ── Recent items ─────────────────────────────────────────────────────────
  const recentItems: CommandItem[] = useMemo(() => {
    return getRecentActions()
      .map((id) => allItems.find((item) => item.id === id))
      .filter((item): item is CommandItem => item !== undefined)
      .map((item) => ({ ...item, type: 'recent' as CommandItemType }));
  }, [allItems]);

  // ── Filtered results ─────────────────────────────────────────────────────
  const results: CommandItem[] = useMemo(() => {
    if (!query.trim()) {
      // No query: show recent actions first, then all items grouped
      return recentItems.length
        ? [...recentItems, ...allItems.filter((i) => !recentItems.some((r) => r.id === i.id)).slice(0, 10)]
        : allItems.slice(0, 12);
    }
    return fuzzyFilter(allItems, query);
  }, [query, allItems, recentItems]);

  // Reset active index when results change
  useEffect(() => {
    setActiveIndex(0);
  }, [results.length]);

  // ── Keyboard navigation inside the palette ───────────────────────────────
  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'Escape':
        close();
        break;
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, results.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        break;
      case 'Enter':
        if (results[activeIndex]) {
          results[activeIndex].action();
        }
        break;
      default:
        break;
    }
  };

  // Scroll active item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.querySelector('[aria-selected="true"]') as HTMLElement | null;
    if (active) {
      active.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  // ── Dashboard-wide keyboard shortcuts ────────────────────────────────────
  useKeyboardShortcuts(
    [
      // Platform
      { key: 'Ctrl+K',  description: 'Open Command Palette',      category: 'Platform',   action: open,   allowInInputs: false },
      { key: '?',       description: 'Show keyboard shortcuts',    category: 'Platform',   action: () => setShowShortcutOverlay(true) },
      // Variables
      { key: 'r',       description: 'Rainfall layer',             category: 'Variables',  action: () => setVariable('rainfall') },
      { key: 't',       description: 'Temperature layer',          category: 'Variables',  action: () => setVariable('temp_max') },
      { key: 'm',       description: 'Wind layer',                 category: 'Variables',  action: () => toggleFeature('showWind') },
      // Forecast days 1–7
      { key: '1', description: 'Forecast Day 1', category: 'Forecast', action: () => setForecastDay(1) },
      { key: '2', description: 'Forecast Day 2', category: 'Forecast', action: () => setForecastDay(2) },
      { key: '3', description: 'Forecast Day 3', category: 'Forecast', action: () => setForecastDay(3) },
      { key: '4', description: 'Forecast Day 4', category: 'Forecast', action: () => setForecastDay(4) },
      { key: '5', description: 'Forecast Day 5', category: 'Forecast', action: () => setForecastDay(5) },
      { key: '6', description: 'Forecast Day 6', category: 'Forecast', action: () => setForecastDay(6) },
      { key: '7', description: 'Forecast Day 7', category: 'Forecast', action: () => setForecastDay(7) },
      // Playback
      { key: 'Space',   description: 'Play/pause animation',       category: 'Playback',   action: () => setTimeState({ isPlaying: !timeState.isPlaying }) },
      // Export
      { key: 'Ctrl+S',  description: 'Save/export view',           category: 'Export',     action: () => {}, allowInInputs: false },
    ],
    true,
  );

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Shortcut reference overlay (Req 58.2) ── */}
      {showShortcutOverlay && (
        <ShortcutOverlay onClose={() => setShowShortcutOverlay(false)} />
      )}

      {/* ── Command palette modal (Req 48.1) ── */}
      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Command Palette"
          data-testid="command-palette"
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.55)',
            backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            paddingTop: '12vh',
            zIndex: 9000,
          }}
          onClick={close}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: '92vw', maxWidth: '580px' }}
          >
            <GlassPanel padding="none">
              {/* Search input */}
              <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span aria-hidden="true" style={{ fontSize: '16px', opacity: 0.5 }}>🔍</span>
                <input
                  ref={inputRef}
                  type="text"
                  role="combobox"
                  aria-expanded={true}
                  aria-haspopup="listbox"
                  aria-autocomplete="list"
                  aria-label="Command palette search"
                  aria-controls="palette-results"
                  placeholder="Search locations, layers, features…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleInputKeyDown}
                  style={{
                    flex: 1,
                    background: 'none', border: 'none', outline: 'none',
                    color: 'rgba(255,255,255,0.9)', fontSize: '15px',
                  }}
                />
                {query && (
                  <button
                    aria-label="Clear search"
                    onClick={() => { setQuery(''); inputRef.current?.focus(); }}
                    style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)', cursor: 'pointer', fontSize: '14px', padding: '2px 6px' }}
                  >
                    ✕
                  </button>
                )}
                <kbd style={{
                  background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: '4px', color: 'rgba(255,255,255,0.35)',
                  fontFamily: 'monospace', fontSize: '11px', padding: '2px 6px',
                }}>
                  Esc
                </kbd>
              </div>

              {/* Results list */}
              <div
                id="palette-results"
                ref={listRef}
                role="listbox"
                aria-label="Command results"
                style={{ maxHeight: '360px', overflowY: 'auto', padding: '6px' }}
              >
                {results.length === 0 ? (
                  <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: '13px', padding: '20px 12px', textAlign: 'center' }}>
                    No results for "<strong style={{ color: 'rgba(255,255,255,0.6)' }}>{query}</strong>"
                  </div>
                ) : (
                  <>
                    {!query.trim() && recentItems.length > 0 && (
                      <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: '10px', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '4px 12px 2px' }}>
                        Recent
                      </div>
                    )}
                    {results.map((item, idx) => (
                      <ResultItem
                        key={item.id}
                        item={item}
                        isActive={idx === activeIndex}
                        onSelect={() => item.action()}
                        onHover={() => setActiveIndex(idx)}
                      />
                    ))}
                  </>
                )}
              </div>

              {/* Footer hint */}
              <div style={{
                borderTop: '1px solid rgba(255,255,255,0.06)', padding: '8px 16px',
                display: 'flex', gap: '16px',
              }}>
                {[
                  { keys: ['↑', '↓'], label: 'Navigate' },
                  { keys: ['↵'], label: 'Select' },
                  { keys: ['Esc'], label: 'Close' },
                  { keys: ['?'], label: 'Shortcuts' },
                ].map(({ keys, label }) => (
                  <span key={label} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {keys.map((k) => (
                      <kbd key={k} style={{
                        background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)',
                        borderRadius: '3px', color: 'rgba(255,255,255,0.45)',
                        fontFamily: 'monospace', fontSize: '10px', padding: '1px 5px',
                      }}>{k}</kbd>
                    ))}
                    <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: '11px' }}>{label}</span>
                  </span>
                ))}
              </div>
            </GlassPanel>
          </div>
        </div>
      )}
    </>
  );
};

export default CommandPalette;
