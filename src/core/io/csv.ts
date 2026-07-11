import type { MicResult, SpotAnalysis, SpotDilutionSummary, WellAnalysis, WellFeature } from "../types";
import { isWellRole, roleAcceptsAssignmentMetadata, roleAcceptsConcentration, roleAcceptsNormalizationGroup, type PlateMapCell } from "../plateMap/plateMapTypes";
import type { RoiFeature } from "../roi/roiTypes";
import type { SpotMapCell } from "../assays/agarSpot/spotMapTypes";

export function plateMapToCsv(plateMap: PlateMapCell[]): string {
  return rowsToCsv([
    ["well", "row", "col", "role", "compound_id", "sample_id", "concentration", "unit", "normalization_group_id", "biological_replicate_id", "technical_replicate_id", "uses_vehicle_control", "notes"],
    ...plateMap.map((cell) => [
      cell.well,
      String(cell.row + 1),
      String(cell.col + 1),
      cell.role,
      cell.compoundId,
      cell.sampleId,
      cell.concentration == null ? "" : String(cell.concentration),
      cell.unit,
      cell.normalizationGroupId,
      cell.biologicalReplicateId,
      cell.technicalReplicateId,
      String(Boolean(cell.usesVehicleControl)),
      cell.notes ?? ""
    ])
  ]);
}

export function parsePlateMapCsv(csv: string, fallback: PlateMapCell[]): PlateMapCell[] {
  const rows = parseCsv(csv);
  if (rows.length < 2) {
    throw new Error("CSV does not contain plate-map rows.");
  }
  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  const getIndex = (name: string) => header.indexOf(name);
  for (const requiredHeader of ["well", "role", "compound_id", "sample_id", "concentration", "unit"]) {
    if (getIndex(requiredHeader) < 0) {
      throw new Error(`Plate-map CSV is missing required "${requiredHeader}" column.`);
    }
  }
  const wellIndex = getIndex("well");
  const next = fallback.map((cell) => ({ ...cell }));
  const validWells = new Set(next.map((cell) => cell.well));
  const importedWells = new Set<string>();

  for (const row of rows.slice(1)) {
    const well = row[wellIndex]?.trim();
    if (!well) {
      throw new Error("Plate-map CSV contains a row without a well ID.");
    }
    if (!validWells.has(well)) {
      throw new Error(`Invalid well ID "${well}" in plate-map CSV.`);
    }
    if (importedWells.has(well)) {
      throw new Error(`Duplicate plate-map assignment for ${well}.`);
    }
    importedWells.add(well);
    const index = next.findIndex((cell) => cell.well === well);
    const role = row[getIndex("role")]?.trim();
    if (role && !isWellRole(role)) {
      throw new Error(`Invalid role "${role}" for ${well}.`);
    }
    const nextRole = role && isWellRole(role) ? role : next[index].role;
    const concentrationRaw = row[getIndex("concentration")]?.trim();
    const acceptsMetadata = roleAcceptsAssignmentMetadata(nextRole);
    const acceptsGroup = roleAcceptsNormalizationGroup(nextRole);
    const acceptsConcentration = roleAcceptsConcentration(nextRole);
    const concentration = concentrationRaw && acceptsConcentration ? Number(concentrationRaw) : undefined;
    if (concentrationRaw && acceptsConcentration && !Number.isFinite(concentration)) {
      throw new Error(`Concentration must be numeric for ${well}.`);
    }
    next[index] = {
      ...next[index],
      role: nextRole,
      compoundId: acceptsMetadata ? row[getIndex("compound_id")]?.trim() ?? next[index].compoundId : "",
      sampleId: acceptsMetadata ? row[getIndex("sample_id")]?.trim() ?? next[index].sampleId : "",
      concentration,
      unit: acceptsMetadata ? row[getIndex("unit")]?.trim() ?? next[index].unit : "",
      normalizationGroupId: acceptsGroup ? row[getIndex("normalization_group_id")]?.trim() ?? next[index].normalizationGroupId : "",
      biologicalReplicateId: nextRole === "sample" ? row[getIndex("biological_replicate_id")]?.trim() ?? next[index].biologicalReplicateId : "",
      technicalReplicateId: nextRole === "sample" ? row[getIndex("technical_replicate_id")]?.trim() ?? next[index].technicalReplicateId : "",
      usesVehicleControl: nextRole === "sample" ? /^true|1|yes$/i.test(row[getIndex("uses_vehicle_control")]?.trim() ?? "") : false,
      notes: row[getIndex("notes")]?.trim() ?? next[index].notes
    };
  }

  return next;
}

