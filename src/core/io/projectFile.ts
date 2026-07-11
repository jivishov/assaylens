import { z } from "zod";
import type {
  AgarSpotAnalysisSettings,
  AnalysisResult,
  AnalysisSettings,
  AssayMode,
  GeometryState,
  ImageMetadata,
  InputWarningCode,
  ProjectFile,
  ProjectImageMetadata,
  XttAnalysisResult
} from "../types";
import type { PlateMapCell } from "../plateMap/plateMapTypes";
import type { SpotMapCell } from "../assays/agarSpot/spotMapTypes";
import type { AssayProtocol, QcDecision, ResultProvenance } from "../science/contracts";
import { qcDecision as buildQcDecision } from "../science/contracts";
import { EXPLORATORY_AGAR_PROTOCOL, EXPLORATORY_XTT_PROTOCOL } from "../science/protocols";
import { ALGORITHM_VERSION, APP_VERSION, PROJECT_SCHEMA_VERSION } from "../version";

type BuildProjectParams = {
  assayMode?: AssayMode;
  imageMetadata?: ImageMetadata;
  geometry: GeometryState;
  plateMap?: PlateMapCell[];
  spotMap?: SpotMapCell[];
  analysis?: AnalysisResult;
  analysisSettings?: AnalysisSettings | AgarSpotAnalysisSettings;
  qcFlags: string[];
  protocolSnapshot?: AssayProtocol;
  provenance?: ResultProvenance;
  qcDecision?: QcDecision;
};

type LegacyProjectFileV1 = {
  schemaVersion: 1;
  app: "MICVision";
  imageMetadata?: ProjectImageMetadata;
  geometry: GeometryState;
  plateMap: PlateMapCell[];
  analysisSettings: AnalysisSettings;
  analysisGeneratedAt?: string;
  perWellFeatures?: XttAnalysisResult["features"];
  wellAnalysis?: XttAnalysisResult["wells"];
  normalizationReferences?: XttAnalysisResult["normalization"];
  micResults?: XttAnalysisResult["micResults"];
  qcFlags?: string[];
  inputWarnings?: InputWarningCode[];
};

type LegacyProjectFileV2 = {
  schemaVersion: 2;
  app: "AssayLens" | "XTT_Vision";
  assayMode?: AssayMode;
  imageMetadata?: ProjectImageMetadata;
  geometry: GeometryState;
  roiMap?: PlateMapCell[] | SpotMapCell[];
  plateMap?: PlateMapCell[];
  analysisSettings: AnalysisSettings | AgarSpotAnalysisSettings;
  analysisResult?: AnalysisResult;
  qcFlags?: string[];
  inputWarnings?: InputWarningCode[];
};

const PROJECT_APP = "AssayLens" as const;
const LEGACY_PROJECT_APP_V2 = "XTT_Vision" as const;
const plateMapCellSchema = z.object({
  well: z.string().regex(/^[A-H](?:[1-9]|1[0-2])$/), row: z.number().int().min(0).max(7), col: z.number().int().min(0).max(11),
  role: z.enum(["sample", "growth_control", "vehicle_control", "reagent_blank", "sterility_control", "positive_inhibition_control", "legacy_unresolved_blank", "unused"]),
  compoundId: z.string(), sampleId: z.string(), concentration: z.number().finite().optional(), unit: z.string(), normalizationGroupId: z.string(), biologicalReplicateId: z.string(), technicalReplicateId: z.string(), usesVehicleControl: z.boolean().optional(), notes: z.string().optional()
}).strict();
const spotMapCellSchema = z.object({
  id: z.string().regex(/^R\d+C\d+$/), row: z.number().int().nonnegative(), col: z.number().int().nonnegative(), role: z.enum(["experimental", "control", "background", "unused"]), groupId: z.string(),
  conditionId: z.string().optional(), normalizationGroupId: z.string().optional(), biologicalReplicateId: z.string().optional(), technicalReplicateId: z.string().optional(), relativeInoculum: z.number().finite().positive().max(1).optional(),
  biologicalReplicate: z.number().int().positive().optional(), technicalReplicate: z.number().int().positive().optional(), dilutionIndex: z.number().int().nonnegative().optional(), notes: z.string().optional()
}).strict();

