import type { PlateAnchors } from "../types";
import { GEMINI_ANCHOR_PROMPT } from "./geminiPrompts";
import { parseGeminiDetection, type GeminiPlateDetection } from "./geminiSchemas";
import { getGeminiModel, type GeminiModelId } from "./modelCatalog";

export type GeminiDetectionResult = {
  detection: GeminiPlateDetection;
  anchors: PlateAnchors;
  lowConfidence: boolean;
};

export async function detectPlateAnchorsWithGemini(
  file: File,
  apiKey: string,
  modelId: GeminiModelId,
  imageWidth: number,
  imageHeight: number
): Promise<GeminiDetectionResult> {
  const model = getGeminiModel(modelId);
  if (!model.supportsImageInput || !model.supportsJsonResponse) {
    throw new Error(`${model.label} is not configured for JSON image-anchor detection.`);
  }

  const base64 = await fileToBase64(file);
  const payload = await postGeminiGenerateContent(apiKey, model.id, file.type, base64, model.thinkingLevel);
  const outputText = extractOutputText(payload);
  const detection = parseGeminiDetection(outputText);
  const anchors = normalizedAnchorsToPixels(detection, imageWidth, imageHeight);
  const lowConfidence = Object.values(detection.anchors).some((anchor) => anchor.confidence < 0.65);

  return { detection, anchors, lowConfidence };
}

async function postGeminiGenerateContent(
  apiKey: string,
  modelId: string,
  mimeType: string,
  base64: string,
  thinkingLevel?: "minimal" | "low" | "medium"
): Promise<unknown> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: GEMINI_ANCHOR_PROMPT },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64
                }
              }
            ]
          }
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: plateDetectionJsonSchema(),
          thinkingConfig: thinkingLevel ? { thinkingLevel: thinkingLevel.toUpperCase() } : undefined
        }
      })
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini request failed (${response.status}): ${text.slice(0, 220)}`);
  }

  return response.json();
}

function plateDetectionJsonSchema() {
  return {
    type: "object",
    properties: {
      plateType: { type: "string", enum: ["96_well"] },
      a1Position: {
        type: "string",
        enum: ["top_left", "top_right", "bottom_left", "bottom_right", "uncertain"]
      },
      anchors: {
        type: "object",
        properties: {
          A1: anchorJsonSchema(),
          A12: anchorJsonSchema(),
          H12: anchorJsonSchema(),
          H1: anchorJsonSchema()
        },
        required: ["A1", "A12", "H12", "H1"],
        additionalProperties: false
      },
      visibleGridBox: {
        type: "object",
        properties: {
          xMin1000: { type: "number", minimum: 0, maximum: 1000 },
          yMin1000: { type: "number", minimum: 0, maximum: 1000 },
          xMax1000: { type: "number", minimum: 0, maximum: 1000 },
          yMax1000: { type: "number", minimum: 0, maximum: 1000 }
        },
        additionalProperties: false
      },
      warnings: { type: "array", items: { type: "string" } }
    },
    required: ["plateType", "a1Position", "anchors", "warnings"],
    additionalProperties: false
  };
}

function anchorJsonSchema() {
  return {
    type: "object",
    properties: {
      x1000: { type: "number", minimum: 0, maximum: 1000 },
      y1000: { type: "number", minimum: 0, maximum: 1000 },
      confidence: { type: "number", minimum: 0, maximum: 1 }
    },
    required: ["x1000", "y1000", "confidence"],
    additionalProperties: false
  };
}

function normalizedAnchorsToPixels(
  detection: GeminiPlateDetection,
  width: number,
  height: number
): PlateAnchors {
  return {
    A1: toPixel(detection.anchors.A1, width, height),
    A12: toPixel(detection.anchors.A12, width, height),
    H12: toPixel(detection.anchors.H12, width, height),
    H1: toPixel(detection.anchors.H1, width, height)
  };
}

function toPixel(anchor: { x1000: number; y1000: number }, width: number, height: number) {
  return {
    x: (anchor.x1000 / 1000) * width,
    y: (anchor.y1000 / 1000) * height
  };
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function extractOutputText(payload: unknown): string {
  const record = payload as Record<string, unknown>;
  if (typeof record.output_text === "string") {
    return record.output_text;
  }
  const candidates = record.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined;
  const candidateText = candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
  if (candidateText) {
    return candidateText;
  }
  const output = record.output as Array<{ content?: Array<{ text?: string }> }> | undefined;
  const outputText = output?.flatMap((item) => item.content ?? []).map((part) => part.text ?? "").join("");
  if (outputText) {
    return outputText;
  }
  throw new Error("Gemini response did not include JSON text.");
}
