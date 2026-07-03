import type { BackgroundClass, CaptureQuality, ImageSource, InputWarningCode } from "../types";

type WarningOptions = {
  source?: ImageSource;
};

export type InputImageQc = {
  backgroundClass: BackgroundClass;
  captureQuality?: CaptureQuality;
  warningCodes: InputWarningCode[];
  warnings: string[];
};

type ImageStats = {
  sampled: number;
  neonGreenFraction: number;
  redOverlayFraction: number;
  topTextLikeFraction: number;
  brightClippedFraction: number;
  darkFraction: number;
  meanLuma: number;
  centerMeanLuma: number;
  borderDarkFraction: number;
  cornerDarkFraction: number;
  edgeEnergy: number;
};

export function inspectInputImage(imageData: ImageData, options: WarningOptions = {}): InputImageQc {
  const source = options.source ?? "upload";
  const stats = collectImageStats(imageData);
  const backgroundClass = classifyImageBackground(imageData, stats);
  const captureQuality = source === "camera" ? assessCaptureQuality(imageData, stats) : undefined;
  const warningCodes = inputWarningCodesForStats(source, backgroundClass, stats, captureQuality);

  return {
    backgroundClass,
    captureQuality,
    warningCodes,
    warnings: warningMessagesForCodes(warningCodes)
  };
}

export function detectInputWarnings(imageData: ImageData, options: WarningOptions = {}): InputWarningCode[] {
  return inspectInputImage(imageData, options).warningCodes;
}

export function classifyImageBackground(imageData: ImageData, stats = collectImageStats(imageData)): BackgroundClass {
  if (
    stats.borderDarkFraction > 0.62 &&
    stats.cornerDarkFraction > 0.72 &&
    stats.darkFraction > 0.12 &&
    stats.centerMeanLuma > stats.meanLuma + 12
  ) {
    return "black_box";
  }
  return "standard";
}

export function assessCaptureQuality(imageData: ImageData, stats = collectImageStats(imageData)): CaptureQuality {
  const megapixels = (imageData.width * imageData.height) / 1_000_000;
  const lowResolution = imageData.width < 1280 || imageData.height < 720 || megapixels < 1;
  const glareOrOverexposureRisk = stats.brightClippedFraction > 0.16 || stats.meanLuma > 232;
  const underexposureRisk = stats.centerMeanLuma < 46 || (stats.meanLuma < 54 && stats.brightClippedFraction < 0.025);
  const blurOrFocusRisk = !underexposureRisk && !glareOrOverexposureRisk && stats.edgeEnergy < 5.5;
  const warnings: InputWarningCode[] = [];

  if (lowResolution) {
    warnings.push("low_resolution_capture");
  }
  if (blurOrFocusRisk) {
    warnings.push("blur_or_focus_risk");
  }
  if (glareOrOverexposureRisk) {
    warnings.push("glare_or_overexposure_risk");
  }
  if (underexposureRisk) {
    warnings.push("underexposure_risk");
  }

  return {
    resolution: {
      width: imageData.width,
      height: imageData.height,
      megapixels
    },
    warnings,
    lowResolution,
    blurOrFocusRisk,
    glareOrOverexposureRisk,
    underexposureRisk
  };
}

export const INPUT_WARNING_TEXT =
  "This image appears to contain drawn overlays, debug dots, or plot text. For quantitative analysis, upload the original plate photo. You may continue for demonstration only.";

export const INPUT_WARNING_MESSAGES: Record<InputWarningCode, string> = {
  annotated_or_debug_image_possible: INPUT_WARNING_TEXT,
  black_background_detected:
    "Black-box background detected. Analysis will use the captured pixels unchanged; review well QC and controls before interpreting results.",
  low_resolution_capture: "Camera capture resolution is low for small ROI analysis. Retake closer or use a higher-resolution source if possible.",
  blur_or_focus_risk: "Camera capture may be blurred or out of focus. Retake after focusing on the well plane if possible.",
  glare_or_overexposure_risk: "Camera capture may contain glare or overexposed regions. Reduce reflections and retake if possible.",
  underexposure_risk: "Camera capture may be underexposed. Add even illumination and retake if possible."
};

export function warningMessagesForCodes(codes: InputWarningCode[]): string[] {
  return uniqueWarnings(codes).map((code) => INPUT_WARNING_MESSAGES[code]);
}

