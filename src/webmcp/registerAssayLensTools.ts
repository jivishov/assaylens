/// <reference types="webmcp-types" />
import { assayLensBridge } from "./assayLensBridge";
import { assignControlsSchema, configureSeriesSchema, focusReviewSchema } from "./contracts";

let registrationController: AbortController | undefined;

function appNotReady() {
  return { ok: false, code: "app_not_ready", message: "AssayLens is still initializing." };
}

function validationFailure(error: unknown) {
  return { ok: false, code: "invalid_input", message: error instanceof Error ? error.message : "Invalid tool input." };
}

export async function registerAssayLensTools(): Promise<void> {
  if (!document.modelContext?.registerTool) return;
  registrationController?.abort();
  registrationController = new AbortController();
  const options = { signal: registrationController.signal };

  await document.modelContext.registerTool({
    name: "inspect_xtt_workflow",
    description: "Inspect AssayLens XTT workflow readiness, plate validation, result status, and exploratory scientific limitations.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async () => assayLensBridge.get()?.inspectWorkflow() ?? appNotReady()
  }, options);

  await document.modelContext.registerTool({
    name: "configure_xtt_series",
    description: "Atomically configure one horizontal XTT serial dilution with adjacent replicate rows. Does not assign controls.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        startWell: { type: "string", description: "Highest-concentration well, A1 through H12." },
        direction: { type: "string", enum: ["right", "left"] },
        compoundId: { type: "string", minLength: 1, maxLength: 80 },
        sampleId: { type: "string", minLength: 1, maxLength: 80 },
        startConcentration: { type: "number", exclusiveMinimum: 0 },
        dilutionFactor: { type: "number", exclusiveMinimum: 1 },
        doseCount: { type: "integer", minimum: 2, maximum: 12 },
        replicateCount: { type: "integer", minimum: 1, maximum: 4 },
        unit: { type: "string", enum: ["ug/mL", "mg/L", "mg/mL", "g/L"] },
        normalizationGroupId: { type: "string", minLength: 1, maxLength: 80 },
        usesVehicleControl: { type: "boolean", default: false },
        overwrite: { type: "boolean", default: false }
      },
      required: ["startWell", "direction", "compoundId", "sampleId", "startConcentration", "dilutionFactor", "doseCount", "replicateCount", "unit", "normalizationGroupId"]
    },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: async (input) => {
      const parsed = configureSeriesSchema.safeParse(input);
      if (!parsed.success) return validationFailure(parsed.error);
      return assayLensBridge.get()?.configureSeries(parsed.data) ?? appNotReady();
    }
  }, options);

  await document.modelContext.registerTool({
    name: "assign_xtt_controls",
    description: "Atomically assign explicit XTT control roles and normalization groups to one or more wells.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        assignments: {
          type: "array", minItems: 1, maxItems: 12,
          items: {
            type: "object", additionalProperties: false,
            properties: {
              role: { type: "string", enum: ["growth_control", "reagent_blank", "vehicle_control", "sterility_control", "positive_inhibition_control", "unused"] },
              wells: { type: "array", minItems: 1, maxItems: 96, items: { type: "string" } },
              normalizationGroupId: { type: "string", maxLength: 80 },
              vehicleLabel: { type: "string", maxLength: 80 },
              vehicleConcentration: { type: "number", minimum: 0 },
              vehicleUnit: { type: "string", enum: ["ug/mL", "mg/L", "mg/mL", "g/L"] }
            }, required: ["role", "wells"]
          }
        }, overwrite: { type: "boolean", default: false }
      }, required: ["assignments"]
    },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: async (input) => {
      const parsed = assignControlsSchema.safeParse(input);
      if (!parsed.success) return validationFailure(parsed.error);
      return assayLensBridge.get()?.assignControls(parsed.data) ?? appNotReady();
    }
  }, options);

  await document.modelContext.registerTool({
    name: "run_xtt_analysis",
    description: "Run the existing exploratory XTT plate-photo analysis after image, geometry, and plate validation are ready.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: async (_input, { signal }) => assayLensBridge.get()?.runAnalysis(signal) ?? appNotReady()
  }, options);

  await document.modelContext.registerTool({
    name: "focus_xtt_review",
    description: "Focus a deterministic XTT dose-response series for human QC review; does not make efficacy or mechanism claims.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        mode: { type: "string", enum: ["highest_qc_priority", "series"] },
        compoundId: { type: "string", minLength: 1, maxLength: 80 },
        sampleId: { type: "string", minLength: 1, maxLength: 80 }
      }, required: ["mode"]
    },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: async (input) => {
      const parsed = focusReviewSchema.safeParse(input);
      if (!parsed.success) return validationFailure(parsed.error);
      return assayLensBridge.get()?.focusReview(parsed.data) ?? appNotReady();
    }
  }, options);
}
