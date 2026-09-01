import type { AnalyzeImageMessage, ImageAnalysisWorkerResponse } from "../../workers/imageAnalysis.worker";
import type { AnalysisResult } from "../types";

export function runImageAnalysisWorker(
  message: AnalyzeImageMessage,
  signal?: AbortSignal,
  onWorker?: (worker: Worker | null) => void
): Promise<AnalysisResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Analysis cancelled.", "AbortError"));
      return;
    }
    const worker = new Worker(new URL("../../workers/imageAnalysis.worker.ts", import.meta.url), { type: "module" });
    onWorker?.(worker);
    let settled = false;
    const finish = () => {
      if (settled) return false;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      onWorker?.(null);
      worker.terminate();
      return true;
    };
    const onAbort = () => {
      if (!finish()) return;
      reject(new DOMException("Analysis cancelled.", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    worker.onmessage = (event: MessageEvent<ImageAnalysisWorkerResponse>) => {
      if (!finish()) return;
      if (event.data.type === "complete") resolve(event.data.result);
      else reject(new Error(event.data.message));
    };
    worker.onerror = (event) => {
      if (!finish()) return;
      reject(new Error(event.message || "Worker analysis failed."));
    };
    worker.postMessage(message);
  });
}
