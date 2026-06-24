# QA Browser Shell Implementation Plan

## Planning Basis

This plan is based on:

- [requirements.md](C:\Users\jhnny\Documents\Browser Blackbox\requirements.md)
- stack decisions provided by the project owner
- architecture-first delivery preference

Fixed stack and delivery assumptions:

- cross-platform target from the start: Windows, macOS, Linux
- TypeScript across the product
- Electron desktop shell
- React renderer
- Zustand for client state management
- Tailwind CSS plus `shadcn/ui`
- `electron-vite` for application scaffolding and build flow
- Electron Builder for packaging
- Playwright as the primary browser automation and replay engine
- Chromium as the embedded and replay target for MVP
- CDP for deep capture and inspection
- SQLite from day one
- E2E coverage as a first-class requirement
- architecture quality prioritized ahead of raw implementation speed

## Delivery Principles

- Work in vertical slices, but only after domain and architecture foundations are in place.
- Treat persistence schemas, artifact schemas, and replay contracts as product interfaces, not incidental implementation details.
- Keep Playwright control, CDP capture, persistence, export, and UI concerns in separate modules.
- Default every capture, storage, and export path to safe handling of sensitive data.
- End every slice with: test, lint, alignment audit, commit.

## High-Level Architecture

Primary bounded areas:

1. desktop shell and process boundary
2. browser runtime orchestration
3. recorder and editable flow model
4. selector and inspection engine
5. network capture and redaction
6. timeline and diagnosis
7. simulation and replay recovery
8. export and artifact system
9. persistence and versioning
10. renderer UX

Proposed top-level package layout:

```text
apps/
  desktop/
packages/
  domain/
  persistence/
  runtime-browser/
  runtime-capture/
  runtime-replay/
  runtime-export/
  runtime-diagnosis/
  ui-components/
  ui-state/
  shared/
tests/
  e2e/
  fixtures/
docs/
  adr/
```

## Phase 0: Architecture and Repo Setup

Goals:

- establish repo structure and tooling
- document architectural decisions before feature coding
- define quality gates and CI

Work:

- scaffold Electron + React + TypeScript app with `electron-vite`
- add Tailwind and `shadcn/ui`
- add Zustand state conventions
- add ESLint, Prettier, typecheck, Vitest, and Playwright-based E2E
- add Electron Builder packaging configuration
- define workspace/package boundaries
- define CI commands for build, unit/integration, and E2E suites
- write first ADRs

Required ADRs:

- process boundary and IPC contract strategy
- browser runtime ownership model
- SQLite schema and migration strategy
- artifact format versioning policy
- redaction and sensitive-data handling model
- export architecture for Playwright and API artifacts
- checkpoint validity model

Acceptance:

- repo builds on Windows, macOS, and Linux dev environments
- core commands are stable and documented
- ADR set exists before domain modeling begins

## Phase 1: Canonical Domain Model

Goals:

- define the product’s core data contracts before UI-heavy implementation

Work:

- define TypeScript domain types and runtime validation for:
  - recorded steps
  - assertions
  - selector candidates
  - inspection metadata
  - request/response capture
  - redaction rules
  - simulation rules
  - timeline events
  - diagnosis rules and results
  - checkpoints
  - artifact manifests
- define domain invariants and state transitions
- define schema version fields from day one

Acceptance:

- domain objects serialize deterministically
- invalid states are rejected at boundaries
- fixture-driven tests cover core invariants

## Phase 2: Persistence and Versioning

Goals:

- make SQLite a first-class backbone rather than an afterthought

Work:

- create migration system
- define normalized tables for sessions, flows, steps, events, requests, rules, checkpoints, and artifacts
- separate current working state from reopened artifact projections where helpful
- define compatibility and migration policy for artifact manifests
- add import/export-safe serialization layer

Acceptance:

- schema boots cleanly on all target platforms
- migrations are repeatable and testable
- stored records map cleanly to domain contracts

## Phase 3: Desktop Runtime Core

Goals:

- establish the process-safe runtime that all higher-level features depend on

Work:

- implement Electron main-process orchestration
- implement secure renderer-to-main IPC boundaries
- create the managed Playwright-controlled Chromium session service
- add CDP session management
- add event streaming for browser, console, network, and replay events
- add failure-visible logging and health status

Acceptance:

- app can launch and control a managed Chromium session inside the desktop workspace
- renderer remains isolated from direct unsafe runtime access
- runtime failures surface clearly

## Phase 4: Recording and Editable Flow Engine

Goals:

- make the flow model the source of truth

Work:

- implement MVP action recording
- map captured actions into canonical step records
- build undo/redo, insert, delete, disable, edit, and reorder operations
- track step dependencies
- mark downstream evidence stale after edits

Acceptance:

- recorded flows are editable without rerecording
- step mutations update the model deterministically
- stale evidence is visible and test-covered

## Phase 5: Replay and Checkpoint Core

Goals:

- make replay correctness and checkpoint validity explicit early

Work:

