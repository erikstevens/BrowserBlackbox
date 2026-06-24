# QA Browser Shell Requirements Document

## Document Status

- Status: Draft for review
- Date: 2026-06-23
- Project: QA Browser Shell
- Purpose: Define product requirements before implementation begins

## 1. Product Summary

QA Browser Shell is a desktop QA workspace built around Chromium and Playwright. Its purpose is to let QA engineers run a real browser session, record meaningful user behavior, inspect browser and network state, simulate adverse network conditions, and export maintainable automation artifacts.

The primary product promise is:

Turn a real browser session into:

- a maintainable Playwright UI test
- a reusable API collection
- a debuggable execution trace

## 2. Problem Statement

Browser-based QA work is fragmented across multiple tools:

- UI automation tools for browser actions
- API tools for request inspection and replay
- DevTools for network and console debugging
- separate traces, screenshots, logs, and reports for failure diagnosis

This fragmentation increases time spent on setup, reproduction, debugging, and artifact conversion. QA Browser Shell should reduce that overhead by giving QA engineers one workspace for recording, inspection, replay, network manipulation, and export.

## 3. Product Goals

The product must:

- make browser test creation faster than writing raw Playwright from scratch
- generate readable and maintainable Playwright code
- capture network/API behavior alongside UI actions
- help users diagnose failures from one unified timeline
- support adverse-condition testing without requiring custom code
- export useful artifacts that can be reused outside the app

## 4. Non-Goals

The first version will not:

- replace Playwright as a general test framework
- replace Chromium as a browser engine
- provide AI-generated test repair without explicit user approval
- support every browser engine in the desktop shell on day one
- act as a full API platform comparable to Postman enterprise features
- solve full-scale load, performance, or security testing

## 5. Target Users

Primary users:

- QA engineers writing browser-based tests
- SDETs building maintainable automation flows
- developers debugging flaky browser and API interactions

Secondary users:

- product teams reproducing workflow failures
- support or operations staff diagnosing user-facing browser issues

## 6. Assumptions and Constraints

- The first implementation should use Electron as the desktop shell.
- The first implementation should use Playwright as the automation engine.
- Chromium is the required embedded browser for MVP.
- The architecture should remain browser-extensible so Firefox and WebKit support can be added after MVP without rewriting the core recording, export, or replay model.
- The desktop app should default to a single-window, single-workspace UX with the browser surface embedded as a pane or tab inside the main Electron application.
- The browser surface should still be backed by a dedicated Playwright-controlled Chromium target rather than the app's own UI renderer process.
- Deep browser instrumentation should use CDP in addition to Playwright from day one.
- Generated output must remain standard Playwright code that can run outside the app.
- Sensitive values must be redacted by default in captured network artifacts.
- The app must prioritize desktop usability over cross-platform feature parity in early versions.

### 6.1 Architecture Decisions Fixed for MVP

The following architecture decisions are resolved for this version of the requirements:

- Browser control model: Electron desktop shell with an embedded browser pane backed by a dedicated Playwright-controlled Chromium target.
- Automation model: Playwright is the primary execution and replay engine.
- Deep instrumentation model: CDP is required for network timing detail, console/runtime data, DOM inspection support, and accessibility metadata beyond what Playwright exposes directly.
- Integration model: the product should use a hybrid Playwright-plus-CDP architecture, with Playwright responsible for control and export-friendly execution, and CDP responsible for deep capture and inspection.
- Browser support model: MVP replay and embedded browsing target Chromium only, but interfaces and stored artifacts should avoid Chromium-only assumptions where not required for MVP capture depth.

Rationale:

- Playwright alone is not sufficient for the timing granularity already required in the capture model.
- A single-pane application is better for day-to-day QA workflow because it keeps recording, inspection, timeline, and browser interaction in one workspace without window switching.
- The app UI renderer and the automated browser target should still remain logically separate so browser crashes, navigations, and test state do not destabilize the product shell.
- Using a Playwright-controlled Chromium target keeps generated output aligned with how exported tests will actually run in CI.

## 7. Core User Stories

### 7.1 Record a browser flow

As a QA engineer, I want to perform actions in a real browser and automatically generate a readable Playwright test, so that I can create automation quickly.

### 7.2 Inspect page elements

As a QA engineer, I want to inspect elements in-page and see accessible metadata and selector recommendations, so that I can choose stable locators.

