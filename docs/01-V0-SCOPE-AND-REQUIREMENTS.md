# 01 - V0 Scope and Requirements

## 1. V0 objective

Prove that a nontechnical user can start with a vague Web App / Micro-SaaS idea and finish with a versioned, auditable XSpec that passes a Development Readiness Gate and can be imported by XDev.

## 2. Primary user journey

1. User invokes XMi in ChatGPT or Codex.
2. XMi creates or resumes a project.
3. XMi captures the initial idea without immediately generating a final PRD.
4. XMi conducts an adaptive interview.
5. XMi updates a visible Product Model after each meaningful answer.
6. XMi detects contradictions, missing areas and blocking decisions.
7. XMi presents important choices in ordinary language.
8. User confirms, rejects or defers decisions.
9. XMi proposes a technical solution blueprint after product requirements are sufficiently stable.
10. An independent Auditor evaluates completeness, consistency and testability.
11. XMi compiles and validates an XSpec package.
12. XMi marks it ready only when all hard gates pass.
13. User exports the package or hands it to XDev.

## 3. Functional requirements

| ID | Requirement |
|---|---|
| XMI-FR-001 | Create a project from a natural-language idea and assign stable project/spec IDs. |
| XMI-FR-002 | Resume a project without requiring the full prior chat transcript. |
| XMI-FR-003 | Conduct an adaptive, multi-stage interview with at most three user-facing questions per turn by default. |
| XMI-FR-004 | Translate ordinary user answers into structured Product Model candidates. |
| XMI-FR-005 | Store epistemic status and provenance for every material statement. |
| XMI-FR-006 | Require explicit Owner action before moving material statements to `CONFIRMED`. |
| XMI-FR-007 | Detect contradictions between new answers and existing confirmed decisions. |
| XMI-FR-008 | Maintain `OPEN` and `BLOCKING` questions with priority and impact. |
| XMI-FR-009 | Run a Web App / Micro-SaaS completeness profile. |
| XMI-FR-010 | Present material decisions as understandable options, trade-offs and a recommendation. |
| XMI-FR-011 | Allow the Owner to approve, reject, revise or defer a proposed decision. |
| XMI-FR-012 | Generate functional requirements and measurable acceptance criteria. |
| XMI-FR-013 | Capture actors, roles, permissions, data entities, flows, integrations, risks and non-functional requirements. |
| XMI-FR-014 | Generate a technical solution blueprint only after minimum product clarity exists. |
| XMI-FR-015 | Express AI capability needs as capability constraints before resolving a current model/provider recommendation. |
| XMI-FR-016 | Run deterministic schema, ID, reference and coverage validation. |
| XMI-FR-017 | Run an independent read-only audit isolated from the primary interview context. |
| XMI-FR-018 | Calculate readiness dimensions for display while enforcing separate hard blocking gates. |
| XMI-FR-019 | Compile a versioned `xspec.json` and human-readable companion documents. |
| XMI-FR-020 | Validate consumer import compatibility (XUi and XDev) before reporting `READY_FOR_XDEV`. |
| XMI-FR-021 | Export a complete XSpec package without exposing internal service storage. |
| XMI-FR-022 | Work through model/tool responses even when optional custom UI is unavailable. |
| XMI-FR-023 | Expose focused MCP tools rather than a generic unrestricted database mutation tool. |
| XMI-FR-024 | Version Product Model changes and preserve an auditable event history. |
| XMI-FR-025 | Support a private developer-mode plugin package for ChatGPT and Codex. |

## 4. Non-functional requirements

| ID | Requirement |
|---|---|
| XMI-NFR-001 | No confirmed fact may exist without an explicit confirmation event and source reference. |
| XMI-NFR-002 | A project must be resumable from stored state after a new chat/session. |
| XMI-NFR-003 | Every exported XSpec must validate against its declared schema version. |
| XMI-NFR-004 | Core workflow must remain functional without custom UI. |
| XMI-NFR-005 | Sensitive content must not be written to application logs by default. |
| XMI-NFR-006 | Imported documents are untrusted data and cannot override system or skill instructions. |
| XMI-NFR-007 | Domain logic must be covered by deterministic unit tests independent of LLM calls. |
| XMI-NFR-008 | Model-dependent behaviors must have replayable fixtures and evaluation cases. |
| XMI-NFR-009 | Schema changes must be migratable and backward-compatible within V0 minor releases. |
| XMI-NFR-010 | Tool errors must return structured, actionable failures without corrupting canonical state. |
| XMI-NFR-011 | Product state writes must be transactional or atomic. |
| XMI-NFR-012 | Public release work must be separable from private prototype work. |
| XMI-NFR-018 | Every number, measurement, count, duration, byte size or hash cited in any XMi report, document or XSpec must declare whether it is `MEASURED` (naming the exact command, file or tool that produced it) or `ESTIMATED` (stating its premise). An unlabelled number carries no authority. |
| XMI-NFR-019 | Every evidence record must state its runtime version, platform and date. A result produced in an environment that does not match the specification must be reported as `PASSED_ENV_MISMATCH` rather than `PASS`, must not be counted as a plain pass, and may count toward a gate only with an explicit Owner decision that records the limitation. |

