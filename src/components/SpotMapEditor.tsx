import { Redo2, Undo2 } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useMemo, useState } from "react";
import {
  getSpotCell,
  SPOT_ROLE_COLORS,
  SPOT_ROLE_LABELS,
  SPOT_ROLES,
  spotRoleAcceptsMetadata,
  type SpotMapCell,
  type SpotRole
} from "../core/assays/agarSpot/spotMapTypes";
import { validateSpotMap } from "../core/assays/agarSpot/spotMapValidation";

type SpotMapEditorProps = {
  spotMap: SpotMapCell[];
  rows: number;
  columns: number;
  onSpotMapChange: (spotMap: SpotMapCell[]) => void;
  actions?: ReactNode;
};

export function SpotMapEditor({ spotMap, rows, columns, onSpotMapChange, actions }: SpotMapEditorProps) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(["R1C1"]));
  const [history, setHistory] = useState<SpotMapCell[][]>([]);
  const [future, setFuture] = useState<SpotMapCell[][]>([]);
  const [role, setRole] = useState<SpotRole>("experimental");
  const [groupId, setGroupId] = useState("Group 1");
  const [biologicalReplicate, setBiologicalReplicate] = useState("1");
  const [technicalReplicate, setTechnicalReplicate] = useState("1");
  const [dilutionIndex, setDilutionIndex] = useState("0");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const validation = useMemo(() => validateSpotMap(spotMap), [spotMap]);
  const roleHasMetadata = spotRoleAcceptsMetadata(role);

  function commit(next: SpotMapCell[]) {
    setHistory((items) => [...items.slice(-24), spotMap.map((cell) => ({ ...cell }))]);
    setFuture([]);
    onSpotMapChange(next);
    setError("");
  }

  function assignSelection() {
    const parsedBio = roleHasMetadata && biologicalReplicate.trim() ? Number(biologicalReplicate) : undefined;
    const parsedTech = roleHasMetadata && technicalReplicate.trim() ? Number(technicalReplicate) : undefined;
    const parsedDilution = roleHasMetadata && dilutionIndex.trim() ? Number(dilutionIndex) : undefined;
    if (roleHasMetadata && parsedBio != null && (!Number.isInteger(parsedBio) || parsedBio < 1)) {
      setError("Biological replicate must be a positive integer.");
      return;
    }
    if (roleHasMetadata && parsedTech != null && (!Number.isInteger(parsedTech) || parsedTech < 1)) {
      setError("Technical replicate must be a positive integer.");
      return;
    }
    if (roleHasMetadata && parsedDilution != null && (!Number.isInteger(parsedDilution) || parsedDilution < 0)) {
      setError("Dilution index must be a non-negative integer.");
      return;
    }

    commit(
      spotMap.map((cell) =>
        selected.has(cell.id)
          ? {
              ...cell,
              role,
              groupId: roleHasMetadata ? groupId.trim() : "",
              biologicalReplicate: parsedBio,
              technicalReplicate: parsedTech,
              dilutionIndex: parsedDilution,
              notes: notes.trim()
            }
          : cell
      )
    );
  }

  function selectRow(row: number) {
    setSelected(new Set(spotMap.filter((cell) => cell.row === row).map((cell) => cell.id)));
  }

  function selectCol(col: number) {
    setSelected(new Set(spotMap.filter((cell) => cell.col === col).map((cell) => cell.id)));
  }

  function selectAll() {
    setSelected(new Set(spotMap.map((cell) => cell.id)));
  }

  function undo() {
    const previous = history.at(-1);
    if (!previous) {
      return;
    }
    setFuture((items) => [spotMap, ...items]);
    setHistory((items) => items.slice(0, -1));
    onSpotMapChange(previous);
  }

  function redo() {
    const next = future[0];
    if (!next) {
      return;
    }
    setHistory((items) => [...items, spotMap]);
    setFuture((items) => items.slice(1));
    onSpotMapChange(next);
  }

  return (
    <section className="map-layout">
      <div className="surface-panel map-panel">
        <div className="panel-heading">
          <div>
            <h2>Spot Map</h2>
            <p>Assign agar spot roles, groups, replicates, dilution indexes, and background ROIs before analysis.</p>
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

        <div className="spot-map-grid" style={{ "--spot-columns": columns } as CSSProperties} aria-label="Agar spot map">
          <button className="corner-cell" type="button" onClick={selectAll}>
            All
          </button>
          {Array.from({ length: columns }, (_item, col) => (
            <button key={col} className="column-header" type="button" onClick={() => selectCol(col)}>
              {col + 1}
            </button>
          ))}
          {Array.from({ length: rows }, (_row, row) => (
            <div className="plate-row" key={row}>
              <button className="row-header" type="button" onClick={() => selectRow(row)}>
                {row + 1}
              </button>
              {Array.from({ length: columns }, (_cell, col) => {
                const cell = getSpotCell(spotMap, row, col);
                return (
                  <button
                    key={cell.id}
                    className={`map-cell ${selected.has(cell.id) ? "selected" : ""}`}
                    style={{ "--role-color": SPOT_ROLE_COLORS[cell.role] } as CSSProperties}
                    type="button"
                    onClick={() => setSelected(new Set([cell.id]))}
                    onDoubleClick={() => setSelected((items) => new Set([...items, cell.id]))}
                    aria-label={`${cell.id} ${SPOT_ROLE_LABELS[cell.role]}`}
                  >
                    <span className="map-cell-heading">
                      <span className="map-cell-well">{cell.id}</span>
                      <span className="map-cell-role">{SPOT_ROLE_LABELS[cell.role]}</span>
                    </span>
                    <span className="map-cell-details">
                      {cell.groupId && <span className="map-cell-detail">Group: {cell.groupId}</span>}
                      {cell.dilutionIndex != null && <span className="map-cell-detail">Dilution: {cell.dilutionIndex}</span>}
                      {(cell.biologicalReplicate != null || cell.technicalReplicate != null) && (
                        <span className="map-cell-detail">
                          Rep: {cell.biologicalReplicate ?? "-"} / {cell.technicalReplicate ?? "-"}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className={`validation-strip ${validation.valid ? "valid" : "invalid"}`}>
          {validation.valid ? "Spot map is analysis-ready." : validation.blockers.join(" ")}
          {validation.warnings.length > 0 && <span>{validation.warnings.join(" ")}</span>}
        </div>
        {actions && <div className="screen-actions plate-map-actions">{actions}</div>}
      </div>

      <aside className="map-side">
        <div className="surface-panel editor-panel">
          <div className="panel-heading compact">
            <h3>Selection</h3>
            <span>{selected.size} ROIs</span>
          </div>
          <label>
            <span>Role</span>
            <select value={role} onChange={(event) => setRole(event.target.value as SpotRole)}>
              {SPOT_ROLES.map((item) => (
                <option key={item} value={item}>
                  {SPOT_ROLE_LABELS[item]}
                </option>
              ))}
            </select>
          </label>
          <div className="form-grid two selection-field-grid">
            <label>
              <span>Group</span>
              <input value={roleHasMetadata ? groupId : ""} disabled={!roleHasMetadata} onChange={(event) => setGroupId(event.target.value)} />
            </label>
            <label>
              <span>Dilution index</span>
              <input value={roleHasMetadata ? dilutionIndex : ""} disabled={!roleHasMetadata} onChange={(event) => setDilutionIndex(event.target.value)} />
            </label>
            <label>
              <span>Biological replicate</span>
              <input
                value={roleHasMetadata ? biologicalReplicate : ""}
                disabled={!roleHasMetadata}
                onChange={(event) => setBiologicalReplicate(event.target.value)}
              />
            </label>
            <label>
              <span>Technical replicate</span>
              <input
                value={roleHasMetadata ? technicalReplicate : ""}
                disabled={!roleHasMetadata}
                onChange={(event) => setTechnicalReplicate(event.target.value)}
              />
            </label>
          </div>
          <label>
            <span>Notes</span>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
          </label>
          <button className="primary-button full-width" type="button" onClick={assignSelection}>
            Apply to selection
          </button>
          {error && <div className="error-banner compact-error">{error}</div>}
        </div>
      </aside>
    </section>
  );
}
