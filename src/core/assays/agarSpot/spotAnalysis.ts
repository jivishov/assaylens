import { groupBy, median } from "../../analysis/statistics";
import { sampleRoiFeatures } from "../../roi/roiSampler";
import type {
  AgarSpotAnalysisResult,
  AgarSpotAnalysisSettings,
  InputWarningCode,
  PlateAnchors,
  SpotAnalysis,
  SpotDilutionSummary,
  SpotGridSettings
} from "../../types";
import type { RoiFeature } from "../../roi/roiTypes";
import { generateSpotGrid, normalizedSpotGridSettings } from "./spotGrid";
import type { SpotMapCell } from "./spotMapTypes";
import { validateSpotMap } from "./spotMapValidation";
import { measureAgarRoi, type AgarDensitometry } from "./agarDensitometry";
import { currentResultScience, EXPLORATORY_AGAR_PROTOCOL } from "../../science/protocols";

type NormalizedAgarSpotAnalysisSettings = AgarSpotAnalysisSettings & {
  nearBackgroundDensity: number;
  highCvThreshold: number;
  saturationClippedFraction: number;
  overgrownDensity: number;
};

export function analyzeAgarSpotImage(params: {
  imageData: ImageData;
  anchors: PlateAnchors;
  spotMap: SpotMapCell[];
  gridSettings?: Partial<SpotGridSettings>;
  settings: AgarSpotAnalysisSettings;
  inputWarnings: InputWarningCode[];
}): AgarSpotAnalysisResult {
  const validation = validateSpotMap(params.spotMap);
  if (!validation.valid) {
    throw new Error(validation.blockers.join(" "));
  }
  const gridSettings = normalizedSpotGridSettings(params.gridSettings);
  const rois = generateSpotGrid(params.anchors, gridSettings);
  const rawFeatures = sampleRoiFeatures(params.imageData, rois);
  const measurementById = new Map(rois.map((roi) => [roi.id, measureAgarRoi(params.imageData, roi, EXPLORATORY_AGAR_PROTOCOL)]));
  const mapById = new Map(params.spotMap.map((cell) => [cell.id, cell]));
  const backgroundFeatures = rawFeatures.filter((feature) => {
    const cell = mapById.get(feature.roiId);
    return cell?.role === "background" && featureToQcFlags(feature).length === 0;
  });

  const medianBackgroundDensity = median([...measurementById.values()].map((item) => item.localBackground).filter(Number.isFinite));
  const features = rawFeatures.map((feature) => ({
    ...feature,
    backgroundCorrectedDensity: measurementById.get(feature.roiId)?.signedIntegratedContrast ?? Number.NaN,
    selectedSignal: measurementById.get(feature.roiId)?.signedIntegratedContrast ?? Number.NaN
  }));
  const spots = features
    .map((feature) => spotAnalysisFromFeature(feature, mapById.get(feature.roiId), measurementById.get(feature.roiId)))
    .filter((spot): spot is SpotAnalysis => Boolean(spot));
  const validControls = spots.filter((spot) => spot.map.role === "control" && spot.valid);
  const validExperimental = spots.filter((spot) => spot.map.role === "experimental" && spot.valid);
  const controlGroupIds = [...new Set(validControls.map((spot) => spot.map.groupId.trim()).filter(Boolean))];

  if (validControls.length === 0 || controlGroupIds.length === 0) {
    const failures = spots.filter((spot) => spot.map.role === "control").map((spot) => `${spot.roiId}:${spot.qcFlags.join("|")}`).join(", ");
    throw new Error(`Agar endpoint analysis requires at least 1 control group with valid spots. ${failures}`);
  }
  if (validExperimental.length === 0) {
    throw new Error("Agar endpoint analysis requires at least 1 valid experimental spot.");
  }

  const settings = normalizeAgarSettings(params.settings);
  const reference = selectReferenceControlGroup(controlGroupIds, settings.referenceControlGroupId);
  if (!reference.controlGroupId) {
    throw new Error("Agar endpoint analysis requires a valid reference control group.");
  }
  const summaries = summarizeSpots(spots, settings, reference.controlGroupId);
  const qcWarnings = spotQcWarnings(spots, summaries);
  qcWarnings.push(...reference.warnings);

  const science = currentResultScience(EXPLORATORY_AGAR_PROTOCOL, [...params.inputWarnings, ...qcWarnings]);
  return {
    kind: "agar_spot_growth",
    features,
    spots,
    summaries,
    settings,
    generatedAt: new Date().toISOString(),
    inputWarnings: params.inputWarnings,
    qc: {
      medianBackgroundDensity,
      validBackgroundCount: backgroundFeatures.length,
      controlGroupIds,
      referenceControlGroupId: reference.controlGroupId,
      warnings: qcWarnings
    },
    protocolId: EXPLORATORY_AGAR_PROTOCOL.id,
    provenance: science.provenance,
    qcDecision: science.qcDecision
  };
}

