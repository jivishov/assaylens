import type { AgarProtocol, CalibrationProfile, ValidationRecord, XttProtocol } from "./contracts";
import type { QcIssue, ResultProvenance } from "./contracts";
import { qcDecision } from "./contracts";
import { ALGORITHM_VERSION, APP_VERSION, PROJECT_SCHEMA_VERSION } from "../version";

export const EXPLORATORY_XTT_PROTOCOL: XttProtocol = {
  kind: "xtt",
  id: "xtt_image_exploratory_v1",
  version: "1.0.0",
  displayName: "Exploratory XTT image signal",
  claimLevel: "exploratory",
  organismDescription: "User supplied; not validated",
  mediumDescription: "User supplied; not validated",
  inoculumDescription: "User supplied; not validated",
  opticalGeometry: "reflection",
  signalMetric: "orangeChromaticity",
  signalDirection: "increasing",
  endpointName: "RMA <= 10% image endpoint",
  endpointThreshold: 0.1,
  doseSeriesRules: {
    minimumDosePoints: 2
  },
  controlRequirements: {
    minimumGrowthControls: 2,
    minimumReagentBlanks: 2,
    minimumVehicleControls: 2
  },
  minimumValidPixelFraction: 0.65,
  maximumHighlightFraction: 0.08,
  maximumDarkArtifactFraction: 0.08,
  minimumSignalWindow: 1e-6,
  controlAcceptance: {
    sterilityMaximumRma: 0.1,
    positiveInhibitionMaximumRma: 0.1
  }
};

export const EXPLORATORY_AGAR_PROTOCOL: AgarProtocol = {
  kind: "agar",
  id: "agar_endpoint_exploratory_v1",
  version: "1.0.0",
  displayName: "Exploratory agar endpoint spot signal",
  claimLevel: "exploratory",
  organismDescription: "User supplied; not validated",
  mediumDescription: "User supplied; not validated",
  spotVolumeDescription: "User supplied; not validated",
  signalDirection: "dark_on_light",
  segmentationSigmaMultiplier: 3,
  minimumComponentAreaFraction: 0.002,
  maximumSaturationFraction: 0.05,
  minimumRoiPixels: 64,
  minimumAnnulusPixels: 128,
  controlRequirements: {
    minimumGrowthControls: 1,
    minimumReagentBlanks: 3
  }
};

export const ASSAY_PROTOCOLS = [EXPLORATORY_XTT_PROTOCOL, EXPLORATORY_AGAR_PROTOCOL] as const;

// These registries intentionally ship empty. Only code-reviewed external evidence may populate them.
export const CALIBRATION_PROFILES: readonly CalibrationProfile[] = [];
export const VALIDATION_RECORDS: readonly ValidationRecord[] = [];

export function protocolById(id: string) {
  return ASSAY_PROTOCOLS.find((protocol) => protocol.id === id);
}

export function deriveResultScience(
  protocol: XttProtocol | AgarProtocol,
  warnings: Array<string | QcIssue> = [],
  calibrationProfiles: readonly CalibrationProfile[] = CALIBRATION_PROFILES,
  validationRecords: readonly ValidationRecord[] = VALIDATION_RECORDS
): { provenance: ResultProvenance; qcDecision: ReturnType<typeof qcDecision> } {
  const requestedCalibration = calibrationProfiles.find((profile) => profile.protocolId === protocol.id);
  const calibration = calibrationProfiles.find((profile) => profile.protocolId === protocol.id && validationRecords.some(
    (record) => record.id === profile.validationRecordId && record.protocolId === protocol.id && record.kind === "calibration" && record.passed
  ));
  const endpointValidation = protocol.validationRecordId
    ? validationRecords.find((record) => record.id === protocol.validationRecordId && record.protocolId === protocol.id && record.kind === "endpoint_comparator" && record.passed)
    : undefined;
  const calibrated = Boolean(calibration);
  const claimLevel = calibrated && endpointValidation ? "validated_endpoint" : calibrated ? "calibrated_image_measurement" : "exploratory";
  const issues: QcIssue[] = warnings.map((warning) => typeof warning === "string"
    ? { code: "input_image_warning", severity: "warning", scope: "run", message: warning }
    : warning);
  const decision = qcDecision(issues, claimLevel);
  return {
    provenance: { origin: "computed_from_current_pixels", claimLevel: decision.maximumClaimLevel, appVersion: APP_VERSION, algorithmVersion: ALGORITHM_VERSION, schemaVersion: PROJECT_SCHEMA_VERSION, protocolId: protocol.id, protocolVersion: protocol.version, calibrationStatus: calibrated ? "passed" : requestedCalibration ? "failed" : "not_requested", validationRecordId: endpointValidation?.id },
    qcDecision: decision
  };
}

export function currentResultScience(protocol: XttProtocol | AgarProtocol, warnings: Array<string | QcIssue> = []) {
  return deriveResultScience(protocol, warnings);
}
