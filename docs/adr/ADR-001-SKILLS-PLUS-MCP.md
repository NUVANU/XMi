# ADR-001 - Use Skills plus a Stateful MCP Server

Status: Accepted for V0, subject to M0 capability verification.

## Context

A Skill-only prototype is fast but cannot reliably own cross-session canonical Product Model state, deterministic validation and versioned XSpec exports.

## Decision

Use Skills for conversational workflow and MCP tools for stateful/controlled behavior.

## Consequences

- More implementation than a prompt-only demo.
- Stronger auditability and resume behavior.
- Same domain core can later support Web Studio.
- Tool-only behavior must work without UI.

## M0 verification

The capability is supported by current official sources in ../M0-CAPABILITY-REPORT.md. The creator emits a supported compatibility manifest while portable root manifests are preferred for manual packaging. Private remote testing can use Secure MCP Tunnel subject to separate approval. These findings do not authorize infrastructure or constitute Owner approval of ADR-005.
