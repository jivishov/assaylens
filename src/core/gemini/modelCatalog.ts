export type GeminiModelId = "gemini-3.5-flash" | "gemini-2.5-flash" | "gemini-2.0-flash";

export type GeminiModelCapability = {
  id: GeminiModelId;
  label: string;
  supportsImageInput: boolean;
  supportsJsonResponse: boolean;
  thinkingLevel?: "minimal" | "low" | "medium";
  recommended: boolean;
};

export const GEMINI_MODELS: GeminiModelCapability[] = [
  {
    id: "gemini-3.5-flash",
    label: "Gemini 3.5 Flash",
    supportsImageInput: true,
    supportsJsonResponse: true,
    thinkingLevel: "minimal",
    recommended: true
  },
  {
    id: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    supportsImageInput: true,
    supportsJsonResponse: true,
    thinkingLevel: "minimal",
    recommended: false
  },
  {
    id: "gemini-2.0-flash",
    label: "Gemini 2.0 Flash",
    supportsImageInput: true,
    supportsJsonResponse: true,
    recommended: false
  }
];

export function getGeminiModel(modelId: GeminiModelId): GeminiModelCapability {
  const model = GEMINI_MODELS.find((candidate) => candidate.id === modelId);
  if (!model) {
    throw new Error(`Unsupported Gemini model: ${modelId}`);
  }
  return model;
}

export function defaultGeminiModel(): GeminiModelCapability {
  return GEMINI_MODELS.find((model) => model.recommended) ?? GEMINI_MODELS[0];
}
