# ADR-006: Export Architecture for Playwright and API Artifacts

## Status

Accepted

## Decision

Export logic will be isolated from runtime capture and renderer presentation. The export pipeline will transform canonical flow and capture models into standard Playwright code and reusable API artifacts without embedding app-specific runtime dependencies.

## Rationale

- Export portability is the top implementation priority.
- Separate export modules reduce the risk of leaking Chromium-shell assumptions into generated output.
