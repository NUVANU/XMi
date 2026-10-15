# 10 - MCP Tools and Skills

## 1. Tool design principles

- Tools represent recognizable user goals.
- Inputs/outputs are typed and versioned.
- No generic arbitrary database update tool.
- Mutations are idempotent and require expected project version.
- Read-only, open-world and destructive annotations must be explicit using the current platform schema.
- UI resources are optional and never contain hidden business logic.

## 2. Proposed V0 MCP tools

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