### 7.3 Add assertions visually

As a QA engineer, I want to define assertions from the UI instead of writing all code manually, so that I can build tests faster and with fewer mistakes.

### 7.4 Capture API activity

As a QA engineer, I want UI actions correlated with API requests and responses, so that I can understand what happened during a flow.

### 7.5 Export reusable artifacts

As a QA engineer, I want to export the recorded flow as test and API artifacts, so that I can reuse them in CI and other tools.

### 7.6 Simulate failure conditions

As a QA engineer, I want to inject latency, offline mode, and response failures, so that I can test resilience and error handling.

### 7.7 Diagnose failures quickly

As a QA engineer, I want a single timeline showing user actions, requests, errors, and assertions, so that I can identify likely failure causes quickly.

### 7.8 Reopen prior runs

As a QA engineer, I want to reopen a saved run artifact without rerunning the test, so that I can review evidence later.

### 7.9 Correct recording mistakes

As a QA engineer, I want to undo, redo, edit, reorder, insert, or remove recorded steps, so that small recording mistakes do not force me to restart the flow.

## 8. Functional Requirements

### 8.1 Session Launch and Control

The application must:

- allow the user to enter a target URL and launch a Chromium session
- launch a browser session inside the app workspace and open that session under Playwright control
- support starting and stopping recording
- support replaying a recorded flow
- support saving and reopening a run artifact

Acceptance criteria:

- A user can launch a URL from the app and interact with the page.
- Recording state is clearly visible.
- A saved run can be reopened later from disk without re-executing the flow.
- The user can inspect and control the browser without switching to a separate top-level application window.

### 8.2 Test Recording

The recorder must capture, at minimum:

- page navigation
- click and double-click
- text entry and form fill
- select option
- checkbox and radio interactions
- keyboard shortcuts relevant to app behavior
- drag and drop
- file upload
- popup or new-tab creation
- download initiation
- dialog interaction
- page transitions and reloads

The recorder must support step editing after capture. Users must be able to:

- undo the most recent recording or editing action
- redo a previously undone action
- delete an incorrect recorded step
- reorder recorded steps where the resulting sequence remains valid
- insert supported actions or assertions between existing steps
- edit step parameters such as text values, selected options, target URLs, and assertion values
- mark a step as disabled without permanently deleting it
- review a step list before code export

Undo, redo, edit, insert, disable, and reorder operations apply to the recorded step list as data. They do not attempt to mutate the already-recorded browser session in place or reconstruct browser state retroactively.

Step ordering requirements:

- Reordering is allowed only within the editable step model before replay.
- The system must validate obvious dependencies before allowing reorder, such as moving a submit action ahead of required form-fill steps.
- When dependency validity is uncertain, the app should allow the reorder with a warning and require replay before the flow is considered valid.

Evidence invalidation requirements after edits:

- Editing, inserting, deleting, disabling, or reordering a step invalidates downstream network correlation, timing correlation, and failure-diagnosis evidence for the affected portion of the run.
- The app must mark invalidated evidence as stale rather than silently presenting it as current.
- Fresh network capture and correlation data must be regenerated by replaying the edited flow from a chosen checkpoint or from the start when no valid checkpoint exists.
- Generated code can be updated immediately from the edited step model, but evidence-backed diagnostics must come only from a replay of the edited flow.

Replay, checkpointing, and recovery behavior is specified in `8.14 Execution and Checkpointing`.

The recorder must generate readable Playwright code.

Selector generation approach:

- The product should leverage Playwright's existing locator-generation and codegen heuristics wherever they satisfy the required behavior.
- Custom selector logic should be limited to gaps Playwright does not expose directly, such as stability scoring, candidate explanation, project-specific test-attribute policy, repeated-container scoping hints, and editable fallback metadata.
- The product must not fork into a fully separate selector engine unless a documented limitation in Playwright heuristics requires it.

Selector priority must be:

1. explicit test contract selectors such as `data-testid`, `data-test`, or approved project-specific test attributes
2. accessible role plus stable accessible name
3. associated form label text
4. stable placeholder, alt text, title, or other accessibility-adjacent semantic attribute when it is intentionally user-facing
5. normalized stable visible text
6. constrained CSS selector based on stable attributes or structure
7. XPath only as a last resort

Selector strategy requirements:

