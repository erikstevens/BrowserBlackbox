# Phase 8 Slice 6 Alignment Audit

## Scope delivered

- Added a renderer-facing artifact reopen workflow for bundle directories.
- Added shell IPC support to read artifact bundles and rehydrate them as `reopened-artifact` projections.
- Added reopen metadata UI showing source bundle path, artifact format version, and missing optional artifact count.
- Reused regenerated export previews after reopen so reopened runs expose generated test and API artifacts without rerunning the browser flow.

## Requirements alignment

- Aligns with the saved-artifact and reopen requirements by enabling a saved bundle to be reopened in-app without replay execution.
- Surfaces the information needed to debug reopen behavior:
  - projection kind
  - artifact format version
  - source bundle path
  - missing optional artifact count
- Preserves graceful degradation by exposing missing optional artifacts as informational reopen state rather than fatal errors.

## MVP and architecture fit

- Reuses the canonical persistence bundle reader instead of inventing a second reopen path.
- Converts reopened bundles into explicit `reopened-artifact` projections at the shell boundary, which matches the repository’s existing persistence model.
- Keeps generated artifact previews derived from the canonical snapshot model, so reopened runs continue to reflect portable Playwright and API outputs.

## Non-goal and scope check

- Does not introduce a full filesystem picker workflow; reopen currently uses a direct path field, which is deterministic and testable.
- Does not attempt artifact migration UX beyond the existing compatibility enforcement in the persistence layer.
- Does not yet persist reopened projections as first-class recent items or thread-local history.

## Drift and gaps

- Reopened projections are hydrated into the current workspace for inspection, but the app does not yet maintain a dedicated recent-artifacts browser.
- Compatibility failures still surface through the existing bundle-reader error path rather than a richer specialized reopen error panel.
- The reopen workflow currently targets bundle directories directly rather than single archive files.
