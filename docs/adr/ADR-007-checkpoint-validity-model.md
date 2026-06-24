# ADR-007: Checkpoint Validity Model

## Status

Accepted

## Decision

Checkpoint validity will be explicit, versioned, and dependency-aware. Flow edits do not mutate prior evidence in place; instead, affected checkpoints and downstream evidence are marked stale until replay regenerates them.

## Rationale

- This mirrors the requirements for stale evidence after edits.
- It avoids presenting replay shortcuts as valid when the edited step graph no longer supports them.
