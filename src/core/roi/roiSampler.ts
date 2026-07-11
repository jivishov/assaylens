import { rgbToHsv, rgbToLab, srgbToLinear } from "../image/colorSpaces";
import { classifyPixel, summarizePixelClasses, type PixelClassification } from "../image/pixelFilters";
import type { RoiFeature, RoiGeometry } from "./roiTypes";

type SampledPixel = { r: number; g: number; b: number; a: number };
export type RoiSamplingOffset = { x: number; y: number };
export type RoiSamplingOptions = {
  blankLinearB?: number;
  blankGreenBlue?: number;
  medianBackgroundDensity?: number;
  selectedSignal?: "grayDensity" | "backgroundCorrectedDensity";
  offsetToImagePoint?: (roi: RoiGeometry, offset: RoiSamplingOffset) => { x: number; y: number };
};

export function sampleRoiFeatures(imageData: ImageData, rois: RoiGeometry[], options: RoiSamplingOptions = {}): RoiFeature[] {
  return rois.map((roi) => sampleRoiFeature(imageData, roi, options));
}

/** Rasterizes each projected ROI once against integer source pixels. No interpolation,
 * rejected-pixel substitution, or synthetic black fallback is permitted. */
export function sampleRoiFeature(imageData: ImageData, roi: RoiGeometry, options: RoiSamplingOptions = {}): RoiFeature {
  const candidates = rasterizeRoi(roi, options.offsetToImagePoint);
  const pixels: SampledPixel[] = [];
  const classes: PixelClassification[] = [];
  let outOfImage = 0;
  for (const point of candidates) {
    if (point.x < 0 || point.y < 0 || point.x >= imageData.width || point.y >= imageData.height) {
      outOfImage += 1;
      continue;
    }
    const pixel = pixelAt(imageData, point.x, point.y);
    const classification = classifyPixel(pixel.r, pixel.g, pixel.b, pixel.a);
    classes.push(classification);
    if (classification.valid) pixels.push(pixel);
  }

  const stats = channelStats(pixels);
  const linear = linearChannelMeans(pixels);
  const hsv = rgbToHsv({ r: stats.meanR, g: stats.meanG, b: stats.meanB });
  const lab = rgbToLab({ r: stats.meanR, g: stats.meanG, b: stats.meanB });
  const sumLinear = linear.r + linear.g + linear.b;
  const normalizedR = sumLinear > 0 ? linear.r / sumLinear : Number.NaN;
  const normalizedG = sumLinear > 0 ? linear.g / sumLinear : Number.NaN;
  const normalizedB = sumLinear > 0 ? linear.b / sumLinear : Number.NaN;
  const greenBlueSum = linear.g + linear.b;
  const luminanceMean = pixels.length ? 0.2126 * stats.meanR + 0.7152 * stats.meanG + 0.0722 * stats.meanB : Number.NaN;
  const grayDensity = Number.isFinite(luminanceMean) ? 255 - luminanceMean : Number.NaN;
  const backgroundCorrectedDensity = Number.isFinite(grayDensity) ? grayDensity - (options.medianBackgroundDensity ?? 0) : Number.NaN;
  const selectedSignal = options.selectedSignal === "grayDensity" ? grayDensity : options.selectedSignal === "backgroundCorrectedDensity" ? backgroundCorrectedDensity : undefined;
  const logContrast = greenBlueSum > 0 ? -Math.log10(greenBlueSum / Math.max(options.blankGreenBlue ?? 1, 1e-12)) : Number.NaN;

  return {
    roiId: roi.id, label: roi.label ?? roi.id, row: roi.row, col: roi.col,
    meanR: stats.meanR, meanG: stats.meanG, meanB: stats.meanB,
    medianR: stats.medianR, medianG: stats.medianG, medianB: stats.medianB,
    linearR: linear.r, linearG: linear.g, linearB: linear.b,
    hsvH: hsv.h, hsvS: hsv.s, hsvV: hsv.v, labL: lab.l, labA: lab.a, labB: lab.b,
    luminanceMean, grayDensity, backgroundCorrectedDensity,
    orangeChromaticity: normalizedR + 0.5 * normalizedG - normalizedB,
    yellowOrangeLab: lab.b + 0.5 * lab.a,
    pseudoODBlue: linear.b > 0 ? -Math.log10(linear.b / Math.max(options.blankLinearB ?? 1, 1e-12)) : Number.NaN,
    pseudoODGreenBlue: logContrast,
    logIntensityContrastGreenBlue: logContrast,
    selectedSignal,
    qc: summarizePixelClasses(classes, outOfImage)
  };
}

