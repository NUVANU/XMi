# 18 - Unified Delivery Modes

## 1. Purpose

XMi, XUi, XDev and XMem are separate internal engines, but a nontechnical user must not configure four products independently. The user selects **one project delivery mode** once. XMi records it in canonical Product State and exports it through XSpec. XUi and XDev inherit it. XMem adapts in the background and is never presented as a separate mode choice.

Canonical machine values:

| Code | User-facing label | User goal | XMi readiness level | XUi readiness level | XDev assurance pattern |
|---|---|---|---|---|---|
| `FAST_VALIDATION` | 快速验证 | Get a runnable prototype to test the idea | `PROTOTYPE_READY` | `PROTOTYPE_UI_READY` | Developer Agent only, with mandatory basic self-checks |
| `FAST_DEVELOPMENT` | 快速开发 | Build a reviewed MVP suitable for controlled internal/early-user testing | `BUILD_READY` | `IMPLEMENTATION_READY` | Developer Agent + independent Reviewer Agent |
| `PRODUCT_GRADE` | 产品级开发 | Produce a release candidate intended for public, paid or long-term operation | `PRODUCT_SPEC_READY` | `PRODUCT_UI_READY` | Developer Agent + Reviewer Agent + independent QA/Test Verifier |

“Speed” is a simplified user label. Internally the modes change specification depth, audit depth, evidence requirements, expected cost and the type of claim the suite may make.

## 2. One selection, not four selections

Normal suite flow:

```text
Create project
  -> XMi recommends a delivery mode in ordinary language
  -> Owner confirms once
  -> XSpec carries the confirmed mode
  -> XUi inherits it without asking again
  -> XDev inherits it and configures its Agent assurance pattern
  -> XMem applies the corresponding background retention/evidence policy
```

A standalone XMi project may select a mode directly. When XMi is launched inside a future unified X Suite shell, it must accept the suite-level mode instead of creating a second editable mode state.

## 3. Mode recommendation

XMi asks what outcome the Owner needs, not how many Agents to create.

- “I only want to see whether the idea works” -> recommend `FAST_VALIDATION`.
- “I need an MVP for a few users or customers” -> recommend `FAST_DEVELOPMENT`.
- “I will charge money, store real private data, publish publicly or operate long-term” -> recommend `PRODUCT_GRADE`.

The recommendation must include outcome, limitations, expected assurance and why the mode fits. The Owner confirms the exact mode. XMi must not infer a confirmed mode from casual wording alone.

## 4. XMi mode behavior

### 4.1 FAST_VALIDATION

Goal: produce the smallest honest XSpec that can support a prototype.

Required:

- confirmed problem, primary user, desired outcome and MVP boundary;
- one confirmed end-to-end core journey;
- P0 prototype requirements and observable prototype AC;
- explicit assumptions and exclusions;
- basic account/data/integration determination;
- contradiction and blocker checks;
- schema/reference validation;
- risk scan and any required scoped escalation resolution.

Allowed:

- visible `ASSUMED` items that do not change the core product meaning;
- deferred P2/P3 detail;
- sandboxed/stubbed external effects when explicitly recorded.

Not allowed:

- claims of production readiness;
- live high-risk behavior hidden behind a prototype label;
- unresolved product ambiguity that changes the core flow;
- falsely confirmed content.

Default assurance: primary Interviewer/Compiler plus deterministic checks. An independent Auditor is optional unless risk policy escalates a scope.

### 4.2 FAST_DEVELOPMENT

Goal: produce a reviewed XSpec for a controlled MVP/internal or early-user release.

Includes all FAST_VALIDATION requirements plus:

- complete core flows and major failure paths;
- actors, roles, data ownership and permissions;
- data entities and lifecycle decisions needed for the MVP;
- integrations and fallback behavior;
- core privacy/security requirements;
- P0/P1 requirements with testable AC;
- independent Spec Reviewer;
- Consumer import compatibility validation (XUi and XDev).

Default assurance: Interviewer/Compiler + independent Spec Reviewer.

### 4.3 PRODUCT_GRADE

