import { parseWellName } from "../geometry/plateGrid";
import { createEmptyPlateMap, type PlateMapCell } from "./plateMapTypes";

export type AssignableControlRole =
  | "growth_control"
  | "reagent_blank"
  | "vehicle_control"
  | "sterility_control"
  | "positive_inhibition_control"
  | "unused";

export type ControlAssignment = {
  role: AssignableControlRole;
  wells: string[];
  normalizationGroupId?: string;
  vehicleLabel?: string;
  vehicleConcentration?: number;
  vehicleUnit?: string;
};

export type AssignControlsConfig = {
  assignments: ControlAssignment[];
  overwrite: boolean;
};

export type AssignControlsResult = { plateMap: PlateMapCell[]; changedWells: string[] };

export function assignControlsAtomic(plateMap: PlateMapCell[], input: AssignControlsConfig): AssignControlsResult {
  const seen = new Set<string>();
  const targets: Array<{ index: number; well: string; assignment: ControlAssignment }> = [];

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
    next[index] = {
      ...next[index],
      role: assignment.role,
      normalizationGroupId: assignment.normalizationGroupId!.trim(),
      compoundId: assignment.role === "vehicle_control" ? assignment.vehicleLabel?.trim() ?? "" : "",
      sampleId: "",
      concentration: assignment.role === "vehicle_control" ? assignment.vehicleConcentration : undefined,
      unit: assignment.role === "vehicle_control" ? assignment.vehicleUnit?.trim() ?? "" : "",
      biologicalReplicateId: "",
      technicalReplicateId: "",
      usesVehicleControl: false,
      notes: ""
    };
  }
  return { plateMap: next, changedWells: targets.map((target) => target.well) };
}