function rasterizeRoi(roi: RoiGeometry, transform?: RoiSamplingOptions["offsetToImagePoint"]): Array<{ x: number; y: number }> {
  if (!transform) {
    const points: Array<{ x: number; y: number }> = [];
    const minX = Math.floor(roi.center.x - roi.radiusX), maxX = Math.ceil(roi.center.x + roi.radiusX);
    const minY = Math.floor(roi.center.y - roi.radiusY), maxY = Math.ceil(roi.center.y + roi.radiusY);
    for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) {
      const dx = (x + 0.5 - roi.center.x) / Math.max(roi.radiusX, 1e-9);
      const dy = (y + 0.5 - roi.center.y) / Math.max(roi.radiusY, 1e-9);
      if (dx * dx + dy * dy <= 1) points.push({ x, y });
    }
    return points;
  }
  const polygon = Array.from({ length: 96 }, (_, index) => {
    const angle = (2 * Math.PI * index) / 96;
    return transform(roi, { x: Math.cos(angle), y: Math.sin(angle) });
  });
  const minX = Math.floor(Math.min(...polygon.map((p) => p.x))), maxX = Math.ceil(Math.max(...polygon.map((p) => p.x)));
  const minY = Math.floor(Math.min(...polygon.map((p) => p.y))), maxY = Math.ceil(Math.max(...polygon.map((p) => p.y)));
  const points: Array<{ x: number; y: number }> = [];
  for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) if (pointInPolygon(x + 0.5, y + 0.5, polygon)) points.push({ x, y });
  return points;
}

function pointInPolygon(x: number, y: number, polygon: Array<{ x: number; y: number }>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function pixelAt(imageData: ImageData, x: number, y: number): SampledPixel {
  const offset = (y * imageData.width + x) * 4;
  return { r: imageData.data[offset], g: imageData.data[offset + 1], b: imageData.data[offset + 2], a: imageData.data[offset + 3] };
}

function channelStats(pixels: SampledPixel[]) {
  const values = (channel: "r" | "g" | "b") => pixels.map((p) => p[channel]).sort((a, b) => a - b);
  const r = values("r"), g = values("g"), b = values("b");
  return { meanR: average(r), meanG: average(g), meanB: average(b), medianR: median(r), medianG: median(g), medianB: median(b) };
}
function linearChannelMeans(pixels: SampledPixel[]) {
  if (!pixels.length) return { r: Number.NaN, g: Number.NaN, b: Number.NaN };
  const sum = pixels.reduce((value, p) => ({ r: value.r + srgbToLinear(p.r), g: value.g + srgbToLinear(p.g), b: value.b + srgbToLinear(p.b) }), { r: 0, g: 0, b: 0 });
  return { r: sum.r / pixels.length, g: sum.g / pixels.length, b: sum.b / pixels.length };
}
function average(values: number[]) { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : Number.NaN; }
function median(values: number[]) { if (!values.length) return Number.NaN; const m = Math.floor(values.length / 2); return values.length % 2 ? values[m] : (values[m - 1] + values[m]) / 2; }

// Retained for compatibility with deterministic diagnostics; scientific ROI sampling no longer uses it.
export function deterministicDiskOffsets(count: number): RoiSamplingOffset[] {
  const offsets: RoiSamplingOffset[] = [], goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let index = 0; index < count; index += 1) { const radius = Math.sqrt((index + 0.5) / count); offsets.push({ x: Math.cos(index * goldenAngle) * radius, y: Math.sin(index * goldenAngle) * radius }); }
  return offsets;
}
