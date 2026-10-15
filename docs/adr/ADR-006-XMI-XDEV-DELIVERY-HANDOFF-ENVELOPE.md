# ADR-006 - XMi to XDev Delivery Handoff Envelope (Scoped-Override Preservation)

Status: **Accepted for V0.2 by Owner decision on 2026-09-17. XDev accepted the semantics by an
Owner-relayed reply on 2026-09-17; see section 7.**

This ADR freezes the **agreement half** of F-2: the envelope version and its semantics.
When it was written it asserted no XDev acknowledgement. That acknowledgement has since arrived and
is recorded in section 7, together with the two findings it produced. It still does **not** establish
lossless compatibility. See section 6 for the resulting F-2 status.

Decision: XMi owns and freezes a versioned consumer contract, `XDEV-DELIVERY-HANDOFF/1`, whose
carrier is the **existing typed `delivery_profile` block of XSpec 0.2**. Consumers must apply the
normative enum mapping and the resolution disposition table below. A consumer that cannot preserve
`scope_ids` / `minimum_mode` / `resolution` losslessly must reject the package with an actionable
error. No new file is added to the export package, and no XDev artifact is modified.

Reason: `docs/07` section 1 states that XMi owns the XSpec contract and consumers read it.
The remaining F-2 gap is therefore not "where to put the bytes" but "what a consumer must do with
them". Freezing that semantic table is what unblocks M7 without touching XDev.

---

## 1. Why F-2 cannot be satisfied by text transport

### 1.1 Measured XDev-side facts

Read on 2026-09-17 from the neighbouring XDev working tree. These files are **not tracked by git**
there (`git ls-files --error-unmatch` returns non-zero), so they are anchored by LF-normalised
SHA-256 and mtime. Full hashes: `_scratch/xdev_evidence_anchors.json` (discussion dir).

| File | LF-normalised SHA-256 (prefix) | Bytes | CRLF |
|---|---|---|---|
| `schemas/delivery/0.1/delivery-profile-decision.schema.json` | `15afd53d5d7540ff…` | 1676 | 0 |
| `schemas/delivery/0.1/common.schema.json` | `f3f6b9ff3893a781…` | 1417 | 0 |
| `schemas/project-model/0.2/task-contract.schema.json` | `d5d629660402f2ce…` | 3456 | 0 |
| `src/planning/profile-policy.ts` | `9e80755f7e6ba1ea…` | 7981 | 0 |
| `docs/DELIVERY-PROFILES.md` | `88b8f95210b22148…` | 7442 | 0 |
| `docs/V0-EXECUTION-CONTRACT.md` | `36d4d7fa639d314a…` | 14492 | 0 |

All ten probed files share mtime `2026-09-08 22:37:44`.

Four facts, each MEASURED:

1. **XDev has no preparation for F-2 at all.** Whole-tree search (excluding `node_modules`, `.git`,
   `dist`, `build`) returns `scope_override` = **0**, `XMi` = **0**, `xmi` = **0**,
   `import_contract` = **0**. `XSpec` appears exactly once, in `docs/V0-EXECUTION-CONTRACT.md`
   line 17: "XSpec/XUiSpec 可作为可选规格来源，不要求实现专用平台" - XSpec is treated as an
   *optional* input, with no committed platform implementation.
2. **XDev formally declines to adopt XMi's mode enum names.** `docs/DELIVERY-PROFILES.md` section 1
   (version 1.0, approved by OWNER-DECISION-009 on 2026-09-05): "新概念文件中的
   `FAST_VALIDATION/FAST_DEVELOPMENT/PRODUCT_GRADE` 不作为本次新增持久化枚举".
   XDev uses `prototype` / `quick_verified` / `full_governance`.
   A raw string passthrough is therefore already excluded.
