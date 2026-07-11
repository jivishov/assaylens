import { srgbToLinear } from "../../image/colorSpaces";
import { median } from "../../analysis/statistics";
import type { RoiGeometry } from "../../roi/roiTypes";
import { applyHomography, invertHomography } from "../../geometry/homography";
import type { AgarProtocol } from "../../science/contracts";
import { EXPLORATORY_AGAR_PROTOCOL } from "../../science/protocols";

export type AgarDensitometry = {
  candidatePixelCount: number; validPixelCount: number; outOfImagePixelCount: number;
  annulusCandidatePixelCount: number; annulusValidPixelCount: number;
  localBackground: number; localNoise: number; areaPixels: number; areaFraction: number;
  meanSignedContrast: number; medianSignedContrast: number; signedIntegratedContrast: number;
  positiveIntegratedContrast: number; saturationFraction: number; boundaryContact: boolean;
  segmentationConfidence: number; maskProvenance: string; qcFlags: string[];
};

export function measureAgarRoi(image: ImageData, roi: RoiGeometry, protocol: AgarProtocol = EXPLORATORY_AGAR_PROTOCOL): AgarDensitometry {
  const annulus: Array<{ x: number; y: number; z: number }> = [], inside: Array<{ x: number; y: number; z: number; nx: number; ny: number }> = [];
  let saturated = 0, candidates = 0, outOfImage = 0, annulusCandidates = 0, annulusOutOfImage = 0;
  const rx = Math.max(roi.radiusX, 1), ry = Math.max(roi.radiusY, 1);
  const bounds = projectedBounds(roi, 1.8);
  const inverse = roi.gridProjection ? invertHomography(roi.gridProjection.homography) : undefined;
  for (let y = bounds.minY; y <= bounds.maxY; y += 1) for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
    const normalized = normalizedCoordinate(roi, x + 0.5, y + 0.5, inverse, rx, ry);
    const nx = normalized.x, ny = normalized.y, d2 = nx * nx + ny * ny;
    const isInside = d2 <= 1, isAnnulus = d2 >= 1.44 && d2 <= 3.24;
    if (!isInside && !isAnnulus) continue;
    if (isInside) candidates += 1; else annulusCandidates += 1;
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) {
      if (isInside) outOfImage += 1; else annulusOutOfImage += 1;
      continue;
    }
    const i = (y * image.width + x) * 4, r = image.data[i], g = image.data[i + 1], b = image.data[i + 2], alpha = image.data[i + 3];
    const clipped = alpha === 0 || Math.max(r, g, b) >= 252 || Math.min(r, g, b) <= 2;
    if (clipped) {
      if (isInside) saturated += 1;
      continue;
    }
    const z = 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
    if (isInside) inside.push({ x, y, z, nx, ny }); else annulus.push({ x: nx, y: ny, z });
  }
  const qcFlags: string[] = [];
  if (outOfImage > 0 || annulusOutOfImage > 0) qcFlags.push("partially_outside_image");
  if (inside.length < protocol.minimumRoiPixels) qcFlags.push(inside.length === 0 ? "zero_roi_pixels" : "insufficient_roi_pixels");
  const hasAnnulusCoverage = annulus.length >= protocol.minimumAnnulusPixels;
  if (!hasAnnulusCoverage) qcFlags.push("inadequate_annulus_coverage");
  const beta = hasAnnulusCoverage ? huberPlane(annulus) : undefined;
  if (hasAnnulusCoverage && !beta) qcFlags.push("singular_background_fit");
  const coefficients = beta ?? [Number.NaN, 0, 0];
  const residuals = annulus.map((p) => p.z - plane(coefficients, p.x, p.y));
  const noise = 1.4826 * madRaw(residuals);
  const contrast = inside.map((p) => {
    const signed = plane(coefficients, p.nx, p.ny) - p.z;
    return protocol.signalDirection === "dark_on_light" ? signed : -signed;
  });
  const threshold = Math.max(0, protocol.segmentationSigmaMultiplier * noise);
  const foreground = new Set<number>();
  contrast.forEach((value, index) => { if (value > threshold + 1e-12) foreground.add(index); });
  const retained = retainComponents(inside, foreground, Math.ceil(inside.length * protocol.minimumComponentAreaFraction));
  const boundaryContact = [...retained].some((index) => inside[index].nx ** 2 + inside[index].ny ** 2 >= 0.96);
  if (boundaryContact) qcFlags.push("mask_touches_analysis_boundary");
  const saturationFraction = saturated / Math.max(candidates - outOfImage, 1);
  if (saturationFraction > protocol.maximumSaturationFraction) qcFlags.push("saturated");
  const selected = [...retained].map((index) => contrast[index]);
  const signedIntegratedContrast = selected.reduce((sum, value) => sum + value, 0);
  return {
    candidatePixelCount: candidates, validPixelCount: inside.length, outOfImagePixelCount: outOfImage,
    annulusCandidatePixelCount: annulusCandidates, annulusValidPixelCount: annulus.length,
    localBackground: coefficients[0], localNoise: noise, areaPixels: retained.size, areaFraction: retained.size / Math.max(inside.length, 1),
    meanSignedContrast: mean(selected), medianSignedContrast: median(selected), signedIntegratedContrast,
    positiveIntegratedContrast: selected.reduce((sum, value) => sum + Math.max(value, 0), 0), saturationFraction, boundaryContact,
    segmentationConfidence: noise > 0 ? Math.max(0, mean(selected) / noise) : retained.size ? 1 : 0,
    maskProvenance: `huber8-mad${protocol.segmentationSigmaMultiplier}-components${protocol.minimumComponentAreaFraction}:n=${retained.size}:mask=${maskFingerprint(inside, retained)}`, qcFlags: [...new Set(qcFlags)]
  };
}