- Prefer selectors that reflect user-observable meaning over implementation structure.
- Prefer `getByRole()` with a name filter when the element has a meaningful accessible role and name.
- Normalize text before scoring selector quality by trimming whitespace, collapsing repeated whitespace, and ignoring formatting-only line breaks.
- Treat dynamic IDs, hashed class names, framework-generated attributes, positional selectors, and deeply chained structural selectors as unstable by default.
- Do not prefer text-based selectors when text is likely to vary because of localization, counters, timestamps, usernames, or dynamic content.
- Do not prefer raw CSS classes unless they match a known stable project convention.
- When multiple candidates exist, rank selectors by stability, readability, and uniqueness in that order.
- Retain fallback candidates in recorder metadata even when only one selector is emitted in generated code.
- Surface selector risk reasoning to the user when the chosen selector depends on text, structure, or low-confidence uniqueness.

Role and name heuristics:

- Use role plus accessible name when the element can be identified uniquely and the accessible name is stable and user-meaningful.
- Prefer exact accessible names over partial matches unless exact matching fails due to predictable formatting noise.
- Avoid name strategies that depend primarily on hidden helper text, transient status text, or container text aggregation.
- For controls inside repeated lists, tables, or cards, scope role-based selectors to the nearest stable container before falling back to less semantic strategies.

Dynamic ID and generated-attribute handling:

- Treat IDs as unstable when they contain long random-looking substrings, incrementing suffixes, UUID-like patterns, or framework instance markers.
- Ignore ephemeral framework attributes unless explicitly configured as stable by the project.
- When a dynamic ID is the only unique signal, preserve it as a low-confidence fallback rather than the primary selector.

Acceptance criteria:

- A recorded login flow produces executable Playwright code.
- Generated code uses preferred selectors whenever available.
- XPath is not used when a higher-priority stable locator exists.
- A user can undo and redo step changes during recording review.
- A user can correct a mistyped input or remove an accidental click without rerecording the entire flow.
- Editing a recorded step marks downstream evidence as stale until replay regenerates it.

### 8.3 Inspector Overlay

The app must provide an in-browser inspection overlay that shows, for a hovered or selected element:

- tag and relevant attributes
- accessible role
- accessible name
- text content when applicable
- primary recommended locator with fallback alternatives
- selector stability score
- presence and value of `data-testid` or configured test attribute
- iframe or shadow DOM context
- visibility state
- enabled or disabled state
- whether the element appears covered or obscured

Primary recommended locator requirements:

- The overlay must show one primary recommended locator as the default code-generation choice.
- The primary recommended locator must follow the documented selector priority order.
- The overlay should show 2 to 3 ranked fallback locator alternatives when available.

Selector stability requirements:

- The overlay must show either a 0 to 100 score or a tiered rating such as `Excellent`, `Good`, `Risky`, or `Fragile`.
- Stability scoring should consider at least:
  - uniqueness and presence of `data-testid` or approved test attribute
  - whether `getByRole()` plus exact accessible name is unique
  - whether text appears dynamic because it contains counters, dates, timestamps, or similar volatile content
  - DOM depth and selector specificity
  - presence of auto-generated IDs or classes
  - whether the element is inside Shadow DOM or an iframe

Accessibility metadata requirements:

- The overlay must show computed ARIA role.
- The overlay must show the accessible name used for role-based locator generation.
- The overlay must show associated label text for form controls when available.
- The overlay should warn when an interactive element appears to lack a proper accessible name.

Context flag requirements:

- The overlay must show whether a test ID is present and its value.
- The overlay must show whether the element is inside an iframe and identify iframe nesting depth or source when known.
- The overlay must show whether the element is inside Shadow DOM.
- The overlay must show whether the element is currently visible, enabled, or obscured.
- The overlay must show the interactive type such as button, link, input, or non-interactive element.

Related diagnostics requirements:

- The overlay should show the nearest stable parent suitable for chained locators when one exists.
- The overlay should show recent network requests associated with the selected element or most recent related action when correlation is available.

Acceptance criteria:

- A user can select an element and view at least one recommended selector.
- Accessibility metadata is shown when available.
- The user can distinguish stable recommendations from risky ones.
- A user can see one primary recommended locator and ranked fallback alternatives when alternatives exist.
- A user can identify when an element is risky because of dynamic text, generated IDs, iframe placement, or Shadow DOM context.

### 8.4 Assertion Builder