3. **The XDev carrier is structurally closed.** `delivery-profile-decision.schema.json` declares
   `additionalProperties: false`, and its `risk_factors` / `escalation_reasons` are arrays of
   `nonEmptyText` strings, built in `profile-policy.ts` as `` `${factor.category}:${factor.rationale}` ``.
   There is no structural slot for `scope_ids`, `minimum_mode` or `resolution`.
4. **XDev's own per-task profile fields do not exist yet.** `docs/DELIVERY-PROFILES.md` section 4
   requires "每项任务记录请求档位、有效档位、风险理由及所需 Gate", but
   `schemas/project-model/0.2/task-contract.schema.json` has no `requested_profile` or
   `effective_profile`; and section 6 of the same document states that the current
   `profile-policy.ts` treatment "不能直接视为符合新契约", assigning the correction to XDev's own M2.

F-2 is therefore a **two-sided** gap: XMi lacks a consumer-side carrier guarantee, and XDev lacks
the per-task profile fields its own contract already demands.

### 1.2 The concrete failure mode: text transport causes wrong escalation, not just lost detail

`src/planning/profile-policy.ts` computes the assurance floor as:

```ts
const hardRisks = risks.filter((f) => mandatoryHighRiskCategories.has(f.category));
const riskFloor = governanceReasons.length > 0 ? "full_governance"
  : input.purpose === "prototype_candidate" ? "prototype" : "quick_verified";
const effectiveProfile = belowFloor ? riskFloor : input.requested_profile;
```

`mandatoryHighRiskCategories` = `payment`, `authentication`, `privacy`, `security`,
`data_migration`, `destructive_operation`, `formal_release`, `equivalent_high_risk`.

The escalation is triggered by the **presence of a category string** in `risk_factors`. It does
**not** consider whether that risk has already been resolved.

Concrete case:

| | |
|---|---|
| Real risk | `PAYMENT_OR_FINANCIAL` (`payment`) in scope `FLOW-payment-callback` |
| XMi confirmed resolution | `STUB_OR_SANDBOX` - live payment is not on the delivered path |
| XMi project mode | `FAST_DEVELOPMENT` |
| Text-transport result | XDev sees `payment:…`, sets `escalated_reasons = ["mandatory-risk:payment"]`, returns `effective_profile = full_governance` |
| **Error** | XDev raises the **whole project** to product grade even though XMi explicitly moved live payment out of the delivered scope |

This is not a fidelity loss. It is a **compliance decision taken on a false premise**, in both
directions: `DEFER_OR_EXCLUDE` transported as text can also leave a consumer implementing a scope
that XMi has removed from the release.

### 1.3 Two of the four resolutions have no XDev expression at all

| XMi `resolution` | Semantics | XDev today |
|---|---|---|
| `UPGRADE_SCOPE` | Keep project profile; raise assurance only for the affected scope and its dependencies, shared boundaries and integrations | Semantics already stated in `DELIVERY-PROFILES.md` section 4 and acceptance scenario 4, **but no field carries it** |
| `UPGRADE_PROJECT` | Raise the whole project profile | Expressible (`requested_profile` vs `effective_profile`) |
| `STUB_OR_SANDBOX` | The risky behaviour is not on the live path: **must not** escalate, but must be recorded as a limitation | **Not expressible**; text transport escalates in the wrong direction |
| `DEFER_OR_EXCLUDE` | The scope is not in this release: **must not** escalate | **Not expressible**; same inversion |

---

## 2. Frozen contract: `XDEV-DELIVERY-HANDOFF/1`

### 2.1 Carrier

The carrier is the **existing** `delivery_profile` block of `xspec.json`, as already defined in
`schemas/xspec.schema.json` (`$defs/deliveryProfile` and `$defs/deliveryScopeOverride`). Its
`scope_overrides[]` entries are already strongly typed: `id`, `scope_ids[]`, `minimum_mode`,
`resolution`, `rationale`, with `additionalProperties: false`.

