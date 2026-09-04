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
    // A channel near zero is normal for strongly chromatic XTT wells (for
    // example, a deep-red well can have very little blue). Retain that
    // clipping diagnostic, but only exclude pixels that are actually
    // unusable for the image signal: transparent, neutral-highlighted, or
    // near-black. Otherwise the QC mask systematically removes the signal it
    // is meant to measure.
    valid: a >= 128 && !highlight && !darkArtifact,
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
