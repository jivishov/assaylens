import {
  BarChart3,
  CheckCircle2,
  Circle,
  CircleDot,
  FlaskConical,
  Image as ImageIcon,
  Map,
  RotateCcw
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnalysisDashboard } from "../components/AnalysisDashboard";
import { GeminiKeyPanel } from "../components/GeminiKeyPanel";
import { PlateMapEditor } from "../components/PlateMapEditor";
import { ReportExport } from "../components/ReportExport";
import { SpotMapEditor } from "../components/SpotMapEditor";
import { UploadStep } from "../components/UploadStep";
import { WellAlignmentCanvas } from "../components/WellAlignmentCanvas";
import { workflowSteps, type WorkflowStep } from "./routes";
import { detectPlateAnchorsWithGemini } from "../core/gemini/geminiClient";
import type { LoadedImage } from "../core/image/imageLoader";
import type { GeminiModelId } from "../core/gemini/modelCatalog";
import { hasCompleteAnchors } from "../core/geometry/geometryValidation";
import { createEmptyPlateMap } from "../core/plateMap/plateMapTypes";
import { validatePlateMap } from "../core/plateMap/plateMapValidation";
import { createEmptySpotMap, resizeSpotMap } from "../core/assays/agarSpot/spotMapTypes";
import { validateSpotMap } from "../core/assays/agarSpot/spotMapValidation";
import { DEFAULT_SPOT_GRID_SETTINGS, normalizedSpotGridSettings } from "../core/assays/agarSpot/spotGrid";
import { analysisBlockers } from "../core/analysis/qc";
import type { AnalysisResult, AssayMode, GeometryState, ProjectFile } from "../core/types";
import type { ImageAnalysisWorkerResponse } from "../workers/imageAnalysis.worker";

function createDefaultGeometry(): GeometryState {
  return {
    anchors: {},
    confirmed: false,
    a1Position: "top_left",
    analysisRadiusFactor: 0.27,
    overlayRadiusFactor: 0.36,
    wellAdjustments: {},
    spotGrid: { ...DEFAULT_SPOT_GRID_SETTINGS, roiAdjustments: {} }
  };
}

