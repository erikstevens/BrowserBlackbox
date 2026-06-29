## Phase 7 Slice 4 Alignment Audit

This slice adds the first user-facing artifact export workflow with export-safety enforcement:

- the desktop shell now exposes an artifact export lane with a live safety assessment for visible captured bodies
- default artifact export writes a reopenable bundle in `safe-redacted` mode and excludes warning-flagged visible bodies from the exported snapshot
- the UI now exposes a separate explicit `unsafe-unredacted` export path gated behind a visible acknowledgement control
- exported bundles now include timeline, API capture, replay metadata, export-safety JSON, and a short human-readable summary report
- export-safety heuristics are deterministic and limited to visible full bodies that match explicit sensitive-looking patterns

Requirements alignment:

- Directly advances `requirements.md` section 8.6 by ensuring exports do not silently carry warning-flagged visible sensitive-looking bodies in the default path.
- Satisfies the explicit override direction in `requirements.md` by making visible-body export a separate action with warning acknowledgement rather than a hidden setting.
- Preserves reopening compatibility by continuing to use the canonical stored snapshot and manifest bundle structure already defined in the persistence layer.

Scope and non-goals:

- This slice does not attempt full Playwright test export, Postman/Bruno export, or broader artifact-sharing UX.
- The export-safety heuristic is intentionally limited and deterministic; it does not claim generic PII/PHI discovery.
- No organization-level policy packs, role-based approvals, or background sync behavior have been introduced.

Architecture fit:

- Export-safety assessment and snapshot sanitization live in `packages/persistence`, which is the correct boundary for artifact-writing behavior.
- The Electron main process owns filesystem export and bundle creation through IPC, keeping the renderer free of direct file access.
- Renderer changes remain workflow-oriented: they show the assessment, explain the two export modes, and surface the final export location.

Drift and requirement gaps:

- The default export path currently excludes warning-flagged visible bodies rather than interactively stepping through per-body review; deeper export review UX remains a later slice.
- Visible-body warnings currently rely on deterministic regex-like heuristics over full request and response bodies. Content that is sensitive but does not match those heuristics will not be warned on in this slice.
- Live Electron capture still depends on CDP response-body availability, so some successful responses can export as `unavailable` rather than visible or sanitized text.
