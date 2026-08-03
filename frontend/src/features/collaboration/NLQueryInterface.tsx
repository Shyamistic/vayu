/**
 * NLQueryInterface — Natural Language Query Interface.
 *
 * Provides a search/command bar that accepts natural language queries about climate
 * data and parses them into structured intents that drive the dashboard state.
 *
 * Exports pure functions for intent parsing (testable without React).
 *
 * Validates: Requirements 43.1, 43.2, 43.3, 43.4
 */

import React, { useCallback, useRef, useState } from 'react';
import { GlassPanel } from '../../design-system';
import type { RegionId, VariableId } from '../../types';

// ── Types ─────────────────────────────────────────────────────────────────────

/** The four supported query intent categories (Requirement 43.3) */
export type QueryIntent = 'threshold' | 'temporal' | 'spatial' | 'comparative';

/**
 * Structured result produced by the intent parser.
 * `action` is a deferred callback that callers invoke to apply the intent.
 */
export interface NLQueryResult {
  intent: QueryIntent;
  variable?: VariableId;
  threshold?: number;
  region?: RegionId;
  /** ISO-8601 date string, e.g. "2025-07-20" */
  date?: string;
  /** Human-readable description of the parsed intent */
  description: string;
  /** Callable that applies the intent to app state (provided at call site) */
  action: () => void;
}

