import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseWellName } from "../core/geometry/plateGrid";
import { createEmptyPlateMap } from "../core/plateMap/plateMapTypes";
import { assignControlsAtomic } from "../core/plateMap/assignControls";
import { configureXttSeriesAtomic } from "../core/plateMap/configureXttSeries";
import { reviewReason, selectHighestQcPriority } from "../core/analysis/reviewSelection";
import { runImageAnalysisWorker } from "../core/analysis/runImageAnalysisWorker";
import type { AnalysisResult, MicResult } from "../core/types";
import {
  XTT_WEBMCP_SCIENTIFIC_CONTEXT,
  assignControlsSchema,
  configureSeriesSchema,
  focusReviewSchema,
  truncate
} from "./contracts";
import { ASSAYLENS_TOOL_CATALOG, ASSAYLENS_TOOL_NAMES } from "./registerAssayLensTools";

function result(status: MicResult["status"], warnings: string[] = [], excludedWellIds: string[] = []): MicResult {
  return {
    compoundId: status,
    sampleId: "sample",
    unit: "ug/mL",
    threshold: 0.1,
    observedMicLabel: "exploratory",
    isotonicMicLabel: "advisory",
    status,
    concentrations: [{
      concentration: 1,
      medianViability: 0.5,
      isotonicViability: 0.5,
      replicateCount: 2,
      biologicalCount: 2,
      technicalCount: 2,
      biologicalIqr: 0,
      biologicalValues: [0.5, 0.5],
      excludedWellIds,
      isotonicAdjusted: false
    }],
    warnings
  };
}

const baseSeries = {
  startWell: "A1",
  direction: "right" as const,
  compoundId: "Demo Extract A",
  sampleId: "Test organism",
  startConcentration: 128,
  dilutionFactor: 2,
  doseCount: 8,
  replicateCount: 2,
  unit: "ug/mL",
  normalizationGroupId: "Demo-1",
  usesVehicleControl: false,
  overwrite: false
};

describe("parseWellName", () => {
  it("parses corners and lowercase input", () => {
    expect(parseWellName("A1")).toEqual({ row: 0, col: 0 });
    expect(parseWellName(" h12 ")).toEqual({ row: 7, col: 11 });
  });

  it.each(["A0", "I1", "A13", "well", "", "A1x"])('rejects %s', (value) => {
    expect(() => parseWellName(value)).toThrow();
  });
});

describe("configureXttSeriesAtomic", () => {
  it("creates the documented A1 right, eight-dose, two-row series", () => {
    const configured = configureXttSeriesAtomic(createEmptyPlateMap(), baseSeries);
    expect(configured.changedWells).toEqual([
      "A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8",
      "B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8"
    ]);
    const a1 = configured.plateMap.find((cell) => cell.well === "A1")!;
    const a8 = configured.plateMap.find((cell) => cell.well === "A8")!;
    const b1 = configured.plateMap.find((cell) => cell.well === "B1")!;
    expect(a1).toMatchObject({ concentration: 128, biologicalReplicateId: "Bio-1", technicalReplicateId: "A1" });
    expect(a8.concentration).toBe(1);
    expect(b1.biologicalReplicateId).toBe("Bio-2");
  });

  it("supports leftward horizontal dilution", () => {
    const configured = configureXttSeriesAtomic(createEmptyPlateMap(), {
      ...baseSeries,
      startWell: "C12",
      direction: "left",
      doseCount: 3,
      replicateCount: 2
    });
    expect(configured.changedWells).toEqual(["C12", "C11", "C10", "D12", "D11", "D10"]);
  });

  it("rejects bounds and collisions without mutating the source map", () => {
    const map = createEmptyPlateMap();
    const snapshot = JSON.stringify(map);
    expect(() => configureXttSeriesAtomic(map, { ...baseSeries, startWell: "H1", replicateCount: 2 })).toThrow(/outside/);
    expect(JSON.stringify(map)).toBe(snapshot);

    map[0] = { ...map[0], role: "growth_control", normalizationGroupId: "G" };
    const collisionSnapshot = JSON.stringify(map);
    expect(() => configureXttSeriesAtomic(map, baseSeries)).toThrow(/already assigned/);
    expect(JSON.stringify(map)).toBe(collisionSnapshot);
  });

  it("guards compound/sample identity across normalization groups but allows deliberate replacement of the same target series", () => {
    const foreign = createEmptyPlateMap();
    foreign[95] = {
      ...foreign[95],
      role: "sample",
      compoundId: baseSeries.compoundId,
      sampleId: baseSeries.sampleId,
      concentration: 4,
      unit: "ug/mL",
      normalizationGroupId: "Other",
      biologicalReplicateId: "Bio-8",
      technicalReplicateId: "H12"
    };
    expect(() => configureXttSeriesAtomic(foreign, baseSeries)).toThrow(/different normalization group/);

    const first = configureXttSeriesAtomic(createEmptyPlateMap(), { ...baseSeries, normalizationGroupId: "Old" });
    const replaced = configureXttSeriesAtomic(first.plateMap, {
      ...baseSeries,
      normalizationGroupId: "Demo-1",
      overwrite: true
    });
    expect(replaced.plateMap.find((cell) => cell.well === "A1")?.normalizationGroupId).toBe("Demo-1");
  });

  it.each(["ug/mL", "mg/L", "mg/mL", "g/L"])('preserves supported unit %s', (unit) => {
    const configured = configureXttSeriesAtomic(createEmptyPlateMap(), { ...baseSeries, doseCount: 2, replicateCount: 1, unit });
    expect(configured.plateMap.find((cell) => cell.well === "A1")?.unit).toBe(unit);
  });
});

