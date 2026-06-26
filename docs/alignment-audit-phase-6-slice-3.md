# Phase 6 Slice 3 Alignment Audit

## Slice Summary

This slice hardens selector intelligence for the inspection lane:

- selector scoring now penalizes dynamic user-visible text more aggressively
- CSS fallbacks now call out generated IDs and framework-looking class names as instability signals
- selector ranking is deduplicated and ordered deterministically by strategy priority plus score
- inspection reasoning is surfaced in the renderer for both the primary recommendation and fallbacks
- same-origin iframe documents are now instrumented for inspect-mode listeners and overlay support, even though the current acceptance coverage still exercises the top-level DOM path

## Requirements Alignment

- Moves closer to `requirements.md` section 8.3 by making selector risk reasoning explicit instead of hiding stability behind a single numeric score.
- Stability scoring now considers dynamic text, generated IDs or classes, DOM depth, Shadow DOM placement, and iframe placement.
- The renderer now makes it easier for users to distinguish stable recommendations from risky ones and to understand why the engine ranked them that way.

## Scope Check

- No scope creep into selector auto-repair, assertion authoring, or generated test mutation.
- This slice focuses on scoring and reasoning quality, not yet nearest-stable-parent chaining or request correlation.
- Iframe instrumentation is intentionally limited to same-origin documents; cross-origin frame inspection remains out of scope for MVP.

## Architecture Check

- Selector heuristics still run in the embedded page context where DOM and accessibility signals are directly observable.
- Canonical `InspectionMetadata` remains the validated boundary back into the Electron shell and renderer.
- The renderer additions are explanatory only; they do not create a second source of truth for selector ranking.

## Drift And Gaps

- Same-origin iframe listener wiring is in place, but the current acceptance test coverage still validates dynamic-risk scoring on a top-level target rather than a frame-contained target.
- Shadow DOM detection remains a context flag and penalty signal; specialized shadow-host chaining guidance is still later Phase 6 work.
- Related-request correlation and nearest-stable-parent recommendations remain open for the next slices.
