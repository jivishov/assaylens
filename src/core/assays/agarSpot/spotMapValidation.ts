import type { SpotMapCell } from "./spotMapTypes";

export type SpotMapValidation = {
  valid: boolean;
  warnings: string[];
  blockers: string[];
};

export function validateSpotMap(spotMap: SpotMapCell[]): SpotMapValidation {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const backgrounds = spotMap.filter((cell) => cell.role === "background");
  const controls = spotMap.filter((cell) => cell.role === "control");
  const experimental = spotMap.filter((cell) => cell.role === "experimental");
  const measured = [...controls, ...experimental];

  if (backgrounds.length < 3) {
    blockers.push("Assign at least 3 background ROIs.");
  }
  if (controls.length === 0) {
    blockers.push("Assign at least one control group with valid spots.");
  }
  if (experimental.length === 0) {
    blockers.push("Assign at least one experimental spot.");
  }

  const missingGroup = measured.filter((cell) => !cell.groupId.trim());
  if (missingGroup.length > 0) {
    blockers.push("Every experimental and control spot needs a group ID.");
  }

  const invalidDilution = measured.filter(
    (cell) => !Number.isInteger(cell.dilutionIndex) || (cell.dilutionIndex ?? -1) < 0
  );
  if (invalidDilution.length > 0) {
    blockers.push("Every experimental and control spot needs a non-negative dilution index.");
  }

  const controlGroups = new Set(controls.map((cell) => cell.groupId.trim()).filter(Boolean));
  if (controlGroups.size === 0 && controls.length > 0) {
    blockers.push("Control spots need at least one non-empty control group ID.");
  }

  const missingReplicate = measured.filter(
    (cell) => !Number.isInteger(cell.biologicalReplicate) || !Number.isInteger(cell.technicalReplicate)
  );
  if (missingReplicate.length > 0) {
    warnings.push("Biological and technical replicate numbers are recommended for all measured spots.");
  }

  return {
    valid: blockers.length === 0,
    warnings,
    blockers
  };
}