/** A suggested query reformulation shown when parsing fails */
export interface QuerySuggestion {
  text: string;
  description: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Recognised variable name aliases → canonical VariableId */
export const VARIABLE_ALIASES: ReadonlyMap<string, VariableId> = new Map([
  // rainfall
  ['rainfall', 'rainfall'],
  ['rain', 'rainfall'],
  ['precipitation', 'rainfall'],
  ['precip', 'rainfall'],
  ['mm', 'rainfall'],
  // temp_max
  ['temp_max', 'temp_max'],
  ['temperature', 'temp_max'],
  ['temp', 'temp_max'],
  ['maximum temperature', 'temp_max'],
  ['max temp', 'temp_max'],
  ['tmax', 'temp_max'],
  ['heat', 'temp_max'],
  // temp_min
  ['temp_min', 'temp_min'],
  ['minimum temperature', 'temp_min'],
  ['min temp', 'temp_min'],
  ['tmin', 'temp_min'],
  ['cold', 'temp_min'],
]);

/** Recognised region name aliases → canonical RegionId */
export const REGION_ALIASES: ReadonlyMap<string, RegionId> = new Map([
  ['western ghats', 'western_ghats'],
  ['western_ghats', 'western_ghats'],
  ['ghats', 'western_ghats'],
  ['northeast india', 'north_east_india'],
  ['north east india', 'north_east_india'],
  ['north_east_india', 'north_east_india'],
  ['northeast', 'north_east_india'],
  ['indo gangetic plain', 'indo_gangetic_plain'],
  ['indo-gangetic plain', 'indo_gangetic_plain'],
  ['indo_gangetic_plain', 'indo_gangetic_plain'],
  ['gangetic', 'indo_gangetic_plain'],
  ['igp', 'indo_gangetic_plain'],
  ['central india', 'central_india'],
  ['central_india', 'central_india'],
  ['central', 'central_india'],
  ['pilot', 'pilot'],
]);

/** Default suggestions displayed when a query cannot be parsed (Requirement 43.4) */
export const DEFAULT_SUGGESTIONS: QuerySuggestion[] = [
  {
    text: 'rainfall > 50mm in Western Ghats',
    description: 'Show grid cells exceeding a rainfall threshold in a region',
  },
  {
    text: 'temperature tomorrow in Northeast India',
    description: 'Show temperature forecast for a specific date and region',
  },
  {
    text: 'compare rainfall vs temperature Central India',
    description: 'Overlay two variables side-by-side for comparison',
  },
  {
    text: 'drought conditions in Indo-Gangetic Plain next 7 days',
    description: 'Temporal forecast query with drought-related variable',
  },
  {
    text: 'where is rainfall above 100mm?',
    description: 'Spatial query for high-rainfall grid cells',
  },
];

// ── Pure Parsing Functions ────────────────────────────────────────────────────

/**
 * Normalise a raw query string: lowercase, collapse whitespace.
 */
export function normaliseQuery(query: string): string {
  return query.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Extract the first recognised VariableId from a normalised query.
 * Tries longer aliases first (greedy matching) to avoid partial matches.
 *
 * Requirement 43.2: extract correct variable identifier.
 */
export function extractVariable(normalisedQuery: string): VariableId | undefined {
  // Sort by descending alias length so longer phrases match before shorter ones
  const sorted = Array.from(VARIABLE_ALIASES.entries()).sort(
    ([a], [b]) => b.length - a.length,
  );
  for (const [alias, variableId] of sorted) {
    if (normalisedQuery.includes(alias)) return variableId;
  }
  return undefined;
}

/**
 * Extract the first numeric threshold from a normalised query.
 * Supports patterns like "> 50mm", "above 100", "exceeds 75", "< 10°C", "below 5".
 *
 * Requirement 43.2: extract correct threshold value.
 */
export function extractThreshold(normalisedQuery: string): number | undefined {
  // Operator + number (">50", "> 50mm", "< 10°c", "above 100", "below 5")
  const operatorPattern =
    /(?:>|>=|<|<=|above|below|over|under|exceeds?|greater than|less than)\s*(\d+(?:\.\d+)?)/i;
  const match = normalisedQuery.match(operatorPattern);
  if (match) return parseFloat(match[1]);

  // Standalone number with unit ("50mm", "40°c", "100 mm")
  const unitPattern = /(\d+(?:\.\d+)?)\s*(?:mm|°c|celsius|degrees?)/i;
  const unitMatch = normalisedQuery.match(unitPattern);
  if (unitMatch) return parseFloat(unitMatch[1]);

  return undefined;
}

/**
 * Extract a RegionId from a normalised query.
 * Tries longer aliases first for greedy matching.
 *
 * Requirement 43.3 (spatial intent): extract location.
 */
export function extractRegion(normalisedQuery: string): RegionId | undefined {
  const sorted = Array.from(REGION_ALIASES.entries()).sort(
    ([a], [b]) => b.length - a.length,
  );
  for (const [alias, regionId] of sorted) {
    if (normalisedQuery.includes(alias)) return regionId;
  }
  return undefined;
}

/**
 * Extract a date from a normalised query.
 * Handles:
 *  - "today" → current date
 *  - "tomorrow" → today + 1
 *  - "in N days" / "after N days" → today + N
 *  - "next week" → today + 7
 *  - ISO / common date strings
 *
 * Returns an ISO-8601 date string (YYYY-MM-DD) or undefined.
 *
 * Requirement 43.3 (temporal intent): extract date.
 */
export function extractDate(normalisedQuery: string, referenceDate?: Date): string | undefined {
  const base = referenceDate ?? new Date();
  const toISO = (d: Date) => d.toISOString().slice(0, 10);

  if (/\btoday\b/.test(normalisedQuery)) return toISO(base);

  if (/\btomorrow\b/.test(normalisedQuery)) {
    const d = new Date(base);
    d.setDate(d.getDate() + 1);
    return toISO(d);
  }

  if (/\bnext week\b/.test(normalisedQuery)) {
    const d = new Date(base);
    d.setDate(d.getDate() + 7);
    return toISO(d);
  }

  // "in N days" / "after N days" / "next N days"
  const relativeDayMatch = normalisedQuery.match(
    /(?:in|after|next)\s+(\d+)\s+days?/,
  );
  if (relativeDayMatch) {
    const d = new Date(base);
    d.setDate(d.getDate() + parseInt(relativeDayMatch[1], 10));
    return toISO(d);
  }

  // ISO date: YYYY-MM-DD
  const isoMatch = normalisedQuery.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoMatch) return isoMatch[1];

  // DD/MM/YYYY or MM/DD/YYYY (ambiguous — treat as DD/MM for Indian context)
  const dmyMatch = normalisedQuery.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (dmyMatch) {
    const [, dd, mm, yyyy] = dmyMatch;
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }

  return undefined;
}

/**
 * Classify the primary query intent from the parsed components.
 *
 * Priority order:
 *  1. comparative — explicit compare/versus keyword
 *  2. temporal    — date present
 *  3. threshold   — threshold present
 *  4. spatial     — region present without threshold/date
 *  5. threshold   — fallback when variable + number found but no explicit operator
 *
 * Requirement 43.3: support threshold, temporal, spatial, and comparative types.
 */
export function classifyIntent(
  normalisedQuery: string,
  variable: VariableId | undefined,
  threshold: number | undefined,
  region: RegionId | undefined,
  date: string | undefined,
): QueryIntent {
  const isComparative = /\b(?:compare|versus|vs\.?|vs\s|compared to|difference between)\b/.test(
    normalisedQuery,
  );
  if (isComparative) return 'comparative';
  if (date !== undefined) return 'temporal';
  if (threshold !== undefined) return 'threshold';
  if (region !== undefined && variable !== undefined) return 'spatial';
  return 'threshold'; // default when at least variable is found
}

/**
 * Build a human-readable description of the parsed intent for UI display.
 */
export function buildDescription(
  intent: QueryIntent,
  variable: VariableId | undefined,
  threshold: number | undefined,
  region: RegionId | undefined,
  date: string | undefined,
): string {
  const varLabel = variable
    ? { rainfall: 'Rainfall', temp_max: 'Max Temperature', temp_min: 'Min Temperature' }[variable]
    : 'variable';
  const regionLabel = region
    ? region.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : 'all regions';

  switch (intent) {
    case 'threshold':
      return threshold !== undefined
        ? `Show ${varLabel} > ${threshold} in ${regionLabel}`
        : `Threshold query for ${varLabel} in ${regionLabel}`;
    case 'temporal':
      return `Show ${varLabel} forecast for ${date ?? 'selected date'} in ${regionLabel}`;
    case 'spatial':
      return `Map ${varLabel} across ${regionLabel}`;
    case 'comparative':
      return `Compare ${varLabel} patterns in ${regionLabel}`;
  }
}

/**
 * Generate contextual reformulation suggestions when a query cannot be parsed.
 * Returns a mix of generic suggestions enriched with any partial extractions.
 *
 * Requirement 43.4: display suggested reformulations for unparseable queries.
 */
export function generateSuggestions(
  normalisedQuery: string,
  partialVariable?: VariableId,
  partialRegion?: RegionId,
): QuerySuggestion[] {
  const suggestions: QuerySuggestion[] = [];

  // Enrich with partial extractions when available
  if (partialVariable && !partialRegion) {
    const varLabel = { rainfall: 'rainfall', temp_max: 'temperature', temp_min: 'minimum temperature' }[
      partialVariable
    ];
    suggestions.push({
      text: `${varLabel} > 50 in Western Ghats`,
      description: `Try adding a threshold and region for ${varLabel}`,
    });
    suggestions.push({
      text: `${varLabel} forecast next 7 days`,
      description: `Ask about the ${varLabel} forecast over time`,
    });
  } else if (partialRegion && !partialVariable) {
    const regionLabel = partialRegion.replace(/_/g, ' ');
    suggestions.push({
      text: `rainfall > 50mm in ${regionLabel}`,
      description: `Add a variable and threshold for ${regionLabel}`,
    });
    suggestions.push({
      text: `temperature tomorrow in ${regionLabel}`,
      description: `Ask about temperature forecast in ${regionLabel}`,
    });
  }

  // Pad with defaults to always show at least 3 suggestions
  const remaining = DEFAULT_SUGGESTIONS.filter(
    (s) => !suggestions.some((x) => x.text === s.text),
  );
  return [...suggestions, ...remaining].slice(0, 5);
}

/**
 * Master intent parser — accepts a raw query string and an optional
 * `onApply` callback that is embedded in the returned `action`.
 *
 * Returns `null` when the query cannot be meaningfully parsed
 * (i.e., no variable or region could be extracted).
 *
 * Requirement 43.2: parse variable + threshold.
 * Requirement 43.3: classify intent type.
 */
export function parseQuery(
  rawQuery: string,
  onApply: (result: Omit<NLQueryResult, 'action'>) => void = () => {},
  referenceDate?: Date,
): NLQueryResult | null {
  const normalised = normaliseQuery(rawQuery);

  const variable = extractVariable(normalised);
  const threshold = extractThreshold(normalised);
  const region = extractRegion(normalised);
  const date = extractDate(normalised, referenceDate);

  // Need at least a variable or a region to produce a useful result
  if (!variable && !region) return null;

  const intent = classifyIntent(normalised, variable, threshold, region, date);
  const description = buildDescription(intent, variable, threshold, region, date);

  const payload: Omit<NLQueryResult, 'action'> = {
    intent,
    variable,
    threshold,
    region,
    date,
    description,
  };

  return { ...payload, action: () => onApply(payload) };
}

// ── Sub-components ────────────────────────────────────────────────────────────

/** Badge showing the classified intent type */
const IntentBadge: React.FC<{ intent: QueryIntent }> = ({ intent }) => {
  const config: Record<QueryIntent, { label: string; color: string; bg: string }> = {
    threshold: { label: 'Threshold',   color: '#f97316', bg: 'rgba(249,115,22,0.12)' },
    temporal:  { label: 'Temporal',    color: '#60a5fa', bg: 'rgba(96,165,250,0.12)' },
    spatial:   { label: 'Spatial',     color: '#34d399', bg: 'rgba(52,211,153,0.12)' },
    comparative: { label: 'Comparative', color: '#c084fc', bg: 'rgba(192,132,252,0.12)' },
  };
  const { label, color, bg } = config[intent];
  return (
    <span
      aria-label={`Query type: ${label}`}
      style={{
        background: bg,
        border: `1px solid ${color}`,
        borderRadius: '4px',
        color,
        fontSize: '11px',
        fontWeight: 600,
        padding: '2px 7px',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        flexShrink: 0,
      }}
    >
      {label}
    </span>
  );
};

/** Rendered card for a successfully parsed query result */
const ParsedResultCard: React.FC<{
  result: NLQueryResult;
  onApply: () => void;
}> = ({ result, onApply }) => (
  <div
    style={{
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(255,255,255,0.10)',
      borderRadius: '8px',
      padding: '10px 12px',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
    }}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
      <IntentBadge intent={result.intent} />
      <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.85)', flex: 1 }}>
        {result.description}
      </span>
    </div>

