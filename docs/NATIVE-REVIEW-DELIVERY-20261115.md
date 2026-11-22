# Native review delivery correction — 2026-11-15

Owner-requested scope: correct verbatim native checklist delivery before continuing an existing specification. This changes presentation and adds an advisory read-only preflight; it never treats prior failed replies as applied approval.

## Changes

- Replacement issue rows display the exact complete replacement once, with issue, impact, recommendation, item/version and existing associations. Already-reviewed old text stays in canonical history instead of being repeated twice in the confirmation message. Ordinary, structured and blueprint behavior outside this case is preserved.
- A bundled Stop hook checks the current session's PENDING single/batch or module list against the latest final assistant text. It uses the same heading, exact length and SHA-256 rule as the authoritative reply check. The stable host-provided final message is preferred; existing scoped transcript reading is the fallback.
- A first mismatch requests one automatic correction before asking the Owner to confirm. A mismatch after Stop continuation ends with an explicit delivery failure rather than an unbounded loop. Exact matches and sessions without pending reviews are no-ops.
- The Stop preflight writes no grants, records, logs, product state or approval receipts. It is not approval and does not replace UserPromptSubmit. The genuine reply, exact binding, transaction, provenance, validation and export consent remain mandatory.

## Verification boundaries

Tests cover complete replacement preservation, unchanged staged commands, exact-match acceptance, repeated-character/punctuation/truncation rejection, bounded continuation, inactive sessions, scoped transcript fallback, module lists, configured CODEX_HOME and installed hook packaging. All events and grants in tests are explicitly synthetic temporary fixtures.

Before claiming active adoption, install through the existing host flow, reconnect the MCP process, and review/trust the changed plugin hook definition. A source change, cached package or synthetic test cannot prove a currently open session loaded the new code.

No provider, dependency, public tool, Product Model/XSpec schema or SQL migration is introduced. No native logs, approval stores or historical failed review records are rewritten.

Official host contract: https://learn.chatgpt.com/docs/hooks (Stop input/output and bounded continuation); https://developers.openai.com/plugins/build/plugins (plugin hook discovery and trust).