The app must allow users to add assertions without manual code entry.

Supported assertion types for MVP:

- element is visible
- element is hidden
- element contains text
- URL matches expected pattern or value
- API response status equals expected value
- API response body contains expected value
- no console errors occurred
- page load completed under a threshold
- element becomes enabled
- download occurred
- request occurred
- request completed within a timing threshold

Generated assertions must compile down to standard Playwright code.

Acceptance criteria:

- A user can add an assertion from the UI and see it represented in generated code.
- A generated test containing visual assertions can be replayed successfully.

### 8.5 Network and API Capture

The app must capture HTTP and WebSocket traffic generated by the browser session.

Capture implementation requirement:

- MVP network capture must use CDP-backed collection for browser-level request lifecycle detail and Playwright event correlation for user-flow alignment.

For each request, the system must store when available:

- timestamp
- triggering UI action or nearest correlated action
- URL
- method
- request headers
- request body
- response status
- response headers
- response body
- duration
- request failure details
- correlation IDs when present
- cache or service worker origin when known
- retry or block status when applicable

The system must capture DNS, connect, TLS, request, and response timing when Chromium/CDP exposes that data for the request.

Body capture requirements:

- MVP should capture full request bodies and full response bodies by default for the managed browser session when technically available.
- Full-body capture does not override mandatory redaction rules for credentials, secrets, or configured sensitive fields.
- The UI must make it clear that full-body capture may still include personal or regulated data unless explicit redaction rules are configured.

Acceptance criteria:

- Captured requests are viewable alongside recorded UI actions.
- A user can inspect a request and its response details from the app.
- Sensitive values are not displayed in raw form by default.
- For a request where CDP timing phases are available, the UI exposes those timing phases in the request detail view.
- When request or response bodies are available, the app stores and displays full bodies subject to redaction rules.

### 8.6 Redaction and Data Handling

The redaction model must be explicit and rule-based.

Default redaction scope:

- always redact secret-bearing transport fields such as `Authorization`, `Cookie`, `Set-Cookie`, common API key headers, bearer tokens, passwords, session identifiers, and other credential-like values
- always redact user-entered values recorded in known sensitive input types such as password fields
- optionally redact configured request or response fields by exact name, path, or header key

Full-body capture safety requirements:

- Because MVP captures full request and response bodies by default, the product must clearly distinguish captured-but-redacted content from captured-and-visible content.
- The UI must warn that the product does not guarantee broad automatic detection of all PII, PHI, HIPAA-regulated content, or other regulated payload data.
- Users must be able to add explicit redaction rules for known sensitive business fields before export or sharing.

PII handling requirements:

- MVP should not claim generic AI-style PII detection.
- MVP may support a limited configurable ruleset for common structured fields such as email, phone, SSN-like fields, account IDs, or project-defined keys, but those rules must be explicit and reviewable.
- If broad PII detection is not implemented, the UI must not imply that arbitrary personal data has been comprehensively detected or removed.

Configuration requirements:

- Users must be able to add custom redaction rules for specific headers, cookies, JSON paths, form fields, query parameters, and regex-like value patterns.
- Redaction rules must apply consistently to UI display, saved artifacts, and exports unless the user explicitly chooses an allowed override workflow.
- Export of unredacted sensitive bodies must require explicit user action and warning.

Acceptance criteria:

- Default captures do not expose raw credentials or session secrets in the main UI or exports.
- A user can configure additional redaction rules by field name or pattern.
- The UI distinguishes between guaranteed redaction rules and optional user-defined data masking rules.

### 8.7 API Export

The app must export captured requests in these formats:

- interoperable JSON collection export suitable for import into Postman or Bruno
- JSON request fixture
- Playwright API request test

Exports should support:

- environment variables
- secret placeholders
- base URL extraction
- request grouping by user action or flow
- saved example responses
- optional assertions based on captured status or body

Acceptance criteria:

- A recorded flow can be exported as one collection format and one code-oriented format.
- Exported artifacts are structurally valid for their target format.

### 8.8 Network Simulation and Interception

The app must include a local interception layer capable of modifying or simulating network conditions.

MVP interception model:

- MVP should use Playwright routing and Chromium-compatible browser/network controls as the primary implementation path.
- The interception layer is intended for deterministic QA replay, not for full proxy-grade traffic emulation.
- Rules must be attached to the recorded flow, visible in the UI, and executable during replay.
- Rules must execute in declared order, with clear precedence when multiple rules match the same request.

