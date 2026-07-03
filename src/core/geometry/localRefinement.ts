import type { Homography } from "./homography";
import { applyHomography } from "./homography";
import type { WellGeometry } from "../types";

export type RefinementResult = {
  wells: WellGeometry[];
  changed: number;
  warnings: string[];
};

export function refineWellsLocally(
  imageData: ImageData,
  wells: WellGeometry[],
  homography: Homography
): RefinementResult {
  const warnings: string[] = [];
  const refined = wells.map((well) => {
    const pitch = Math.min(well.localPitchX, well.localPitchY);
    const maxOffset = Math.max(2, pitch * 0.12);
    const baseScore = ringEdgeScore(imageData, well.center.x, well.center.y, well.analysisRadius);
    let best = { center: well.center, score: baseScore };

    for (let dy = -maxOffset; dy <= maxOffset; dy += Math.max(1, maxOffset / 3)) {
      for (let dx = -maxOffset; dx <= maxOffset; dx += Math.max(1, maxOffset / 3)) {
        const candidate = { x: well.center.x + dx, y: well.center.y + dy };
        const score = ringEdgeScore(imageData, candidate.x, candidate.y, well.analysisRadius);
        if (score > best.score * 1.18) {
          best = { center: candidate, score };
        }
      }
    }

    return {
      ...well,
      center: best.center
    };
  });

  const changed = refined.filter((well, index) => {
    const source = wells[index];
    return Math.hypot(well.center.x - source.center.x, well.center.y - source.center.y) > 1;
  }).length;

  if (!preservesMonotonicity(refined, homography)) {
    warnings.push("Local refinement was rejected because row or column order became non-monotonic.");
    return { wells, changed: 0, warnings };
  }

  return { wells: refined, changed, warnings };
}

function ringEdgeScore(imageData: ImageData, cx: number, cy: number, radius: number): number {
  let score = 0;
  let samples = 0;
  const count = 48;
  for (let i = 0; i < count; i += 1) {
    const theta = (Math.PI * 2 * i) / count;
    const inner = luminanceAt(imageData, cx + Math.cos(theta) * radius * 0.82, cy + Math.sin(theta) * radius * 0.82);
    const outer = luminanceAt(imageData, cx + Math.cos(theta) * radius * 1.18, cy + Math.sin(theta) * radius * 1.18);
    if (Number.isFinite(inner) && Number.isFinite(outer)) {
      score += Math.abs(inner - outer);
      samples += 1;
    }
  }
  return samples > 0 ? score / samples : 0;
}

function luminanceAt(imageData: ImageData, x: number, y: number): number {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || iy < 0 || ix >= imageData.width || iy >= imageData.height) {
    return Number.NaN;
  }
  const offset = (iy * imageData.width + ix) * 4;
  return imageData.data[offset] * 0.2126 + imageData.data[offset + 1] * 0.7152 + imageData.data[offset + 2] * 0.0722;
}

function preservesMonotonicity(wells: WellGeometry[], homography: Homography): boolean {
  for (const well of wells) {
    const expected = applyHomography(homography, { x: well.col, y: well.row });
    const maxOffset = Math.min(well.localPitchX, well.localPitchY) * 0.16;
    if (Math.hypot(well.center.x - expected.x, well.center.y - expected.y) > maxOffset) {
      return false;
    }
  }
  return true;
}
