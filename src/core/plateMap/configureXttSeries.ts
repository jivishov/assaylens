import { COLUMNS, parseWellName, ROWS, wellName } from "../geometry/plateGrid";
import { applySerialDilution, type DilutionDirection } from "./serialDilution";
import type { PlateMapCell } from "./plateMapTypes";

export type HorizontalXttSeriesConfig = {
  startWell: string;
  direction: Extract<DilutionDirection, "right" | "left">;
  compoundId: string;
  sampleId: string;
  startConcentration: number;
  dilutionFactor: number;
  doseCount: number;
  replicateCount: number;
  unit: string;
  normalizationGroupId: string;
  usesVehicleControl: boolean;
  overwrite: boolean;
};

export type ConfigureXttSeriesResult = {
  plateMap: PlateMapCell[];
  changedWells: string[];
};

export function configureXttSeriesAtomic(
  plateMap: PlateMapCell[],
  config: HorizontalXttSeriesConfig
): ConfigureXttSeriesResult {
  const start = parseWellName(config.startWell);
  const rows = Array.from({ length: config.replicateCount }, (_item, index) => start.row + index);
  if (rows.some((row) => row < 0 || row >= ROWS)) {
    throw new Error("Replicate rows extend outside the 8 x 12 plate.");
  }

  const cols = Array.from({ length: config.doseCount }, (_item, index) =>
    config.direction === "right" ? start.col + index : start.col - index
  );
  if (cols.some((col) => col < 0 || col >= COLUMNS)) {
    throw new Error("Dose series extends outside the 8 x 12 plate.");
  }

  const targetSet = new Set(rows.flatMap((row) => cols.map((col) => wellName(row, col))));
  const changedWells = [...targetSet];
  const collisions = plateMap
    .filter((cell) => targetSet.has(cell.well) && cell.role !== "unused")
    .map((cell) => cell.well);
  if (!config.overwrite && collisions.length > 0) {
    throw new Error(`Target wells are already assigned: ${collisions.join(", ")}.`);
  }

  const identityConflicts = plateMap.filter(
    (cell) =>
      cell.role === "sample" &&
      cell.compoundId.trim() === config.compoundId.trim() &&
      cell.sampleId.trim() === config.sampleId.trim() &&
      cell.normalizationGroupId.trim() !== config.normalizationGroupId.trim() &&
      (!config.overwrite || !targetSet.has(cell.well))
  );
  if (identityConflicts.length > 0) {
    throw new Error(
      `The same compound and sample pair already exists in a different normalization group at ${identityConflicts
        .map((cell) => cell.well)
        .join(", ")}.`
    );
  }

  let next = applySerialDilution(plateMap, {
    compoundId: config.compoundId,
    sampleId: config.sampleId,
    startConcentration: config.startConcentration,
    dilutionFactor: config.dilutionFactor,
    direction: config.direction,
    steps: config.doseCount,
    unit: config.unit,
    replicateRows: rows,
    replicateCols: [],
    startRow: start.row,
    startCol: start.col,
    normalizationGroupId: config.normalizationGroupId,
    biologicalReplicatePrefix: "Bio"
  });

  next = next.map((cell) =>
    targetSet.has(cell.well) ? { ...cell, usesVehicleControl: config.usesVehicleControl } : cell
  );
  return { plateMap: next, changedWells };
}