**No file is added to the export package.** `docs/07` section 2 fixes that package at 16 files, and
the release gate in `docs/16` verifies manifest hashes and the markdown/JSON match against it.
Adding a 17th file would change a published package contract, which is outside this decision.

### 2.2 Version

* The frozen contract version identifier is **`XDEV-DELIVERY-HANDOFF/1`**.
* It is carried as the **optional** property `delivery_profile.handoff_contract_version` on
  `deliveryProfile`. Absence means `"1"`.
* Rationale for optional rather than required: adding a required property is a breaking schema
  change under `docs/07` section 7 and would force XSpec `0.3.0`. Since `"1"` is the first
  contract version, absence is unambiguous.
* A consumer must **reject** any value it does not support (see R-2). A semantic change to this
  contract requires a new ADR and a version increment; it must not be introduced silently.

### 2.3 Enum mapping (normative)

A consumer must not treat the two mode vocabularies as interchangeable, and must not accept a raw
string passthrough.

| XMi mode | XMi readiness level | XMi assurance level | XDev profile |
|---|---|---|---|
| `FAST_VALIDATION` | `PROTOTYPE_READY` | `BASIC_SELF_CHECK` | `prototype` |
| `FAST_DEVELOPMENT` | `BUILD_READY` | `INDEPENDENT_SPEC_REVIEW` | `quick_verified` |
| `PRODUCT_GRADE` | `PRODUCT_SPEC_READY` | `INDEPENDENT_PRODUCT_AUDIT` | `full_governance` |

`minimum_mode` inside a scope override uses the XMi vocabulary and is mapped through the same table.

### 2.4 Resolution disposition table (normative)

For every entry of `delivery_profile.scope_overrides`, the consumer must apply:

| `resolution` | Consumer MUST | Consumer MUST NOT |
|---|---|---|
| `UPGRADE_SCOPE` | Apply assurance above the project profile to the tasks covering `scope_ids`, and to their dependencies, shared boundaries and integrations | Propagate the escalation to unrelated tasks |
| `UPGRADE_PROJECT` | Raise the project profile to `minimum_mode` | — |
| `STUB_OR_SANDBOX` | Record the limitation and treat the scope as a non-live path | Escalate because of that risk category |
| `DEFER_OR_EXCLUDE` | Remove the scope from the current release | Escalate because of that risk category; implement the scope as if in range |

This table, not the transport format, is the substance of F-2.

### 2.5 Consumer obligations

* **R-1** A consumer must not escalate on the mere presence of a risk category. Escalation follows
  the entry's `resolution` per section 2.4, and only `UPGRADE_SCOPE` / `UPGRADE_PROJECT` escalate.
* **R-2** If a consumer cannot preserve the `scope_ids` / `minimum_mode` / `resolution` triple
  losslessly, it must **reject the whole package with an actionable error**. Reducing an override to
  free text is prohibited. This is the `docs/07` section 6 and `XMI-NFR-017` obligation, and it is
  the behaviour M7 must implement and test.
* **R-3** The consumer must not lower a minimum. An override whose `minimum_mode` ranks below the
  project mode is invalid and must be rejected.
* **R-4** The consumer must report a discrepancy back to XMi/Owner rather than silently overwriting
  the selected mode.

### 2.6 Provenance

* `delivery_profile.selection_source` is **declarative only**. In XSpec 0.2 it is a string
  (`OWNER_CONFIRMED` / `IMPORTED_SUITE_POLICY`) and carries no verifiable confirmation reference.
* A consumer must **not** treat it as authenticated Owner authorisation, and must not set its own
  boolean `owner_selected` from it. This mirrors XDev's existing limitation that `owner_selected` is
  a boolean and not authenticated XMi confirmation.
* Until XMi adds a verifiable confirmation reference, consumers must treat mode selection as
  **unauthenticated provenance** and say so in their own records.

### 2.7 Risk-category asymmetry ruling