Goal: produce a long-lived product contract suitable for product-grade XDev delivery.

Includes all FAST_DEVELOPMENT requirements plus:

- full material user/administrator/support flows;
- full roles and permission matrix;
- data retention, deletion, export, backup/recovery expectations;
- complete applicable failure and boundary states;
- security, privacy, reliability, performance, accessibility and maintainability NFRs;
- complete P0/P1 traceability and change-impact information;
- Independent Product Auditor;
- risk-triggered domain/privacy/security audit where applicable;
- immutable export evidence and a stricter consumer handoff gate.

Default assurance: Interviewer/Compiler + independent Auditor + conditional domain/security/privacy review.

## 5. Invariants that never become weaker

Every mode must preserve:

- explicit Owner confirmation for `CONFIRMED` state;
- provenance and status visibility;
- no silent product invention;
- no unresolved contradiction in the exported core flow;
- no schema/reference corruption;
- no secret leakage;
- no false readiness claim;
- immutable prior exports;
- clear limitations of the selected mode.

`FAST_VALIDATION` means less depth and less independent assurance. It never means lower truthfulness or lower data safety.

## 6. Risk-based scoped escalation

The project has one default mode, but a specific requirement/flow may require a higher minimum mode. Initial V0 triggers include:

- authentication or private-user isolation;
- live payments, subscriptions or refunds;
- sensitive personal data;
- account/data deletion or other destructive actions;
- administrator access to private data;
- autonomous external side effects;
- regulated/high-consequence domains.

When selected mode is below a required minimum, XMi must present one of four explicit resolutions:

1. `UPGRADE_SCOPE` - keep the project mode, but require higher assurance for the affected scope.
2. `UPGRADE_PROJECT` - raise the whole project mode.
3. `STUB_OR_SANDBOX` - use a non-live prototype behavior and record the limitation.
4. `DEFER_OR_EXCLUDE` - remove the feature from the current release.

Until the Owner confirms a valid resolution, the issue remains `BLOCKING`. XMi must never silently waive the minimum mode.

## 7. Upgrades, downgrades and gap analysis

A project may move upward without starting again:

```text
FAST_VALIDATION -> FAST_DEVELOPMENT -> PRODUCT_GRADE
```

XMi calculates a Mode Gap Report containing missing interviews, requirements, AC, NFRs, decisions, audits and XUi/XDev expectations. Existing confirmed state is reused. Only gaps are added.

A lower mode may be selected for a **new future release scope**, but it must not rewrite the historical mode, evidence or readiness claim of an already exported version. Downgrading an in-progress scope requires explicit Owner confirmation and may only reduce optional assurance, never core safety invariants or confirmed requirements.

## 8. XSpec contract

Every XSpec 0.2+ carries:

- project delivery mode;
- mode selection source;
- mode-specific readiness target;
- resolved scoped mode overrides;
- readiness target level and achieved level;
- assurance level used;
- remaining mode-gap count.

XDev may use different internal enum names, but its adapter must preserve these semantics and document the exact mapping during M0/M10 integration.

## 9. Background XMem behavior

XMem is not a user-facing fourth selection.

- `FAST_VALIDATION`: key decisions, assumptions, blockers and basic checkpoints.
- `FAST_DEVELOPMENT`: task handoff, Review results and material evidence.
- `PRODUCT_GRADE`: full relevant provenance, freshness, audit/evidence linkage and long-lived handoff history.

XMem safety, stale-evidence handling, Repo/Git/Test truth and no-Shadow-State rules remain identical in all modes.

## 10. Mode-specific readiness claims

XMi keeps transport status `READY_FOR_XDEV` for compatibility, but adds a precise readiness level:

- `PROTOTYPE_READY` for `FAST_VALIDATION`;
- `BUILD_READY` for `FAST_DEVELOPMENT`;
- `PRODUCT_SPEC_READY` for `PRODUCT_GRADE`.

A lower level must never be presented as a higher level. XDev and XUi must reject incompatible or missing delivery-mode metadata with an actionable error.