    {/* Extracted entity chips */}
    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
      {result.variable && (
        <Chip label="Variable" value={result.variable.replace('_', ' ')} color="#94a3b8" />
      )}
      {result.threshold !== undefined && (
        <Chip label="Threshold" value={`${result.threshold}`} color="#f97316" />
      )}
      {result.region && (
        <Chip
          label="Region"
          value={result.region.replace(/_/g, ' ')}
          color="#34d399"
        />
      )}
      {result.date && (
        <Chip label="Date" value={result.date} color="#60a5fa" />
      )}
    </div>

    <button
      onClick={onApply}
      aria-label="Apply this query to the dashboard"
      style={{
        alignSelf: 'flex-end',
        background: 'rgba(96,165,250,0.15)',
        border: '1px solid rgba(96,165,250,0.4)',
        borderRadius: '6px',
        color: '#93c5fd',
        cursor: 'pointer',
        fontSize: '12px',
        fontWeight: 600,
        padding: '4px 12px',
        transition: 'background 150ms ease',
      }}
      onMouseEnter={(e) =>
        ((e.currentTarget as HTMLButtonElement).style.background = 'rgba(96,165,250,0.28)')
      }
      onMouseLeave={(e) =>
        ((e.currentTarget as HTMLButtonElement).style.background = 'rgba(96,165,250,0.15)')
      }
    >
      Apply →
    </button>
  </div>
);

