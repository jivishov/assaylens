import type { PlateAnchors, Point, WellGeometry } from "../types";
import { applyHomography, computeHomography, distance, type Homography } from "./homography";

export const ROWS = 8;
export const COLUMNS = 12;
export const ROW_LABELS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;

export const IDEAL_CORNER_POINTS: Point[] = [
  { x: 0, y: 0 },
  { x: 11, y: 0 },
  { x: 11, y: 7 },
  { x: 0, y: 7 }
];

export function buildGridHomography(anchors: PlateAnchors): Homography {
  return computeHomography(IDEAL_CORNER_POINTS, [
    anchors.A1,
    anchors.A12,
    anchors.H12,
    anchors.H1
  ]);
}

export function wellName(row: number, col: number): string {
  if (row < 0 || row >= ROWS || col < 0 || col >= COLUMNS) {
    throw new Error(`Well index out of range: row=${row}, col=${col}`);
  }
  return `${ROW_LABELS[row]}${col + 1}`;
}

export function generatePlateGrid(
  homography: Homography,
  analysisRadiusFactor = 0.27,
  overlayRadiusFactor = 0.36
): WellGeometry[] {
  const wells: WellGeometry[] = [];

  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLUMNS; col += 1) {
      const center = applyHomography(homography, { x: col, y: row });
      const right = applyHomography(homography, { x: Math.min(col + 1, COLUMNS - 1), y: row });
      const left = applyHomography(homography, { x: Math.max(col - 1, 0), y: row });
      const down = applyHomography(homography, { x: col, y: Math.min(row + 1, ROWS - 1) });
      const up = applyHomography(homography, { x: col, y: Math.max(row - 1, 0) });
      const localPitchX = col === 0 ? distance(center, right) : col === COLUMNS - 1 ? distance(center, left) : distance(left, right) / 2;
      const localPitchY = row === 0 ? distance(center, down) : row === ROWS - 1 ? distance(center, up) : distance(up, down) / 2;
      const baseRadius = Math.min(localPitchX, localPitchY);

      wells.push({
        well: wellName(row, col),
        row,
        col,
        center,
        localPitchX,
        localPitchY,
        overlayRadius: baseRadius * overlayRadiusFactor,
        analysisRadius: baseRadius * analysisRadiusFactor
      });
    }
  }

  return wells;
}

export function anchorsFromArray(points: Point[]): PlateAnchors {
  if (points.length !== 4) {
    throw new Error("Expected A1, A12, H12, and H1 anchor points.");
  }
  return {
    A1: points[0],
    A12: points[1],
    H12: points[2],
    H1: points[3]
  };
}

export function anchorsToArray(anchors: PlateAnchors): Point[] {
  return [anchors.A1, anchors.A12, anchors.H12, anchors.H1];
}
