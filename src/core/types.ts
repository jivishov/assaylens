import type { PlateMapCell } from "./plateMap/plateMapTypes";
import type { AssayMode, RoiFeature, RoiQc } from "./roi/roiTypes";
import type { SpotMapCell, SpotRole } from "./assays/agarSpot/spotMapTypes";
import type { AssayProtocol, QcDecision, ResultProvenance } from "./science/contracts";

export type { AssayMode } from "./roi/roiTypes";

export type Point = {
  x: number;
  y: number;
};

export type AnchorName = "A1" | "A12" | "H12" | "H1";

export type PlateAnchors = Record<AnchorName, Point>;

export type A1Position = "top_left" | "top_right" | "bottom_left" | "bottom_right" | "uncertain";

export type ImageSource = "upload" | "camera";

export type BackgroundClass = "unknown" | "standard" | "black_box";

export type InputWarningCode =
  | "annotated_or_debug_image_possible"
  | "black_background_detected"
  | "low_resolution_capture"
  | "blur_or_focus_risk"
  | "glare_or_overexposure_risk"
  | "underexposure_risk";

export type CaptureQuality = {
  resolution: {
    width: number;
    height: number;
    megapixels: number;
  };
  warnings: InputWarningCode[];
  lowResolution: boolean;
  blurOrFocusRisk: boolean;
  glareOrOverexposureRisk: boolean;
  underexposureRisk: boolean;
};

export type WellMaskQC = RoiQc;

export type WellFeature = {
  roiId?: string;
  label?: string;
  well: string;
  row: number;
  col: number;
  meanR: number;
  meanG: number;
  meanB: number;
  medianR: number;
  medianG: number;
  medianB: number;
  linearR: number;
  linearG: number;
  linearB: number;
  hsvH: number;
  hsvS: number;
  hsvV: number;
  labL: number;
  labA: number;
  labB: number;
  luminanceMean?: number;
  grayDensity?: number;
  backgroundCorrectedDensity?: number;
  orangeChromaticity: number;
  yellowOrangeLab: number;
  pseudoODBlue: number;
  pseudoODGreenBlue: number;
  logIntensityContrastGreenBlue?: number;
  selectedSignal?: number;
  qc: WellMaskQC;
};

export type WellGeometry = {
  well: string;
  row: number;
  col: number;
  center: Point;
  localPitchX: number;
  localPitchY: number;
  overlayRadius: number;
  analysisRadius: number;
};

export type ImageMetadata = {
  name: string;
  type: string;
  width: number;
  height: number;
  size: number;
  lastModified?: number;
  source: ImageSource;
  backgroundClass: BackgroundClass;
  captureQuality?: CaptureQuality;
  warnings: string[];
  warningCodes: InputWarningCode[];
};

export type SpotGridSettings = {
  rows: number;
  columns: number;
  analysisRadiusFactor: number;
  overlayRadiusFactor: number;
  roiAdjustments: Record<string, Point>;
};

export type GeometryState = {
  anchors: Partial<PlateAnchors>;
  confirmed: boolean;
  a1Position: A1Position;
  analysisRadiusFactor: number;
  overlayRadiusFactor: number;
  wellAdjustments: Record<string, Point>;
  spotGrid?: SpotGridSettings;
  agarOrientationConfirmed?: boolean;
  confirmationFingerprint?: string;
};

export type SignalMetric =
  | "orangeChromaticity"
  | "yellowOrangeLab"
  | "pseudoODBlue"
  | "pseudoODGreenBlue"
  | "hsvS";

export type NormalizationReference = {
  normalizationGroupId?: string;
  growthSignal: number;
  blankSignal: number;
  direction: "increasing" | "decreasing";
  separationMad: number;
  selectedMetric: SignalMetric;
  warnings: string[];
  valid: boolean;
};

export type WellAnalysis = {
  well: string;
  signal: number;
  viability: number;
  relativeMetabolicActivityRaw?: number;
  displayRma?: number;
  inhibitionRaw?: number;
  inhibition: number;
  feature: WellFeature;
  map: PlateMapCell;
  qcFlags: string[];
};

export type MicStatus =
  | "qc_failed"
  | "indeterminate_missing_data"
  | "non_monotonic_indeterminate"
  | "le_min_tested"
  | "in_range"
  | "gt_max_tested";

export type MicResult = {
  compoundId: string;
  sampleId: string;
  unit: string;
  threshold: number;
  observedMicLabel: string;
  isotonicMicLabel: string;
  observedMic?: number;
  isotonicMic?: number;
  status: MicStatus;
  concentrations: Array<{
    concentration: number;
    medianViability: number;
    isotonicViability: number;
    replicateCount: number;
    biologicalCount: number;
    technicalCount: number;
    biologicalIqr: number;
    biologicalValues: number[];
    excludedWellIds: string[];
    isotonicAdjusted: boolean;
  }>;
  endpointBoundary?: number;
  warnings: string[];
};

