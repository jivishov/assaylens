import { DEFAULT_SPOT_GRID_SETTINGS } from "../core/assays/agarSpot/spotGrid";
import { geometryFingerprint } from "../core/geometry/geometryValidation";
import { buildGridHomography, generatePlateGrid } from "../core/geometry/plateGrid";
import { loadImageFile, type LoadedImage } from "../core/image/imageLoader";
import type { GeometryState, PlateAnchors } from "../core/types";

export const XTT_WEBMCP_DEMO_ANCHORS: PlateAnchors = {
  A1: { x: 120, y: 105 },
  A12: { x: 880, y: 105 },
  H12: { x: 880, y: 575 },
  H1: { x: 120, y: 575 }
};

export type XttWebMcpDemo = {
  image: LoadedImage;
  geometry: GeometryState;
};

export async function createXttWebMcpDemo(): Promise<XttWebMcpDemo> {
  const width = 1000;
  const height = 680;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable for the synthetic WebMCP demo.");

  ctx.fillStyle = "#edf1f4";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#d7dce0";
  ctx.fillRect(55, 45, 890, 590);

  const homography = buildGridHomography(XTT_WEBMCP_DEMO_ANCHORS);
  const grid = generatePlateGrid(homography, 0.27, 0.36);
  for (const well of grid) {
    let intensity = 0.28;
    if (well.row <= 1 && well.col <= 7) intensity = 0.2 + well.col * 0.09;
    if (well.row === 7 && well.col <= 1) intensity = 0.92;
    if (well.row === 7 && (well.col === 2 || well.col === 3)) intensity = 0.08;

    ctx.beginPath();
    ctx.arc(well.center.x, well.center.y, Math.max(18, well.overlayRadius * 0.88), 0, Math.PI * 2);
    ctx.fillStyle = `rgb(${Math.round(220 + 25 * intensity)}, ${Math.round(105 + 125 * intensity)}, ${Math.round(25 + 25 * intensity)})`;
    ctx.fill();
    ctx.strokeStyle = "#6f7680";
    ctx.lineWidth = 2;
    ctx.stroke();

    if (well.well === "B5") {
      ctx.beginPath();
      ctx.arc(
        well.center.x + well.analysisRadius * 0.25,
        well.center.y - well.analysisRadius * 0.25,
        well.analysisRadius * 0.72,
        0,
        Math.PI * 2
      );
      ctx.fillStyle = "#ffffff";
      ctx.fill();
    }
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Could not encode the synthetic WebMCP demo image.");
  const file = new File([blob], "assaylens-webmcp-synthetic-demo.png", {
    type: "image/png",
    lastModified: 0
  });
  const image = await loadImageFile(file);
  const geometry: GeometryState = {
    anchors: XTT_WEBMCP_DEMO_ANCHORS,
    confirmed: true,
    a1Position: "top_left",
    analysisRadiusFactor: 0.27,
    overlayRadiusFactor: 0.36,
    wellAdjustments: {},
    spotGrid: { ...DEFAULT_SPOT_GRID_SETTINGS, roiAdjustments: {} },
    agarOrientationConfirmed: false,
    confirmationFingerprint: undefined
  };
  geometry.confirmationFingerprint = geometryFingerprint(geometry);
  return { image, geometry };
}
