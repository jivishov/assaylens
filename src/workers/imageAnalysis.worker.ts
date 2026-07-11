import { analyzeAgarSpotImage } from "../core/assays/agarSpot/spotAnalysis";
import { analyzeXtt96Image } from "../core/assays/xtt96/xttAnalysis";
import type {
  AgarSpotAnalysisSettings,
  AnalysisResult,
  AnalysisSettings,
  GeometryState,
  InputWarningCode,
  PlateAnchors,
  SpotGridSettings
} from "../core/types";
import type { PlateMapCell } from "../core/plateMap/plateMapTypes";
import type { SpotMapCell } from "../core/assays/agarSpot/spotMapTypes";
import { validateAnalyzeImageMessage } from "../core/analysis/workerValidation";

export type AnalyzeImageMessage =
  | {
      type: "analyze";
      assayMode: "xtt_96well_mic";
      imageData: ImageData;
      geometry: GeometryState;
      roiMap: PlateMapCell[];
      settings: AnalysisSettings;
      inputWarnings: InputWarningCode[];
      protocolId: string;
    }
  | {
      type: "analyze";
      assayMode: "agar_spot_growth";
      imageData: ImageData;
      geometry: GeometryState;
      roiMap: SpotMapCell[];
      settings: AgarSpotAnalysisSettings;
      inputWarnings: InputWarningCode[];
      protocolId: string;
    };

export type ImageAnalysisWorkerResponse =
  | { type: "complete"; result: AnalysisResult }
  | { type: "error"; message: string };

self.onmessage = (event: MessageEvent<AnalyzeImageMessage>) => {
  if (event.data.type !== "analyze") {
    return;
  }

  try {
    validateAnalyzeImageMessage(event.data);
    const anchors = event.data.geometry.anchors as PlateAnchors;
    if (event.data.assayMode === "xtt_96well_mic") {
      self.postMessage({
        type: "complete",
        result: analyzeXtt96Image({
          imageData: event.data.imageData,
          anchors,
          wellAdjustments: event.data.geometry.wellAdjustments,
          analysisRadiusFactor: event.data.geometry.analysisRadiusFactor,
          overlayRadiusFactor: event.data.geometry.overlayRadiusFactor,
          plateMap: event.data.roiMap,
          settings: event.data.settings,
          inputWarnings: event.data.inputWarnings
        })
      } satisfies ImageAnalysisWorkerResponse);
      return;
    }

    self.postMessage({
      type: "complete",
      result: analyzeAgarSpotImage({
        imageData: event.data.imageData,
        anchors,
        spotMap: event.data.roiMap,
        gridSettings: event.data.geometry.spotGrid as Partial<SpotGridSettings> | undefined,
        settings: event.data.settings,
        inputWarnings: event.data.inputWarnings
      })
    } satisfies ImageAnalysisWorkerResponse);
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "Image analysis failed."
    } satisfies ImageAnalysisWorkerResponse);
  }
};
