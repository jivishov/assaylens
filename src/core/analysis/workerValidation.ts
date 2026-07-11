import type { AnalyzeImageMessage } from "../../workers/imageAnalysis.worker";
import { geometryFingerprint, hasCompleteAnchors } from "../geometry/geometryValidation";
import { protocolById } from "../science/protocols";
import { generateSpotGrid, normalizedSpotGridSettings } from "../assays/agarSpot/spotGrid";
import type { PlateAnchors } from "../types";

export function validateAnalyzeImageMessage(message: AnalyzeImageMessage): void {
  const protocol = protocolById(message.protocolId);
  if (!protocol) throw new Error(`Unknown protocol profile: ${message.protocolId}.`);
  if (!message.imageData || message.imageData.width <= 0 || message.imageData.height <= 0) {
    throw new Error("Analysis requires non-empty source pixels.");
  }
  if (message.imageData.data.length !== message.imageData.width * message.imageData.height * 4) {
    throw new Error("ImageData dimensions do not match its pixel buffer.");
  }
  if (!hasCompleteAnchors(message.geometry.anchors)) {
    throw new Error("Analysis requires four complete anchors.");
  }
  if (!message.geometry.confirmed || !message.geometry.confirmationFingerprint) {
    throw new Error("Geometry must be explicitly confirmed before analysis.");
  }
  if (message.geometry.confirmationFingerprint !== geometryFingerprint(message.geometry)) {
    throw new Error("Geometry confirmation is stale.");
  }
  if (message.geometry.a1Position === "uncertain") {
    throw new Error("Plate orientation is uncertain.");
  }
  if (message.assayMode === "xtt_96well_mic") {
    if (protocol.kind !== "xtt") throw new Error("The selected protocol is incompatible with XTT analysis.");
    if (message.roiMap.length !== 96) throw new Error("XTT analysis requires a 96-well map.");
    if (!Number.isFinite(message.settings.threshold) || message.settings.threshold <= 0 || message.settings.threshold >= 1) {
      throw new Error("Endpoint threshold must be between 0 and 1.");
    }
  } else {
    if (protocol.kind !== "agar") throw new Error("The selected protocol is incompatible with agar analysis.");
    if (!message.geometry.agarOrientationConfirmed) throw new Error("Agar grid orientation is not confirmed.");
    if (message.roiMap.length === 0) throw new Error("Agar analysis requires a non-empty ROI map.");
    const settings = normalizedSpotGridSettings(message.geometry.spotGrid);
    if (message.roiMap.length !== settings.rows * settings.columns) throw new Error("Agar ROI map dimensions do not match the confirmed grid.");
    if (Object.values(settings.roiAdjustments).some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y) || Math.abs(point.x) > 0.35 || Math.abs(point.y) > 0.35)) throw new Error("An agar ROI adjustment is non-finite or exceeds 0.35 local pitch.");
    const rois = generateSpotGrid(message.geometry.anchors as PlateAnchors, settings);
    for (const roi of rois) {
      if (![roi.center.x, roi.center.y, roi.radiusX, roi.radiusY].every(Number.isFinite) || Math.PI * roi.radiusX * roi.radiusY < 40) throw new Error(`Agar ROI ${roi.id} has invalid geometry or too few candidate pixels.`);
      if (roi.center.x - roi.radiusX < 0 || roi.center.y - roi.radiusY < 0 || roi.center.x + roi.radiusX >= message.imageData.width || roi.center.y + roi.radiusY >= message.imageData.height) throw new Error(`Agar ROI ${roi.id} is cropped by the image boundary.`);
    }
    for (let i = 0; i < rois.length; i += 1) for (let j = i + 1; j < rois.length; j += 1) {
      const dx = rois[i].center.x - rois[j].center.x, dy = rois[i].center.y - rois[j].center.y;
      if (Math.hypot(dx, dy) < rois[i].radiusX + rois[j].radiusX) throw new Error(`Agar ROIs ${rois[i].id} and ${rois[j].id} overlap.`);
    }
  }
}
