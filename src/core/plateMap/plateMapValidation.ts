import type { PlateMapCell } from "./plateMapTypes";

export type PlateMapValidation = {
  valid: boolean;
  warnings: string[];
  blockers: string[];
};

export function validatePlateMap(plateMap: PlateMapCell[]): PlateMapValidation {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const growthControls = plateMap.filter((cell) => cell.role === "growth_control_high_signal");
  const blanks = plateMap.filter((cell) => cell.role === "blank_low_signal");
  const samples = plateMap.filter((cell) => cell.role === "sample");

  if (growthControls.length < 2) {
    blockers.push("Assign at least 2 growth/high-signal controls.");
  } else if (growthControls.length < 3) {
    warnings.push("Three or more growth/high-signal controls are preferred.");
  }

  if (blanks.length < 2) {
    blockers.push("Assign at least 2 blank/no-growth controls.");
  } else if (blanks.length < 3) {
    warnings.push("Three or more blank/no-growth controls are preferred.");
  }

  if (samples.length === 0) {
    blockers.push("Assign at least one sample well.");
  }

  const missingSampleFields = samples.filter(
    (cell) => !cell.compoundId.trim() || !cell.sampleId.trim() || !Number.isFinite(cell.concentration) || !cell.unit.trim()
  );
  if (missingSampleFields.length > 0) {
    blockers.push("Every sample well needs compound, sample, concentration, and unit.");
  }

  const units = new Set(samples.map((cell) => cell.unit.trim()).filter(Boolean));
  if (units.size > 1) {
    warnings.push("Multiple concentration units are present; MIC is grouped by unit.");
  }

  return {
    valid: blockers.length === 0,
    warnings,
    blockers
  };
}
