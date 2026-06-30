## Phase 8 Slice 1 Alignment Audit

This slice adds the first Playwright UI export core on top of the canonical recorded flow:

- a new pure `@browser-blackbox/export` package now transforms canonical `RecordedStep` data into a standard Playwright TypeScript `*.spec.ts` file
- the generated UI test preview is now visible in the desktop export lane
- the artifact bundle export now includes the generated Playwright UI test file
- disabled steps are omitted from the default UI export and reported as explicit export warnings
- unsupported step and assertion kinds are omitted for now and surfaced as deterministic export warnings instead of being silently emitted as misleading code

Requirements alignment:

- Directly advances `requirements.md` section 8.12 by generating standard TypeScript Playwright test files with minimal imports, direct `page` usage, and no app-specific runtime helpers.
- Preserves the canonical export boundary from ADR-006 by isolating UI code generation into a dedicated export package rather than mixing it into runtime capture or renderer state.
- Keeps the generated test portable by emitting normal Playwright syntax that can be dropped into a standard Playwright project structure.

Scope and non-goals:

- This slice only covers the core UI test export path, not API export formats from section 8.7.
- It does not yet export network simulation rules into generated Playwright code.
- It does not yet support every recorded action and assertion type; unsupported items are reported as warnings rather than auto-translated into speculative code.

Architecture fit:

- Export logic now lives in `packages/export`, which is the right boundary for transforming canonical flow data into external artifact formats.
- Both the renderer preview and the main-process artifact writer use the same generator, preventing preview/export drift.
- The artifact bundle still flows through the persistence export path, with the generated UI test added as another declared artifact.

Drift and requirement gaps:

- The current UI generator supports the common MVP interaction path and basic DOM assertions, but richer assertion kinds, grouped `test.step()` workflow sections, and commented-out disabled-step export are still later work.
- The exported file name is currently stable and generic (`generated/test.spec.ts`); more descriptive naming derived from flow structure is still open for refinement.
- This slice intentionally favors valid, conventional Playwright output over maximum step coverage. Unsupported steps are called out explicitly instead of being emitted as brittle or misleading code.