export function featuresToCsv(features: WellFeature[]): string {
  return rowsToCsv([
    [
      "well",
      "mean_r",
      "mean_g",
      "mean_b",
      "median_r",
      "median_g",
      "median_b",
      "orange_chromaticity",
      "yellow_orange_lab",
      "log_blue_intensity_contrast",
      "log_green_plus_blue_intensity_contrast",
      "selected_signal",
      "valid_pixel_fraction",
      "highlight_fraction",
      "dark_artifact_fraction",
      "clipped_fraction",
      "partially_outside_image",
      "candidate_pixels",
      "valid_pixels",
      "clipped_pixels",
      "out_of_image_pixels"
    ],
    ...features.map((feature) => [
      feature.well,
      numberCell(feature.meanR),
      numberCell(feature.meanG),
      numberCell(feature.meanB),
      numberCell(feature.medianR),
      numberCell(feature.medianG),
      numberCell(feature.medianB),
      numberCell(feature.orangeChromaticity),
      numberCell(feature.yellowOrangeLab),
      numberCell(feature.pseudoODBlue),
      numberCell(feature.pseudoODGreenBlue),
      feature.selectedSignal == null ? "" : numberCell(feature.selectedSignal),
      numberCell(feature.qc.validPixelFraction),
      numberCell(feature.qc.highlightFraction),
      numberCell(feature.qc.darkArtifactFraction),
      numberCell(feature.qc.clippedFraction),
      String(feature.qc.partiallyOutsideImage),
      String(feature.qc.candidatePixelCount ?? ""),
      String(feature.qc.validPixelCount ?? ""),
      String(feature.qc.clippedPixelCount ?? ""),
      String(feature.qc.outOfImagePixelCount ?? "")
    ])
  ]);
}

export function wellAnalysisToCsv(wells: WellAnalysis[]): string {
  return rowsToCsv([
    ["well", "role", "compound_id", "sample_id", "concentration", "unit", "normalization_group_id", "biological_replicate_id", "technical_replicate_id", "signal", "relative_metabolic_activity_raw", "inhibition_raw", "display_rma_clamped", "qc_flags"],
    ...wells.map((well) => [
      well.well,
      well.map.role,
      well.map.compoundId,
      well.map.sampleId,
      well.map.concentration == null ? "" : String(well.map.concentration),
      well.map.unit,
      well.map.normalizationGroupId,
      well.map.biologicalReplicateId,
      well.map.technicalReplicateId,
      numberCell(well.signal),
      numberCell(well.relativeMetabolicActivityRaw ?? well.viability),
      numberCell(well.inhibitionRaw ?? well.inhibition),
      numberCell(well.displayRma ?? Math.max(0, Math.min(1, well.viability))),
      well.qcFlags.join(";")
    ])
  ]);
}

export function micResultsToCsv(results: MicResult[]): string {
  return rowsToCsv([
    ["compound_id", "sample_id", "unit", "threshold", "observed_image_endpoint", "model_assisted_endpoint", "status", "boundary", "biological_points_json", "model_adjusted_indices", "warnings"],
    ...results.map((result) => [
      result.compoundId,
      result.sampleId,
      result.unit,
      String(result.threshold),
      result.observedMicLabel,
      result.isotonicMicLabel,
      result.status,
      result.endpointBoundary == null ? "" : String(result.endpointBoundary),
      JSON.stringify(result.concentrations.map((point) => ({ concentration: point.concentration, rawRma: point.medianViability, biologicalCount: point.biologicalCount, technicalCount: point.technicalCount, biologicalIqr: point.biologicalIqr, biologicalValues: point.biologicalValues, exclusions: point.excludedWellIds, fittedRma: point.isotonicViability }))),
      result.concentrations.map((point, index) => point.isotonicAdjusted ? index : -1).filter((index) => index >= 0).join(";"),
      result.warnings.join(";")
    ])
  ]);
}

export function roiFeaturesToCsv(features: RoiFeature[]): string {
  return rowsToCsv([
    [
      "roi_id",
      "label",
      "row",
      "col",
      "mean_r",
      "mean_g",
      "mean_b",
      "median_r",
      "median_g",
      "median_b",
      "luminance_mean",
      "gray_density",
      "background_corrected_density",
      "selected_signal",
      "valid_pixel_fraction",
      "highlight_fraction",
      "dark_artifact_fraction",
      "clipped_fraction",
      "partially_outside_image"
    ],
    ...features.map((feature) => [
      feature.roiId,
      feature.label,
      String(feature.row + 1),
      String(feature.col + 1),
      numberCell(feature.meanR),
      numberCell(feature.meanG),
      numberCell(feature.meanB),
      numberCell(feature.medianR),
      numberCell(feature.medianG),
      numberCell(feature.medianB),
      numberCell(feature.luminanceMean),
      numberCell(feature.grayDensity),
      numberCell(feature.backgroundCorrectedDensity),
      feature.selectedSignal == null ? "" : numberCell(feature.selectedSignal),
      numberCell(feature.qc.validPixelFraction),
      numberCell(feature.qc.highlightFraction),
      numberCell(feature.qc.darkArtifactFraction),
      numberCell(feature.qc.clippedFraction),
      String(feature.qc.partiallyOutsideImage)
    ])
  ]);
}

