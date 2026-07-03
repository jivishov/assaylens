import { rgbToHsv, rgbToLab, srgbToLinear } from "../image/colorSpaces";
import { classifyPixel, summarizePixelClasses, type PixelClassification } from "../image/pixelFilters";
import type { RoiFeature, RoiGeometry } from "./roiTypes";

type SampledPixel = {
  r: number;
  g: number;
  b: number;
  a: number;
};

export type RoiSamplingOffset = {
  x: number;
  y: number;
};

export type RoiSamplingOptions = {
  sampleCount?: number;
  blankLinearB?: number;
  blankGreenBlue?: number;
  medianBackgroundDensity?: number;
  selectedSignal?: "grayDensity" | "backgroundCorrectedDensity";
  offsetToImagePoint?: (roi: RoiGeometry, offset: RoiSamplingOffset) => { x: number; y: number };
};

export function sampleRoiFeatures(
  imageData: ImageData,
  rois: RoiGeometry[],
  options: RoiSamplingOptions = {}
): RoiFeature[] {
  return rois.map((roi) => sampleRoiFeature(imageData, roi, options));
}

export function sampleRoiFeature(
  imageData: ImageData,
  roi: RoiGeometry,
  options: RoiSamplingOptions = {}
): RoiFeature {
  const offsets = deterministicDiskOffsets(options.sampleCount ?? 1200);
  const pixels: SampledPixel[] = [];
  const classes: PixelClassification[] = [];
  let outOfImage = 0;

  for (const offset of offsets) {
    const imagePoint = options.offsetToImagePoint ? options.offsetToImagePoint(roi, offset) : ellipsePoint(roi, offset);
    const pixel = bilinearSample(imageData, imagePoint.x, imagePoint.y);
    if (!pixel) {
      outOfImage += 1;
      continue;
    }
    const classification = classifyPixel(pixel.r, pixel.g, pixel.b, pixel.a);
    classes.push(classification);
    if (classification.valid) {
      pixels.push(pixel);
    }
  }

  const fallbackPixels =
    pixels.length >= 40
      ? pixels
      : classes.length > 0
        ? collectUnfilteredPixels(imageData, roi, offsets, options.offsetToImagePoint)
        : [];
  const usedPixels = fallbackPixels.length > 0 ? fallbackPixels : [{ r: 0, g: 0, b: 0, a: 255 }];
  const stats = channelStats(usedPixels);
  const meanRgb = { r: stats.meanR, g: stats.meanG, b: stats.meanB };
  const hsv = rgbToHsv(meanRgb);
  const lab = rgbToLab(meanRgb);
  const linearR = srgbToLinear(stats.meanR);
  const linearG = srgbToLinear(stats.meanG);
  const linearB = Math.max(srgbToLinear(stats.meanB), 1e-6);
  const sumLinear = Math.max(linearR + linearG + linearB, 1e-6);
  const normalizedR = linearR / sumLinear;
  const normalizedG = linearG / sumLinear;
  const normalizedB = linearB / sumLinear;
  const greenBlue = Math.max(linearG + linearB, 1e-6);
  const luminanceMean = 0.2126 * stats.meanR + 0.7152 * stats.meanG + 0.0722 * stats.meanB;
  const grayDensity = 255 - luminanceMean;
  const backgroundCorrectedDensity = Math.max(grayDensity - (options.medianBackgroundDensity ?? 0), 0);
  const selectedSignal =
    options.selectedSignal === "grayDensity"
      ? grayDensity
      : options.selectedSignal === "backgroundCorrectedDensity"
        ? backgroundCorrectedDensity
        : undefined;

  return {
    roiId: roi.id,
    label: roi.label ?? roi.id,
    row: roi.row,
    col: roi.col,
    meanR: stats.meanR,
    meanG: stats.meanG,
    meanB: stats.meanB,
    medianR: stats.medianR,
    medianG: stats.medianG,
    medianB: stats.medianB,
    linearR,
    linearG,
    linearB,
    hsvH: hsv.h,
    hsvS: hsv.s,
    hsvV: hsv.v,
    labL: lab.l,
    labA: lab.a,
    labB: lab.b,
    luminanceMean,
    grayDensity,
    backgroundCorrectedDensity,
    orangeChromaticity: normalizedR + 0.5 * normalizedG - normalizedB,
    yellowOrangeLab: lab.b + 0.5 * lab.a,
    pseudoODBlue: -Math.log10(linearB / Math.max(options.blankLinearB ?? 1, 1e-6)),
    pseudoODGreenBlue: -Math.log10(greenBlue / Math.max(options.blankGreenBlue ?? 1, 1e-6)),
    selectedSignal,
    qc: summarizePixelClasses(classes, outOfImage)
  };
}