XMi's `riskReason` vocabulary has seven members (`AUTH_OR_PRIVATE_DATA`, `PAYMENT_OR_FINANCIAL`,
`SENSITIVE_DATA`, `DESTRUCTIVE_ACTION`, `ADMIN_ACCESS`, `EXTERNAL_SIDE_EFFECT`,
`REGULATED_OR_HIGH_CONSEQUENCE`). XDev's mandatory set has eight categories, two of which -
`data_migration` and `formal_release` - have no XMi counterpart, and neither is a V0 trigger in
`docs/18` section 6.

Ruling: those two categories are handled by the consumer's own default policy. XMi's V0 profile
produces no override for them, and that absence must **not** be read as "XMi has removed the risk".
XMi does not extend its category vocabulary in V0.

---

## 3. Evidence split

| Half | Owner | Evidence |
|---|---|---|
| Agreement frozen | this ADR | the normative tables in section 2 |
| XMi-side export is lossless and rejects correctly | **M7** | conformance stub plus positive/negative preservation fixtures (`XMI-FR-020`, `XMI-NFR-017`) |
| End-to-end preservation against the real XDev | **M10** | XDev import report |

M7 must not claim end-to-end consumer preservation. This split is consistent with the existing
attribution of `XMI-FR-020` as `M7, M10` in `docs/15`.

---

## 4. Consequences

1. M7 gains a frozen contract to implement against, and its `scope_overrides_export` marker may
   state the frozen contract version instead of an open precondition.
2. M7 must add the optional `handoff_contract_version` property to `deliveryProfile` in
   `schemas/xspec.schema.json`, kept in step with the sample and tests.
3. M7 must prove R-2 by fixture: a consumer that cannot preserve the triple rejects with an
   actionable error rather than degrading to text.
4. XDev is not modified. Its acknowledgement, and its adoption of per-task profile fields, remain
   its own work under its own roadmap (`DELIVERY-PROFILES.md` section 6, XDev M2).
5. Prior exports remain immutable; a later contract version must be additive and must not reword
   the disposition semantics of section 2.4 in place.

## 5. What this ADR does not do

* It does not close F-2. XDev has not acknowledged the contract and no real consumer evidence exists.
* It does not assert lossless compatibility; ADR-004's prohibition remains in force.
* It does not authorise any change to XDev.
* It does not modify XDev's 0.1 schemas, its owner-decision registry, or its roadmap.
* It does not extend XMi's risk vocabulary (section 2.7).

## 6. F-2 status change

`OPEN` → **`PARTIALLY_CLOSED`**. Closed: the contract version and its semantics are frozen
(`XDEV-DELIVERY-HANDOFF/1`, section 2). Still open: XDev acknowledgement, and end-to-end
preservation evidence at M10.

All milestone reports continue to carry F-2 with this status, and **no lossless compatibility claim
may be made while it is not fully closed**.

---

## 7. Status update, 2026-09-17: XDev accepted the semantics

### 7.1 What arrived

XDev accepted the semantics of `XDEV-DELIVERY-HANDOFF/1` and stated:

| Field | Value |
|---|---|
| `SEMANTICS` | `ACCEPTED` |
| `RUNTIME_SUPPORT` | `IMPLEMENTATION_PENDING` |
| `LOSSLESS COMPATIBILITY CLAIM` | `NOT YET` |

XDev also stated that it will not modify `schemas/delivery/0.1/**` and will adopt a new versioned
schema later, that the Task Contract will reserve `requested_profile` / `effective_profile` and a
scope policy reference, and that **XMi may continue against the frozen contract without waiting for
the XDev implementation**. The full reply, with an eleven-row mapping from each accepted constraint
to its implementation and test evidence, is recorded in
`docs/evidence/F2-XDEV-ACKNOWLEDGEMENT.json`.

### 7.2 Provenance of this acknowledgement

