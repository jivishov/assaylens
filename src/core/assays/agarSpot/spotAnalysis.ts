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
  const mapById = new Map(params.spotMap.map((cell) => [cell.id, cell]));
  const backgroundFeatures = rawFeatures.filter((feature) => {
    const cell = mapById.get(feature.roiId);
    return cell?.role === "background" && featureToQcFlags(feature).length === 0;
  });

  if (backgroundFeatures.length < 3) {
    throw new Error("STAR-inspired spot analysis requires at least 3 valid background measurements.");
  }

  const medianBackgroundDensity = median(backgroundFeatures.map((feature) => feature.grayDensity).filter(Number.isFinite));
  const features = rawFeatures.map((feature) => ({
    ...feature,
    backgroundCorrectedDensity: Math.max(feature.grayDensity - medianBackgroundDensity, 0),
    selectedSignal: Math.max(feature.grayDensity - medianBackgroundDensity, 0)
  }));
  const spots = features
    .map((feature) => spotAnalysisFromFeature(feature, mapById.get(feature.roiId)))
    .filter((spot): spot is SpotAnalysis => Boolean(spot));
  const validControls = spots.filter((spot) => spot.map.role === "control" && spot.valid);
  const validExperimental = spots.filter((spot) => spot.map.role === "experimental" && spot.valid);
  const controlGroupIds = [...new Set(validControls.map((spot) => spot.map.groupId.trim()).filter(Boolean))];

  if (validControls.length === 0 || controlGroupIds.length === 0) {
    throw new Error("STAR-inspired spot analysis requires at least 1 control group with valid spots.");
  }
  if (validExperimental.length === 0) {
    throw new Error("STAR-inspired spot analysis requires at least 1 valid experimental spot.");
  }

  const settings = normalizeAgarSettings(params.settings);
  const reference = selectReferenceControlGroup(controlGroupIds, settings.referenceControlGroupId);
  if (!reference.controlGroupId) {
    throw new Error("STAR-inspired spot analysis requires a valid reference control group.");
  }
  const summaries = summarizeSpots(spots, settings, reference.controlGroupId);
  const suggestedDilutionIndex = suggestBestDilution(summaries);
  const selectedDilutionIndex =
    Number.isInteger(settings.dilutionOverride) && (settings.dilutionOverride ?? -1) >= 0
      ? settings.dilutionOverride
      : suggestedDilutionIndex;

  const qcWarnings = spotQcWarnings(spots, summaries);
  qcWarnings.push(...reference.warnings);

  return {
    kind: "agar_spot_growth",
    features,
    spots,
    summaries,
    settings: {
      ...settings,
      selectedDilutionIndex,
      suggestedDilutionIndex
    },
    generatedAt: new Date().toISOString(),
    inputWarnings: params.inputWarnings,
    qc: {
      medianBackgroundDensity,
      validBackgroundCount: backgroundFeatures.length,
      controlGroupIds,
      referenceControlGroupId: reference.controlGroupId,
      warnings: qcWarnings,
      suggestedDilutionIndex,
      selectedDilutionIndex
    }
  };
}

export function normalizeAgarSettings(settings: AgarSpotAnalysisSettings = {}): NormalizedAgarSpotAnalysisSettings {
  return {
    referenceControlGroupId: settings.referenceControlGroupId?.trim() || undefined,
    dilutionOverride: settings.dilutionOverride,
    selectedDilutionIndex: settings.selectedDilutionIndex,
    suggestedDilutionIndex: settings.suggestedDilutionIndex,
    nearBackgroundDensity: settings.nearBackgroundDensity ?? 8,
    highCvThreshold: settings.highCvThreshold ?? 0.35,
    saturationClippedFraction: settings.saturationClippedFraction ?? 0.05,
    overgrownDensity: settings.overgrownDensity ?? 210
  };
}

function spotAnalysisFromFeature(feature: RoiFeature, map: SpotMapCell | undefined): SpotAnalysis | undefined {
  if (!map || map.role === "unused") {
    return undefined;
  }
  const qcFlags = featureToQcFlags(feature);
  return {
    roiId: feature.roiId,
    label: feature.label,
    row: feature.row,
    col: feature.col,
    role: map.role,
    density: feature.backgroundCorrectedDensity,
    feature,
    map,
    valid: Number.isFinite(feature.backgroundCorrectedDensity) && qcFlags.length === 0,
    qcFlags
  };
}

