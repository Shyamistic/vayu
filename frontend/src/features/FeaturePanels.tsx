/**
 * Mounts the `features/` panels that the app previously never imported.
 *
 * Context: `App.tsx` imported 3 components out of ~35 built and tested ones. The
 * rest — ~20,000 lines with roughly 1,000 passing tests — were unreachable from the
 * running app. This container groups them into four categories and, critically,
 * feeds them REAL data (`gridCells`, the 7-day forecast series, region, variable)
 * so they stop falling back to their internal mock constants.
 *
 * Every panel is wrapped in `FeaturePanel`, which renders the provenance declared
 * in `features/provenance/registry.ts`. Panels with no real data source behind them
 * are shown badged "Demo / simulated" rather than hidden — hiding them loses real
 * capability, and showing them unlabelled would misrepresent placeholder numbers as
 * model output.
 */
import { useMemo } from 'react';
import type React from 'react';

import { FeaturePanel } from './provenance/ProvenanceBadge';
import { useForecastSeries } from '../core/api/useForecastSeries';
import type { GridCell, RegionId, VariableId } from '../types';

// analysis
import { MultiHazardView } from './analysis/MultiHazardView';
import { WatershedAnalysis } from './analysis/WatershedAnalysis';
import { MicroClimateZones } from './analysis/MicroClimateZones';
import { OrographicAnalysis } from './analysis/OrographicAnalysis';
import { UrbanHeatIsland } from './analysis/UrbanHeatIsland';
import { PopulationExposure } from './analysis/PopulationExposure';
import { ResolutionDisplay } from './analysis/ResolutionDisplay';
import { ClimateChangeProjection } from './analysis/ClimateChangeProjection';
// weather
import { LightningDetection } from './weather/LightningDetection';
import { PrecipitationType } from './weather/PrecipitationType';
// sectors
import { AgricultureAdvisory } from './sectors/AgricultureAdvisory';
import { EnergyPanel } from './sectors/EnergyPanel';
import { WaterResources } from './sectors/WaterResources';
import { VegetationHealth } from './sectors/VegetationHealth';
import { OceanCoastal } from './sectors/OceanCoastal';
// model lab
import { NWPComparison } from './model/NWPComparison';
import { Explainability } from './model/Explainability';
import { EnsembleUncertainty } from './model/EnsembleUncertainty';
import { VerificationScoring } from './model/VerificationScoring';
import { HistoricalReplay } from './model/HistoricalReplay';
// collaboration
import { NLQueryInterface } from './collaboration/NLQueryInterface';
import { Annotations } from './collaboration/Annotations';
import { AIClimateBrief } from './collaboration/AIClimateBrief';
import { ReportGenerator } from './collaboration/ReportGenerator';

/** The four categories added to the app's view tabs. */
export type FeatureCategory = 'analysis' | 'sectors' | 'model-lab' | 'collaborate';

export interface FeaturePanelsProps {
  category: FeatureCategory;
  gridCells: GridCell[];
  region: RegionId;
  variable: VariableId;
  /** 'yyyy-MM-dd' of the active forecast. */
  forecastDate: string;
  /** Active lead day (1-7). */
  forecastDay: number;
}

const STACK: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 14 };

/** Centroid of the loaded cells, so NWP comparison probes the region actually shown. */
function useCentroid(gridCells: GridCell[]): { lat: number; lon: number } | null {
  return useMemo(() => {
    if (gridCells.length === 0) return null;
    let lat = 0;
    let lon = 0;
    for (const c of gridCells) {
      lat += c.lat;
      lon += c.lon;
    }
    return { lat: lat / gridCells.length, lon: lon / gridCells.length };
  }, [gridCells]);
}