function collectImageStats(imageData: ImageData): ImageStats {
  const { data, width, height } = imageData;
  const totalPixels = width * height;
  const stride = Math.max(1, Math.floor(totalPixels / 180000));
  let sampled = 0;
  let neonGreen = 0;
  let redOverlay = 0;
  let topTextLike = 0;
  let brightClipped = 0;
  let dark = 0;
  let lumaTotal = 0;
  let centerLumaTotal = 0;
  let centerSampled = 0;
  let borderDark = 0;
  let borderSampled = 0;
  let cornerDark = 0;
  let cornerSampled = 0;
  let edgeTotal = 0;
  let edgeSampled = 0;

  for (let index = 0; index < totalPixels; index += stride) {
    const offset = index * 4;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const luma = luminance(r, g, b);
    const x = index % width;
    const y = Math.floor(index / width);
    const isDark = luma < 35;
    const isBorder = x < width * 0.1 || x >= width * 0.9 || y < height * 0.1 || y >= height * 0.9;
    const isCorner = (x < width * 0.16 || x >= width * 0.84) && (y < height * 0.16 || y >= height * 0.84);
    const isCenter = x >= width * 0.22 && x <= width * 0.78 && y >= height * 0.22 && y <= height * 0.78;

    sampled += 1;
    lumaTotal += luma;

    if (g > 210 && r < 80 && b < 120) {
      neonGreen += 1;
    }
    if (r > 210 && g < 70 && b < 70) {
      redOverlay += 1;
    }
    if (y < height * 0.15 && r < 80 && g < 80 && b < 80 && x > width * 0.05 && x < width * 0.95) {
      topTextLike += 1;
    }
    if (Math.max(r, g, b) > 248 && Math.min(r, g, b) > 220) {
      brightClipped += 1;
    }
    if (isDark) {
      dark += 1;
    }
    if (isBorder) {
      borderSampled += 1;
      if (isDark) {
        borderDark += 1;
      }
    }
    if (isCorner) {
      cornerSampled += 1;
      if (isDark) {
        cornerDark += 1;
      }
    }
    if (isCenter) {
      centerSampled += 1;
      centerLumaTotal += luma;
    }

    const rightOffset = x + 1 < width ? offset + 4 : -1;
    const downOffset = y + 1 < height ? offset + width * 4 : -1;
    if (rightOffset >= 0) {
      edgeTotal += Math.abs(luma - luminance(data[rightOffset], data[rightOffset + 1], data[rightOffset + 2]));
      edgeSampled += 1;
    }
    if (downOffset >= 0) {
      edgeTotal += Math.abs(luma - luminance(data[downOffset], data[downOffset + 1], data[downOffset + 2]));
      edgeSampled += 1;
    }
  }

  const safeSampled = Math.max(sampled, 1);
  return {
    sampled: safeSampled,
    neonGreenFraction: neonGreen / safeSampled,
    redOverlayFraction: redOverlay / safeSampled,
    topTextLikeFraction: topTextLike / safeSampled,
    brightClippedFraction: brightClipped / safeSampled,
    darkFraction: dark / safeSampled,
    meanLuma: lumaTotal / safeSampled,
    centerMeanLuma: centerSampled > 0 ? centerLumaTotal / centerSampled : lumaTotal / safeSampled,
    borderDarkFraction: borderSampled > 0 ? borderDark / borderSampled : 0,
    cornerDarkFraction: cornerSampled > 0 ? cornerDark / cornerSampled : 0,
    edgeEnergy: edgeSampled > 0 ? edgeTotal / edgeSampled : 0
  };
}

function inputWarningCodesForStats(
  source: ImageSource,
  backgroundClass: BackgroundClass,
  stats: ImageStats,
  captureQuality: CaptureQuality | undefined
): InputWarningCode[] {
  const warnings: InputWarningCode[] = [];

  if (backgroundClass === "black_box") {
    warnings.push("black_background_detected");
  }

  const overlayLikely =
    stats.neonGreenFraction > 0.00035 ||
    stats.redOverlayFraction > 0.00025 ||
    (backgroundClass !== "black_box" && stats.topTextLikeFraction > 0.018);

  if (overlayLikely) {
    warnings.push("annotated_or_debug_image_possible");
  }

  if (source === "camera" && captureQuality) {
    warnings.push(...captureQuality.warnings);
  }

  return uniqueWarnings(warnings);
}

function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function uniqueWarnings(codes: InputWarningCode[]): InputWarningCode[] {
  return Array.from(new Set(codes));
}
