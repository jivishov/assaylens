import type { PlateMapCell } from "./plateMapTypes";

export type DilutionDirection = "right" | "left" | "down" | "up";

export type SerialDilutionConfig = {
  compoundId: string;
  sampleId: string;
  startConcentration: number;
  dilutionFactor: number;
  direction: DilutionDirection;
  steps: number;
  unit: string;
  replicateRows: number[];
  replicateCols: number[];
  startRow: number;
  startCol: number;
  normalizationGroupId?: string;
  biologicalReplicatePrefix?: string;
};

export function applySerialDilution(plateMap: PlateMapCell[], config: SerialDilutionConfig): PlateMapCell[] {
  if (!Number.isFinite(config.startConcentration) || config.startConcentration <= 0) {
    throw new Error("Start concentration must be greater than zero.");
  }
  if (!Number.isFinite(config.dilutionFactor) || config.dilutionFactor <= 1) {
    throw new Error("Dilution factor must be greater than 1.");
  }
  if (config.steps < 1) {
    throw new Error("At least one dilution step is required.");
  }
  if (!config.unit.trim()) {
    throw new Error("A concentration unit is required.");
  }

  const next = plateMap.map((cell) => ({ ...cell }));
  for (let step = 0; step < config.steps; step += 1) {
    const concentration = config.startConcentration / config.dilutionFactor ** step;
    const base = stepPosition(config.startRow, config.startCol, config.direction, step);
    const rows = config.replicateRows.length > 0 ? config.replicateRows : [base.row];
    const cols = config.replicateCols.length > 0 ? config.replicateCols : [base.col];

    for (const row of rows) {
      for (const col of cols) {
        const target = config.direction === "left" || config.direction === "right" ? { row, col: base.col } : { row: base.row, col };
        const index = next.findIndex((cell) => cell.row === target.row && cell.col === target.col);
        if (index < 0) {
          throw new Error("Serial dilution extends outside the 8 x 12 plate.");
        }
        next[index] = {
          ...next[index],
          role: "sample",
          compoundId: config.compoundId,
          sampleId: config.sampleId || `Sample ${target.row + 1}`,
          concentration,
          unit: config.unit,
          normalizationGroupId: config.normalizationGroupId?.trim() || config.sampleId.trim(),
          biologicalReplicateId: `${config.biologicalReplicatePrefix?.trim() || "Bio"}-${target.row + 1}`,
          technicalReplicateId: wellId(target.row, target.col),
          usesVehicleControl: false
        };
      }
    }
  }
  return next;
}

function wellId(row: number, col: number): string {
  return `${String.fromCharCode(65 + row)}${col + 1}`;
}

function stepPosition(row: number, col: number, direction: DilutionDirection, step: number): { row: number; col: number } {
  switch (direction) {
    case "right":
      return { row, col: col + step };
    case "left":
      return { row, col: col - step };
    case "down":
      return { row: row + step, col };
    case "up":
      return { row: row - step, col };
  }
}