const pointSchema = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();
const anchorsSchema = z.object({ A1: pointSchema.optional(), A12: pointSchema.optional(), H12: pointSchema.optional(), H1: pointSchema.optional() }).strict();
const inputWarningSchema = z.enum(["annotated_or_debug_image_possible", "black_background_detected", "low_resolution_capture", "blur_or_focus_risk", "glare_or_overexposure_risk", "underexposure_risk"]);
const spotGridSchema = z.object({
  rows: z.number().int().min(2).max(16),
  columns: z.number().int().min(2).max(24),
  analysisRadiusFactor: z.number().finite().positive(),
  overlayRadiusFactor: z.number().finite().positive(),
  roiAdjustments: z.record(z.string(), pointSchema)
}).strict();
const provenanceSchema = z.object({
  origin: z.enum(["computed_from_current_pixels", "imported_v3_unverified", "legacy_import_unverified"]),
  claimLevel: z.enum(["exploratory", "calibrated_image_measurement", "validated_endpoint"]),
  appVersion: z.string().min(1), algorithmVersion: z.string().min(1), schemaVersion: z.literal(3),
  protocolId: z.string().min(1), protocolVersion: z.string().min(1), acquisitionProfileId: z.string().optional(),
  calibrationStatus: z.enum(["not_requested", "missing", "passed", "failed"]), validationRecordId: z.string().optional()
}).strict();
const qcDecisionSchema = z.object({
  canCompute: z.boolean(), canReport: z.boolean(), maximumClaimLevel: z.enum(["exploratory", "calibrated_image_measurement", "validated_endpoint"]),
  issues: z.array(z.object({
    code: z.string().min(1), severity: z.enum(["warning", "exclude", "block"]), scope: z.enum(["run", "roi", "dose_point", "series"]),
    targetId: z.string().optional(), message: z.string().min(1), details: z.record(z.string(), z.union([z.number().finite(), z.string(), z.boolean()])).optional()
  }).strict())
}).strict();
const controlRequirementsSchema = z.object({
  minimumGrowthControls: z.number().int().nonnegative(),
  minimumReagentBlanks: z.number().int().nonnegative(),
  minimumVehicleControls: z.number().int().nonnegative().optional(),
  minimumSterilityControls: z.number().int().nonnegative().optional(),
  minimumPositiveInhibitionControls: z.number().int().nonnegative().optional(),
  minimumBiologicalReplicates: z.number().int().positive().optional(),
  minimumTechnicalReplicates: z.number().int().positive().optional()
}).strict();
const protocolSnapshotSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("xtt"), id: z.string().min(1), version: z.string().min(1), displayName: z.string().min(1), claimLevel: z.enum(["exploratory", "calibrated_image_measurement", "validated_endpoint"]),
    organismDescription: z.string(), strainDescription: z.string().optional(), mediumDescription: z.string(), inoculumDescription: z.string(),
    incubationTemperatureC: z.number().finite().optional(), incubationHours: z.number().finite().positive().optional(), xttConcentration: z.number().finite().positive().optional(),
    xttConcentrationUnit: z.string().optional(), electronCouplerDescription: z.string().optional(), reactionMinutes: z.number().finite().positive().optional(),
    opticalGeometry: z.enum(["reflection", "transmission"]), signalMetric: z.enum(["orangeChromaticity", "yellowOrangeLab", "pseudoODBlue", "pseudoODGreenBlue", "hsvS"]), signalDirection: z.enum(["increasing", "decreasing"]),
    endpointName: z.string().min(1), endpointThreshold: z.number().finite().gt(0).lt(1),
    doseSeriesRules: z.object({ minimumDosePoints: z.number().int().positive(), requiredConcentrations: z.array(z.object({ value: z.number().finite().positive(), unit: z.string().min(1) }).strict()).optional() }).strict(),
    controlRequirements: controlRequirementsSchema, minimumValidPixelFraction: z.number().finite().min(0).max(1), maximumHighlightFraction: z.number().finite().min(0).max(1),
    maximumDarkArtifactFraction: z.number().finite().min(0).max(1), minimumSignalWindow: z.number().finite().positive(),
    controlAcceptance: z.object({ sterilityMaximumRma: z.number().finite().min(0).max(1).optional(), positiveInhibitionMaximumRma: z.number().finite().min(0).max(1).optional() }).strict().optional(),
    validationRecordId: z.string().optional()
  }).strict(),
  z.object({
    kind: z.literal("agar"), id: z.string().min(1), version: z.string().min(1), displayName: z.string().min(1), claimLevel: z.enum(["exploratory", "calibrated_image_measurement", "validated_endpoint"]),
    organismDescription: z.string(), mediumDescription: z.string(), incubationTemperatureC: z.number().finite().optional(), endpointHours: z.number().finite().positive().optional(), spotVolumeDescription: z.string(),
    signalDirection: z.enum(["dark_on_light", "light_on_dark"]), segmentationSigmaMultiplier: z.number().finite().positive(), minimumComponentAreaFraction: z.number().finite().gt(0).lt(1),
    maximumSaturationFraction: z.number().finite().min(0).max(1), minimumRoiPixels: z.number().int().positive(), minimumAnnulusPixels: z.number().int().positive(),
    controlRequirements: controlRequirementsSchema, validationRecordId: z.string().optional()
  }).strict()
]);
const currentAnalysisResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("xtt_96well_mic"), features: z.array(z.object({}).passthrough()), wells: z.array(z.object({}).passthrough()),
    normalization: z.object({}).passthrough(), normalizationGroups: z.array(z.object({}).passthrough()).optional(), micResults: z.array(z.object({}).passthrough()),
    settings: z.object({}).passthrough(), generatedAt: z.string().datetime(), inputWarnings: z.array(z.string()), protocolId: z.string().optional(),
    provenance: provenanceSchema.optional(), qcDecision: qcDecisionSchema.optional()
  }).strict(),
  z.object({
    kind: z.literal("agar_spot_growth"), features: z.array(z.object({}).passthrough()), spots: z.array(z.object({}).passthrough()), summaries: z.array(z.object({}).passthrough()),
    settings: z.object({}).passthrough(), generatedAt: z.string().datetime(), inputWarnings: z.array(z.string()), qc: z.object({}).passthrough(), protocolId: z.string().optional(),
    provenance: provenanceSchema.optional(), qcDecision: qcDecisionSchema.optional()
  }).strict()
]);