describe("assignControlsAtomic", () => {
  it("assigns multiple roles atomically", () => {
    const next = assignControlsAtomic(createEmptyPlateMap(), {
      assignments: [
        { role: "growth_control", wells: ["H1", "H2"], normalizationGroupId: "Demo-1" },
        { role: "reagent_blank", wells: ["H3", "H4"], normalizationGroupId: "Demo-1" }
      ],
      overwrite: false
    });
    expect(next.changedWells).toEqual(["H1", "H2", "H3", "H4"]);
    expect(next.plateMap.find((cell) => cell.well === "H1")?.role).toBe("growth_control");
    expect(next.plateMap.find((cell) => cell.well === "H3")?.role).toBe("reagent_blank");
  });

  it("rejects duplicate targets and occupied non-unused collisions", () => {
    expect(() => assignControlsAtomic(createEmptyPlateMap(), {
      assignments: [
        { role: "growth_control", wells: ["H1"], normalizationGroupId: "G" },
        { role: "reagent_blank", wells: ["H1"], normalizationGroupId: "G" }
      ], overwrite: false
    })).toThrow(/Duplicate/);

    const occupied = createEmptyPlateMap();
    occupied[0] = { ...occupied[0], role: "sample" };
    expect(() => assignControlsAtomic(occupied, {
      assignments: [{ role: "growth_control", wells: ["A1"], normalizationGroupId: "G" }], overwrite: false
    })).toThrow(/already assigned/);
  });

  it("unused clears the complete stale assignment shape", () => {
    const map = createEmptyPlateMap();
    map[0] = {
      ...map[0],
      role: "sample",
      compoundId: "X",
      sampleId: "Y",
      concentration: 4,
      unit: "ug/mL",
      normalizationGroupId: "G",
      biologicalReplicateId: "B",
      technicalReplicateId: "T",
      notes: "old"
    };
    const next = assignControlsAtomic(map, { assignments: [{ role: "unused", wells: ["A1"] }], overwrite: false });
    expect(next.plateMap[0]).toEqual(createEmptyPlateMap()[0]);
  });
});

describe("review selection", () => {
  it("uses the exact deterministic priority and fallback", () => {
    const routine = result("in_range");
    const warning = result("in_range", ["warning"]);
    const excluded = result("in_range", [], ["B5"]);
    const nonMonotonic = result("non_monotonic_indeterminate");
    const missing = result("indeterminate_missing_data");
    const failed = result("qc_failed");
    expect(selectHighestQcPriority([routine, warning, excluded, nonMonotonic, missing, failed])).toBe(failed);
    expect(selectHighestQcPriority([routine, warning, excluded, nonMonotonic, missing])).toBe(missing);
    expect(selectHighestQcPriority([routine, warning, excluded, nonMonotonic])).toBe(nonMonotonic);
    expect(selectHighestQcPriority([routine, warning, excluded])).toBe(excluded);
    expect(selectHighestQcPriority([routine, warning])).toBe(warning);
    expect(selectHighestQcPriority([routine])).toBe(routine);
    expect(reviewReason(excluded)).toContain("B5");
  });

  it("caps a long excluded-well reason for the visible review banner", () => {
    const excluded = result("in_range", [], ["A1", "A2", "A3", "A4", "A5", "A6", "A7"]);
    expect(reviewReason(excluded)).toContain("+1 more");
  });
});

