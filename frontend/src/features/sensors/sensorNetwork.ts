import type { GridCell, IoTStation } from '../../types';

export interface StationPredictionError {
  nearestCell: GridCell | null;
  temperatureC: number | null;
  rainfallProxy: number | null;
}

/** Returns the climate-grid cell closest to the supplied station coordinates. */
export function findNearestGridCell(
  station: Pick<IoTStation, 'lat' | 'lon'>,
  gridCells: GridCell[],
): GridCell | null {
  return gridCells.reduce<GridCell | null>((nearest, cell) => {
    if (!nearest) return cell;
    const currentDistance = (cell.lat - station.lat) ** 2 + (cell.lon - station.lon) ** 2;
    const nearestDistance = (nearest.lat - station.lat) ** 2 + (nearest.lon - station.lon) ** 2;
    return currentDistance < nearestDistance ? cell : nearest;
  }, null);
}

/**
 * Calculates model-minus-observation error for readings that map to VAYU output.
 * Temperature uses the model's min/max midpoint; rainfall is a 0/1 detection proxy.
 */
export function calculateStationPredictionError(
  station: IoTStation,
  gridCells: GridCell[],
): StationPredictionError {
  const nearestCell = findNearestGridCell(station, gridCells);
  if (!nearestCell) return { nearestCell: null, temperatureC: null, rainfallProxy: null };

  const observedTemperature = station.sensors?.temperature_c;
  const predictedTemperature = (nearestCell.temp_max + nearestCell.temp_min) / 2;
  const temperatureC = observedTemperature == null
    ? null
    : predictedTemperature - observedTemperature;

  const observedRain = station.sensors?.rain_detected;
  const rainfallProxy = observedRain == null
    ? null
    : Number(nearestCell.rainfall > 1) - Number(observedRain);

  return { nearestCell, temperatureC, rainfallProxy };
}

export function formatSignedError(value: number, fractionDigits = 1): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(fractionDigits)}`;
}
