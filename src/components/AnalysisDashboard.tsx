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
  spotControlGroupIds = [],
  spotReferenceControlGroupId,
  onSpotReferenceControlGroupChange,
  onRun
}: AnalysisDashboardProps) {
  const runDisabled = blockers.length > 0 || running;

  return (
    <section className="analysis-layout">
      {result?.provenance?.origin !== "computed_from_current_pixels" && result?.provenance && (
        <div className="error-banner" role="status">Imported historical result — unverified and not recomputed by the current algorithm. Source pixels and resolved v3 metadata are required for recomputation.</div>
      )}
      <div className="surface-panel analysis-command">
        <div className="analysis-command-grid">
          <div className="analysis-command-copy">
            <h2>{assayMode === "agar_spot_growth" ? "Agar endpoint spot densitometry" : "XTT relative metabolic activity"}</h2>
            <p>
              {assayMode === "agar_spot_growth"
                ? "Exploratory local-background endpoint spot signal with explicitly paired controls and replicate identities."
                : "Exploratory control-normalized XTT image signal. This measures relative metabolic activity, not a direct viable-cell count or validated MIC."}
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
                    <option value="">Select a control group</option>
                    {spotControlGroupIds.map((groupId) => (
                      <option key={groupId} value={groupId}>
                        {groupId}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : (
              <label>
                <span>RMA image-endpoint threshold</span>
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
            <div className="metric-chip"><Activity size={15} />Claim level: {result?.provenance?.claimLevel ?? "exploratory"}</div>
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
            ? "Run analysis to generate endpoint spot-signal maps and independently reported inoculum summaries."
            : "Run analysis to generate RMA heatmaps, exploratory image-endpoint statuses, and exportable tables."}
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
          <span>Display-clamped RMA</span>
        </div>
        <PlateHeatmap wells={result.wells} />
      </div>
      <div className="surface-panel mic-panel">
        <div className="panel-heading compact">
          <h3>Observed image-derived endpoint</h3>
          <span>{result.micResults.length} sample groups</span>
        </div>
        <MicSummary results={result.micResults} />
      </div>
      <div className="surface-panel plot-panel">
        <div className="panel-heading compact">
          <h3>Dose-response</h3>
          <span>Measured RMA and advisory isotonic fit</span>
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
            <dt>Growth-control signal</dt>
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
          <h3>Relative endpoint spot signal</h3>
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
          style={{ background: viabilityColor(well.displayRma ?? well.viability), color: viabilityTextColor(well.displayRma ?? well.viability) }}
          title={`${well.well}: raw RMA ${well.relativeMetabolicActivityRaw?.toPrecision(4) ?? "unavailable"}`}
        >
          <span>{well.well}</span>
          <strong>{Number.isFinite(well.displayRma ?? well.viability) ? `${Math.round((well.displayRma ?? well.viability) * 100)}%` : "--"}</strong>
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
    return <div className="empty-state">No sample endpoint series yet.</div>;
  }
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Compound</th>
          <th>Sample</th>
          <th>Observed image endpoint</th>
          <th>Model-assisted endpoint</th>
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
    return <div className="empty-state">No relative endpoint spot-signal summaries yet.</div>;
  }
  return (
    <div className="table-scroll">
      <table className="data-table compact-table">
        <thead>
          <tr>
            <th>Role</th>
            <th>Group</th>
            <th>Reference control</th>
            <th>Relative inoculum</th>
            <th>n</th>
            <th>Median endpoint signal</th>
            <th>CV</th>
            <th>Relative endpoint spot signal</th>
            <th>Warnings</th>
          </tr>
        </thead>
        <tbody>
          {summaries.map((summary) => (
            <tr key={`${summary.role}-${summary.groupId}-${summary.dilutionIndex}`}>
              <td>{summary.role}</td>
              <td>{summary.groupId}</td>
              <td>{summary.referenceControlGroupId}</td>
              <td>{summary.relativeInoculum ?? "--"}</td>
              <td>{summary.n}</td>
              <td>{numberCell(summary.medianEndpointSpotSignal ?? summary.meanDensity)}</td>
              <td>{numberCell(summary.cv)}</td>
              <td>{numberCell(summary.relativeEndpointSpotSignal ?? summary.relativeGrowth)}</td>
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
  const measuredPoints = selected.concentrations.filter((point) => Number.isFinite(point.medianViability));
  const modelPoints = selected.concentrations.filter((point) => Number.isFinite(point.isotonicViability));
  const minX = Math.min(...allConcentrations);
  const maxX = Math.max(...allConcentrations);
  const x = (value: number) => {
    const logMin = Math.log10(Math.max(minX, 1e-9));
    const logMax = Math.log10(Math.max(maxX, minX * 10));
    return pad + ((Math.log10(Math.max(value, 1e-9)) - logMin) / Math.max(logMax - logMin, 1e-6)) * (width - pad * 2);
  };
  const yValues = [0, 1, selected.threshold, ...measuredPoints.map((point) => point.medianViability), ...modelPoints.map((point) => point.isotonicViability)];
  const yMin = Math.min(...yValues), yMax = Math.max(...yValues);
  const yPad = Math.max((yMax - yMin) * 0.08, 0.02);
  const y = (value: number) => pad + ((yMax + yPad - value) / Math.max(yMax - yMin + 2 * yPad, 1e-6)) * (height - pad * 2);
  const yTicks = [...new Set([yMin, selected.threshold, yMax])];
  const uniqueXTicks = [...new Set(allConcentrations)].sort((left, right) => left - right);
  const xTicks = uniqueXTicks.length <= 8
    ? uniqueXTicks
    : uniqueXTicks.filter((_value, index) => index === 0 || index === uniqueXTicks.length - 1 || index % Math.ceil(uniqueXTicks.length / 6) === 0);

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
        aria-label={`Log concentration plot for ${selected.compoundId} / ${selected.sampleId}; measured raw relative metabolic activity points and an advisory isotonic fit. Observed status ${selected.status}.`}
      >
        <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="#9aa8b5" />
        <line x1={pad} y1={pad} x2={pad} y2={height - pad} stroke="#9aa8b5" />
        <line x1={pad} y1={y(selected.threshold)} x2={width - pad} y2={y(selected.threshold)} stroke="#e07052" strokeDasharray="5 5" />
        <polyline
          points={modelPoints.map((point) => `${x(point.concentration)},${y(point.isotonicViability)}`).join(" ")}
          fill="none"
          stroke="#0b7280"
          strokeWidth="3"
        />
        {measuredPoints.map((point) => (
          <circle key={point.concentration} cx={x(point.concentration)} cy={y(point.medianViability)} r="5" fill={point.excludedWellIds.length ? "#ffffff" : "#0f8a96"} stroke="#0f8a96" strokeWidth="2" />
        ))}
        {yTicks.map((tick) => <g key={`y-${tick}`}><line x1={pad - 4} x2={pad} y1={y(tick)} y2={y(tick)} stroke="#52606c" /><text x={pad - 7} y={y(tick) + 4} textAnchor="end" fontSize="10" fill="#52606c">{tick.toPrecision(2)}</text></g>)}
        {xTicks.map((tick) => <g key={`x-${tick}`}><line x1={x(tick)} x2={x(tick)} y1={height - pad} y2={height - pad + 4} stroke="#52606c" /><text x={x(tick)} y={height - pad + 15} textAnchor="middle" fontSize="10" fill="#52606c">{Number(tick.toPrecision(3))}</text></g>)}
        <text x={pad} y={22} fill="#52606c" fontSize="12">
          {selected.compoundId} / {selected.sampleId}
        </text>
        <text x={width - pad} y={height - 8} fill="#52606c" fontSize="12" textAnchor="end">
          concentration ({selected.unit})
        </text>
        <text x={14} y={pad} fill="#52606c" fontSize="12" transform={`rotate(-90 14 ${pad})`}>
          relative metabolic activity
        </text>
      </svg>
      <p className="meta">Measured points are raw biological medians; the line is an advisory equal-concentration-weight isotonic fit. Concentration uses a log10 axis in {selected.unit}. Open circles indicate a dose with one or more excluded technical wells. Observed status: {selected.status}.</p>
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
            <th>Raw RMA</th>
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
              <td>{Number.isFinite(well.relativeMetabolicActivityRaw ?? well.viability) ? (well.relativeMetabolicActivityRaw ?? well.viability).toPrecision(5) : "Excluded"}</td>
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