describe("tool catalog and runtime schemas", () => {
  it("exposes exactly five unique tools with the required annotations", () => {
    expect(ASSAYLENS_TOOL_NAMES).toHaveLength(5);
    expect(new Set(ASSAYLENS_TOOL_NAMES).size).toBe(5);
    expect(ASSAYLENS_TOOL_NAMES).toEqual(expect.arrayContaining([
      "inspect_xtt_workflow",
      "configure_xtt_series",
      "assign_xtt_controls",
      "run_xtt_analysis",
      "focus_xtt_review"
    ]));
    expect(ASSAYLENS_TOOL_CATALOG.inspect.annotations).toEqual({ readOnlyHint: true, untrustedContentHint: true });
    for (const tool of Object.values(ASSAYLENS_TOOL_CATALOG).filter((tool) => tool.name !== "inspect_xtt_workflow")) {
      expect(tool.annotations.readOnlyHint).toBe(false);
      expect(tool.annotations.untrustedContentHint).toBe(true);
    }
  });

  it("sets additionalProperties false for every object schema", () => {
    for (const tool of Object.values(ASSAYLENS_TOOL_CATALOG)) assertClosedObjectSchemas(tool.inputSchema);
  });

  it("rejects unknown runtime input fields and legacy control roles", () => {
    expect(configureSeriesSchema.safeParse({ ...baseSeries, surprise: true }).success).toBe(false);
    expect(assignControlsSchema.safeParse({ assignments: [{ role: "legacy_unresolved_blank", wells: ["A1"] }] }).success).toBe(false);
    expect(focusReviewSchema.safeParse({ mode: "highest_qc_priority", compoundId: "extra" }).success).toBe(false);
  });
});

describe("scientific envelope and output budgets", () => {
  it("retains the fixed exploratory scientific context", () => {
    expect(XTT_WEBMCP_SCIENTIFIC_CONTEXT).toEqual({
      claimLevel: "exploratory",
      measurement: "image-derived relative metabolic activity",
      limitations: [
        "Not a calibrated plate-reader absorbance measurement",
        "Not a direct viable-cell count",
        "Not a validated MIC or efficacy determination",
        "Requires human review of image quality, geometry, controls, and QC"
      ]
    });
  });

  it("reports count and truncation when capping lists", () => {
    expect(truncate([1, 2, 3], 2)).toEqual({ items: [1, 2], count: 3, truncated: true });
  });
});

describe("runImageAnalysisWorker", () => {
  const originalWorker = globalThis.Worker;

  beforeEach(() => {
    FakeWorker.instances = [];
    globalThis.Worker = FakeWorker as unknown as typeof Worker;
  });

  afterEach(() => {
    globalThis.Worker = originalWorker;
  });

  it("does not resolve early and cleans up after completion", async () => {
    const onWorker = vi.fn();
    let settled = false;
    const promise = runImageAnalysisWorker({ type: "analyze" } as never, undefined, onWorker)
      .finally(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    const worker = FakeWorker.instances[0];
    const complete = { kind: "xtt_96well_mic" } as AnalysisResult;
    worker.onmessage?.({ data: { type: "complete", result: complete } } as MessageEvent);
    await expect(promise).resolves.toBe(complete);
    expect(worker.terminated).toBe(true);
    expect(onWorker).toHaveBeenLastCalledWith(null);
  });

  it("rejects worker errors and terminates the worker", async () => {
    const promise = runImageAnalysisWorker({ type: "analyze" } as never);
    const worker = FakeWorker.instances[0];
    worker.onerror?.({ message: "worker failed" } as ErrorEvent);
    await expect(promise).rejects.toThrow("worker failed");
    expect(worker.terminated).toBe(true);
  });

  it("observes AbortSignal cancellation and terminates the worker", async () => {
    const controller = new AbortController();
    const promise = runImageAnalysisWorker({ type: "analyze" } as never, controller.signal);
    const worker = FakeWorker.instances[0];
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.terminated).toBe(true);
  });
});

function assertClosedObjectSchemas(schema: unknown): void {
  if (!schema || typeof schema !== "object") return;
  const value = schema as Record<string, unknown>;
  if (value.type === "object") {
    expect(value.additionalProperties).toBe(false);
    const properties = value.properties as Record<string, unknown> | undefined;
    for (const child of Object.values(properties ?? {})) assertClosedObjectSchemas(child);
  }
  if (value.items) assertClosedObjectSchemas(value.items);
}

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  posted: unknown[] = [];

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(message: unknown) {
    this.posted.push(message);
  }

  terminate() {
    this.terminated = true;
  }
}