const projectEnvelopeSchema = z.object({
  schemaVersion: z.literal(3),
  app: z.literal(PROJECT_APP),
  assayMode: z.enum(["xtt_96well_mic", "agar_spot_growth"]),
  imageMetadata: z.object({
    originalName: z.string().optional(), type: z.string(), width: z.number().int().positive(), height: z.number().int().positive(), size: z.number().int().nonnegative(),
    lastModified: z.number().finite().optional(), source: z.enum(["upload", "camera"]), backgroundClass: z.enum(["unknown", "standard", "black_box"]),
    captureQuality: z.object({}).passthrough().optional(), warnings: z.array(z.string()), warningCodes: z.array(inputWarningSchema)
  }).strict().optional(),
  geometry: z.object({
    anchors: anchorsSchema.optional(),
    confirmed: z.boolean(),
    a1Position: z.enum(["top_left", "top_right", "bottom_left", "bottom_right", "uncertain"]),
    analysisRadiusFactor: z.number().finite().positive(),
    overlayRadiusFactor: z.number().finite().positive(),
    wellAdjustments: z.record(z.string(), pointSchema),
    spotGrid: spotGridSchema.optional(),
    agarOrientationConfirmed: z.boolean().optional(),
    confirmationFingerprint: z.string().optional()
  }).strict(),
  roiMap: z.array(z.unknown()),
  analysisSettings: z.unknown(),
  analysisResult: currentAnalysisResultSchema.optional(),
  historicalAnalysisResult: z.unknown().optional(),
  qcFlags: z.array(z.string()),
  inputWarnings: z.array(inputWarningSchema),
  protocolSnapshot: protocolSnapshotSchema,
  provenance: provenanceSchema,
  qcDecision: qcDecisionSchema
}).strict();

