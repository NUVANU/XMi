# ADR-008 - The export gate

Status: **Accepted for V0.2 by Owner decision on 2026-09-18** ("裁 F-10").

This ADR consolidates what refusing an export actually means in XMi, because three separate decisions
have now shaped it: F-7 (export is not gated on any consumer's opinion), F-8 (the exported
scope-override floor is projected), and **F-10** (an unresolved blocking mode-risk refuses the export).
Evidence: `docs/evidence/F10-EXPORT-GATE.json`.

## 1. What the export is

`xmi_export_package` is a **package producer**, not the release gate. It writes the sixteen canonical
files to a controlled directory after trusted host-form approval, and its result is always labelled
`readiness_status: NOT_READY` while the independent Auditor gate stays deferred to M8. The release gate
itself is the three-mode gate in `docs/16` and belongs to M8/M10.

That framing is why "refuses" here means "does not write the files", and why a successful export is
never a readiness claim.

## 2. The gate (normative)

An export is written only when `package_valid` is true. These package-intrinsic conditions make it
false, and each one is reported with a code and a user action:

| Condition | Code |
|---|---|
| `xspec.json` missing or malformed | `XSPEC_JSON_INVALID` |
| `xspec.json` fails `schemas/xspec.schema.json` | `XSPEC_SCHEMA_INVALID` |
| Broken stable-id reference | `XSPEC_SCOPE_REFERENCE_NOT_FOUND` and the other reference codes |
| Missing P0/P1 acceptance coverage | `XSPEC_*` coverage codes |
| Integrity hash cannot be reproduced | `XSPEC_INTEGRITY_MISMATCH` |
| Manifest does not describe the files | `XSPEC_PACKAGE_MANIFEST_INVALID` |
| A blocking open question | `XSPEC_BLOCKING_QUESTION` |
| The solution blueprint is neither approved nor delegated | `XSPEC_BLUEPRINT_NOT_APPROVED` |
| An unsupported product profile | `XSPEC_PROFILE_UNSUPPORTED` |
| **An unresolved blocking mode-risk** | **`XSPEC_UNRESOLVED_MODE_RISK`** |

The last row is F-10 and is new on 2026-09-18. Approval is still required before the write; the gate
decides whether there is anything to approve.

## 3. What is reported, not enforced

* **Consumer compatibility (XUi, XDev).** A consumer's rejection is returned alongside the artifact and
  keeps readiness honest, but it never refuses the export (F-7).
* **Readiness status.** Every export reports `NOT_READY`; the readiness report carries the per-gate
  detail, including gates that are `DEFERRED`.
* **Scope-override floor normalisation.** Reported as `scope_override_normalisations`, never silent
  (F-8, ADR-006 section 8).

## 4. The two principles behind the split

1. **No external party may veto XMi's deliverable.** XMi must be able to produce its own package
   without XDev, or any other consumer, agreeing to anything. This is why consumer disposition is
   report-only.
2. **XMi's own undecided policy does hold the package back.** An unresolved blocking mode-risk is not
   someone else's opinion; it is XMi's own state, with an Owner-gated way to settle it. Writing a
   deliverable whose own risk policy is undecided is exactly what `docs/16` section 4 and the common
   hard gates in `docs/08` section 5 exist to prevent.

Decisions 1 and 2 are not in tension: the first is about who may veto, the second is about what XMi
knows about itself.

## 5. Why F-10 was ruled the way it was

Measured first, then decided. Before the change, a project whose only defect was an unresolved
blocking mode-risk came out `package_valid: true`, `valid: true`, and `finalizeForExport` wrote all
sixteen files — the condition was reported in the readiness report and gate 9 / gate 102 `FAIL`, but
nothing refused the write.

Four reasons decided it:

* `docs/08` section 5 lists **"no unresolved mode-risk blocker"** among the common hard gates beside
  supported-profile and valid schema/references, and both of those already refuse an export here. The
  missing member was an internal inconsistency in the same list, not a design choice.
* `docs/16` section 4 states it directly: "unresolved mode-risk override blocks export".
* Sibling behaviour already agrees: a blocking **open question** refuses the export
  (`XSPEC_BLOCKING_QUESTION`), and a blocking risk is the same class of projector-level blocker.
* It reintroduces no external dependency, so F-7 stands unchanged.

## 6. Consequences

* **The escape paths are Owner-gated and already exist**: resolve the risk with one of the four
  dispositions, or reject the item that raised it. Both are ordinary commands.
* **Editing scope retires a resolved override.** An override id is
  `MODE-OVERRIDE-<reason code>-<fingerprint of the matched scope id set>`, so adding, removing or
  rejecting an item the rule matches produces a new id, the old record no longer counts as in force,
  the risk becomes blocking again, and the export refuses until the Owner resolves the new id. This
  was true before F-10 as well; the difference is that it now stops the write instead of producing a
  package that readiness already called `NOT_READY`.
* **The gate is discoverable at the host surface**: `xmi_export_package`'s description names the
  conditions that refuse it, so a host can explain the refusal instead of retrying.
* No consumer, contract version, schema version or handoff obligation changed. `XDEV-DELIVERY-HANDOFF/1`
  is untouched.

## 7. What this does not do

* It does not gate the export on readiness in general. Gate 13 (independent audit) stays `DEFERRED`
  and readiness stays `NOT_READY`; a package with deferred gates is still exportable.
* It does not gate on the score or on any dimension in `docs/08` section 4. Gate 9 and gate 102 read
  the risk evaluation; nothing consults a score.
* It does not change F-4, F-8, F-9 or any normative table in ADR-006.

## 8. Evidence

`docs/evidence/F10-EXPORT-GATE.json`, with the independent probe `_scratch/f10_measure.ts` (eight
states, all as expected) and `tests/mode-risk-export-gate.test.ts` (six cases) on Node `24.20.0`.
Repository suite: `npm test` 128/128, build and lint exit 0. The two adjacent findings the probe
surfaced are registered separately as **F-11** and **F-12** in `docs/15`.