const Chip: React.FC<{ label: string; value: string; color: string }> = ({
  label,
  value,
  color,
}) => (
  <span
    style={{
      background: `${color}18`,
      border: `1px solid ${color}50`,
      borderRadius: '4px',
      color,
      fontSize: '11px',
      padding: '1px 6px',
    }}
  >
    <span style={{ color: 'rgba(255,255,255,0.35)', marginRight: '3px' }}>{label}:</span>
    {value}
  </span>
);

/** List of suggestion chips shown when parsing fails */
const SuggestionsPanel: React.FC<{
  suggestions: QuerySuggestion[];
  onSelect: (text: string) => void;
}> = ({ suggestions, onSelect }) => (
  <div style={{ marginTop: '8px' }}>
    <p
      style={{
        fontSize: '11px',
        color: 'rgba(255,255,255,0.4)',
        margin: '0 0 6px 0',
        fontWeight: 500,
      }}
    >
      Try one of these:
    </p>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      {suggestions.map((s) => (
        <button
          key={s.text}
          onClick={() => onSelect(s.text)}
          aria-label={`Use suggestion: ${s.text}`}
          title={s.description}
          style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '6px',
            color: 'rgba(255,255,255,0.65)',
            cursor: 'pointer',
            fontSize: '12px',
            padding: '6px 10px',
            textAlign: 'left',
            transition: 'background 120ms ease, color 120ms ease',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              'rgba(255,255,255,0.07)';
            (e.currentTarget as HTMLButtonElement).style.color =
              'rgba(255,255,255,0.9)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              'rgba(255,255,255,0.03)';
            (e.currentTarget as HTMLButtonElement).style.color =
              'rgba(255,255,255,0.65)';
          }}
        >
          <span style={{ marginRight: '6px', opacity: 0.45 }}>↗</span>
          {s.text}
        </button>
      ))}
    </div>
  </div>
);

