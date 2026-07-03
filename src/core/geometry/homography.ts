import type { Point } from "../types";

export type Homography = [number, number, number, number, number, number, number, number, number];

const EPSILON = 1e-10;

export function computeHomography(from: Point[], to: Point[]): Homography {
  if (from.length !== 4 || to.length !== 4) {
    throw new Error("Homography requires exactly four source and destination points.");
  }

  const matrix: number[][] = [];
  const rhs: number[] = [];

  for (let i = 0; i < 4; i += 1) {
    const { x, y } = from[i];
    const u = to[i].x;
    const v = to[i].y;

    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    rhs.push(u);
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    rhs.push(v);
  }

  const h = solveLinearSystem(matrix, rhs);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

export function applyHomography(h: Homography, point: Point): Point {
  const denominator = h[6] * point.x + h[7] * point.y + h[8];
  if (Math.abs(denominator) < EPSILON) {
    throw new Error("Homography maps point to infinity.");
  }

  return {
    x: (h[0] * point.x + h[1] * point.y + h[2]) / denominator,
    y: (h[3] * point.x + h[4] * point.y + h[5]) / denominator
  };
}

export function invertHomography(h: Homography): Homography {
  const [a, b, c, d, e, f, g, i, j] = h;
  const det =
    a * (e * j - f * i) -
    b * (d * j - f * g) +
    c * (d * i - e * g);

  if (Math.abs(det) < EPSILON) {
    throw new Error("Cannot invert a singular homography.");
  }

  const invDet = 1 / det;
  return [
    (e * j - f * i) * invDet,
    (c * i - b * j) * invDet,
    (b * f - c * e) * invDet,
    (f * g - d * j) * invDet,
    (a * j - c * g) * invDet,
    (c * d - a * f) * invDet,
    (d * i - e * g) * invDet,
    (b * g - a * i) * invDet,
    (a * e - b * d) * invDet
  ];
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function centroid(points: Point[]): Point {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length
  };
}

function solveLinearSystem(matrix: number[][], rhs: number[]): number[] {
  const n = rhs.length;
  const a = matrix.map((row, index) => [...row, rhs[index]]);

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) {
        pivot = row;
      }
    }

    if (Math.abs(a[pivot][col]) < EPSILON) {
      throw new Error("Anchor geometry is degenerate.");
    }

    [a[col], a[pivot]] = [a[pivot], a[col]];

    const divisor = a[col][col];
    for (let item = col; item <= n; item += 1) {
      a[col][item] /= divisor;
    }

    for (let row = 0; row < n; row += 1) {
      if (row === col) {
        continue;
      }
      const factor = a[row][col];
      for (let item = col; item <= n; item += 1) {
        a[row][item] -= factor * a[col][item];
      }
    }
  }

  return a.map((row) => row[n]);
}
