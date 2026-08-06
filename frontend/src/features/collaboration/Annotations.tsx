/**
 * Annotations — Collaborative Annotation System.
 *
 * Exports pure functions for annotation serialization and GeoJSON export (testable).
 * React component provides pin, polygon, text, and measurement tools with:
 *  - localStorage persistence (offline)
 *  - Backend sync when online (POST /api/annotations)
 *  - Editable popups showing content, creator, timestamp
 *  - GeoJSON export of all annotations
 *
 * Validates: Requirements 45.1, 45.2, 45.3, 45.4
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GlassPanel } from '../../design-system';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Annotation tool type — Requirement 45.1 */
export type AnnotationType = 'pin' | 'polygon' | 'text' | 'measurement';

/** Core annotation data model — matches backend schema */
export interface Annotation {
  id: string;
  type: AnnotationType;
  /**
   * Coordinates in [lon, lat] order (GeoJSON convention).
   * - pin / text: single [lon, lat]
   * - polygon: ring of [lon, lat] pairs (auto-closed)
   * - measurement: two endpoints [[lon1,lat1],[lon2,lat2]]
   */
  coordinates: number[] | number[][];
  content: string;
  creator: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  color: string;
  /** Whether the popup is currently open in the UI */
  popupOpen?: boolean;
}

/** GeoJSON Feature wrapping an annotation */
export interface AnnotationFeature {
  type: 'Feature';
  geometry:
    | { type: 'Point'; coordinates: number[] }
    | { type: 'Polygon'; coordinates: number[][][] }
    | { type: 'LineString'; coordinates: number[][] };
  properties: Omit<Annotation, 'coordinates' | 'popupOpen'>;
}

/** GeoJSON FeatureCollection of all annotations */
export interface AnnotationGeoJSON {
  type: 'FeatureCollection';
  features: AnnotationFeature[];
}

/** Sync status for an annotation */
export type SyncStatus = 'local' | 'synced' | 'syncing' | 'error';

export interface AnnotationWithSync extends Annotation {
  syncStatus: SyncStatus;
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const STORAGE_KEY = 'mausam_annotations';
export const BACKEND_ENDPOINT = '/api/annotations';

/** Default color palette for new annotations */
export const ANNOTATION_COLORS: Record<AnnotationType, string> = {
  pin: '#f97316',         // orange
  polygon: '#3b82f6',     // blue
  text: '#a855f7',        // purple
  measurement: '#22c55e', // green
};

/** Haversine Earth radius in km */
const EARTH_RADIUS_KM = 6371;

// ── Pure Functions ────────────────────────────────────────────────────────────

/**
 * Generate a UUID-like string for annotation IDs.
 * Uses crypto.randomUUID when available, falls back to Math.random.
 */
export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Haversine distance between two [lon, lat] points in km.
 * Used by measurement annotations.
 * Requirement 45.1: measurement tool.
 */
export function haversineDistanceKm(
  point1: number[],
  point2: number[],
): number {
  const [lon1, lat1] = point1;
  const [lon2, lat2] = point2;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.asin(Math.sqrt(a));
}

/**
 * Compute the area of a polygon defined by [lon, lat] pairs (km²).
 * Uses the spherical excess formula (shoelace on geographic coordinates).
 * Returns 0 for polygons with fewer than 3 points.
 * Requirement 45.1: measurement tool — area computation.
 */
export function polygonAreaKm2(ring: number[][]): number {
  if (ring.length < 3) return 0;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  let area = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[(i + 1) % n];
    area +=
      toRad(lon2 - lon1) *
      (2 + Math.sin(toRad(lat1)) + Math.sin(toRad(lat2)));
  }
  return Math.abs((area * EARTH_RADIUS_KM ** 2) / 2);
}

/**
 * Serialize a single Annotation to a GeoJSON Feature.
 * Requirement 45.4: GeoJSON export.
 */
