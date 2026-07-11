import type { WellMaskQC } from "../types";

export type PixelClassification = {
  valid: boolean;
  highlight: boolean;
  darkArtifact: boolean;
  clipped: boolean;
};

export function classifyPixel(r: number, g: number, b: number, a = 255): PixelClassification {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const clipped = max >= 252 || min <= 2 || a < 128;
  const highlight = max >= 245 && max - min < 18;
  const darkArtifact = max <= 18;

  return {
    valid: a >= 128 && !highlight && !darkArtifact && !clipped,
    highlight,
    darkArtifact,
    clipped
  };
}

export function summarizePixelClasses(classes: PixelClassification[], outOfImageCount: number): WellMaskQC {
  const total = Math.max(classes.length + outOfImageCount, 1);
  const valid = classes.filter((item) => item.valid).length;
  const highlight = classes.filter((item) => item.highlight).length;
  const dark = classes.filter((item) => item.darkArtifact).length;
  const clipped = classes.filter((item) => item.clipped).length;

  return {
    candidatePixelCount: classes.length + outOfImageCount,
    validPixelCount: valid,
    clippedPixelCount: clipped,
    darkPixelCount: dark,
    highlightedPixelCount: highlight,
    saturatedPixelCount: clipped,
    outOfImagePixelCount: outOfImageCount,
    validPixelFraction: valid / total,
    highlightFraction: highlight / total,
    darkArtifactFraction: dark / total,
    clippedFraction: clipped / total,
    partiallyOutsideImage: outOfImageCount / total > 0.02
  };
}