function projectedBounds(roi: RoiGeometry, scale: number) {
  if (!roi.gridProjection) return { minX: Math.floor(roi.center.x - scale * roi.radiusX), maxX: Math.ceil(roi.center.x + scale * roi.radiusX), minY: Math.floor(roi.center.y - scale * roi.radiusY), maxY: Math.ceil(roi.center.y + scale * roi.radiusY) };
  const p = roi.gridProjection;
  const boundary = Array.from({ length: 96 }, (_, index) => {
    const angle = 2 * Math.PI * index / 96;
    const point = applyHomography(p.homography, { x: p.gridCenter.x + Math.cos(angle) * p.radiusInGridUnits * scale, y: p.gridCenter.y + Math.sin(angle) * p.radiusInGridUnits * scale });
    return { x: point.x + p.manualOffset.x, y: point.y + p.manualOffset.y };
  });
  return { minX: Math.floor(Math.min(...boundary.map((point) => point.x))), maxX: Math.ceil(Math.max(...boundary.map((point) => point.x))), minY: Math.floor(Math.min(...boundary.map((point) => point.y))), maxY: Math.ceil(Math.max(...boundary.map((point) => point.y))) };
}

function normalizedCoordinate(roi: RoiGeometry, x: number, y: number, inverse: ReturnType<typeof invertHomography> | undefined, rx: number, ry: number) {
  if (!roi.gridProjection || !inverse) return { x: (x - roi.center.x) / rx, y: (y - roi.center.y) / ry };
  const p = roi.gridProjection;
  const grid = applyHomography(inverse, { x: x - p.manualOffset.x, y: y - p.manualOffset.y });
  return { x: (grid.x - p.gridCenter.x) / p.radiusInGridUnits, y: (grid.y - p.gridCenter.y) / p.radiusInGridUnits };
}

function huberPlane(points: Array<{ x: number; y: number; z: number }>): [number, number, number] | undefined {
  if (points.length < 3) return undefined;
  let beta: [number, number, number] = [median(points.map((p) => p.z)), 0, 0];
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const residuals = points.map((p) => p.z - plane(beta, p.x, p.y)), scale = 1.4826 * madRaw(residuals), delta = 1.345 * Math.max(scale, 1e-12);
    const rows = points.map((p, i) => ({ ...p, w: Math.abs(residuals[i]) <= delta ? 1 : delta / Math.abs(residuals[i]) }));
    const next = solve3(rows); if (!next) return undefined;
    if (Math.max(...next.map((v, i) => Math.abs(v - beta[i]))) < 1e-6) return next;
    beta = next;
  }
  return beta;
}
function solve3(rows: Array<{ x: number; y: number; z: number; w: number }>): [number, number, number] | undefined {
  const a = Array.from({ length: 3 }, () => [0, 0, 0]), b = [0, 0, 0];
  for (const p of rows) { const v = [1, p.x, p.y]; for (let i = 0; i < 3; i += 1) { b[i] += p.w * v[i] * p.z; for (let j = 0; j < 3; j += 1) a[i][j] += p.w * v[i] * v[j]; } }
  for (let k = 0; k < 3; k += 1) { let pivot = k; for (let i = k + 1; i < 3; i += 1) if (Math.abs(a[i][k]) > Math.abs(a[pivot][k])) pivot = i; if (Math.abs(a[pivot][k]) < 1e-12) return undefined; [a[k], a[pivot]] = [a[pivot], a[k]]; [b[k], b[pivot]] = [b[pivot], b[k]]; const d = a[k][k]; for (let j = k; j < 3; j += 1) a[k][j] /= d; b[k] /= d; for (let i = 0; i < 3; i += 1) if (i !== k) { const f = a[i][k]; for (let j = k; j < 3; j += 1) a[i][j] -= f * a[k][j]; b[i] -= f * b[k]; } }
  return [b[0], b[1], b[2]];
}
function retainComponents(points: Array<{ x: number; y: number }>, foreground: Set<number>, minimum: number): Set<number> {
  const byCoord = new Map(points.map((p, i) => [`${p.x},${p.y}`, i])), kept = new Set<number>(), seen = new Set<number>();
  for (const start of foreground) { if (seen.has(start)) continue; const component: number[] = [], queue = [start]; seen.add(start); while (queue.length) { const i = queue.pop()!; component.push(i); const p = points[i]; for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) { const n = byCoord.get(`${p.x + dx},${p.y + dy}`); if (n != null && foreground.has(n) && !seen.has(n)) { seen.add(n); queue.push(n); } } } if (component.length >= minimum) component.forEach((i) => kept.add(i)); }
  return kept;
}
function maskFingerprint(points: Array<{ x: number; y: number }>, retained: Set<number>): string {
  let hash = 2166136261;
  for (const index of [...retained].sort((left, right) => left - right)) {
    const point = points[index];
    for (const value of [point.x, point.y]) {
      hash ^= value | 0;
      hash = Math.imul(hash, 16777619);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
function plane(beta: number[], x: number, y: number) { return beta[0] + beta[1] * x + beta[2] * y; }
function madRaw(values: number[]) { const center = median(values); return median(values.map((v) => Math.abs(v - center))) || 0; }
function mean(values: number[]) { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : Number.NaN; }
