import type { MicResult, WellAnalysis } from "../types";
import { groupBy, median } from "./statistics";
import { isotonicMic } from "./isotonicMic";

export function calculateMicResults(wells: WellAnalysis[], threshold: number): MicResult[] {
  const sampleWells = wells.filter((well) => well.map.role === "sample");
  const groups = groupBy(sampleWells, (well) => `${well.map.compoundId}||${well.map.sampleId}||${well.map.unit}`);
  const results: MicResult[] = [];

  for (const [key, group] of groups) {
    const [compoundId, sampleId, unit] = key.split("||");
    const concentrationGroups = groupBy(
      group.filter((well) => Number.isFinite(well.map.concentration)),
      (well) => String(well.map.concentration)
    );
    const concentrations = [...concentrationGroups.entries()]
      .map(([concentration, replicateWells]) => ({
        concentration: Number(concentration),
        medianViability: median(replicateWells.map((well) => well.viability).filter(Number.isFinite)),
        replicateCount: replicateWells.length
      }))
      .filter((item) => Number.isFinite(item.concentration) && Number.isFinite(item.medianViability))
      .sort((a, b) => a.concentration - b.concentration);

    const qcFailed = group.some((well) => well.qcFlags.length > 0);
    const observed = qcFailed
      ? { label: "QC failed", status: "qc_failed" as const }
      : observedMic(concentrations, threshold);
    const isotonic = qcFailed
      ? { label: "QC failed", status: "qc_failed" as const, fitted: concentrations.map((item) => item.medianViability) }
      : isotonicMic(concentrations, threshold);

    results.push({
      compoundId: compoundId || "Unknown compound",
      sampleId: sampleId || "Unknown sample",
      unit: unit || "unit",
      threshold,
      observedMic: "value" in observed ? observed.value : undefined,
      isotonicMic: "value" in isotonic ? isotonic.value : undefined,
      observedMicLabel: appendUnit(observed.label, unit),
      isotonicMicLabel: appendUnit(isotonic.label, unit),
      status: observed.status,
      concentrations: concentrations.map((item, index) => ({
        ...item,
        isotonicViability: "fitted" in isotonic ? isotonic.fitted[index] ?? item.medianViability : item.medianViability
      })),
      warnings: qcFailed ? ["One or more wells failed QC for this sample."] : []
    });
  }

  return results;
}

function observedMic(
  concentrations: Array<{ concentration: number; medianViability: number; replicateCount: number }>,
  threshold: number
): { value?: number; label: string; status: "in_range" | ">max_tested" | "<=min_tested" | "indeterminate" } {
  if (concentrations.length === 0) {
    return { label: "Indeterminate", status: "indeterminate" };
  }

  const sorted = [...concentrations].sort((a, b) => a.concentration - b.concentration);
  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index];
    const higher = sorted.slice(index);
    if (current.medianViability <= threshold && higher.every((item) => item.medianViability <= threshold)) {
      if (index === 0) {
        return { value: current.concentration, label: `<=${formatNumber(current.concentration)}`, status: "<=min_tested" };
      }
      return { value: current.concentration, label: formatNumber(current.concentration), status: "in_range" };
    }
  }

  return { label: `>${formatNumber(sorted[sorted.length - 1].concentration)}`, status: ">max_tested" };
}

function appendUnit(label: string, unit: string): string {
  if (label === "Indeterminate" || label === "QC failed") {
    return label;
  }
  return `${label} ${unit || "unit"}`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : Number(value.toPrecision(6)).toString();
}