export function buildProjectFile(params: BuildProjectParams): ProjectFile {
  const assayMode = params.assayMode ?? params.analysis?.kind ?? "xtt_96well_mic";
  const protocolSnapshot = params.protocolSnapshot ?? defaultProtocol(assayMode);
  const inputWarnings = params.imageMetadata?.warningCodes ?? params.analysis?.inputWarnings ?? [];
  const decision = params.qcDecision ?? warningDecision(inputWarnings);
  const provenance = params.provenance ?? defaultProvenance(protocolSnapshot, "computed_from_current_pixels");
  const base = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    app: PROJECT_APP,
    assayMode,
    imageMetadata: sanitizeImageMetadata(params.imageMetadata),
    geometry: params.geometry,
    qcFlags: params.qcFlags,
    inputWarnings,
    protocolSnapshot,
    provenance,
    qcDecision: decision
  };

  if (assayMode === "agar_spot_growth") {
    return validateV3({
      ...base,
      assayMode,
      roiMap: params.spotMap ?? [],
      analysisSettings: (params.analysisSettings ?? params.analysis?.settings ?? {}) as AgarSpotAnalysisSettings,
      analysisResult: params.analysis?.kind === "agar_spot_growth" ? params.analysis : undefined
    });
  }

  return validateV3({
    ...base,
    assayMode: "xtt_96well_mic",
    roiMap: params.plateMap ?? [],
    analysisSettings: (params.analysisSettings ?? params.analysis?.settings ?? { threshold: 0.1 }) as AnalysisSettings,
    analysisResult: params.analysis?.kind === "xtt_96well_mic" ? params.analysis : undefined
  });
}

export function parseProjectFile(json: string): ProjectFile {
  const raw: unknown = JSON.parse(json);
  rejectSensitiveKeys(raw);
  const header = z.object({ app: z.string(), schemaVersion: z.number().int() }).passthrough().parse(raw);
  if (header.app === "MICVision" && header.schemaVersion === 1) {
    return migrateLegacyV1(raw as LegacyProjectFileV1);
  }
  if ((header.app === PROJECT_APP || header.app === LEGACY_PROJECT_APP_V2) && header.schemaVersion === 2) {
    return migrateLegacyV2(raw as LegacyProjectFileV2);
  }
  if (header.app !== PROJECT_APP || header.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    throw new Error("This is not a supported AssayLens project JSON file.");
  }
  const project = validateV3(raw);
  const importedProvenance: ResultProvenance = {
    ...project.provenance,
    origin: "imported_v3_unverified",
    claimLevel: "exploratory",
    calibrationStatus: project.provenance.calibrationStatus === "failed" ? "failed" : "missing"
  };
  const importedDecision: QcDecision = {
    ...project.qcDecision,
    canReport: false,
    maximumClaimLevel: "exploratory",
    issues: [
      ...project.qcDecision.issues,
      {
        code: "imported_result_unverified",
        severity: "warning",
        scope: "run",
        message: "Imported results were not recomputed from source pixels in this session."
      }
    ]
  };
  return {
    ...project,
    protocolSnapshot: { ...project.protocolSnapshot, claimLevel: "exploratory", validationRecordId: undefined },
    provenance: importedProvenance,
    analysisResult: project.analysisResult ? { ...project.analysisResult, provenance: importedProvenance, qcDecision: importedDecision } : undefined,
    qcDecision: importedDecision
  } as ProjectFile;
}