export function deterministicDiskOffsets(count: number): RoiSamplingOffset[] {
  const offsets: RoiSamplingOffset[] = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let index = 0; index < count; index += 1) {
    const radius = Math.sqrt((index + 0.5) / count);
    const theta = index * goldenAngle;
    offsets.push({ x: Math.cos(theta) * radius, y: Math.sin(theta) * radius });
  }
  return offsets;
}

function ellipsePoint(roi: RoiGeometry, offset: RoiSamplingOffset): { x: number; y: number } {
  return {
    x: roi.center.x + offset.x * roi.radiusX,
    y: roi.center.y + offset.y * roi.radiusY
  };
}

function bilinearSample(imageData: ImageData, x: number, y: number): SampledPixel | null {
  if (x < 0 || y < 0 || x >= imageData.width - 1 || y >= imageData.height - 1) {
    return null;
  }

  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const dx = x - x0;
  const dy = y - y0;
  const p00 = pixelAt(imageData, x0, y0);
  const p10 = pixelAt(imageData, x0 + 1, y0);
  const p01 = pixelAt(imageData, x0, y0 + 1);
  const p11 = pixelAt(imageData, x0 + 1, y0 + 1);

  return {
    r: lerp(lerp(p00.r, p10.r, dx), lerp(p01.r, p11.r, dx), dy),
    g: lerp(lerp(p00.g, p10.g, dx), lerp(p01.g, p11.g, dx), dy),
    b: lerp(lerp(p00.b, p10.b, dx), lerp(p01.b, p11.b, dx), dy),
    a: lerp(lerp(p00.a, p10.a, dx), lerp(p01.a, p11.a, dx), dy)
  };
}

function pixelAt(imageData: ImageData, x: number, y: number): SampledPixel {
  const offset = (y * imageData.width + x) * 4;
  return {
    r: imageData.data[offset],
    g: imageData.data[offset + 1],
    b: imageData.data[offset + 2],
    a: imageData.data[offset + 3]
  };
}

function collectUnfilteredPixels(
  imageData: ImageData,
  roi: RoiGeometry,
  offsets: RoiSamplingOffset[],
  offsetToImagePoint?: (roi: RoiGeometry, offset: RoiSamplingOffset) => { x: number; y: number }
): SampledPixel[] {
  const pixels: SampledPixel[] = [];
  for (const offset of offsets) {
    const imagePoint = offsetToImagePoint ? offsetToImagePoint(roi, offset) : ellipsePoint(roi, offset);
    const pixel = bilinearSample(imageData, imagePoint.x, imagePoint.y);
    if (pixel) {
      pixels.push(pixel);
    }
  }
  return pixels;
}

function channelStats(pixels: SampledPixel[]) {
  const rValues = pixels.map((pixel) => pixel.r).sort((a, b) => a - b);
  const gValues = pixels.map((pixel) => pixel.g).sort((a, b) => a - b);
  const bValues = pixels.map((pixel) => pixel.b).sort((a, b) => a - b);
  return {
    meanR: average(rValues),
    meanG: average(gValues),
    meanB: average(bValues),
    medianR: median(rValues),
    medianG: median(gValues),
    medianB: median(bValues)
  };
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 0 ? (values[middle - 1] + values[middle]) / 2 : values[middle];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