export function annotationToFeature(annotation: Annotation): AnnotationFeature {
  const { id, type, coordinates, content, creator, timestamp, color } = annotation;
  const properties = { id, type, content, creator, timestamp, color };

  if (type === 'pin' || type === 'text') {
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: coordinates as number[] },
      properties,
    };
  }

  if (type === 'measurement') {
    return {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coordinates as number[][] },
      properties,
    };
  }

  // polygon — ensure ring is closed
  const ring = coordinates as number[][];
  const closed =
    ring.length > 0 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
      ? ring
      : [...ring, ring[0]];
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [closed] },
    properties,
  };
}

/**
 * Serialize all annotations to a GeoJSON FeatureCollection.
 * Requirement 45.4: export all annotations as GeoJSON.
 */
export function annotationsToGeoJSON(annotations: Annotation[]): AnnotationGeoJSON {
  return {
    type: 'FeatureCollection',
    features: annotations.map(annotationToFeature),
  };
}

/**
 * Trigger a browser download of the GeoJSON as a .geojson file.
 * Requirement 45.4.
 */
export function downloadGeoJSON(annotations: Annotation[], filename = 'annotations.geojson'): void {
  const geojson = annotationsToGeoJSON(annotations);
  const blob = new Blob([JSON.stringify(geojson, null, 2)], {
    type: 'application/geo+json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Load annotations from localStorage.
 * Requirement 45.2: persist in localStorage for offline use.
 */
export function loadFromStorage(): AnnotationWithSync[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Annotation[];
    return parsed.map((a) => ({ ...a, syncStatus: 'local' as SyncStatus }));
  } catch {
    return [];
  }
}

/**
 * Persist annotations to localStorage.
 * Requirement 45.2.
 */
export function saveToStorage(annotations: AnnotationWithSync[]): void {
  try {
    // Strip UI-only fields before storing
    const toStore: Annotation[] = annotations.map(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      ({ syncStatus, popupOpen, ...rest }) => rest,
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
  } catch {
    // Storage quota exceeded — silently ignore
  }
}

/**
 * Format an ISO timestamp for display in editable popups.
 * Requirement 45.3.
 */
export function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

/**
 * Create a new annotation with generated id and current timestamp.
 * Requirement 45.1, 45.3.
 */
export function createAnnotation(
  type: AnnotationType,
  coordinates: Annotation['coordinates'],
  creator: string,
  content = '',
): Annotation {
  return {
    id: generateId(),
    type,
    coordinates,
    content,
    creator,
    timestamp: new Date().toISOString(),
    color: ANNOTATION_COLORS[type],
    popupOpen: true,
  };
}

/**
 * Compute a human-readable measurement label for an annotation.
 * Requirement 45.1: measurement tool displays distance / area.
 */
export function measurementLabel(annotation: Annotation): string {
  if (annotation.type === 'measurement') {
    const pts = annotation.coordinates as number[][];
    if (pts.length >= 2) {
      const km = haversineDistanceKm(pts[0], pts[1]);
      return km < 1 ? `${(km * 1000).toFixed(0)} m` : `${km.toFixed(2)} km`;
    }
  }
  if (annotation.type === 'polygon') {
    const ring = annotation.coordinates as number[][];
    if (ring.length >= 3) {
      const km2 = polygonAreaKm2(ring);
      return km2 < 1 ? `${(km2 * 1e6).toFixed(0)} m²` : `${km2.toFixed(2)} km²`;
    }
  }
  return '';
}

// ── Backend Sync ──────────────────────────────────────────────────────────────

/**
 * Attempt to POST a single annotation to the backend.
 * Returns the annotation with updated syncStatus.
 * Requirement 45.2: sync to backend when online.
 */
export async function syncAnnotationToBackend(
  annotation: Annotation,
): Promise<SyncStatus> {
  try {
    const resp = await fetch(BACKEND_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: annotation.id,
        type: annotation.type,
        coordinates: annotation.coordinates,
        content: annotation.content,
        creator: annotation.creator,
        timestamp: annotation.timestamp,
        color: annotation.color,
      }),
    });
    return resp.ok ? 'synced' : 'error';
  } catch {
    return 'error';
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * useAnnotations — manages annotation state with localStorage persistence
 * and optional backend sync.
 * Requirement 45.2.
 */
function useAnnotations(creator: string) {
  const [annotations, setAnnotations] = useState<AnnotationWithSync[]>(() =>
    loadFromStorage(),
  );
  const [activeTool, setActiveTool] = useState<AnnotationType | null>(null);
  const [pendingPoints, setPendingPoints] = useState<number[][]>([]);
  const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

  // Persist to localStorage whenever annotations change
  useEffect(() => {
    saveToStorage(annotations);
  }, [annotations]);

  // Sync unsynced annotations when coming back online
  useEffect(() => {
    if (!isOnline) return;
    const unsynced = annotations.filter((a) => a.syncStatus === 'local');
    if (unsynced.length === 0) return;

    unsynced.forEach(async (ann) => {
      setAnnotations((prev) =>
        prev.map((a) => (a.id === ann.id ? { ...a, syncStatus: 'syncing' } : a)),
      );
      const status = await syncAnnotationToBackend(ann);
      setAnnotations((prev) =>
        prev.map((a) => (a.id === ann.id ? { ...a, syncStatus: status } : a)),
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  const addAnnotation = useCallback(
    async (ann: Annotation) => {
      const withSync: AnnotationWithSync = { ...ann, syncStatus: 'local' };
      setAnnotations((prev) => [...prev, withSync]);

      if (isOnline) {
        setAnnotations((prev) =>
          prev.map((a) => (a.id === ann.id ? { ...a, syncStatus: 'syncing' } : a)),
        );
        const status = await syncAnnotationToBackend(ann);
        setAnnotations((prev) =>
          prev.map((a) => (a.id === ann.id ? { ...a, syncStatus: status } : a)),
        );
      }
    },
    [isOnline],
  );

  const updateAnnotation = useCallback((id: string, patch: Partial<Annotation>) => {
    setAnnotations((prev) =>
      prev.map((a) => (a.id === id ? { ...a, ...patch, syncStatus: 'local' } : a)),
    );
  }, []);

  const deleteAnnotation = useCallback((id: string) => {
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const togglePopup = useCallback((id: string) => {
    setAnnotations((prev) =>
      prev.map((a) => (a.id === id ? { ...a, popupOpen: !a.popupOpen } : a)),
    );
  }, []);

  const finishPolygon = useCallback(() => {
    if (pendingPoints.length < 3) return;
    const ann = createAnnotation('polygon', pendingPoints, creator);
    addAnnotation(ann);
    setPendingPoints([]);
    setActiveTool(null);
  }, [pendingPoints, creator, addAnnotation]);

  return {
    annotations,
    activeTool,
    pendingPoints,
    setActiveTool,
    setPendingPoints,
    addAnnotation,
    updateAnnotation,
    deleteAnnotation,
    togglePopup,
    finishPolygon,
    isOnline,
    creator,
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────

const TOOL_META: Record<AnnotationType, { icon: string; label: string }> = {
  pin:         { icon: '📍', label: 'Pin' },
  polygon:     { icon: '⬡', label: 'Polygon' },
  text:        { icon: '✏️', label: 'Text' },
  measurement: { icon: '📏', label: 'Measure' },
};

/** Sync badge shown on each annotation row */
const SyncBadge: React.FC<{ status: SyncStatus }> = ({ status }) => {
  const cfg = {
    local:   { color: '#94a3b8', icon: '◌', title: 'Saved locally' },
    syncing: { color: '#f59e0b', icon: '↻', title: 'Syncing…' },
    synced:  { color: '#22c55e', icon: '✓', title: 'Synced to server' },
    error:   { color: '#ef4444', icon: '!', title: 'Sync failed' },
  }[status];
  return (
    <span title={cfg.title} aria-label={cfg.title} style={{ color: cfg.color, fontSize: '12px', fontWeight: 700 }}>
      {cfg.icon}
    </span>
  );
};

/** Editable popup for a single annotation — Requirement 45.3 */
interface AnnotationPopupProps {
  annotation: AnnotationWithSync;
  onUpdate: (id: string, patch: Partial<Annotation>) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

const AnnotationPopup: React.FC<AnnotationPopupProps> = ({
  annotation,
  onUpdate,
  onDelete,
  onClose,
}) => {
  const [editContent, setEditContent] = useState(annotation.content);
  const [editCreator, setEditCreator] = useState(annotation.creator);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSave = () => {
    onUpdate(annotation.id, { content: editContent, creator: editCreator });
    onClose();
  };

  const label = measurementLabel(annotation);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${annotation.type} annotation`}
      style={{
        background: 'rgba(10, 15, 30, 0.97)',
        border: `1px solid ${annotation.color}60`,
        borderRadius: '10px',
        padding: '12px',
        minWidth: '240px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        position: 'relative',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
        <span style={{ fontSize: '16px' }}>{TOOL_META[annotation.type].icon}</span>
        <span style={{ fontWeight: 600, color: annotation.color, fontSize: '13px', textTransform: 'capitalize' }}>
          {annotation.type}
        </span>
        {label && (
          <span style={{ marginLeft: 'auto', fontSize: '12px', color: '#22c55e', fontWeight: 600 }}>
            {label}
          </span>
        )}
        <button
          onClick={onClose}
          aria-label="Close popup"
          style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'rgba(var(--fg-rgb),var(--fg-a4))', cursor: 'pointer', fontSize: '16px', lineHeight: 1 }}
        >
          ×
        </button>
      </div>

      {/* Creator */}
      <label style={{ display: 'block', fontSize: '11px', color: 'rgba(var(--fg-rgb),var(--fg-a4))', marginBottom: '3px' }}>
        Creator
      </label>
      <input
        type="text"
        value={editCreator}
        onChange={(e) => setEditCreator(e.target.value)}
        aria-label="Annotation creator"
        style={{
          width: '100%', boxSizing: 'border-box', marginBottom: '8px',
          background: 'rgba(var(--fg-rgb),var(--fg-a05))', border: '1px solid rgba(var(--fg-rgb),var(--fg-a12))',
          borderRadius: '6px', color: '#e2e8f0', fontSize: '12px', padding: '5px 8px',
        }}
      />

      {/* Notes */}
      <label style={{ display: 'block', fontSize: '11px', color: 'rgba(var(--fg-rgb),var(--fg-a4))', marginBottom: '3px' }}>
        Notes
      </label>
      <textarea
        ref={textareaRef}
        value={editContent}
        onChange={(e) => setEditContent(e.target.value)}
        rows={3}
        aria-label="Annotation notes"
        placeholder="Add a description…"
        style={{
          width: '100%', boxSizing: 'border-box', marginBottom: '8px', resize: 'vertical',
          background: 'rgba(var(--fg-rgb),var(--fg-a05))', border: '1px solid rgba(var(--fg-rgb),var(--fg-a12))',
          borderRadius: '6px', color: '#e2e8f0', fontSize: '12px', padding: '5px 8px',
        }}
      />

      {/* Timestamp */}
      <div style={{ fontSize: '10px', color: 'rgba(var(--fg-rgb),var(--fg-a3))', marginBottom: '10px' }}>
        {formatTimestamp(annotation.timestamp)} · <SyncBadge status={annotation.syncStatus} />
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: '6px' }}>
        <button
          onClick={handleSave}
          style={{
            flex: 1, padding: '5px 10px', borderRadius: '6px', border: 'none',
            background: annotation.color, color: '#fff', fontWeight: 600, fontSize: '12px', cursor: 'pointer',
          }}
        >
          Save
        </button>
        <button
          onClick={() => { onDelete(annotation.id); onClose(); }}
          aria-label="Delete annotation"
          style={{
            padding: '5px 10px', borderRadius: '6px', border: '1px solid rgba(239,68,68,0.5)',
            background: 'rgba(239,68,68,0.12)', color: '#ef4444', fontSize: '12px', cursor: 'pointer',
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
};

/** Single annotation row in the list panel */
interface AnnotationRowProps {
  annotation: AnnotationWithSync;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: (id: string) => void;
}

const AnnotationRow: React.FC<AnnotationRowProps> = ({
  annotation,
  isSelected,
  onSelect,
  onDelete,
}) => {
  const label = measurementLabel(annotation);
  const coords = Array.isArray(annotation.coordinates[0])
    ? (annotation.coordinates as number[][])[0]
    : (annotation.coordinates as number[]);
  const latStr = typeof coords[1] === 'number' ? coords[1].toFixed(3) : '—';
  const lonStr = typeof coords[0] === 'number' ? coords[0].toFixed(3) : '—';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === 'Enter' && onSelect()}
      aria-pressed={isSelected}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '8px',
        padding: '8px 10px',
        borderRadius: '8px',
        background: isSelected ? 'rgba(var(--fg-rgb),var(--fg-a08))' : 'transparent',
        borderLeft: `3px solid ${isSelected ? annotation.color : 'transparent'}`,
        cursor: 'pointer',
        transition: 'background 120ms ease',
      }}
    >
      <span style={{ fontSize: '16px', flexShrink: 0, marginTop: '1px' }}>
        {TOOL_META[annotation.type].icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
          <span style={{ fontWeight: 600, fontSize: '12px', color: annotation.color, textTransform: 'capitalize' }}>
            {annotation.type}
          </span>
          {label && (
            <span style={{ fontSize: '11px', color: '#22c55e', fontWeight: 600 }}>· {label}</span>
          )}
          <SyncBadge status={annotation.syncStatus} />
        </div>
        {annotation.content && (
          <div style={{ fontSize: '12px', color: 'rgba(var(--fg-rgb),var(--fg-a75))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {annotation.content}
          </div>
        )}
        <div style={{ fontSize: '10px', color: 'rgba(var(--fg-rgb),var(--fg-a3))', marginTop: '2px' }}>
          {annotation.creator} · {latStr}°N, {lonStr}°E
        </div>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(annotation.id); }}
        aria-label={`Delete ${annotation.type} annotation`}
        style={{
          background: 'none', border: 'none', color: 'rgba(var(--fg-rgb),var(--fg-a3))',
          cursor: 'pointer', fontSize: '14px', padding: '2px 4px', flexShrink: 0,
          borderRadius: '4px',
        }}
        onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = '#ef4444')}
        onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = 'rgba(var(--fg-rgb),var(--fg-a3))')}
      >
        ×
      </button>
    </div>
  );
};

/** Toolbar for selecting annotation tool type — Requirement 45.1 */
interface ToolbarProps {
  activeTool: AnnotationType | null;
  onSelect: (tool: AnnotationType | null) => void;
  pendingCount: number;
  onFinishPolygon: () => void;
}

const AnnotationToolbar: React.FC<ToolbarProps> = ({
  activeTool,
  onSelect,
  pendingCount,
  onFinishPolygon,
}) => (
  <div
    role="toolbar"
    aria-label="Annotation tools"
    style={{ display: 'flex', gap: '4px', marginBottom: '10px', flexWrap: 'wrap' }}
  >
    {(Object.keys(TOOL_META) as AnnotationType[]).map((type) => {
      const isActive = activeTool === type;
      const meta = TOOL_META[type];
      return (
        <button
          key={type}
          onClick={() => onSelect(isActive ? null : type)}
          aria-pressed={isActive}
          title={`${meta.label} tool`}
          style={{
            padding: '5px 10px',
            borderRadius: '6px',
            border: `1px solid ${isActive ? ANNOTATION_COLORS[type] : 'rgba(var(--fg-rgb),var(--fg-a12))'}`,
            background: isActive ? `${ANNOTATION_COLORS[type]}22` : 'rgba(var(--fg-rgb),var(--fg-a05))',
            color: isActive ? ANNOTATION_COLORS[type] : 'rgba(var(--fg-rgb),var(--fg-a7))',
            fontWeight: isActive ? 700 : 400,
            fontSize: '12px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            transition: 'all 120ms ease',
          }}
        >
          <span aria-hidden="true">{meta.icon}</span> {meta.label}
        </button>
      );
    })}
    {activeTool === 'polygon' && pendingCount >= 3 && (
      <button
        onClick={onFinishPolygon}
        style={{
          padding: '5px 10px', borderRadius: '6px',
          border: '1px solid #22c55e', background: 'rgba(34,197,94,0.15)',
          color: '#22c55e', fontWeight: 600, fontSize: '12px', cursor: 'pointer',
        }}
      >
        ✓ Close ({pendingCount} pts)
      </button>
    )}
  </div>
);

// ── Main Component Props ──────────────────────────────────────────────────────

export interface AnnotationsProps {
  /** Current user's display name for annotation attribution */
  creator?: string;
  /** Whether the annotation panel is visible */
  enabled?: boolean;
  /**
   * Called when the active tool changes, so the globe can switch
   * interaction mode to annotation placement.
   */
  onToolChange?: (tool: AnnotationType | null) => void;
  /**
   * Called when an annotation is added or updated, so the globe
   * can render the annotation overlays.
   */
  onAnnotationsChange?: (annotations: Annotation[]) => void;
  /**
   * Provide this callback to let the globe deliver click coordinates
   * back to this component for annotation placement.
   * The component sets this ref on mount.
   */
  onPlacementRef?: React.MutableRefObject<
    ((lon: number, lat: number) => void) | null
  >;
}

// ── Main Component ────────────────────────────────────────────────────────────

/**
 * Annotations — Collaborative Annotation System.
 *
 * Validates: Requirements 45.1, 45.2, 45.3, 45.4
 */
export const Annotations: React.FC<AnnotationsProps> = ({
  creator = 'User',
  enabled = true,
  onToolChange,
  onAnnotationsChange,
  onPlacementRef,
}) => {
  const {
    annotations,
    activeTool,
    pendingPoints,
    setActiveTool,
    setPendingPoints,
    addAnnotation,
    updateAnnotation,
    deleteAnnotation,
    togglePopup,
    finishPolygon,
    isOnline,
  } = useAnnotations(creator);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Notify parent when tool changes
  useEffect(() => {
    onToolChange?.(activeTool);
  }, [activeTool, onToolChange]);

  // Notify parent when annotations change
  useEffect(() => {
    onAnnotationsChange?.(annotations);
  }, [annotations, onAnnotationsChange]);

  /** Handle a globe click delivering lon/lat for annotation placement */
  const handleGlobePlacement = useCallback(
    (lon: number, lat: number) => {
      if (!activeTool) return;

      if (activeTool === 'pin' || activeTool === 'text') {
        const ann = createAnnotation(activeTool, [lon, lat], creator);
        addAnnotation(ann);
        setSelectedId(ann.id);
        setActiveTool(null);
      } else if (activeTool === 'measurement') {
        setPendingPoints((prev) => {
          const next = [...prev, [lon, lat]];
          if (next.length === 2) {
            const ann = createAnnotation('measurement', next, creator);
            addAnnotation(ann);
            setSelectedId(ann.id);
            setActiveTool(null);
            return [];
          }
          return next;
        });
      } else if (activeTool === 'polygon') {
        setPendingPoints((prev) => [...prev, [lon, lat]]);
      }
    },
    [activeTool, creator, addAnnotation, setActiveTool, setPendingPoints],
  );

  // Wire up the placement ref so the parent globe can call this
  useEffect(() => {
    if (onPlacementRef) {
      onPlacementRef.current = handleGlobePlacement;
    }
  }, [onPlacementRef, handleGlobePlacement]);

  const handleExportGeoJSON = () => {
    downloadGeoJSON(annotations);
  };

  const selectedAnnotation = useMemo(
    () => annotations.find((a) => a.id === selectedId) ?? null,
    [annotations, selectedId],
  );

  const syncedCount = useMemo(
    () => annotations.filter((a) => a.syncStatus === 'synced').length,
    [annotations],
  );

  if (!enabled) return null;

  return (
    <div
      className="annotations-panel"
      data-testid="annotations-panel"
      role="region"
      aria-label="Collaborative Annotations"
    >
      <GlassPanel padding="md" className="annotations-glass">
        {/* ── Header ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            marginBottom: '12px',
            gap: '8px',
          }}
        >
          <h3
            style={{
              fontSize: '18px',
              fontWeight: 600,
              color: 'rgba(var(--fg-rgb),var(--fg-a75))',
              margin: 0,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            🗺️ Annotations
          </h3>
          <span
            style={{
              marginLeft: 'auto',
              fontSize: '11px',
              color: isOnline ? '#22c55e' : '#94a3b8',
              fontWeight: 600,
            }}
            title={isOnline ? 'Online — syncing to server' : 'Offline — saved locally'}
          >
            {isOnline ? '● Online' : '○ Offline'}
          </span>
          {annotations.length > 0 && (
            <span style={{ fontSize: '11px', color: 'rgba(var(--fg-rgb),var(--fg-a3))' }}>
              {syncedCount}/{annotations.length} synced
            </span>
          )}
        </div>

        {/* ── Toolbar — Requirement 45.1 ── */}
        <AnnotationToolbar
          activeTool={activeTool}
          onSelect={setActiveTool}
          pendingCount={pendingPoints.length}
          onFinishPolygon={finishPolygon}
        />

        {/* ── Active tool hint ── */}
        {activeTool && (
          <div
            aria-live="polite"
            style={{
              fontSize: '12px',
              color: ANNOTATION_COLORS[activeTool],
              background: `${ANNOTATION_COLORS[activeTool]}15`,
              border: `1px solid ${ANNOTATION_COLORS[activeTool]}40`,
              borderRadius: '6px',
              padding: '6px 10px',
              marginBottom: '10px',
            }}
          >
            {activeTool === 'pin' && '📍 Click on the globe to place a pin.'}
            {activeTool === 'text' && '✏️ Click on the globe to place a text label.'}
            {activeTool === 'measurement' && (
              pendingPoints.length === 0
                ? '📏 Click start point on the globe.'
                : '📏 Click end point to complete measurement.'
            )}
            {activeTool === 'polygon' && (
              pendingPoints.length === 0
                ? '⬡ Click points on the globe to draw polygon.'
                : `⬡ ${pendingPoints.length} point${pendingPoints.length > 1 ? 's' : ''} — click to add more, or press "Close" when done.`
            )}
          </div>
        )}

        {/* ── Annotation List ── */}
        <div style={{ overflowY: 'auto', maxHeight: '280px', marginBottom: '10px' }}>
          {annotations.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '24px 0',
                color: 'rgba(var(--fg-rgb),var(--fg-a2))',
                fontSize: '13px',
              }}
            >
              No annotations yet.
              <br />
              Select a tool above and click on the globe.
            </div>
          ) : (
            annotations.map((ann) => (
              <AnnotationRow
                key={ann.id}
                annotation={ann}
                isSelected={selectedId === ann.id}
                onSelect={() => {
                  setSelectedId(selectedId === ann.id ? null : ann.id);
                  togglePopup(ann.id);
                }}
                onDelete={deleteAnnotation}
              />
            ))
          )}
        </div>

        {/* ── Editable Popup — Requirement 45.3 ── */}
        {selectedAnnotation && selectedAnnotation.popupOpen && (
          <div style={{ marginBottom: '10px' }}>
            <AnnotationPopup
              annotation={selectedAnnotation}
              onUpdate={updateAnnotation}
              onDelete={deleteAnnotation}
              onClose={() => {
                togglePopup(selectedAnnotation.id);
                setSelectedId(null);
              }}
            />
          </div>
        )}

        {/* ── Export Button — Requirement 45.4 ── */}
        {annotations.length > 0 && (
          <button
            onClick={handleExportGeoJSON}
            aria-label="Export all annotations as GeoJSON"
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: '8px',
              border: '1px solid rgba(59,130,246,0.4)',
              background: 'rgba(59,130,246,0.12)',
              color: '#60a5fa',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              transition: 'background 120ms ease',
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.background = 'rgba(59,130,246,0.22)')
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.background = 'rgba(59,130,246,0.12)')
            }
          >
            ⬇ Export GeoJSON ({annotations.length} annotation{annotations.length !== 1 ? 's' : ''})
          </button>
        )}
      </GlassPanel>
    </div>
  );
};

export default Annotations;
