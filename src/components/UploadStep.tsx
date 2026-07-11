import { Camera, CameraOff, Check, CircleDot, FileImage, FileJson, FlaskConical, Info, RefreshCcw, RotateCcw, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AssayMode, ImageSource, ProjectFile } from "../core/types";
import { ACCEPTED_IMAGE_TYPES, loadImageFile, type LoadedImage } from "../core/image/imageLoader";
import { parseProjectFile } from "../core/io/projectFile";

type CameraStatus = "idle" | "starting" | "preview" | "captured";

type UploadStepProps = {
  image?: LoadedImage;
  assayMode?: AssayMode;
  onAssayModeChange?: (assayMode: AssayMode) => void;
  onImageLoaded: (image: LoadedImage) => void;
  onProjectImported: (project: ProjectFile) => void;
  onReset: () => void;
};

const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    facingMode: { ideal: "environment" }
  },
  audio: false
};

export function UploadStep({ image, assayMode, onAssayModeChange, onImageLoaded, onProjectImported, onReset }: UploadStepProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const projectRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraRequestIdRef = useRef(0);
  const capturedPreviewUrlRef = useRef("");
  const [mode, setMode] = useState<ImageSource>("upload");
  const [error, setError] = useState("");
  const [cameraError, setCameraError] = useState("");
  const [loading, setLoading] = useState(false);
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>("idle");
  const [capturedFile, setCapturedFile] = useState<File | undefined>();
  const [capturedPreviewUrl, setCapturedPreviewUrl] = useState("");
  const activeAssayMode = assayMode ?? "xtt_96well_mic";

  useEffect(() => {
    return () => {
      stopCameraTracks();
      revokeCapturedPreviewUrl();
    };
  }, []);

  async function handleImage(file: File | undefined) {
    if (!file) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      onImageLoaded(await loadImageFile(file, { source: "upload" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Image upload failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleProject(file: File | undefined) {
    if (!file) {
      return;
    }
    setError("");
    try {
      const text = await file.text();
      onProjectImported(parseProjectFile(text));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Project import failed.");
    }
  }

  function selectMode(nextMode: ImageSource) {
    setMode(nextMode);
    setError("");
    setCameraError("");
    if (nextMode === "upload") {
      stopCameraTracks();
      clearCapturedImage();
      setCameraStatus("idle");
    }
  }

  function handleReset() {
    stopCameraTracks();
    clearCapturedImage();
    setCameraStatus("idle");
    onReset();
  }

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Camera capture is unavailable in this browser or context. Upload remains available.");
      setCameraStatus("idle");
      return;
    }

    stopCameraTracks();
    clearCapturedImage();
    setError("");
    setCameraError("");
    setCameraStatus("starting");
    const requestId = cameraRequestIdRef.current + 1;
    cameraRequestIdRef.current = requestId;

    try {
      const stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
      if (requestId !== cameraRequestIdRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      if (requestId !== cameraRequestIdRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      setCameraStatus("preview");
    } catch (err) {
      if (requestId !== cameraRequestIdRef.current) {
        return;
      }
      stopCameraTracks();
      setCameraStatus("idle");
      setCameraError(cameraErrorMessage(err));
    }
  }

  async function captureFrame() {
    const video = videoRef.current;
    if (!video || cameraStatus !== "preview") {
      setCameraError("Start the camera before capturing.");
      return;
    }

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (width <= 0 || height <= 0) {
      setCameraError("Camera frame is not ready yet.");
      return;
    }

    setCameraError("");
    try {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("Canvas capture is unavailable in this browser.");
      }
      ctx.drawImage(video, 0, 0, width, height);
      const blob = await canvasToPngBlob(canvas);
      const file = new File([blob], `assaylens-camera-${new Date().toISOString().replace(/[:.]/g, "-")}.png`, {
        type: "image/png",
        lastModified: Date.now()
      });
      const previewUrl = URL.createObjectURL(file);
      clearCapturedImage();
      capturedPreviewUrlRef.current = previewUrl;
      setCapturedPreviewUrl(previewUrl);
      setCapturedFile(file);
      setCameraStatus("captured");
      stopCameraTracks();
    } catch (err) {
      setCameraError(err instanceof Error ? err.message : "Camera capture failed.");
    }
  }

  async function useCapturedImage() {
    if (!capturedFile) {
      return;
    }
    setLoading(true);
    setError("");
    setCameraError("");
    try {
      onImageLoaded(await loadImageFile(capturedFile, { source: "camera" }));
      stopCameraTracks();
      clearCapturedImage();
      setCameraStatus("idle");
    } catch (err) {
      setCameraError(err instanceof Error ? err.message : "Captured image failed to load.");
    } finally {
      setLoading(false);
    }
  }

  function retakeCapture() {
    stopCameraTracks();
    clearCapturedImage();
    void startCamera();
  }

  function stopCamera() {
    stopCameraTracks();
    setCameraStatus("idle");
  }

  function stopCameraTracks() {
    cameraRequestIdRef.current += 1;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }

  function clearCapturedImage() {
    revokeCapturedPreviewUrl();
    setCapturedPreviewUrl("");
    setCapturedFile(undefined);
  }

  function revokeCapturedPreviewUrl() {
    if (capturedPreviewUrlRef.current) {
      URL.revokeObjectURL(capturedPreviewUrlRef.current);
      capturedPreviewUrlRef.current = "";
    }
  }

  return (
    <section className="surface-panel upload-panel">
      <div className="panel-heading">
        <div>
          <h2>Image</h2>
          <p>
            {activeAssayMode === "agar_spot_growth"
              ? "Use an original agar spot plate photo. Exploratory endpoint densitometry keeps source pixels local in this browser."
              : "Use the original XTT plate photo. Manual mode keeps the image local in this browser."}
          </p>
        </div>
        <button className="icon-button" type="button" onClick={handleReset} title="Reset project" aria-label="Reset project">
          <RotateCcw size={18} />
        </button>
      </div>

      <div className="upload-control-row">
        <div className="assay-mode-control">
          <span>Assay workflow</span>
          <div className="segmented-control" aria-label="Assay workflow">
            <button className={activeAssayMode === "xtt_96well_mic" ? "active" : ""} type="button" onClick={() => onAssayModeChange?.("xtt_96well_mic")}>
              <FlaskConical size={15} /> XTT relative metabolic activity
            </button>
            <button className={activeAssayMode === "agar_spot_growth" ? "active" : ""} type="button" onClick={() => onAssayModeChange?.("agar_spot_growth")}>
              <CircleDot size={15} /> Agar spots
            </button>
          </div>
        </div>

        <div className="acquisition-mode segmented-control" aria-label="Image acquisition mode">
          <button className={mode === "upload" ? "active" : ""} type="button" onClick={() => selectMode("upload")}>
            <Upload size={15} /> Upload
          </button>
          <button className={mode === "camera" ? "active" : ""} type="button" onClick={() => selectMode("camera")}>
            <Camera size={15} /> Camera
          </button>
        </div>
      </div>

      {mode === "upload" ? (
        <div
          className="drop-zone"
          role="button"
          tabIndex={0}
          aria-label="Upload plate photo"
          onClick={() => inputRef.current?.click()}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            void handleImage(event.dataTransfer.files[0]);
          }}
        >
          <input
            ref={inputRef}
            className="visually-hidden"
            type="file"
            accept={ACCEPTED_IMAGE_TYPES.join(",")}
            onChange={(event) => {
              void handleImage(event.currentTarget.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
          <FileImage size={38} />
          <div>
            <strong>{loading ? "Decoding image..." : "Upload plate photo"}</strong>
            <span>PNG, JPEG, WEBP, or browser-supported HEIC/HEIF</span>
          </div>
          <span className="primary-button faux-button">
            <Upload size={16} /> Select image
          </span>
        </div>
      ) : (
        <div className="camera-panel">
          <div className="camera-preview">
            {cameraStatus === "captured" && capturedPreviewUrl ? (
              <img src={capturedPreviewUrl} alt="Captured plate preview" />
            ) : (
              <video ref={videoRef} className={cameraStatus === "preview" ? "active" : ""} muted playsInline autoPlay />
            )}
            {cameraStatus === "preview" && <PlateFramingGuide />}
            {cameraStatus !== "preview" && cameraStatus !== "captured" && (
              <div className="camera-empty">
                <Camera size={32} />
                <strong>{cameraStatus === "starting" ? "Starting camera..." : "Camera ready"}</strong>
              </div>
            )}
          </div>
          <div className="camera-controls">
            {cameraStatus === "idle" && (
              <button className="primary-button" type="button" onClick={() => void startCamera()}>
                <Camera size={16} /> Start camera
              </button>
            )}
            {cameraStatus === "starting" && (
              <button className="secondary-button" type="button" onClick={stopCamera}>
                <CameraOff size={16} /> Stop camera
              </button>
            )}
            {cameraStatus === "preview" && (
              <>
                <button className="primary-button" type="button" onClick={() => void captureFrame()}>
                  <Camera size={16} /> Capture
                </button>
                <button className="secondary-button" type="button" onClick={stopCamera}>
                  <CameraOff size={16} /> Stop camera
                </button>
              </>
            )}
            {cameraStatus === "captured" && (
              <>
                <button className="secondary-button" type="button" onClick={retakeCapture}>
                  <RefreshCcw size={16} /> Retake
                </button>
                <button className="primary-button" type="button" disabled={loading} onClick={() => void useCapturedImage()}>
                  <Check size={16} /> {loading ? "Decoding image..." : "Use captured image"}
                </button>
              </>
            )}
          </div>
          {cameraError && <div className="error-banner compact-error">{cameraError}</div>}
        </div>
      )}

      <div className="recommendations">
        <div className="recommendation good">
          <Info size={16} />
          <span>Recommended: raw plate photo, no drawn circles, no plot screenshots, minimal glare.</span>
        </div>
        <div className="recommendation">
          <span>
            {activeAssayMode === "agar_spot_growth"
              ? "Agar endpoint spot signal is exploratory; validate it against reference masks and measurements before quantitative claims."
              : "Avoid screenshots with title areas, debug dots, or Gemini-annotated overlays."}
          </span>
        </div>
      </div>

      {image && (
        <div className="image-meta">
          <img src={image.url} alt={image.metadata.source === "camera" ? "Captured plate preview" : "Uploaded plate preview"} />
          <div>
            <strong>{image.metadata.name}</strong>
            <span>
              {image.metadata.source === "camera" ? "Camera capture" : "Upload"} | {image.metadata.width} x{" "}
              {image.metadata.height}px | {(image.metadata.size / 1024 / 1024).toFixed(2)} MB
            </span>
            <span>Background: {image.metadata.backgroundClass.replace("_", " ")}</span>
            {image.metadata.captureQuality && image.metadata.captureQuality.warnings.length > 0 && (
              <span>Capture QC: {image.metadata.captureQuality.warnings.join(", ")}</span>
            )}
            {image.metadata.warnings.map((warning) => (
              <p className="warning-text" key={warning}>
                {warning}
              </p>
            ))}
          </div>
        </div>
      )}

      <div className="project-import">
        <button className="secondary-button" type="button" onClick={() => projectRef.current?.click()}>
          <FileJson size={16} /> Import project JSON
        </button>
        <input
          ref={projectRef}
          className="visually-hidden"
          type="file"
          accept="application/json,.json"
          onChange={(event) => {
            void handleProject(event.currentTarget.files?.[0]);
            event.currentTarget.value = "";
          }}
        />
      </div>

      {error && <div className="error-banner">{error}</div>}
    </section>
  );
}

function PlateFramingGuide() {
  return (
    <div className="plate-framing-guide" aria-hidden="true">
      <div className="plate-guide-outer">
        <div className="plate-guide-grid">
          {Array.from({ length: 96 }, (_item, index) => (
            <span key={index} />
          ))}
        </div>
      </div>
    </div>
  );
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Camera capture could not be encoded as PNG."));
      }
    }, "image/png");
  });
}

function cameraErrorMessage(error: unknown): string {
  if (isPermissionDenied(error)) {
    return "Camera permission was denied. Upload remains available.";
  }
  return error instanceof Error ? error.message : "Camera could not be started. Upload remains available.";
}

function isPermissionDenied(error: unknown): boolean {
  return error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "PermissionDeniedError");
}
