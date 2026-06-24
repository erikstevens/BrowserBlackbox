# Phase 3 Slice 4 Alignment Audit

## Requirements Alignment

- The embedded browser pane remains the single in-app browsing surface, but runtime control is now routed back through Playwright rather than relying on Electron `webContents.debugger` as the primary control path.
- CDP remains part of the runtime model through a Playwright-created CDP session, which preserves the hybrid Playwright-plus-CDP direction required by `requirements.md`.
- The renderer still talks to the runtime only through preload IPC, so the product shell and managed browser target remain logically separated.

## Scope Check

- This slice restores Playwright-aligned session ownership and launch/navigation control for the embedded Chromium target.
- This slice does not yet add recorder event ingestion, network timeline persistence, selector capture, or replay editing behavior.
- Tailwind pipeline stabilization is still unresolved and remains outside the runtime scope of this slice.

## Assumptions and Gaps

- The current attachment strategy resolves the embedded Playwright page by matching the existing embedded-pane URL exposed through the local CDP endpoint. That is acceptable for the current single-pane MVP shell, but it should be hardened if additional app-owned Chromium targets are introduced later.
- The app now enables a fixed localhost remote-debugging endpoint for Electron Chromium. If future packaging or multi-instance behavior makes that port strategy too brittle, endpoint discovery should move to a dynamically allocated port with explicit handoff into the runtime manager.
- CDP enablement still stops at baseline `Page` and `Network` domains. Event streaming, redaction-aware capture, and correlation are still pending later Phase 3 work.
