import { cellKey } from "./plateMapTypes";
import type { DilutionDirection } from "./serialDilution";
import type { PlateMapCell, WellRole } from "./plateMapTypes";

export type SidebarSelectionValues = {
  role: WellRole;
  compoundId: string;
  sampleId: string;
  concentration: string;
  unit: string;
  normalizationGroupId: string;
  biologicalReplicateId: string;
  technicalReplicateId: string;
  usesVehicleControl: boolean;
};

export type SerialDilutionSidebarValues = {
  signature: string;
  compoundId: string;
  sampleId: string;
  startConcentration: number;
  dilutionFactor: number;
  steps: number;
  unit: string;
  normalizationGroupId: string;
  biologicalReplicatePrefix: string;
  direction: DilutionDirection;
};

export type PlateMapSidebarSync = {
  selectedKeys: string[];
  selection: SidebarSelectionValues;
  serial?: SerialDilutionSidebarValues;
};

/**
 * Identifies the plate-map mutation that should be reflected in the visible
 * editor panels. A revision is intentionally separate from the map contents:
 * reapplying the same WebMCP configuration must still replace an unsaved,
 * stale sidebar draft with the authoritative map values.
 */
export type PlateMapSidebarSyncTarget = {
  revision: number;
  preferredWells: readonly string[];
};

export type PlateMapSidebarSyncOptions = {
  preferredWells?: readonly string[];
};

export type PlateMapHorizontalSampleSeries = {
  cells: PlateMapCell[];
  startCell: PlateMapCell;
  values: SerialDilutionSidebarValues;
};

/**
 * Derives the visible editor controls from a plate-map mutation. This keeps
 * WebMCP-originated updates and the manual sidebar operating on the same
 * scientific state rather than leaving a stale, default-valued draft behind.
 */
export function derivePlateMapSidebarSync(
  plateMap: PlateMapCell[],
  options: PlateMapSidebarSyncOptions = {}
): PlateMapSidebarSync | undefined {
  const preferredCells = cellsForWells(plateMap, options.preferredWells);
  const preferredSampleCells = preferredCells.filter((cell) => cell.role === "sample");
  const preferredSeries = preferredSampleCells.length > 0 ? derivePlateMapHorizontalSampleSeries(plateMap, preferredSampleCells.map((cell) => cell.well)) : undefined;
  const series = preferredSeries ?? (preferredCells.length === 0 ? derivePlateMapHorizontalSampleSeries(plateMap) : undefined);
  if (series) {
    return {
      selectedKeys: series.cells.map((cell) => cellKey(cell.row, cell.col)),
      selection: selectionValues(series.startCell),
      serial: series.values
    };
  }

  const firstMapAssignment = plateMap.find((cell) => cell.role !== "unused");
  const selectedCells = preferredCells.length > 0 ? preferredCells : firstMapAssignment ? [firstMapAssignment] : [];
  const firstAssigned = selectedCells[0];
  if (!firstAssigned) {
    return undefined;
  }
  const serial = preferredCells.length > 0 ? derivePlateMapHorizontalSampleSeries(plateMap)?.values : undefined;
  return {
    selectedKeys: selectedCells.map((cell) => cellKey(cell.row, cell.col)),
    selection: selectionValues(firstAssigned),
    ...(serial ? { serial } : {})
  };
}

function cellsForWells(plateMap: PlateMapCell[], wells: readonly string[] | undefined): PlateMapCell[] {
  if (!wells?.length) {
    return [];
  }
  const byWell = new Map(plateMap.map((cell) => [cell.well, cell]));
  const seen = new Set<string>();
  return wells.flatMap((rawWell) => {
    const well = rawWell.trim().toUpperCase();
    if (!well || seen.has(well)) {
      return [];
    }
    seen.add(well);
    const cell = byWell.get(well);
    return cell ? [cell] : [];
  });
}

/**
 * Finds one complete horizontal sample series. Supplying one or more wells
 * anchors the lookup to that series, which lets a single selected dose retain
 * the correct high-dose source and replicate geometry.
 */
