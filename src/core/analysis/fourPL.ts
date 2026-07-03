export type FourPLFit = {
  converged: boolean;
  mic?: number;
  warnings: string[];
};

export function fitFourPLMic(): FourPLFit {
  return {
    converged: false,
    warnings: ["4PL MIC is deferred until enough concentrations exist and a robust fit converges."]
  };
}
