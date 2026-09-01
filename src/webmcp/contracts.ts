import { z } from "zod";
import type { PlateMapValidation } from "../core/plateMap/plateMapValidation";
import type { AnalysisResult, AssayMode, GeometryState } from "../core/types";
import type { LoadedImage } from "../core/image/imageLoader";
import type { PlateMapCell, WellRole } from "../core/plateMap/plateMapTypes";
import type { WorkflowStep } from "../app/routes";

export const XTT_WEBMCP_SCIENTIFIC_CONTEXT = {
  claimLevel: "exploratory",
  measurement: "image-derived relative metabolic activity",
  limitations: [
    "Not a calibrated plate-reader absorbance measurement",
    "Not a direct viable-cell count",
    "Not a validated MIC or efficacy determination",
    "Requires human review of image quality, geometry, controls, and QC"
  ]
} as const;

const boundedText = z.string().trim().min(1).max(80);
export const configureSeriesSchema = z.object({
  startWell: z.string().trim(),
  direction: z.enum(["right", "left"]),
  compoundId: boundedText,
  sampleId: boundedText,
  startConcentration: z.number().finite().positive(),
  dilutionFactor: z.number().finite().gt(1),
  doseCount: z.number().int().min(2).max(12),
  replicateCount: z.number().int().min(1).max(4),
  unit: z.enum(["ug/mL", "mg/L", "mg/mL", "g/L"]),
  normalizationGroupId: boundedText,
  usesVehicleControl: z.boolean().default(false),
  overwrite: z.boolean().default(false)
}).strict();
export type ConfigureSeriesInput = z.infer<typeof configureSeriesSchema>;

export const controlRoleSchema = z.enum([
  "growth_control",
  "reagent_blank",
  "vehicle_control",
  "sterility_control",
  "positive_inhibition_control",
  "unused"
]);
export type AssignableControlRole = z.infer<typeof controlRoleSchema>;

export const assignControlsSchema = z.object({
  assignments: z.array(z.object({
    role: controlRoleSchema,
    wells: z.array(z.string().trim()).min(1).max(96),
    normalizationGroupId: z.string().trim().max(80).optional(),
    vehicleLabel: z.string().trim().max(80).optional(),
    vehicleConcentration: z.number().finite().nonnegative().optional(),
    vehicleUnit: z.enum(["ug/mL", "mg/L", "mg/mL", "g/L"]).optional()
  }).strict()).min(1).max(12),
  overwrite: z.boolean().default(false)
}).strict();
export type AssignControlsInput = z.infer<typeof assignControlsSchema>;

export const focusReviewSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("highest_qc_priority") }).strict(),
  z.object({ mode: z.literal("series"), compoundId: boundedText, sampleId: boundedText }).strict()
]);
export type FocusReviewInput = z.infer<typeof focusReviewSchema>;

export type ToolFailure = { ok: false; code: string; message: string; blockers?: string[]; conflicts?: string[] };
export type ToolSuccess<T> = { ok: true; data: T };
export type ToolResult<T> = ToolFailure | ToolSuccess<T>;

export type LiveAssayLensState = {
  assayMode: AssayMode;
  step: WorkflowStep;
  image?: LoadedImage;
  geometry: GeometryState;
  plateMap: PlateMapCell[];
  validation: PlateMapValidation;
  analysis?: AnalysisResult;
  runningAnalysis: boolean;
  threshold: number;
};

export type AssayLensSiteApi = {
  inspectWorkflow: () => unknown;
  configureSeries: (input: ConfigureSeriesInput) => unknown;
  assignControls: (input: AssignControlsInput) => unknown;
  runAnalysis: (signal?: AbortSignal) => Promise<unknown>;
  focusReview: (input: FocusReviewInput) => unknown;
};

export function roleCounts(plateMap: PlateMapCell[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const cell of plateMap) counts[cell.role] = (counts[cell.role] ?? 0) + 1;
  return counts;
}

export function truncate<T>(values: T[], limit = 12) {
  return { items: values.slice(0, limit), count: values.length, truncated: values.length > limit };
}

export function isOccupied(cell: PlateMapCell): boolean {
  return cell.role !== "unused";
}

export type AllowedControlRole = Exclude<WellRole, "sample" | "legacy_unresolved_blank">;