- implement replay from start
- implement replay to selected step
- implement pause on step
- implement checkpoint creation and validation
- implement checkpoint invalidation after dependent edits
- persist checkpoint metadata and compatibility fields

Acceptance:

- replay modes behave deterministically
- stale checkpoints are never presented as valid
- edited flows reuse only safe checkpoints

## Phase 6: Inspector Overlay and Selector Intelligence

Goals:

- make stable locator selection a first-class feature

Work:

- inject inspection overlay into the managed browser target
- surface role, accessible name, label, text, visibility, enabled state, iframe, and shadow DOM context
- generate one primary locator recommendation plus ranked fallbacks
- implement selector stability scoring
- capture selector reasoning for later export and repair workflows

Acceptance:

- overlay shows meaningful selector guidance
- ranking follows requirement priority order
- risky selectors are clearly identified

## Phase 7: Network Capture and Redaction

Goals:

- capture enough data for debugging without normalizing unsafe defaults

Work:

- implement CDP-backed request lifecycle capture with Playwright correlation
- create `redaction` core module and run it before persistence
- capture request bodies with immediate redaction
- capture response bodies only when:
  - payload is within configured size limit
  - content type is eligible
  - endpoint is not configured as sensitive
- skip large downloads and binary payloads by default
- persist display state such as redacted, truncated, excluded, or full-capture override

MVP default policy:

- request bodies captured with immediate redaction
- response bodies captured only for non-sensitive, small-to-medium payloads
- default response capture limit in the 256 KB to 512 KB range
- large payloads and binary content excluded by default
- sensitive headers, cookies, tokens, passwords, and common secret fields redacted by default
- configurable user rules supported

Acceptance:

- sensitive defaults are enforced before storage and export
- UI can explain why a body was redacted, truncated, or skipped
- tests cover redaction and size-threshold behavior

## Phase 8: Assertions, Timeline, and Diagnosis

Goals:

- correlate browser behavior into a useful QA narrative

Work:

- implement assertion builder for MVP assertion types
- generate standard Playwright assertions
- build unified timeline event model
- add console errors, JS exceptions, screenshots, requests, retries, and applied rules
- implement deterministic diagnosis rules from the MVP catalog

Acceptance:

- failed runs surface linked evidence
- diagnosis output is reproducible
- no freeform speculative cause generation is used in MVP

## Phase 9: Simulation and Interception

Goals:

- support deterministic adverse-condition QA flows

Work:

- implement simulation rule model and ordering
- implement latency, jitter, offline, route block, fixture response, forced status, and delayed response rules
- surface applied rules in timeline and request detail
- export only rules that can be represented faithfully in Playwright

Acceptance:

- conflicting rules resolve deterministically
- replay reflects rule application visibly
- unsupported export cases are warned, never misrepresented

## Phase 10: Export and Artifact System

Goals:

- produce portable artifacts and conventional Playwright output

Work:

- generate standard Playwright `*.spec.ts` files
- generate Playwright API tests and JSON fixtures
- generate one interoperable collection export
- implement artifact bundle writer and reader
- implement manifest validation and compatibility checks
- add migration hooks for future artifact versions

Acceptance:

- exported Playwright tests run outside the app
- artifact bundles reopen correctly on compatible versions
- optional missing files degrade gracefully

## Phase 11: Renderer UX and Workflow Completion

Goals:

- make the architecture usable as a coherent desktop product

Work:

- implement screen inventory and navigation flow
- finalize browser pane, recorder controls, step editor, network tab, timeline, export flows, artifact reopen flow, and settings
- add redaction and full-body override warnings to the UI
- support per-project settings for capture policy

Acceptance:

- the main QA workflow is coherent in a single window
- sensitive-capture overrides are deliberate and visible
- reopened runs feel first-class

## Phase 12: Hardening, E2E, and Release

Goals:

- prove the product against the real workflow, not only internal units

Work:

- expand E2E coverage for:
  - launch and record
  - step editing and stale evidence
  - replay modes
  - selector inspection
  - network capture and redaction
  - simulation rules
  - export flows
  - artifact reopen
  - diagnosis output
- profile large timelines and payload-heavy sessions
- validate packaging across Windows, macOS, and Linux

Acceptance:

- E2E suite covers the MVP workflow end to end
- packaging works on all intended platforms
- MVP passes a requirements-alignment audit

## First Implementation Slices

Recommended immediate slices:

1. scaffold the workspace, tooling, CI, and ADR structure
2. define canonical domain schemas and validation
3. define SQLite schema and migration system
4. implement Electron main/runtime boundary and managed browser launcher
5. implement the initial recorder event pipeline

## Per-Slice Exit Criteria

Each slice should end only when all of the following are true:

- code is implemented
- tests for the slice pass
- lint passes
- alignment audit against [requirements.md](C:\Users\jhnny\Documents\Browser Blackbox\requirements.md) is complete
- drift or new assumptions are documented
- commit is scoped to one coherent unit of work

## Immediate Next Step

The next correct move is Phase 0, Slice 1:

- scaffold the application workspace
- wire the baseline tooling
- create the first ADRs
- establish CI and local quality commands
