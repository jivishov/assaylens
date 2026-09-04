import { describe, expect, it } from "vitest";
import { assignControlsAtomic } from "./assignControls";
import { configureXttSeriesAtomic } from "./configureXttSeries";
import { createEmptyPlateMap } from "./plateMapTypes";
import { derivePlateMapSidebarSync } from "./plateMapSidebarSync";

describe("derivePlateMapSidebarSync", () => {
  it("derives the visible sidebar state from a WebMCP-style horizontal series", () => {
    const configured = configureXttSeriesAtomic(createEmptyPlateMap(), {
      startWell: "F1",
      direction: "right",
      compoundId: "amoxicillin",
      sampleId: "amoxicillin",
      startConcentration: 500,
      dilutionFactor: 2,
      doseCount: 10,
      replicateCount: 3,
      unit: "ug/mL",
      normalizationGroupId: "amoxicillin_series_1",
      usesVehicleControl: false,
      overwrite: false
    });

    const sync = derivePlateMapSidebarSync(configured.plateMap);

    expect(sync?.selectedKeys).toHaveLength(30);
    expect(sync?.selectedKeys).toContain("5:0");
    expect(sync?.selectedKeys).toContain("7:9");
    expect(sync?.selection).toMatchObject({
      role: "sample",
      compoundId: "amoxicillin",
      sampleId: "amoxicillin",
      concentration: "500",
      normalizationGroupId: "amoxicillin_series_1"
    });
    expect(sync?.serial).toMatchObject({
      compoundId: "amoxicillin",
      sampleId: "amoxicillin",
      startConcentration: 500,
      dilutionFactor: 2,
      steps: 10,
      unit: "ug/mL",
      normalizationGroupId: "amoxicillin_series_1",
      biologicalReplicatePrefix: "Bio",
      direction: "right"
    });
  });

  it("synchronizes the selection controls when only controls are assigned", () => {
    const configured = assignControlsAtomic(createEmptyPlateMap(), {
      assignments: [{ role: "growth_control", wells: ["A1", "B1"], normalizationGroupId: "controls" }],
      overwrite: false
    });

    const sync = derivePlateMapSidebarSync(configured.plateMap);

    expect(sync).toMatchObject({
      selectedKeys: ["0:0"],
      selection: { role: "growth_control", normalizationGroupId: "controls" }
    });
    expect(sync?.serial).toBeUndefined();
  });

  it("prioritizes a WebMCP leftward series even when its map values are re-applied", () => {
    const configured = configureXttSeriesAtomic(createEmptyPlateMap(), {
      startWell: "F10",
      direction: "left",
      compoundId: "amoxicillin",
      sampleId: "amoxicillin",
      startConcentration: 500,
      dilutionFactor: 2,
      doseCount: 10,
      replicateCount: 3,
      unit: "ug/mL",
      normalizationGroupId: "amoxicillin_series_1",
      usesVehicleControl: false,
      overwrite: false
    });

    const sync = derivePlateMapSidebarSync(configured.plateMap, { preferredWells: configured.changedWells });

    expect(sync?.selectedKeys).toHaveLength(30);
    expect(sync?.selection).toMatchObject({
      role: "sample",
      concentration: "500",
      technicalReplicateId: "F10"
    });
    expect(sync?.serial).toMatchObject({
      startConcentration: 500,
      dilutionFactor: 2,
      steps: 10,
      direction: "left"
    });
  });

  it("keeps newly assigned controls selected while retaining the configured serial series", () => {
    const series = configureXttSeriesAtomic(createEmptyPlateMap(), {
      startWell: "F10",
      direction: "left",
      compoundId: "amoxicillin",
      sampleId: "amoxicillin",
      startConcentration: 500,
      dilutionFactor: 2,
      doseCount: 10,
      replicateCount: 3,
      unit: "ug/mL",
      normalizationGroupId: "amoxicillin_series_1",
      usesVehicleControl: false,
      overwrite: false
    });
    const controls = assignControlsAtomic(series.plateMap, {
      assignments: [{ role: "growth_control", wells: ["A1", "B1", "C1"], normalizationGroupId: "amoxicillin_series_1" }],
      overwrite: false
    });

    const sync = derivePlateMapSidebarSync(controls.plateMap, { preferredWells: controls.changedWells });

    expect(sync).toMatchObject({
      selectedKeys: ["0:0", "1:0", "2:0"],
      selection: { role: "growth_control", normalizationGroupId: "amoxicillin_series_1" },
      serial: { startConcentration: 500, direction: "left" }
    });
  });
});
