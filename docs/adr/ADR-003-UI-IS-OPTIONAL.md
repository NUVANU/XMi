# ADR-003 - Custom UI Is Optional

Status: Accepted.

## Decision

Implement and test all MCP tools without UI before adding Product Map, Decision Card or Readiness components.

## Consequences

- Codex CLI and clients without UI remain supported.
- UI cannot bypass domain validation.
- V0 may ship private alpha without custom UI if core workflow is sound.
