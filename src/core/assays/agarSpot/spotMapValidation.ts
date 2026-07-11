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

  if (backgrounds.length > 0) warnings.push("Background ROIs are diagnostic only; each measured spot uses its own local annulus.");
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

  const missingModernMetadata = measured.filter((cell) =>
    !cell.conditionId?.trim() || !cell.normalizationGroupId?.trim() || !cell.biologicalReplicateId?.trim() || !cell.technicalReplicateId?.trim()
  );
  if (missingModernMetadata.length > 0) blockers.push("Every measured spot needs condition, normalization-group, biological-replicate, and technical-replicate IDs.");
  const invalidInoculum = measured.filter((cell) => !Number.isFinite(cell.relativeInoculum) || (cell.relativeInoculum ?? 0) <= 0 || (cell.relativeInoculum ?? 0) > 1);
  if (invalidInoculum.length > 0) blockers.push("Every measured spot needs an exact relative inoculum greater than 0 and at most 1.");

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

  const duplicateTuples = new Set<string>();
  for (const cell of measured) {
    const tuple = [cell.conditionId, cell.normalizationGroupId, cell.relativeInoculum, cell.biologicalReplicateId, cell.technicalReplicateId].join("||");
    if (duplicateTuples.has(tuple)) blockers.push(`Duplicate measured-spot replicate tuple: ${tuple}.`);
    duplicateTuples.add(tuple);
  }

  return {
    valid: blockers.length === 0,
    warnings,
    blockers
  };
}