export function spotMapToCsv(spotMap: SpotMapCell[]): string {
  return rowsToCsv([
    [
      "roi_id",
      "row",
      "col",
      "role",
      "group_id",
      "condition_id",
      "normalization_group_id",
      "biological_replicate_id",
      "technical_replicate_id",
      "relative_inoculum",
      "biological_replicate",
      "technical_replicate",
      "dilution_index",
      "notes"
    ],
    ...spotMap.map((cell) => [
      cell.id,
      String(cell.row + 1),
      String(cell.col + 1),
      cell.role,
      cell.groupId,
      cell.conditionId ?? "",
      cell.normalizationGroupId ?? "",
      cell.biologicalReplicateId ?? "",
      cell.technicalReplicateId ?? "",
      cell.relativeInoculum == null ? "" : String(cell.relativeInoculum),
      cell.biologicalReplicate == null ? "" : String(cell.biologicalReplicate),
      cell.technicalReplicate == null ? "" : String(cell.technicalReplicate),
      cell.dilutionIndex == null ? "" : String(cell.dilutionIndex),
      cell.notes ?? ""
    ])
  ]);
}

export function spotAnalysisToCsv(spots: SpotAnalysis[]): string {
  return rowsToCsv([
    [
      "roi_id",
      "role",
      "group_id",
      "condition_id",
      "normalization_group_id",
      "biological_replicate_id",
      "technical_replicate_id",
      "relative_inoculum",
      "biological_replicate",
      "technical_replicate",
      "dilution_index",
      "gray_density",
      "background_corrected_density",
      "endpoint_spot_signal",
      "signed_integrated_contrast",
      "local_background",
      "local_noise",
      "area_fraction",
      "candidate_pixels",
      "valid_pixels",
      "out_of_image_pixels",
      "annulus_candidate_pixels",
      "annulus_valid_pixels",
      "valid",
      "qc_flags"
    ],
    ...spots.map((spot) => [
      spot.roiId,
      spot.map.role,
      spot.map.groupId,
      spot.map.conditionId ?? "",
      spot.map.normalizationGroupId ?? "",
      spot.map.biologicalReplicateId ?? "",
      spot.map.technicalReplicateId ?? "",
      spot.map.relativeInoculum == null ? "" : String(spot.map.relativeInoculum),
      spot.map.biologicalReplicate == null ? "" : String(spot.map.biologicalReplicate),
      spot.map.technicalReplicate == null ? "" : String(spot.map.technicalReplicate),
      spot.map.dilutionIndex == null ? "" : String(spot.map.dilutionIndex),
      numberCell(spot.feature.grayDensity),
      numberCell(spot.feature.backgroundCorrectedDensity),
      numberCell(spot.density),
      numberCell(spot.signedIntegratedContrast ?? Number.NaN),
      numberCell(spot.localBackground ?? Number.NaN),
      numberCell(spot.localNoise ?? Number.NaN),
      numberCell(spot.areaFraction ?? Number.NaN),
      String(spot.candidatePixelCount ?? ""),
      String(spot.validPixelCount ?? ""),
      String(spot.outOfImagePixelCount ?? ""),
      String(spot.annulusCandidatePixelCount ?? ""),
      String(spot.annulusValidPixelCount ?? ""),
      String(spot.valid),
      spot.qcFlags.join(";")
    ])
  ]);
}

export function spotDilutionSummariesToCsv(summaries: SpotDilutionSummary[]): string {
  return rowsToCsv([
    [
      "role",
      "group_id",
      "reference_control_group_id",
      "dilution_index",
      "relative_inoculum",
      "n",
      "median_endpoint_spot_signal",
      "sd_density",
      "cv",
      "control_mean_density",
      "relative_endpoint_spot_signal",
      "warnings"
    ],
    ...summaries.map((summary) => [
      summary.role,
      summary.groupId,
      summary.referenceControlGroupId,
      String(summary.dilutionIndex),
      summary.relativeInoculum == null ? "" : String(summary.relativeInoculum),
      String(summary.n),
      numberCell(summary.medianEndpointSpotSignal ?? summary.meanDensity),
      numberCell(summary.sdDensity),
      numberCell(summary.cv),
      numberCell(summary.controlMeanDensity),
      numberCell(summary.relativeEndpointSpotSignal ?? summary.relativeGrowth),
      summary.warnings.join(";")
    ])
  ]);
}

export function rowsToCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n");
}

export function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];

    if (char === "\"" && inQuotes && next === "\"") {
      cell += "\"";
      index += 1;
    } else if (char === "\"") {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((item) => item.some((cellValue) => cellValue.trim().length > 0));
}

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }
  return value;
}

function numberCell(value: number): string {
  return Number.isFinite(value) ? value.toPrecision(6) : "";
}
