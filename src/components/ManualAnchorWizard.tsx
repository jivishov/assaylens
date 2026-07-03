import { CheckCircle2, MousePointer2 } from "lucide-react";
import type { AnchorName, PlateAnchors } from "../core/types";

const ANCHOR_SEQUENCE: AnchorName[] = ["A1", "A12", "H12", "H1"];

type ManualAnchorWizardProps = {
  anchors: Partial<PlateAnchors>;
  onReset: () => void;
};

export function ManualAnchorWizard({ anchors, onReset }: ManualAnchorWizardProps) {
  const next = ANCHOR_SEQUENCE.find((anchor) => !anchors[anchor]);

  return (
    <details className="anchor-wizard collapsible-card" open>
      <summary className="wizard-title">
        <MousePointer2 size={17} />
        <span>Manual four-anchor alignment</span>
      </summary>
      <div className="collapsible-card-body">
        <ol>
          {ANCHOR_SEQUENCE.map((anchor) => (
            <li key={anchor} className={anchors[anchor] ? "complete" : next === anchor ? "active" : ""}>
              {anchors[anchor] ? <CheckCircle2 size={15} /> : <span className="step-dot" />}
              <span>{anchor} center</span>
            </li>
          ))}
        </ol>
        <p>{next ? `Click the ${next} anchor on the original image.` : "All anchors placed. Review the grid, then confirm ROIs."}</p>
        <button className="ghost-button" type="button" onClick={onReset}>
          Reset anchors
        </button>
      </div>
    </details>
  );
}
