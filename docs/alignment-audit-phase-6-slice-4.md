# Phase 6 Slice 4 Alignment Audit

## Slice Summary

This slice adds nearest-stable-parent guidance for repeated container targets:

- `InspectionMetadata` now carries an optional canonical stable-parent recommendation
- the embedded selector engine searches ancestor containers for a unique stable anchor
- repeated child locators can now be promoted into chained locators scoped by that parent
- the renderer shows the stable parent anchor, its strategy, and the reasoning behind it
- desktop acceptance coverage now exercises repeated-container selection and verifies chained locator output

## Requirements Alignment

- Directly addresses the `requirements.md` section 8.3 requirement that the overlay should show the nearest stable parent suitable for chained locators when one exists.
- Improves selector portability by preferring scoped locators over ambiguous repeated child selectors.
- Keeps locator recommendations aligned with the documented priority order while making repeated-container scoping explicit to the user.

## Scope Check

- No scope creep into full request correlation, selector repair, or export mutation workflows.
- This slice focuses on repeated DOM containers in the current document tree; it does not yet infer multi-step semantic containers from timeline or network evidence.
- Chaining support currently composes from stable ancestor and child locator recommendations rather than inventing a separate selector DSL.

## Architecture Check

- Stable-parent analysis remains in the injected page-side selector engine where ancestor structure and uniqueness can be inspected directly.
- The parent recommendation is carried through the canonical domain contract instead of living only in renderer presentation code.
- The renderer remains explanatory and read-only; it surfaces what the selector engine derived rather than recalculating container anchors itself.

## Drift And Gaps

- Parent detection currently favors explicit test contracts and structurally meaningful containers, but it does not yet rank “nearest stable parent” against sibling or cousin anchors across more complex layouts.
- Cross-frame parent chaining is still out of scope; same-origin frame instrumentation exists, but this slice’s shipped acceptance value is repeated-container scoping inside the main document.
- Related network request correlation remains open for the next slice.
