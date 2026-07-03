import type { PlateAnchors, SpotGridSettings } from "../../types";
import type { RoiGeometry } from "../../roi/roiTypes";
import { applyHomography, computeHomography, distance } from "../../geometry/homography";
import { spotId } from "./spotMapTypes";

export const DEFAULT_SPOT_GRID_SETTINGS: SpotGridSettings = {
  rows: 4,
  columns: 6,
  analysisRadiusFactor: 0.28,
  overlayRadiusFactor: 0.38,
  roiAdjustments: {}
};

export function normalizedSpotGridSettings(settings?: Partial<SpotGridSettings>): SpotGridSettings {
  return {
    rows: clampInteger(settings?.rows ?? DEFAULT_SPOT_GRID_SETTINGS.rows, 2, 16),
    columns: clampInteger(settings?.columns ?? DEFAULT_SPOT_GRID_SETTINGS.columns, 2, 24),
    analysisRadiusFactor: clampNumber(
      settings?.analysisRadiusFactor ?? DEFAULT_SPOT_GRID_SETTINGS.analysisRadiusFactor,
      0.12,
      0.45
    ),
    overlayRadiusFactor: clampNumber(
      settings?.overlayRadiusFactor ?? DEFAULT_SPOT_GRID_SETTINGS.overlayRadiusFactor,
      0.16,
      0.55
    ),
    roiAdjustments: settings?.roiAdjustments ?? {}
  };
}

export function generateSpotGrid(anchors: PlateAnchors, settings?: Partial<SpotGridSettings>): RoiGeometry[] {
  const gridSettings = normalizedSpotGridSettings(settings);
  const homography = computeHomography(
    [
      { x: 0, y: 0 },
      { x: gridSettings.columns - 1, y: 0 },
      { x: gridSettings.columns - 1, y: gridSettings.rows - 1 },
      { x: 0, y: gridSettings.rows - 1 }
    ],
    [anchors.A1, anchors.A12, anchors.H12, anchors.H1]
  );
  const rois: RoiGeometry[] = [];

  for (let row = 0; row < gridSettings.rows; row += 1) {
    for (let col = 0; col < gridSettings.columns; col += 1) {
      const center = applyHomography(homography, { x: col, y: row });
      const right = applyHomography(homography, { x: Math.min(col + 1, gridSettings.columns - 1), y: row });
      const left = applyHomography(homography, { x: Math.max(col - 1, 0), y: row });
      const down = applyHomography(homography, { x: col, y: Math.min(row + 1, gridSettings.rows - 1) });
      const up = applyHomography(homography, { x: col, y: Math.max(row - 1, 0) });
      const localPitchX =
        col === 0
          ? distance(center, right)
          : col === gridSettings.columns - 1
            ? distance(center, left)
            : distance(left, right) / 2;
      const localPitchY =
        row === 0
          ? distance(center, down)
          : row === gridSettings.rows - 1
            ? distance(center, up)
            : distance(up, down) / 2;
      const baseRadius = Math.min(localPitchX, localPitchY);
      const id = spotId(row, col);
      const adjustment = gridSettings.roiAdjustments[id] ?? { x: 0, y: 0 };

      rois.push({
        id,
        label: id,
        row,
        col,
        center: {
          x: center.x + adjustment.x,
          y: center.y + adjustment.y
        },
        radiusX: baseRadius * gridSettings.analysisRadiusFactor,
        radiusY: baseRadius * gridSettings.analysisRadiusFactor,
        overlayRadiusX: baseRadius * gridSettings.overlayRadiusFactor,
        overlayRadiusY: baseRadius * gridSettings.overlayRadiusFactor
      });
    }
  }

  return rois;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
