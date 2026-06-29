## Phase 7 Slice 2 Alignment Audit

This slice adds the first dedicated request-detail workflow in the desktop shell:

- captured requests now appear in a selectable request list inside the renderer
- the selected request shows canonical request and response metadata, headers, body state, and timing phases
- related-request cards in the inspection lane now jump directly into the request-detail view
- the renderer explains safe-by-default redaction policy, body visibility, and unavailable or policy-constrained payload states inline
- desktop acceptance coverage now proves full-body display for a safe response plus explicit unavailable-body messaging for a sensitive login endpoint

Requirements alignment:

- Directly advances `requirements.md` sections 8.5 and 8.6 by making captured requests inspectable from the app with request and response detail, visible timing phases, and explicit redaction-state explanations.
- Keeps the capture model canonical by consuming `RequestResponseCapture` and `CaptureBody` from shared domain contracts instead of introducing renderer-only request schemas.
- Preserves the safe-by-default product direction: the UI distinguishes visible bodies from constrained ones and warns that mandatory transport-secret redaction does not imply broad PII detection.

Scope and non-goals:

- No export override workflow, custom user-defined redaction-rule editor, or broad automatic PII detection has been added.
- No scope creep into simulation rules, API export, or replay mutation behavior.
- This slice is display and workflow plumbing on top of the existing runtime evidence stream; it does not change persistence format or capture policy defaults.

Architecture fit:

- Electron renderer changes remain behind the preload and shared-state boundaries.
- Request-detail selection is local renderer state, while request evidence itself remains in `packages/ui-state`.
- The related-request jump path reuses existing inspection-to-capture correlation instead of duplicating lookup logic in the renderer.

Drift and requirement gaps:

- In real Electron acceptance runs, some sensitive auth responses can surface as `response.body.unavailable` when CDP declines to return payload bytes, even though the runtime policy core can classify such responses as excluded when the body is available. The new UI makes that distinction explicit instead of implying an empty response.
- Custom user-defined redaction rules are still not configurable yet, so the request-detail panel only reflects the mandatory baseline policy in this slice.