export function App() {
  const [step, setStep] = useState<WorkflowStep>("image");
  const [assayMode, setAssayMode] = useState<AssayMode>("xtt_96well_mic");
  const [image, setImage] = useState<LoadedImage | undefined>();
  const [geometry, setGeometry] = useState<GeometryState>(() => createDefaultGeometry());
  const [plateMap, setPlateMap] = useState(createEmptyPlateMap);
  const [spotMap, setSpotMap] = useState(() => createEmptySpotMap(DEFAULT_SPOT_GRID_SETTINGS.rows, DEFAULT_SPOT_GRID_SETTINGS.columns));
  const [analysis, setAnalysis] = useState<AnalysisResult | undefined>();
  const [threshold, setThreshold] = useState(0.1);
  const [spotDilutionOverride, setSpotDilutionOverride] = useState<number | undefined>();
  const [spotReferenceControlGroupId, setSpotReferenceControlGroupId] = useState<string | undefined>();
  const [runningAnalysis, setRunningAnalysis] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const analysisWorkerRef = useRef<Worker | null>(null);

  const spotGridSettings = useMemo(() => normalizedSpotGridSettings(geometry.spotGrid), [geometry.spotGrid]);
  const plateMapValidation = useMemo(() => validatePlateMap(plateMap), [plateMap]);
  const spotMapValidation = useMemo(() => validateSpotMap(spotMap), [spotMap]);
  const spotControlGroupIds = useMemo(
    () =>
      [...new Set(spotMap.filter((cell) => cell.role === "control").map((cell) => cell.groupId.trim()).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b)
      ),
    [spotMap]
  );
  const activeValidation = assayMode === "agar_spot_growth" ? spotMapValidation : plateMapValidation;
  const blockers = useMemo(() => {
    const base = analysisBlockers(geometry, activeValidation, assayMode);
    if (!image) {
      base.unshift("Load original image pixels by upload or camera capture before running analysis.");
    }
    return base;
  }, [activeValidation, assayMode, geometry, image]);

  useEffect(() => {
    setSpotMap((current) => resizeSpotMap(current, spotGridSettings.rows, spotGridSettings.columns));
  }, [spotGridSettings.rows, spotGridSettings.columns]);

  function resetProject() {
    terminateAnalysisWorker();
    if (image?.url) {
      URL.revokeObjectURL(image.url);
    }
    setImage(undefined);
    setGeometry(createDefaultGeometry());
    setPlateMap(createEmptyPlateMap());
    setSpotMap(createEmptySpotMap(DEFAULT_SPOT_GRID_SETTINGS.rows, DEFAULT_SPOT_GRID_SETTINGS.columns));
    setAnalysis(undefined);
    setThreshold(0.1);
    setSpotDilutionOverride(undefined);
    setSpotReferenceControlGroupId(undefined);
    setRunningAnalysis(false);
    setAnalysisError("");
    setStep("image");
  }

  function handleAssayModeChange(nextMode: AssayMode) {
    if (nextMode === assayMode) {
      return;
    }
    terminateAnalysisWorker();
    setAssayMode(nextMode);
    setGeometry(createDefaultGeometry());
    setPlateMap(createEmptyPlateMap());
    setSpotMap(createEmptySpotMap(DEFAULT_SPOT_GRID_SETTINGS.rows, DEFAULT_SPOT_GRID_SETTINGS.columns));
    setAnalysis(undefined);
    setAnalysisError("");
    setRunningAnalysis(false);
    setSpotDilutionOverride(undefined);
    setSpotReferenceControlGroupId(undefined);
    setStep("image");
  }

  function handleImageLoaded(nextImage: LoadedImage) {
    terminateAnalysisWorker();
    if (image?.url) {
      URL.revokeObjectURL(image.url);
    }
    setImage(nextImage);
    setGeometry(createDefaultGeometry());
    setAnalysis(undefined);
    setRunningAnalysis(false);
    setAnalysisError("");
    setStep("wells");
  }

  function handleProjectImported(project: ProjectFile) {
    terminateAnalysisWorker();
    if (image?.url) {
      URL.revokeObjectURL(image.url);
    }
    setImage(undefined);
    setAssayMode(project.assayMode);
    setGeometry({
      ...createDefaultGeometry(),
      ...project.geometry,
      anchors: project.geometry.anchors ?? {},
      wellAdjustments: project.geometry.wellAdjustments ?? {},
      spotGrid: normalizedSpotGridSettings(project.geometry.spotGrid)
    });
    if (project.assayMode === "agar_spot_growth") {
      setSpotMap(project.roiMap);
      setPlateMap(createEmptyPlateMap());
      setSpotDilutionOverride(project.analysisSettings.dilutionOverride);
      setSpotReferenceControlGroupId(project.analysisSettings.referenceControlGroupId);
    } else {
      setPlateMap(project.roiMap);
      setSpotMap(createEmptySpotMap(DEFAULT_SPOT_GRID_SETTINGS.rows, DEFAULT_SPOT_GRID_SETTINGS.columns));
      setThreshold(project.analysisSettings.threshold);
      setSpotDilutionOverride(undefined);
      setSpotReferenceControlGroupId(undefined);
    }
    setRunningAnalysis(false);
    setAnalysisError("");
    setAnalysis(project.analysisResult);
    setStep(project.analysisResult ? "report" : "wells");
  }

  function terminateAnalysisWorker() {
    analysisWorkerRef.current?.terminate();
    analysisWorkerRef.current = null;
  }

  async function runGeminiDetection(apiKey: string, model: GeminiModelId) {
    if (!image) {
      throw new Error("Load an image by upload or camera capture first.");
    }
    const result = await detectPlateAnchorsWithGemini(image.file, apiKey, model, image.metadata.width, image.metadata.height);
    if (result.lowConfidence) {
      const approved = window.confirm("Gemini returned one or more low-confidence anchors. Apply them for manual review?");
      if (!approved) {
        return;
      }
    }
    setGeometry({
      ...geometry,
      anchors: result.anchors,
      a1Position: result.detection.a1Position,
      confirmed: false,
      wellAdjustments: {}
    });
  }

  function runAnalysis() {
    if (!image || blockers.length > 0 || !hasCompleteAnchors(geometry.anchors)) {
      setAnalysisError(blockers.join(" "));
      return;
    }

    setRunningAnalysis(true);
    setAnalysisError("");
    terminateAnalysisWorker();
    const worker = new Worker(new URL("../workers/imageAnalysis.worker.ts", import.meta.url), { type: "module" });
    analysisWorkerRef.current = worker;
    worker.onmessage = (event: MessageEvent<ImageAnalysisWorkerResponse>) => {
      if (analysisWorkerRef.current !== worker) {
        worker.terminate();
        return;
      }
      if (event.data.type === "complete") {
        setAnalysis(event.data.result);
        setStep("analysis");
      } else {
        setAnalysisError(event.data.message);
      }
      setRunningAnalysis(false);
      analysisWorkerRef.current = null;
      worker.terminate();
    };
    worker.onerror = (event) => {
      if (analysisWorkerRef.current !== worker) {
        worker.terminate();
        return;
      }
      setAnalysisError(event.message || "Worker analysis failed.");
      setRunningAnalysis(false);
      analysisWorkerRef.current = null;
      worker.terminate();
    };

    if (assayMode === "agar_spot_growth") {
      worker.postMessage({
        type: "analyze",
        assayMode,
        imageData: image.imageData,
        geometry,
        roiMap: spotMap,
        settings: {
          referenceControlGroupId: spotReferenceControlGroupId,
          dilutionOverride: spotDilutionOverride
        },
        inputWarnings: image.metadata.warningCodes
      });
      return;
    }

    worker.postMessage({
      type: "analyze",
      assayMode,
      imageData: image.imageData,
      geometry,
      roiMap: plateMap,
      settings: {
        threshold
      },
      inputWarnings: image.metadata.warningCodes
    });
  }

  function stepStatus(id: WorkflowStep): "complete" | "active" | "pending" {
    if (id === step) {
      return "active";
    }
    if (id === "image") {
      return image || analysis ? "complete" : "pending";
    }
    if (id === "wells") {
      return geometry.confirmed ? "complete" : "pending";
    }
    if (id === "plateMap") {
      return activeValidation.valid ? "complete" : "pending";
    }
    if (id === "analysis") {
      return analysis ? "complete" : "pending";
    }
    return analysis ? "complete" : "pending";
  }

  function workflowLabel(id: WorkflowStep): string {
    if (assayMode === "agar_spot_growth") {
      if (id === "wells") {
        return "ROIs";
      }
      if (id === "plateMap") {
        return "Spot Map";
      }
      if (id === "analysis") {
        return "Relative Growth";
      }
    }
    return workflowSteps.find((item) => item.id === id)?.label ?? id;
  }

  const isSpot = assayMode === "agar_spot_growth";

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-mark" aria-hidden="true">
              {Array.from({ length: 16 }, (_item, index) => (
                <span key={index} />
              ))}
            </div>
            <div>
              <strong>AssayLens</strong>
              <span>v0.2.0</span>
            </div>
          </div>
          <nav className="stepper" aria-label="Workflow">
            {workflowSteps.map((item, index) => {
              const status = stepStatus(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`stepper-item ${status}`}
                  aria-current={status === "active" ? "step" : undefined}
                  onClick={() => setStep(item.id)}
                >
                  <span className="step-number">{status === "complete" ? <CheckCircle2 size={18} /> : index + 1}</span>
                  <span>{workflowLabel(item.id)}</span>
                  {status === "pending" && <Circle size={10} />}
                </button>
              );
            })}
          </nav>
          <div className="sidebar-status">
            <div>
              <ImageIcon size={17} />
              <span>{image ? "Image loaded" : analysis ? "Project imported" : "No image"}</span>
            </div>
            <div>
              {isSpot ? <CircleDot size={17} /> : <FlaskConical size={17} />}
              <span>{activeValidation.valid ? "Map ready" : "Map incomplete"}</span>
            </div>
            <div>
              <BarChart3 size={17} />
              <span>{analysis ? "Results ready" : "No results"}</span>
            </div>
          </div>
        </aside>

        <main className="main-area" id="main-content">
          <header className="topbar">
            <div>
              <h1>{isSpot ? "STAR-inspired agar spot-growth analysis" : "XTT image-derived MIC analysis"}</h1>
              <p>
                {isSpot
                  ? "Browser-only spot ROI workflow with explicit background controls and relative-growth summaries."
                  : "Browser-only 96-well workflow with confirmed geometry, explicit controls, and reproducible exports."}
              </p>
            </div>
            <div className="topbar-actions">
              <button className="secondary-button" type="button" onClick={() => setStep("image")}>
                <ImageIcon size={16} /> Image
              </button>
              <button className="secondary-button" type="button" onClick={() => setStep("analysis")}>
                <BarChart3 size={16} /> {isSpot ? "Growth" : "Analysis"}
              </button>
              <button className="secondary-button" type="button" onClick={() => setStep("report")}>
                <Map size={16} /> Exports
              </button>
              <button className="icon-button" type="button" onClick={resetProject} title="Reset project" aria-label="Reset project">
                <RotateCcw size={17} />
              </button>
            </div>
          </header>

          {step === "image" && (
            <UploadStep
              image={image}
              assayMode={assayMode}
              onAssayModeChange={handleAssayModeChange}
              onImageLoaded={handleImageLoaded}
              onProjectImported={handleProjectImported}
              onReset={resetProject}
            />
          )}

          {step === "wells" && (
            <div className="wells-screen">
              <WellAlignmentCanvas
                image={image}
                assayMode={assayMode}
                geometry={geometry}
                plateMap={plateMap}
                spotMap={spotMap}
                onGeometryChange={setGeometry}
                footerAction={
                  <button className="secondary-button plate-map-continue-button" type="button" disabled={!geometry.confirmed} onClick={() => setStep("plateMap")}>
                    <Map size={16} /> {isSpot ? "Continue to spot map" : "Continue to plate map"}
                  </button>
                }
                sideExtras={isSpot ? undefined : <GeminiKeyPanel disabled={!image} onDetect={runGeminiDetection} />}
              />
            </div>
          )}

          {step === "plateMap" &&
            (isSpot ? (
              <SpotMapEditor
                spotMap={spotMap}
                rows={spotGridSettings.rows}
                columns={spotGridSettings.columns}
                onSpotMapChange={setSpotMap}
                actions={
                  <>
                    <button className="secondary-button" type="button" onClick={() => setStep("wells")}>
                      Back to ROIs
                    </button>
                    <button className="primary-button" type="button" disabled={!spotMapValidation.valid} onClick={() => setStep("analysis")}>
                      Continue to growth
                    </button>
                  </>
                }
              />
            ) : (
              <PlateMapEditor
                plateMap={plateMap}
                onPlateMapChange={setPlateMap}
                actions={
                  <>
                    <button className="secondary-button" type="button" onClick={() => setStep("wells")}>
                      Back to wells
                    </button>
                    <button className="primary-button" type="button" disabled={!plateMapValidation.valid} onClick={() => setStep("analysis")}>
                      Continue to analysis
                    </button>
                  </>
                }
              />
            ))}

          {step === "analysis" && (
            <AnalysisDashboard
              assayMode={assayMode}
              result={analysis}
              blockers={blockers}
              running={runningAnalysis}
              error={analysisError}
              threshold={threshold}
              onThresholdChange={setThreshold}
              spotDilutionOverride={spotDilutionOverride}
              onSpotDilutionOverrideChange={setSpotDilutionOverride}
              spotControlGroupIds={spotControlGroupIds}
              spotReferenceControlGroupId={spotReferenceControlGroupId}
              onSpotReferenceControlGroupChange={setSpotReferenceControlGroupId}
              onRun={runAnalysis}
            />
          )}

          {step === "report" && (
            <ReportExport
              image={image}
              assayMode={assayMode}
              geometry={geometry}
              plateMap={plateMap}
              spotMap={spotMap}
              spotDilutionOverride={spotDilutionOverride}
              spotReferenceControlGroupId={spotReferenceControlGroupId}
              analysis={analysis}
            />
          )}
        </main>
      </div>
    </>
  );
}