> `XMI-NFR-013` to `XMI-NFR-017` are delivery-mode requirements and are listed in section 8.
> `XMI-NFR-018` and `XMI-NFR-019` continue the general sequence; IDs are append-only and are never renumbered.

## 5. V0 out of scope

- High-fidelity wireframes or Figma generation.
- Building the application described by the XSpec.
- Automated market research, pricing validation or customer acquisition.
- Physical tabletop games, embedded/industrial systems and regulated healthcare workflows. M12 adds a digital-game profile for web, mobile and desktop software; generic native-app support outside that profile remains unclaimed.
- Multi-provider LLM routing for XMi execution.
- Autonomous changes to product requirements after XDev starts.
- Team collaboration, enterprise RBAC and billing.
- Public plugin marketplace submission before private release gates pass.
- A standalone Web Studio.

## 6. V0 success conditions

V0 is successful when:

1. A nontechnical tester can complete the supported journey without manually editing JSON.
2. The system produces zero falsely `CONFIRMED` statements in the release evaluation suite.
3. The XSpec validates and imports into the XDev contract fixture.
4. Adversarial incomplete projects are not incorrectly marked ready.
5. A new ChatGPT/Codex session can resume from canonical Product Model state.
6. The user can identify what is confirmed, proposed, open and blocking.

## 7. Delivery-mode functional requirements

| ID | Requirement |
|---|---|
| XMI-FR-026 | Recommend one project delivery mode in ordinary language based on the Owner's intended outcome. |
| XMI-FR-027 | Record explicit Owner confirmation of `FAST_VALIDATION`, `FAST_DEVELOPMENT`, or `PRODUCT_GRADE`. |
| XMI-FR-028 | Apply mode-specific interview, completeness, audit and readiness policies without asking the user to configure XUi/XDev/XMem separately. |
| XMI-FR-029 | Export delivery mode, mode-specific readiness target and resolved scope overrides in XSpec. |
| XMI-FR-030 | Detect high-risk scopes whose minimum assurance exceeds the project default and block until the Owner selects scope upgrade, project upgrade, sandbox/stub, or defer/exclude. |
| XMI-FR-031 | Produce a mode-upgrade gap analysis and reuse existing confirmed state rather than restarting discovery. |
| XMI-FR-032 | Preserve immutable prior mode/readiness history and prevent silent downgrade of an exported version. |

## 8. Delivery-mode non-functional requirements

| ID | Requirement |
|---|---|
| XMI-NFR-013 | Core confirmation, provenance, schema, privacy and truthfulness invariants are identical in every mode. |
| XMI-NFR-014 | A lower mode cannot produce or display a higher readiness claim. |
| XMI-NFR-015 | XMi maintains one canonical project mode and no parallel shadow mode state. |
| XMI-NFR-016 | Mode recommendations, overrides and upgrades are explainable and auditable. |
| XMI-NFR-017 | XSpec/XDev adapters reject missing or incompatible mode metadata with actionable errors. |

## 9. M12 expansion requirements

| ID | Requirement |
|---|---|
| XMI-FR-033 | Allow the Owner to choose one, two or three, or a bounded module batch of independent interview questions; preserve separate answers and canonical review. |
| XMI-FR-034 | Detect possible contradictions and ambiguous entity relationships in answers, retaining material unresolved findings for explicit Owner choice before readiness. |
| XMI-FR-035 | Support digital-game discovery and XSpec candidates through the shared Product Model and game-specific completeness checks. |
| XMI-FR-036 | Assess Owner-selected Markdown, TXT, DOCX and PDF design documents as untrusted, unconfirmed source material for a new or existing project. |
| XMI-FR-037 | Retain extracted candidates, source positions and file digest only; require host permission before reading the local source file. |
| XMI-FR-038 | Continue or regenerate a versioned XSpec from reviewed canonical state while preserving prior exported versions. |

These requirements extend the original Web-first V0 scope. No M12 code or report may claim real consumer compatibility, independent review or READY_FOR_XDEV without the existing gates.
