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

type BuildProjectParams = {
  assayMode?: AssayMode;
  imageMetadata?: ImageMetadata;
  geometry: GeometryState;
  plateMap?: PlateMapCell[];
  spotMap?: SpotMapCell[];
  analysis?: AnalysisResult;
  analysisSettings?: AnalysisSettings | AgarSpotAnalysisSettings;
  qcFlags: string[];
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

type LegacyProjectFileV2 = Omit<ProjectFile, "app"> & {
  app: "XTT_Vision";
};

const PROJECT_APP = "AssayLens" as const;
const LEGACY_PROJECT_APP_V2 = "XTT_Vision" as const;

export function buildProjectFile(params: BuildProjectParams): ProjectFile {
  const assayMode = params.assayMode ?? params.analysis?.kind ?? "xtt_96well_mic";
  const base = {
    schemaVersion: 2 as const,
    app: PROJECT_APP,
    assayMode,
    imageMetadata: sanitizeImageMetadata(params.imageMetadata),
    geometry: params.geometry,
    qcFlags: params.qcFlags,
    inputWarnings: params.imageMetadata?.warningCodes ?? params.analysis?.inputWarnings ?? []
  };

  if (assayMode === "agar_spot_growth") {
    return {
      ...base,
      assayMode,
      roiMap: params.spotMap ?? [],
      analysisSettings: (params.analysisSettings ?? params.analysis?.settings ?? {}) as AgarSpotAnalysisSettings,
      analysisResult: params.analysis?.kind === "agar_spot_growth" ? params.analysis : undefined
    };
  }

  return {
    ...base,
    assayMode: "xtt_96well_mic",
    roiMap: params.plateMap ?? [],
    analysisSettings: (params.analysisSettings ?? params.analysis?.settings ?? { threshold: 0.1 }) as AnalysisSettings,
    analysisResult: params.analysis?.kind === "xtt_96well_mic" ? params.analysis : undefined
  };
}

export function parseProjectFile(json: string): ProjectFile {
  const parsed = JSON.parse(json) as Partial<ProjectFile> | Partial<LegacyProjectFileV1> | Partial<LegacyProjectFileV2>;
  if (parsed.app === "MICVision" && parsed.schemaVersion === 1) {
    return migrateLegacyProject(parsed as LegacyProjectFileV1);
  }
  if ((parsed.app !== PROJECT_APP && parsed.app !== LEGACY_PROJECT_APP_V2) || parsed.schemaVersion !== 2) {
    throw new Error("This is not an AssayLens project JSON file.");
  }
  if (!parsed.geometry || !Array.isArray((parsed as ProjectFile).roiMap)) {
    throw new Error("Project JSON is missing geometry or ROI-map data.");
  }

  const project = parsed as ProjectFile | LegacyProjectFileV2;
  return {
    ...project,
    app: PROJECT_APP,
    imageMetadata: defaultImageMetadata(project.imageMetadata),
    qcFlags: project.qcFlags ?? [],
    inputWarnings: project.inputWarnings ?? project.imageMetadata?.warningCodes ?? []
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

function migrateLegacyProject(parsed: LegacyProjectFileV1): ProjectFile {
  if (!parsed.geometry || !Array.isArray(parsed.plateMap)) {
    throw new Error("Project JSON is missing geometry or plate-map data.");
  }
  const analysisResult =
    parsed.perWellFeatures && parsed.wellAnalysis && parsed.normalizationReferences && parsed.micResults
      ? {
          kind: "xtt_96well_mic" as const,
          features: parsed.perWellFeatures,
          wells: parsed.wellAnalysis,
          normalization: parsed.normalizationReferences,
          micResults: parsed.micResults,
          settings: parsed.analysisSettings,
          generatedAt: parsed.analysisGeneratedAt ?? new Date().toISOString(),
          inputWarnings: parsed.inputWarnings ?? parsed.imageMetadata?.warningCodes ?? []
        }
      : undefined;

  return {
    schemaVersion: 2,
    app: PROJECT_APP,
    assayMode: "xtt_96well_mic",
    imageMetadata: defaultImageMetadata(parsed.imageMetadata),
    geometry: parsed.geometry,
    roiMap: parsed.plateMap,
    analysisSettings: parsed.analysisSettings ?? { threshold: 0.1 },
    analysisResult,
    qcFlags: parsed.qcFlags ?? [],
    inputWarnings: parsed.inputWarnings ?? parsed.imageMetadata?.warningCodes ?? []
  };
}

function sanitizeImageMetadata(metadata?: ImageMetadata): ProjectImageMetadata | undefined {
  if (!metadata) {
    return undefined;
  }
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
  if (!metadata) {
    return undefined;
  }
  return {
    ...metadata,
    source: metadata.source ?? "upload",
    backgroundClass: metadata.backgroundClass ?? "unknown",
    warnings: metadata.warnings ?? [],
    warningCodes: metadata.warningCodes ?? []
  };
}
