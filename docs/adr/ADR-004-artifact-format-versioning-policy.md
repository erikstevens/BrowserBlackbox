# ADR-004: Artifact Format Versioning Policy

## Status

Accepted

## Decision

Artifact bundles, exported manifests, and reopened run formats will carry explicit version identifiers and compatibility checks. Import paths will fail visibly on unsupported versions instead of silently coercing data.

## Rationale

- Reopened runs are a core workflow, not a convenience feature.
- Evidence freshness rules require clear knowledge of the originating flow and schema version.