export function derivePlateMapHorizontalSampleSeries(
  plateMap: PlateMapCell[],
  preferredWells?: readonly string[]
): PlateMapHorizontalSampleSeries | undefined {
  const samples = plateMap.filter((cell) => cell.role === "sample");
  if (!samples.length) {
    return undefined;
  }

  const groups = new Map<string, PlateMapCell[]>();
  for (const cell of samples) {
    const key = sampleSeriesKey(cell);
    groups.set(key, [...(groups.get(key) ?? []), cell]);
  }

  const preferredSamples = cellsForWells(plateMap, preferredWells).filter((cell) => cell.role === "sample");
  let sourceCells: PlateMapCell[] | undefined;
  if (preferredSamples.length > 0) {
    const preferredKey = sampleSeriesKey(preferredSamples[0]);
    if (preferredSamples.some((cell) => sampleSeriesKey(cell) !== preferredKey)) {
      return undefined;
    }
    sourceCells = groups.get(preferredKey);
  } else if (groups.size === 1) {
    sourceCells = [...groups.values()][0];
  } else {
    return undefined;
  }
  if (!sourceCells) {
    return undefined;
  }

  const cells = sourceCells.slice().sort((a, b) => a.row - b.row || a.col - b.col);
  const rows = [...new Set(cells.map((cell) => cell.row))].sort((a, b) => a - b);
  const cols = [...new Set(cells.map((cell) => cell.col))].sort((a, b) => a - b);
  if (cols.length < 2 || cells.length !== rows.length * cols.length || !isContiguous(cols)) {
    return undefined;
  }

  const byCoordinate = new Map(cells.map((cell) => [cellKey(cell.row, cell.col), cell]));
  const firstRow = rows[0];
  const concentrations = cols.map((col) => byCoordinate.get(cellKey(firstRow, col))?.concentration);
  if (concentrations.some((value) => !Number.isFinite(value))) {
    return undefined;
  }
  const values = concentrations as number[];
  for (const row of rows) {
    for (let index = 0; index < cols.length; index += 1) {
      const cell = byCoordinate.get(cellKey(row, cols[index]));
      if (!cell || cell.concentration !== values[index]) {
        return undefined;
      }
    }
  }

  let direction: Extract<DilutionDirection, "right" | "left">;
  if (values[0] > values[1]) {
    direction = "right";
  } else if (values[0] < values[1]) {
    direction = "left";
  } else {
    return undefined;
  }
  const startIndex = direction === "right" ? 0 : values.length - 1;
  const nextIndex = direction === "right" ? 1 : values.length - 2;
  const startConcentration = values[startIndex];
  const dilutionFactor = startConcentration / values[nextIndex];
  if (!Number.isFinite(dilutionFactor) || dilutionFactor <= 1 || !hasConstantDilution(values, direction, dilutionFactor)) {
    return undefined;
  }

  const startCol = cols[startIndex];
  const startCell = byCoordinate.get(cellKey(firstRow, startCol));
  if (!startCell) {
    return undefined;
  }

  return {
    cells,
    startCell,
    values: {
      signature: cells.map((cell) => [cell.well, cell.compoundId, cell.sampleId, cell.concentration, cell.unit, cell.normalizationGroupId].join(":")).join("|"),
      compoundId: startCell.compoundId,
      sampleId: startCell.sampleId,
      startConcentration,
      dilutionFactor,
      steps: values.length,
      unit: startCell.unit,
      normalizationGroupId: startCell.normalizationGroupId,
      biologicalReplicatePrefix: replicatePrefix(startCell.biologicalReplicateId),
      direction
    }
  };
}

function sampleSeriesKey(cell: PlateMapCell): string {
  return [cell.compoundId, cell.sampleId, cell.unit, cell.normalizationGroupId].join("\u0000");
}

function selectionValues(cell: PlateMapCell): SidebarSelectionValues {
  return {
    role: cell.role,
    compoundId: cell.compoundId,
    sampleId: cell.sampleId,
    concentration: Number.isFinite(cell.concentration) ? String(cell.concentration) : "",
    unit: cell.unit,
    normalizationGroupId: cell.normalizationGroupId,
    biologicalReplicateId: cell.biologicalReplicateId,
    technicalReplicateId: cell.technicalReplicateId,
    usesVehicleControl: Boolean(cell.usesVehicleControl)
  };
}

function isContiguous(values: number[]): boolean {
  return values.every((value, index) => index === 0 || value === values[index - 1] + 1);
}

function hasConstantDilution(values: number[], direction: "right" | "left", factor: number): boolean {
  const ordered = direction === "right" ? values : [...values].reverse();
  return ordered.every((value, index) => index === 0 || approximatelyEqual(ordered[index - 1] / value, factor));
}

function approximatelyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= Math.max(Math.abs(left), Math.abs(right), 1) * 1e-9;
}

function replicatePrefix(value: string): string {
  const prefix = value.replace(/-\d+$/, "").trim();
  return prefix || "Bio";
}
