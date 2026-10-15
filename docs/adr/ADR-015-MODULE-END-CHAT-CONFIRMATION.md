# ADR-015 — Module-end chat confirmation in local Codex

2026-10-15: ADR-017 supersedes the original synchronous module canonical-write path. The hook now persists a bound GRANTED record; controlled xmi_module_review_commit performs the atomic product transaction and idempotent receipt recovery. Full display, genuine next reply, expiry and canonical read-back remain mandatory.

## Status and authorization

Owner authorized on 2026-10-09: “需要确认的内容，在一个模块完成后，做一个列表，然后用户看完后，回复确认好了”. This supersedes ADR-011's form-only rule for ordinary module requirements. Structured decisions, mode, risk, blueprint, rejection, file access and export retain their existing gates.

## Decision

Continue the existing full module interview with draft autosave. At the boundary, prepare a complete numbered list of pending ordinary items carrying the same module tag. Preserve exact statements, links, tags and supersession references in the displayed list; retain original source references in canonical state. Bind the review to the project version, item versions/fingerprints and actual local launch session. Preparation has no Product Model mutation or approval argument.

A plugin-local UserPromptSubmit command receives the original native prompt, session_id and turn_id. Only the next exact “确认好了”, “确认好了。” or “确认模块 <review_id>” reply confirms this pending list. Numbered changes, ambiguous assent or another prompt invalidate it without confirmation. Changed canonical state refuses the entire batch. The domain service writes existing ITEM_CONFIRMED events, native event provenance and idempotency receipts in one SQLite transaction. No partial batch or new canonical schema is introduced.

Reply eligibility and transcript/native comparison both ignore only leading/trailing whitespace using trim(), including the extra trailing newline observed in private-test-project input_text on 2026-10-09. Internal whitespace, wording and qualifications are not normalized. Displayed product review text retains exact digest verification. See MODULE-REPLY-WHITESPACE-FIX-20261009.md; compatibility corrections do not authorize replaying a failed prior approval.

Actual native Windows path correction (2026-10-09): use realpathSync.native for both transcript and sessions directory to accept the observed \\?\ file path while retaining resolved containment/session checks. The genuine hook reported EISDIR with the previous JS resolver. Existing native host markers retain bounded reason/path-digest/byte-length/phase/error metadata plus turn/review references, never raw input, paths or transcripts. Failure context includes the reason instead of encouraging blind retries. See MODULE-NATIVE-PATH-FIX-20261009.md. No directory scanning, newest-session selection or replay authority is added.

Batch timeout correction (2026-10-10): replay and validate original history once per new module confirmation transaction. Sequential private persist calls reuse that checked state/hash, while retaining each snapshot fingerprint, expected version, actor/schema/transition validation, event hash chain and immutable receipt. No validation cache crosses a transaction boundary or becomes model-facing input. Late write failure rolls everything back. Actual private-test-project replay cost and the existing 10-second native budget motivated this correction; no timeout/trust definition is changed. See MODULE-BATCH-TIMEOUT-FIX-20261010.md.

## Platform boundary

2026-10-09 session binding correction: the Owner's private-test-project desktop run produced actual UserPromptSubmit records but its MCP process had no usable CODEX_THREAD_ID, so the first implementation never constructed an adapter. Always construct a per-request router; accept optional session_id strictly as an untrusted routing selector obtained from the current native hook context. Require the real hook record for preparation. Do not infer the current chat from newest marker files. The genuine next prompt, exact displayed review and canonical transaction remain the only adoption path. The environment is a compatibility fallback, never a mandatory platform promise or proof of authority. No model-facing approval flag/prompt is introduced.

Native plugin hooks require Owner trust of their current definition in Codex. Installation is not trust. No trust records, global hooks or XMem settings are modified. Before a genuine native event, the module tools return CHAT_CONFIRMATION_UNAVAILABLE. The Skill must retain drafts and explain setup, not return to per-row approval dialogs. No model-facing confirmation/prompt/token argument is accepted.

Official basis: [Codex hooks](https://learn.chatgpt.com/docs/hooks), [plugin building](https://developers.openai.com/plugins/build/plugins). Owner authority comes from the documented event prompt. Separately, a compatibility adapter checks that the previous assistant final response actually contained the complete exact review list: it reads at most 256 KiB header and 4 MiB tail from the event's current-session transcript, restricted to the real local sessions directory with matching session metadata. The observed response_item/message/assistant shape with phase final or final_answer is not a stable platform contract. The latter was verified in the actual private-test-project transcript on 2026-10-09; MODULE-FINAL-PHASE-FIX-20261009.md records the compatibility correction and tests. Missing, changed, truncated or unsupported logs fail closed; no heuristic fallback grants authority. The trusted-local-process assumption matches other native command hooks; hooks are not a complete security boundary against arbitrary processes running as the same operating-system user.

Cloud ChatGPT currently has no equivalent native original-prompt delivery. Its private authenticated batch-review page remains necessary. Local-only tools are excluded from the cloud catalog. Do not claim direct chat confirmation works there.

## Privacy and limits

The private sidecar directory under ~/.codex/xmi-module-reviews contains session/project bindings, versions/fingerprints, displayed-list digest/length, status, database path and turn references. It does not retain original files, statements, prompt text or full transcripts. The bounded transcript read is ephemeral and is not logged. Canonical product data remains in the original database. One active review per session; another review replaces the pending binding. Maximum 100 ordinary items and 1 MiB displayed review; no silent truncation. No completion/readiness inference follows from a successful batch.

Isolated native-event fixtures are tests, not real hook delivery or Owner approval. Actual desktop trust, inherited CODEX_THREAD_ID and read-back must be tested in a live Owner session before declaring host acceptance.

2026-10-13 extension: ADR-016 adds a separate exact single-item chat path for item/decision/blueprint review, using native grant capture followed by MCP commit. It supersedes the original form-only exception list for those actions and explicitly documents transient staged-command content. Module batches and their metadata-only records retain their existing behavior.
