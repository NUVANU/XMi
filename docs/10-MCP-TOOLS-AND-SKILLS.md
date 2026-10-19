# 10 - MCP Tools and Skills

2026-10-18 consolidated native finalization: xmi_item_review_prepare accepts either the existing request shape or top-level project_id/expected_version/session_id plus requests (1-50 singleReviewRequest values bound to that base version). Never provide both shapes, authority flags or mixed project directories. Keep one target action per list, put a mode change first, and preflight dependent actions; stale blueprints cannot be rebased silently. Display the complete returned 收尾确认清单 once. One actual next reply 确认好了 then one existing xmi_item_review_commit applies the batch atomically. Status remains read-only. Counts stay28 native/26 generic; generic/cloud hosts without the native bridge do not acquire a batch approval bypass. See FINALIZATION-BATCH-CONFIRMATION-20261018.md.

2026-10-18 local project storage: new local creation requires an explicit verified project_directory, defaulted by the host to the user project root, never MCP cwd. Other project tools accept the same locator for another host or moved directory; project_id remains canonical identity. storage reports canonical_version and CURRENT/STALE derived context, never automatic confirmation. Native commit adapters use the selected project database. Existing shared projects remain available without a locator. Optional recovery command: node tools/project-context.mjs --project-dir <absolute-project-directory>. Tool count stays28 native/26 generic. See ADR-023 and PROJECT-LOCAL-DESIGN-DATA-20261018.md.

2026-10-17 current default (supersedes the historical full-coverage/pilot flow below): native xmi_spec_review_start now prepares optional readable-document advice, with optional interview_module statements and direct incoming/outgoing settings. Its response is XMI-DOCUMENT-REVIEW/1: issues, supplied-document quotes, impact/suggestions, questions and notes. No covered-ID/file/scope enumeration is required. Malformed or ungrounded individual opinions are separated; grounded opinions survive extra unresolved references. The actual main entry uses DocumentReviewRunner; old keys retain their historical strict contract. Advice cannot grant product confirmation, readiness or formal assurance. Native catalog stays28/generic26. See LIGHT-DOCUMENT-REVIEW-20261017.md.

2026-10-17 focused pilot V2: the local planning CLI now prepares versioned core/direct-endpoint packets with exact document original intervals and pending dependency IDs. Root inventories remain complete and unreviewed portions remain explicit. A smaller lossless JSON_TEXT transport is used when dictionary overhead is larger. This is still not a new module-review MCP tool or automatic scheduler; V2 subset responses cannot be submitted to the existing full-review endpoint. See HOST-AGENT-FOCUSED-PILOT-20261017.md.

2026-10-17 module preflight is a local planning-only CLI (`node tools/spec-review-preflight.mjs --bundle-file <frozen.json> --module <module:tag> --out <new-directory>`), not a new MCP tool or automatic scheduler. It preserves full record/history/membership/scope and byte-range inventories, evaluates both bounded pilot packets and stops before any Agent when either exceeds limits. Exact pilot responses are a separate PILOT_ONLY schema and cannot be submitted to existing complete-review tools as full coverage. The actual private-test-project candidate is blocked at preflight (7/18 pages vs four allowed). See HOST-AGENT-MODULE-PREFLIGHT-20261017.md; default tool catalogs remain unchanged.

2026-10-17 transport correction: new native host_job messages read lossless dictionary pages in order (at most 64, at most 32 KiB each), one separate exact functions.exec/exec_command per page, no retries. Optional versioned transport binding preserves legacy frozen jobs; no new tool or caller response/Agent/path override is added. The collector checks original-byte reconstruction, native and outer delivery, no compaction and observed context headroom. INCOMPLETE delivery is distinct from UNVERIFIED provenance; neither grants coverage. Full-size private-test-project engineering host validation remains incomplete (1/32 pages), despite 366 passing tests. See HOST-AGENT-PAGED-TRANSPORT-20261017.md.

2026-10-16 Owner-approved narrow follow-up: ADR-022-NATIVE-HOST-AGENT-SPEC-REVIEW.md adds optional real local Codex host-Agent content review using the existing start/status names. Native provenance and full material/coverage are checked; inherited permissions are not effective isolation and cannot automatically satisfy legacy formal assurance. Local native catalog: 28 tools; generic catalog: 26. This supersedes the earlier blanket deferral only for this one route; ordinary interview/confirmation/XSpec export remains the core scope. No external provider, authentication change, XSpec migration, product mutation, cloud deployment or publication is included.

