import { z } from "zod";

const AnchorSchema = z.object({
  x1000: z.number().min(0).max(1000),
  y1000: z.number().min(0).max(1000),
  confidence: z.number().min(0).max(1)
});

export const GeminiPlateDetectionSchema = z.object({
  plateType: z.literal("96_well"),
  a1Position: z.enum(["top_left", "top_right", "bottom_left", "bottom_right", "uncertain"]),
  anchors: z.object({
    A1: AnchorSchema,
    A12: AnchorSchema,
    H12: AnchorSchema,
    H1: AnchorSchema
  }),
  visibleGridBox: z
    .object({
      xMin1000: z.number().min(0).max(1000),
      yMin1000: z.number().min(0).max(1000),
      xMax1000: z.number().min(0).max(1000),
      yMax1000: z.number().min(0).max(1000)
    })
    .optional(),
  warnings: z.array(z.string())
});

export type GeminiPlateDetection = z.infer<typeof GeminiPlateDetectionSchema>;

export function parseGeminiDetection(text: string): GeminiPlateDetection {
  const trimmed = text.trim();
  const jsonText = extractJson(trimmed);
  return GeminiPlateDetectionSchema.parse(JSON.parse(jsonText));
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    return fenced[1].trim();
  }
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }
  return text;
}
