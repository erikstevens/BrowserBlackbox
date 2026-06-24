# ADR-002: Browser Runtime Ownership Model

## Status

Accepted

## Decision

The managed Playwright-controlled Chromium target will be owned by a dedicated runtime service in the Electron main process. The shell UI renderer will observe state and issue commands, but it will not host automation logic.

## Rationale

- This preserves the product requirement that the app UI and automated browser target remain logically separate.
- It keeps generated artifacts aligned with standard Playwright execution.
- It creates a clean seam for CDP session coordination and future crash recovery.