export const FeaturePanels: React.FC<FeaturePanelsProps> = ({
  category,
  gridCells,
  region,
  variable,
  forecastDate,
  forecastDay,
}) => {
  const centroid = useCentroid(gridCells);

  // Only the categories that actually consume the multi-day series request it, so
  // opening "Analysis" does not fire seven prediction calls.
  const needsSeries = category === 'sectors' || category === 'collaborate';
  const { data: series } = useForecastSeries({
    date: forecastDate,
    region,
    enabled: needsSeries && Boolean(forecastDate),
  });

  const daysCells = series?.daysCells ?? [];
  const byLeadDay = series?.byLeadDay ?? new Map<number, GridCell[]>();

  if (category === 'analysis') {
    return (
      <div style={STACK}>
        <FeaturePanel panelId="ResolutionDisplay">
          <ResolutionDisplay gridCells={gridCells} selectedVariable={variable} />
        </FeaturePanel>
        <FeaturePanel panelId="MultiHazardView">
          <MultiHazardView gridCells={gridCells} region={region} />
        </FeaturePanel>
        <FeaturePanel panelId="WatershedAnalysis">
          <WatershedAnalysis gridCells={gridCells} region={region} />
        </FeaturePanel>
        <FeaturePanel panelId="MicroClimateZones">
          <MicroClimateZones gridCells={gridCells} variable={variable} />
        </FeaturePanel>
        <FeaturePanel panelId="OrographicAnalysis">
          <OrographicAnalysis gridCells={gridCells} />
        </FeaturePanel>
        <FeaturePanel panelId="UrbanHeatIsland">
          <UrbanHeatIsland gridCells={gridCells} />
        </FeaturePanel>
        <FeaturePanel panelId="PopulationExposure">
          <PopulationExposure gridCells={gridCells} region={region} />
        </FeaturePanel>
        <FeaturePanel panelId="LightningDetection">
          <LightningDetection gridCells={gridCells} />
        </FeaturePanel>
        <FeaturePanel panelId="PrecipitationType">
          <PrecipitationType gridCells={gridCells} />
        </FeaturePanel>
        <FeaturePanel panelId="ClimateChangeProjection">
          <ClimateChangeProjection variable={variable} />
        </FeaturePanel>
      </div>
    );
  }

  if (category === 'sectors') {
    return (
      <div style={STACK}>
        <FeaturePanel panelId="AgricultureAdvisory">
          <AgricultureAdvisory forecastCells={gridCells} />
        </FeaturePanel>
        <FeaturePanel panelId="WaterResources">
          <WaterResources dailyCells={daysCells} />
        </FeaturePanel>
        <FeaturePanel panelId="EnergyPanel">
          <EnergyPanel forecastGrids={byLeadDay} selectedDay={forecastDay} />
        </FeaturePanel>
        <FeaturePanel panelId="VegetationHealth">
          <VegetationHealth gridCells={gridCells} />
        </FeaturePanel>
        <FeaturePanel panelId="OceanCoastal">
          <OceanCoastal gridCells={gridCells} />
        </FeaturePanel>
      </div>
    );
  }

  if (category === 'model-lab') {
    return (
      <div style={STACK}>
        <FeaturePanel panelId="NWPComparison">
          <NWPComparison
            gridCells={gridCells}
            variable={variable}
            lat={centroid?.lat}
            lon={centroid?.lon}
          />
        </FeaturePanel>
        <FeaturePanel panelId="Explainability">
          <Explainability gridCells={gridCells} selectedCell={null} />
        </FeaturePanel>
        <FeaturePanel panelId="EnsembleUncertainty">
          <EnsembleUncertainty gridCells={gridCells} variable={variable} />
        </FeaturePanel>
        <FeaturePanel panelId="VerificationScoring">
          <VerificationScoring />
        </FeaturePanel>
        <FeaturePanel panelId="HistoricalReplay">
          <HistoricalReplay />
        </FeaturePanel>
      </div>
    );
  }

  return (
    <div style={STACK}>
      <FeaturePanel panelId="NLQueryInterface">
        <NLQueryInterface />
      </FeaturePanel>
      <FeaturePanel panelId="AIClimateBrief">
        <AIClimateBrief cells={gridCells} region={region} forecastDate={forecastDate} />
      </FeaturePanel>
      <FeaturePanel panelId="ReportGenerator">
        <ReportGenerator region={region} variable={variable} forecastDaysCells={daysCells} />
      </FeaturePanel>
      <FeaturePanel panelId="Annotations">
        <Annotations />
      </FeaturePanel>
    </div>
  );
};

export default FeaturePanels;