2026-10-16 current scope: ADR-021-XSPEC-CORE-SCOPE-CONVERGENCE.md supersedes automatic independent-review enablement work. XMi ends at module interview, genuine Owner confirmation and validated XSpec delivery. External review is optional for compilation/candidate export; phase two is deferred. The default catalog is 26 tools, with the two prototype review tools retained only for compatibility/internal tests. Formal assurance gates and all risk/confirmation/schema checks remain truthful; a valid NOT_READY candidate can be exported with exact Owner consent under ADR-008. No new provider, protocol, credentials, costs, egress, child sessions or evidence system is to be developed as part of this continuation.

## 1. Tool design principles

- Tools represent recognizable user goals.
- Inputs/outputs are typed and versioned.
- No generic arbitrary database update tool.
- Mutations are idempotent and require expected project version.
- Read-only, open-world and destructive annotations must be explicit using the current platform schema.
- UI resources are optional and never contain hidden business logic.

## 2. Proposed V0 MCP tools

### Independent specification review, phase one (2026-10-16)

`xmi_spec_review_start` takes only project_id, expected_version, idempotency_key and the existing envelope version. It is a write-capable, non-destructive, idempotent tool; production returns a versioned `XMI-SPEC-REVIEW/2` UNAVAILABLE result without consent/persistence/network because no live runtime is configured. Internal synthetic injection alone supports bounded Owner consent and an independent test store; every such record is TEST_ONLY and ineligible. `xmi_spec_review_status` is read-only and accepts project/run plus offset/limit (at most20). It reports total findings, remaining page, item/document/scoped coverage and unavailability/staleness without treating coverage as proof of understanding.

Both tools reject extra reviewer/PASS/isolation/credentials/endpoint/protocol fields. Their phase-one openWorld hint is false because no external execution path exists; enabling a real remote route requires separately approved implementation and metadata changes. Existing audit/readiness/export output contracts stay unchanged. See INDEPENDENT-SPEC-REVIEW-PHASE1-20261016.md.

Exact names may be adjusted in M0 for metadata quality, but semantics are normative.

### `xmi_project_create`

Creates a project and captures the initial idea.

Input:

- title optional;
- initial idea;
- requested profile optional;
- source metadata.

Output:

- project ID;
- lifecycle state;
- next recommended action.

Mutation: yes. Destructive: no.

### `xmi_project_get`

Returns a bounded Product Model view, stage, blockers, decisions and readiness summary.

Read-only.

### `xmi_project_resume`

Returns a resume packet for a new chat/session: current state, recent confirmed changes, unresolved blockers and next high-value questions.

Read-only.

### `xmi_answer_analyze`

Analyzes a user answer and returns a proposed patch plus detected conflicts. It does not confirm material items.

Read-only with respect to canonical state.

### `xmi_patch_apply`

Applies a validated non-confirmation patch such as creating candidates/open questions. Requires expected project version and idempotency key.

Mutation: yes.

### `xmi_item_confirm`

Explicitly confirms a fingerprinted item/version based on Owner action.

Mutation: yes; requires explicit confirmation intent.

### `xmi_item_reject`

Rejects/excludes a proposed item and records rationale.

Mutation: yes.

### `xmi_questions_next`

Calculates the next one to three questions and their reasons.

Read-only.

### `xmi_decision_prepare`

Builds an option comparison for a material decision.

Read-only.

### `xmi_decision_approve`

Records the Owner's selected option and affected items.

Mutation: yes; explicit confirmation.

### `xmi_completeness_run`

Runs deterministic profile checks and produces missing-area findings.

Read-only; may store an audit run through a separate mutation path.

### `xmi_solution_propose`

Generates a structured solution blueprint proposal from confirmed inputs.

Read-only proposal.

### `xmi_audit_run`

Runs isolated deterministic and LLM audit steps. It cannot mutate Product Model records.

Read-only against Product Model; stores immutable audit result.

### `xmi_readiness_evaluate`

Evaluates dimensions and hard gates.

Read-only; stores immutable readiness result.

### `xmi_xspec_compile`

Compiles an immutable XSpec candidate from one Product Model version.

Mutation only in the sense of creating a new export artifact; no Product Model rewrite.

### `xmi_xspec_validate`

Runs schema, reference, coverage and consumer compatibility validation (XUi and XDev).

Read-only.

### `xmi_export_package`

Exports the validated package to a controlled location or returns a file artifact.

Must validate destination and avoid overwriting without explicit approval.

The export refuses rather than warns. As of ADR-008 the package-intrinsic conditions that refuse it
are: invalid schema, broken references, missing P0/P1 acceptance coverage, a non-reproducible
integrity hash, a broken manifest, a blocking open question, an unapproved solution blueprint, an
unsupported profile, and — since F-10 — an **unresolved blocking mode-risk**. Consumer compatibility
is reported alongside the artifact and never refuses it (F-7).

## 3. Structured errors

Every tool error uses:

