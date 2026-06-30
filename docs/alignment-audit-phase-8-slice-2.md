# Phase 8 Slice 2 Alignment Audit

## Scope delivered

- Added API export core generators in `@browser-blackbox/export` for:
  - `generated/api.spec.ts`
  - `fixtures/api-requests.json`
- Integrated both artifacts into desktop export preview and artifact-bundle writing.
- Added coverage for base URL extraction, grouped request fixtures, warning handling, and desktop preview visibility.

## Requirements alignment

- Matches `requirements.md` section `8.7 API Export` by delivering:
  - JSON request fixture export
  - Playwright API request test export
  - environment variable support through `BASE_URL`
  - preserved secret placeholders through redacted captured values and explicit fixture metadata
  - request grouping by correlated step or uncorrelated flow bucket
  - saved example responses in fixture output when captured
  - optional assertions in generated API code based on captured status and parseable response bodies

## MVP and architecture fit

- Keeps generated artifacts as standard Playwright output that can run outside the app.
- Reuses the canonical `RequestResponseCapture` model instead of introducing a parallel API-export schema.
- Preserves the default redaction posture by exporting from already prepared safe capture data.

## Non-goal and scope check

- Does not attempt to become a full API platform.
- Does not add proprietary replay dependencies to the exported API test.
- Does not yet deliver the interoperable Postman/Bruno-style collection export; that remains phase 8 slice 3.

## Drift and gaps

- Body assertions remain intentionally conservative:
  - exact status assertions are emitted when a response exists
  - JSON body assertions are emitted only when the captured body is parseable
  - unavailable, excluded, and truncated bodies are represented in the fixture and surfaced as export warnings instead of guessed assertions
- Multi-origin captures fall back to full request URLs instead of forcing a shared base URL variable.
