# Phase 4 Slice 4 Alignment Audit

## Slice Summary

This slice adds explicit replay planning and checkpoint recovery behavior to the working-copy editor:

- shared replay-planning model for replay from start, to step, from checkpoint, and pause on step
- nearest-valid-checkpoint selection logic
- evidence transition from `stale` to `pending-regeneration` for planned replay ranges
- desktop UI for checkpoint inspection and replay-path preview

## Requirements Alignment

- Matches `requirements.md` section 8.14 by making replay behavior explicit instead of implying that old browser state can be mutated in place.
- Supports `Replay from start`, `Replay up to this step`, `Replay from checkpoint`, and `Pause on step` as explicit planning modes in the shell.
- Reuses the nearest valid checkpoint when possible and falls back to start when no trusted checkpoint exists.
- Clearly distinguishes current, stale, and pending-regeneration evidence states in the working copy.

## Scope Check

- No scope creep into unsupported arbitrary in-memory restoration.
- This slice plans and stages replay recovery but does not yet execute a full step-driven replay engine.
- Checkpoint reuse remains bounded to the current supported checkpoint model.

## Architecture Check

- Keeps replay-planning logic in shared state rather than embedding recovery rules inside React components.
- Preserves the Electron plus Playwright plus CDP MVP direction by using canonical step and checkpoint data as the replay source of truth.
- Keeps artifact and working-copy persistence compatible with the existing checkpoint model.

## Drift And Gaps

- Planned replay paths are now explicit, but actual automated execution from checkpoints is still a future Phase 4 slice.
- Browser-context snapshot restore is still represented only by checkpoint metadata, not yet by a concrete restore pipeline.
- Network evidence, diagnosis output, and timing data are not yet regenerated automatically after a planned replay.
