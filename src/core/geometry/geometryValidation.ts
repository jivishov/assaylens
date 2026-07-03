import type { PlateAnchors, Point } from "../types";
import { centroid, distance } from "./homography";
import { anchorsToArray } from "./plateGrid";

export type GeometryValidationResult = {
  valid: boolean;
  confidence: number;
  warnings: string[];
};

export function hasCompleteAnchors(anchors: Partial<PlateAnchors>): anchors is PlateAnchors {
  return Boolean(anchors.A1 && anchors.A12 && anchors.H12 && anchors.H1);
}

export function validateGeometry(
  anchors: Partial<PlateAnchors>,
  imageWidth: number,
  imageHeight: number
): GeometryValidationResult {
  if (!hasCompleteAnchors(anchors)) {
    return {
      valid: false,
      confidence: 0,
      warnings: ["Four anchors are required before ROIs can be confirmed."]
    };
  }

  const warnings: string[] = [];
  const points = anchorsToArray(anchors);
  const edges = [
    distance(anchors.A1, anchors.A12),
    distance(anchors.A12, anchors.H12),
    distance(anchors.H12, anchors.H1),
    distance(anchors.H1, anchors.A1)
  ];
  const minEdge = Math.min(...edges);
  const maxEdge = Math.max(...edges);
  const plateArea = polygonArea(points);
  const imageArea = imageWidth * imageHeight;
  const center = centroid(points);

  if (minEdge < 60) {
    warnings.push("Anchor spacing is too small for reliable ROI sampling.");
  }
  if (maxEdge / Math.max(minEdge, 1) > 4.2) {
    warnings.push("Anchor geometry is highly skewed; review the corner centers.");
  }
  if (plateArea < imageArea * 0.05) {
    warnings.push("The selected plate area is very small relative to the image.");
  }
  if (!points.every((point) => inBounds(point, imageWidth, imageHeight))) {
    warnings.push("One or more anchors are outside the image.");
  }
  if (!inBounds(center, imageWidth, imageHeight)) {
    warnings.push("The plate center falls outside the image.");
  }
  if (polygonSelfIntersects(points)) {
    warnings.push("Anchor order crosses over itself; click A1, A12, H12, H1 in sequence.");
  }

  const quality = [
    clamp(minEdge / 180, 0, 1),
    clamp(plateArea / Math.max(imageArea * 0.3, 1), 0, 1),
    clamp(2.8 / Math.max(maxEdge / Math.max(minEdge, 1), 1), 0, 1),
    warnings.length === 0 ? 1 : Math.max(0.25, 1 - warnings.length * 0.2)
  ];
  const confidence = quality.reduce((sum, item) => sum + item, 0) / quality.length;

  return {
    valid: warnings.length === 0 || (warnings.length <= 1 && minEdge >= 60 && plateArea > imageArea * 0.04),
    confidence,
    warnings
  };
}

function inBounds(point: Point, width: number, height: number): boolean {
  return point.x >= 0 && point.y >= 0 && point.x <= width && point.y <= height;
}

function polygonArea(points: Point[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].y - points[j].x * points[i].y;
  }
  return Math.abs(area / 2);
}

function polygonSelfIntersects(points: Point[]): boolean {
  return intersects(points[0], points[1], points[2], points[3]) || intersects(points[1], points[2], points[3], points[0]);
}

function intersects(a: Point, b: Point, c: Point, d: Point): boolean {
  const ccw = (p1: Point, p2: Point, p3: Point) =>
    (p3.y - p1.y) * (p2.x - p1.x) > (p2.y - p1.y) * (p3.x - p1.x);
  return ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
