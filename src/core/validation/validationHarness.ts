export type ValidationPair = { id: string; partition: "development" | "held_out_validation"; runId: string; imageValue: number; referenceValue: number; excluded?: boolean; endpointDilutionDifference?: number };
export type ValidationManifest = { id: string; protocolId: string; synthetic: boolean; predeclaredAcceptanceLimits?: Record<string, number>; pairs: ValidationPair[] };
export type ValidationSummary = { n: number; excluded: number; meanBias: number; repeatabilitySd: number; limitsOfAgreement: [number, number]; endpointAgreementWithinOneDilution?: number; partitions: Record<string, number>; canEnableValidatedProfile: false };

export function validateManifest(value: ValidationManifest): ValidationManifest {
  if (!value.id?.trim() || !value.protocolId?.trim() || !Array.isArray(value.pairs)) throw new Error("Validation manifest requires IDs and a pairs array.");
  const ids = new Set<string>();
  for (const pair of value.pairs) {
    if (!pair.id?.trim() || ids.has(pair.id)) throw new Error("Validation pair IDs must be non-empty and unique.");
    ids.add(pair.id);
    if (![pair.imageValue, pair.referenceValue].every(Number.isFinite)) throw new Error(`Validation pair ${pair.id} contains a non-finite value.`);
  }
  return value;
}

export function summarizeValidation(manifest: ValidationManifest): ValidationSummary {
  validateManifest(manifest);
  const eligible = manifest.pairs.filter((pair) => !pair.excluded);
  const differences = eligible.map((pair) => pair.imageValue - pair.referenceValue);
  const meanBias = mean(differences), repeatabilitySd = sampleSd(differences), endpoint = eligible.filter((pair) => pair.endpointDilutionDifference != null);
  return {
    n: eligible.length, excluded: manifest.pairs.length - eligible.length, meanBias, repeatabilitySd,
    limitsOfAgreement: [meanBias - 1.96 * repeatabilitySd, meanBias + 1.96 * repeatabilitySd],
    endpointAgreementWithinOneDilution: endpoint.length ? endpoint.filter((pair) => Math.abs(pair.endpointDilutionDifference!) <= 1).length / endpoint.length : undefined,
    partitions: Object.fromEntries(["development", "held_out_validation"].map((partition) => [partition, eligible.filter((pair) => pair.partition === partition).length])),
    // The harness summarizes evidence; enabling a registry entry requires a separate authorized code review.
    canEnableValidatedProfile: false
  };
}
function mean(values: number[]) { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : Number.NaN; }
function sampleSd(values: number[]) { if (values.length < 2) return Number.NaN; const center = mean(values); return Math.sqrt(values.reduce((sum, value) => sum + (value - center) ** 2, 0) / (values.length - 1)); }
