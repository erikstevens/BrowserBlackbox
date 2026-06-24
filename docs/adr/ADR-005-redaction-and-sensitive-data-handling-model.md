# ADR-005: Redaction and Sensitive Data Handling Model

## Status

Accepted

## Decision

Sensitive data is redacted or excluded by default before persistence and before export. Capture subsystems may observe raw data transiently only when necessary to apply deterministic redaction rules, and they must not treat full-value retention as the default.

## Rationale

- The requirements make redaction a default product behavior, not an optional hardening pass.
- Network capture, trace export, and reopened artifacts all depend on a single safe policy baseline.
