import type { Homography } from "../geometry/homography";
import { applyHomography } from "../geometry/homography";
import type { WellFeature, WellGeometry } from "../types";
import { sampleRoiFeature, sampleRoiFeatures, type RoiSamplingOffset } from "../roi/roiSampler";
import type { RoiFeature, RoiGeometry } from "../roi/roiTypes";

export function sampleWellFeatures(
  imageData: ImageData,
  wells: WellGeometry[],
  homography: Homography,
  blankLinearB = 1,
  blankGreenBlue = 1
): WellFeature[] {
  const rois = wells.map(wellToRoiGeometry);
  const wellById = new Map(wells.map((well) => [well.well, well]));
  return sampleRoiFeatures(imageData, rois, {
    blankLinearB,
    blankGreenBlue,
    offsetToImagePoint: (roi, offset) => xttProjectedPoint(roi, wellById.get(roi.id), homography, offset)
  }).map((feature) => roiFeatureToWellFeature(feature, wellById.get(feature.roiId)));
}

export function sampleWellFeature(
  imageData: ImageData,
  well: WellGeometry,
  homography: Homography,
  blankLinearB = 1,
  blankGreenBlue = 1
): WellFeature {
  const roi = wellToRoiGeometry(well);
  return roiFeatureToWellFeature(
    sampleRoiFeature(imageData, roi, {
      blankLinearB,
      blankGreenBlue,
      offsetToImagePoint: (_roi, offset) => xttProjectedPoint(roi, well, homography, offset)
    }),
    well
  );
}

function wellToRoiGeometry(well: WellGeometry): RoiGeometry {
  return {
    id: well.well,
    label: well.well,
    row: well.row,
    col: well.col,
    center: well.center,
    radiusX: well.analysisRadius,
    radiusY: well.analysisRadius,
    overlayRadiusX: well.overlayRadius,
    overlayRadiusY: well.overlayRadius
  };
}

function xttProjectedPoint(
  roi: RoiGeometry,
  well: WellGeometry | undefined,
  homography: Homography,
  offset: RoiSamplingOffset
): { x: number; y: number } {
  if (!well) {
    return {
      x: roi.center.x + offset.x * roi.radiusX,
      y: roi.center.y + offset.y * roi.radiusY
    };
  }
  const radiusInGridUnits = Math.max(
    0.18,
    Math.min(0.34, well.analysisRadius / Math.max(Math.min(well.localPitchX, well.localPitchY), 1))
  );
  const expectedCenter = applyHomography(homography, { x: well.col, y: well.row });
  const manualOffset = {
    x: well.center.x - expectedCenter.x,
    y: well.center.y - expectedCenter.y
  };
  const imagePoint = applyHomography(homography, {
    x: well.col + offset.x * radiusInGridUnits,
    y: well.row + offset.y * radiusInGridUnits
  });
  return {
    x: imagePoint.x + manualOffset.x,
    y: imagePoint.y + manualOffset.y
  };
}

function roiFeatureToWellFeature(feature: RoiFeature, well: WellGeometry | undefined): WellFeature {
  return {
    ...feature,
    well: well?.well ?? feature.roiId,
    row: well?.row ?? feature.row,
    col: well?.col ?? feature.col
  };
}
