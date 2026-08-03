/**
 * Tests for the Historical Flood Validation view.
 * Validates: Requirements 82.1, 82.2, 82.3, 82.4
 */

import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  aggregateFloodContingencies,
  computeFloodSkillScores,
  HISTORICAL_FLOOD_VALIDATION_EVENTS,
  HistoricalFloodValidation,
  mergeFloodEventRecords,
  type FloodContingencyTable,
} from './HistoricalFloodValidation';

describe('computeFloodSkillScores', () => {
  it('calculates POD, FAR, and CSI from a known contingency table', () => {
    const table: FloodContingencyTable = { hits: 12, misses: 3, falseAlarms: 5, correctNegatives: 40 };
    const scores = computeFloodSkillScores(table);

    expect(scores.pod).toBeCloseTo(0.8);
    expect(scores.far).toBeCloseTo(5 / 17);
    expect(scores.csi).toBeCloseTo(0.6);
  });

  it('returns N/A-compatible NaN scores when no event instances exist', () => {
    const scores = computeFloodSkillScores({ hits: 0, misses: 0, falseAlarms: 0, correctNegatives: 9 });
    expect(scores.pod).toBeNaN();
    expect(scores.far).toBeNaN();
    expect(scores.csi).toBeNaN();
  });
});

describe('historical flood validation records', () => {
  it('contains every major event mandated by Requirement 82.1', () => {
    expect(HISTORICAL_FLOOD_VALIDATION_EVENTS).toHaveLength(5);
    expect(HISTORICAL_FLOOD_VALIDATION_EVENTS.map((event) => event.name)).toEqual([
      'Sivasagar Floods 2024',
      'Kerala Floods 2018',
      'Chennai Floods 2015',
      'Uttarakhand Disaster 2013',
      'Mumbai Floods 2005',
    ]);
  });

  it('aggregates raw counts before deriving overall skill', () => {
    const aggregate = aggregateFloodContingencies(HISTORICAL_FLOOD_VALIDATION_EVENTS);
    expect(aggregate).toMatchObject({ hits: 209, misses: 38, falseAlarms: 40, correctNegatives: 485 });
    expect(computeFloodSkillScores(aggregate).csi).toBeCloseTo(209 / 287);
  });
});

describe('mergeFloodEventRecords', () => {
  it('keeps validation inputs while refreshing display facts from the API record', () => {
    const [merged] = mergeFloodEventRecords(HISTORICAL_FLOOD_VALIDATION_EVENTS.slice(0, 1), {
      events: [{ name: 'Sivasagar Floods 2024', max_rainfall_mm: 220, affected_population: 120_000, description: 'Server record' }],
    });
    expect(merged.maxRainfallMm).toBe(220);
    expect(merged.description).toBe('Server record');
    expect(merged.contingency).toEqual(HISTORICAL_FLOOD_VALIDATION_EVENTS[0].contingency);
  });
});

describe('HistoricalFloodValidation', () => {
  it('displays event hit/miss lead time and a selected-event counterfactual', () => {
    render(<HistoricalFloodValidation events={HISTORICAL_FLOOD_VALIDATION_EVENTS} />);

    expect(screen.getByRole('heading', { name: 'Flood prediction skill hindcast' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sivasagar Floods 2024' })).toBeInTheDocument();
    expect(screen.getAllByText('72h (3.0d)')).toHaveLength(2);
    expect(screen.getByText(/60 hours of additional warning/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Mumbai Floods 2005' }));
    expect(screen.getByText(/96 hours of additional warning/i)).toBeInTheDocument();
    expect(screen.getByText(/120h model lead versus 24h historical lead/i)).toBeInTheDocument();
  });
});