export function downloadText(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function migrateLegacyV1(parsed: LegacyProjectFileV1): ProjectFile {
  if (!parsed.geometry || !Array.isArray(parsed.plateMap)) {
    throw new Error("Project JSON is missing geometry or plate-map data.");
  }
  const historicalAnalysisResult =
    parsed.perWellFeatures && parsed.wellAnalysis && parsed.normalizationReferences && parsed.micResults
      ? {
          kind: "xtt_96well_mic" as const,
          features: parsed.perWellFeatures,
          wells: parsed.wellAnalysis,
          normalization: parsed.normalizationReferences,
          micResults: parsed.micResults,
          settings: parsed.analysisSettings,
          generatedAt: parsed.analysisGeneratedAt ?? new Date(0).toISOString(),
          inputWarnings: parsed.inputWarnings ?? parsed.imageMetadata?.warningCodes ?? []
        }
      : undefined;
  return legacyEnvelope({
    assayMode: "xtt_96well_mic",
    imageMetadata: parsed.imageMetadata,
    geometry: parsed.geometry,
    roiMap: parsed.plateMap,
    analysisSettings: parsed.analysisSettings ?? { threshold: 0.1 },
    historicalAnalysisResult,
    qcFlags: parsed.qcFlags,
    inputWarnings: parsed.inputWarnings
  });
}

function migrateLegacyV2(parsed: LegacyProjectFileV2): ProjectFile {
  if (!parsed.geometry) {
    throw new Error("Project JSON is missing geometry data.");
  }
  const assayMode = parsed.assayMode ?? "xtt_96well_mic";
  const roiMap = parsed.roiMap ?? parsed.plateMap;
  if (!Array.isArray(roiMap)) {
    throw new Error("Project JSON is missing ROI-map data.");
  }
  return legacyEnvelope({
    assayMode,
    imageMetadata: parsed.imageMetadata,
    geometry: parsed.geometry,
    roiMap,
    analysisSettings: parsed.analysisSettings,
    historicalAnalysisResult: parsed.analysisResult,
    qcFlags: parsed.qcFlags,
    inputWarnings: parsed.inputWarnings
  });
}

function legacyEnvelope(params: {
  assayMode: AssayMode;
  imageMetadata?: ProjectImageMetadata;
  geometry: GeometryState;
  roiMap: PlateMapCell[] | SpotMapCell[];
  analysisSettings: AnalysisSettings | AgarSpotAnalysisSettings;
  historicalAnalysisResult?: AnalysisResult;
  qcFlags?: string[];
  inputWarnings?: InputWarningCode[];
}): ProjectFile {
  const protocolSnapshot = defaultProtocol(params.assayMode);
  const issue = {
    code: "legacy_import_unverified",
    severity: "warning" as const,
    scope: "run" as const,
    message: "Legacy results and control semantics require review before recomputation."
  };
  const base = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    app: PROJECT_APP,
    assayMode: params.assayMode,
    imageMetadata: defaultImageMetadata(params.imageMetadata),
    geometry: params.geometry,
    qcFlags: params.qcFlags ?? [],
    inputWarnings: params.inputWarnings ?? params.imageMetadata?.warningCodes ?? [],
    protocolSnapshot,
    provenance: defaultProvenance(protocolSnapshot, "legacy_import_unverified"),
    qcDecision: buildQcDecision([issue]),
    historicalAnalysisResult: params.historicalAnalysisResult,
    analysisSettings: params.analysisSettings,
    roiMap: params.assayMode === "xtt_96well_mic" ? migrateLegacyPlateMap(params.roiMap as PlateMapCell[]) : params.roiMap
  };
  return validateV3(base);
}

function validateV3(raw: unknown): ProjectFile {
  const parsed = projectEnvelopeSchema.parse(raw) as unknown as ProjectFile;
  if (parsed.assayMode === "xtt_96well_mic") {
    if (parsed.roiMap.length !== 96) throw new Error("XTT project ROI map must contain exactly 96 wells.");
    parsed.roiMap = z.array(plateMapCellSchema).length(96).parse(parsed.roiMap);
    parsed.analysisSettings = z.object({ threshold: z.number().finite().gt(0).lt(1), selectedMetric: z.enum(["orangeChromaticity", "yellowOrangeLab", "pseudoODBlue", "pseudoODGreenBlue", "hsvS"]).optional() }).strict().parse(parsed.analysisSettings);
  } else {
    parsed.roiMap = z.array(spotMapCellSchema).min(1).parse(parsed.roiMap);
    parsed.analysisSettings = z.object({ referenceControlGroupId: z.string().optional(), dilutionOverride: z.number().int().nonnegative().optional(), selectedDilutionIndex: z.number().int().nonnegative().optional(), suggestedDilutionIndex: z.number().int().nonnegative().optional(), nearBackgroundDensity: z.number().finite().optional(), highCvThreshold: z.number().finite().optional(), saturationClippedFraction: z.number().finite().optional(), overgrownDensity: z.number().finite().optional() }).strict().parse(parsed.analysisSettings);
  }
  if (parsed.analysisResult && parsed.analysisResult.kind !== parsed.assayMode) throw new Error("Analysis-result discriminant does not match the project assay mode.");
  if (parsed.historicalAnalysisResult && parsed.historicalAnalysisResult.kind !== parsed.assayMode) throw new Error("Historical-result discriminant does not match the project assay mode.");
  if (parsed.provenance.protocolId !== parsed.protocolSnapshot.id || parsed.provenance.protocolVersion !== parsed.protocolSnapshot.version) throw new Error("Project provenance does not match its protocol snapshot.");
  validateRoiMap(parsed);
  if (parsed.protocolSnapshot.kind === "xtt" && parsed.assayMode !== "xtt_96well_mic") {
    throw new Error("XTT protocol is incompatible with the selected assay mode.");
  }
  if (parsed.protocolSnapshot.kind === "agar" && parsed.assayMode !== "agar_spot_growth") {
    throw new Error("Agar protocol is incompatible with the selected assay mode.");
  }
  return parsed;
}

