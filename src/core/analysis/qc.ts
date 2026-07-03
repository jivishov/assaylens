import type { AssayMode, GeometryState } from "../types";
import type { PlateMapValidation } from "../plateMap/plateMapValidation";
import { hasCompleteAnchors } from "../geometry/geometryValidation";

export function analysisBlockers(
  geometry: GeometryState,
  plateMapValidation: PlateMapValidation,
  assayMode: AssayMode = "xtt_96well_mic"
): string[] {
  const blockers: string[] = [];
  if (!hasCompleteAnchors(geometry.anchors)) {
    blockers.push(
      assayMode === "agar_spot_growth"
        ? "Confirm the four agar spot grid anchors."
        : "Confirm A1, A12, H12, and H1 anchors."
    );
  }
  if (!geometry.confirmed) {
    blockers.push(assayMode === "agar_spot_growth" ? "Confirm ROIs before analysis." : "Confirm wells before analysis.");
  }
  blockers.push(...plateMapValidation.blockers);
  return blockers;
}
