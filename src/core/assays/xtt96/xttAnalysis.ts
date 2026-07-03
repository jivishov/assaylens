import { chooseMetricAndNormalize } from "../../analysis/normalization";
import { calculateMicResults } from "../../analysis/observedMic";
import { median } from "../../analysis/statistics";
import { buildGridHomography, generatePlateGrid } from "../../geometry/plateGrid";
import { sampleWellFeatures } from "../../image/wellSampler";
import type { AnalysisSettings, InputWarningCode, PlateAnchors, XttAnalysisResult } from "../../types";
import type { PlateMapCell } from "../../plateMap/plateMapTypes";

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
  if (!normalized.reference.valid) {
    throw new Error(normalized.reference.warnings.join(" ") || "Control separation failed.");
  }

  const micResults = calculateMicResults(normalized.wells, params.settings.threshold);
  return {
    kind: "xtt_96well_mic",
    features: normalized.features,
    wells: normalized.wells,
    normalization: normalized.reference,
    micResults,
    settings: {
      ...params.settings,
      selectedMetric: normalized.reference.selectedMetric
    },
    generatedAt: new Date().toISOString(),
    inputWarnings: params.inputWarnings
  };
}

export function applyBlankReferences(features: ReturnType<typeof sampleWellFeatures>, plateMap: PlateMapCell[]) {
  const blankWells = new Set(plateMap.filter((cell) => cell.role === "blank_low_signal").map((cell) => cell.well));
  const blanks = features.filter((feature) => blankWells.has(feature.well));
  const blankLinearB = median(blanks.map((feature) => feature.linearB).filter(Number.isFinite));
  const blankGreenBlue = median(blanks.map((feature) => feature.linearG + feature.linearB).filter(Number.isFinite));

  if (!Number.isFinite(blankLinearB) || !Number.isFinite(blankGreenBlue)) {
    return features;
  }

  return features.map((feature) => {
    const greenBlue = Math.max(feature.linearG + feature.linearB, 1e-6);
    return {
      ...feature,
      pseudoODBlue: -Math.log10(Math.max(feature.linearB, 1e-6) / Math.max(blankLinearB, 1e-6)),
      pseudoODGreenBlue: -Math.log10(greenBlue / Math.max(blankGreenBlue, 1e-6))
    };
  });
}
