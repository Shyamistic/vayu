/**
 * Extract one grid node's values across consecutive forecast lead days.
 *
 * `useForecastSeries` returns the full grid for each of the 7 lead days. A cell
 * inspector needs the opposite slice: one node, all leads. This does that
 * selection as a pure function so the alignment rules are testable without
 * rendering a globe.
 *
 * Two rules matter and both exist to prevent a misleading chart:
 *
 * 1. **Stop at the first gap.** `daysCells[i]` is `[]` when lead day i+1 failed
 *    to fetch. If we skipped the hole and kept collecting, the value actually
 *    belonging to T+5 would be plotted and labelled T+4. Truncating keeps every
 *    point on its true lead day; the caller reports the series as partial.
 * 2. **Match by `node_idx` first.** Node indices are stable for a given
 *    region/date because the graph is rebuilt identically, so this is exact.
 *    Lat/lon equality is only a fallback, and it is compared with a tolerance
 *    because coordinates round-trip through JSON.
 */
import type { GridCell } from '../../types';

/** Half a 0.25° cell — close enough to be the same node, far enough to be unambiguous. */
const COORD_TOLERANCE_DEG = 0.125;

function isSameNode(candidate: GridCell, target: GridCell): boolean {
  if (
    typeof candidate.node_idx === 'number' &&
    typeof target.node_idx === 'number' &&
    candidate.node_idx === target.node_idx
  ) {
    return true;
  }
  return (
    Math.abs(candidate.lat - target.lat) <= COORD_TOLERANCE_DEG &&
    Math.abs(candidate.lon - target.lon) <= COORD_TOLERANCE_DEG
  );
}

export interface NodeSeries {
  /** The node's cell per lead day, contiguous from T+1. Empty when unavailable. */
  cells: GridCell[];
  /** True when fewer than every requested lead day resolved. */
  isPartial: boolean;
}

/**
 * @param daysCells Full grid per lead day, index 0 = T+1 (as `useForecastSeries` returns).
 * @param target    The clicked cell, used to identify which node to follow.
 */
export function selectNodeSeries(
  daysCells: GridCell[][] | undefined,
  target: GridCell | undefined,
): NodeSeries {
  if (!daysCells || daysCells.length === 0 || !target) {
    return { cells: [], isPartial: false };
  }

  const cells: GridCell[] = [];
  for (const dayCells of daysCells) {
    const match = dayCells.find((c) => isSameNode(c, target));
    // A missing lead day truncates the series rather than shifting later days
    // onto earlier labels — see rule 1 above.
    if (!match) break;
    cells.push(match);
  }

  return { cells, isPartial: cells.length < daysCells.length };
}
