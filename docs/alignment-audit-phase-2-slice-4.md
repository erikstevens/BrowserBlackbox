# Phase 2 Slice 4 Alignment Audit

## Requirements Alignment

- Persistence now separates editable working-copy flow state from reopened artifact projections at the schema and repository layer.
- Reopened artifact projections carry their source bundle path and artifact format version, which supports clearer compatibility handling and later migration work.
- The distinction is enforced in persistence instead of relying on implicit caller behavior, which reduces the risk of mixing replayable live workspace state with read-mostly reopened evidence.

## Scope Check

- This slice does not yet wire reopened projections into renderer workflows or UI labels.
- No runtime replay behavior was added.
- The distinction is represented in SQLite schema, repository mapping, and snapshot serialization only.

## Assumptions and Gaps

- A reopened artifact projection is still stored as the same canonical snapshot shape, with projection metadata distinguishing it from a working copy.
- Projection migration or merge workflows are not implemented yet.
- The app still needs future UI/runtime logic to decide when a reopened projection should be cloned back into a working copy for editing.
