# 08 - Completeness, Decision and Readiness

## 1. Completeness Engine

Completeness is profile-driven. V0 supports Web App / Micro-SaaS.

The engine checks whether the project has considered applicable areas; it must not automatically add them as confirmed features.

## 2. V0 profile areas

### Product and users

- problem and desired outcome;
- primary user;
- administrator/support actor;
- core user journey;
- MVP boundary.

### Identity and access

- anonymous versus account-based usage;
- sign-up/sign-in;
- account recovery;
- roles and permissions;
- data isolation;
- account deletion.

### Data

- entities and ownership;
- persistence versus ephemeral data;
- import/export;
- retention/deletion;
- audit/logging needs;
- backup/recovery expectations.

### Functional states

- empty state;
- invalid input;
- loading/timeout;
- unavailable integration;
- permission denied;
- duplicate operation;
- cancellation/retry;
- partial failure.

### Commercial behavior when applicable

- free/paid boundary;
- subscription start/change/cancel;
- payment failure;
- refund/support policy as product behavior;
- usage limits.

### Notifications/integrations when applicable

- provider and fallback;
- permission/consent;
- delivery failure;
- data shared externally;
- manual alternative.

### Security/privacy

- data sensitivity;
- user isolation;
- administrator access;
- secret handling;
- deletion/export;
- regulated/high-risk data flags.

### Non-functional

- supported devices/browsers;
- expected scale;
- response time expectations;
- availability/recovery;
- operating cost boundary;
- accessibility/localization.

## 3. Decision Engine

A material decision record contains:

- question;
- why it matters;
- options;
- impact on user experience, cost, complexity, privacy and XDev;
- XMi recommendation and confidence;
- Owner selection;
- linked requirements/flows;
- supersession history.

XMi may automatically apply a recommendation only when the Owner has explicitly enabled a bounded “choose low-risk defaults” policy and the decision is marked non-material. V0 should default to explicit confirmation.

## 4. Readiness dimensions

Display dimensions may include:

- vision clarity;
- user/actor clarity;
- core flow coverage;
- requirements specificity;
- acceptance testability;
- data/permission completeness;
- integration clarity;
- security/privacy completeness;
- solution feasibility;
- Consumer compatibility (XUi and XDev).

Scores are explanatory. Hard gates decide readiness.

## 5. Hard `READY_FOR_XDEV` gates

All must pass:

1. Supported product profile selected.
2. No unresolved `BLOCKING` item.
3. No unresolved contradiction involving confirmed state.
4. Core vision, target user and MVP boundary confirmed.
5. Core user journey confirmed.
6. Every P0/P1 requirement confirmed.
7. Every P0/P1 requirement has at least one valid AC.
8. Role/data isolation decisions resolved when accounts or private data exist.
9. All applicable high-risk privacy/security questions resolved.
10. Integrations have fallback/failure behavior where required.
11. Solution blueprint approved or explicitly delegated within XDev's accepted boundary.
12. Deterministic schema/reference validation passes.
13. Independent Auditor has no blocking finding.
14. Consumer import compatibility validation passes (XUi and XDev).
15. Owner confirms the export version.

## 6. Independent Auditor

The Auditor is read-only and receives:

- Product Model snapshot;
- profile rules;
- XSpec candidate;
- audit rubric.

It looks for:

- hidden assumptions presented as facts;
- contradictions;
- missing actors/permissions;
- missing states or failure paths;
- untestable requirements;
- acceptance criteria that merely repeat the requirement;
- solution mismatch;
- over-engineering;
- privacy/security omissions;
- model-dependent behavior without boundaries;
- Handoff ambiguity for XUi or XDev.

The Auditor may propose findings, not mutate state or approve readiness.

## 7. False-readiness prevention

Release evaluation must include incomplete and misleading fixtures designed to look polished. A high score cannot override a hard blocker.

## 8. Mode-specific readiness policy

Common hard gates always apply: supported profile, no core contradiction, explicit confirmation/provenance, valid schema/references, no unresolved mode-risk blocker and Owner-confirmed export.

Additional gates:

### FAST_VALIDATION -> PROTOTYPE_READY

- core vision/user/MVP/core journey confirmed;
- P0 prototype requirements have observable AC;
- all assumptions, stubs and exclusions visible;
- basic account/data/integration classification complete;
- deterministic validation passes.

Independent audit is optional unless risk escalation requires it.

### FAST_DEVELOPMENT -> BUILD_READY

- all FAST_VALIDATION gates;
- complete core flows and major failure behavior;
- roles/data ownership/isolation resolved;
- P0/P1 requirements and AC complete;
- integration fallback and core security/privacy checks;
- independent Spec Reviewer has no blocking finding;
- Consumer import validation passes (XUi and XDev).

### PRODUCT_GRADE -> PRODUCT_SPEC_READY

- all FAST_DEVELOPMENT gates;
- complete material role/data lifecycle/operations/NFR coverage;
- full P0/P1 traceability and impact data;
- independent Product Audit and applicable domain/security/privacy findings resolved;
- stricter immutable export/evidence gate.

Readiness scores remain explanatory and cannot cross mode boundaries.
