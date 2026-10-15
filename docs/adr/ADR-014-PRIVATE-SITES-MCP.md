# ADR-014: Private XMi on OpenAI Sites

Status: implementation authorized by Owner on 2026-10-05.

## Scope and decision

The Owner requested a private cloud XMi usable directly in mobile ChatGPT, and selected OpenAI hosting. Use Sites' owner-private access policy, its provisioned MCP plugin and dispatch-authenticated identity. Do not introduce an external paid provider or custom OAuth server.

Keep the current typed MCP contracts and canonical domain services. Build an isolated Worker application under `apps/cloud-site`; copy checked source into the Site's source repository through a deterministic preparation script. Generate standalone validators from the unchanged checked-in schemas because Workers prohibit runtime code generation. Record source hashes; no Product Model or XSpec schema change.

Persist canonical snapshots, append-only events, receipts and checkpoints in D1. Run existing synchronous domain transactions on a request-scoped MemoryProjectStore and atomically compare-and-swap the persisted aggregate before returning success. Memory is never authoritative across requests. Keep export bytes in R2. Never migrate the existing local project database automatically.

The hosting boundary authenticates the user. Application routes reject absent authenticated identity; all records, approvals and downloads are bound to that Site-scoped identity. Service credentials alone do not impersonate the Owner. Browser writes additionally enforce same-origin and CSRF protection.

Stateless HTTP cannot retain an interactive form exchange. An exact pending action is therefore reviewed in an authenticated browser page, and its approval is bound to the request payload, user, expiry, project version and domain fingerprint. The internal MCP form response is accepted only from that stored Owner event; model-supplied approval flags cannot authorize changes. Consumption and canonical persistence share one D1 atomic commit. Cancellation and stale approval do not confirm anything. Interview conversation drafts retain the existing narrowly scoped PROPOSED autosave rule.

Uploaded documents remain untrusted product data. No original file is durably retained. Only bounded extracted findings, positions and digest are persisted. PDF extraction may run on the Owner's device; if used, label it as client-extracted text, not server-verified parsing. Keep confirmation required for extracted claims. Exports use the existing compiler, exact sixteen-file package, validation and readiness gates.

## Verification

Test unauthorized access, foreign identity, stale/expired/declined approval, CAS contention, replay/idempotency, restart recovery, upload limits and export validation. Run the existing core regression suite, build and lint. Verify actual Sites deployment and plugin provisioning. Mobile connection and real-use acceptance remain unverified until exercised in the Owner's ChatGPT account.