export function normalizeAgarSettings(settings: AgarSpotAnalysisSettings = {}): NormalizedAgarSpotAnalysisSettings {
  return {
    referenceControlGroupId: settings.referenceControlGroupId?.trim() || undefined,
    nearBackgroundDensity: settings.nearBackgroundDensity ?? 8,
    highCvThreshold: settings.highCvThreshold ?? 0.35,
    saturationClippedFraction: settings.saturationClippedFraction ?? 0.05,
    overgrownDensity: settings.overgrownDensity ?? 210
  };
}

function spotAnalysisFromFeature(feature: RoiFeature, map: SpotMapCell | undefined, measurement: AgarDensitometry | undefined): SpotAnalysis | undefined {
  if (!map || map.role === "unused") {
    return undefined;
  }
  const qcFlags = [
    ...(feature.qc.partiallyOutsideImage ? ["partially_outside_image"] : []),
    ...(measurement?.qcFlags ?? [])
  ];
  return {
    roiId: feature.roiId,
    label: feature.label,
    row: feature.row,
    col: feature.col,
    role: map.role,
    density: measurement?.signedIntegratedContrast ?? Number.NaN,
    endpointSpotSignal: measurement?.signedIntegratedContrast,
    candidatePixelCount: measurement?.candidatePixelCount,
    validPixelCount: measurement?.validPixelCount,
    outOfImagePixelCount: measurement?.outOfImagePixelCount,
    annulusCandidatePixelCount: measurement?.annulusCandidatePixelCount,
    annulusValidPixelCount: measurement?.annulusValidPixelCount,
    localBackground: measurement?.localBackground,
    localNoise: measurement?.localNoise,
    areaPixels: measurement?.areaPixels,
    areaFraction: measurement?.areaFraction,
    meanSignedContrast: measurement?.meanSignedContrast,
    medianSignedContrast: measurement?.medianSignedContrast,
    signedIntegratedContrast: measurement?.signedIntegratedContrast,
    positiveIntegratedContrast: measurement?.positiveIntegratedContrast,
    saturationFraction: measurement?.saturationFraction,
    boundaryContact: measurement?.boundaryContact,
    segmentationConfidence: measurement?.segmentationConfidence,
    maskProvenance: measurement?.maskProvenance,
    feature,
    map,
    valid: Number.isFinite(measurement?.signedIntegratedContrast) && qcFlags.length === 0,
    qcFlags
  };
}

function summarizeSpots(
  spots: SpotAnalysis[],
  settings: NormalizedAgarSpotAnalysisSettings,
  referenceControlGroupId: string
): SpotDilutionSummary[] {
  const measured = spots.filter((spot) => (spot.map.role === "experimental" || spot.map.role === "control") && spot.valid);
  const summaries: SpotDilutionSummary[] = [];
  const grouped = groupBy(measured, (spot) => `${spot.map.role}::${spot.map.groupId}::${spot.map.conditionId}::${spot.map.normalizationGroupId}::${spot.map.relativeInoculum}`);

  for (const [key, group] of grouped.entries()) {
    const [role, groupId, conditionId, normalizationGroupId, inoculumText] = key.split("::");
    const relativeInoculum = Number(inoculumText);
    const byBio = groupBy(group, (spot) => spot.map.biologicalReplicateId ?? "");
    const biologicalSignals = [...byBio.values()].map((technical) => median(technical.map((spot) => spot.density).filter(Number.isFinite))).filter(Number.isFinite);
    const pairedRatios: number[] = [];
    if (role === "experimental") for (const [bioId, technical] of byBio) {
      const experimentalSignal = median(technical.map((spot) => spot.density).filter(Number.isFinite));
      const controls = measured.filter((spot) => spot.map.role === "control" && spot.map.groupId.trim() === referenceControlGroupId && spot.map.normalizationGroupId === normalizationGroupId && spot.map.biologicalReplicateId === bioId && spot.map.relativeInoculum === relativeInoculum);
      const controlSignal = median(controls.map((spot) => spot.density).filter(Number.isFinite));
      if (Number.isFinite(experimentalSignal) && Number.isFinite(controlSignal) && controlSignal !== 0) pairedRatios.push(experimentalSignal / controlSignal);
    }
    const meanDensity = median(biologicalSignals), sdDensity = standardDeviation(biologicalSignals);
    const cv = meanDensity !== 0 ? sdDensity / Math.abs(meanDensity) : Number.NaN;
    const controlMean = role === "control" ? meanDensity : Number.NaN;
    const relativeGrowth = role === "control" ? 1 : median(pairedRatios);
    const warnings = summaryWarnings(group, meanDensity, cv, role === "control" ? meanDensity : pairedRatios.length ? 1 : Number.NaN, settings);
    const summaryValues = role === "experimental" ? pairedRatios : biologicalSignals;
    const sortedSummaryValues = [...summaryValues].sort((a, b) => a - b);

    summaries.push({
      role: role as "experimental" | "control",
      groupId,
      conditionId,
      referenceControlGroupId,
      dilutionIndex: group[0]?.map.dilutionIndex ?? 0,
      relativeInoculum,
      n: biologicalSignals.length,
      meanDensity,
      medianEndpointSpotSignal: meanDensity,
      sdDensity,
      cv,
      controlMeanDensity: controlMean,
      relativeGrowth,
      relativeEndpointSpotSignal: relativeGrowth,
      biologicalCount: role === "experimental" ? pairedRatios.length : biologicalSignals.length,
      technicalCount: group.length,
      biologicalIqr: sortedSummaryValues.length ? quantile(sortedSummaryValues, 0.75) - quantile(sortedSummaryValues, 0.25) : Number.NaN,
      biologicalValues: summaryValues,
      warnings
    });
  }

  return summaries.sort((a, b) => (b.relativeInoculum ?? 0) - (a.relativeInoculum ?? 0) || a.role.localeCompare(b.role) || a.groupId.localeCompare(b.groupId));
}