function summarizeSpots(
  spots: SpotAnalysis[],
  settings: NormalizedAgarSpotAnalysisSettings,
  referenceControlGroupId: string
): SpotDilutionSummary[] {
  const measured = spots.filter((spot) => (spot.map.role === "experimental" || spot.map.role === "control") && spot.valid);
  const referenceControlByDilution = groupBy(
    measured.filter((spot) => spot.map.role === "control" && spot.map.groupId.trim() === referenceControlGroupId),
    (spot) => String(spot.map.dilutionIndex)
  );
  const summaries: SpotDilutionSummary[] = [];
  const grouped = groupBy(measured, (spot) => `${spot.map.role}::${spot.map.groupId.trim()}::${spot.map.dilutionIndex}`);

  for (const [key, group] of grouped.entries()) {
    const [role, groupId, dilutionIndexText] = key.split("::");
    const dilutionIndex = Number(dilutionIndexText);
    const densities = group.map((spot) => spot.density).filter(Number.isFinite);
    const controlDensities = referenceControlByDilution.get(String(dilutionIndex))?.map((spot) => spot.density).filter(Number.isFinite) ?? [];
    const meanDensity = mean(densities);
    const sdDensity = standardDeviation(densities);
    const cv = meanDensity > 0 ? sdDensity / meanDensity : Number.NaN;
    const controlMean = mean(controlDensities);
    const relativeGrowth = controlMean > 0 ? meanDensity / controlMean : Number.NaN;
    const warnings = summaryWarnings(group, meanDensity, cv, controlMean, settings);

    summaries.push({
      role: role as "experimental" | "control",
      groupId,
      referenceControlGroupId,
      dilutionIndex,
      n: densities.length,
      meanDensity,
      sdDensity,
      cv,
      controlMeanDensity: controlMean,
      relativeGrowth,
      warnings
    });
  }

  return summaries.sort((a, b) => a.dilutionIndex - b.dilutionIndex || a.role.localeCompare(b.role) || a.groupId.localeCompare(b.groupId));
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
  if (group.some((spot) => spot.feature.qc.clippedFraction > settings.saturationClippedFraction)) {
    warnings.push("saturated");
  }
  return warnings;
}

function suggestBestDilution(summaries: SpotDilutionSummary[]): number | undefined {
  const byDilution = groupBy(summaries, (summary) => String(summary.dilutionIndex));
  const candidates = [...byDilution.entries()]
    .map(([dilutionIndex, group]) => {
      const relevant = group.filter((summary) => summary.role === "experimental" || summary.role === "control");
      const excluded = relevant.some((summary) =>
        summary.warnings.some((warning) =>
          ["saturated", "overgrown", "near_background", "high_cv", "insufficient_replicates", "missing_reference_control"].includes(warning)
        )
      );
      const hasControl = relevant.some((summary) => summary.role === "control");
      const hasExperimental = relevant.some((summary) => summary.role === "experimental");
      const averageCv = mean(relevant.map((summary) => summary.cv).filter(Number.isFinite));
      return {
        dilutionIndex: Number(dilutionIndex),
        excluded,
        hasControl,
        hasExperimental,
        summaryCount: relevant.length,
        averageCv
      };
    })
    .filter((candidate) => !candidate.excluded && candidate.hasControl && candidate.hasExperimental);

  candidates.sort(
    (a, b) =>
      b.summaryCount - a.summaryCount ||
      (Number.isFinite(a.averageCv) ? a.averageCv : Number.POSITIVE_INFINITY) -
        (Number.isFinite(b.averageCv) ? b.averageCv : Number.POSITIVE_INFINITY) ||
      a.dilutionIndex - b.dilutionIndex
  );
  return candidates[0]?.dilutionIndex;
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
      warnings.push(`Requested reference control group "${requested}" has no valid control spots; using ${sortedGroups[0] ?? "none"}.`);
      return { controlGroupId: sortedGroups[0], warnings };
    }
    return { controlGroupId: requested, warnings };
  }
  if (sortedGroups.length > 1) {
    warnings.push(`Multiple control groups are present; using "${sortedGroups[0]}" as the reference control group.`);
  }
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