export type AnalysisSettings = {
  threshold: number;
  selectedMetric?: SignalMetric;
};

export type XttAnalysisResult = {
  kind: "xtt_96well_mic";
  features: WellFeature[];
  wells: WellAnalysis[];
  normalization: NormalizationReference;
  normalizationGroups?: NormalizationReference[];
  micResults: MicResult[];
  settings: AnalysisSettings;
  generatedAt: string;
  inputWarnings: InputWarningCode[];
  protocolId?: string;
  provenance?: ResultProvenance;
  qcDecision?: QcDecision;
};

export type AgarSpotAnalysisSettings = {
  referenceControlGroupId?: string;
  dilutionOverride?: number;
  selectedDilutionIndex?: number;
  suggestedDilutionIndex?: number;
  nearBackgroundDensity?: number;
  highCvThreshold?: number;
  saturationClippedFraction?: number;
  overgrownDensity?: number;
};

export type SpotAnalysis = {
  roiId: string;
  label: string;
  row: number;
  col: number;
  role: SpotRole;
  density: number;
  endpointSpotSignal?: number;
  candidatePixelCount?: number;
  validPixelCount?: number;
  outOfImagePixelCount?: number;
  annulusCandidatePixelCount?: number;
  annulusValidPixelCount?: number;
  localBackground?: number;
  localNoise?: number;
  areaPixels?: number;
  areaFraction?: number;
  meanSignedContrast?: number;
  medianSignedContrast?: number;
  signedIntegratedContrast?: number;
  positiveIntegratedContrast?: number;
  saturationFraction?: number;
  boundaryContact?: boolean;
  segmentationConfidence?: number;
  maskProvenance?: string;
  feature: RoiFeature;
  map: SpotMapCell;
  valid: boolean;
  qcFlags: string[];
};

export type SpotDilutionSummary = {
  role: "experimental" | "control";
  groupId: string;
  referenceControlGroupId: string;
  dilutionIndex: number;
  relativeInoculum?: number;
  conditionId?: string;
  n: number;
  meanDensity: number;
  medianEndpointSpotSignal?: number;
  sdDensity: number;
  cv: number;
  controlMeanDensity: number;
  relativeGrowth: number;
  relativeEndpointSpotSignal?: number;
  biologicalCount?: number;
  technicalCount?: number;
  biologicalIqr?: number;
  biologicalValues?: number[];
  warnings: string[];
};

export type AgarSpotQc = {
  medianBackgroundDensity: number;
  validBackgroundCount: number;
  controlGroupIds: string[];
  referenceControlGroupId?: string;
  warnings: string[];
  suggestedDilutionIndex?: number;
  selectedDilutionIndex?: number;
};

export type AgarSpotAnalysisResult = {
  kind: "agar_spot_growth";
  features: RoiFeature[];
  spots: SpotAnalysis[];
  summaries: SpotDilutionSummary[];
  settings: AgarSpotAnalysisSettings;
  generatedAt: string;
  inputWarnings: InputWarningCode[];
  qc: AgarSpotQc;
  protocolId?: string;
  provenance?: ResultProvenance;
  qcDecision?: QcDecision;
};

export type AnalysisResult = XttAnalysisResult | AgarSpotAnalysisResult;

export type ProjectImageMetadata = Omit<ImageMetadata, "name"> & { originalName?: string };

export type ProjectFileBase = {
  schemaVersion: 3;
  app: "AssayLens";
  assayMode: AssayMode;
  imageMetadata?: ProjectImageMetadata;
  geometry: GeometryState;
  qcFlags: string[];
  inputWarnings: InputWarningCode[];
  protocolSnapshot: AssayProtocol;
  provenance: ResultProvenance;
  qcDecision: QcDecision;
  historicalAnalysisResult?: AnalysisResult;
};

export type XttProjectFile = ProjectFileBase & {
  assayMode: "xtt_96well_mic";
  roiMap: PlateMapCell[];
  analysisSettings: AnalysisSettings;
  analysisResult?: XttAnalysisResult;
};

export type AgarSpotProjectFile = ProjectFileBase & {
  assayMode: "agar_spot_growth";
  roiMap: SpotMapCell[];
  analysisSettings: AgarSpotAnalysisSettings;
  analysisResult?: AgarSpotAnalysisResult;
};

export type ProjectFile = XttProjectFile | AgarSpotProjectFile;