MVP supported rule types:

- fixed latency injection
- random latency jitter
- per-domain latency rules
- per-route latency rules
- upload and download throttling
- offline mode
- route blocking
- forced HTTP status codes
- forced delayed responses
- response replacement with fixtures

Rule definition requirements:

- A rule must have a stable identifier.
- A rule must define match scope by route pattern, domain, method, or flow context.
- A rule must define one action only for MVP, except that delay plus final response override may be composed as one deterministic rule.
- A rule must be enableable, disableable, editable, and removable.
- The UI must show whether a rule applies globally for the replay or only within a selected scenario.

Execution requirements:

- If multiple rules match a request, the app must apply a deterministic precedence model.
- Route-specific rules must take precedence over domain-wide rules.
- Exact matches must take precedence over wildcard matches.
- Disabled rules must never affect replay.
- Applied rules must be logged into the timeline and network detail views.

Export requirements:

- MVP must export only the subset of simulation rules that can be represented readably in standard Playwright code.
- If a configured rule cannot be exported faithfully, the export must either omit it with a warning or render it as non-executable metadata, but must not silently generate misleading test logic.

Out of scope for MVP interception:

- acting as a general system-wide proxy
- cross-application traffic interception outside the managed QA browser session
- perfect simulation of low-level transport faults
- arbitrary request mutation and arbitrary response mutation

Post-MVP candidate interception features:

- packet-loss approximation
- DNS failure simulation
- malformed JSON responses
- connection reset simulation
- forced timeout behavior
- request mutation
- response mutation

These rules must be usable interactively and, for supported rule types, exportable into generated Playwright test logic.

Acceptance criteria:

- A user can define a route rule and see it affect the next replayed run.
- The timeline shows when a simulation rule was applied.
- Two matching rules affecting the same request produce the same winner consistently across identical replays.
- Unsupported rule types are not silently exported as if they were faithfully represented.

### 8.9 Timeline and Failure Diagnosis

Each execution must produce a unified timeline that includes:

- user actions
- DOM-related events relevant to assertions or interaction outcomes
- navigation events
- API requests and responses
- console warnings and errors
- JavaScript exceptions
- screenshots
- assertions
- retries
- timeouts
- applied network rules

The app must provide deterministic probable-cause guidance for common failures using rule-based logic in the first version.

MVP diagnosis scope:

- assertion timed out because expected element did not appear
- assertion timed out because expected element did not become enabled
- navigation did not complete
- network request failed or returned an error status that blocked UI progression
- console error or uncaught exception occurred before the failed assertion
- download or popup did not occur when expected

MVP diagnosis rule requirements:

- The diagnosis system must evaluate a defined rules catalog rather than ad hoc free text.
- Each surfaced probable cause must include the triggering rule identifier, the evidence used, and the affected timeline window.
- The system may present more than one candidate cause, but candidates must be ranked and labeled by confidence tier using deterministic rules.
- If no rule matches with sufficient confidence, the UI must say that no probable cause was determined.

Minimum rule catalog for MVP:

- `assertion_blocked_by_failed_request`
- `assertion_blocked_by_console_error`
- `assertion_blocked_by_missing_dom_transition`
- `navigation_blocked_by_request_failure`
- `download_missing_without_trigger`
- `popup_missing_without_trigger`

Quality requirements:

- Rule evaluation must be reproducible for the same artifact.
- The app must preserve the underlying evidence links shown to the user.
- False certainty is worse than no diagnosis; low-confidence cases must remain labeled as such.

Acceptance criteria:

- A failed run shows the failed assertion in context with related requests and errors.
- For each supported failure type, the app either surfaces a cataloged rule match with linked evidence or explicitly reports that no cataloged cause was found.
- Reopening the same artifact yields the same diagnosis output.

### 8.10 Test Repair Assistance

The app should assist with selector repair when recorded elements are no longer found.

The repair feature must:

- compare the recorded selector with the current DOM
- search for similar accessible names
- search for similar visible text
- search for matching `data-testid` values
- identify likely renamed or moved targets
- present a suggested replacement selector with confidence and reasoning
- require user approval before changing generated code

Acceptance criteria:

- When a selector breaks, the app can present at least one candidate replacement if a plausible match exists.
- Generated code is not changed automatically without approval.

