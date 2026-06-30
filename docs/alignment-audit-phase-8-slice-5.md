# Phase 8 Slice 5 Alignment Audit

## Scope delivered

- Added simulation-activity visibility in the workspace using timeline-backed `simulation-rule` events.
- Added Playwright simulation export mapping as `generated/simulation-rules.ts`.
- Mapped supported simulation rules into readable Playwright routing code and surfaced explicit warnings for rules that cannot be represented faithfully.
- Integrated simulation export metadata into artifact preview and bundle generation.

## Requirements alignment

- Matches the remaining `requirements.md` section `8.8` expectations for this slice by:
  - showing when a simulation rule was applied
  - keeping applied-rule visibility in the timeline-oriented UX
  - exporting only the subset of simulation rules that can be represented readably in standard Playwright code
  - omitting unsupported export mappings with explicit warnings instead of silently generating misleading logic

## Export mapping delivered

- Exported as executable Playwright setup code:
  - `fixed-latency`
  - `offline`
  - `route-block`
  - `forced-status`
  - `delayed-response`
  - `response-fixture`
- Exported artifact integration:
  - `generated/test.spec.ts` now imports and uses `generated/simulation-rules.ts` when simulation rules are attached
  - `workspace/replay-metadata.json` records simulation export warnings and the attached rule set

## MVP and architecture fit

- Keeps simulation export inside `@browser-blackbox/export` so rule-to-code mapping remains centralized and deterministic.
- Preserves standard Playwright portability by exporting readable `page.route(...)` setup code rather than app-specific runtime hooks.
- Reuses the canonical `SimulationRule` model without introducing a second export-only rule schema.

## Non-goal and scope check

- Does not expand into Bruno-specific simulation metadata, collection execution, or broader fixture-management workflows.
- Does not claim faithful export for non-representable actions.

## Drift and gaps

- `latency-jitter`, `throttle-upload`, and `throttle-download` are still warned out of Playwright export.
- Fixture-backed exports assume readable text fixtures and do not yet infer richer response metadata such as headers from fixture files.
- The generated UI test currently installs simulation rules via a helper file and removes them at the end; it does not yet synthesize per-test selective enablement beyond the attached flow rule set.
