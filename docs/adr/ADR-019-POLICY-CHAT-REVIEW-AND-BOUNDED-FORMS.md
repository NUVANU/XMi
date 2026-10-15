# ADR-019 — Policy chat review and bounded forms

## Authorization and cause

On 2026-10-15 the Owner reported another unusable oversized approval dialog and requested a complete correction. The screenshot concerned withdrawal of an old risk disposition. ADR-016 had moved item/blueprint actions to native chat review but explicitly left mode/risk actions on the old form path. The shared approval helper still rendered raw internal JSON when an operation supplied no readable review. This left another route to the same symptom.

## Decision

Extend existing native single-action prepare/status/commit to delivery mode selection/upgrade and risk resolution/withdrawal. Keep 26 tools. The full readable list names the operation, exact reason, effect and affected design statements; historical source objects and internal command JSON remain internal. Mode and risk operations remain independent explicit Owner events; an ordinary module reply does not authorize them.

The existing trusted UserPromptSubmit hook checks the complete displayed list and genuine next native reply. It only grants permission; canonical writes occur through existing domain services and receipts. The same one-active-review, native-session, version, fingerprint, rationale and provenance rules apply. A concurrent new reply writes an interruption marker and rolls back an in-flight single-action domain transaction. A sidecar write failure after canonical commit retains a retryable grant and recovers the original receipt without duplicating events. Old grants without the new interruption binding fail closed.

Native old mode/risk endpoints refuse new mutations with CHAT_REVIEW_REQUIRED before any form request. Generic MCP hosts retain explicit forms; cloud retains its authenticated review page. The shared approval helper requires a readable review and has no raw JSON fallback. Every desktop form uses existing lossless bounded reading pages and a separate small final approval when necessary, including project creation, file reading and export. Nothing is truncated or approved merely by acknowledging a reading page.

## Boundaries

No new tools, services, dependencies, authentication changes, public Product Model/XSpec schema changes or database migrations. XDEV-DELIVERY-HANDOFF/1 whole-ID scope semantics stay frozen. Private native sidecars gain additive policy/interruption/receipt fields. Real project state, hook trust configuration, historical approvals and source records are not edited by installation. Mixed private-test-project product scope still requires a separately reviewed disposition; this repair supplies the missing review route, not automatic bulk retirement.

This changes XMi presentation and routing, not the Codex dialog widget. Already-open dialogs and already-running MCP processes keep old code until cancelled/reloaded. Synthetic protocol tests do not prove the next real desktop review; local cloud checks do not deploy the service.