It is **`OWNER_RELAYED`**, not independently registered. Measured on 2026-09-17: a whole-tree search
of the XDev working tree returns `XDEV-DELIVERY-HANDOFF` = 0, `handoff_contract_version` = 0,
`scope_override` = 0 and `XMi` = 0; no `.xdev/owner-decisions` entry records it; no XDev file has an
mtime on that date; and all six files measured in section 1.1 still carry byte-identical
LF-normalised hashes and mtime `2026-09-08 22:37:44`.

This is sufficient for the purpose XDev stated - XMi may proceed - but it is **not** XDev-side
evidence of runtime behaviour and it does not close F-2.

### 7.3 Consequence: the accepted constraints became bilateral

Because XDev accepted the semantics, each accepted constraint is now an obligation XMi's own
implementation can be audited against. All eleven were audited on the pinned Node `24.20.0`
runtime with an independent probe (34 checks, 34 pass). Seven are implemented and tested, one
holds on the consumer side only, one holds by absence and two are XDev-side commitments.

The audit found one real defect and one coverage gap, neither caused by XDev:

* **F-4 (blocking for export of an affected project).** `MODE_OVERRIDE_RESOLVED` can record an
  override whose `minimum_mode` ranks below the effective project mode, because the only rank check
  in that path is `effective_mode >= finding.minimum_mode` inside the `UPGRADE_PROJECT` branch and
  `evaluateRisk` keeps emitting findings the project mode already satisfies. The compiler copies the
  override verbatim, and the consumer then rejects the whole package under R-3, so
  `finalizeForExport` throws `XSPEC_CONSUMER_REJECTED`. **R-3 is not wrong here**: the write path
  should not create an override that the contract declares invalid. The fix belongs in M5's write
  path and is left for an Owner decision rather than applied silently. Relaxing R-3 instead would
  require a contract version bump, so it is not the recommended route.
* **F-5 (coverage gap).** Four reachable consumer branches have no direct test
  (`SCOPE_OVERRIDE_TRIPLE_INCOMPLETE`, `UPGRADE_PROJECT_NOT_REFLECTED`,
  `XSPEC_SCOPE_REFERENCE_NOT_FOUND`, `XSPEC_BLOCKING_QUESTION`). The first two cannot be produced by
  the XMi compiler at all; the other two can. They should be added together with the F-4 fix rather
  than retro-fitted into the closed M7 evidence.

**Resolution (2026-09-17, same day, after an Owner direction).** Both findings are closed and a
third was raised and fixed with them; see `docs/evidence/EXPORT-INDEPENDENCE.json` and F-4/F-5/F-7 in
`docs/15-TRACEABILITY.md`.

* **F-4** is closed in the **write path**, which is where it belonged: `MODE_OVERRIDE_RESOLVED` now
  refuses a resolution for a finding the project mode already satisfies
  (`MODE_OVERRIDE_RISK_ALREADY_SATISFIED`); an equal floor is still allowed. R-3 was deliberately
  **not** relaxed, so this ADR's normative tables and the version `XDEV-DELIVERY-HANDOFF/1` are
  unchanged and XDev's acceptance still stands.
* **F-7** was raised by the same audit: export was gated on a conformance consumer's acceptance,
  which contradicted this ADR's own framing (section 3 puts end-to-end consumer preservation at
  **M10**) and misplaced the check that `docs/07` section 6 places before `READY_FOR_XDEV`. Export
  now depends only on package-intrinsic validity, and consumer compatibility is reported alongside
  the artifact. The Owner's requirement behind it: **XMi must be able to export its deliverable on
  its own, with XDev as a companion product rather than a precondition.**
* **F-5** is closed for the two reachable branches, which now have direct tests.
* **F-8** is new and **still open**: a legal override becomes below the floor if the project is
  upgraded afterwards, so the resulting package is one a conforming consumer will reject. It no
  longer blocks export. Choosing what an override's minimum means after an upgrade changes the
  meaning of confirmed data, so it waits for an Owner decision.
