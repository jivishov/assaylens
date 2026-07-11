import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from "lucide-react";
import { useState } from "react";
import { applySerialDilution, type DilutionDirection } from "../core/plateMap/serialDilution";
import type { PlateMapCell } from "../core/plateMap/plateMapTypes";

type SerialDilutionWizardProps = {
  plateMap: PlateMapCell[];
  selectedRows: number[];
  selectedCols: number[];
  startCell: { row: number; col: number };
  onApply: (plateMap: PlateMapCell[]) => void;
};

export function SerialDilutionWizard({ plateMap, selectedRows, selectedCols, startCell, onApply }: SerialDilutionWizardProps) {
  const [compoundId, setCompoundId] = useState("Compound X");
  const [sampleId, setSampleId] = useState("Sample 1");
  const [startConcentration, setStartConcentration] = useState(128);
  const [dilutionFactor, setDilutionFactor] = useState(2);
  const [steps, setSteps] = useState(10);
  const [unit, setUnit] = useState("ug/mL");
  const [normalizationGroupId, setNormalizationGroupId] = useState("Control set 1");
  const [biologicalReplicatePrefix, setBiologicalReplicatePrefix] = useState("Bio");
  const [direction, setDirection] = useState<DilutionDirection>("right");
  const [error, setError] = useState("");

  function apply() {
    setError("");
    try {
      onApply(
        applySerialDilution(plateMap, {
          compoundId,
          sampleId,
          startConcentration,
          dilutionFactor,
          direction,
          steps,
          unit,
          replicateRows: selectedRows,
          replicateCols: selectedCols,
          startRow: startCell.row,
          startCol: startCell.col,
          normalizationGroupId,
          biologicalReplicatePrefix
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Serial dilution assignment failed.");
    }
  }

  return (
    <>
      <div className="form-grid two">
        <label>
          <span>Compound ID</span>
          <input value={compoundId} onChange={(event) => setCompoundId(event.target.value)} />
        </label>
        <label>
          <span>Sample ID</span>
          <input value={sampleId} onChange={(event) => setSampleId(event.target.value)} />
        </label>
        <label>
          <span>Start concentration</span>
          <input
            type="number"
            min="0"
            value={startConcentration}
            onChange={(event) => setStartConcentration(Number(event.target.value))}
          />
        </label>
        <label>
          <span>Unit</span>
          <input value={unit} onChange={(event) => setUnit(event.target.value)} />
        </label>
        <label>
          <span>Normalization group</span>
          <input value={normalizationGroupId} onChange={(event) => setNormalizationGroupId(event.target.value)} />
        </label>
        <label>
          <span>Biological replicate prefix</span>
          <input value={biologicalReplicatePrefix} onChange={(event) => setBiologicalReplicatePrefix(event.target.value)} />
        </label>
        <label>
          <span>Dilution factor</span>
          <input
            type="number"
            min="1.01"
            step="0.01"
            value={dilutionFactor}
            onChange={(event) => setDilutionFactor(Number(event.target.value))}
          />
        </label>
        <label>
          <span>Steps</span>
          <input type="number" min="1" max="12" value={steps} onChange={(event) => setSteps(Number(event.target.value))} />
        </label>
      </div>
      <div className="direction-row">
        <button
          className={direction === "right" ? "active" : ""}
          type="button"
          onClick={() => setDirection("right")}
          title="Dilute to the right"
          aria-label="Dilute to the right"
        >
          <ArrowRight size={16} />
        </button>
        <button
          className={direction === "left" ? "active" : ""}
          type="button"
          onClick={() => setDirection("left")}
          title="Dilute to the left"
          aria-label="Dilute to the left"
        >
          <ArrowLeft size={16} />
        </button>
        <button
          className={direction === "down" ? "active" : ""}
          type="button"
          onClick={() => setDirection("down")}
          title="Dilute downward"
          aria-label="Dilute downward"
        >
          <ArrowDown size={16} />
        </button>
        <button
          className={direction === "up" ? "active" : ""}
          type="button"
          onClick={() => setDirection("up")}
          title="Dilute upward"
          aria-label="Dilute upward"
        >
          <ArrowUp size={16} />
        </button>
      </div>
      <button className="primary-button full-width" type="button" onClick={apply}>
        Apply series
      </button>
      {error && <div className="error-banner compact-error">{error}</div>}
    </>
  );
}
