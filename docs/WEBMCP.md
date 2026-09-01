# AssayLens WebMCP extension

## Scope

This extension exposes existing AssayLens XTT workflow operations to browser agents without replacing the scientific calculations or moving the workflow into a separate backend representation.

```text
Browser agent
    |
    v
document.modelContext.registerTool(...)
    |
    v
src/webmcp/registerAssayLensTools.ts
    |
    v
src/webmcp/assayLensBridge.ts
    |
    +--> existing applySerialDilution(...)
    +--> atomic assignControlsAtomic(...)
    +--> existing validatePlateMap(...) / analysisBlockers(...)
    +--> shared Promise-based image-analysis worker
    +--> deterministic review selection
    |
    v
Existing React state and visible AssayLens UI
```

## Five site tools

| Tool | Purpose | Side effect |
|---|---|---|
| `inspect_xtt_workflow` | Inspect XTT workflow state, plate validation, blockers, concise results, and claim limitations. | None |
| `configure_xtt_series` | Configure one horizontal serial dilution using existing `applySerialDilution`. | Plate-map mutation; stale analysis invalidated |
| `assign_xtt_controls` | Batch-assign explicit XTT controls atomically. | Plate-map mutation; stale analysis invalidated |
| `run_xtt_analysis` | Execute the existing worker after normal readiness checks. | Stores result and opens Analysis |
| `focus_xtt_review` | Select the deterministic highest-priority QC review item or a named series. | Interface focus only |

All tool input schemas reject unknown properties. Runtime inputs are parsed again with Zod. Expected workflow failures return structured `ok: false` objects rather than throwing agent-facing stack traces.

## Fidelity constraints

- Horizontal dilution only. The existing helper derives biological replicate IDs from rows, so vertical dilution is intentionally not exposed through WebMCP.
- A `compoundId + sampleId` pair cannot be created in different normalization groups through the site tool because endpoint grouping is currently based on compound and sample identity.
- Existing `validatePlateMap` and `analysisBlockers` remain authoritative; tool handlers do not duplicate scientific validation.
- Any plate-map mutation invalidates a prior analysis before the next agent call can observe state.
- The human Run button and WebMCP run tool use the same Promise-based worker path.
- Worker execution resolves only on the worker `complete` message, rejects on worker error, and terminates on completion, failure, or WebMCP cancellation.
- Real image loading and geometry confirmation remain human responsibilities.

## QC-review focus

Priority is deterministic:

1. `qc_failed`
2. `indeterminate_missing_data`
3. `non_monotonic_indeterminate`
4. any series containing excluded wells
5. any series containing warnings
6. first available series as a routine fallback

The focus action uses language such as "selected for QC review" and never labels a series as a best compound, promising drug, effective treatment, mechanism, or clinical result.

## Scientific envelope

WebMCP inspection, analysis, and review outputs carry a fixed context:

- `claimLevel`: `exploratory`
- `measurement`: `image-derived relative metabolic activity`
- not calibrated plate-reader absorbance
- not a direct viable-cell count
- not a validated MIC or efficacy determination
- human review of image quality, geometry, controls, and QC is required

Raw image pixels, `ImageData`, `ImageBitmap`, `File`, `Blob`, API keys, file paths, and complete project files are never returned by a site tool.

## Synthetic demo

The Image screen includes a deterministic in-browser synthetic plate fixture with preconfirmed geometry and an initially empty plate map. It intentionally adds a white glare region at one sample-well location. The demo does not alter the analysis thresholds; the fixture is tuned to exercise the existing workflow rather than changing the algorithm to fit the demonstration.

The demo is explicitly disclosed as synthetic in the UI and all results remain exploratory.

## Pre-existing versus challenge work

| Pre-existing at baseline `db38fd6e...` | Added for WebMCP |
|---|---|
| Image upload/camera capture | Top-level imperative tool registration |
| Manual/Gemini-assisted geometry workflow | Stable React-to-WebMCP bridge |
| Visible 96-well plate editor | Atomic agent series/control operations |
| Serial dilution helper | Horizontal-only WebMCP adapter and identity guard |
| Plate-map validation | Structured inspection/readiness responses |
| Worker-based XTT/agar analysis | Promise/cancellation wrapper shared with human run |
| Dose-response and QC result views | Deterministic agent review focus |
| Project/report exports | Synthetic no-key demo and challenge documentation |

## Browser behavior

`registerAssayLensTools()` checks for `document.modelContext.registerTool`. If unavailable, it returns without affecting ordinary AssayLens behavior. Tool registration uses an `AbortController` lifecycle and occurs from the top-level page (`src/main.tsx`).
