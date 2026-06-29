## Phase 7 Slice 3 Alignment Audit

This slice adds user-defined redaction rules across the workspace, runtime, and persisted working copy:

- workspace state now carries canonical `redactionRules` alongside steps, captures, timeline, and diagnosis
- working-copy snapshot export and hydration now persist user-defined redaction rules through the existing SQLite-backed snapshot path
- the Electron shell now exposes a runtime rule-update IPC path so the active managed session can apply rule changes without inventing renderer-only behavior
- the renderer now includes a rule-management panel for adding and removing user-defined rules by kind, scope, and target
- runtime capture now applies user-defined rules to supported request and response payloads, selected headers, cookie headers, and request URLs with matching query params

Requirements alignment:

- Directly advances `requirements.md` section 8.6 by making additional user-configured masking rules explicit, reviewable, and persisted in the app state.
- Keeps the `requirements.md` section 8.5 request-detail workflow canonical by redacting values before they are stored into the runtime event stream and later rendered in the shell.
- Preserves safe-by-default behavior: mandatory credential-like redaction still runs first, and user-defined rules only add masking rather than weakening baseline protection.

Scope and non-goals:

- No export override workflow for unredacted artifacts has been added yet.
- No claim of broad automatic PII or PHI detection has been introduced.
- This slice does not add a full policy catalog, organization-wide rule packs, or artifact-sharing workflow.

Architecture fit:

- Domain contracts for `RedactionRule` remain the shared product language across renderer, runtime, and persistence.
- Renderer state only manages rule-authoring inputs and selection UX; the actual persisted rules live in `packages/ui-state` and snapshots.
- Runtime redaction remains centralized in `packages/runtime-browser`, which is the correct boundary for masking request and response evidence before it reaches the desktop shell.

Drift and requirement gaps:

- User-defined rule application currently covers the deterministic MVP paths implemented in this slice: JSON-path body masking, form/query key masking, regex masking, header masking, cookie masking, and request-URL query-param masking.
- In live Electron acceptance runs, CDP may still return `response.body.unavailable` for some requests, so the rule-management UI cannot guarantee visible redacted response text for every successful response even when the rule set is correct.
- There is still no export-time warning or explicit unredacted override flow; that remains a later Phase 7 slice.
