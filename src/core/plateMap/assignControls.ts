import { parseWellName } from "../geometry/plateGrid";
import { createEmptyPlateMap, type PlateMapCell } from "./plateMapTypes";
import type { AssignControlsInput } from "../../webmcp/contracts";

export type AssignControlsResult = { plateMap: PlateMapCell[]; changedWells: string[] };

export function assignControlsAtomic(plateMap: PlateMapCell[], input: AssignControlsInput): AssignControlsResult {
  const seen = new Set<string>();
  const targets: Array<{ index: number; well: string; assignment: AssignControlsInput["assignments"][number] }> = [];

  for (const assignment of input.assignments) {
    if (assignment.role !== "unused" && !assignment.normalizationGroupId?.trim()) {
      throw new Error(`${assignment.role} requires a normalization group.`);
    }
    for (const rawWell of assignment.wells) {
      const parsed = parseWellName(rawWell);
      const well = `${String.fromCharCode(65 + parsed.row)}${parsed.col + 1}`;
      if (seen.has(well)) throw new Error(`Duplicate control target ${well}.`);
      seen.add(well);
      const index = plateMap.findIndex((cell) => cell.row === parsed.row && cell.col === parsed.col);
      if (index < 0) throw new Error(`Missing plate-map cell ${well}.`);
      if (!input.overwrite && assignment.role !== "unused" && plateMap[index].role !== "unused") {
        throw new Error(`Control target ${well} is already assigned.`);
      }
      targets.push({ index, well, assignment });
    }
  }

  const emptyByWell = new Map(createEmptyPlateMap().map((cell) => [cell.well, cell]));
  const next = plateMap.map((cell) => ({ ...cell }));
  for (const target of targets) {
    const { assignment, index, well } = target;
    if (assignment.role === "unused") {
      next[index] = { ...emptyByWell.get(well)! };
      continue;
    }
    const previous = next[index];
    next[index] = {
      ...previous,
      role: assignment.role,
      normalizationGroupId: assignment.normalizationGroupId!.trim(),
      compoundId: assignment.role === "vehicle_control" ? assignment.vehicleLabel?.trim() ?? "" : "",
      sampleId: "",
      concentration: assignment.role === "vehicle_control" ? assignment.vehicleConcentration : undefined,
      unit: assignment.role === "vehicle_control" ? assignment.vehicleUnit ?? "" : "",
      biologicalReplicateId: "",
      technicalReplicateId: "",
      usesVehicleControl: false,
      notes: ""
    };
  }
  return { plateMap: next, changedWells: targets.map((target) => target.well) };
}
