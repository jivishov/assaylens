import { Download, FileJson, FileText, Image as ImageIcon, Table2 } from "lucide-react";
import type { AnalysisResult, AssayMode, GeometryState, PlateAnchors } from "../core/types";
import type { LoadedImage } from "../core/image/imageLoader";
import type { PlateMapCell } from "../core/plateMap/plateMapTypes";
import type { SpotMapCell } from "../core/assays/agarSpot/spotMapTypes";
import { buildGridHomography, generatePlateGrid } from "../core/geometry/plateGrid";
import { hasCompleteAnchors } from "../core/geometry/geometryValidation";
import { generateSpotGrid } from "../core/assays/agarSpot/spotGrid";
import {
  featuresToCsv,
  micResultsToCsv,
  plateMapToCsv,
  roiFeaturesToCsv,
  spotAnalysisToCsv,
  spotDilutionSummariesToCsv,
  spotMapToCsv,
  wellAnalysisToCsv
} from "../core/io/csv";
import { buildProjectFile, downloadText } from "../core/io/projectFile";
import {
  buildAnnotatedSvg,
  buildHtmlReport,
  spotMapToAnnotatedMap,
  spotRoleColors,
  spotRoisToAnnotatedRois,
  xttMapToAnnotatedMap,
  xttRoleColors,
  xttWellsToAnnotatedRois
} from "../core/io/reportExport";

type ReportExportProps = {
  image?: LoadedImage;
  assayMode: AssayMode;
  geometry: GeometryState;
  plateMap: PlateMapCell[];
  spotMap: SpotMapCell[];
  spotDilutionOverride?: number;
  spotReferenceControlGroupId?: string;
  analysis?: AnalysisResult;
};

