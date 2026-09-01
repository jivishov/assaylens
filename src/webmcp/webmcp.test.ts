import { describe, expect, it } from "vitest";
import { parseWellName } from "../core/geometry/plateGrid";
import { createEmptyPlateMap } from "../core/plateMap/plateMapTypes";
import { assignControlsAtomic } from "../core/plateMap/assignControls";
import { reviewReason, selectHighestQcPriority } from "../core/analysis/reviewSelection";
import type { MicResult } from "../core/types";

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

describe("parseWellName", () => {
  it("parses corners and lowercase input", () => {
    expect(parseWellName("A1")).toEqual({ row: 0, col: 0 });
    expect(parseWellName("h12")).toEqual({ row: 7, col: 11 });
  });
  it.each(["A0", "I1", "A13", "well", ""])('rejects %s', (value) => {
    expect(() => parseWellName(value)).toThrow();
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
  it("rejects duplicate targets and occupied collisions", () => {
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
  it("unused clears stale metadata", () => {
    const map = createEmptyPlateMap();
    map[0] = { ...map[0], role: "sample", compoundId: "X", sampleId: "Y", concentration: 4, unit: "ug/mL", normalizationGroupId: "G", biologicalReplicateId: "B", technicalReplicateId: "T" };
    const next = assignControlsAtomic(map, { assignments: [{ role: "unused", wells: ["A1"] }], overwrite: false });
    expect(next.plateMap[0]).toMatchObject({ role: "unused", compoundId: "", sampleId: "", unit: "", normalizationGroupId: "" });
    expect(next.plateMap[0].concentration).toBeUndefined();
  });
});

describe("review selection", () => {
  it("uses the specified deterministic priority", () => {
    const warning = result("in_range", ["warning"]);
    const excluded = result("in_range", [], ["B5"]);
    const nonMonotonic = result("non_monotonic_indeterminate");
    const missing = result("indeterminate_missing_data");
    const failed = result("qc_failed");
    expect(selectHighestQcPriority([warning, excluded, nonMonotonic, missing, failed])).toBe(failed);
    expect(reviewReason(excluded)).toContain("B5");
  });
});
