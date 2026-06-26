# Phase 6 Slice 1 Alignment Audit

## Slice Summary

This slice introduces the first real inspector pipeline for the embedded browser:

- Alt + Shift + click inside the embedded browser selects an element for inspection
- the embedded page script derives canonical `InspectionMetadata` and selector recommendations
- Electron main validates and republishes inspection payloads over the existing runtime event channel
- shared UI state tracks the latest inspected element
- the renderer now shows the selected target, primary locator, fallback locators, and core context flags

## Requirements Alignment

- Matches `requirements.md` section 8.3 by letting a user select an element and view at least one recommended selector.
- Surfaces accessibility-adjacent metadata including accessible name, role, label text when present, and interactive type.
- Distinguishes more stable recommendations from weaker fallbacks through deterministic stability scores and tiers.
- Keeps the workflow inside the single-window Electron shell with the embedded browser pane as the inspection source.

## Scope Check

- No scope creep into selector repair, assertion editing, code export, or AI-driven locator guessing.
- This slice implements selected-element inspection, not yet a full hover overlay or rich DOM explorer.
- Related-network correlation is intentionally stubbed as empty until a later slice wires request-to-element linkage.

## Architecture Check

- Inspection payloads are validated against the canonical domain contract before they enter renderer state.
- The embedded browser remains isolated behind the existing Electron main-process boundary and runtime event stream.
- Selector recommendation logic lives in the injected browser-side script where DOM and accessibility signals are directly available.

## Drift And Gaps

- Iframe depth is currently coarse and top-level only; nested iframe inspection needs a later slice.
- Shadow DOM is flagged, but this slice does not yet generate specialized chained locator guidance for shadow hosts.
- The workflow uses a modifier-click selection gesture rather than a persistent visual inspect mode; a richer overlay remains later Phase 6 work.