export function ReportExport({
  image,
  assayMode,
  geometry,
  plateMap,
  spotMap,
  spotDilutionOverride,
  spotReferenceControlGroupId,
  analysis
}: ReportExportProps) {
  const canExportOverlay = image && hasCompleteAnchors(geometry.anchors);
  const isSpot = assayMode === "agar_spot_growth";

  function exportProjectJson() {
    const project = buildProjectFile({
      assayMode,
      imageMetadata: image?.metadata,
      geometry,
      plateMap,
      spotMap,
      analysis,
      analysisSettings:
        analysis?.settings ??
        (assayMode === "xtt_96well_mic"
          ? { threshold: 0.1 }
          : { dilutionOverride: spotDilutionOverride, referenceControlGroupId: spotReferenceControlGroupId }),
      qcFlags:
        analysis?.kind === "xtt_96well_mic"
          ? analysis.wells.flatMap((well) => well.qcFlags)
          : analysis?.kind === "agar_spot_growth"
            ? analysis.spots.flatMap((spot) => spot.qcFlags)
            : []
    });
    downloadText(isSpot ? "assaylens-agar-spot-project.json" : "assaylens-xtt-mic-project.json", JSON.stringify(project, null, 2), "application/json");
  }

  function exportAnnotatedSvg() {
    if (!image || !hasCompleteAnchors(geometry.anchors)) {
      return;
    }
    if (isSpot) {
      const rois = generateSpotGrid(geometry.anchors as PlateAnchors, geometry.spotGrid);
      downloadText(
        "assaylens-agar-spot-annotated-rois.svg",
        buildAnnotatedSvg({
          imageWidth: image.metadata.width,
          imageHeight: image.metadata.height,
          anchors: geometry.anchors as PlateAnchors,
          rois: spotRoisToAnnotatedRois(rois),
          roiMap: spotMapToAnnotatedMap(spotMap),
          roleColors: spotRoleColors()
        }),
        "image/svg+xml"
      );
      return;
    }
    const homography = buildGridHomography(geometry.anchors as PlateAnchors);
    const wells = generatePlateGrid(homography, geometry.analysisRadiusFactor, geometry.overlayRadiusFactor).map((well) => {
      const adjustment = geometry.wellAdjustments[well.well];
      return adjustment ? { ...well, center: { x: well.center.x + adjustment.x, y: well.center.y + adjustment.y } } : well;
    });
    downloadText(
      "assaylens-annotated-wells.svg",
      buildAnnotatedSvg({
        imageWidth: image.metadata.width,
        imageHeight: image.metadata.height,
        anchors: geometry.anchors as PlateAnchors,
        rois: xttWellsToAnnotatedRois(wells),
        roiMap: xttMapToAnnotatedMap(plateMap),
        roleColors: xttRoleColors()
      }),
      "image/svg+xml"
    );
  }

  return (
    <section className="surface-panel report-panel">
      <div className="panel-heading">
        <div>
          <h2>Report</h2>
          <p>
            {isSpot
              ? "Exports include geometry, spot map, ROI features, STAR-inspired density summaries, QC flags, and input warning codes."
              : "Exports include geometry, plate map, settings, features, normalization references, MIC results, QC flags, and input warning codes."}
          </p>
        </div>
      </div>
      <div className="export-grid">
        <button className="export-button" type="button" onClick={exportProjectJson}>
          <FileJson size={22} />
          <span>Project JSON</span>
          <small>Re-importable numeric record</small>
        </button>
        {analysis?.kind === "agar_spot_growth" ? (
          <>
            <button className="export-button" type="button" onClick={() => downloadText("assaylens-agar-spot-per-roi-features.csv", roiFeaturesToCsv(analysis.features), "text/csv")}>
              <Table2 size={22} />
              <span>Per-ROI features CSV</span>
              <small>RGB, density, QC</small>
            </button>
            <button className="export-button" type="button" onClick={() => downloadText("assaylens-agar-spot-map.csv", spotMapToCsv(spotMap), "text/csv")}>
              <Table2 size={22} />
              <span>Spot map CSV</span>
              <small>Groups, replicates, roles</small>
            </button>
            <button className="export-button" type="button" onClick={() => downloadText("assaylens-agar-spot-analysis.csv", spotAnalysisToCsv(analysis.spots), "text/csv")}>
              <Table2 size={22} />
              <span>Spot analysis CSV</span>
              <small>Density per ROI</small>
            </button>
            <button
              className="export-button"
              type="button"
              onClick={() => downloadText("assaylens-agar-spot-relative-growth.csv", spotDilutionSummariesToCsv(analysis.summaries), "text/csv")}
            >
              <Download size={22} />
              <span>Relative growth CSV</span>
              <small>Group+dilution summaries</small>
            </button>
          </>
        ) : (
          <>
            <button
              className="export-button"
              type="button"
              disabled={analysis?.kind !== "xtt_96well_mic"}
              onClick={() => analysis?.kind === "xtt_96well_mic" && downloadText("assaylens-per-well-features.csv", featuresToCsv(analysis.features), "text/csv")}
            >
              <Table2 size={22} />
              <span>Per-well features CSV</span>
              <small>RGB, Lab, HSV, QC</small>
            </button>
            <button
              className="export-button"
              type="button"
              disabled={analysis?.kind !== "xtt_96well_mic"}
              onClick={() => analysis?.kind === "xtt_96well_mic" && downloadText("assaylens-per-well-analysis.csv", wellAnalysisToCsv(analysis.wells), "text/csv")}
            >
              <Table2 size={22} />
              <span>Per-well analysis CSV</span>
              <small>Signal, viability, inhibition</small>
            </button>
            <button
              className="export-button"
              type="button"
              disabled={analysis?.kind !== "xtt_96well_mic"}
              onClick={() => analysis?.kind === "xtt_96well_mic" && downloadText("assaylens-mic-summary.csv", micResultsToCsv(analysis.micResults), "text/csv")}
            >
              <Download size={22} />
              <span>MIC CSV</span>
              <small>Observed and isotonic MIC</small>
            </button>
            <button className="export-button" type="button" onClick={() => downloadText("assaylens-plate-map.csv", plateMapToCsv(plateMap), "text/csv")}>
              <Table2 size={22} />
              <span>Plate-map CSV</span>
              <small>Roles and concentrations</small>
            </button>
          </>
        )}
        <button className="export-button" type="button" disabled={!canExportOverlay} onClick={exportAnnotatedSvg}>
          <ImageIcon size={22} />
          <span>Annotated SVG</span>
          <small>{isSpot ? "ROIs and role colors" : "Wells and role colors"}</small>
        </button>
        <button
          className="export-button"
          type="button"
          disabled={!analysis}
          onClick={() =>
            analysis &&
            downloadText(
              isSpot ? "assaylens-agar-spot-report.html" : "assaylens-xtt-mic-report.html",
              buildHtmlReport({ analysis, roiMap: isSpot ? spotMap : plateMap, imageName: image?.metadata.name }),
              "text/html"
            )
          }
        >
          <FileText size={22} />
          <span>HTML report</span>
          <small>Standalone summary</small>
        </button>
      </div>
      <div className="report-disclosure">
        Project exports never include local file paths, SHA256 hashes, vendor file IDs, API keys, or private attachment metadata.
      </div>
    </section>
  );
}
