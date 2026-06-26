# Phase 6 Slice 5 Alignment Audit

## Slice Summary

This slice adds the first inspection-to-network correlation path:

- the shared inspection state now correlates inspected locator candidates to recorded steps
- correlated steps are matched back to captured requests through `triggeringStepId`
- chained inspection locators can still correlate through their child selector segment
- the renderer now shows related request summaries directly inside the inspection lane
- desktop acceptance coverage now proves the inspected target can surface a real associated request

## Requirements Alignment

- Directly addresses the `requirements.md` section 8.3 requirement that the overlay should show recent network requests associated with the selected element or most recent related action when correlation is available.
- Keeps correlation deterministic by deriving it from existing step and capture evidence rather than inventing speculative relationships.
- Preserves the MVP emphasis on evidence-backed debugging inside the single desktop workspace.

## Scope Check

- No scope creep into speculative causality, AI repair, or broader timeline diagnosis work.
- Correlation is intentionally heuristic and evidence-bounded: it only links requests when selector and triggering-step evidence support the match.
- This slice does not yet attempt fuzzy semantic correlation across unrelated selectors or historical runs.

## Architecture Check

- Correlation logic lives in `packages/ui-state`, which is the correct place to combine recording-session state, inspection state, and request evidence.
- The embedded browser still emits only canonical inspection payloads; it does not try to infer network linkage in the page context.
- Renderer changes are display-only and consume already-correlated request IDs from shared state.

## Drift And Gaps

- Correlation currently depends on exact selector matches or a chained-locator child-selector fallback; it does not yet reconcile broader selector-equivalence cases.
- Request association is limited to captured browser actions and their resulting request evidence, not arbitrary passive page requests.
- The inspection lane now shows linked requests, but it does not yet jump directly into a dedicated network-detail view.
