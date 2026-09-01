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
import { loadImageFile, type LoadedImage } from "../core/image/imageLoader";
import type { GeminiModelId } from "../core/gemini/modelCatalog";
import { geometryFingerprint, hasCompleteAnchors } from "../core/geometry/geometryValidation";
import { COLUMNS, parseWellName, ROWS, wellName } from "../core/geometry/plateGrid";
import { createEmptyPlateMap, type PlateMapCell } from "../core/plateMap/plateMapTypes";
import { validatePlateMap } from "../core/plateMap/plateMapValidation";
import { applySerialDilution } from "../core/plateMap/serialDilution";
import { assignControlsAtomic } from "../core/plateMap/assignControls";
import { createEmptySpotMap, resizeSpotMap } from "../core/assays/agarSpot/spotMapTypes";
import { validateSpotMap } from "../core/assays/agarSpot/spotMapValidation";
import { DEFAULT_SPOT_GRID_SETTINGS, normalizedSpotGridSettings } from "../core/assays/agarSpot/spotGrid";
import { analysisBlockers } from "../core/analysis/qc";
import { runImageAnalysisWorker } from "../core/analysis/runImageAnalysisWorker";
import { micResultKey, reviewReason, selectHighestQcPriority } from "../core/analysis/reviewSelection";
import type { AnalysisResult, AssayMode, GeometryState, MicResult, ProjectFile, XttAnalysisResult } from "../core/types";
import { APP_VERSION } from "../core/version";
import { assayLensBridge } from "../webmcp/assayLensBridge";
import {
  XTT_WEBMCP_SCIENTIFIC_CONTEXT,
  roleCounts,
  truncate,
  type AssignControlsInput,
  type ConfigureSeriesInput,
  type FocusReviewInput,
  type LiveAssayLensState
} from "../webmcp/contracts";

function createDefaultGeometry(): GeometryState {
  return {
    anchors: {},
    confirmed: false,
    a1Position: "top_left",
    analysisRadiusFactor: 0.27,
    overlayRadiusFactor: 0.36,
    wellAdjustments: {},
    spotGrid: { ...DEFAULT_SPOT_GRID_SETTINGS, roiAdjustments: {} },
    agarOrientationConfirmed: false,
    confirmationFingerprint: undefined
  };
}

function summarizeSeries(results: MicResult[]) {
  return results.slice(0, 12).map((result) => ({
    key: micResultKey(result),
    compoundId: result.compoundId,
    sampleId: result.sampleId,
    status: result.status,
    observedEndpoint: result.observedMicLabel,
    advisoryFit: result.isotonicMicLabel,
    excludedWellCount: result.concentrations.reduce((sum, point) => sum + point.excludedWellIds.length, 0),
    warningCount: result.warnings.length
  }));
}

