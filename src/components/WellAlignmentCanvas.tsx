import {
  Check,
  Crosshair,
  Grid2X2,
  Maximize2,
  MousePointer2,
  Move,
  Redo2,
  RotateCcw,
  Undo2,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LoadedImage } from "../core/image/imageLoader";
import type { AnchorName, AssayMode, GeometryState, PlateAnchors, Point, SpotGridSettings } from "../core/types";
import { buildGridHomography, generatePlateGrid } from "../core/geometry/plateGrid";
import { hasCompleteAnchors, validateGeometry } from "../core/geometry/geometryValidation";
import { ROLE_COLORS, type PlateMapCell } from "../core/plateMap/plateMapTypes";
import { generateSpotGrid, normalizedSpotGridSettings } from "../core/assays/agarSpot/spotGrid";
import { SPOT_ROLE_COLORS, type SpotMapCell } from "../core/assays/agarSpot/spotMapTypes";
import { ManualAnchorWizard } from "./ManualAnchorWizard";

type ToolMode = "anchors" | "grid" | "centers" | "pan";
type DragState =
  | { type: "anchor"; anchor: AnchorName; startImage: Point; startGeometry: GeometryState }
  | { type: "grid"; startImage: Point; startGeometry: GeometryState }
  | { type: "well"; well: string; startImage: Point; startGeometry: GeometryState }
  | { type: "pan"; startScreen: Point; startPan: Point };

type WellAlignmentCanvasProps = {
  image?: LoadedImage;
  assayMode: AssayMode;
  geometry: GeometryState;
  plateMap: PlateMapCell[];
  spotMap?: SpotMapCell[];
  onGeometryChange: (geometry: GeometryState) => void;
  footerAction?: ReactNode;
  sideExtras?: ReactNode;
};

type DisplayRoi = {
  id: string;
  label: string;
  row: number;
  col: number;
  center: Point;
  overlayRadius: number;
  analysisRadius: number;
  role: string;
};

const ANCHOR_SEQUENCE: AnchorName[] = ["A1", "A12", "H12", "H1"];
const CANVAS_FONT_FAMILY = 'Aptos, "Segoe UI", system-ui, sans-serif';

