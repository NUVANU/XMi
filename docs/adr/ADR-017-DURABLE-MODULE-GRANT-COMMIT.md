# ADR-017 — Durable module grant followed by atomic MCP commit

Status: implemented within the Owner-approved local chat-confirmation correction. Supersedes the synchronous module-write portion of ADR-015. Preserves Owner authority, full display, the frozen Product/XDev contract and canonical schemas.

The native hook verifies the actual next reply and complete display, then persists GRANTED with exact session/database/review/text/turn/source binding. It does not replay product history or execute the canonical transaction. xmi_module_review_commit accepts routing and review binding only, requires that private grant and uses the existing atomic confirmModule service.

Transient transaction failures retain GRANTED. If the product transaction committed but sidecar save failed, an exact retry validates complete existing domain receipts and repairs the sidecar without duplicate events. New actual user replies and replacement lists expire uncommitted grants; tool status reads do not inject a human prompt. A human asking for status is a new reply.

A per-session OS-released SQLite lock serializes prepares, grants and commits; it stores no grant or product content. A competing genuine native prompt can write a nonce-only revocation marker; a pre-commit check rolls back if it changed. This marker can revoke but never authorize. Invalid bindings fail closed. Hook command and timeout are unchanged.

Legacy records still parse but records without a native grant cannot use the new commit path. Historical MATCH diagnostics are not authority. No historical recovery endpoint, live hook replay, manual authorization write or product migration is added.

One real Codex 16-item module path completed display, user reply, native grant, MCP commit and canonical read-back. This bounded evidence does not establish all failure/concurrency paths or other hosts. The public documentation records only this limited conclusion.