function sampleSeries(plateMap: PlateMapCell[]) {
  const grouped = new Map<string, PlateMapCell[]>();
  for (const cell of plateMap.filter((item) => item.role === "sample")) {
    const key = `${cell.compoundId.trim()}::${cell.sampleId.trim()}::${cell.normalizationGroupId.trim()}`;
    grouped.set(key, [...(grouped.get(key) ?? []), cell]);
  }
  return [...grouped.values()].slice(0, 12).map((cells) => ({
    compoundId: cells[0].compoundId,
    sampleId: cells[0].sampleId,
    normalizationGroupId: cells[0].normalizationGroupId,
    wells: cells.map((cell) => cell.well),
    concentrations: [...new Set(cells.map((cell) => cell.concentration).filter((value): value is number => Number.isFinite(value)))].sort((a, b) => b - a),
    unit: cells[0].unit
  }));
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
  const [spotReferenceControlGroupId, setSpotReferenceControlGroupId] = useState<string | undefined>();
  const [runningAnalysis, setRunningAnalysis] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [focusedSeriesKey, setFocusedSeriesKey] = useState<string | undefined>();
  const [reviewNotice, setReviewNotice] = useState<string | undefined>();
  const [isSyntheticDemo, setIsSyntheticDemo] = useState(false);
  const analysisWorkerRef = useRef<Worker | null>(null);

  const spotGridSettings = useMemo(() => normalizedSpotGridSettings(geometry.spotGrid), [geometry.spotGrid]);
  const plateMapValidation = useMemo(() => validatePlateMap(plateMap), [plateMap]);
  const spotMapValidation = useMemo(() => validateSpotMap(spotMap), [spotMap]);
  const spotControlGroupIds = useMemo(
    () => [...new Set(spotMap.filter((cell) => cell.role === "control").map((cell) => cell.groupId.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [spotMap]
  );
  const activeValidation = assayMode === "agar_spot_growth" ? spotMapValidation : plateMapValidation;
  const blockers = useMemo(() => {
    const base = analysisBlockers(geometry, activeValidation, assayMode);
    if (!image) base.unshift("Load original image pixels by upload or camera capture before running analysis.");
    return base;
  }, [activeValidation, assayMode, geometry, image]);

  const liveStateRef = useRef<LiveAssayLensState>({
    assayMode, step, image, geometry, plateMap, validation: plateMapValidation, analysis, runningAnalysis, threshold
  });
  liveStateRef.current = { assayMode, step, image, geometry, plateMap, validation: plateMapValidation, analysis, runningAnalysis, threshold };

  useEffect(() => {
    setSpotMap((current) => resizeSpotMap(current, spotGridSettings.rows, spotGridSettings.columns));
  }, [spotGridSettings.rows, spotGridSettings.columns]);

  function terminateAnalysisWorker() {
    analysisWorkerRef.current?.terminate();
    analysisWorkerRef.current = null;
  }

  function commitPlateMap(next: PlateMapCell[]) {
    setPlateMap(next);
    setAnalysis(undefined);
    setAnalysisError("");
    setFocusedSeriesKey(undefined);
    setReviewNotice(undefined);
    liveStateRef.current = { ...liveStateRef.current, plateMap: next, validation: validatePlateMap(next), analysis: undefined };
  }

  function resetProject() {
    terminateAnalysisWorker();
    if (image?.url) URL.revokeObjectURL(image.url);
    setImage(undefined);
    setGeometry(createDefaultGeometry());
    setPlateMap(createEmptyPlateMap());
    setSpotMap(createEmptySpotMap(DEFAULT_SPOT_GRID_SETTINGS.rows, DEFAULT_SPOT_GRID_SETTINGS.columns));
    setAnalysis(undefined);
    setThreshold(0.1);
    setSpotReferenceControlGroupId(undefined);
    setRunningAnalysis(false);
    setAnalysisError("");
    setFocusedSeriesKey(undefined);
    setReviewNotice(undefined);
    setIsSyntheticDemo(false);
    setStep("image");
  }

  function handleAssayModeChange(nextMode: AssayMode) {
    if (nextMode === assayMode) return;
    terminateAnalysisWorker();
    setAssayMode(nextMode);
    setGeometry(createDefaultGeometry());
    setPlateMap(createEmptyPlateMap());
    setSpotMap(createEmptySpotMap(DEFAULT_SPOT_GRID_SETTINGS.rows, DEFAULT_SPOT_GRID_SETTINGS.columns));
    setAnalysis(undefined);
    setAnalysisError("");
    setRunningAnalysis(false);
    setSpotReferenceControlGroupId(undefined);
    setFocusedSeriesKey(undefined);
    setReviewNotice(undefined);
    setIsSyntheticDemo(false);
    setStep("image");
  }

  function handleImageLoaded(nextImage: LoadedImage) {
    terminateAnalysisWorker();
    if (image?.url) URL.revokeObjectURL(image.url);
    setImage(nextImage);
    setGeometry(createDefaultGeometry());
    setAnalysis(undefined);
    setRunningAnalysis(false);
    setAnalysisError("");
    setFocusedSeriesKey(undefined);
    setReviewNotice(undefined);
    setIsSyntheticDemo(false);
    setStep("wells");
  }

  function handleProjectImported(project: ProjectFile) {
    terminateAnalysisWorker();
    if (image?.url) URL.revokeObjectURL(image.url);
    setImage(undefined);
    setAssayMode(project.assayMode);
    setGeometry({ ...createDefaultGeometry(), ...project.geometry, anchors: project.geometry.anchors ?? {}, wellAdjustments: project.geometry.wellAdjustments ?? {}, spotGrid: normalizedSpotGridSettings(project.geometry.spotGrid) });
    if (project.assayMode === "agar_spot_growth") {
      setSpotMap(project.roiMap);
      setPlateMap(createEmptyPlateMap());
      setSpotReferenceControlGroupId(project.analysisSettings.referenceControlGroupId);
    } else {
      setPlateMap(project.roiMap);
      setSpotMap(createEmptySpotMap(DEFAULT_SPOT_GRID_SETTINGS.rows, DEFAULT_SPOT_GRID_SETTINGS.columns));
      setThreshold(project.analysisSettings.threshold);
      setSpotReferenceControlGroupId(undefined);
    }
    setRunningAnalysis(false);
    setAnalysisError("");
    const importedResult = project.analysisResult ?? (project.historicalAnalysisResult ? { ...project.historicalAnalysisResult, provenance: project.provenance, qcDecision: project.qcDecision } : undefined);
    setAnalysis(importedResult);
    setFocusedSeriesKey(undefined);
    setReviewNotice(undefined);
    setIsSyntheticDemo(false);
    setStep(importedResult ? "report" : "wells");
  }

  async function runGeminiDetection(apiKey: string, model: GeminiModelId) {
    if (!image) throw new Error("Load an image by upload or camera capture first.");
    const result = await detectPlateAnchorsWithGemini(image.file, apiKey, model, image.metadata.width, image.metadata.height);
    if (result.lowConfidence && !window.confirm("Gemini returned one or more low-confidence anchors. Apply them for manual review?")) return;
    setGeometry({ ...geometry, anchors: result.anchors, a1Position: result.detection.a1Position, confirmed: false, wellAdjustments: {} });
  }

  async function runCurrentAnalysis(signal?: AbortSignal): Promise<AnalysisResult> {
    const state = liveStateRef.current;
    const currentValidation = state.assayMode === "xtt_96well_mic" ? validatePlateMap(state.plateMap) : spotMapValidation;
    const currentBlockers = analysisBlockers(state.geometry, currentValidation, state.assayMode);
    if (!state.image) currentBlockers.unshift("Load original image pixels by upload or camera capture before running analysis.");
    if (currentBlockers.length || !state.image || !hasCompleteAnchors(state.geometry.anchors)) throw new Error(currentBlockers.join(" ") || "Analysis is not ready.");
    if (liveStateRef.current.runningAnalysis) throw new Error("Analysis is already running.");
    setRunningAnalysis(true);
    setAnalysisError("");
    liveStateRef.current = { ...liveStateRef.current, runningAnalysis: true };
    try {
      const message = state.assayMode === "agar_spot_growth"
        ? { type: "analyze" as const, assayMode: state.assayMode, protocolId: "agar_endpoint_exploratory_v1", imageData: state.image.imageData, geometry: state.geometry, roiMap: spotMap, settings: { referenceControlGroupId: spotReferenceControlGroupId }, inputWarnings: state.image.metadata.warningCodes }
        : { type: "analyze" as const, assayMode: state.assayMode, protocolId: "xtt_image_exploratory_v1", imageData: state.image.imageData, geometry: state.geometry, roiMap: state.plateMap, settings: { threshold: state.threshold }, inputWarnings: state.image.metadata.warningCodes };
      const result = await runImageAnalysisWorker(message, signal, (worker) => { analysisWorkerRef.current = worker; });
      setAnalysis(result);
      setStep("analysis");
      setFocusedSeriesKey(undefined);
      setReviewNotice(undefined);
      liveStateRef.current = { ...liveStateRef.current, analysis: result, step: "analysis", runningAnalysis: false };
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Image analysis failed.";
      setAnalysisError(message);
      throw error;
    } finally {
      setRunningAnalysis(false);
      analysisWorkerRef.current = null;
      liveStateRef.current = { ...liveStateRef.current, runningAnalysis: false };
    }
  }

  function runAnalysis() {
    void runCurrentAnalysis().catch(() => undefined);
  }

  async function loadWebMcpDemo() {
    const width = 1000;
    const height = 680;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#edf1f4";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#d7dce0";
    ctx.fillRect(55, 45, 890, 590);
    const anchors = { A1: { x: 120, y: 105 }, A12: { x: 880, y: 105 }, H12: { x: 880, y: 575 }, H1: { x: 120, y: 575 } };
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLUMNS; col += 1) {
        const x = anchors.A1.x + (anchors.A12.x - anchors.A1.x) * (col / 11);
        const y = anchors.A1.y + (anchors.H1.y - anchors.A1.y) * (row / 7);
        let intensity = 0.28;
        if (row <= 1 && col <= 7) intensity = 0.2 + col * 0.09;
        if (row === 7 && col <= 1) intensity = 0.92;
        if (row === 7 && (col === 2 || col === 3)) intensity = 0.08;
        ctx.beginPath();
        ctx.arc(x, y, 23, 0, Math.PI * 2);
        ctx.fillStyle = `rgb(${Math.round(220 + 25 * intensity)}, ${Math.round(105 + 125 * intensity)}, ${Math.round(25 + 25 * intensity)})`;
        ctx.fill();
        ctx.strokeStyle = "#6f7680";
        ctx.lineWidth = 2;
        ctx.stroke();
        if (row === 1 && col === 4) {
          ctx.beginPath();
          ctx.arc(x + 5, y - 5, 12, 0, Math.PI * 2);
          ctx.fillStyle = "#ffffff";
          ctx.fill();
        }
      }
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return;
    const file = new File([blob], "assaylens-webmcp-synthetic-demo.png", { type: "image/png" });
    const loaded = await loadImageFile(file);
    const nextGeometry: GeometryState = { ...createDefaultGeometry(), anchors, confirmed: true, a1Position: "top_left" };
    nextGeometry.confirmationFingerprint = geometryFingerprint(nextGeometry);
    terminateAnalysisWorker();
    if (image?.url) URL.revokeObjectURL(image.url);
    setAssayMode("xtt_96well_mic");
    setImage(loaded);
    setGeometry(nextGeometry);
    commitPlateMap(createEmptyPlateMap());
    setThreshold(0.1);
    setIsSyntheticDemo(true);
    setStep("plateMap");
    liveStateRef.current = { ...liveStateRef.current, assayMode: "xtt_96well_mic", image: loaded, geometry: nextGeometry, step: "plateMap", threshold: 0.1 };
  }

  useEffect(() => assayLensBridge.attach({
    inspectWorkflow: () => {
      const state = liveStateRef.current;
      const validation = validatePlateMap(state.plateMap);
      const currentBlockers = analysisBlockers(state.geometry, validation, state.assayMode);
      if (!state.image) currentBlockers.unshift("Load original image pixels by upload or camera capture before running analysis.");
      const results = state.analysis?.kind === "xtt_96well_mic" ? state.analysis.micResults : [];
      return { ok: true, data: {
        assayMode: state.assayMode,
        step: state.step,
        imageLoaded: Boolean(state.image),
        geometryConfirmed: state.geometry.confirmed,
        geometryCurrent: Boolean(state.geometry.confirmationFingerprint && state.geometry.confirmationFingerprint === geometryFingerprint(state.geometry)),
        plate: { roleCounts: roleCounts(state.plateMap), series: sampleSeries(state.plateMap), valid: validation.valid, blockers: truncate(validation.blockers), warnings: truncate(validation.warnings) },
        analysis: { ready: state.assayMode === "xtt_96well_mic" && Boolean(state.image) && currentBlockers.length === 0, running: state.runningAnalysis, available: state.analysis?.kind === "xtt_96well_mic", series: summarizeSeries(results) },
        ...XTT_WEBMCP_SCIENTIFIC_CONTEXT
      }};
    },
    configureSeries: (input: ConfigureSeriesInput) => {
      const state = liveStateRef.current;
      if (state.assayMode !== "xtt_96well_mic") return { ok: false, code: "wrong_assay_mode", message: "Switch AssayLens to XTT mode before configuring an XTT series." };
      try {
        const start = parseWellName(input.startWell);
        const rows = Array.from({ length: input.replicateCount }, (_, index) => start.row + index);
        if (rows.some((row) => row < 0 || row >= ROWS)) return { ok: false, code: "series_out_of_bounds", message: "Replicate rows extend outside the 8 x 12 plate." };
        const cols = Array.from({ length: input.doseCount }, (_, index) => input.direction === "right" ? start.col + index : start.col - index);
        if (cols.some((col) => col < 0 || col >= COLUMNS)) return { ok: false, code: "series_out_of_bounds", message: "Dose series extends outside the 8 x 12 plate." };
        const targets = rows.flatMap((row) => cols.map((col) => wellName(row, col)));
        const conflicts = state.plateMap.filter((cell) => targets.includes(cell.well) && cell.role !== "unused").map((cell) => cell.well);
        if (!input.overwrite && conflicts.length) return { ok: false, code: "well_collision", message: "One or more target wells are already assigned.", conflicts };
        const identityConflict = state.plateMap.find((cell) => cell.role === "sample" && cell.compoundId.trim() === input.compoundId && cell.sampleId.trim() === input.sampleId && cell.normalizationGroupId.trim() !== input.normalizationGroupId);
        if (identityConflict) return { ok: false, code: "series_identity_conflict", message: "The same compound and sample pair already exists in a different normalization group.", conflicts: [identityConflict.well] };
        let next = applySerialDilution(state.plateMap, { compoundId: input.compoundId, sampleId: input.sampleId, startConcentration: input.startConcentration, dilutionFactor: input.dilutionFactor, direction: input.direction, steps: input.doseCount, unit: input.unit, replicateRows: rows, replicateCols: [], startRow: start.row, startCol: start.col, normalizationGroupId: input.normalizationGroupId, biologicalReplicatePrefix: "Bio" });
        if (input.usesVehicleControl) next = next.map((cell) => targets.includes(cell.well) ? { ...cell, usesVehicleControl: true } : cell);
        commitPlateMap(next);
        setStep("plateMap");
        const validation = validatePlateMap(next);
        return { ok: true, data: { changedWells: targets, validation, roleCounts: roleCounts(next) } };
      } catch (error) {
        return { ok: false, code: "configure_series_failed", message: error instanceof Error ? error.message : "Could not configure series." };
      }
    },
    assignControls: (input: AssignControlsInput) => {
      const state = liveStateRef.current;
      if (state.assayMode !== "xtt_96well_mic") return { ok: false, code: "wrong_assay_mode", message: "Switch AssayLens to XTT mode before assigning XTT controls." };
      try {
        const assigned = assignControlsAtomic(state.plateMap, input);
        commitPlateMap(assigned.plateMap);
        setStep("plateMap");
        const validation = validatePlateMap(assigned.plateMap);
        return { ok: true, data: { changedWells: assigned.changedWells, validation, roleCounts: roleCounts(assigned.plateMap) } };
      } catch (error) {
        return { ok: false, code: "control_assignment_failed", message: error instanceof Error ? error.message : "Could not assign controls." };
      }
    },
    runAnalysis: async (signal?: AbortSignal) => {
      const state = liveStateRef.current;
      if (state.assayMode !== "xtt_96well_mic") return { ok: false, code: "wrong_assay_mode", message: "The WebMCP analysis tool is limited to XTT mode." };
      const validation = validatePlateMap(state.plateMap);
      const currentBlockers = analysisBlockers(state.geometry, validation, state.assayMode);
      if (!state.image) currentBlockers.unshift("Load original image pixels before running analysis.");
      if (currentBlockers.length) return { ok: false, code: "analysis_not_ready", message: "XTT analysis is blocked.", blockers: currentBlockers.slice(0, 12) };
      try {
        const result = await runCurrentAnalysis(signal);
        const xtt = result as XttAnalysisResult;
        return { ok: true, data: { series: summarizeSeries(xtt.micResults), ...XTT_WEBMCP_SCIENTIFIC_CONTEXT } };
      } catch (error) {
        return { ok: false, code: error instanceof DOMException && error.name === "AbortError" ? "analysis_cancelled" : "analysis_failed", message: error instanceof Error ? error.message : "Analysis failed." };
      }
    },
    focusReview: (input: FocusReviewInput) => {
      const state = liveStateRef.current;
      if (state.analysis?.kind !== "xtt_96well_mic") return { ok: false, code: "analysis_unavailable", message: "Run XTT analysis before focusing a review series." };
      const selected = input.mode === "highest_qc_priority"
        ? selectHighestQcPriority(state.analysis.micResults)
        : state.analysis.micResults.find((result) => result.compoundId === input.compoundId && result.sampleId === input.sampleId);
      if (!selected) return { ok: false, code: "series_not_found", message: "No matching XTT result series was found." };
      const key = micResultKey(selected);
      const reason = reviewReason(selected);
      setFocusedSeriesKey(key);
      setReviewNotice(`${selected.compoundId} / ${selected.sampleId} selected for QC review: ${reason}.`);
      setStep("analysis");
      setTimeout(() => document.querySelector(".plot-panel")?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
      return { ok: true, data: { selectedSeriesKey: key, compoundId: selected.compoundId, sampleId: selected.sampleId, status: selected.status, reason, excludedWells: selected.concentrations.flatMap((point) => point.excludedWellIds).slice(0, 12), warningCount: selected.warnings.length, ...XTT_WEBMCP_SCIENTIFIC_CONTEXT } };
    }
  }), []);

  function stepStatus(id: WorkflowStep): "complete" | "active" | "pending" {
    if (id === step) return "active";
    if (id === "image") return image || analysis ? "complete" : "pending";
    if (id === "wells") return geometry.confirmed ? "complete" : "pending";
    if (id === "plateMap") return activeValidation.valid ? "complete" : "pending";
    if (id === "analysis") return analysis ? "complete" : "pending";
    return analysis ? "complete" : "pending";
  }

  function workflowLabel(id: WorkflowStep): string {
    if (assayMode === "agar_spot_growth") {
      if (id === "wells") return "ROIs";
      if (id === "plateMap") return "Spot Map";
      if (id === "analysis") return "Endpoint Signal";
    }
    return workflowSteps.find((item) => item.id === id)?.label ?? id;
  }

  const isSpot = assayMode === "agar_spot_growth";

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="brand"><div className="brand-mark" aria-hidden="true">{Array.from({ length: 16 }, (_item, index) => <span key={index} />)}</div><div><strong>Assay Lens</strong><span>v{APP_VERSION}</span></div></div>
          <nav className="stepper" aria-label="Workflow">
            {workflowSteps.map((item, index) => {
              const status = stepStatus(item.id);
              return <button key={item.id} type="button" className={`stepper-item ${status}`} aria-current={status === "active" ? "step" : undefined} onClick={() => setStep(item.id)}><span className="step-number">{status === "complete" ? <CheckCircle2 size={18} /> : index + 1}</span><span>{workflowLabel(item.id)}</span>{status === "pending" && <Circle size={10} />}</button>;
            })}
          </nav>
          <div className="sidebar-status">
            <div><ImageIcon size={17} /><span>{image ? "Image loaded" : analysis ? "Project imported" : "No image"}</span></div>
            <div>{isSpot ? <CircleDot size={17} /> : <FlaskConical size={17} />}<span>{activeValidation.valid ? "Map ready" : "Map incomplete"}</span></div>
            <div><BarChart3 size={17} /><span>{analysis ? "Results ready" : "No results"}</span></div>
          </div>
        </aside>
        <main className="main-area" id="main-content">
          <header className="topbar">
            <div><h1>{isSpot ? "Agar endpoint spot densitometry" : "XTT relative metabolic activity"}</h1><p>{isSpot ? "Browser-only endpoint spot workflow with local background correction, explicit matched controls, and replicate-aware summaries." : "Browser-only 96-well workflow with confirmed geometry, explicit controls, and reproducible exports."}</p></div>
            <div className="topbar-actions"><button className="secondary-button" type="button" onClick={() => setStep("image")}><ImageIcon size={16} /> Image</button><button className="secondary-button" type="button" onClick={() => setStep("analysis")}><BarChart3 size={16} /> {isSpot ? "Endpoint signal" : "Analysis"}</button><button className="secondary-button" type="button" onClick={() => setStep("report")}><Map size={16} /> Exports</button><button className="icon-button" type="button" onClick={resetProject} title="Reset project" aria-label="Reset project"><RotateCcw size={17} /></button></div>
          </header>

          {isSyntheticDemo && <div className="error-banner" role="status">Synthetic WebMCP demonstration image. Results are exploratory image-derived relative metabolic activity only; they are not calibrated plate-reader absorbance, a direct viable-cell count, or a validated MIC.</div>}

          {step === "image" && <><div className="surface-panel"><div className="panel-heading compact"><h2>WebMCP synthetic demo</h2><span>No private data or API key required</span></div><p>Loads deterministic synthetic XTT plate pixels with preconfirmed geometry and an empty plate map so agent changes remain visible.</p><button className="secondary-button" type="button" onClick={() => void loadWebMcpDemo()}>Load WebMCP demo</button></div><UploadStep image={image} assayMode={assayMode} onAssayModeChange={handleAssayModeChange} onImageLoaded={handleImageLoaded} onProjectImported={handleProjectImported} onReset={resetProject} /></>}

          {step === "wells" && <div className="wells-screen"><WellAlignmentCanvas image={image} assayMode={assayMode} geometry={geometry} plateMap={plateMap} spotMap={spotMap} onGeometryChange={setGeometry} footerAction={<button className="secondary-button plate-map-continue-button" type="button" disabled={!geometry.confirmed} onClick={() => setStep("plateMap")}><Map size={16} /> {isSpot ? "Continue to spot map" : "Continue to plate map"}</button>} sideExtras={isSpot ? undefined : <GeminiKeyPanel disabled={!image} onDetect={runGeminiDetection} />} /></div>}

          {step === "plateMap" && (isSpot ? <SpotMapEditor spotMap={spotMap} rows={spotGridSettings.rows} columns={spotGridSettings.columns} onSpotMapChange={setSpotMap} actions={<><button className="secondary-button" type="button" onClick={() => setStep("wells")}>Back to ROIs</button><button className="primary-button" type="button" disabled={!spotMapValidation.valid} onClick={() => setStep("analysis")}>Continue to growth</button></>} /> : <PlateMapEditor plateMap={plateMap} onPlateMapChange={commitPlateMap} actions={<><button className="secondary-button" type="button" onClick={() => setStep("wells")}>Back to wells</button><button className="primary-button" type="button" disabled={!plateMapValidation.valid} onClick={() => setStep("analysis")}>Continue to analysis</button></>} />)}

          {step === "analysis" && <AnalysisDashboard assayMode={assayMode} result={analysis} blockers={blockers} running={runningAnalysis} error={analysisError} threshold={threshold} onThresholdChange={setThreshold} spotControlGroupIds={spotControlGroupIds} spotReferenceControlGroupId={spotReferenceControlGroupId} onSpotReferenceControlGroupChange={setSpotReferenceControlGroupId} onRun={runAnalysis} selectedSeriesKey={focusedSeriesKey} onSelectedSeriesKeyChange={setFocusedSeriesKey} reviewNotice={reviewNotice} />}

          {step === "report" && <ReportExport image={image} assayMode={assayMode} geometry={geometry} plateMap={plateMap} spotMap={spotMap} spotReferenceControlGroupId={spotReferenceControlGroupId} analysis={analysis} />}
        </main>
      </div>
    </>
  );
}
