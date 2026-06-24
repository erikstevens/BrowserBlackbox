# Future Product Ideas

This document captures ideas that may inform later products or later releases.

These notes are intentionally separate from the current requirements so the MVP scope for QA Browser Shell stays clean.

## Status

- Status: Parking lot
- In scope for current `requirements.md`: No
- Last updated: 2026-06-24

## Browser QA Later-Release Ideas

### Visual locator reticles during capture or replay

Idea:

- When an element is found, draw a green reticle around it in the captured screen output.
- When an expected element is not found, but prior successful evidence exists, draw a red reticle at the last known coordinates from a previous passing run.

Why it may be useful:

- Makes selector resolution visible during recording, replay, and diagnosis.
- Helps users understand whether a failure is due to locator drift, layout movement, or total element absence.
- Fits a QA debugging workflow better than a purely decorative overlay.

Risks and caveats:

- A red reticle based on prior coordinates can mislead if the page layout changed significantly.
- Prior coordinate evidence must be labeled as stale or historical when it does not come from the current run.
- Any implementation should preserve plain Playwright export and avoid coupling generated tests to overlay behavior.

Suggested framing:

- Treat this as diagnostic evidence, not as proof that the element still exists at that location.

### Previous-versus-current screenshot comparison

Idea:

- Allow an older screenshot to be overlaid semi-transparently on top of a new screenshot.
- Also allow an opaque side-by-side comparison view.
- Potentially surface a review prompt when a meaningful percentage of the image differs.

Why it may be useful:

- Helps QA review UI drift between runs or builds.
- Could support regression review when paired with saved run artifacts.

Risks and caveats:

- This can drift toward PM or design-review tooling if not kept grounded in QA workflows.
- Raw pixel-difference thresholds are likely noisy without handling dynamic regions, timestamps, animations, and content shifts.
- It should be framed as evidence comparison for review, not automatic defect classification.

Suggested framing:

- Optional visual evidence diffing for reopened runs and regression investigation.

## Suite-Level Offshoot Ideas

### Mobile accessibility and scaling QA

Idea:

- A mobile-focused QA product that rerenders the same app screens or flows under different system settings.
- Initial focus areas:
- text size scaling
- display zoom or screen scaling
- possibly bold text, reduced motion, and related accessibility presentation settings

Why it may be useful:

- Exposes clipping, overlap, truncation, broken hierarchy, and tap-target regressions caused by OS-level accessibility or display settings.
- Keeps the focus on QA validation rather than visual design review.

Suggested product framing:

- Run the same mobile journey across multiple system scaling profiles and surface layout and interaction regressions.

Notes:

- This is not part of the current desktop browser-shell product scope.
- This is better treated as a future member of a broader QA tools suite than as a near-term extension of the current requirements.