function migrateLegacyPlateMap(cells: PlateMapCell[]): PlateMapCell[] {
  return cells.map((cell) => {
    const legacyRole = (cell as unknown as { role?: string }).role;
    const role = legacyRole === "blank_low_signal" ? "legacy_unresolved_blank" : legacyRole === "growth_control_high_signal" ? "growth_control" : legacyRole;
    return { ...cell, role: role as PlateMapCell["role"], compoundId: cell.compoundId ?? "", sampleId: cell.sampleId ?? "", unit: cell.unit ?? "", normalizationGroupId: cell.normalizationGroupId ?? "", biologicalReplicateId: cell.biologicalReplicateId ?? "", technicalReplicateId: cell.technicalReplicateId ?? "", usesVehicleControl: cell.usesVehicleControl ?? false };
  });
}

function validateRoiMap(project: ProjectFile): void {
  if (project.assayMode === "xtt_96well_mic") {
    if (project.roiMap.length !== 96) {
      throw new Error("XTT project ROI map must contain exactly 96 wells.");
    }
    const wells = new Set((project.roiMap as PlateMapCell[]).map((cell) => cell.well));
    if (wells.size !== 96) {
      throw new Error("XTT project ROI map contains duplicate or missing well IDs.");
    }
  } else if (project.roiMap.length === 0) {
    throw new Error("Agar project ROI map cannot be empty.");
  }
}

function defaultProtocol(assayMode: AssayMode): AssayProtocol {
  return assayMode === "agar_spot_growth" ? EXPLORATORY_AGAR_PROTOCOL : EXPLORATORY_XTT_PROTOCOL;
}

function defaultProvenance(protocol: AssayProtocol, origin: ResultProvenance["origin"]): ResultProvenance {
  return {
    origin,
    claimLevel: "exploratory",
    appVersion: APP_VERSION,
    algorithmVersion: ALGORITHM_VERSION,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    protocolId: protocol.id,
    protocolVersion: protocol.version,
    calibrationStatus: origin === "computed_from_current_pixels" ? "not_requested" : "missing"
  };
}

function warningDecision(codes: InputWarningCode[]): QcDecision {
  return buildQcDecision(codes.map((code) => ({
    code,
    severity: "warning" as const,
    scope: "run" as const,
    message: `Input warning: ${code}`
  })));
}

function sanitizeImageMetadata(metadata?: ImageMetadata): ProjectImageMetadata | undefined {
  if (!metadata) return undefined;
  return {
    originalName: metadata.name,
    type: metadata.type,
    width: metadata.width,
    height: metadata.height,
    size: metadata.size,
    lastModified: metadata.lastModified,
    source: metadata.source,
    backgroundClass: metadata.backgroundClass,
    captureQuality: metadata.captureQuality,
    warnings: metadata.warnings,
    warningCodes: metadata.warningCodes
  };
}

function defaultImageMetadata(metadata?: ProjectImageMetadata): ProjectImageMetadata | undefined {
  if (!metadata) return undefined;
  return {
    ...metadata,
    source: metadata.source ?? "upload",
    backgroundClass: metadata.backgroundClass ?? "unknown",
    warnings: metadata.warnings ?? [],
    warningCodes: metadata.warningCodes ?? []
  };
}

function rejectSensitiveKeys(value: unknown, path = "project"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectSensitiveKeys(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    const normalized = key.toLowerCase();
    if (["path", "filepath", "sha256", "file_id", "apikey", "api_key"].includes(normalized)) {
      throw new Error(`Project JSON contains prohibited private field at ${path}.${key}.`);
    }
    rejectSensitiveKeys(nested, `${path}.${key}`);
  }
}
