# ADR-011 — Auto-save conversation drafts during the interview

Status: Owner-approved for the local XMi trial on 2026-09-27.

## Context

The Owner reported that a host approval form after almost every interview answer slowed the interview. The prior M2 rule required a form for every write, including an agent-authored `PROPOSED` candidate that had no Owner-confirmed authority. The Owner explicitly approved automatic saving of user answers as unconfirmed drafts while retaining approval for demand confirmation, mode selection, document reads and export.

## Decision

`xmi_patch_apply` skips host form elicitation only when the candidate is `PROPOSED`, every source reference is a `conversation_turn`, and the candidate is not a solution blueprint. It saves an `agent` event, retains the exact source reference and project version/idempotency checks, and does not mark the item `CONFIRMED`. All other patch writes and all material Owner actions keep the existing form gate. Secret detection still runs before an automatic draft write.

Discovery tells the Owner when a draft was saved and groups nonblocking confirmations into a later review pass. A form remains the sole way to record an Owner confirmation; the model cannot supply one through tool arguments or chat text.

Superseded for ordinary local module items on 2026-10-09 by ADR-015: a trusted native UserPromptSubmit event may record the actual next exact reply to a version-bound complete module list. Model-supplied chat quotes remain insufficient. Other formal review gates retain their existing forms/pages.

## Consequences and limits

### Owner-approved extension — 2026-10-07

The Owner reported that saving an imported PROPOSED requirement still opened a large per-item JSON form and requested changing or removing this step. Extend the existing draft exception to candidates whose sources are all conversation_turn or document (mixed sources allowed). The candidate must still be PROPOSED and must not be a solution_blueprint. Document source positions, digests and excerpts remain unchanged; source labels do not grant Owner authority. This extension applies to the shared local/cloud MCP service. It does not adopt imported claims, execute document instructions, retain original files, or remove exact file-read/material-decision gates. Inferred, assumed and other statuses, system/tool sources and blueprints keep their gates. No schema, dependency, architecture or storage migration is introduced.

- One form per ordinary answer draft is removed. This does not remove forms for project creation, document reads, mode changes, confirmation/rejection, overrides or export.
- Source labels are supplied by the tool caller; they are provenance data, not proof of speaker identity. Drafts therefore remain visibly unconfirmed and reversible.
- No Product Model, event, SQLite or XSpec schema changes are required. Existing projects retain their state.
- The Codex desktop host must be retested for long-form visibility and the new interview pace; protocol tests alone do not establish desktop UI behavior.
