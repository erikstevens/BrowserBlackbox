# ADR-003: SQLite Schema and Migration Strategy

## Status

Accepted

## Decision

SQLite will be introduced as a first-class local persistence backbone with explicit migrations, versioned artifact manifests, and deterministic serialization boundaries between runtime capture and stored records.

## Rationale

- Requirements already call for saved and reopened run artifacts with stale-evidence handling.
- Schema evolution must be planned before capture-heavy slices land.

## Consequences

- Domain contracts need schema version fields from day one.
- Persistence work must include migration tests across supported platforms.
