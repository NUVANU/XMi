# ADR-002 - XMi Owns Canonical Product State

Status: Accepted.

## Decision

Confirmed product intent, requirements, decisions, acceptance criteria, solution blueprint and readiness are stored in XMi's Product Model.

Chat history and XMem may provide source/context, but cannot be the sole canonical store.

## Consequences

- Cross-session reliability does not depend on transcript length.
- XMi can produce deterministic XSpec versions.
- XDev and XMem integrate through references/contracts rather than shared internal storage.