// ── Props ─────────────────────────────────────────────────────────────────────

export interface NLQueryInterfaceProps {
  /**
   * Called when a query is successfully parsed and the user clicks "Apply".
   * Receives the structured result (minus the `action` wrapper).
   */
  onQueryApply?: (result: Omit<NLQueryResult, 'action'>) => void;
  /** Placeholder text for the search bar */
  placeholder?: string;
  /** Reference date for relative date parsing (defaults to today) */
  referenceDate?: Date;
  /** Whether the panel is expanded by default */
  defaultExpanded?: boolean;
}

// ── Main Component ────────────────────────────────────────────────────────────

/**
 * NLQueryInterface — Natural Language Query Interface.
 *
 * Requirement 43.1: search/command bar accepting natural language queries.
 * Requirement 43.2: extract variable identifier and threshold value.
 * Requirement 43.3: support threshold, temporal, spatial, comparative intents.
 * Requirement 43.4: display suggested reformulations when parsing fails.
 */
export const NLQueryInterface: React.FC<NLQueryInterfaceProps> = ({
  onQueryApply,
  placeholder = 'Ask about climate data… e.g. "rainfall > 50mm in Western Ghats"',
  referenceDate,
  defaultExpanded = false,
}) => {
  const [query, setQuery] = useState('');
  const [parsedResult, setParsedResult] = useState<NLQueryResult | null>(null);
  const [parseAttempted, setParseAttempted] = useState(false);
  const [suggestions, setSuggestions] = useState<QuerySuggestion[]>([]);
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleApply = useCallback(
    (result: Omit<NLQueryResult, 'action'>) => {
      onQueryApply?.(result);
    },
    [onQueryApply],
  );

  const handleSubmit = useCallback(
    (raw: string) => {
      const normalised = normaliseQuery(raw);
      if (!normalised) return;

      const result = parseQuery(raw, handleApply, referenceDate);
      setParsedResult(result);
      setParseAttempted(true);

      if (!result) {
        // Build contextual suggestions from partial extractions
        const partialVar = extractVariable(normalised);
        const partialRegion = extractRegion(normalised);
        setSuggestions(generateSuggestions(normalised, partialVar, partialRegion));
      } else {
        setSuggestions([]);
      }
    },
    [handleApply, referenceDate],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSubmit(query);
    }
    if (e.key === 'Escape') {
      setQuery('');
      setParsedResult(null);
      setParseAttempted(false);
      setSuggestions([]);
    }
  };

  const handleSuggestionSelect = (text: string) => {
    setQuery(text);
    handleSubmit(text);
    inputRef.current?.focus();
  };

  const handleClear = () => {
    setQuery('');
    setParsedResult(null);
    setParseAttempted(false);
    setSuggestions([]);
    inputRef.current?.focus();
  };

  const showParseFailure = parseAttempted && !parsedResult;

  return (
    <div
      className="nl-query-interface"
      data-testid="nl-query-interface"
      role="region"
      aria-label="Natural Language Query Interface"
      style={{ width: '100%' }}
    >
      <GlassPanel padding="md" className="nl-query-panel">
        {/* ── Header ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: isExpanded ? '10px' : '0',
          }}
        >
          <span
            aria-hidden="true"
            style={{ fontSize: '16px', flexShrink: 0 }}
          >
            🔍
          </span>
          <h3
            style={{
              flex: 1,
              fontSize: 'var(--font-heading-sm, 15px)',
              fontWeight: 600,
              color: 'rgba(255,255,255,0.9)',
              margin: 0,
            }}
          >
            Climate Query
          </h3>
          <button
            aria-expanded={isExpanded}
            aria-controls="nl-query-body"
            onClick={() => setIsExpanded((v) => !v)}
            style={{
              background: 'none',
              border: 'none',
              color: 'rgba(255,255,255,0.4)',
              cursor: 'pointer',
              fontSize: '12px',
              padding: '2px 6px',
              transition: 'color 150ms ease',
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.color =
                'rgba(255,255,255,0.8)')
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.color =
                'rgba(255,255,255,0.4)')
            }
          >
            {isExpanded ? '▲' : '▼'}
          </button>
        </div>

        {/* ── Collapsible body ── */}
        <div
          id="nl-query-body"
          hidden={!isExpanded}
          aria-hidden={!isExpanded}
        >
          {/* Search bar */}
          <div style={{ position: 'relative', display: 'flex', gap: '6px' }}>
            <input
              ref={inputRef}
              type="text"
              role="searchbox"
              aria-label="Natural language climate query"
              value={query}
              placeholder={placeholder}
              onChange={(e) => {
                setQuery(e.target.value);
                if (parseAttempted && !e.target.value) {
                  setParsedResult(null);
                  setParseAttempted(false);
                  setSuggestions([]);
                }
              }}
              onKeyDown={handleKeyDown}
              style={{
                flex: 1,
                background: 'rgba(255,255,255,0.06)',
                border: `1px solid ${showParseFailure ? 'rgba(239,68,68,0.5)' : 'rgba(255,255,255,0.14)'}`,
                borderRadius: '8px',
                color: 'rgba(255,255,255,0.9)',
                fontSize: '13px',
                outline: 'none',
                padding: '8px 12px',
                transition: 'border-color 150ms ease',
              }}
              onFocus={(e) =>
                ((e.currentTarget as HTMLInputElement).style.borderColor =
                  'rgba(96,165,250,0.6)')
              }
              onBlur={(e) =>
                ((e.currentTarget as HTMLInputElement).style.borderColor =
                  showParseFailure
                    ? 'rgba(239,68,68,0.5)'
                    : 'rgba(255,255,255,0.14)')
              }
            />
            {query && (
              <button
                aria-label="Clear query"
                onClick={handleClear}
                style={{
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: '6px',
                  color: 'rgba(255,255,255,0.5)',
                  cursor: 'pointer',
                  fontSize: '12px',
                  padding: '0 10px',
                  transition: 'background 120ms ease',
                }}
              >
                ✕
              </button>
            )}
            <button
              aria-label="Submit query"
              onClick={() => handleSubmit(query)}
              style={{
                background: 'rgba(96,165,250,0.18)',
                border: '1px solid rgba(96,165,250,0.4)',
                borderRadius: '6px',
                color: '#93c5fd',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: 600,
                padding: '0 14px',
                transition: 'background 120ms ease',
              }}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLButtonElement).style.background =
                  'rgba(96,165,250,0.30)')
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLButtonElement).style.background =
                  'rgba(96,165,250,0.18)')
              }
            >
              Ask
            </button>
          </div>

          {/* Parsed result */}
          {parsedResult && (
            <div style={{ marginTop: '10px' }}>
              <ParsedResultCard
                result={parsedResult}
                onApply={() => parsedResult.action()}
              />
            </div>
          )}

          {/* Parse failure + suggestions (Requirement 43.4) */}
          {showParseFailure && (
            <div style={{ marginTop: '8px' }}>
              <p
                role="alert"
                aria-live="polite"
                style={{
                  fontSize: '12px',
                  color: 'rgba(239,68,68,0.85)',
                  margin: '0 0 4px 0',
                }}
              >
                Could not parse that query. Try including a variable name (rainfall, temperature)
                and optionally a threshold, region, or date.
              </p>
              <SuggestionsPanel
                suggestions={suggestions}
                onSelect={handleSuggestionSelect}
              />
            </div>
          )}

          {/* Keyboard hint */}
          {!parseAttempted && (
            <p
              style={{
                fontSize: '11px',
                color: 'rgba(255,255,255,0.28)',
                margin: '6px 0 0 0',
              }}
            >
              Press Enter to submit · Esc to clear
            </p>
          )}
        </div>
      </GlassPanel>

      {/* Animations */}
      <style>{`
        .nl-query-interface input::placeholder {
          color: rgba(255, 255, 255, 0.3);
        }
      `}</style>
    </div>
  );
};

export default NLQueryInterface;
