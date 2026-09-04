import {
  BarChart3,
  CheckCircle2,
  Circle,
  CircleDot,
  FlaskConical,
  Image as ImageIcon,
  Map as MapIcon,
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
import { geometryFingerprint, hasCompleteAnchors } from "../core/geometry/geometryValidation";
import { createEmptyPlateMap, type PlateMapCell } from "../core/plateMap/plateMapTypes";
import type { PlateMapSidebarSyncTarget } from "../core/plateMap/plateMapSidebarSync";
import { validatePlateMap } from "../core/plateMap/plateMapValidation";
import { configureXttSeriesAtomic } from "../core/plateMap/configureXttSeries";
import { assignControlsAtomic } from "../core/plateMap/assignControls";
import { createEmptySpotMap, resizeSpotMap } from "../core/assays/agarSpot/spotMapTypes";
import { validateSpotMap } from "../core/assays/agarSpot/spotMapValidation";
import { DEFAULT_SPOT_GRID_SETTINGS, normalizedSpotGridSettings } from "../core/assays/agarSpot/spotGrid";
import { analysisBlockers } from "../core/analysis/qc";
import { runImageAnalysisWorker } from "../core/analysis/runImageAnalysisWorker";
import { micResultKey, reviewReason, selectHighestQcPriority } from "../core/analysis/reviewSelection";
import type { AnalysisResult, AssayMode, GeometryState, MicResult, ProjectFile, XttAnalysisResult } from "../core/types";
import { APP_VERSION } from "../core/version";
import { createXttWebMcpDemo } from "../demo/xttWebMcpDemo";
import { assayLensBridge } from "../webmcp/assayLensBridge";
import {
  XTT_WEBMCP_SCIENTIFIC_CONTEXT,
  roleCounts,
  summarizeValidation,
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
  return truncate(results.map((result) => ({
    key: micResultKey(result),
    compoundId: result.compoundId,
    sampleId: result.sampleId,
    status: result.status,
    observedEndpoint: result.observedMicLabel,
    advisoryFit: result.isotonicMicLabel,
    excludedWellCount: result.concentrations.reduce((sum, point) => sum + point.excludedWellIds.length, 0),
    warningCount: result.warnings.length
  })));
}

function sampleSeries(plateMap: PlateMapCell[]) {
  const grouped = new Map<string, PlateMapCell[]>();
  for (const cell of plateMap.filter((item) => item.role === "sample")) {
    const key = `${cell.compoundId.trim()}::${cell.sampleId.trim()}::${cell.normalizationGroupId.trim()}`;
    grouped.set(key, [...(grouped.get(key) ?? []), cell]);
  }
  return truncate([...grouped.values()].map((cells) => ({
    compoundId: cells[0].compoundId,
    sampleId: cells[0].sampleId,
    normalizationGroupId: cells[0].normalizationGroupId,
    wells: truncate(cells.map((cell) => cell.well)),
    concentrations: truncate(
      [...new Set(cells.map((cell) => cell.concentration).filter((value): value is number => Number.isFinite(value)))]
        .sort((a, b) => b - a)
    ),
    unit: cells[0].unit
  })));
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function App() {
  const [step, setStep] = useState<WorkflowStep>("image");
  const [assayMode, setAssayMode] = useState<AssayMode>("xtt_96well_mic");
  const [image, setImage] = useState<LoadedImage | undefined>();
  const [geometry, setGeometry] = useState<GeometryState>(() => createDefaultGeometry());
  const [plateMap, setPlateMap] = useState(createEmptyPlateMap);
  const [plateMapSidebarSyncTarget, setPlateMapSidebarSyncTarget] = useState<PlateMapSidebarSyncTarget | undefined>();
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
  const analysisAbortControllerRef = useRef<AbortController | null>(null);
  const plateMapSidebarSyncRevisionRef = useRef(0);

  const spotGridSettings = useMemo(() => normalizedSpotGridSettings(geometry.spotGrid), [geometry.spotGrid]);
  const plateMapValidation = useMemo(() => validatePlateMap(plateMap), [plateMap]);
  const spotMapValidation = useMemo(() => validateSpotMap(spotMap), [spotMap]);
  const spotControlGroupIds = useMemo(
    () => [...new Set(spotMap.filter((cell) => cell.role === "control").map((cell) => cell.groupId.trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b)),
    [spotMap]
  );
  const activeValidation = assayMode === "agar_spot_growth" ? spotMapValidation : plateMapValidation;
  const blockers = useMemo(() => {
    const base = analysisBlockers(geometry, activeValidation, assayMode);
    if (!image) base.unshift("Load original image pixels by upload or camera capture before running analysis.");
    return base;
  }, [activeValidation, assayMode, geometry, image]);

  const liveStateRef = useRef<LiveAssayLensState>({
    assayMode,
    step,
    image,
    geometry,
    plateMap,
    validation: plateMapValidation,
    analysis,
    runningAnalysis,
    threshold
  });
  liveStateRef.current = {
    assayMode,
    step,
    image,
    geometry,
    plateMap,
    validation: plateMapValidation,
    analysis,
    runningAnalysis,
    threshold
  };

  useEffect(() => {
    setSpotMap((current) => resizeSpotMap(current, spotGridSettings.rows, spotGridSettings.columns));
  }, [spotGridSettings.rows, spotGridSettings.columns]);

  function terminateAnalysisWorker() {
    analysisAbortControllerRef.current?.abort();
    analysisAbortControllerRef.current = null;
    analysisWorkerRef.current?.terminate();
    analysisWorkerRef.current = null;
  }

  function commitPlateMap(next: PlateMapCell[], preferredSidebarWells?: readonly string[]) {
    if (liveStateRef.current.runningAnalysis) terminateAnalysisWorker();
    const validation = validatePlateMap(next);
    setPlateMap(next);
    if (preferredSidebarWells?.length) {
      plateMapSidebarSyncRevisionRef.current += 1;
      setPlateMapSidebarSyncTarget({
        revision: plateMapSidebarSyncRevisionRef.current,
        preferredWells: [...preferredSidebarWells]
      });
    } else {
      setPlateMapSidebarSyncTarget(undefined);
    }
    setAnalysis(undefined);
    setAnalysisError("");
    setFocusedSeriesKey(undefined);
    setReviewNotice(undefined);
    liveStateRef.current = {
      ...liveStateRef.current,
      plateMap: next,
      validation,
      analysis: undefined,
      runningAnalysis: false
    };
  }

  function resetProject() {
    terminateAnalysisWorker();
    if (image?.url) URL.revokeObjectURL(image.url);
    const nextGeometry = createDefaultGeometry();
    const nextPlateMap = createEmptyPlateMap();
    setImage(undefined);
    setGeometry(nextGeometry);
    setPlateMap(nextPlateMap);
    setPlateMapSidebarSyncTarget(undefined);
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
    liveStateRef.current = {
      ...liveStateRef.current,
      step: "image",
      image: undefined,
      geometry: nextGeometry,
      plateMap: nextPlateMap,
      validation: validatePlateMap(nextPlateMap),
      analysis: undefined,
      runningAnalysis: false,
      threshold: 0.1
    };
  }

  function handleAssayModeChange(nextMode: AssayMode) {
    if (nextMode === assayMode) return;
    terminateAnalysisWorker();
    const nextGeometry = createDefaultGeometry();
    const nextPlateMap = createEmptyPlateMap();
    setAssayMode(nextMode);
    setGeometry(nextGeometry);
    setPlateMap(nextPlateMap);
    setPlateMapSidebarSyncTarget(undefined);
    setSpotMap(createEmptySpotMap(DEFAULT_SPOT_GRID_SETTINGS.rows, DEFAULT_SPOT_GRID_SETTINGS.columns));
    setAnalysis(undefined);
    setAnalysisError("");
    setRunningAnalysis(false);
    setSpotReferenceControlGroupId(undefined);
    setFocusedSeriesKey(undefined);
    setReviewNotice(undefined);
    setIsSyntheticDemo(false);
    setStep("image");
    liveStateRef.current = {
      ...liveStateRef.current,
      assayMode: nextMode,
      step: "image",
      geometry: nextGeometry,
      plateMap: nextPlateMap,
      validation: validatePlateMap(nextPlateMap),
      analysis: undefined,
      runningAnalysis: false
    };
  }

  function handleImageLoaded(nextImage: LoadedImage) {
    terminateAnalysisWorker();
    if (image?.url) URL.revokeObjectURL(image.url);
    const nextGeometry = createDefaultGeometry();
    setImage(nextImage);
    setGeometry(nextGeometry);
    setAnalysis(undefined);
    setRunningAnalysis(false);
    setAnalysisError("");
    setFocusedSeriesKey(undefined);
    setReviewNotice(undefined);
    setIsSyntheticDemo(false);
    setStep("wells");
    liveStateRef.current = {
      ...liveStateRef.current,
      step: "wells",
      image: nextImage,
      geometry: nextGeometry,
      analysis: undefined,
      runningAnalysis: false
    };
  }

  function handleProjectImported(project: ProjectFile) {
    terminateAnalysisWorker();
    if (image?.url) URL.revokeObjectURL(image.url);
    const nextGeometry = {
      ...createDefaultGeometry(),
      ...project.geometry,
      anchors: project.geometry.anchors ?? {},
      wellAdjustments: project.geometry.wellAdjustments ?? {},
      spotGrid: normalizedSpotGridSettings(project.geometry.spotGrid)
    };
    const importedResult = project.analysisResult ?? (project.historicalAnalysisResult
      ? { ...project.historicalAnalysisResult, provenance: project.provenance, qcDecision: project.qcDecision }
      : undefined);
    const importedPlateMap = project.assayMode === "xtt_96well_mic" ? project.roiMap : createEmptyPlateMap();

    setImage(undefined);
    setAssayMode(project.assayMode);
    setGeometry(nextGeometry);
    setPlateMapSidebarSyncTarget(undefined);
    if (project.assayMode === "agar_spot_growth") {
      setSpotMap(project.roiMap);
      setPlateMap(importedPlateMap);
      setSpotReferenceControlGroupId(project.analysisSettings.referenceControlGroupId);
    } else {
      setPlateMap(importedPlateMap);
      setSpotMap(createEmptySpotMap(DEFAULT_SPOT_GRID_SETTINGS.rows, DEFAULT_SPOT_GRID_SETTINGS.columns));
      setThreshold(project.analysisSettings.threshold);
      setSpotReferenceControlGroupId(undefined);
    }
    setRunningAnalysis(false);
    setAnalysisError("");
    setAnalysis(importedResult);
    setFocusedSeriesKey(undefined);
    setReviewNotice(undefined);
    setIsSyntheticDemo(false);
    const nextStep: WorkflowStep = importedResult ? "report" : "wells";
    setStep(nextStep);
    liveStateRef.current = {
      ...liveStateRef.current,
      assayMode: project.assayMode,
      step: nextStep,
      image: undefined,
      geometry: nextGeometry,
      plateMap: importedPlateMap,
      validation: validatePlateMap(importedPlateMap),
      analysis: importedResult,
      runningAnalysis: false,
      threshold: project.assayMode === "xtt_96well_mic" ? project.analysisSettings.threshold : liveStateRef.current.threshold
    };
  }

  async function runGeminiDetection(apiKey: string, model: GeminiModelId) {
    if (!image) throw new Error("Load an image by upload or camera capture first.");
    const result = await detectPlateAnchorsWithGemini(image.file, apiKey, model, image.metadata.width, image.metadata.height);
    if (result.lowConfidence && !window.confirm("Gemini returned one or more low-confidence anchors. Apply them for manual review?")) return;
    setGeometry({
      ...geometry,
      anchors: result.anchors,
      a1Position: result.detection.a1Position,
      confirmed: false,
      wellAdjustments: {}
    });
  }

  async function runCurrentAnalysis(signal?: AbortSignal): Promise<AnalysisResult> {
    const state = liveStateRef.current;
    if (signal?.aborted) throw new DOMException("Analysis cancelled.", "AbortError");
    const currentValidation = state.assayMode === "xtt_96well_mic" ? validatePlateMap(state.plateMap) : spotMapValidation;
    const currentBlockers = analysisBlockers(state.geometry, currentValidation, state.assayMode);
    if (!state.image) currentBlockers.unshift("Load original image pixels by upload or camera capture before running analysis.");
    if (currentBlockers.length || !state.image || !hasCompleteAnchors(state.geometry.anchors)) {
      throw new Error(currentBlockers.join(" ") || "Analysis is not ready.");
    }
    if (liveStateRef.current.runningAnalysis) throw new Error("Analysis is already running.");

    const runController = new AbortController();
    analysisAbortControllerRef.current = runController;
    const forwardAbort = () => runController.abort();
    signal?.addEventListener("abort", forwardAbort, { once: true });

    setRunningAnalysis(true);
    setAnalysisError("");
    liveStateRef.current = { ...liveStateRef.current, runningAnalysis: true };
    try {
      const message = state.assayMode === "agar_spot_growth"
        ? {
            type: "analyze" as const,
            assayMode: state.assayMode,
            protocolId: "agar_endpoint_exploratory_v1",
            imageData: state.image.imageData,
            geometry: state.geometry,
            roiMap: spotMap,
            settings: { referenceControlGroupId: spotReferenceControlGroupId },
            inputWarnings: state.image.metadata.warningCodes
          }
        : {
            type: "analyze" as const,
            assayMode: state.assayMode,
            protocolId: "xtt_image_exploratory_v1",
            imageData: state.image.imageData,
            geometry: state.geometry,
            roiMap: state.plateMap,
            settings: { threshold: state.threshold },
            inputWarnings: state.image.metadata.warningCodes
          };
      const result = await runImageAnalysisWorker(message, runController.signal, (worker) => {
        analysisWorkerRef.current = worker;
      });
      setAnalysis(result);
      setStep("analysis");
      setFocusedSeriesKey(undefined);
      setReviewNotice(undefined);
      liveStateRef.current = { ...liveStateRef.current, analysis: result, step: "analysis", runningAnalysis: false };
      return result;
    } catch (error) {
      if (!isAbortError(error)) {
        const message = error instanceof Error ? error.message : "Image analysis failed.";
        setAnalysisError(message);
      }
      throw error;
    } finally {
      signal?.removeEventListener("abort", forwardAbort);
      if (analysisAbortControllerRef.current === runController) analysisAbortControllerRef.current = null;
      setRunningAnalysis(false);
      analysisWorkerRef.current = null;
      liveStateRef.current = { ...liveStateRef.current, runningAnalysis: false };
    }
  }

  function runAnalysis() {
    void runCurrentAnalysis().catch(() => undefined);
  }

  async function loadWebMcpDemo() {
    const demo = await createXttWebMcpDemo();
    terminateAnalysisWorker();
    if (image?.url) URL.revokeObjectURL(image.url);
    const nextPlateMap = createEmptyPlateMap();
    setAssayMode("xtt_96well_mic");
    setImage(demo.image);
    setGeometry(demo.geometry);
    setPlateMap(nextPlateMap);
    setPlateMapSidebarSyncTarget(undefined);
    setAnalysis(undefined);
    setAnalysisError("");
    setFocusedSeriesKey(undefined);
    setReviewNotice(undefined);
    setThreshold(0.1);
    setIsSyntheticDemo(true);
    setStep("plateMap");
    liveStateRef.current = {
      ...liveStateRef.current,
      assayMode: "xtt_96well_mic",
      step: "plateMap",
      image: demo.image,
      geometry: demo.geometry,
      plateMap: nextPlateMap,
      validation: validatePlateMap(nextPlateMap),
      analysis: undefined,
      runningAnalysis: false,
      threshold: 0.1
    };
  }

  useEffect(() => assayLensBridge.attach({
    inspectWorkflow: () => {
      const state = liveStateRef.current;
      const validation = validatePlateMap(state.plateMap);
      const currentBlockers = analysisBlockers(state.geometry, validation, state.assayMode);
      if (!state.image) currentBlockers.unshift("Load original image pixels by upload or camera capture before running analysis.");
      const results = state.analysis?.kind === "xtt_96well_mic" ? state.analysis.micResults : [];
      return {
        ok: true,
        data: {
          assayMode: state.assayMode,
          step: state.step,
          imageLoaded: Boolean(state.image),
          geometryConfirmed: state.geometry.confirmed,
          geometryCurrent: Boolean(
            state.geometry.confirmationFingerprint &&
            state.geometry.confirmationFingerprint === geometryFingerprint(state.geometry)
          ),
          plate: {
            roleCounts: roleCounts(state.plateMap),
            series: sampleSeries(state.plateMap),
            ...summarizeValidation(validation)
          },
          analysis: {
            ready: state.assayMode === "xtt_96well_mic" && Boolean(state.image) && !state.runningAnalysis && currentBlockers.length === 0,
            running: state.runningAnalysis,
            available: state.analysis?.kind === "xtt_96well_mic",
            blockers: truncate(currentBlockers),
            series: summarizeSeries(results)
          },
          ...XTT_WEBMCP_SCIENTIFIC_CONTEXT
        }
      };
    },
    configureSeries: (input: ConfigureSeriesInput) => {
      const state = liveStateRef.current;
      if (state.assayMode !== "xtt_96well_mic") {
        return { ok: false, code: "wrong_assay_mode", message: "Switch AssayLens to XTT mode before configuring an XTT series." };
      }
      if (state.runningAnalysis) {
        return { ok: false, code: "analysis_in_progress", message: "Wait for the current analysis to finish or cancel it before changing the plate map." };
      }
      try {
        const configured = configureXttSeriesAtomic(state.plateMap, input);
        commitPlateMap(configured.plateMap, configured.changedWells);
        setStep("plateMap");
        liveStateRef.current = { ...liveStateRef.current, step: "plateMap" };
        const validation = validatePlateMap(configured.plateMap);
        return {
          ok: true,
          data: {
            changedWells: truncate(configured.changedWells),
            validation: summarizeValidation(validation),
            roleCounts: roleCounts(configured.plateMap)
          }
        };
      } catch (error) {
        return {
          ok: false,
          code: "configure_series_failed",
          message: error instanceof Error ? error.message : "Could not configure series."
        };
      }
    },
    assignControls: (input: AssignControlsInput) => {
      const state = liveStateRef.current;
      if (state.assayMode !== "xtt_96well_mic") {
        return { ok: false, code: "wrong_assay_mode", message: "Switch AssayLens to XTT mode before assigning XTT controls." };
      }
      if (state.runningAnalysis) {
        return { ok: false, code: "analysis_in_progress", message: "Wait for the current analysis to finish or cancel it before changing the plate map." };
      }
      try {
        const assigned = assignControlsAtomic(state.plateMap, input);
        // A Selection panel can only display one coherent role. When a single
        // WebMCP call assigns several control roles, select the first explicit
        // assignment rather than presenting mixed control wells as one role.
        commitPlateMap(assigned.plateMap, input.assignments[0]?.wells ?? assigned.changedWells);
        setStep("plateMap");
        liveStateRef.current = { ...liveStateRef.current, step: "plateMap" };
        const validation = validatePlateMap(assigned.plateMap);
        return {
          ok: true,
          data: {
            changedWells: truncate(assigned.changedWells),
            validation: summarizeValidation(validation),
            roleCounts: roleCounts(assigned.plateMap)
          }
        };
      } catch (error) {
        return {
          ok: false,
          code: "control_assignment_failed",
          message: error instanceof Error ? error.message : "Could not assign controls."
        };
      }
    },
    runAnalysis: async (signal?: AbortSignal) => {
      const state = liveStateRef.current;
      if (state.assayMode !== "xtt_96well_mic") {
        return { ok: false, code: "wrong_assay_mode", message: "The WebMCP analysis tool is limited to XTT mode." };
      }
      if (state.runningAnalysis) {
        return { ok: false, code: "analysis_in_progress", message: "XTT analysis is already running." };
      }
      const validation = validatePlateMap(state.plateMap);
      const currentBlockers = analysisBlockers(state.geometry, validation, state.assayMode);
      if (!state.image) currentBlockers.unshift("Load original image pixels before running analysis.");
      if (currentBlockers.length) {
        const summary = truncate(currentBlockers);
        return {
          ok: false,
          code: "analysis_not_ready",
          message: "XTT analysis is blocked.",
          blockers: summary.items,
          blockerCount: summary.count,
          blockersTruncated: summary.truncated
        };
      }
      try {
        const result = await runCurrentAnalysis(signal);
        const xtt = result as XttAnalysisResult;
        return {
          ok: true,
          data: {
            series: summarizeSeries(xtt.micResults),
            ...XTT_WEBMCP_SCIENTIFIC_CONTEXT
          }
        };
      } catch (error) {
        return {
          ok: false,
          code: isAbortError(error) ? "analysis_cancelled" : "analysis_failed",
          message: error instanceof Error ? error.message : "Analysis failed."
        };
      }
    },
    focusReview: (input: FocusReviewInput) => {
      const state = liveStateRef.current;
      if (state.analysis?.kind !== "xtt_96well_mic") {
        return { ok: false, code: "analysis_unavailable", message: "Run XTT analysis before focusing a review series." };
      }
      const selected = input.mode === "highest_qc_priority"
        ? selectHighestQcPriority(state.analysis.micResults)
        : state.analysis.micResults.find(
            (result) => result.compoundId === input.compoundId && result.sampleId === input.sampleId
          );
      if (!selected) {
        return { ok: false, code: "series_not_found", message: "No matching XTT result series was found." };
      }
      const key = micResultKey(selected);
      const reason = reviewReason(selected);
      const excludedWells = truncate(selected.concentrations.flatMap((point) => point.excludedWellIds));
      setFocusedSeriesKey(key);
      setReviewNotice(`${selected.compoundId} / ${selected.sampleId} selected for QC review: ${reason}.`);
      setStep("analysis");
      liveStateRef.current = { ...liveStateRef.current, step: "analysis" };
      setTimeout(() => document.querySelector(".plot-panel")?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
      return {
        ok: true,
        data: {
          selectedSeriesKey: key,
          compoundId: selected.compoundId,
          sampleId: selected.sampleId,
          status: selected.status,
          reason,
          excludedWells,
          warningCount: selected.warnings.length,
          ...XTT_WEBMCP_SCIENTIFIC_CONTEXT
        }
      };
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
          <div className="brand">
            <div className="brand-mark" aria-hidden="true">
              {Array.from({ length: 16 }, (_item, index) => <span key={index} />)}
            </div>
            <div><strong>Assay Lens</strong><span>v{APP_VERSION}</span></div>
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
            <div><ImageIcon size={17} /><span>{image ? "Image loaded" : analysis ? "Project imported" : "No image"}</span></div>
            <div>{isSpot ? <CircleDot size={17} /> : <FlaskConical size={17} />}<span>{activeValidation.valid ? "Map ready" : "Map incomplete"}</span></div>
            <div><BarChart3 size={17} /><span>{analysis ? "Results ready" : "No results"}</span></div>
          </div>
        </aside>

        <main className="main-area" id="main-content">
          <header className="topbar">
            <div>
              <h1>{isSpot ? "Agar endpoint spot densitometry" : "XTT relative metabolic activity"}</h1>
              <p>{isSpot
                ? "Browser-only endpoint spot workflow with local background correction, explicit matched controls, and replicate-aware summaries."
                : "Browser-only 96-well workflow with confirmed geometry, explicit controls, and reproducible exports."}</p>
            </div>
            <div className="topbar-actions">
              <button className="secondary-button" type="button" onClick={() => setStep("image")}><ImageIcon size={16} /> Image</button>
              <button className="secondary-button" type="button" onClick={() => setStep("analysis")}><BarChart3 size={16} /> {isSpot ? "Endpoint signal" : "Analysis"}</button>
              <button className="secondary-button" type="button" onClick={() => setStep("report")}><MapIcon size={16} /> Exports</button>
              <button className="icon-button" type="button" onClick={resetProject} title="Reset project" aria-label="Reset project"><RotateCcw size={17} /></button>
            </div>
          </header>

          {isSyntheticDemo && (
            <div className="error-banner" role="status">
              Synthetic WebMCP demonstration image. Results are exploratory image-derived relative metabolic activity only; they are not calibrated plate-reader absorbance, a direct viable-cell count, or a validated MIC.
            </div>
          )}

          {step === "image" && (
            <>
              <div className="surface-panel">
                <div className="panel-heading compact"><h2>WebMCP synthetic demo</h2><span>No private data or API key required</span></div>
                <p>Loads deterministic synthetic XTT plate pixels with preconfirmed geometry and an empty plate map so agent changes remain visible.</p>
                <button className="secondary-button" type="button" onClick={() => void loadWebMcpDemo()}>Load WebMCP demo</button>
              </div>
              <UploadStep
                image={image}
                assayMode={assayMode}
                onAssayModeChange={handleAssayModeChange}
                onImageLoaded={handleImageLoaded}
                onProjectImported={handleProjectImported}
                onReset={resetProject}
              />
            </>
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
                footerAction={(
                  <button className="secondary-button plate-map-continue-button" type="button" disabled={!geometry.confirmed} onClick={() => setStep("plateMap")}>
                    <MapIcon size={16} /> {isSpot ? "Continue to spot map" : "Continue to plate map"}
                  </button>
                )}
                sideExtras={isSpot ? undefined : <GeminiKeyPanel disabled={!image} onDetect={runGeminiDetection} />}
              />
            </div>
          )}

          {step === "plateMap" && (isSpot ? (
            <SpotMapEditor
              spotMap={spotMap}
              rows={spotGridSettings.rows}
              columns={spotGridSettings.columns}
              onSpotMapChange={setSpotMap}
              actions={(
                <>
                  <button className="secondary-button" type="button" onClick={() => setStep("wells")}>Back to ROIs</button>
                  <button className="primary-button" type="button" disabled={!spotMapValidation.valid} onClick={() => setStep("analysis")}>Continue to growth</button>
                </>
              )}
            />
          ) : (
            <PlateMapEditor
              plateMap={plateMap}
              onPlateMapChange={commitPlateMap}
              sidebarSyncTarget={plateMapSidebarSyncTarget}
              actions={(
                <>
                  <button className="secondary-button" type="button" onClick={() => setStep("wells")}>Back to wells</button>
                  <button className="primary-button" type="button" disabled={!plateMapValidation.valid} onClick={() => setStep("analysis")}>Continue to analysis</button>
                </>
              )}
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
              spotControlGroupIds={spotControlGroupIds}
              spotReferenceControlGroupId={spotReferenceControlGroupId}
              onSpotReferenceControlGroupChange={setSpotReferenceControlGroupId}
              onRun={runAnalysis}
              selectedSeriesKey={focusedSeriesKey}
              onSelectedSeriesKeyChange={setFocusedSeriesKey}
              reviewNotice={reviewNotice}
            />
          )}

          {step === "report" && (
            <ReportExport
              image={image}
              assayMode={assayMode}
              geometry={geometry}
              plateMap={plateMap}
              spotMap={spotMap}
              spotReferenceControlGroupId={spotReferenceControlGroupId}
              analysis={analysis}
            />
          )}
        </main>
      </div>
    </>
  );
}
