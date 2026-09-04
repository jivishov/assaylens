# AssayLens

[Live site](https://jivishov.github.io/assaylens/) · Browser-only exploratory image analysis for XTT 96-well plates and agar endpoint spot assays.

AssayLens turns a confirmed plate photograph into **image-derived relative metabolic activity** and provides a visible plate map, explicit control assignment, reproducible exports, and a narrow WebMCP workflow for browser agents.

> **Scientific scope:** AssayLens is not a calibrated plate-reader absorbance measurement, a direct viable-cell count, or a validated MIC or efficacy determination. Human review of image quality, geometry, controls, and QC remains required.

## About

- XTT 96-well workflow with image upload/capture, manual or assisted geometry confirmation, well-level QC, explicit normalization controls, and exploratory dose-response review.
- Agar endpoint spot workflow with visible spot mapping and image-derived analysis.
- Browser-local workflow: plate images, raw pixels, API keys, and local paths are not sent through WebMCP tools.
- React, TypeScript, Vite, Vitest, and browser workers; no assay-analysis backend is required.

## WebMCP: five page-owned tools

AssayLens registers these tools only when the browser exposes `document.modelContext.registerTool`. The normal UI remains fully usable when WebMCP is unavailable.

| Tool | Purpose | State effect |
|---|---|---|
| `inspect_xtt_workflow` | Inspect XTT readiness, plate validation, concise results, and fixed scientific limitations. | Read only |
| `configure_xtt_series` | Atomically configure one horizontal, leftward or rightward serial dilution with adjacent replicate rows. | Updates the plate map and invalidates stale analysis |
| `assign_xtt_controls` | Atomically assign explicit XTT controls and normalization groups. | Updates the plate map and invalidates stale analysis |
| `run_xtt_analysis` | Run the existing exploratory XTT image-analysis worker once all readiness checks pass. | Stores the result and opens Analysis |
| `focus_xtt_review` | Focus the deterministic highest-priority QC item or a named series for human review. | Visible review focus only |

All tool schemas reject unknown fields, runtime inputs are validated again with Zod, and structured outputs are deliberately bounded. Tools do not return raw pixels, browser file objects, API keys, local paths, or complete project files.

### Plate map and visible editor synchronization

WebMCP mutations and the visible plate editor share the same React state. Configuring a series or controls through a tool updates the plate map, Selection panel, and Serial dilution panel together. Clicking a mapped well also updates Selection with that well's exact role, compound, concentration, unit, normalization group, and replicate identifiers.

For a mapped sample well, Serial dilution preserves the genuine series source (for example, a leftward series can start at F10 with 500 ug/mL) while displaying the clicked well's current dose as context. This prevents a low-dose well from being mistaken for the source concentration when the series is edited again.


## Guardrails

- Claim level: **exploratory**.
- Measurement: **image-derived relative metabolic activity**.
- No automatic efficacy, mechanism, clinical, or validated-MIC conclusions.
- Image QC, geometry, controls, and excluded-well review remain visible and require human judgment.
- Any plate-map mutation invalidates a previous result before the next analysis.

See [docs/WEBMCP.md](docs/WEBMCP.md) for tool contracts, data boundaries, QC-review priority, scientific constraints, and challenge-specific implementation notes.

## Local development

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run dev
```

`package-lock.json` is committed. Continuous integration runs `npm ci`, type checking, Vitest, and a production build before GitHub Pages deployment.

## License

Released under the [MIT License](LICENSE).
