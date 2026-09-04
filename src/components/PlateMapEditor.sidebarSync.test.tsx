import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configureXttSeriesAtomic } from "../core/plateMap/configureXttSeries";
import { createEmptyPlateMap, type PlateMapCell } from "../core/plateMap/plateMapTypes";
import type { PlateMapSidebarSyncTarget } from "../core/plateMap/plateMapSidebarSync";
import { PlateMapEditor } from "./PlateMapEditor";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("PlateMapEditor WebMCP sidebar synchronization", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("displays a WebMCP leftward series in both sidebars and re-applies an unchanged map revision", async () => {
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

    await renderEditor(configured.plateMap, { revision: 1, preferredWells: configured.changedWells });

    expect(host.querySelector(".selected-summary")?.textContent).toBe("30 wells selected");
    expect(inputValue("selection-panel", "Compound ID")).toBe("amoxicillin");
    expect(inputValue("selection-panel", "Concentration")).toBe("500");
    expect(inputValue("serial-dilution-panel", "Compound ID")).toBe("amoxicillin");
    expect(inputValue("serial-dilution-panel", "Start concentration")).toBe("500");
    expect(inputValue("serial-dilution-panel", "Normalization group")).toBe("amoxicillin_series_1");
    expect(inputValue("serial-dilution-panel", "Steps")).toBe("10");
    expect(host.querySelector<HTMLButtonElement>("#serial-dilution-panel-body button[aria-label='Dilute to the left']")?.classList).toContain("active");

    const serialCompound = input("serial-dilution-panel", "Compound ID");
    await act(async () => setInputValue(serialCompound, "stale-draft"));
    expect(serialCompound.value).toBe("stale-draft");

    await renderEditor(configured.plateMap, { revision: 2, preferredWells: configured.changedWells });
    expect(inputValue("serial-dilution-panel", "Compound ID")).toBe("amoxicillin");
  });

  it("synchronizes a clicked dose into Selection while keeping the serial source at the high-dose well", async () => {
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

    await renderEditor(configured.plateMap, { revision: 1, preferredWells: configured.changedWells });

    await act(async () => {
      wellButton("F1").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    expect(host.querySelector(".selected-summary")?.textContent).toBe("1 wells selected");
    expect(inputValue("selection-panel", "Compound ID")).toBe("amoxicillin");
    expect(inputValue("selection-panel", "Concentration")).toBe("0.9765625");
    expect(inputValue("serial-dilution-panel", "Start concentration")).toBe("500");
    expect(host.querySelector(".serial-selection-context")?.textContent).toContain("Selected well F1: 0.9765625 ug/mL.");
    expect(host.querySelector(".serial-selection-context")?.textContent).toContain("Series start: F10 at 500 ug/mL.");
  });

  async function renderEditor(plateMap: PlateMapCell[], sidebarSyncTarget: PlateMapSidebarSyncTarget) {
    await act(async () => {
      root.render(
        <PlateMapEditor
          plateMap={plateMap}
          onPlateMapChange={() => undefined}
          sidebarSyncTarget={sidebarSyncTarget}
        />
      );
    });
  }

  function inputValue(panelId: string, label: string): string {
    return input(panelId, label).value;
  }

  function input(panelId: string, label: string): HTMLInputElement {
    const panel = host.querySelector<HTMLElement>(`#${panelId}-body`);
    if (!panel) throw new Error(`Missing ${panelId}.`);
    const field = [...panel.querySelectorAll<HTMLLabelElement>("label")].find((candidate) =>
      [...candidate.children].some((child) => child.tagName === "SPAN" && child.textContent === label)
    );
    const control = field?.querySelector<HTMLInputElement>("input");
    if (!control) throw new Error(`Missing ${label} in ${panelId}.`);
    return control;
  }

  function wellButton(well: string): HTMLButtonElement {
    const button = [...host.querySelectorAll<HTMLButtonElement>(".map-cell")].find((candidate) =>
      candidate.getAttribute("aria-label")?.startsWith(`${well} `)
    );
    if (!button) throw new Error(`Missing ${well} plate-map button.`);
    return button;
  }

  function setInputValue(control: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("Could not set input value.");
    setter.call(control, value);
    control.dispatchEvent(new Event("input", { bubbles: true }));
  }
});