### 8.11 Evidence and Run Artifacts

Each run must be saveable as a portable artifact bundle.

The artifact bundle must have a defined on-disk structure and manifest contract so that saved runs can be reopened across compatible app versions.

Artifact storage should mirror standard Playwright project conventions wherever possible rather than inventing app-only directory layouts for exported tests.

Clarification:

- Exported Playwright test files should follow normal Playwright project conventions.
- Saved run artifacts may use an app-defined bundle layout because they contain evidence beyond standard Playwright test files.

Required artifact contents:

- `manifest.json`
- generated test source
- Playwright trace artifact when available
- console log artifact
- network capture artifact
- API capture artifact
- timeline artifact
- human-readable report artifact

Optional artifact contents:

- screenshots
- video when explicitly enabled
- DOM snapshots
- exported API collections
- fixture files used by simulation rules
- selector repair suggestions
- replay metadata
- checkpoint metadata

Minimum manifest fields:

- artifact format version
- app version
- creation timestamp
- target URL
- run identifier
- replay engine identifier and version
- redaction policy version
- checkpoint model version
- relative paths to included artifacts
- compatibility information for reopening behavior
- flags for optional missing artifacts

Suggested bundle layout:

```text
run/
  manifest.json
  generated/
    test.spec.ts
    api/
  trace/
    trace.zip
  logs/
    console.json
    timeline.json
  network/
    network.har
    api-capture.json
  media/
    screenshots/
    video/
  dom/
    snapshots/
  report/
    generated-report.html
  fixtures/
```

Acceptance criteria:

- A saved run can be shared and reopened on the same app version.
- A reopened run exposes timeline, requests, screenshots, and generated test code.
- A missing optional artifact does not prevent reopening the rest of the run.

### 8.12 Code Generation Standards

Generated Playwright code must follow a consistent style so that exported tests are maintainable and predictable.

Code generation standards:

- Generate standard TypeScript Playwright test files by default.
- Write exported UI tests as normal Playwright `*.spec.ts` files.
- Write exported API tests as normal Playwright test files or plain JSON fixtures, not as custom executable app-specific formats.
- Prefer Playwright's default file naming and project layout conventions so an existing Playwright repo can adopt generated files with minimal restructuring.
- Produce readable top-to-bottom test flow with one primary scenario per exported test unless the user explicitly groups multiple flows.
- Use descriptive test names derived from the user flow.
- Use `test.step()` for meaningful user workflow groupings such as sign-in, search, checkout, and confirmation, but do not wrap every single low-level interaction in its own step.
- Keep generated comments sparse and purposeful. Comments should explain non-obvious behavior, injected network conditions, fallback selectors, or edited steps, not restate obvious actions.
- Prefer direct `page` usage for MVP output unless the user explicitly exports to a page-object-oriented template. Do not generate page object classes by default.
- Keep imports minimal and standard.
- Emit assertions close to the action or outcome they validate unless a grouped verification block is clearer.
- Prefer Playwright locator APIs over `waitForTimeout()` or manual polling.
- Avoid fixed sleeps in generated code except when the user explicitly requests them or when reproducing timing-sensitive behavior that cannot be represented more safely.
- Use explicit waits tied to UI, network, navigation, or download conditions rather than generic delays.
- Reuse locators within a logical step when it improves readability, but do not over-abstract short flows.
- Reflect disabled steps in the editable model, but exclude them from final exported code unless the user chooses to export them as commented-out lines.

Waiting strategy requirements:

- Prefer Playwright auto-waiting behavior first.
- Use assertion-based waiting for expected UI state changes.
- Use event-based waiting for navigation, downloads, dialogs, and popup creation.
- Use request or response waits only when the network condition is part of the intended verification.
- Do not generate redundant waits immediately before Playwright actions that already auto-wait.

Structure requirements:

- Default output should be a standalone test file that runs without the app.
- Generated code should remain easy to move into an existing Playwright suite.
- The app should be able to parse and run existing Playwright `*.spec.ts` test files from a user project when they are compatible with the MVP Chromium-only execution target.
- The app should avoid requiring a custom folder layout for imported or exported Playwright tests.
- Exported network simulation rules should be represented in readable setup code when included.
- Assertion code should remain conventional Playwright assertions rather than opaque helper wrappers.

Acceptance criteria:

