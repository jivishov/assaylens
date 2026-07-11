import type { NormalizationReference, SignalMetric, WellAnalysis, WellFeature } from "../types";
import type { PlateMapCell } from "../plateMap/plateMapTypes";
import { getSignal, setSelectedSignal } from "../image/signalMetrics";
import { clamp, mad, median } from "./statistics";
import { EXPLORATORY_XTT_PROTOCOL } from "../science/protocols";

/** Protocol-pinned normalization. requestedMetric is accepted only as a compatibility
 * argument and can never override the protocol's declared primary observable. */
export function chooseMetricAndNormalize(features: WellFeature[], plateMap: PlateMapCell[], _requestedMetric?: SignalMetric) {
  const protocol = EXPLORATORY_XTT_PROTOCOL;
  const metric = protocol.signalMetric;
  const mapByWell = new Map(plateMap.map((cell) => [cell.well, cell]));
  const selectedFeatures = features.map((feature) => setSelectedSignal(feature, metric));
  const featureByWell = new Map(selectedFeatures.map((feature) => [feature.well, feature]));
  const groupIds = [...new Set(plateMap.map((cell) => cell.normalizationGroupId.trim()).filter(Boolean))];
  const references = groupIds.map((groupId) => buildReference(groupId, plateMap, featureByWell, metric));
  const referenceByGroup = new Map(references.map((reference) => [reference.normalizationGroupId ?? "", reference]));

  const wells: WellAnalysis[] = selectedFeatures.map((feature) => {
    const map = mapByWell.get(feature.well);
    if (!map) throw new Error(`Missing plate-map entry for ${feature.well}.`);
    const qcFlags = wellFeatureQcFlags(feature);
    const reference = referenceByGroup.get(map.normalizationGroupId);
    const raw = getSignal(feature, metric);
    const oriented = protocol.signalDirection === "increasing" ? raw : -raw;
    const blank = reference ? (protocol.signalDirection === "increasing" ? reference.blankSignal : -reference.blankSignal) : Number.NaN;
    const growth = reference ? (protocol.signalDirection === "increasing" ? reference.growthSignal : -reference.growthSignal) : Number.NaN;
    const denominator = growth - blank;
    const rma = reference?.valid && qcFlags.length === 0 && denominator >= protocol.minimumSignalWindow ? (oriented - blank) / denominator : Number.NaN;
    return {
      well: feature.well, signal: oriented,
      relativeMetabolicActivityRaw: rma, displayRma: Number.isFinite(rma) ? clamp(rma, 0, 1) : Number.NaN,
      inhibitionRaw: Number.isFinite(rma) ? 1 - rma : Number.NaN,
      // Deprecated compatibility aliases; cycle 9 removes these from visible/exported claims.
      viability: rma, inhibition: Number.isFinite(rma) ? 1 - rma : Number.NaN,
      feature, map, qcFlags
    };
  });
  const first = references[0] ?? invalidReference(metric, "No normalization group was declared.");
  return { reference: first, references, features: selectedFeatures, wells };
}

function buildReference(groupId: string, plateMap: PlateMapCell[], featureByWell: Map<string, WellFeature>, metric: SignalMetric): NormalizationReference {
  const groupCells = plateMap.filter((cell) => cell.normalizationGroupId === groupId);
  const vehicleDeclared = groupCells.some((cell) => cell.role === "sample" && cell.usesVehicleControl);
  const referenceRole = vehicleDeclared ? "vehicle_control" : "growth_control";
  const eligible = (role: PlateMapCell["role"]) => groupCells.filter((cell) => cell.role === role).map((cell) => featureByWell.get(cell.well)).filter((f): f is WellFeature => Boolean(f) && wellFeatureQcFlags(f!).length === 0).map((f) => getSignal(f, metric)).filter(Number.isFinite);
  const growth = eligible(referenceRole), blank = eligible("reagent_blank");
  const warnings: string[] = [];
  const requiredReferenceCount = referenceRole === "vehicle_control"
    ? EXPLORATORY_XTT_PROTOCOL.controlRequirements.minimumVehicleControls ?? EXPLORATORY_XTT_PROTOCOL.controlRequirements.minimumGrowthControls
    : EXPLORATORY_XTT_PROTOCOL.controlRequirements.minimumGrowthControls;
  const requiredBlankCount = EXPLORATORY_XTT_PROTOCOL.controlRequirements.minimumReagentBlanks;
  if (growth.length < requiredReferenceCount) warnings.push(`Normalization group ${groupId} requires at least ${requiredReferenceCount} eligible ${referenceRole.replaceAll("_", " ")} wells.`);
  if (blank.length < requiredBlankCount) warnings.push(`Normalization group ${groupId} requires at least ${requiredBlankCount} eligible reagent blanks.`);
  if (warnings.length) return { ...invalidReference(metric, warnings.join(" ")), normalizationGroupId: groupId, warnings };
  const growthSignal = median(growth), blankSignal = median(blank);
  const orientedGrowth = EXPLORATORY_XTT_PROTOCOL.signalDirection === "increasing" ? growthSignal : -growthSignal;
  const orientedBlank = EXPLORATORY_XTT_PROTOCOL.signalDirection === "increasing" ? blankSignal : -blankSignal;
  if (orientedGrowth - orientedBlank < EXPLORATORY_XTT_PROTOCOL.minimumSignalWindow) warnings.push(`Normalization group ${groupId} has an inadequate signal window.`);
  const separationMad = Math.abs(growthSignal - blankSignal) / Math.max(mad(growth), mad(blank), 1e-6);
  return { normalizationGroupId: groupId, growthSignal, blankSignal, direction: EXPLORATORY_XTT_PROTOCOL.signalDirection, separationMad, selectedMetric: metric, warnings, valid: warnings.length === 0 };
}

function invalidReference(metric: SignalMetric, message: string): NormalizationReference {
  return { growthSignal: Number.NaN, blankSignal: Number.NaN, direction: EXPLORATORY_XTT_PROTOCOL.signalDirection, separationMad: 0, selectedMetric: metric, warnings: [message], valid: false };
}

export function wellFeatureQcFlags(feature: WellFeature): string[] {
  const p = EXPLORATORY_XTT_PROTOCOL, flags: string[] = [];
  if ((feature.qc.candidatePixelCount ?? 1) === 0 || (feature.qc.validPixelCount ?? 1) === 0) flags.push("zero_valid_pixels");
  if (feature.qc.validPixelFraction < p.minimumValidPixelFraction) flags.push("low_valid_pixel_fraction");
  if (feature.qc.highlightFraction > p.maximumHighlightFraction) flags.push("highlight_glare");
  if (feature.qc.darkArtifactFraction > p.maximumDarkArtifactFraction) flags.push("dark_artifact");
  if (feature.qc.partiallyOutsideImage) flags.push("partially_outside_image");
  return flags;
}