* **F-9** was raised by the same audit and is **CLOSED (2026-09-18) by ADR-007**, which adds an Owner
  withdrawal command for a confirmed override. This does not touch the envelope: a withdrawn override
  is filtered out before projection, so `XDEV-DELIVERY-HANDOFF/1` still carries only overrides that
  are in force, and sections 2.1-2.7 are unchanged.
* This section's finding text is kept as written; only the resolution above is new. No normative
  table in sections 2.1-2.7 was altered.

---

## 8. Projection rule: the scope-override floor is reported as the one that applies (2026-09-17)

### 8.1 The rule

When XMi projects a `scope_overrides` entry into `delivery_profile`, the exported `minimum_mode` is
**`max(recorded_minimum_mode, project_mode)`**. Every other part of the entry - `id`, `scope_ids`,
`resolution`, `rationale` - is projected verbatim, and the Product Model record is **not** mutated.

### 8.2 Why it is needed

`DELIVERY_MODE_UPGRADED` preserves `risk_overrides`. An override whose `minimum_mode` equalled the
project mode when it was resolved therefore falls **below** the floor once the project is upgraded.
Section 2.5 R-3 declares such a floor invalid, so a conforming consumer rejects the whole package.

Measured on the real write path before this rule existed: the project could still export, but every
conforming consumer rejected the package, readiness stayed `NOT_READY`, and **the Owner could not
repair it** - re-resolution is refused because the project mode already satisfies that risk, and no
command in the surface removes a recorded override. That was a permanent dead end reachable through
a normal mode upgrade.

### 8.3 What this does not do

* It does **not** relax R-3 or alter section 2.4's disposition table. R-3 stays exactly as accepted.
* It does **not** change the exported `resolution`, `scope_ids` or `rationale`. Every disposition
  semantic a consumer must honour survives unchanged, including `DEFER_OR_EXCLUDE`.
* It does **not** mutate the Product Model. The recorded floor stays as recorded; only the projection
  reports the applicable one.
* It requires **no XDev change**. XDev never receives a below-project floor, so the rule it accepted
  ("minimum_mode below the project mode is a contract inconsistency and must be rejected") never
  fires. This is an XMi-side projection rule, not a contract revision, and the version
  `XDEV-DELIVERY-HANDOFF/1` is unchanged.
* It is **not** recorded as an override value change inside the package: `docs/16` requires the human
  Markdown views to match the canonical JSON, so a Markdown-only note would break that release gate.

### 8.4 It must never be silent

Every normalisation is reported as `scope_override_normalisations` on the compile and validate
results and on the export result, naming the override, the recorded floor and the exported floor. A
verifier comparing the Product Model with an exported package is expected to find and read this
list. The rule is a pure function of the recorded floor and the project mode, so it is deterministic
and reproducible.

### 7.4 Effect on sections 5 and 6

The present-tense claims in section 5 - "XDev has not acknowledged the contract" - and in section 6 -
"still open: XDev acknowledgement" - described the state at freeze time and are **superseded** by
this section. Section 6's conclusion itself stands unchanged: **F-2 remains `PARTIALLY_CLOSED`.**

* Closed: the contract version and its semantics are frozen (section 2) **and XDev has accepted
  them**.
* Still open: XDev runtime support (`IMPLEMENTATION_PENDING`), XDev-side registration of the
  acceptance, and the M10 end-to-end preservation evidence.
* Unchanged: ADR-004's prohibition on a lossless compatibility claim remains in force while F-2 is
  not fully closed.

Development is no longer blocked by F-2. The remainder of F-2 attaches to **M10**, where XDev's
promised positive (all four resolutions) and negative (unsupported version, incomplete override,
downward minimum mode) evidence must be recovered against the real consumer. If XDev carries only a
scope policy *reference* in its Task Contract, that reference must still resolve to the full triple
for the M10 check to be meaningful.