export function WellAlignmentCanvas({ image, assayMode, geometry, plateMap, spotMap = [], onGeometryChange, footerAction, sideExtras }: WellAlignmentCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<ToolMode>("anchors");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [drag, setDrag] = useState<DragState | null>(null);
  const [selectedAnchor, setSelectedAnchor] = useState<AnchorName | null>(null);
  const [selectedWell, setSelectedWell] = useState<string | null>(null);
  const [history, setHistory] = useState<GeometryState[]>([]);
  const [future, setFuture] = useState<GeometryState[]>([]);

  const validation = useMemo(
    () => validateGeometry(geometry.anchors, image?.metadata.width ?? 0, image?.metadata.height ?? 0),
    [geometry.anchors, image?.metadata.height, image?.metadata.width]
  );

  const grid = useMemo<DisplayRoi[]>(() => {
    if (!hasCompleteAnchors(geometry.anchors)) {
      return [];
    }
    if (assayMode === "agar_spot_growth") {
      const roleById = new Map(spotMap.map((cell) => [cell.id, cell.role]));
      return generateSpotGrid(geometry.anchors as PlateAnchors, geometry.spotGrid).map((roi) => ({
        id: roi.id,
        label: roi.label ?? roi.id,
        row: roi.row,
        col: roi.col,
        center: roi.center,
        overlayRadius: roi.overlayRadiusX ?? roi.radiusX,
        analysisRadius: roi.radiusX,
        role: roleById.get(roi.id) ?? "unused"
      }));
    }
    const homography = buildGridHomography(geometry.anchors as PlateAnchors);
    const roleByWell = new Map(plateMap.map((cell) => [cell.well, cell.role]));
    return generatePlateGrid(homography, geometry.analysisRadiusFactor, geometry.overlayRadiusFactor).map((well) => {
      const adjustment = geometry.wellAdjustments[well.well];
      const adjusted = adjustment
        ? { ...well, center: { x: well.center.x + adjustment.x, y: well.center.y + adjustment.y } }
        : well;
      return {
        id: adjusted.well,
        label: adjusted.well,
        row: adjusted.row,
        col: adjusted.col,
        center: adjusted.center,
        overlayRadius: adjusted.overlayRadius,
        analysisRadius: adjusted.analysisRadius,
        role: roleByWell.get(adjusted.well) ?? "unused"
      };
    });
  }, [assayMode, geometry, plateMap, spotMap]);

  useEffect(() => {
    draw();
  }, [image, geometry, grid, zoom, pan, selectedAnchor, selectedWell, tool]);

  useEffect(() => {
    const observer = new ResizeObserver(() => draw());
    if (wrapperRef.current) {
      observer.observe(wrapperRef.current);
    }
    return () => observer.disconnect();
  }, [image, geometry, grid, zoom, pan]);

  function transform() {
    const canvas = canvasRef.current;
    if (!canvas || !image) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    const fit = Math.min((rect.width - 32) / image.metadata.width, (rect.height - 32) / image.metadata.height);
    const scale = Math.max(0.02, fit * zoom);
    return {
      scale,
      x: (rect.width - image.metadata.width * scale) / 2 + pan.x,
      y: (rect.height - image.metadata.height * scale) / 2 + pan.y
    };
  }

  function imageToScreen(point: Point): Point {
    const t = transform();
    return t ? { x: point.x * t.scale + t.x, y: point.y * t.scale + t.y } : point;
  }

  function screenToImage(point: Point): Point {
    const t = transform();
    return t ? { x: (point.x - t.x) / t.scale, y: (point.y - t.y) / t.scale } : point;
  }

  function draw() {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) {
      return;
    }
    const rect = wrapper.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = "#f6f9fb";
    ctx.fillRect(0, 0, rect.width, rect.height);

    if (!image) {
      ctx.fillStyle = "#52606c";
      ctx.font = `600 14px ${CANVAS_FONT_FAMILY}`;
      ctx.textAlign = "center";
      ctx.fillText("Load an original plate image to begin alignment", rect.width / 2, rect.height / 2);
      return;
    }

    const t = transform();
    if (!t) {
      return;
    }
    ctx.save();
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image.bitmap, t.x, t.y, image.metadata.width * t.scale, image.metadata.height * t.scale);
    ctx.restore();

    drawGrid(ctx, t.scale);
    drawAnchors(ctx, t.scale);
  }

  function drawGrid(ctx: CanvasRenderingContext2D, scale: number) {
    if (grid.length === 0) {
      return;
    }
    const roleColors = assayMode === "agar_spot_growth" ? SPOT_ROLE_COLORS : ROLE_COLORS;
    ctx.lineWidth = 1.5;
    ctx.font = `600 12px ${CANVAS_FONT_FAMILY}`;
    for (const roi of grid) {
      const screen = imageToScreen(roi.center);
      const overlayRadius = roi.overlayRadius * scale;
      const analysisRadius = roi.analysisRadius * scale;
      const isSelected = selectedWell === roi.id;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, overlayRadius, 0, Math.PI * 2);
      ctx.strokeStyle = isSelected ? "#0b7280" : roleColors[roi.role as keyof typeof roleColors] ?? "#a5adb8";
      ctx.lineWidth = isSelected ? 2.6 : 1.4;
      ctx.stroke();
      ctx.save();
      ctx.setLineDash([Math.max(2, 3 * scale), Math.max(2, 3 * scale)]);
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, analysisRadius, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(20, 32, 42, 0.72)";
      ctx.lineWidth = 1.7;
      ctx.stroke();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
      ctx.lineWidth = 0.9;
      ctx.stroke();
      ctx.restore();
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, Math.max(2.4, overlayRadius * 0.12), 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? "#0b7280" : "#0f8a96";
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      if (roi.row === 0) {
        ctx.fillStyle = "#14202a";
        ctx.textAlign = "center";
        ctx.fillText(String(roi.col + 1), screen.x, screen.y - overlayRadius - 9);
      }
      if (roi.col === 0) {
        ctx.fillStyle = "#14202a";
        ctx.textAlign = "right";
        ctx.fillText(assayMode === "agar_spot_growth" ? String(roi.row + 1) : "ABCDEFGH"[roi.row], screen.x - overlayRadius - 8, screen.y + 4);
      }
    }
  }

  function drawAnchors(ctx: CanvasRenderingContext2D, scale: number) {
    for (const anchor of ANCHOR_SEQUENCE) {
      const point = geometry.anchors[anchor];
      if (!point) {
        continue;
      }
      const screen = imageToScreen(point);
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, Math.max(6, 7 * scale), 0, Math.PI * 2);
      ctx.fillStyle = selectedAnchor === anchor ? "#0b7280" : "#ffffff";
      ctx.strokeStyle = "#0b7280";
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = selectedAnchor === anchor ? "#ffffff" : "#0b7280";
      ctx.font = `700 11px ${CANVAS_FONT_FAMILY}`;
      ctx.textAlign = "center";
      ctx.fillText(anchor, screen.x, screen.y + 4);
    }
  }

  function pushHistory(previous: GeometryState) {
    setHistory((items) => [...items.slice(-24), previous]);
    setFuture([]);
  }

  function setGeometry(next: GeometryState, previousForHistory?: GeometryState) {
    if (previousForHistory) {
      pushHistory(previousForHistory);
    }
    onGeometryChange(next);
  }

  function pointerPosition(event: React.PointerEvent<HTMLCanvasElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!image) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const screen = pointerPosition(event);
    const imagePoint = screenToImage(screen);
    const nextAnchor = ANCHOR_SEQUENCE.find((anchor) => !geometry.anchors[anchor]);

    if (nextAnchor) {
      setGeometry(
        {
          ...geometry,
          confirmed: false,
          anchors: { ...geometry.anchors, [nextAnchor]: clampToImage(imagePoint, image) }
        },
        geometry
      );
      setSelectedAnchor(nextAnchor);
      return;
    }

    if (tool === "pan") {
      setDrag({ type: "pan", startScreen: screen, startPan: pan });
      return;
    }

    const nearestAnchor = nearestAnchorAt(imagePoint);
    if (tool === "anchors" && nearestAnchor) {
      setSelectedAnchor(nearestAnchor);
      setSelectedWell(null);
      setDrag({ type: "anchor", anchor: nearestAnchor, startImage: imagePoint, startGeometry: geometry });
      return;
    }

    const nearestWell = nearestWellAt(imagePoint);
    if (tool === "centers" && nearestWell) {
      setSelectedWell(nearestWell);
      setSelectedAnchor(null);
      setDrag({ type: "well", well: nearestWell, startImage: imagePoint, startGeometry: geometry });
      return;
    }

    if (tool === "grid") {
      setDrag({ type: "grid", startImage: imagePoint, startGeometry: geometry });
    }
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drag || !image) {
      return;
    }
    const screen = pointerPosition(event);
    const imagePoint = screenToImage(screen);
    if (drag.type === "pan") {
      setPan({ x: drag.startPan.x + screen.x - drag.startScreen.x, y: drag.startPan.y + screen.y - drag.startScreen.y });
      return;
    }

    const delta = { x: imagePoint.x - drag.startImage.x, y: imagePoint.y - drag.startImage.y };
    if (drag.type === "anchor") {
      const startPoint = drag.startGeometry.anchors[drag.anchor];
      if (!startPoint) {
        return;
      }
      onGeometryChange({
        ...drag.startGeometry,
        confirmed: false,
        anchors: {
          ...drag.startGeometry.anchors,
          [drag.anchor]: clampToImage({ x: startPoint.x + delta.x, y: startPoint.y + delta.y }, image)
        }
      });
    } else if (drag.type === "grid") {
      onGeometryChange({
        ...drag.startGeometry,
        confirmed: false,
        anchors: Object.fromEntries(
          Object.entries(drag.startGeometry.anchors).map(([name, point]) => [
            name,
            clampToImage({ x: point.x + delta.x, y: point.y + delta.y }, image)
          ])
        ) as Partial<PlateAnchors>
      });
    } else if (drag.type === "well") {
      const roi = grid.find((candidate) => candidate.id === drag.well);
      if (!roi) {
        return;
      }
      if (assayMode === "agar_spot_growth") {
        const startGrid = normalizedSpotGridSettings(drag.startGeometry.spotGrid);
        const startAdjustment = startGrid.roiAdjustments[drag.well] ?? { x: 0, y: 0 };
        onGeometryChange({
          ...drag.startGeometry,
          confirmed: false,
          spotGrid: {
            ...startGrid,
            roiAdjustments: {
              ...startGrid.roiAdjustments,
              [drag.well]: {
                x: startAdjustment.x + delta.x,
                y: startAdjustment.y + delta.y
              }
            }
          }
        });
        return;
      }
      const startAdjustment = drag.startGeometry.wellAdjustments[drag.well] ?? { x: 0, y: 0 };
      onGeometryChange({
        ...drag.startGeometry,
        confirmed: false,
        wellAdjustments: {
          ...drag.startGeometry.wellAdjustments,
          [drag.well]: {
            x: startAdjustment.x + delta.x,
            y: startAdjustment.y + delta.y
          }
        }
      });
    }
  }

  function handlePointerUp() {
    if (drag && drag.type !== "pan") {
      pushHistory(drag.startGeometry);
    }
    setDrag(null);
  }

  function nearestAnchorAt(point: Point): AnchorName | null {
    let best: { anchor: AnchorName; distance: number } | null = null;
    for (const anchor of ANCHOR_SEQUENCE) {
      const anchorPoint = geometry.anchors[anchor];
      if (!anchorPoint) {
        continue;
      }
      const distance = Math.hypot(anchorPoint.x - point.x, anchorPoint.y - point.y);
      if (!best || distance < best.distance) {
        best = { anchor, distance };
      }
    }
    return best && best.distance < 24 / Math.max(transform()?.scale ?? 1, 0.01) ? best.anchor : null;
  }

  function nearestWellAt(point: Point): string | null {
    let best: { well: string; distance: number } | null = null;
    for (const roi of grid) {
      const distance = Math.hypot(roi.center.x - point.x, roi.center.y - point.y);
      if (!best || distance < best.distance) {
        best = { well: roi.id, distance };
      }
    }
    return best && best.distance < 18 / Math.max(transform()?.scale ?? 1, 0.01) ? best.well : null;
  }

  function undo() {
    const previous = history.at(-1);
    if (!previous) {
      return;
    }
    setFuture((items) => [geometry, ...items]);
    setHistory((items) => items.slice(0, -1));
    onGeometryChange(previous);
  }

  function redo() {
    const next = future[0];
    if (!next) {
      return;
    }
    setHistory((items) => [...items, geometry]);
    setFuture((items) => items.slice(1));
    onGeometryChange(next);
  }

  function nudge(dx: number, dy: number) {
    if (!image) {
      return;
    }
    const previous = geometry;
    if (selectedAnchor && geometry.anchors[selectedAnchor]) {
      const point = geometry.anchors[selectedAnchor];
      setGeometry(
        {
          ...geometry,
          confirmed: false,
          anchors: {
            ...geometry.anchors,
            [selectedAnchor]: clampToImage({ x: point.x + dx, y: point.y + dy }, image)
          }
        },
        previous
      );
    } else if (selectedWell) {
      if (assayMode === "agar_spot_growth") {
        const spotGrid = normalizedSpotGridSettings(geometry.spotGrid);
        const current = spotGrid.roiAdjustments[selectedWell] ?? { x: 0, y: 0 };
        setGeometry(
          {
            ...geometry,
            confirmed: false,
            spotGrid: {
              ...spotGrid,
              roiAdjustments: {
                ...spotGrid.roiAdjustments,
                [selectedWell]: { x: current.x + dx, y: current.y + dy }
              }
            }
          },
          previous
        );
      } else {
        const current = geometry.wellAdjustments[selectedWell] ?? { x: 0, y: 0 };
        setGeometry(
          {
            ...geometry,
            confirmed: false,
            wellAdjustments: {
              ...geometry.wellAdjustments,
              [selectedWell]: { x: current.x + dx, y: current.y + dy }
            }
          },
          previous
        );
      }
    } else if (hasCompleteAnchors(geometry.anchors)) {
      setGeometry(
        {
          ...geometry,
          confirmed: false,
          anchors: Object.fromEntries(
            Object.entries(geometry.anchors).map(([name, point]) => [
              name,
              clampToImage({ x: point.x + dx, y: point.y + dy }, image)
            ])
          ) as Partial<PlateAnchors>
        },
        previous
      );
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLCanvasElement>) {
    const distance = event.shiftKey ? 8 : 1;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      nudge(-distance, 0);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      nudge(distance, 0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      nudge(0, -distance);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      nudge(0, distance);
    } else if (event.key.toLowerCase() === "z") {
      event.preventDefault();
      undo();
    } else if (event.key.toLowerCase() === "r") {
      event.preventDefault();
      resetAnchors();
    } else if (event.key === "Enter") {
      event.preventDefault();
      confirmWells();
    }
  }

  function resetAnchors() {
    setGeometry(
      {
        ...geometry,
        anchors: {},
        confirmed: false,
        wellAdjustments: {},
        spotGrid: geometry.spotGrid ? { ...normalizedSpotGridSettings(geometry.spotGrid), roiAdjustments: {} } : undefined
      },
      geometry
    );
    setSelectedAnchor(null);
    setSelectedWell(null);
  }

  function confirmWells() {
    if (!validation.valid || !hasCompleteAnchors(geometry.anchors)) {
      return;
    }
    setGeometry({ ...geometry, confirmed: true }, geometry);
  }

  function fitView() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  const spotGridSettings = normalizedSpotGridSettings(geometry.spotGrid);

  function updateSpotGridSettings(patch: Partial<SpotGridSettings>) {
    onGeometryChange({
      ...geometry,
      confirmed: false,
      spotGrid: {
        ...spotGridSettings,
        ...patch,
        roiAdjustments: patch.roiAdjustments ?? (patch.rows || patch.columns ? {} : spotGridSettings.roiAdjustments)
      }
    });
  }

  return (
    <section className="alignment-layout">
      <div className="surface-panel canvas-panel">
        <div className="canvas-toolbar">
          <div className="segmented-control" aria-label="Alignment tool">
            <button className={tool === "anchors" ? "active" : ""} type="button" onClick={() => setTool("anchors")}>
              <Crosshair size={15} /> Anchors
            </button>
            <button className={tool === "grid" ? "active" : ""} type="button" onClick={() => setTool("grid")}>
              <Move size={15} /> Grid
            </button>
            <button className={tool === "centers" ? "active" : ""} type="button" onClick={() => setTool("centers")}>
              <MousePointer2 size={15} /> {assayMode === "agar_spot_growth" ? "ROIs" : "Centers"}
            </button>
            <button className={tool === "pan" ? "active" : ""} type="button" onClick={() => setTool("pan")}>
              <Grid2X2 size={15} /> Pan
            </button>
          </div>
          <div className="zoom-controls">
            <button
              className="icon-button"
              type="button"
              onClick={() => setZoom((value) => Math.max(0.2, value - 0.1))}
              title="Zoom out"
              aria-label="Zoom out"
            >
              <ZoomOut size={16} />
            </button>
            <span>{Math.round(zoom * 100)}%</span>
            <button
              className="icon-button"
              type="button"
              onClick={() => setZoom((value) => Math.min(3, value + 0.1))}
              title="Zoom in"
              aria-label="Zoom in"
            >
              <ZoomIn size={16} />
            </button>
            <button className="icon-button" type="button" onClick={fitView} title="Fit image" aria-label="Fit image">
              <Maximize2 size={16} />
            </button>
          </div>
          <div className="history-controls">
            <button className="icon-button" type="button" onClick={undo} disabled={history.length === 0} title="Undo" aria-label="Undo">
              <Undo2 size={16} />
            </button>
            <button className="icon-button" type="button" onClick={redo} disabled={future.length === 0} title="Redo" aria-label="Redo">
              <Redo2 size={16} />
            </button>
          </div>
        </div>
        <div className="canvas-wrap" ref={wrapperRef}>
          <canvas
            ref={canvasRef}
            tabIndex={0}
            onKeyDown={handleKeyDown}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            aria-label={
              assayMode === "agar_spot_growth"
                ? "Spot ROI alignment canvas. Use arrow keys to nudge the selected anchor, ROI, or grid."
                : "Well alignment canvas. Use arrow keys to nudge the selected anchor, well, or grid."
            }
          />
        </div>
        <div className="alignment-footer">
          {assayMode === "agar_spot_growth" ? (
            <>
              <label className="analysis-radius-control">
                <span className="alignment-label-row">
                  <span>ROI radius</span>
                  <strong>{spotGridSettings.analysisRadiusFactor.toFixed(3)} pitch</strong>
                </span>
                <input
                  type="range"
                  min="0.12"
                  max="0.45"
                  step="0.005"
                  value={spotGridSettings.analysisRadiusFactor}
                  onChange={(event) => updateSpotGridSettings({ analysisRadiusFactor: Number(event.target.value) })}
                />
              </label>
              <label className="a1-orientation-control">
                <span className="alignment-label-row">
                  <span>Rows</span>
                </span>
                <input
                  type="number"
                  min="2"
                  max="16"
                  value={spotGridSettings.rows}
                  onChange={(event) => updateSpotGridSettings({ rows: Number(event.target.value) })}
                />
              </label>
              <label className="a1-orientation-control">
                <span className="alignment-label-row">
                  <span>Columns</span>
                </span>
                <input
                  type="number"
                  min="2"
                  max="24"
                  value={spotGridSettings.columns}
                  onChange={(event) => updateSpotGridSettings({ columns: Number(event.target.value) })}
                />
              </label>
            </>
          ) : (
            <>
              <label className="analysis-radius-control">
                <span className="alignment-label-row">
                  <span>Analysis radius</span>
                  <strong>{geometry.analysisRadiusFactor.toFixed(3)} pitch</strong>
                </span>
                <input
                  type="range"
                  min="0.25"
                  max="0.3"
                  step="0.005"
                  value={geometry.analysisRadiusFactor}
                  onChange={(event) =>
                    onGeometryChange({ ...geometry, confirmed: false, analysisRadiusFactor: Number(event.target.value) })
                  }
                />
              </label>
              <label className="a1-orientation-control">
                <span className="alignment-label-row">
                  <span>A1 orientation</span>
                </span>
                <select
                  value={geometry.a1Position}
                  onChange={(event) => onGeometryChange({ ...geometry, confirmed: false, a1Position: event.target.value as GeometryState["a1Position"] })}
                >
                  <option value="top_left">Top left</option>
                  <option value="top_right">Top right</option>
                  <option value="bottom_left">Bottom left</option>
                  <option value="bottom_right">Bottom right</option>
                  <option value="uncertain">Uncertain</option>
                </select>
              </label>
            </>
          )}
          <button className="primary-button" type="button" disabled={!validation.valid} onClick={confirmWells}>
            <Check size={16} /> {assayMode === "agar_spot_growth" ? "Confirm ROIs" : "Confirm wells"}
          </button>
          {footerAction}
        </div>
      </div>
      <aside className="alignment-side">
        <ManualAnchorWizard anchors={geometry.anchors} onReset={resetAnchors} />
        <details className={`qc-card collapsible-card ${validation.valid ? "valid" : "invalid"}`} open>
          <summary>
            <strong>{geometry.confirmed ? "Wells confirmed" : validation.valid ? "Geometry ready" : "Geometry pending"}</strong>
            <span>Confidence {Math.round(validation.confidence * 100)}%</span>
          </summary>
          <div className="collapsible-card-body">
            {validation.warnings.length > 0 && (
              <ul>
                {validation.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
            <p>Keyboard: arrows nudge selection, Shift+arrows larger nudge, Z undo, R reset, Enter confirm.</p>
          </div>
        </details>
        {sideExtras}
      </aside>
    </section>
  );
}

function clampToImage(point: Point, image: LoadedImage): Point {
  return {
    x: Math.min(image.metadata.width, Math.max(0, point.x)),
    y: Math.min(image.metadata.height, Math.max(0, point.y))
  };
}
