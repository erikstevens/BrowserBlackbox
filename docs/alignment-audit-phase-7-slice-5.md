## Phase 7 Slice 5 Alignment Audit

This slice closes the remaining Phase 7 network-evidence gaps around protocol shape and request-state metadata:

- the runtime now tracks logical request protocol as `http` or `websocket`
- repeated failed requests now propagate retry counts into subsequent attempts
- blocked-request failures now surface explicit blocked metadata through the runtime event stream and shared evidence ledger
- WebSocket handshake traffic now appears as canonical captured request/response evidence with protocol `websocket`
- the request-detail lane now exposes protocol, retry count, and blocked state for captured requests

Requirements alignment:

- Directly advances `requirements.md` section 8.5 by covering WebSocket traffic in the MVP capture model and by carrying retry/block state into the app when Chromium/CDP exposes those conditions.
- Keeps captured requests inspectable alongside UI actions, with the request-detail UI now exposing the additional state required by the requirements.
- Preserves the safe-capture direction established in earlier Phase 7 slices because WebSocket handshake headers still flow through the same redaction policy before reaching UI or persistence.

Scope and non-goals:

- This slice does not attempt full per-frame WebSocket transcript storage or replay; it captures handshake-level evidence plus frame events in the runtime stream.
- The retry model is deterministic but intentionally conservative: retries are inferred from repeated attempts after recorded failures, not from every possible server-side retry topology.
- No scope creep into broader API export formats, simulation-rule breadth, or additional diagnosis catalog work.

Architecture fit:

- Retry and blocked-state inference remain inside `packages/runtime-browser`, which is the right boundary because those semantics depend on CDP request lifecycle events.
- `packages/ui-state` continues to derive canonical request evidence from runtime events without introducing a renderer-specific network model.
- Renderer changes remain display-only and consume the already-normalized request model.

Drift and requirement gaps:

- The canonical `RequestResponseCapture.protocol` field now consistently means logical protocol (`http` vs `websocket`), not transport-level wire detail like `h2`. If transport flavor becomes product-relevant later, it should be modeled separately rather than overloading `protocol`.
- WebSocket frame payloads are not yet stored as a first-class transcript inside the canonical capture model, so this slice should be understood as handshake coverage plus runtime event visibility rather than complete socket-session reconstruction.
