import { ChevronDown, ChevronRight, Clipboard, Download, Redo2, Save, Undo2, Upload, Wand2 } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { COLUMNS, ROWS, ROW_LABELS } from "../core/geometry/plateGrid";
import { parsePlateMapCsv, plateMapToCsv } from "../core/io/csv";
import { downloadText } from "../core/io/projectFile";
import {
  applyPlateMapAssignment,
  parsePlateMapAssignment,
  plateMapCellDisplay,
  type PlateMapAssignment,
  type PlateMapCellDisplay
} from "../core/plateMap/plateMapDisplay";
import {
  cellKey,
  getCell,
  isWellRole,
  roleAcceptsAssignmentMetadata,
  roleAcceptsConcentration,
  ROLE_COLORS,
  ROLE_LABELS,
  type PlateMapCell,
  type WellRole
} from "../core/plateMap/plateMapTypes";
import { validatePlateMap } from "../core/plateMap/plateMapValidation";
import { SerialDilutionWizard } from "./SerialDilutionWizard";

type PlateMapEditorProps = {
  plateMap: PlateMapCell[];
  onPlateMapChange: (plateMap: PlateMapCell[]) => void;
  actions?: ReactNode;
};

const TEMPLATE_KEY = "assaylens.plateMapTemplates";
const LEGACY_TEMPLATE_KEYS = ["micvision.plateMapTemplates"];
type PanelKey = "selection" | "serialDilution" | "csvTemplates";
const CELL_POPOVER_ID = "plate-map-cell-popover";
const CELL_POPOVER_DELAY_MS = 220;
const CELL_POPOVER_WIDTH = 260;
const CELL_POPOVER_GAP = 10;
const VIEWPORT_PADDING = 12;

type CellPopoverSource = "hover" | "focus";

type CellPopoverPosition = {
  left: number;
  top: number;
  placement: "above" | "below";
};

type CellPopoverState = {
  key: string;
  cell: PlateMapCell;
  display: PlateMapCellDisplay;
  position: CellPopoverPosition;
  source: CellPopoverSource;
};

