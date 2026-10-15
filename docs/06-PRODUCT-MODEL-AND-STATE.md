# 06 - Product Model and State

## 1. Canonical state

The XMi Product Model is the authoritative representation of the product definition. The transcript, generated Markdown and XMem records are supporting sources, not replacements.

## 2. Aggregate roots

### Project

- `project_id`
- name and working title
- supported profile
- lifecycle state
- current Product Model version
- current XSpec version

### Product Model

Contains:

- vision and problem statements;
- target users and actors;
- goals and exclusions;
- user journeys and flows;
- functional requirements;
- acceptance criteria;
- roles and permission rules;
- data entities and policies;
- integrations;
- non-functional requirements;
- risks;
- decisions;
- assumptions/open questions/blockers;
- technical solution blueprint;
- readiness/audit records.

## 3. Common record envelope

Every material record must include:

```json
{
  "id": "REQ-AUTH-001",
  "type": "functional_requirement",
  "statement": "Each user can access only their own private workspace data.",
  "status": "CONFIRMED",
  "source_refs": [
    {
      "type": "conversation_turn",
      "ref": "turn-0018",
      "excerpt": "Different customers must never see one another's data."
    }
  ],
  "created_at": "...",
  "updated_at": "...",
  "confirmed_by": "owner",
  "confirmed_at": "...",
  "version": 3,
  "supersedes": null,
  "tags": ["auth", "privacy"]
}
```

## 4. Stable IDs

Recommended prefixes:

- `VISION-`
- `ACTOR-`
- `GOAL-`
- `FLOW-`
- `REQ-`
- `AC-`
- `DATA-`
- `PERM-`
- `INT-`
- `NFR-`
- `DEC-`
- `RISK-`
- `OPEN-`
- `AUDIT-`

IDs are never recycled after export.

## 5. Snapshot plus event log

Use:

- a validated current snapshot for efficient reads;
- an append-only event log for auditability and recovery.

Example events:

- `PROJECT_CREATED`
- `IDEA_CAPTURED`
- `CANDIDATE_EXTRACTED`
- `ITEM_CONFIRMED`
- `ITEM_REJECTED`
- `DECISION_APPROVED`
- `ITEM_SUPERSEDED`
- `CONTRADICTION_RAISED`
- `AUDIT_COMPLETED`
- `READINESS_EVALUATED`
- `XSPEC_COMPILED`

## 6. Project lifecycle

```text
DRAFT
 -> DISCOVERY
 -> CLARIFICATION
 -> SOLUTION_REVIEW
 -> AUDIT
 -> NOT_READY | READY_FOR_XDEV
 -> EXPORTED
 -> AMENDMENT_REQUIRED
 -> ARCHIVED
```

`READY_FOR_XDEV` is derived and may be revoked if a confirmed input changes.

## 7. Mutation rules

- Domain service validates every transition.
- Mutation uses optimistic version checking.
- Tool retries are idempotent.
- A stale client receives a conflict response and current version.
- Export freezes a version but does not lock future amendments.
- An amendment produces a new XSpec version and change summary.

## 8. Storage boundary

The model sees typed commands and structured views, not database credentials or arbitrary query access.

## 9. XMem boundary

XMem may later retain interview execution continuity or context references, but:

- confirmed decisions live in XMi;
- XSpec lives in XMi;
- readiness lives in XMi;
- XMem must reference, not duplicate, authoritative Product Model content.

## 10. Delivery policy state

Project State adds a canonical `delivery_policy` containing:

- requested and effective project mode;
- selection source and timestamp;
- readiness target;
- append-only mode history;
- risk-based scoped overrides and their resolutions.

New domain events include `DELIVERY_MODE_RECOMMENDED`, `DELIVERY_MODE_SELECTED`, `MODE_OVERRIDE_RAISED`, `MODE_OVERRIDE_RESOLVED`, `MODE_OVERRIDE_RETRACTED`, `DELIVERY_MODE_UPGRADED`, and `MODE_GAP_EVALUATED`.

A confirmed override can be **withdrawn** (`MODE_OVERRIDE_RETRACTED`, ADR-007). Withdrawal is a state
change, never a deletion: the record and the resolution it once carried are kept and marked
`RETRACTED`, while the underlying risk becomes unresolved again, so the mode-risk gates fail until the
Owner resolves it afresh. Only the status changes, which is why every reader that already filtered on
`CONFIRMED` needed no change.

The existing lifecycle may continue to use the umbrella state `READY_FOR_XDEV`; the readiness report must additionally identify the precise achieved level. A mode change can revoke readiness and return the project to clarification/audit without deleting prior exports.

### M1 representation clarification

Before explicit mode selection, local draft state uses delivery_policy: null, never a fabricated OWNER_CONFIRMED default. Null is prohibited in ready/exported states. The XSpec export contract remains non-null. An optional xspec_id reserves a stable identity without creating an export. See M1-DOMAIN-STORE.md for the bounded legacy import and confirmation-evidence contract.
