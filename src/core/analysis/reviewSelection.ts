import type { MicResult } from "../types";

export function micResultKey(result: MicResult): string {
  return `${result.compoundId}::${result.sampleId}::${result.unit}`;
}

function priority(result: MicResult): number {
  if (result.status === "qc_failed") return 0;
  if (result.status === "indeterminate_missing_data") return 1;
  if (result.status === "non_monotonic_indeterminate") return 2;
  if (result.concentrations.some((point) => point.excludedWellIds.length > 0)) return 3;
  if (result.warnings.length > 0) return 4;
  return 5;
}

export function selectHighestQcPriority(results: MicResult[]): MicResult | undefined {
  return results.map((result, index) => ({ result, index, p: priority(result) }))
    .sort((a, b) => a.p - b.p || a.index - b.index)[0]?.result;
}

export function reviewReason(result: MicResult): string {
  if (result.status === "qc_failed") return "QC failed";
  if (result.status === "indeterminate_missing_data") return "Missing data makes the endpoint indeterminate";
  if (result.status === "non_monotonic_indeterminate") return "Non-monotonic response requires review";
  const excluded = result.concentrations.flatMap((point) => point.excludedWellIds);
  if (excluded.length) return `Contains excluded wells: ${excluded.join(", ")}`;
  if (result.warnings.length) return result.warnings[0];
  return "Routine human QC review";
}