export function PlateMapEditor({ plateMap, onPlateMapChange, actions }: PlateMapEditorProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const hoverTimerRef = useRef<ReturnType<typeof window.setTimeout> | undefined>(undefined);
  const hoverTargetKeyRef = useRef<string | null>(null);
  const draggingRef = useRef(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(["0:0"]));
  const [cellPopover, setCellPopover] = useState<CellPopoverState | null>(null);
  const [history, setHistory] = useState<PlateMapCell[][]>([]);
  const [future, setFuture] = useState<PlateMapCell[][]>([]);
  const [role, setRole] = useState<WellRole>("sample");
  const [compoundId, setCompoundId] = useState("Compound X");
  const [sampleId, setSampleId] = useState("Sample 1");
  const [concentration, setConcentration] = useState("");
  const [unit, setUnit] = useState("ug/mL");
  const [templateName, setTemplateName] = useState("XTT template");
  const [templates, setTemplates] = useState<Record<string, PlateMapCell[]>>(() => loadTemplates());
  const [pasteText, setPasteText] = useState("");
  const [error, setError] = useState("");
  const [openPanels, setOpenPanels] = useState<Record<PanelKey, boolean>>({
    selection: true,
    serialDilution: true,
    csvTemplates: true
  });
  const validation = useMemo(() => validatePlateMap(plateMap), [plateMap]);
  const roleAcceptsMetadata = roleAcceptsAssignmentMetadata(role);
  const roleAcceptsDose = roleAcceptsConcentration(role);
  const concentrationLabel = role === "vehicle_control" ? "Vehicle concentration" : "Concentration";
  const selectedCells = useMemo(
    () =>
      [...selected].map((key) => {
        const [row, col] = key.split(":").map(Number);
        return getCell(plateMap, row, col);
      }),
    [plateMap, selected]
  );
  const sortedSelectedCells = useMemo(() => [...selectedCells].sort((a, b) => a.row - b.row || a.col - b.col), [selectedCells]);
  const selectedRows = [...new Set(selectedCells.map((cell) => cell.row))].sort((a, b) => a - b);
  const selectedCols = [...new Set(selectedCells.map((cell) => cell.col))].sort((a, b) => a - b);
  const startCell = sortedSelectedCells[0] ?? { row: 0, col: 0 };
  const templateNames = useMemo(() => Object.keys(templates).sort((a, b) => a.localeCompare(b)), [templates]);

  const clearPopoverTimer = useCallback(() => {
    if (hoverTimerRef.current !== undefined) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = undefined;
    }
  }, []);

  const hidePopover = useCallback(() => {
    clearPopoverTimer();
    hoverTargetKeyRef.current = null;
    setCellPopover(null);
  }, [clearPopoverTimer]);

  const positionPopover = useCallback((rect: DOMRect): CellPopoverPosition | null => {
    if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) {
      return null;
    }
    const width = Math.min(CELL_POPOVER_WIDTH, Math.max(0, window.innerWidth - VIEWPORT_PADDING * 2));
    const left = clamp(rect.left + rect.width / 2 - width / 2, VIEWPORT_PADDING, window.innerWidth - VIEWPORT_PADDING - width);
    const placement = rect.top > 150 ? "above" : "below";
    const top = placement === "above" ? rect.top - CELL_POPOVER_GAP : rect.bottom + CELL_POPOVER_GAP;

    return {
      left,
      top,
      placement
    };
  }, []);

  const showPopover = useCallback(
    (cell: PlateMapCell, key: string, target: HTMLElement, source: CellPopoverSource) => {
      const display = plateMapCellDisplay(cell);
      if (source === "hover" && !display.hasMetadata) {
        return;
      }
      const position = positionPopover(target.getBoundingClientRect());
      if (!position) {
        return;
      }
      setCellPopover({ key, cell, display, position, source });
    },
    [positionPopover]
  );

  const scheduleHoverPopover = useCallback(
    (cell: PlateMapCell, key: string, target: HTMLElement) => {
      if (hoverTargetKeyRef.current === key) {
        return;
      }
      hoverTargetKeyRef.current = key;
      clearPopoverTimer();
      const display = plateMapCellDisplay(cell);
      if (!display.hasMetadata) {
        hoverTargetKeyRef.current = null;
        return;
      }
      hoverTimerRef.current = window.setTimeout(() => {
        if (!document.body.contains(target) || hoverTargetKeyRef.current !== key) {
          return;
        }
        showPopover(cell, key, target, "hover");
      }, CELL_POPOVER_DELAY_MS);
    },
    [clearPopoverTimer, showPopover]
  );

  useEffect(() => hidePopover(), [hidePopover, plateMap]);

  useEffect(() => {
    return () => clearPopoverTimer();
  }, [clearPopoverTimer]);

  useEffect(() => {
    if (!cellPopover) {
      return;
    }
    function hideForViewportChange() {
      hidePopover();
    }
    function hideForEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        hidePopover();
      }
    }
    window.addEventListener("scroll", hideForViewportChange, true);
    window.addEventListener("resize", hideForViewportChange);
    window.addEventListener("keydown", hideForEscape);
    return () => {
      window.removeEventListener("scroll", hideForViewportChange, true);
      window.removeEventListener("resize", hideForViewportChange);
      window.removeEventListener("keydown", hideForEscape);
    };
  }, [cellPopover, hidePopover]);

  function commit(next: PlateMapCell[]) {
    setError("");
    setHistory((items) => [...items.slice(-24), plateMap.map((cell) => ({ ...cell }))]);
    setFuture([]);
    onPlateMapChange(next);
  }

  function assignSelection() {
    let assignment: PlateMapAssignment;
    try {
      assignment = parsePlateMapAssignment({
        role,
        compoundId,
        sampleId,
        concentrationText: concentration,
        unit
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Plate-map assignment failed.");
      return;
    }

    commit(
      plateMap.map((cell) =>
        selected.has(cellKey(cell.row, cell.col)) ? applyPlateMapAssignment(cell, assignment) : cell
      )
    );
  }

  function selectRow(row: number) {
    setSelected(new Set(Array.from({ length: COLUMNS }, (_item, col) => cellKey(row, col))));
  }

  function selectCol(col: number) {
    setSelected(new Set(Array.from({ length: ROWS }, (_item, row) => cellKey(row, col))));
  }

  function selectAll() {
    setSelected(new Set(plateMap.map((cell) => cellKey(cell.row, cell.col))));
  }

  function togglePanel(panel: PanelKey) {
    setOpenPanels((panels) => ({ ...panels, [panel]: !panels[panel] }));
  }

  function undo() {
    const previous = history.at(-1);
    if (!previous) {
      return;
    }
    setFuture((items) => [plateMap, ...items]);
    setHistory((items) => items.slice(0, -1));
    onPlateMapChange(previous);
  }

  function redo() {
    const next = future[0];
    if (!next) {
      return;
    }
    setHistory((items) => [...items, plateMap]);
    setFuture((items) => items.slice(1));
    onPlateMapChange(next);
  }

  async function copySelection() {
    if (!navigator.clipboard?.writeText) {
      setError("Clipboard access is unavailable in this browser context.");
      return;
    }
    const rows = sortedSelectedCells
      .map((cell) => [cell.well, cell.role, cell.compoundId, cell.sampleId, cell.concentration ?? "", cell.unit].join("\t"));
    try {
      await navigator.clipboard.writeText(rows.join("\n"));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Selection could not be copied.");
    }
  }

  function pasteSpreadsheet(text: string) {
    setError("");
    const trimmed = text.trim();
    if (!trimmed) {
      setError("Paste concentration values or well roles before applying.");
      return;
    }
    try {
      const rows = text
        .trim()
        .split(/\r?\n/)
        .map((row) => row.split(/\t|,/).map((cell) => cell.trim()));
      if (rows.length === 0) {
        return;
      }
      const next = plateMap.map((cell) => ({ ...cell }));
      const origin = startCell;
      let changed = false;
      rows.forEach((rowValues, rowOffset) => {
        rowValues.forEach((value, colOffset) => {
          const row = origin.row + rowOffset;
          const col = origin.col + colOffset;
          const index = next.findIndex((cell) => cell.row === row && cell.col === col);
          if (index < 0 || !value) {
            return;
          }
          const numeric = Number(value);
          if (Number.isFinite(numeric)) {
            next[index] = { ...next[index], role: "sample", compoundId, sampleId, concentration: numeric, unit };
            changed = true;
          } else if (isWellRole(value)) {
            next[index] = { ...next[index], role: value };
            changed = true;
          } else {
            throw new Error(`Paste value "${value}" is not numeric and is not a valid role.`);
          }
        });
      });
      if (!changed) {
        setError("Paste did not contain any concentration values or well roles inside the plate bounds.");
        return;
      }
      commit(next);
      setPasteText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Paste failed.");
    }
  }

  async function importCsv(file?: File) {
    if (!file) {
      return;
    }
    setError("");
    try {
      commit(parsePlateMapCsv(await file.text(), plateMap));
    } catch (err) {
      setError(err instanceof Error ? err.message : "CSV import failed.");
    }
  }

  function saveTemplate() {
    const name = templateName.trim();
    if (!name) {
      setError("Name the template before saving it.");
      return;
    }
    const nextTemplates = {
      ...templates,
      [name]: plateMap.map((cell) => ({ ...cell }))
    };
    localStorage.setItem(TEMPLATE_KEY, JSON.stringify(nextTemplates));
    setTemplates(nextTemplates);
    setTemplateName(name);
    setError("");
  }

  function loadTemplate(name: string) {
    const template = templates[name];
    if (template) {
      commit(template.map((cell) => ({ ...cell })));
    }
  }

  return (
    <section className="map-layout">
      <div className="surface-panel map-panel">
        <div className="panel-heading">
          <div>
            <h2>Plate Map</h2>
            <p>Assign sample wells, explicit controls, concentrations, and units before analysis.</p>
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
        <div
          className="plate-map-grid"
          aria-label="96-well plate map"
          onMouseLeave={() => {
            draggingRef.current = false;
            hidePopover();
          }}
        >
          <button className="corner-cell" type="button" onClick={selectAll}>
            All
          </button>
          {Array.from({ length: COLUMNS }, (_item, col) => (
            <button key={col} className="column-header" type="button" onClick={() => selectCol(col)}>
              {col + 1}
            </button>
          ))}
          {Array.from({ length: ROWS }, (_item, row) => (
            <div className="plate-row" key={row}>
              <button className="row-header" type="button" onClick={() => selectRow(row)}>
                {ROW_LABELS[row]}
              </button>
              {Array.from({ length: COLUMNS }, (_cell, col) => {
                const cell = getCell(plateMap, row, col);
                const key = cellKey(row, col);
                const display = plateMapCellDisplay(cell);
                return (
                  <button
                    key={key}
                    className={`map-cell ${selected.has(key) ? "selected" : ""}`}
                    style={{ "--role-color": ROLE_COLORS[cell.role] } as CSSProperties}
                    type="button"
                    onMouseDown={() => {
                      draggingRef.current = true;
                      hidePopover();
                      setSelected(new Set([key]));
                    }}
                    onMouseEnter={(event) => {
                      if (draggingRef.current) {
                        setSelected((items) => new Set([...items, key]));
                      } else {
                        scheduleHoverPopover(cell, key, event.currentTarget);
                      }
                    }}
                    onMouseMove={(event) => {
                      if (!draggingRef.current) {
                        scheduleHoverPopover(cell, key, event.currentTarget);
                      }
                    }}
                    onMouseUp={() => {
                      draggingRef.current = false;
                    }}
                    onMouseLeave={hidePopover}
                    onFocus={(event) => {
                      if (!draggingRef.current && event.currentTarget.matches(":focus-visible")) {
                        showPopover(cell, key, event.currentTarget, "focus");
                      }
                    }}
                    onBlur={hidePopover}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        hidePopover();
                      }
                    }}
                    aria-label={display.ariaLabel}
                    aria-describedby={cellPopover?.key === key ? CELL_POPOVER_ID : undefined}
                  >
                    <span className="map-cell-heading">
                      <span className="map-cell-well">{cell.well}</span>
                      <span className="map-cell-role">{display.roleLabel}</span>
                    </span>
                    <span className="map-cell-details">
                      {display.details.map((detail) => (
                        <span key={detail} className="map-cell-detail">
                          {detail}
                        </span>
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        {cellPopover && <CellPopover popover={cellPopover} />}
        <div className={`validation-strip ${validation.valid ? "valid" : "invalid"}`}>
          {validation.valid ? "Plate map is analysis-ready." : validation.blockers.join(" ")}
          {validation.warnings.length > 0 && <span>{validation.warnings.join(" ")}</span>}
        </div>
        {actions && <div className="screen-actions plate-map-actions">{actions}</div>}
      </div>
      <aside className="map-side">
        <CollapsiblePanel
          id="selection-panel"
          title="Selection"
          className="surface-panel editor-panel"
          open={openPanels.selection}
          onToggle={() => togglePanel("selection")}
        >
          <div className="selected-summary">{selected.size} wells selected</div>
          <label>
            <span>Role</span>
            <select aria-label="Role" value={role} onChange={(event) => setRole(event.target.value as WellRole)}>
              {Object.entries(ROLE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div className="form-grid two selection-field-grid">
            <label>
              <span>Compound ID</span>
              <input value={roleAcceptsMetadata ? compoundId : ""} disabled={!roleAcceptsMetadata} onChange={(event) => setCompoundId(event.target.value)} />
            </label>
            <label>
              <span>Sample ID</span>
              <input value={roleAcceptsMetadata ? sampleId : ""} disabled={!roleAcceptsMetadata} onChange={(event) => setSampleId(event.target.value)} />
            </label>
            <label>
              <span>{concentrationLabel}</span>
              <input value={roleAcceptsDose ? concentration : ""} disabled={!roleAcceptsDose} onChange={(event) => setConcentration(event.target.value)} />
            </label>
            <label>
              <span>Unit</span>
              <input value={roleAcceptsMetadata ? unit : ""} disabled={!roleAcceptsMetadata} onChange={(event) => setUnit(event.target.value)} />
            </label>
          </div>
          <button className="primary-button full-width" type="button" onClick={assignSelection}>
            Apply to selection
          </button>
          {error && <div className="error-banner compact-error">{error}</div>}
        </CollapsiblePanel>
        <CollapsiblePanel
          id="serial-dilution-panel"
          title="Serial dilution"
          description="Applies concentration, unit, compound, and sample IDs to selected rows or columns."
          icon={<Wand2 size={18} />}
          className="serial-wizard"
          open={openPanels.serialDilution}
          onToggle={() => togglePanel("serialDilution")}
        >
          <SerialDilutionWizard
            plateMap={plateMap}
            selectedRows={selectedRows}
            selectedCols={selectedCols}
            startCell={{ row: startCell.row, col: startCell.col }}
            onApply={commit}
          />
        </CollapsiblePanel>
        <CollapsiblePanel
          id="csv-templates-panel"
          title="CSV and templates"
          className="surface-panel editor-panel"
          open={openPanels.csvTemplates}
          onToggle={() => togglePanel("csvTemplates")}
        >
          <div className="button-grid">
            <button className="secondary-button" type="button" onClick={() => downloadText("assaylens-plate-map.csv", plateMapToCsv(plateMap), "text/csv")}>
              <Download size={16} /> Export CSV
            </button>
            <button className="secondary-button" type="button" onClick={() => fileRef.current?.click()}>
              <Upload size={16} /> Import CSV
            </button>
            <button className="secondary-button" type="button" onClick={() => void copySelection()}>
              <Clipboard size={16} /> Copy selection
            </button>
          </div>
          <input ref={fileRef} className="visually-hidden" type="file" accept=".csv,text/csv" onChange={(event) => void importCsv(event.currentTarget.files?.[0])} />
          <textarea value={pasteText} onChange={(event) => setPasteText(event.target.value)} placeholder="Paste concentration values or roles from a spreadsheet" />
          <button className="secondary-button full-width" type="button" onClick={() => pasteSpreadsheet(pasteText)}>
            Paste into selection origin
          </button>
          <div className="template-row">
            <input value={templateName} onChange={(event) => setTemplateName(event.target.value)} />
            <button className="icon-button" type="button" onClick={saveTemplate} title="Save template" aria-label="Save template">
              <Save size={16} />
            </button>
          </div>
          {templateNames.length > 0 && (
            <select
              onChange={(event) => {
                loadTemplate(event.target.value);
                event.currentTarget.value = "";
              }}
              defaultValue=""
            >
              <option value="" disabled>
                Load local template
              </option>
              {templateNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          )}
        </CollapsiblePanel>
      </aside>
    </section>
  );
}

function CellPopover({ popover }: { popover: CellPopoverState }) {
  return (
    <div
      className={`cell-popover ${popover.position.placement}`}
      id={CELL_POPOVER_ID}
      role="tooltip"
      style={
        {
          "--role-color": ROLE_COLORS[popover.cell.role],
          left: popover.position.left,
          top: popover.position.top
        } as CSSProperties
      }
      data-source={popover.source}
    >
      <div className="cell-popover-header">
        <strong>{popover.cell.well}</strong>
        <span>{popover.display.roleLabel}</span>
      </div>
      {popover.display.hasMetadata ? (
        <dl className="cell-popover-rows">
          {popover.display.popoverRows.map((row) => (
            <div key={`${row.label}:${row.value}`}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="cell-popover-empty">No assignment</p>
      )}
    </div>
  );
}

type CollapsiblePanelProps = {
  id: string;
  title: string;
  className: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  description?: string;
  icon?: ReactNode;
};

function CollapsiblePanel({ id, title, className, open, onToggle, children, description, icon }: CollapsiblePanelProps) {
  const bodyId = `${id}-body`;

  return (
    <div className={`${className} collapsible-panel`}>
      <div className="collapsible-panel-heading">
        <div className="collapsible-panel-title">
          <h3>{title}</h3>
          {description && <p>{description}</p>}
        </div>
        <div className="collapsible-panel-actions">
          {icon}
          <button
            className="icon-button collapse-toggle"
            type="button"
            aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={onToggle}
            title={open ? `Collapse ${title}` : `Expand ${title}`}
          >
            {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        </div>
      </div>
      <div className="collapsible-panel-body" id={bodyId} hidden={!open}>
        {children}
      </div>
    </div>
  );
}

function loadTemplates(): Record<string, PlateMapCell[]> {
  try {
    const current = localStorage.getItem(TEMPLATE_KEY);
    if (current) {
      return JSON.parse(current) as Record<string, PlateMapCell[]>;
    }
    for (const legacyKey of LEGACY_TEMPLATE_KEYS) {
      const legacy = localStorage.getItem(legacyKey);
      if (legacy) {
        const templates = JSON.parse(legacy) as Record<string, PlateMapCell[]>;
        localStorage.setItem(TEMPLATE_KEY, JSON.stringify(templates));
        return templates;
      }
    }
    return {};
  } catch {
    return {};
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}
