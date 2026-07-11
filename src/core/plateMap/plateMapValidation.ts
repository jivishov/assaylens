import type { PlateMapCell } from "./plateMapTypes";
import { concentrationUnitsAreCompatible } from "../science/concentrationUnits";

export type PlateMapValidation = { valid: boolean; warnings: string[]; blockers: string[] };

export function validatePlateMap(plateMap: PlateMapCell[]): PlateMapValidation {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const samples = plateMap.filter((cell) => cell.role === "sample");
  const growth = plateMap.filter((cell) => cell.role === "growth_control");
  const blanks = plateMap.filter((cell) => cell.role === "reagent_blank");

  if (growth.length < 2) blockers.push("Assign at least 2 growth controls.");
  if (blanks.length < 2) blockers.push("Assign at least 2 reagent blanks.");
  if (samples.length === 0) blockers.push("Assign at least one sample well.");
  if (plateMap.some((cell) => cell.role === "legacy_unresolved_blank")) {
    blockers.push("Classify every legacy unresolved blank as a modern control role.");
  }

  for (const cell of samples) {
    if (!cell.compoundId.trim() || !cell.sampleId.trim()) blockers.push(`${cell.well} needs compound and sample IDs.`);
    if (!Number.isFinite(cell.concentration) || (cell.concentration ?? 0) <= 0) blockers.push(`${cell.well} needs a positive finite concentration.`);
    if (!cell.unit.trim()) blockers.push(`${cell.well} needs a concentration unit.`);
    if (!cell.normalizationGroupId.trim()) blockers.push(`${cell.well} needs a normalization group.`);
    if (!cell.biologicalReplicateId.trim() || !cell.technicalReplicateId.trim()) blockers.push(`${cell.well} needs biological and technical replicate IDs.`);
  }

  const activeControls = plateMap.filter((cell) => ["growth_control", "vehicle_control", "reagent_blank", "sterility_control", "positive_inhibition_control"].includes(cell.role));
  if (activeControls.some((cell) => !cell.normalizationGroupId.trim())) blockers.push("Every active XTT control needs a normalization group.");

  const tuples = new Set<string>();
  for (const cell of samples) {
    const tuple = [cell.compoundId, cell.sampleId, cell.normalizationGroupId, cell.biologicalReplicateId, cell.technicalReplicateId, cell.concentration, cell.unit].join("||");
    if (tuples.has(tuple)) blockers.push(`Duplicate sample replicate metadata at ${cell.well}.`);
    tuples.add(tuple);
  }

  for (const group of new Set(samples.map((cell) => cell.normalizationGroupId.trim()).filter(Boolean))) {
    const groupGrowth = growth.filter((cell) => cell.normalizationGroupId.trim() === group);
    const groupBlanks = blanks.filter((cell) => cell.normalizationGroupId.trim() === group);
    if (groupGrowth.length < 2) blockers.push(`Normalization group ${group} needs at least 2 growth controls.`);
    if (groupBlanks.length < 2) blockers.push(`Normalization group ${group} needs at least 2 reagent blanks.`);
    if (samples.some((cell) => cell.normalizationGroupId.trim() === group && cell.usesVehicleControl)) {
      const vehicles = plateMap.filter((cell) => cell.role === "vehicle_control" && cell.normalizationGroupId.trim() === group);
      if (vehicles.length < 2) blockers.push(`Normalization group ${group} declares vehicle exposure and needs at least 2 vehicle controls.`);
    }
  }

  const series = new Map<string, PlateMapCell[]>();
  for (const sample of samples) {
    const key = `${sample.compoundId.trim()}||${sample.sampleId.trim()}`;
    series.set(key, [...(series.get(key) ?? []), sample]);
  }
  for (const [key, cells] of series) {
    const units = cells.map((cell) => cell.unit);
    if (!concentrationUnitsAreCompatible(units)) {
      blockers.push(`Sample series ${key.replace("||", " / ")} contains an unsupported or incompatible concentration unit.`);
    } else if (new Set(units.map((unit) => unit.trim().toLowerCase())).size > 1) {
      warnings.push(`Multiple concentration units are present in sample series ${key.replace("||", " / ")}; they are compatible and will be canonicalized to ug/mL.`);
    }
  }
  return { valid: blockers.length === 0, warnings, blockers: [...new Set(blockers)] };
}
