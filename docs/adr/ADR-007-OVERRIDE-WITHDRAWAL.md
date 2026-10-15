# ADR-007 - Withdrawal of a confirmed mode-risk override

Status: **Accepted for V0.2 by Owner decision on 2026-09-18** ("F-9 \u505a\u5427").

Related: ADR-004 (one unified delivery mode), ADR-006 (XMi/XDev delivery handoff envelope, section 7.3
where F-9 was raised). Evidence: `docs/evidence/F9-OVERRIDE-RETRACTION.json`.

## 1. The problem this closes (F-9)

`risk_overrides` was **append-or-replace only**. `MODE_OVERRIDE_RESOLVED` replaced an entry in place,
and delivery-mode selection and upgrade inherited the whole array. Nothing removed an entry, and
rejecting the underlying items did not help either, because the compiler projected every `CONFIRMED`
override regardless of whether its finding still existed.

So a wrongly recorded override stayed in the project **permanently** and was exported. The F-8 work
made this concrete: after a mode upgrade, an override could become one that every conforming consumer
rejects, and the Owner had **no repair path at all** \u2014 re-resolution was refused (F-4 refuses a
resolution for a risk the project mode already satisfies) and no command could withdraw it.

## 2. The decision

An Owner may **withdraw** a confirmed override. Withdrawal is a **state change, never a deletion**:

* the record is kept and its `status` becomes `RETRACTED`;
* `resolution`, `minimum_mode`, `scope_ids` and `rationale` are left exactly as they were, so the
  disposition that was once made remains auditable;
* the Owner's `source_ref` is appended, so the withdrawal is attributed like every other Owner action;
* the underlying risk becomes **unresolved again**, because every reader already treats a
  non-`CONFIRMED` entry as inert.

`status` was widened from `"CONFIRMED"` to `"CONFIRMED" | "RETRACTED"` in the domain type, and
`RETRACTED` was added to the `status` enum of `$defs/riskModeOverride` in
`schemas/xmi-project.schema.json`. That is an additive widening: every previously valid document stays
valid, and the model schema stays at version `0.2.0`.

## 3. Why the alternatives were rejected

| Alternative | Why not |
|---|---|
| **Delete the entry** | Loses the audit trail of a decision the Owner actually made, and diverges from how the model already treats `ITEM_REJECTED` and `ITEM_SUPERSEDED` (retain the record, change the state). |
| **Mutate `resolution` to `UNRESOLVED`** | Rewrites the recorded value instead of adding a state. The history would no longer show what was decided, and `resolution: "UNRESOLVED"` is already loaded with a different meaning in the frozen contract. |
| **Provide no command (leave F-9 open)** | Leaves a permanent dead end reachable through a normal mode upgrade, and leaves a stale override forcing escalation or exclusion in every exported package. |
| **Relax the F-4 guard instead** | Rejected earlier and still rejected: the guard refuses a *vacuous* override (the project mode already meets that risk's floor). Withdrawal removes the need to build one, so it is the cleaner side of the same fix. |

## 4. Withdrawal is checked against the record, not against the risk finding

`MODE_OVERRIDE_RESOLVED` requires a live risk finding; `MODE_OVERRIDE_RETRACTED` deliberately does not.
It requires only that a record with that id exists and is currently `CONFIRMED`
(`MODE_OVERRIDE_NOT_FOUND` / `MODE_OVERRIDE_NOT_CONFIRMED` otherwise).

This is the whole point: the case that had no repair path is precisely the one where the finding no
longer exists \u2014 the underlying scope changed, or its items were rejected. MEASURED: after rejecting
the payment requirement the risk evaluation returns **no finding at all**, and the override is still
withdrawable and still disappears from the exported envelope.

## 5. Why this command carries no fingerprint

`ITEM_CONFIRMED`, `ITEM_REJECTED`, `DECISION_APPROVED`, `ITEM_SUPERSEDED` and the blueprint commands all
require a content fingerprint. `MODE_OVERRIDE_RESOLVED` and `DELIVERY_MODE_SELECTED` do not, and
withdrawal follows that side, for a specific reason: the effect of a withdrawal does not depend on any
value inside the record. It removes the record from force whatever the recorded `resolution`,
`minimum_mode` or `scope_ids` happen to be, so a stale view cannot produce a different outcome than the
one the Owner intended. The command therefore carries `override_id`, a mandatory `reason`, and the
Owner action, and nothing more.

## 6. Why it is a separate tool and a separate command

`xmi_item_confirm` and `xmi_item_reject` are separate tools with one intent each, and withdrawal follows
that shape (`xmi_mode_override_retract`, `intent: "RETRACT_OVERRIDE"`). Folding it into
`xmi_mode_override_resolve` would have forced `resolution` and `rationale` to become optional in an
already-published tool schema, so the schema could no longer reject a resolution request that is missing
its resolution. The MCP surface moved from 16 to 17 tools; no existing tool's schema changed.

## 7. Consequences

* **Withdrawal never weakens a project.** It cannot make a project less constrained: the risk returns to
  `BLOCKING`, hard gate 9 and mode gate 102 flip from `PASS` to `FAIL`, and `hard_gate_ready` stays
  `false`. MEASURED end to end.
* **The handoff envelope is unaffected.** `deliveryProfile()` projects only `CONFIRMED` entries, so a
  withdrawn override never reaches a consumer, and `XDEV-DELIVERY-HANDOFF/1` and its normative tables
  are unchanged. XDev needs no change.
* **Re-resolution reuses the same record.** Withdrawing and then resolving again updates the existing
  entry in place; it never creates a second one.
* **The mode view distinguishes the two counts.** `risk_override_count` now counts only entries in
  force, and `risk_override_retracted_count` reports the withdrawn ones. For every pre-existing project
  the first value is unchanged, because every entry was `CONFIRMED` before this decision.
* **`MODE_OVERRIDE_RETRACTED` joins the domain event list** in `docs/06`, and the event history keeps
  the Owner's reason for the withdrawal.

## 8. What this does not do

* It does not change the F-4 guard, R-3, the resolution disposition table, or any normative table in
  ADR-006.
* It does not let an Owner record a *new* override for a risk the project mode already satisfies; that
  remains the vacuous case F-4 refuses. Withdrawal is available in that state, re-resolution is not,
  and none is needed.
* It does not decide whether an unresolved mode-risk should stop the file write in
  `xmi_export_package`. That separate question is registered as **F-10** with measured evidence.

## 9. Evidence

`docs/evidence/F9-OVERRIDE-RETRACTION.json`, with the independent probe
`_scratch/f9_verification.ts` (29/29) and `tests/override-retraction.test.ts` (10 cases) driven entirely
through the real `ProjectService` and `XSpecService` on Node `24.20.0`. Repository suite: `npm test`
122/122, build and lint exit 0.
