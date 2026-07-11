import type { MicResult, MicStatus, WellAnalysis } from "../types";
import type { XttProtocol } from "../science/contracts";
import { canonicalizeConcentration } from "../science/concentrationUnits";
import { EXPLORATORY_XTT_PROTOCOL } from "../science/protocols";
import { groupBy, median } from "./statistics";
import { isotonicMic } from "./isotonicMic";

export function calculateMicResults(
  wells: WellAnalysis[],
  threshold: number,
  protocol: XttProtocol = EXPLORATORY_XTT_PROTOCOL
): MicResult[] {
  if (!(threshold > 0 && threshold < 1)) {
    throw new Error("The endpoint threshold must be finite and between 0 and 1.");
  }
  const series = groupBy(
    wells.filter((well) => well.map.role === "sample"),
    (well) => `${well.map.compoundId}||${well.map.sampleId}`
  );
  const results: MicResult[] = [];

  for (const [key, seriesWells] of series) {
    const [compoundId, sampleId] = key.split("||");
    const unit = "ug/mL";
    const converted = seriesWells.map((well) => ({
      well,
      dose: canonicalizeConcentration(well.map.concentration ?? Number.NaN, well.map.unit)
    }));
    const invalidDose = converted.some((entry) => !entry.dose);
    const canonical = converted
      .filter((entry): entry is { well: WellAnalysis; dose: { value: number; unit: "ug/mL" } } => Boolean(entry.dose))
      .map((entry) => ({ well: entry.well, concentration: entry.dose.value }));
    const doseGroups = groupBy(canonical, (entry) => String(entry.concentration));
    const concentrations = [...doseGroups]
      .map(([dose, entries]) => aggregateDose(Number(dose), entries.map((entry) => entry.well)))
      .sort((left, right) => left.concentration - right.concentration);
    const usable = concentrations.filter((point) => Number.isFinite(point.medianViability));
    const requiredConcentrations = (protocol.doseSeriesRules.requiredConcentrations ?? [])
      .map((dose) => canonicalizeConcentration(dose.value, dose.unit)?.value)
      .filter((value): value is number => value != null);
    const missingRequiredDose = requiredConcentrations.some(
      (required) => !concentrations.some((point) => nearlyEqual(point.concentration, required))
    );
    const missingMeasuredDose = concentrations.some((point) => !Number.isFinite(point.medianViability));
    const insufficientDoseCount = concentrations.length < protocol.doseSeriesRules.minimumDosePoints;
    const missingData = invalidDose || missingRequiredDose || missingMeasuredDose || insufficientDoseCount;
    const observed = missingData
      ? { label: "Indeterminate: missing, invalid, or QC-failed dose point", status: "indeterminate_missing_data" as MicStatus }
      : observedEndpoint(usable, threshold);
    const model = isotonicMic(
      usable.map((point) => ({ concentration: point.concentration, medianViability: point.medianViability, replicateCount: 1 })),
      threshold
    );

    results.push({
      compoundId: compoundId || "Unknown compound",
      sampleId: sampleId || "Unknown sample",
      unit,
      threshold,
      observedMic: observed.value,
      isotonicMic: missingData ? undefined : model.value,
      observedMicLabel: appendUnit(observed.label, unit),
      isotonicMicLabel: missingData ? "Indeterminate: missing or QC-failed dose point" : appendUnit(model.label, unit),
      status: observed.status,
      endpointBoundary: observed.boundary,
      concentrations: concentrations.map((point) => {
        const index = usable.findIndex((item) => item.concentration === point.concentration);
        const fit = index >= 0 ? model.fitted[index] ?? point.medianViability : point.medianViability;
        return {
          ...point,
          isotonicViability: fit,
          isotonicAdjusted: Number.isFinite(fit) && Number.isFinite(point.medianViability) && Math.abs(fit - point.medianViability) > 1e-12
        };
      }),
      warnings: endpointWarnings({
        invalidDose,
        missingRequiredDose,
        missingMeasuredDose,
        insufficientDoseCount,
        excluded: concentrations.some((point) => point.excludedWellIds.length > 0)
      })
    });
  }
  return results;
}

function aggregateDose(concentration: number, wells: WellAnalysis[]) {
  const valid = wells.filter(
    (well) => well.qcFlags.length === 0 && Number.isFinite(well.relativeMetabolicActivityRaw ?? well.viability)
  );
  const byBio = groupBy(valid, (well) => well.map.biologicalReplicateId);
  const biologicalValues = [...byBio.values()]
    .map((technical) => median(technical.map((well) => well.relativeMetabolicActivityRaw ?? well.viability)))
    .filter(Number.isFinite);
  const sorted = [...biologicalValues].sort((left, right) => left - right);
  return {
    concentration,
    medianViability: median(biologicalValues),
    replicateCount: biologicalValues.length,
    biologicalCount: biologicalValues.length,
    technicalCount: valid.length,
    biologicalIqr: quantile(sorted, 0.75) - quantile(sorted, 0.25),
    biologicalValues,
    excludedWellIds: wells.filter((well) => !valid.includes(well)).map((well) => well.well)
  };
}

function observedEndpoint(
  points: Array<{ concentration: number; medianViability: number }>,
  threshold: number
): { value?: number; boundary?: number; label: string; status: MicStatus } {
  if (!points.length) return { label: "QC failed", status: "qc_failed" };
  const firstBelow = points.findIndex((point) => point.medianViability <= threshold);
  if (firstBelow < 0) {
    const boundary = points.at(-1)!.concentration;
    return { boundary, label: `>${formatNumber(boundary)}`, status: "gt_max_tested" };
  }
  if (points.slice(firstBelow + 1).some((point) => point.medianViability > threshold)) {
    return { label: "Indeterminate: non-monotonic rebound", status: "non_monotonic_indeterminate" };
  }
  const value = points[firstBelow].concentration;
  return firstBelow === 0
    ? { value, boundary: value, label: `<=${formatNumber(value)}`, status: "le_min_tested" }
    : { value, label: formatNumber(value), status: "in_range" };
}

function quantile(sorted: number[], probability: number): number {
  if (!sorted.length) return Number.NaN;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= Math.max(Math.abs(left), Math.abs(right), 1) * 1e-12;
}

function endpointWarnings(flags: {
  invalidDose: boolean;
  missingRequiredDose: boolean;
  missingMeasuredDose: boolean;
  insufficientDoseCount: boolean;
  excluded: boolean;
}): string[] {
  const warnings: string[] = [];
  if (flags.invalidDose) warnings.push("One or more concentrations were non-positive, non-finite, or used an unsupported unit.");
  if (flags.missingRequiredDose) warnings.push("A protocol-required concentration is missing.");
  if (flags.missingMeasuredDose) warnings.push("At least one declared dose point has no valid biological-level measurement.");
  if (flags.insufficientDoseCount) warnings.push("The dose series contains fewer tested concentrations than the protocol requires.");
  if (flags.excluded) warnings.push("QC-failed wells were excluded before replicate aggregation.");
  return warnings;
}

function appendUnit(label: string, unit: string): string {
  return label.startsWith("Indeterminate") || label === "QC failed" ? label : `${label} ${unit}`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : Number(value.toPrecision(6)).toString();
}
