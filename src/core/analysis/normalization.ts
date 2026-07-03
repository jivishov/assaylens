import type {
  NormalizationReference,
  SignalMetric,
  WellAnalysis,
  WellFeature
} from "../types";
import type { PlateMapCell } from "../plateMap/plateMapTypes";
import { SIGNAL_METRICS, getSignal, setSelectedSignal } from "../image/signalMetrics";
import { clamp, mad, median } from "./statistics";

export function chooseMetricAndNormalize(
  features: WellFeature[],
  plateMap: PlateMapCell[],
  requestedMetric?: SignalMetric
): {
  reference: NormalizationReference;
  features: WellFeature[];
  wells: WellAnalysis[];
} {
  const mapByWell = new Map(plateMap.map((cell) => [cell.well, cell]));
  const candidates = requestedMetric ? SIGNAL_METRICS.filter((metric) => metric.id === requestedMetric) : SIGNAL_METRICS;
  const scored = candidates.map(({ id }) => scoreMetric(features, mapByWell, id)).sort((a, b) => b.reference.separationMad - a.reference.separationMad);
  const winner = scored[0];

  if (!winner) {
    throw new Error("No signal metric is available.");
  }

  const selectedFeatures = features.map((feature) => setSelectedSignal(feature, winner.reference.selectedMetric));
  const wells = selectedFeatures.map((feature) => {
    const map = mapByWell.get(feature.well);
    if (!map) {
      throw new Error(`Missing plate-map entry for ${feature.well}.`);
    }
    const rawSignal = getSignal(feature, winner.reference.selectedMetric);
    const signal = winner.reference.direction === "increasing" ? rawSignal : -rawSignal;
    const growth = winner.reference.direction === "increasing" ? winner.reference.growthSignal : -winner.reference.growthSignal;
    const blank = winner.reference.direction === "increasing" ? winner.reference.blankSignal : -winner.reference.blankSignal;
    const denominator = growth - blank;
    const viability = denominator > 0 ? clamp((signal - blank) / denominator, 0, 1) : Number.NaN;
    const qcFlags = featureToQcFlags(feature);

    return {
      well: feature.well,
      signal,
      viability,
      inhibition: Number.isFinite(viability) ? 1 - viability : Number.NaN,
      feature,
      map,
      qcFlags
    };
  });

  return {
    reference: winner.reference,
    features: selectedFeatures,
    wells
  };
}

function scoreMetric(
  features: WellFeature[],
  mapByWell: Map<string, PlateMapCell>,
  metric: SignalMetric
): { reference: NormalizationReference } {
  const growth = features
    .filter((feature) => mapByWell.get(feature.well)?.role === "growth_control_high_signal")
    .map((feature) => getSignal(feature, metric))
    .filter(Number.isFinite);
  const blank = features
    .filter((feature) => mapByWell.get(feature.well)?.role === "blank_low_signal")
    .map((feature) => getSignal(feature, metric))
    .filter(Number.isFinite);
  const warnings: string[] = [];

  if (growth.length < 2 || blank.length < 2) {
    warnings.push("Control normalization requires at least 2 growth and 2 blank controls.");
    return {
      reference: {
        growthSignal: Number.NaN,
        blankSignal: Number.NaN,
        direction: "increasing",
        separationMad: 0,
        selectedMetric: metric,
        warnings,
        valid: false
      }
    };
  }

  const growthMedian = median(growth);
  const blankMedian = median(blank);
  const direction = growthMedian >= blankMedian ? "increasing" : "decreasing";
  const pooledMad = Math.max(mad(growth), mad(blank), 1e-6);
  const separationMad = Math.abs(growthMedian - blankMedian) / pooledMad;

  if (separationMad < 3) {
    warnings.push("Growth and blank controls are not separated enough to calculate MIC.");
  }
  const growthMad = mad(growth);
  const blankMad = mad(blank);
  if (growthMad > 1e-6 && growthMad / Math.max(Math.abs(growthMedian), 1e-6) > 0.35) {
    warnings.push("Growth-control replicates are inconsistent.");
  }
  if (blankMad > 1e-6 && blankMad / Math.max(Math.abs(blankMedian), 1e-6) > 0.35) {
    warnings.push("Blank-control replicates are inconsistent.");
  }

  return {
    reference: {
      growthSignal: growthMedian,
      blankSignal: blankMedian,
      direction,
      separationMad,
      selectedMetric: metric,
      warnings,
      valid: warnings.length === 0
    }
  };
}

function featureToQcFlags(feature: WellFeature): string[] {
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
  if (feature.qc.partiallyOutsideImage) {
    flags.push("partially_outside_image");
  }
  return flags;
}