- Two exports of similar flows produce code with the same structural conventions.
- Generated code contains no unnecessary fixed delays in common success-path flows.
- Generated tests compile under a standard Playwright TypeScript project without app-specific runtime helpers.
- A user can drop an exported `*.spec.ts` file into an existing Playwright test directory and run it with normal Playwright tooling, using Chromium in MVP.

### 8.13 Artifact Format and Versioning

The run artifact format must be explicitly versioned to support reopening prior runs and future migration.

Versioning requirements:

- The artifact format must use its own semantic version independent from the app version.
- Backward-compatible additions should increment the minor version.
- Breaking structural changes should increment the major version.
- Patch version changes should be limited to clarifications or non-structural metadata fixes.

Compatibility requirements:

- The app must declare which artifact format versions it can open directly.
- The app must support at most the current major artifact format version and the immediately previous major artifact format version.
- The app should migrate older supported artifacts forward when safe, while preserving the original data.
- If an artifact version is unsupported, the app must fail clearly and explain whether migration is available.
- Optional files may be absent as long as the manifest declares them as optional or missing.

Migration requirements:

- Migration logic must be deterministic and version-aware.
- The original manifest version must remain recorded after migration.
- Migration failures must not silently corrupt or overwrite the source artifact.
- When migration succeeds, the app should record a migration log or metadata note.

Acceptance criteria:

- An artifact saved by one compatible version can be reopened by a newer compatible version.
- The app never claims support for more than two major artifact format versions at once.
- The app can distinguish between unsupported format versions and damaged artifact bundles.
- Version metadata is sufficient to debug reopening failures.

### 8.14 Execution and Checkpointing

Execution and replay behavior must be explicit because edited flows can invalidate prior evidence and browser state assumptions.

MVP execution model:

- The source of truth is the recorded step list plus its editable metadata.
- Browser state reached during a prior run is reusable only through explicit checkpoint rules, not through arbitrary live-state mutation.
- Replays must execute in a Playwright-controlled browser context with the same applicable network simulation rules, storage inputs, and target configuration expected by the selected checkpoint.

MVP checkpoint model:

- MVP should support both step-boundary checkpoints and selected browser-context snapshots.
- Step-boundary checkpoints identify safe resume positions after meaningful milestones such as completed navigation, completed form entry groups, post-login state, or post-modal close state.
- Browser-context snapshots may include cookies, local storage, session storage, and other Playwright-compatible persisted context state.
- MVP checkpoints do not attempt to snapshot or restore arbitrary in-memory JavaScript state, active DOM mutation history, open WebSocket conversations, service-worker transient state, or backend side effects beyond what a replay naturally reproduces.

Checkpoint validity requirements:

- A checkpoint is valid only if all prior required steps are unchanged or equivalent for replay purposes.
- A checkpoint is invalid if an edited earlier step changes authentication state, route parameters, form inputs that affect later rendering, active simulation rules, persisted browser storage, or other dependencies required by later steps.
- The app must track which earlier steps each checkpoint depends on.
- When a dependency changes, affected checkpoints must be marked stale automatically.

Replay modes:

- `Replay from start`: execute the full flow from a fresh browser context.
- `Replay up to this step`: execute from the start or nearest valid checkpoint and pause immediately before or after the selected step, as chosen by the user.
- `Replay from checkpoint`: resume from a validated checkpoint and continue forward.
- `Pause on step`: stop with the browser live and inspectable at a defined step boundary.

Recovery behavior after edits:

- If an edit affects only steps after the most recent valid checkpoint, the app should reuse that checkpoint and replay forward.
- If an edit invalidates all later checkpoints, the app must replay from the nearest remaining valid checkpoint or from the start.
- The app must clearly show which evidence is current, which evidence is stale, and which evidence is pending regeneration.
- Generated code may update immediately after edits, but network evidence, timing evidence, and diagnosis output remain provisional until replay completes.

Non-goals for MVP execution recovery:

- arbitrary hot-patching of an already-running browser session after historical edits
- guaranteed restoration of exact in-memory app state across arbitrary frameworks
- resuming from checkpoints whose correctness cannot be validated

Artifact requirements for checkpoints:

- Saved run artifacts must record checkpoint metadata sufficient to understand what resume points existed and why they were or were not valid.
- The artifact manifest must record the checkpoint model version used when the run was created.
- Reopened runs may inspect prior checkpoints, but replay from old checkpoints is required only when the stored checkpoint format is compatible with the current app version.

