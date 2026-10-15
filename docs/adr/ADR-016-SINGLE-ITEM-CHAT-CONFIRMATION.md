# ADR-016 — Single-item confirmation through the genuine native reply

## Authorization and scope

Owner explicitly requested on 2026-10-13 that a separately reviewed item use the same visible chat list and text reply as module confirmation. This extends ADR-015 to ordinary item adoption/rejection, structured decision selection, technical blueprint proposal saving, adoption and bounded delegation. Project creation, mode/risk changes, file access and export retain their existing gates. Cloud retains its authenticated review page.

## Decision

Three additive local tools prepare a review, inspect its status and commit its native grant. Preparation validates the current project/item version and fingerprint and stages one exact domain command. It renders the entire material content in Chinese-labelled chat text, including alternatives, impacts, unresolved inputs, AI capability/model fields and delegation boundaries. Internal provenance/event JSON is not a user-facing approval form. Saving a blueprint proposal explicitly leaves it PROPOSED; adopting or delegating it requires a separate, explicitly labelled operation.

The complete returned review_text must appear in the final chat response. The trusted UserPromptSubmit hook accepts only the genuine next “确认好了”, “确认好了。” or “确认这条 <review_id>” reply after existing bounded transcript/session/latest-final/digest checks. Preparation is not authority. The hook records GRANTED with native session/turn provenance and performs no canonical replay or write for this single-item path. The MCP commit consumes only this private grant and the original command, checks version/hash bindings and invokes the existing domain service. APPLIED follows a successful domain receipt; models must read canonical state before reporting success. Repeated exact commit is idempotent. No prompt, approved flag, actor or supplied Owner event is accepted through these tools.

Separating grant capture from canonical execution avoids putting a growing event-history replay inside the ten-second hook budget. Read-only private-test-project profiling observed 1015 events and approximately 6.4 seconds for one replay. This does not guarantee all native checks finish within the host timeout.

Only one module or single-item review is active per chat. Preparing either invalidates the other. A newer human reply before single-item commit begins invalidates its unused grant. Changed canonical state refuses commit; revisions require a new exact list. Failed verification does not fall back to popups or transfer an old reply to new content. The legacy item endpoints return CHAT_REVIEW_REQUIRED for new native single-item writes. Ordinary grounded non-blueprint draft autosave remains available.

## Privacy, platform and limitations

The existing private review directory gains a `<session>.single.json` record containing bindings, hashes and the one pending canonical command; it may contain that reviewed product content while PENDING/GRANTED. Command content is cleared on application, invalidation, replacement or failure. No raw design file, prompt or full transcript is retained. Native transcript reads remain bounded and ephemeral. Original canonical data stays in its database. This explicit transient staging is the single-item extension to ADR-015's metadata-only module records.

No canonical schema/migration, new dependency, network service, authentication change or XMi/XDev boundary change. Existing native trust and current-session event delivery remain prerequisites. The installed hook definition/timeout is unchanged. The trusted-local-process limit remains: another process with the same filesystem authority can edit local records, as it can edit the existing database. Tool callers cannot create a grant through MCP arguments.

Cloud exposes none of these local native tools. Unknown transcript shapes fail closed. Isolated fixtures verify protocol/domain behavior, not actual human approval or desktop visual acceptance. A fresh loaded desktop session, complete displayed list, genuine next Owner reply, successful commit and canonical read-back remain the live acceptance test.

Observed Windows EPERM while replacing sidecars under concurrent protocol tests is handled with at most four short retries (185 ms total delay) for transient replacement-denial codes. Atomic replacement and the previous record remain intact on persistent failure; the task-owned temporary command file is cleaned. No deletion of the previous approval record or trust bypass is used.
