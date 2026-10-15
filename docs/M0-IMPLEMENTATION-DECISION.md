# M0 - Implementation Decision

Status: CONDITIONALLY APPROVED by explicit Owner decision on 2026-09-15. ADR-005 accepted. M1 authorized after C-1/C-2; no product confirmation inferred. The proposal text below is retained as the approved design context.

## Toolchain

TypeScript, Node.js 24.20.0, npm 11.19.0, ESLint and native node:test. Runtime and package versions are MEASURED in the milestone report and lockfile. The selected Node major is LTS according to the [official release table](https://nodejs.org/en/about/previous-releases).

Exact development dependencies: TypeScript 5.9.3, @types/node 24.13.4, ESLint 10.10.0, typescript-eslint 8.70.0. Latest TypeScript 7.0.2 failed dependency resolution against the lint tool's supported range; compatible TypeScript was selected without forcing installation. Native Node tests are the architecture's permitted equivalent to Vitest. npm is already installed and provides lockfile-based reproducibility.

Build compiles the baseline test harness only. Lint checks that harness and its config. Tests check runtime pin, empty scaffold, JSON parsing, local schema references and absent later-milestone runtime directories. These do not establish product behavior, schema-instance validity or installed-plugin correctness.

The official plugin validator needs Python 3.12.14 and PyYAML 6.0.3; the latter is pinned in requirements-m0.txt and installed only in ignored .m0-python/. Python is not a product runtime.

Retain the official MCP TypeScript SDK, Zod and SQLite as planned future dependencies. Do not add them before their milestones. Preserve existing JSON Schema draft 2020-12 semantics when adding runtime validation; do not silently generate incompatible replacements.

## Final repository structure proposal

```text
XMi/
  AGENTS.md, README.md, CODEX-START-HERE.md
  docs/                         design, ADRs, milestone evidence
  schemas/                      authoritative contracts
  samples/, templates/          fixtures and templates
  plugins/xmi/                  official M0 compatibility scaffold
    .codex-plugin/plugin.json
    .mcp.json                   empty server map in M0
    skills/                     no workflows in M0
  plugin-skeleton/              existing design reference only
  packages/                     PROPOSED, not created
    core/                       domain/interview/profiles/decisions/
                                delivery-policy/readiness/xspec
    storage/                    SQLite + in-memory test adapter
    mcp-tools/                  typed server boundary
    shared-types/               contracts independent of host/UI
  apps/                         PROPOSED, not created
    mcp-server/                 local STDIO first
    plugin-ui/                  optional after tool-only success
  tests/                        baseline now; domain/contract/E2E later
  package.json, package-lock.json, tsconfig.json, eslint.config.mjs
```

plugins/xmi aligns folder name with the creator manifest. This packaging placement does not change component boundaries. Keep the generated compatibility layout in M0; reconsider portable packaging with fresh official tooling in M9. Do not register fabricated app IDs or empty server commands. Existing Skill drafts are not installed.

## Canonical delivery policy and schema implications

The existing project delivery_policy represents requested/effective modes, selection source, readiness target, history and risk overrides. XSpec delivery_profile exports mode/target/source/scoped overrides; readiness records contain target/achieved levels, assurance and gap count. This demonstrates representability, not enforced policy.

requested_mode is provenance, effective_mode is the single canonical selection; consumers do not create competing editable state. M1 must bind confirmation to an explicit Owner event, including imported-suite provenance. A selection label/history entry alone is not authenticated confirmation. Migration must preserve confirmed state and surface missing evidence rather than invent it.

M5/M8 must validate scope references, minimum modes, confirmed resolutions and blockers. M4/M7 derive gaps from retained confirmed state. Mode changes cannot rewrite previous export evidence. Existing schemas/samples are unchanged; schema/event linkage or draft-state representation changes need review before implementation.

## Current XDev mapping

MEASURED by reading /local/redacted-path profile-policy.ts and schemas/delivery/0.1/{common,delivery-profile-decision}.schema.json on the evidence date. These files are untracked in a dirty neighboring workspace; the report records their fingerprints. They are candidate contracts, not a released API or content of the observed HEAD.

| XMi mode | XMi readiness | Actual XDev DeliveryProfile | Preservation requirement |
|---|---|---|---|
| FAST_VALIDATION | PROTOTYPE_READY | prototype | Execution outcome remains PROTOTYPE_UNVERIFIED. |
| FAST_DEVELOPMENT | BUILD_READY | quick_verified | Preserve independent verification, code review, QA, evidence and spec compliance. |
| PRODUCT_GRADE | PRODUCT_SPEC_READY | full_governance | Preserve independent reviewer/QA, workstream lead and applicable integration obligations. |

This is an enum projection proposal, not an implemented or fully compatible adapter:

- XDev raises its floor for complexity, multi-module/cross-domain changes, interface instability and high risk. Below-floor input is rejected while a higher effective profile is returned. A consumer must report the discrepancy to XMi/Owner instead of silently overwriting the selected mode.
- The current XDev decision schema has no typed scope_overrides carrier and forbids extra fields. Reducing overrides to rationale text is not lossless. A versioned consumer envelope/extension must be agreed before M7/M10. No XDev or XSpec schema was modified.
- owner_selected is Boolean, not authenticated XMi confirmation. Verify and preserve the source event reference.
- The observed policy leaves verified-outcome derivation to its later verifier milestone. Accepted profile metadata is not verified delivery.

## Surface and audit path

M1 starts with canonical local storage and deterministic tests independent of XMem or any host. Existing project XMem is execution continuity only. M2 exposes local MCP. Shared remote access needs a separate concrete approval for connectivity and data handling. UI follows tool-only success.

M8 requires immutable bounded audit input, denied canonical mutations and version-bound findings. Availability of subagents is insufficient; test effective isolation and use the already-designed fallback without weakening mode requirements.

## ADR disposition

| Existing ADR | M0 outcome |
|---|---|
| ADR-001 Skills + MCP | Capability supported; add manifest and private transport qualifications. |
| ADR-002 XMi canonical state | Retain unchanged. |
| ADR-003 optional UI | Retain; current MCP Apps guidance agrees. |
| ADR-004 unified mode | Retain; enum projection known, risk/override compatibility pending. |

ADR-005 is accepted by Owner conditional approval; F-2 is registered in ADR-004 and traceability.

## Owner decision after M0

Owner accepts the local-first baseline, scaffold and structure subject to C-1 (single M0 commit, no merge) and C-2 (F-2 registration). F-2 must be agreed with XDev after M2 and before M7 and gates M7/M10. Remote access, isolation and lossless compatibility are not approved. No deployment, auth change, public release, consumer modification or weaker acceptance criterion is authorized.
