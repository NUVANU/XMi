# 07 - XSpec Contract

## 1. Definition

XSpec is the versioned machine-readable contract between XMi and its **downstream consumers: XUi and XDev**. XMi owns the contract; consumers read it and must not silently rewrite it.

It answers:

- What product is being built?
- For whom?
- What observable behavior is required?
- What is explicitly excluded?
- What data, permissions, integrations and constraints apply?
- Which material decisions are approved?
- What technical solution constraints/recommendations were accepted?
- Is the specification ready for development?

It does not answer:

- which implementation task runs first;
- which Codex Agent writes each module;
- the detailed code architecture;
- branch/worktree strategy;
- the screen inventory, screen-state graph, design tokens, component contracts or UI acceptance criteria.

Implementation detail belongs to XDev. Design detail belongs to XUi.

## 2. Export package

```text
xspec-package/
  manifest.json
  xspec.json
  PRODUCT-VISION.md
  TARGET-USERS.md
  USER-JOURNEYS.md
  FUNCTIONAL-REQUIREMENTS.md
  NON-FUNCTIONAL-REQUIREMENTS.md
  DATA-AND-PERMISSIONS.md
  INTEGRATIONS.md
  TECHNICAL-SOLUTION-BLUEPRINT.md
  ACCEPTANCE-CRITERIA.md
  DECISIONS.md
  OUT-OF-SCOPE.md
  OPEN-QUESTIONS.md
  READINESS-REPORT.md
  CHANGELOG.md
```

`xspec.json` is canonical. Markdown files are deterministic views generated from the same model version.

## 3. Required top-level fields

- `schema_version`
- `spec_id`
- `spec_version`
- `project`
- `profile`
- `delivery_profile`
- `product_vision`
- `actors`
- `goals`
- `out_of_scope`
- `user_flows`
- `requirements`
- `acceptance_criteria`
- `data_entities`
- `permission_rules`
- `integrations`
- `non_functional_requirements`
- `decisions`
- `risks`
- `solution_blueprint`
- `readiness`
- `provenance_summary`
- `generated_at`

See `schemas/xspec.schema.json`, which is the canonical required-field contract used by runtime validation. The earlier omission of `delivery_profile` from this prose list was a documentation drift corrected in M7.

## 4. Authoritative content rule

Only `CONFIRMED` items may populate authoritative requirement and decision collections. Unresolved items appear in `open_questions` or readiness findings and prevent readiness when blocking.

## 5. Acceptance criteria quality

Each core requirement must link to at least one acceptance criterion that is:

- observable;
- specific;
- testable;
- not circular;
- explicit about failure/empty/permission behavior where relevant.

Bad:

> The assistant is intelligent and helpful.

Better:

> When a recommendation cannot be generated because the location provider is unavailable, the user sees an explanation and can manually enter a city without losing the current request.

## 6. Consumer import contract (XUi and XDev)

Before `READY_FOR_XDEV`, XMi must run an import compatibility check that verifies:

- supported schema version;
- unique stable IDs;
- all references resolve;
- no blocking open questions;
- every P0/P1 requirement has acceptance coverage;
- solution blueprint status is approved or explicitly delegated to XDev;
- no unsupported product profile claim;
- integrity fingerprint matches the export.

**The same package is imported by XUi.** XUi consumes the same immutable XSpec version; it compiles the UI contract from it and does not receive a reduced or design-specific variant. A consumer that finds the package incompatible, or that is missing required delivery-mode metadata, must reject it with an actionable error instead of proceeding (see `docs/18-UNIFIED-DELIVERY-MODES.md`).

This contract is enforced downstream: the readiness hard gates in `docs/08` section 5, requirement `XMI-FR-020` in `docs/01` and the traceability table in `docs/15` all use **consumer** compatibility, covering XUi as well as XDev.

## 7. Versioning

- Schema uses semantic versioning.
- `spec_version` increments on every export.
- Breaking schema change increments major version.
- XMi retains prior immutable exports.
- Amendments include affected requirement/AC/flow IDs.

## 8. Integrity

`manifest.json` records:

- package version;
- file list and hashes;
- canonical `xspec.json` hash;
- generated timestamp;
- XMi version;
- `xdev_min_version` or compatibility range;
- `xui_min_version` or compatibility range.

V0 may use a deterministic SHA-256 manifest. Cryptographic signing is deferred.

## 9. Delivery profile contract

XSpec schema 0.2 adds a required `delivery_profile` with project mode, selection source, readiness target and resolved scope overrides. The readiness object adds target mode, target/achieved readiness level, assurance level and mode-gap count.

Compatibility umbrella status remains `READY_FOR_XDEV`. The exact level is:

- `PROTOTYPE_READY` for `FAST_VALIDATION`;
- `BUILD_READY` for `FAST_DEVELOPMENT`;
- `PRODUCT_SPEC_READY` for `PRODUCT_GRADE`.

Consumers must not treat these levels as interchangeable.

## 0.3.0 reference records (Owner-approved 2026-10-13)

New compilation emits XSpec and manifest format 0.3.0. The package still has exactly sixteen files;
the Product Model schema and MCP envelope are unchanged. The preserved 0.2.0 schema is
schemas/xspec-v0.2.schema.json; runtime validation accepts either declared format without rewriting
old samples or previously exported bytes. A consumer supporting only 0.2.0 must reject a 0.3.0
package rather than silently relabel it. XDEV-DELIVERY-HANDOFF/1 and its scope triples are unchanged.

0.3.0 adds required reference_records. Each entry has id, kind, item_type, status, item_version,
statement and source_refs. CONFIRMED_CONSTRAINT entries have CONFIRMED status and constraint or
solution_constraint type. HISTORICAL entries have REJECTED or SUPERSEDED status and retain their
original type, version, full statement and sources. The compiler includes confirmed constraints and
archived entries directly referenced by confirmed items. Pending or unknown targets are not promoted.

Generic links may point to these reference records. Authoritative requirement, acceptance and flow
collections still contain only confirmed items; historical records are not executable requirements,
approved decisions or acceptance coverage. Typed actor_ids, requirement_ids and acceptance_criterion_ids
must resolve to the corresponding current collection. Scope overrides may target current confirmed
items or confirmed constraints; archived scope targets remain invalid. No override scope, floor or
resolution is remapped automatically. Unknown IDs, duplicate IDs and forged historical authority fail.

Confirmed constraint views appear in TECHNICAL-SOLUTION-BLUEPRINT.md; referenced history appears in
CHANGELOG.md with status and version. The full machine records remain in xspec.json and are included
in deterministic integrity and manifest hashing. The manifest must declare the same schema version.

This local compiler/conformance update does not establish real XUi/XDev runtime compatibility,
independent review, current blueprint freshness, updated scope authorization or export approval.
F-2 remains PARTIALLY_CLOSED.
