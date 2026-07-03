import { Activity, AlertTriangle, Play, Table2 } from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import type { AgarSpotAnalysisResult, AnalysisResult, AssayMode, MicResult, SpotAnalysis, SpotDilutionSummary, WellAnalysis } from "../core/types";

type AnalysisDashboardProps = {
  assayMode: AssayMode;
  result?: AnalysisResult;
  blockers: string[];
  running: boolean;
  error?: string;
  threshold: number;
  onThresholdChange: (threshold: number) => void;
  spotDilutionOverride?: number;
  onSpotDilutionOverrideChange: (dilutionIndex?: number) => void;
  spotControlGroupIds?: string[];
  spotReferenceControlGroupId?: string;
  onSpotReferenceControlGroupChange?: (groupId?: string) => void;
  onRun: () => void;
};

export function AnalysisDashboard({
  assayMode,
  result,
  blockers,
  running,
  error,
  threshold,
  onThresholdChange,
  spotDilutionOverride,
  onSpotDilutionOverrideChange,
  spotControlGroupIds = [],
  spotReferenceControlGroupId,
  onSpotReferenceControlGroupChange,
  onRun
}: AnalysisDashboardProps) {
  const runDisabled = blockers.length > 0 || running;

  return (
    <section className="analysis-layout">
      <div className="surface-panel analysis-command">
        <div className="analysis-command-grid">
          <div className="analysis-command-copy">
            <h2>{assayMode === "agar_spot_growth" ? "Relative Growth" : "Analysis"}</h2>
            <p>
              {assayMode === "agar_spot_growth"
                ? "STAR-inspired background-corrected spot densitometry with explicit background and control ROIs."
                : "Control-normalized XTT image-derived color signal. MIC is blocked until geometry, controls, plate map, and units are valid."}
            </p>
          </div>
          <div className="analysis-settings">
            {assayMode === "agar_spot_growth" ? (
              <>
                <label>
                  <span>Reference control group</span>
                  <select
                    value={spotReferenceControlGroupId ?? ""}
                    disabled={spotControlGroupIds.length === 0}
                    onChange={(event) => onSpotReferenceControlGroupChange?.(event.target.value || undefined)}
                  >
                    <option value="">Auto-select</option>
                    {spotControlGroupIds.map((groupId) => (
                      <option key={groupId} value={groupId}>
                        {groupId}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Manual dilution override</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={spotDilutionOverride ?? ""}
                    onChange={(event) => {
                      const value = event.target.value.trim();
                      onSpotDilutionOverrideChange(value ? Number(value) : undefined);
                    }}
                  />
                </label>
              </>
            ) : (
              <label>
                <span>MIC viability threshold</span>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.01"
                  value={threshold}
                  onChange={(event) => onThresholdChange(Number(event.target.value))}
                />
              </label>
            )}
            <button className="primary-button" type="button" disabled={runDisabled} onClick={onRun}>
              <Play size={16} /> {running ? "Running..." : "Run analysis"}
            </button>
            {result?.kind === "xtt_96well_mic" && (
              <div className="metric-chip">
                <Activity size={15} />
                Signal metric: {result.normalization.selectedMetric}
              </div>
            )}
            {result?.kind === "agar_spot_growth" && (
              <div className="metric-chip">
                <Activity size={15} />
                Selected dilution: {result.qc.selectedDilutionIndex ?? "none"}
              </div>
            )}
          </div>
        </div>
        {blockers.length > 0 && (
          <div className="blocker-list" role="status">
            <AlertTriangle size={18} />
            <div>
              <strong>Analysis blocked</strong>
              <ul>
                {blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
      </div>

      {result ? (
        result.kind === "agar_spot_growth" ? (
          <SpotDashboard result={result} />
        ) : (
          <XttDashboard result={result} />
        )
      ) : (
        <div className="surface-panel empty-analysis">
          {assayMode === "agar_spot_growth"
            ? "Run analysis to generate density heatmaps, relative-growth summaries, and exportable spot tables."
            : "Run analysis to generate heatmaps, MIC results, and exportable tables."}
        </div>
      )}
    </section>
  );
}

function XttDashboard({ result }: { result: Extract<AnalysisResult, { kind: "xtt_96well_mic" }> }) {
  return (
    <>
      <div className="surface-panel heatmap-panel">
        <div className="panel-heading compact">
          <h3>Plate heatmap</h3>
          <span>Viability</span>
        </div>
        <PlateHeatmap wells={result.wells} />
      </div>
      <div className="surface-panel mic-panel">
        <div className="panel-heading compact">
          <h3>MIC summary</h3>
          <span>{result.micResults.length} sample groups</span>
        </div>
        <MicSummary results={result.micResults} />
      </div>
      <div className="surface-panel plot-panel">
        <div className="panel-heading compact">
          <h3>Dose-response</h3>
          <span>Observed and isotonic viability</span>
        </div>
        <DoseResponsePlot results={result.micResults} />
      </div>
      <div className="surface-panel well-table-panel">
        <div className="panel-heading compact">
          <h3>Per-well table</h3>
          <Table2 size={18} />
        </div>
        <WellTable wells={result.wells} />
      </div>
      <div className="surface-panel qc-panel">
        <h3>QC</h3>
        <dl>
          <div>
            <dt>Control separation</dt>
            <dd>{result.normalization.separationMad.toFixed(2)} MAD</dd>
          </div>
          <div>
            <dt>Growth signal</dt>
            <dd>{result.normalization.growthSignal.toPrecision(5)}</dd>
          </div>
          <div>
            <dt>Blank signal</dt>
            <dd>{result.normalization.blankSignal.toPrecision(5)}</dd>
          </div>
          <div>
            <dt>Input warnings</dt>
            <dd>{result.inputWarnings.length > 0 ? result.inputWarnings.join(", ") : "None"}</dd>
          </div>
        </dl>
      </div>
    </>
  );
}

function SpotDashboard({ result }: { result: AgarSpotAnalysisResult }) {
  return (
    <>
      <div className="surface-panel heatmap-panel">
        <div className="panel-heading compact">
          <h3>Density heatmap</h3>
          <span>Background-corrected</span>
        </div>
        <SpotDensityHeatmap spots={result.spots} />
      </div>
      <div className="surface-panel mic-panel">
        <div className="panel-heading compact">
          <h3>Relative growth</h3>
          <span>{result.summaries.length} summaries</span>
        </div>
        <RelativeGrowthTable summaries={result.summaries} />
      </div>
      <div className="surface-panel well-table-panel">
        <div className="panel-heading compact">
          <h3>Replicate summary</h3>
          <Table2 size={18} />
        </div>
        <ReplicateTable spots={result.spots} />
      </div>
      <div className="surface-panel qc-panel">
        <h3>QC</h3>
        <dl>
          <div>
            <dt>Background ROIs</dt>
            <dd>{result.qc.validBackgroundCount}</dd>
          </div>
          <div>
            <dt>Median background</dt>
            <dd>{result.qc.medianBackgroundDensity.toPrecision(5)}</dd>
          </div>
          <div>
            <dt>Control groups</dt>
            <dd>{result.qc.controlGroupIds.join(", ") || "None"}</dd>
          </div>
          <div>
            <dt>Reference control</dt>
            <dd>{result.qc.referenceControlGroupId ?? "None"}</dd>
          </div>
          <div>
            <dt>Suggested dilution</dt>
            <dd>{result.qc.suggestedDilutionIndex ?? "None"}</dd>
          </div>
          <div>
            <dt>Input warnings</dt>
            <dd>{result.inputWarnings.length > 0 ? result.inputWarnings.join(", ") : "None"}</dd>
          </div>
        </dl>
      </div>
    </>
  );
}

function PlateHeatmap({ wells }: { wells: WellAnalysis[] }) {
  return (
    <div className="analysis-plate-grid">
      {wells.map((well) => (
        <div
          key={well.well}
          className="heatmap-well"
          style={{ background: viabilityColor(well.viability), color: viabilityTextColor(well.viability) }}
          title={`${well.well}: viability ${well.viability.toFixed(2)}`}
        >
          <span>{well.well}</span>
          <strong>{Number.isFinite(well.viability) ? `${Math.round(well.viability * 100)}%` : "--"}</strong>
        </div>
      ))}
    </div>
  );
}

function SpotDensityHeatmap({ spots }: { spots: SpotAnalysis[] }) {
  if (spots.length === 0) {
    return <div className="empty-state">No measured spot ROIs yet.</div>;
  }
  const columns = Math.max(...spots.map((spot) => spot.col)) + 1;
  const maxDensity = Math.max(...spots.map((spot) => spot.density).filter(Number.isFinite), 1);
  return (
    <div className="analysis-spot-grid" style={{ "--spot-columns": columns } as CSSProperties}>
      {spots.map((spot) => (
        <div
          key={spot.roiId}
          className="heatmap-well"
          style={{ background: densityColor(spot.density, maxDensity), color: "#ffffff" }}
          title={`${spot.roiId}: density ${spot.density.toFixed(2)}`}
        >
          <span>{spot.roiId}</span>
          <strong>{Number.isFinite(spot.density) ? spot.density.toFixed(1) : "--"}</strong>
        </div>
      ))}
    </div>
  );
}

function MicSummary({ results }: { results: MicResult[] }) {
  if (results.length === 0) {
    return <div className="empty-state">No sample MIC groups yet.</div>;
  }
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Compound</th>
          <th>Sample</th>
          <th>Observed MIC</th>
          <th>Isotonic MIC</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {results.map((result) => (
          <tr key={`${result.compoundId}-${result.sampleId}-${result.unit}`}>
            <td>{result.compoundId}</td>
            <td>{result.sampleId}</td>
            <td>{result.observedMicLabel}</td>
            <td>{result.isotonicMicLabel}</td>
            <td>{result.status}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RelativeGrowthTable({ summaries }: { summaries: SpotDilutionSummary[] }) {
  if (summaries.length === 0) {
    return <div className="empty-state">No relative-growth summaries yet.</div>;
  }
  return (
    <div className="table-scroll">
      <table className="data-table compact-table">
        <thead>
          <tr>
            <th>Role</th>
            <th>Group</th>
            <th>Reference control</th>
            <th>Dilution</th>
            <th>n</th>
            <th>Mean density</th>
            <th>CV</th>
            <th>Relative growth</th>
            <th>Warnings</th>
          </tr>
        </thead>
        <tbody>
          {summaries.map((summary) => (
            <tr key={`${summary.role}-${summary.groupId}-${summary.dilutionIndex}`}>
              <td>{summary.role}</td>
              <td>{summary.groupId}</td>
              <td>{summary.referenceControlGroupId}</td>
              <td>{summary.dilutionIndex}</td>
              <td>{summary.n}</td>
              <td>{numberCell(summary.meanDensity)}</td>
              <td>{numberCell(summary.cv)}</td>
              <td>{numberCell(summary.relativeGrowth)}</td>
              <td>{summary.warnings.length ? summary.warnings.join(", ") : "OK"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReplicateTable({ spots }: { spots: SpotAnalysis[] }) {
  const measured = spots.filter((spot) => spot.map.role === "experimental" || spot.map.role === "control");
  if (measured.length === 0) {
    return <div className="empty-state">No measured replicates yet.</div>;
  }
  return (
    <div className="table-scroll">
      <table className="data-table compact-table">
        <thead>
          <tr>
            <th>ROI</th>
            <th>Role</th>
            <th>Group</th>
            <th>Bio rep</th>
            <th>Tech rep</th>
            <th>Dilution</th>
            <th>Density</th>
            <th>QC</th>
          </tr>
        </thead>
        <tbody>
          {measured.map((spot) => (
            <tr key={spot.roiId}>
              <td>{spot.roiId}</td>
              <td>{spot.map.role}</td>
              <td>{spot.map.groupId}</td>
              <td>{spot.map.biologicalReplicate ?? ""}</td>
              <td>{spot.map.technicalReplicate ?? ""}</td>
              <td>{spot.map.dilutionIndex ?? ""}</td>
              <td>{numberCell(spot.density)}</td>
              <td>{spot.qcFlags.length ? spot.qcFlags.join(", ") : "OK"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DoseResponsePlot({ results }: { results: MicResult[] }) {
  const plotResults = useMemo(() => results.filter((result) => result.concentrations.length > 0), [results]);
  const [selectedKey, setSelectedKey] = useState("");
  const selected = plotResults.find((result) => micResultKey(result) === selectedKey) ?? plotResults[0];

  useEffect(() => {
    if (!selected && selectedKey) {
      setSelectedKey("");
      return;
    }
    if (selected && selectedKey !== micResultKey(selected)) {
      setSelectedKey(micResultKey(selected));
    }
  }, [selected, selectedKey]);

  if (!selected) {
    return <div className="empty-state">No dose-response points available.</div>;
  }
  const width = 680;
  const height = 260;
  const pad = 38;
  const allConcentrations = selected.concentrations.map((point) => point.concentration);
  const minX = Math.min(...allConcentrations);
  const maxX = Math.max(...allConcentrations);
  const x = (value: number) => {
    const logMin = Math.log10(Math.max(minX, 1e-9));
    const logMax = Math.log10(Math.max(maxX, minX * 10));
    return pad + ((Math.log10(Math.max(value, 1e-9)) - logMin) / Math.max(logMax - logMin, 1e-6)) * (width - pad * 2);
  };
  const y = (value: number) => pad + (1 - value) * (height - pad * 2);

  return (
    <div className="dose-response-view">
      {plotResults.length > 1 && (
        <label className="plot-selector">
          <span>Group</span>
          <select value={selectedKey} onChange={(event) => setSelectedKey(event.target.value)}>
            {plotResults.map((result) => (
              <option key={micResultKey(result)} value={micResultKey(result)}>
                {result.compoundId} / {result.sampleId}
              </option>
            ))}
          </select>
        </label>
      )}
      <svg
        className="dose-plot"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Dose response plot for ${selected.compoundId} / ${selected.sampleId}`}
      >
        <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="#9aa8b5" />
        <line x1={pad} y1={pad} x2={pad} y2={height - pad} stroke="#9aa8b5" />
        <line x1={pad} y1={y(selected.threshold)} x2={width - pad} y2={y(selected.threshold)} stroke="#e07052" strokeDasharray="5 5" />
        <polyline
          points={selected.concentrations.map((point) => `${x(point.concentration)},${y(point.isotonicViability)}`).join(" ")}
          fill="none"
          stroke="#0b7280"
          strokeWidth="3"
        />
        {selected.concentrations.map((point) => (
          <circle key={point.concentration} cx={x(point.concentration)} cy={y(point.medianViability)} r="5" fill="#0f8a96" />
        ))}
        <text x={pad} y={22} fill="#52606c" fontSize="12">
          {selected.compoundId} / {selected.sampleId}
        </text>
        <text x={width - pad} y={height - 8} fill="#52606c" fontSize="12" textAnchor="end">
          concentration ({selected.unit})
        </text>
        <text x={14} y={pad} fill="#52606c" fontSize="12" transform={`rotate(-90 14 ${pad})`}>
          viability
        </text>
      </svg>
    </div>
  );
}

function WellTable({ wells }: { wells: WellAnalysis[] }) {
  return (
    <div className="table-scroll">
      <table className="data-table compact-table">
        <thead>
          <tr>
            <th>Well</th>
            <th>Role</th>
            <th>Compound</th>
            <th>Conc.</th>
            <th>Signal</th>
            <th>Viability</th>
            <th>QC</th>
          </tr>
        </thead>
        <tbody>
          {wells.map((well) => (
            <tr key={well.well}>
              <td>{well.well}</td>
              <td>{well.map.role}</td>
              <td>{well.map.compoundId}</td>
              <td>{well.map.concentration == null ? "" : `${well.map.concentration} ${well.map.unit}`}</td>
              <td>{well.signal.toPrecision(5)}</td>
              <td>{Number.isFinite(well.viability) ? well.viability.toFixed(3) : "Blocked"}</td>
              <td>{well.qcFlags.length ? well.qcFlags.join(", ") : "OK"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function viabilityColor(value: number): string {
  if (!Number.isFinite(value)) {
    return "#d7dde4";
  }
  const clamped = Math.max(0, Math.min(1, value));
  const hue = 170 - clamped * 135;
  return `hsl(${hue} 72% ${44 + clamped * 12}%)`;
}

function viabilityTextColor(value: number): string {
  return Number.isFinite(value) && value > 0.72 ? "#14202a" : "#ffffff";
}

function densityColor(value: number, max: number): string {
  if (!Number.isFinite(value)) {
    return "#d7dde4";
  }
  const clamped = Math.max(0, Math.min(1, value / Math.max(max, 1)));
  const lightness = 66 - clamped * 36;
  return `hsl(187 68% ${lightness}%)`;
}

function micResultKey(result: MicResult): string {
  return `${result.compoundId}::${result.sampleId}::${result.unit}`;
}

function numberCell(value: number): string {
  return Number.isFinite(value) ? value.toPrecision(5) : "";
}