Acceptance criteria:

- A user can replay a flow from the start, to a selected step, or from a valid checkpoint.
- Editing step 3 in a 10-step flow does not force restart from step 1 when a later valid checkpoint is still usable.
- When a checkpoint becomes invalid because of an earlier edit, the UI marks it stale and does not offer it as a trusted resume point.
- The app never claims to restore browser state beyond the supported checkpoint model.

## 9. Non-Functional Requirements

### 9.1 Usability

- The product must be usable by QA engineers without requiring direct code editing for basic flows.
- The primary recording workflow should be understandable within one session.
- Generated artifacts and labels should use QA-friendly terminology.

### 9.2 Maintainability

- Generated tests must favor readable Playwright APIs over low-level selectors where possible.
- Exported artifacts must follow stable, documented structures.
- Internal capture formats should be versioned.
- Recorder edits should preserve intent and not force users to rerecord whole flows for minor corrections.

### 9.3 Reliability

- Recording should not silently discard supported user actions.
- The app should fail visibly when capture, export, or simulation features are unavailable.
- Reopened run artifacts should degrade gracefully if some optional files are missing.

### 9.4 Security and Privacy

- Sensitive values must be redacted by default.
- Export actions should warn when data may contain sensitive payloads.
- Local artifacts should avoid unsafe default sharing behavior.

### 9.5 Performance

- The recorder and overlay should add minimal interaction latency for typical QA workflows.
- Timeline rendering should remain usable for medium-length flows.
- Large capture payloads should not freeze the desktop UI.

## 10. MVP Scope

The MVP should include:

- Electron desktop shell
- single-window Electron workspace with an embedded browser pane
- record and replay for core browser actions
- undo, redo, and step editing for recorded flows
- replay-to-step and pause-at-step recovery for edited flows
- selector recommendation with accessibility-aware priorities
- inspector overlay with primary locator recommendation, ranked fallbacks, accessibility metadata, context flags, and related diagnostics
- assertion builder for common UI and API assertions
- CDP-backed network capture with explicit redaction rules
- export to Playwright test, JSON fixture, and one interoperable JSON collection format
- deterministic browser-session network simulation for latency, offline mode, route block, response fixture, and forced status
- unified run timeline with deterministic rule-based diagnosis for defined failure classes
- portable saved run artifact with explicit format versioning
- explicit step-boundary and browser-context checkpoint support for replay recovery
- video recording as an opt-in capture artifact

The MVP should exclude:

- multi-browser desktop embedding
- Firefox and WebKit replay in the desktop shell
- AI-generated summaries or auto-repair execution
- advanced traffic mutation coverage across all protocols
- general-purpose proxy behavior outside the managed QA browser session
- enterprise collaboration or cloud sync features

## 11. Post-MVP Candidate Scope

- Firefox and WebKit replay support where practical
- richer export formats and bidirectional import
- AI-assisted trace summaries
- AI-assisted test repair with approval workflow
- more advanced proxy fault models and lower-level transport simulation
- team artifact sharing and comparison tools
- flaky test analysis across repeated runs

## 12. Open Product Decisions

Resolved for MVP:

- Default request and response body capture must follow a safe-by-default policy:
  - capture request bodies for supported methods with immediate redaction
  - capture response bodies only for non-sensitive, small-to-medium payloads up to a defined size limit
  - do not capture large downloads, binary content, or configured sensitive endpoints by default
  - store redacted forms by default in UI and artifacts
  - require explicit user action and warning to capture full bodies for the current session or by project setting
  - warn on export when any sensitive-looking non-redacted content remains

## 13. Success Metrics

Initial success measures:

- time to create a first executable test from a manual flow
- percentage of generated selectors using preferred semantic strategies
- percentage of recorded flows successfully replayed without manual edits
- time to identify likely root cause for a failed run
- percentage of captured requests exported successfully

## 14. Acceptance for Project Start

Implementation should not begin until the following are approved:

- MVP feature set
- desktop shell choice
- capture and export boundaries
- redaction and privacy rules
- artifact structure expectations
- first-pass success metrics

## 15. Recommended Next Review Pass

After this document is reviewed, the next specification pass should define:

- system architecture
- module boundaries
- artifact schemas
- UI workflow and screen inventory
- technical risks and spike tasks
