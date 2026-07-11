import { chooseMetricAndNormalize, wellFeatureQcFlags } from "../../analysis/normalization";
import { calculateMicResults } from "../../analysis/observedMic";
import { median } from "../../analysis/statistics";
import { buildGridHomography, generatePlateGrid } from "../../geometry/plateGrid";
import { sampleWellFeatures } from "../../image/wellSampler";
import type { AnalysisSettings, InputWarningCode, PlateAnchors, XttAnalysisResult } from "../../types";
import type { PlateMapCell } from "../../plateMap/plateMapTypes";
import { currentResultScience, EXPLORATORY_XTT_PROTOCOL } from "../../science/protocols";
import type { QcIssue } from "../../science/contracts";

export function analyzeXtt96Image(params: {
  imageData: ImageData;
  anchors: PlateAnchors;
  wellAdjustments: Record<string, { x: number; y: number }>;
  analysisRadiusFactor: number;
  overlayRadiusFactor: number;
  plateMap: PlateMapCell[];
  settings: AnalysisSettings;
  inputWarnings: InputWarningCode[];
}): XttAnalysisResult {
  const homography = buildGridHomography(params.anchors);
  const grid = generatePlateGrid(homography, params.analysisRadiusFactor, params.overlayRadiusFactor).map((well) => {
    const adjustment = params.wellAdjustments[well.well];
    return adjustment ? { ...well, center: { x: well.center.x + adjustment.x, y: well.center.y + adjustment.y } } : well;
  });
  const rawFeatures = applyBlankReferences(sampleWellFeatures(params.imageData, grid, homography), params.plateMap);
  const normalized = chooseMetricAndNormalize(rawFeatures, params.plateMap, params.settings.selectedMetric);
  const invalidReferences = normalized.references.filter((reference) => !reference.valid);
  const micResults = calculateMicResults(normalized.wells, params.settings.threshold, EXPLORATORY_XTT_PROTOCOL);
  const issues: Array<string | QcIssue> = [
    ...params.inputWarnings,
    ...invalidReferences.map((reference) => ({
      code: "normalization_group_failed",
      severity: "warning" as const,
      scope: "series" as const,
      targetId: reference.normalizationGroupId,
      message: reference.warnings.join(" ") || "Control normalization failed."
    })),
    ...normalized.wells.filter((well) => well.qcFlags.length > 0).map((well) => ({
      code: "roi_excluded",
      severity: "exclude" as const,
      scope: "roi" as const,
      targetId: well.well,
      message: `Well ${well.well} was excluded: ${well.qcFlags.join(", ")}.`
    })),
    ...runControlIssues(normalized.wells)
  ];
  const science = currentResultScience(EXPLORATORY_XTT_PROTOCOL, issues);
  return {
    kind: "xtt_96well_mic",
    features: normalized.features,
    wells: normalized.wells,
    normalization: normalized.reference,
    normalizationGroups: normalized.references,
    micResults,
    settings: {
      ...params.settings,
      selectedMetric: normalized.reference.selectedMetric
    },
    generatedAt: new Date().toISOString(),
    inputWarnings: params.inputWarnings
    ,protocolId: EXPLORATORY_XTT_PROTOCOL.id,
    provenance: science.provenance,
    qcDecision: science.qcDecision
  };
}

function runControlIssues(wells: XttAnalysisResult["wells"]): QcIssue[] {
  const issues: QcIssue[] = [];
  const groups = [...new Set(wells.map((well) => well.map.normalizationGroupId).filter(Boolean))];
  const checks = [
    {
      role: "sterility_control" as const,
      minimum: EXPLORATORY_XTT_PROTOCOL.controlRequirements.minimumSterilityControls,
      maximum: EXPLORATORY_XTT_PROTOCOL.controlAcceptance?.sterilityMaximumRma,
      code: "sterility_control_failed",
      label: "sterility control"
    },
    {
      role: "positive_inhibition_control" as const,
      minimum: EXPLORATORY_XTT_PROTOCOL.controlRequirements.minimumPositiveInhibitionControls,
      maximum: EXPLORATORY_XTT_PROTOCOL.controlAcceptance?.positiveInhibitionMaximumRma,
      code: "positive_inhibition_control_failed",
      label: "positive-inhibition control"
    }
  ];
  for (const groupId of groups) for (const check of checks) {
    const declared = wells.filter((well) => well.map.normalizationGroupId === groupId && well.map.role === check.role);
    const values = declared.map((well) => well.relativeMetabolicActivityRaw ?? well.viability).filter(Number.isFinite);
    if (check.minimum != null && values.length < check.minimum) {
      issues.push({ code: `${check.code}_insufficient`, severity: "warning", scope: "series", targetId: groupId, message: `Normalization group ${groupId} requires at least ${check.minimum} eligible ${check.label} wells.`, details: { eligibleCount: values.length, requiredCount: check.minimum } });
    }
    if (declared.length > 0 && values.length === 0) {
      issues.push({ code: `${check.code}_unmeasurable`, severity: "warning", scope: "series", targetId: groupId, message: `Normalization group ${groupId} has no eligible ${check.label} measurement.` });
      continue;
    }
    const observedMedian = median(values);
    if (declared.length > 0 && check.maximum != null && Number.isFinite(observedMedian) && observedMedian > check.maximum) {
      issues.push({ code: check.code, severity: "warning", scope: "series", targetId: groupId, message: `Normalization group ${groupId} ${check.label} median RMA exceeds the exploratory run-check limit.`, details: { medianRma: observedMedian, maximumRma: check.maximum, eligibleCount: values.length } });
    }
  }
  return issues;
}

export function applyBlankReferences(features: ReturnType<typeof sampleWellFeatures>, plateMap: PlateMapCell[]) {
  const mapByWell = new Map(plateMap.map((cell) => [cell.well, cell]));
  const featureByWell = new Map(features.map((feature) => [feature.well, feature]));
  return features.map((feature) => {
    const groupId = mapByWell.get(feature.well)?.normalizationGroupId;
    const blanks = plateMap
      .filter((cell) => cell.role === "reagent_blank" && cell.normalizationGroupId === groupId)
      .map((cell) => featureByWell.get(cell.well))
      .filter((item): item is typeof feature => Boolean(item) && wellFeatureQcFlags(item!).length === 0);
    const blankLinearB = median(blanks.map((blank) => blank.linearB).filter(Number.isFinite));
    const blankGreenBlue = median(blanks.map((blank) => blank.linearG + blank.linearB).filter(Number.isFinite));
    if (!Number.isFinite(blankLinearB) || !Number.isFinite(blankGreenBlue)) return feature;
    const greenBlue = Math.max(feature.linearG + feature.linearB, 1e-6);
    return {
      ...feature,
      pseudoODBlue: -Math.log10(Math.max(feature.linearB, 1e-6) / Math.max(blankLinearB, 1e-6)),
      pseudoODGreenBlue: -Math.log10(greenBlue / Math.max(blankGreenBlue, 1e-6))
    };
  });
}
