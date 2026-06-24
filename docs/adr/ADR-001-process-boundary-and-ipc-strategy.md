# ADR-001: Process Boundary and IPC Contract Strategy

## Status

Accepted

## Decision

The product will use Electron with a strict main-process and renderer-process boundary. The renderer remains untrusted UI code and reaches privileged capabilities only through versioned, minimal preload APIs and explicit IPC handlers in the main process.

## Rationale

- This matches the requirements for a single-window desktop shell without tying browser automation to the renderer process.
- It keeps Playwright/CDP runtime ownership in the main process where failure isolation is clearer.
- It supports future expansion of capture, persistence, and export services without widening unsafe renderer access.

## Consequences

- Renderer features must be designed against explicit contracts instead of direct Node access.
- IPC payload types should be treated as product interfaces and validated at boundaries.
