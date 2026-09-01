# AssayLens

AssayLens is a browser-only research workflow for exploratory image analysis of XTT 96-well plates and agar endpoint spot assays. The XTT workflow reports **image-derived relative metabolic activity** from plate photographs. It is not a calibrated plate-reader absorbance measurement, a direct viable-cell count, or a validated MIC/efficacy determination.

Live site: https://jivishov.github.io/assaylens/

## WebMCP Challenge extension

Pre-WebMCP baseline: `db38fd6e78152d7439083588fdfbf9a49aa2fb3c`.

The pre-existing application already contained image loading/camera capture, plate geometry confirmation, a visible 96-well map, serial-dilution logic, deterministic plate validation, worker-based XTT/agar image analysis, result visualization, and exports.

The WebMCP extension adds a narrow agent-assisted XTT workflow on the **same React state and scientific algorithms** used by the visible application:

- `inspect_xtt_workflow` — read workflow state, validation, analysis blockers/readiness, concise results, and scientific limitations.
- `configure_xtt_series` — atomically configure one horizontal serial dilution with adjacent biological-replicate rows.
- `assign_xtt_controls` — atomically assign explicit XTT control roles and normalization groups.
- `run_xtt_analysis` — run the existing image-analysis worker and return only after it completes or fails.
- `focus_xtt_review` — deterministically focus the result that most needs human QC review.

The extension does **not** add combination pharmacology, synergy scoring, docking, protein structures, a backend, a chatbot, or automatic efficacy/mechanism conclusions.

Tool outputs are intentionally bounded. Lists such as blockers, warnings, wells, and result series report their total count and whether the returned list was truncated. Raw pixels, browser file objects, API keys, local paths, and complete project files are never returned through site tools.

## Synthetic WebMCP demo

1. Open the live AssayLens site in a WebMCP-capable browser/agent.
2. On the Image screen choose **Load WebMCP demo**. This creates a deterministic synthetic plate image using the same plate-grid geometry code as analysis, installs preconfirmed geometry, and leaves the plate map empty so agent edits are visible.
3. Use this prompt:

> Use only the AssayLens site tools to configure the loaded synthetic XTT demo. Create an eight-dose two-fold concentration series for "Demo Extract A" against "Test organism," starting at A1 with 128 ug/mL and decreasing to the right. Use two adjacent replicate rows and normalization group "Demo-1." Assign H1 and H2 as growth controls and H3 and H4 as reagent blanks for the same group. Inspect the workflow, run the XTT analysis when ready, and focus the result with the highest QC-review priority. Explain the QC issue and the exploratory measurement limit only; do not make efficacy or mechanism claims.

Expected practical sequence: `inspect_xtt_workflow` → `configure_xtt_series` → `assign_xtt_controls` → `inspect_xtt_workflow` → `run_xtt_analysis` → `focus_xtt_review`.

The tools are independently valid and do not hard-code that sequence.

## Scientific guardrails

All WebMCP result-related tools preserve these limitations:

- Claim level: exploratory.
- Measurement: image-derived relative metabolic activity.
- Not a calibrated plate-reader absorbance measurement.
- Not a direct viable-cell count.
- Not a validated MIC or efficacy determination.
- Human review of image quality, geometry, controls, and QC remains required.

Image loading and geometry confirmation remain human-controlled for real experiments. The synthetic challenge fixture is explicitly disclosed and does not change scientific thresholds or analysis algorithms.

## Local development

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run dev
```

`package-lock.json` is committed and CI uses `npm ci`. `webmcp-types` supplies the ambient TypeScript definitions for `document.modelContext`. In browsers where WebMCP is unavailable, registration is skipped and the normal AssayLens UI continues to function.

## Architecture

See [`docs/WEBMCP.md`](docs/WEBMCP.md) for the bridge architecture, tool contracts, guardrails, fidelity constraints, and challenge-scope notes.

The implementation plan treated an MIT license as optional and conditional on an explicit owner licensing decision. This repository therefore does not assign a license as part of the WebMCP extension.