function summaryWarnings(
  group: SpotAnalysis[],
  meanDensity: number,
  cv: number,
  controlMean: number,
  settings: NormalizedAgarSpotAnalysisSettings
): string[] {
  const warnings: string[] = [];
  if (!Number.isFinite(controlMean) || controlMean <= 0) {
    warnings.push("missing_reference_control");
  }
  if (group.length < 2) {
    warnings.push("insufficient_replicates");
  }
  if (Number.isFinite(cv) && cv > settings.highCvThreshold) {
    warnings.push("high_cv");
  }
  if (Number.isFinite(meanDensity) && meanDensity < settings.nearBackgroundDensity) {
    warnings.push("near_background");
  }
  if (Number.isFinite(meanDensity) && meanDensity > settings.overgrownDensity) {
    warnings.push("overgrown");
  }
  if (group.some((spot) => (spot.saturationFraction ?? 0) > settings.saturationClippedFraction)) {
    warnings.push("saturated");
  }
  return warnings;
}

function selectReferenceControlGroup(
  controlGroupIds: string[],
  requestedControlGroupId?: string
): { controlGroupId?: string; warnings: string[] } {
  const sortedGroups = [...controlGroupIds].sort((a, b) => a.localeCompare(b));
  const warnings: string[] = [];
  const requested = requestedControlGroupId?.trim();
  if (requested) {
    if (!sortedGroups.includes(requested)) {
      warnings.push(`Requested reference control group "${requested}" has no valid control spots.`);
      return { warnings };
    }
    return { controlGroupId: requested, warnings };
  }
  if (sortedGroups.length > 1) return { warnings: ["Select an explicit reference control group; alphabetical fallback is prohibited."] };
  return { controlGroupId: sortedGroups[0], warnings };
}

function spotQcWarnings(spots: SpotAnalysis[], summaries: SpotDilutionSummary[]): string[] {
  const warnings = new Set<string>();
  if (spots.some((spot) => !spot.valid)) {
    warnings.add("One or more spot ROIs failed pixel QC.");
  }
  for (const summary of summaries) {
    for (const warning of summary.warnings) {
      warnings.add(warning);
    }
  }
  return [...warnings];
}

function featureToQcFlags(feature: RoiFeature): string[] {
  const flags: string[] = [];
  if (feature.qc.validPixelFraction < 0.65) {
    flags.push("low_valid_pixel_fraction");
  }
  if (feature.qc.highlightFraction > 0.08) {
    flags.push("highlight_glare");
  }
  if (feature.qc.darkArtifactFraction > 0.08) {
    flags.push("dark_artifact");
  }
  if (feature.qc.clippedFraction > 0.08) {
    flags.push("saturated");
  }
  if (feature.qc.partiallyOutsideImage) {
    flags.push("partially_outside_image");
  }
  return flags;
}

function mean(values: number[]): number {
  const finite = values.filter(Number.isFinite);
  return finite.length > 0 ? finite.reduce((sum, value) => sum + value, 0) / finite.length : Number.NaN;
}

function standardDeviation(values: number[]): number {
  const finite = values.filter(Number.isFinite);
  if (finite.length < 2) {
    return 0;
  }
  const center = mean(finite);
  const variance = finite.reduce((sum, value) => sum + (value - center) ** 2, 0) / (finite.length - 1);
  return Math.sqrt(variance);
}

function quantile(sorted: number[], probability: number): number {
  if (!sorted.length) return Number.NaN;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position), upper = Math.ceil(position);
  return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}
