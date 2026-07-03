import type { SignalMetric, WellFeature } from "../types";

export const SIGNAL_METRICS: Array<{
  id: SignalMetric;
  label: string;
  description: string;
}> = [
  {
    id: "orangeChromaticity",
    label: "Orange chromaticity",
    description: "Normalized red plus green signal minus blue for XTT orange/yellow contrast."
  },
  {
    id: "yellowOrangeLab",
    label: "Yellow-orange Lab",
    description: "CIELAB yellow channel plus a red-green contribution."
  },
  {
    id: "pseudoODBlue",
    label: "Pseudo OD blue",
    description: "Blue-channel pseudo optical density relative to blank controls."
  },
  {
    id: "pseudoODGreenBlue",
    label: "Pseudo OD green-blue",
    description: "Pseudo OD using the green/blue ratio relative to blank controls."
  },
  {
    id: "hsvS",
    label: "HSV saturation",
    description: "Diagnostic fallback based on saturation."
  }
];

export function getSignal(feature: WellFeature, metric: SignalMetric): number {
  switch (metric) {
    case "orangeChromaticity":
      return feature.orangeChromaticity;
    case "yellowOrangeLab":
      return feature.yellowOrangeLab;
    case "pseudoODBlue":
      return feature.pseudoODBlue;
    case "pseudoODGreenBlue":
      return feature.pseudoODGreenBlue;
    case "hsvS":
      return feature.hsvS;
  }
}

export function setSelectedSignal(feature: WellFeature, metric: SignalMetric): WellFeature {
  return {
    ...feature,
    selectedSignal: getSignal(feature, metric)
  };
}
