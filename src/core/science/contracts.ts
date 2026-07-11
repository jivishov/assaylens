import type { SignalMetric } from "../types";

export type ResultClaimLevel = "exploratory" | "calibrated_image_measurement" | "validated_endpoint";
export type ResultOrigin = "computed_from_current_pixels" | "imported_v3_unverified" | "legacy_import_unverified";
export type CalibrationStatus = "not_requested" | "missing" | "passed" | "failed";
export type QcSeverity = "warning" | "exclude" | "block";
export type QcScope = "run" | "roi" | "dose_point" | "series";

export type QcIssue = {
  code: string;
  severity: QcSeverity;
  scope: QcScope;
  targetId?: string;
  message: string;
  details?: Record<string, number | string | boolean>;
};

export type QcDecision = {
  canCompute: boolean;
  canReport: boolean;
  maximumClaimLevel: ResultClaimLevel;
  issues: QcIssue[];
};

export type ResultProvenance = {
  origin: ResultOrigin;
  claimLevel: ResultClaimLevel;
  appVersion: string;
  algorithmVersion: string;
  schemaVersion: 3;
  protocolId: string;
  protocolVersion: string;
  acquisitionProfileId?: string;
  calibrationStatus: CalibrationStatus;
  validationRecordId?: string;
};

export type ControlRequirements = {
  minimumGrowthControls: number;
  minimumReagentBlanks: number;
  minimumVehicleControls?: number;
  minimumSterilityControls?: number;
  minimumPositiveInhibitionControls?: number;
  minimumBiologicalReplicates?: number;
  minimumTechnicalReplicates?: number;
};

export type XttProtocol = {
  kind: "xtt";
  id: string;
  version: string;
  displayName: string;
  claimLevel: ResultClaimLevel;
  organismDescription: string;
  strainDescription?: string;
  mediumDescription: string;
  inoculumDescription: string;
  incubationTemperatureC?: number;
  incubationHours?: number;
  xttConcentration?: number;
  xttConcentrationUnit?: string;
  electronCouplerDescription?: string;
  reactionMinutes?: number;
  opticalGeometry: "reflection" | "transmission";
  signalMetric: SignalMetric;
  signalDirection: "increasing" | "decreasing";
  endpointName: string;
  endpointThreshold: number;
  doseSeriesRules: {
    minimumDosePoints: number;
    requiredConcentrations?: Array<{ value: number; unit: string }>;
  };
  controlRequirements: ControlRequirements;
  minimumValidPixelFraction: number;
  maximumHighlightFraction: number;
  maximumDarkArtifactFraction: number;
  minimumSignalWindow: number;
  controlAcceptance?: {
    sterilityMaximumRma?: number;
    positiveInhibitionMaximumRma?: number;
  };
  validationRecordId?: string;
};

export type AgarProtocol = {
  kind: "agar";
  id: string;
  version: string;
  displayName: string;
  claimLevel: ResultClaimLevel;
  organismDescription: string;
  mediumDescription: string;
  incubationTemperatureC?: number;
  endpointHours?: number;
  spotVolumeDescription: string;
  signalDirection: "dark_on_light" | "light_on_dark";
  segmentationSigmaMultiplier: number;
  minimumComponentAreaFraction: number;
  maximumSaturationFraction: number;
  minimumRoiPixels: number;
  minimumAnnulusPixels: number;
  controlRequirements: ControlRequirements;
  validationRecordId?: string;
};

export type AssayProtocol = XttProtocol | AgarProtocol;

export type ValidationRecord = {
  id: string;
  protocolId: string;
  kind: "calibration" | "endpoint_comparator";
  passed: true;
  evidenceDocument: string;
};

export type CalibrationProfile = {
  id: string;
  version: string;
  protocolId: string;
  validationRecordId: string;
};

export function qcDecision(issues: QcIssue[], requested: ResultClaimLevel = "exploratory"): QcDecision {
  const hasBlock = issues.some((issue) => issue.severity === "block");
  const reportabilityWarning = issues.some((issue) => issue.severity === "warning" || issue.severity === "exclude");
  return {
    canCompute: !hasBlock,
    canReport: !hasBlock && !reportabilityWarning,
    maximumClaimLevel: hasBlock || reportabilityWarning ? "exploratory" : requested,
    issues
  };
}
