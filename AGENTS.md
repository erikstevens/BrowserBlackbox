# AGENTS.md

## Purpose

This repository is for **QA Browser Shell**, a desktop QA workspace centered on Chromium, Playwright, and CDP.

Current implementation status:

- Requirements-first project
- Primary source of truth is [requirements.md](C:\Users\jhnny\Documents\Browser Blackbox\requirements.md)
- Product requirements are still in draft as of 2026-06-23

## Product Direction

The product is intended to let QA engineers:

- run a real browser session inside a desktop shell
- record meaningful user behavior
- inspect page, console, and network state
- simulate adverse conditions
- export maintainable Playwright tests and reusable API artifacts

Core architectural assumptions from the current requirements:

- Electron desktop shell
- Embedded Chromium experience
- Playwright as the primary automation engine
- CDP for deeper instrumentation
- Generated artifacts must remain standard Playwright output

## Working Rules For Agents

- Read [requirements.md](C:\Users\jhnny\Documents\Browser Blackbox\requirements.md) before making product or architecture decisions.
- Treat the requirements document as authoritative unless the user explicitly overrides it.
- Prefer changes that preserve exportability to plain Playwright code.
- Keep Chromium-specific implementation details behind interfaces where feasible so broader browser support remains possible later.
- Default to redacting or isolating sensitive captured values in any network or trace-related implementation.
- Avoid introducing features that contradict the current non-goals, especially AI auto-repair, non-Chromium MVP commitments, or full API-platform scope creep.

## Implementation Priorities

When code is added, optimize first for:

1. maintainable Playwright export
2. reliable capture and replay behavior
3. strong inspection and debugging workflows
4. explicit evidence freshness and stale-state handling after edits
5. desktop usability in a single-window workflow

## Delivery Workflow

Default working sequence for each change slice:

1. work
2. test
3. lint
4. commit

Additional workflow rules:

- Do not commit code that has not been tested when tests exist for the changed area.
- Do not skip linting once lint tooling is introduced for the project.
- Keep commits scoped to a coherent slice of work rather than bundling unrelated changes.
- Prefer verifying generated Playwright artifacts and replay-related behavior for any slice that touches recording, export, or execution logic.

## Per-Slice Audit

After each meaningful slice and before push, perform a short alignment audit:

- confirm the change still matches [requirements.md](C:\Users\jhnny\Documents\Browser Blackbox\requirements.md)
- check that the slice does not introduce scope creep against the current non-goals
- verify architecture still fits the Electron plus Playwright plus CDP MVP direction
- verify naming, abstractions, and exported artifacts still match the product language and portability goals
- call out any drift, assumption changes, or newly discovered requirement gaps explicitly

## Git Expectations

- The intended publish remote is `origin` pointing to [erikstevens/BrowserBlackbox](https://github.com/erikstevens/BrowserBlackbox).
- Before pushing, confirm the per-slice audit is complete and the current commit is coherent.
- Prefer pushing after a completed slice rather than after partial exploratory work.

## Collaboration Notes

- If requirements and implementation diverge, call out the mismatch explicitly.
- If a new file or subsystem is created, align naming and structure to the product language in `requirements.md`.
- Prefer incremental, testable slices over speculative framework buildup.
