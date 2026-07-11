import type { AssayMode, GeometryState } from "../types";
import type { PlateMapValidation } from "../plateMap/plateMapValidation";
import { hasCompleteAnchors } from "../geometry/geometryValidation";
import { geometryFingerprint } from "../geometry/geometryValidation";
import type { QcDecision, QcIssue } from "../science/contracts";
import { qcDecision } from "../science/contracts";

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
  if (geometry.a1Position === "uncertain") {
    blockers.push("Confirm plate orientation before analysis.");
  }
  if (assayMode === "agar_spot_growth" && !geometry.agarOrientationConfirmed) {
    blockers.push("Confirm logical R1C1 and row/column direction before analysis.");
  }
  if (!geometry.confirmationFingerprint || geometry.confirmationFingerprint !== geometryFingerprint(geometry)) {
    blockers.push("Geometry changed after confirmation; review and confirm the ROIs again.");
  }
  blockers.push(...plateMapValidation.blockers);
  return blockers;
}

export function analysisQcDecision(
  geometry: GeometryState,
  plateMapValidation: PlateMapValidation,
  assayMode: AssayMode = "xtt_96well_mic"
): QcDecision {
  const issues: QcIssue[] = analysisBlockers(geometry, plateMapValidation, assayMode).map((message) => ({
    code: "analysis_blocker",
    severity: "block",
    scope: "run",
    message
  }));
  return qcDecision(issues);
}
