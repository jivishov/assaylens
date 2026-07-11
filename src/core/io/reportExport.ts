import type { AnalysisResult, PlateAnchors, WellGeometry } from "../types";
import type { PlateMapCell } from "../plateMap/plateMapTypes";
import { ROLE_COLORS } from "../plateMap/plateMapTypes";
import type { SpotMapCell } from "../assays/agarSpot/spotMapTypes";
import { SPOT_ROLE_COLORS } from "../assays/agarSpot/spotMapTypes";
import type { RoiGeometry } from "../roi/roiTypes";
import { rowsToCsv } from "./csv";

type AnnotatedRoi = {
  id: string;
  label: string;
  center: {
    x: number;
    y: number;
  };
  radiusX: number;
  radiusY: number;
  row: number;
  col: number;
};

type AnnotatedMapCell = {
  id: string;
  role: string;
};

export function buildHtmlReport(params: {
  analysis: AnalysisResult;
  roiMap: PlateMapCell[] | SpotMapCell[];
  imageName?: string;
}): string {
  return params.analysis.kind === "agar_spot_growth"
    ? buildSpotHtmlReport({ analysis: params.analysis, imageName: params.imageName })
    : buildXttHtmlReport({ analysis: params.analysis, imageName: params.imageName });
}

export function buildAnnotatedSvg(params: {
  imageWidth: number;
  imageHeight: number;
  anchors: PlateAnchors;
  rois: AnnotatedRoi[];
  roiMap: AnnotatedMapCell[];
  roleColors: Record<string, string>;
}): string {
  const roleById = new Map(params.roiMap.map((cell) => [cell.id, cell.role]));
  const ellipses = params.rois
    .map((roi) => {
      const role = roleById.get(roi.id) ?? "unused";
      const color = params.roleColors[role] ?? "#a5adb8";
      return `<ellipse cx="${roi.center.x.toFixed(2)}" cy="${roi.center.y.toFixed(2)}" rx="${roi.radiusX.toFixed(
        2
      )}" ry="${roi.radiusY.toFixed(2)}" fill="none" stroke="${color}" stroke-width="2"><title>${escapeHtml(
        roi.label
      )}</title></ellipse>`;
    })
    .join("\n");
  const labels = params.rois
    .filter((roi) => roi.row === 0 || roi.col === 0)
    .map(
      (roi) =>
        `<text x="${roi.center.x.toFixed(2)}" y="${(roi.center.y - roi.radiusY - 4).toFixed(
          2
        )}" font-size="12" text-anchor="middle" fill="#14202a">${escapeHtml(roi.label)}</text>`
    )
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${params.imageWidth}" height="${params.imageHeight}" viewBox="0 0 ${params.imageWidth} ${params.imageHeight}">
  <rect width="100%" height="100%" fill="none"/>
  ${ellipses}
  ${labels}
</svg>`;
}

export function xttWellsToAnnotatedRois(wells: WellGeometry[]): AnnotatedRoi[] {
  return wells.map((well) => ({
    id: well.well,
    label: well.well,
    center: well.center,
    radiusX: well.overlayRadius,
    radiusY: well.overlayRadius,
    row: well.row,
    col: well.col
  }));
}

export function spotRoisToAnnotatedRois(rois: RoiGeometry[]): AnnotatedRoi[] {
  return rois.map((roi) => ({
    id: roi.id,
    label: roi.label ?? roi.id,
    center: roi.center,
    radiusX: roi.overlayRadiusX ?? roi.radiusX,
    radiusY: roi.overlayRadiusY ?? roi.radiusY,
    row: roi.row,
    col: roi.col
  }));
}

export function xttMapToAnnotatedMap(plateMap: PlateMapCell[]): AnnotatedMapCell[] {
  return plateMap.map((cell) => ({ id: cell.well, role: cell.role }));
}

export function spotMapToAnnotatedMap(spotMap: SpotMapCell[]): AnnotatedMapCell[] {
  return spotMap.map((cell) => ({ id: cell.id, role: cell.role }));
}

export function xttRoleColors(): Record<string, string> {
  return ROLE_COLORS;
}

export function spotRoleColors(): Record<string, string> {
  return SPOT_ROLE_COLORS;
}

export function mapPreviewCsv(plateMap: PlateMapCell[]): string {
  return rowsToCsv([
    ["well", "role", "compound_id", "sample_id", "concentration", "unit"],
    ...plateMap.map((cell) => [
      cell.well,
      cell.role,
      cell.compoundId,
      cell.sampleId,
      cell.concentration == null ? "" : String(cell.concentration),
      cell.unit
    ])
  ]);
}

function buildXttHtmlReport(params: {
  analysis: Extract<AnalysisResult, { kind: "xtt_96well_mic" }>;
  imageName?: string;
}): string {
  const micRows = params.analysis.micResults
    .map(
      (result) =>
        `<tr><td>${escapeHtml(result.compoundId)}</td><td>${escapeHtml(result.sampleId)}</td><td>${escapeHtml(
          result.observedMicLabel
        )}</td><td>${escapeHtml(result.isotonicMicLabel)}</td><td>${escapeHtml(result.status)}</td></tr>`
    )
    .join("");

  return htmlPage({
    title: "AssayLens XTT Relative Metabolic Activity Report",
    body: `
  <h1>AssayLens XTT Relative Metabolic Activity Report</h1>
  <div class="meta">Image: ${escapeHtml(params.imageName ?? "project import")} | Generated: ${escapeHtml(
    params.analysis.generatedAt
  )} | Metric: ${escapeHtml(params.analysis.normalization.selectedMetric)}</div>
  <p class="meta">Claim level: ${escapeHtml(params.analysis.provenance?.claimLevel ?? "exploratory")} | Protocol: ${escapeHtml(params.analysis.protocolId ?? "unrecorded")}. XTT image signal is not a direct viable-cell count.</p>
  <h2>Observed image-derived endpoint summary</h2>
  <table>
    <thead><tr><th>Compound</th><th>Sample</th><th>Observed image endpoint</th><th>Model-assisted endpoint</th><th>Status</th></tr></thead>
    <tbody>${micRows}</tbody>
  </table>`
  });
}

function buildSpotHtmlReport(params: {
  analysis: Extract<AnalysisResult, { kind: "agar_spot_growth" }>;
  imageName?: string;
}): string {
  const rows = params.analysis.summaries
    .map(
      (summary) =>
        `<tr><td>${escapeHtml(summary.role)}</td><td>${escapeHtml(summary.groupId)}</td><td>${escapeHtml(
          summary.referenceControlGroupId
        )}</td><td>${summary.relativeInoculum ?? ""}</td><td>${summary.biologicalCount ?? summary.n}</td><td>${numberCell(summary.medianEndpointSpotSignal ?? summary.meanDensity)}</td><td>${numberCell(summary.cv)}</td><td>${numberCell(
          summary.relativeEndpointSpotSignal ?? summary.relativeGrowth
        )}</td><td>${escapeHtml(summary.warnings.join("; "))}</td></tr>`
    )
    .join("");

  return htmlPage({
    title: "AssayLens Agar Endpoint Spot Densitometry Report",
    body: `
  <h1>AssayLens Agar Endpoint Spot Densitometry Report</h1>
  <div class="meta">Image: ${escapeHtml(params.imageName ?? "project import")} | Generated: ${escapeHtml(
    params.analysis.generatedAt
  )} | Background density: ${numberCell(params.analysis.qc.medianBackgroundDensity)} | Reference control: ${escapeHtml(
    params.analysis.qc.referenceControlGroupId ?? "none"
  )}</div>
  <p class="meta">Claim level: ${escapeHtml(params.analysis.provenance?.claimLevel ?? "exploratory")} | Protocol: ${escapeHtml(params.analysis.protocolId ?? "unrecorded")}. A single image measures endpoint spot signal, not growth rate.</p>
  <h2>Relative endpoint spot-signal summary</h2>
  <table>
    <thead><tr><th>Role</th><th>Condition</th><th>Reference control</th><th>Relative inoculum</th><th>Biological n</th><th>Median endpoint signal</th><th>CV</th><th>Relative endpoint signal</th><th>Warnings</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`
  });
}

function htmlPage(params: { title: string; body: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(params.title)}</title>
  <style>
    body { font-family: Inter, Arial, sans-serif; color: #14202a; margin: 32px; }
    h1 { font-size: 24px; margin: 0 0 8px; }
    table { border-collapse: collapse; width: 100%; margin-top: 18px; font-size: 13px; }
    th, td { border: 1px solid #d8e0e7; padding: 8px; text-align: left; }
    th { background: #f5f8fa; }
    .meta { color: #52606c; font-size: 13px; }
  </style>
</head>
<body>
${params.body}
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function numberCell(value: number): string {
  return Number.isFinite(value) ? value.toPrecision(6) : "";
}