```json
{
  "code": "PROJECT_VERSION_CONFLICT",
  "message": "The project changed after this view was generated.",
  "retryable": true,
  "details": {},
  "user_action": "Refresh the project state and retry the confirmation."
}
```

## 4. Skills

### `xmi-discovery`

Responsibilities:

- recognize idea-to-spec requests;
- explain the XMi process;
- create/resume a project;
- ask bounded high-value questions;
- call analysis and state tools;
- request explicit confirmation;
- avoid premature document generation.

### `xmi-audit-export`

Responsibilities:

- run completeness and independent audit;
- explain blocking findings;
- guide final decisions;
- compile/validate XSpec;
- obtain export confirmation;
- hand off to XDev when available.

### Future `xmi-xdev-handoff`

Not required for initial V0 implementation. It will perform version negotiation and amendment feedback.

## 5. Optional UI resources

Candidate tool-linked views:

- `ui://xmi/product-map`
- `ui://xmi/decision-card`
- `ui://xmi/readiness-report`

M0 must verify the current official resource URI and bridge conventions.

## 6. Delivery-mode MCP operations

Conceptual V0 additions:

- `xmi_delivery_mode_recommend` - read-only recommendation with reasons and limitations;
- `xmi_delivery_mode_select` - Owner-confirmed mutation with expected project version;
- `xmi_delivery_mode_get` - bounded policy/mode history view;
- `xmi_mode_risk_evaluate` - deterministic risk-scope/minimum-mode findings;
- `xmi_mode_override_resolve` - confirmed scope upgrade/project upgrade/stub/defer resolution;
- `xmi_mode_override_retract` - Owner withdrawal of a confirmed override; keeps the record and the resolution it carried, and returns the underlying risk to unresolved (ADR-007);
- `xmi_mode_gap_analyze` - read-only upward upgrade gap report.

All readiness/audit/compile tools must accept or derive the canonical mode and return the target/achieved readiness level. No generic tool may silently rewrite mode.

## M2 implementation qualification

The concrete versioned schemas and safety metadata are in apps/mcp-server/contracts.ts; local STDIO behavior and I-3 host consent are specified in M2-TOOL-CONTRACTS.md. Actor/approval claims are not accepted from tool arguments. New mutations require independently received host form approval, then domain version/fingerprint checks.

M2 answer analysis prepares a verbatim unconfirmed candidate and reports semantic analysis NOT_EVALUATED. Adaptive extraction/conflicts/gaps and risk/override engines remain M4/M5: their typed MCP contracts explicitly return MILESTONE_DEPENDENCY_UNAVAILABLE instead of empty success results. Actual Skill invocation, plugin installation, custom UI and live cross-surface testing remain later milestones.

## M10 local private-plugin installation qualification

The local creator-compatible package under `plugins/xmi/` is installable through the measured Codex local marketplace flow. The command spelling below is version-specific evidence supplied by the M10 handoff from `codex-cli 0.155.0-alpha.2.6`; recheck it when the host version changes.

| Purpose | Measured command shape |
|---|---|
| Register local marketplace | `codex plugin marketplace add <SOURCE> --json` |
| List plugins | `codex plugin list [--marketplace <M>] [--available] [--json]` |
| Install | `codex plugin add <PLUGIN[@MARKETPLACE]> --json` |
| Remove plugin | `codex plugin remove <PLUGIN[@MARKETPLACE]> --json` |
| Remove marketplace | `codex plugin marketplace remove <name>` |
| List MCP servers | `codex mcp list` |

The measured installation path uses `plugins/xmi/.agents/plugins/marketplace.json` with `path: "./"`, so the marketplace root and plugin root are the same `plugins/xmi/` directory. The installed package registers the existing local STDIO MCP server; it does not authorize remote hosting or public distribution.

Real-session explicit Skill invocation and negative-selection behavior still require a real host acceptance run. The package manifest's `interface.capabilities` remains unchanged until such a run demonstrates that a capability declaration is required; successful installation and MCP registration alone do not establish that requirement.

## Lightweight review delivery status — 2026-10-18

Resume, audit, readiness, compile, validate and export now return delivery_workflow. The full-spec document review is looked up from checked review storage and native source; it is separate from formal M8 assurance. Latest module advice cannot stand for the full spec. NOT_STARTED, AWAITING_AGENT/RUNNING, COMPLETED, STALE and UNVERIFIED remain distinct; any findings, questions, follow-up references or verification notes require presenting them to the Owner, not automatic adoption. The original start call collects the true return; read-only lookup never commits a result or launches an Agent. Revision invalidates prior review applicability. Export remains a separately approved exact package and includes review status in READINESS-REPORT.md. Generic hosts without the native adapter report unavailable and may still export a disclosed valid candidate. No new tool, provider or formal-isolation prerequisite was added.
