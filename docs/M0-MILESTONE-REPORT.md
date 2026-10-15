# Milestone Report - M0

## Status

CONDITIONALLY APPROVED by explicit Owner decision on 2026-09-15. Baseline checks passed. ADR-005 accepted. C-2 is registered as F-2; C-1 requires this M0-only change set as one commit on codex/m0-capability-baseline, without merging main. After both conditions Owner authorizes M1 only, then another approval gate. No environment mismatch observed; sandbox isolation not tested.

## Execution model and reasoning effort

MEASURED from local session turn_context metadata: M0 used gpt-6-astra, effort medium, turn redacted-session-id at 2026-09-15T03:26:26.162Z. Closeout uses gpt-6-astra / medium, turn redacted-session-id. Source: /local/redacted-path extracted only model/effort/timestamp/turn_id. No subagents used.

## Carried preconditions

F-2 OPEN: agree a versioned typed scoped-override carrier with XDev after M2 and before M7. Mandatory for M7/M10; rationale text is not lossless. Remote access, tunnel, authentication, paid infrastructure and lossless compatibility claims remain unapproved. M8 must test isolation or use the designed fallback/report audit unavailable.

## Implemented

- Dated official capability report, discrepancies and supported empty creator scaffold.
- Toolchain, lockfile, build/lint/test harness and final structure proposal.
- Initial ADR reconciliation, ADR-005 proposal, actual candidate XDev mapping and unresolved integration conditions.

## Not implemented

M1 or later behavior: no canonical store, migration, confirmation service, MCP tool/server, product Skill, interview, mode engine, compiler, audit runner, UI or consumer adapter. No host installation, marketplace change, authentication, tunnel, public service or submission.

## Requirements covered

M0 platform/toolchain/architecture deliverables only. XMI-FR-017/022/025/026..032 and XMI-NFR-007/013..019 have documentary or baseline evidence, not product acceptance. IDs refer to docs/01-V0-SCOPE-AND-REQUIREMENTS.md.

## Files changed

- Tooling: package.json, package-lock.json, tsconfig.json, eslint.config.mjs, .node-version, .gitignore, requirements-m0.txt.
- Baseline: tests/baseline.test.ts.
- Scaffold: plugins/xmi/.codex-plugin/plugin.json, .mcp.json, skills/.gitkeep, README.md.
- Reports: docs/M0-CAPABILITY-REPORT.md, docs/M0-IMPLEMENTATION-DECISION.md, this file.
- Recorded execution: docs/evidence/M0-BASELINE.json.
- Annotations: docs/15-TRACEABILITY.md, docs/17-OPENAI-PLATFORM-BASELINE.md, ADR-001, ADR-004, new ADR-005.
- Ignored local artifacts: dependencies and compiled test harness. Existing project-local XMem stores bounded handoff.

## Tests actually run

All records below use source class MEASURED and environment E-M0: Windows win32/x64, OS 10.0.26200, Node v24.20.0, npm 11.19.0, Python 3.12.14, date 2026-09-15. Exact output is preserved in [M0-BASELINE.json](evidence/M0-BASELINE.json). Runtime matches the pin; these are baseline passes, not product or isolation passes.

| Command | Result | Environment | Source class | Evidence |
|---|---|---|---|---|
| npm.cmd run build | PASS | E-M0 | MEASURED | exit 0; TypeScript compiled baseline harness |
| npm.cmd run lint | PASS | E-M0 | MEASURED | exit 0; ESLint with max-warnings 0 |
| npm.cmd test | PASS | E-M0 | MEASURED | exit 0; 5 tests passed, 0 failed |
| Official plugin validator, exact expanded command in JSON | PASS | E-M0 + local PyYAML | MEASURED | exit 0; Plugin validation passed |

Additional executed setup/probes:

- npm.cmd ci --ignore-scripts --no-audit --no-fund --cache .npm-cache: PASS, exit 0 in E-M0; lockfile installation reproduced.
- codex --version, codex --help, codex plugin --help: PASS in E-M0; CLI command availability only.
- git diff --check: PASS in E-M0; no whitespace errors.
- Official creator command in E-M0: bundled Python runs /local/redacted-path xmi --path /local/redacted-path --with-skills --with-mcp; exit 0, scaffold created. No marketplace option.

Observed failures and recovery, also MEASURED in E-M0:

- Initial shell calls: BLOCKED before command execution by apply deny-read ACLs. Reviewed escalation permitted repository work.
- npm.cmd install --save-dev --save-exact typescript@7.0.2 @types/node@24.13.4 eslint@10.10.0 typescript-eslint@8.70.0 --ignore-scripts --no-audit --no-fund --cache .npm-cache: FAIL, exit 1 / ERESOLVE. Rerun with typescript@5.9.3 succeeded; no force or legacy-peer-deps used.
- Official validator before local PyYAML setup: FAIL, ModuleNotFoundError: yaml. Installing requirements-m0.txt prerequisite and setting process-local PYTHONPATH enabled the recorded passing run.
- apply_patch tool: BLOCKED by sandbox ACL; batch wrapper: FAIL on multiline argument parsing. Direct official codex.exe --codex-run-as-apply-patch with reviewed escalation succeeded.
- XDev Git read: BLOCKED by dubious ownership. Command-scoped safe.directory enabled read-only inspection; global configuration was not changed.
- Web Markdown endpoints: unsupported content type; HTML official pages were opened and read instead.

The initial .gitignore edit replaced existing ignore lines; final review caught and restored the XMem exclusions. No private XMem files were staged or committed.

## Measurement sources

All values in this table and companion reports are MEASURED from the named commands/files on the date below. Contract versions and milestone/requirement identifiers name source contracts, not measurements. No cost/performance estimate is claimed.

| Value | Source |
|---|---|
| Date 2026-09-15, timezone +08:00 | Get-Date -Format o |
| Node v24.20.0, win32, x64, OS 10.0.26200 | node -p "JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,os:require('node:os').release()})" |
| npm 11.19.0 | npm.cmd --version |
| Codex 0.154.0-alpha.6.2 | codex --version |
| Python 3.12.14 | Bundled python.exe --version |
| TypeScript 5.9.3, Node types 24.13.4, ESLint 10.10.0, typescript-eslint 8.70.0 | Exact install command and package-lock.json |
| PyYAML 6.0.3 | Bundled Python -m pip install --target .m0-python PyYAML==6.0.3 --disable-pip-version-check |
| Rejected TypeScript 7.0.2; peer range >=4.8.4 <6.1.0 | Failed npm install output, ERESOLVE |
| XMi initial HEAD 865bb40fd360109ae5d6ecd9debad480c4ad9117 | git rev-parse HEAD; initial git status --short was empty |
| XDev observed HEAD ba59f9b981f583caf55bf4b36d35a76d0d59d458 | git with command-scoped safe.directory, rev-parse HEAD |
| Public testing minimums in capability report | Official submission page, Testing section, opened on verification date |
| Test count, pass/fail counts and durations in evidence JSON | Exact npm.cmd test stdout in M0-BASELINE.json; durations are incidental, not a performance gate |

Official creator/validator fingerprints (MEASURED: Get-FileHash -Algorithm SHA256 -LiteralPath under /local/redacted-path E-M0):

- create_basic_plugin.py: A0DFCA09C7ECC8F30012CB2111ACFDF733EAC7C5BD73E4EDB154A45487DE303F
- validate_plugin.py: 1E6CB914505B458856C2CFAB7D18A224731C743EF47E0C9D78AFE64F35B67F7C

### XDev source fingerprints

MEASURED: Get-FileHash -Algorithm SHA256 -LiteralPath <file>, with the runtime/platform/date above. Paths are relative to /local/redacted-path git status --short -- <files> reports these files untracked; their content is not vouched for by the HEAD commit. These are candidate observations, not an approved released API.

| File | SHA256 |
|---|---|
| src/planning/types.ts | 537C306E0CA05D829151F80730D745814763AD636DD8B331E9B6E4ACD530EB5E |
| src/planning/profile-policy.ts | 9E80755F7E6BA1EA28BCE857321586A0FC38E9E560ADA375C099F6D31CCB54D0 |
| schemas/delivery/0.1/common.schema.json | F3F6B9FF3893A781D0AD96D8760A62ABA5367FAF90ACD7F697D5824AC81DD141 |
| schemas/delivery/0.1/delivery-profile-decision.schema.json | 15AFD53D5D7540FF5666DFA2419EB4351A5465D3CD14C3FA16F6748A8ECE02A6 |

## Assumptions

Local-first baseline and ADR-005 are conditionally Owner-approved. Documentation does not establish this account's developer-mode/tunnel access.

## Known limitations

- JSON parsing and local reference resolution are not JSON Schema instance validation, migrations or domain invariant tests.
- XDev is a dirty candidate workspace; typed scoped overrides and stronger risk-floor integration need agreement.
- No subagent isolation, independent Auditor, plugin installation, UI or cross-surface resume test.
- Shell sandbox startup fails at ACL initialization; reviewed escalation was used. No future isolation guarantee follows.
- PACKAGE-SHA256.json and DOCUMENT-MANIFEST.txt remain incoming design-package evidence; they were not rewritten to imply coverage of new files.

## Architecture deviations

None. Package placement and native test runner use existing M0 flexibility. ADR-005 is accepted; remote access and consumer contract changes are not approved.

## New dependencies

Development only: TypeScript, Node types, ESLint, typescript-eslint; locked npm transitive dependencies. Local PyYAML supports the official validator. No cloud or product runtime dependency.

## Privacy/security impact

Official docs/package metadata were fetched; npm lifecycle scripts were disabled. No product data, credentials or auth changed. Neighboring XDev was read only. XMem contains bounded execution handoff, not the Product Model/full chat. Native Codex memory settings were not changed.

## Schema/migration impact

None. Existing schemas/samples unchanged. Later event linkage, initial unconfirmed mode representation and migration need implementation/review.

## OpenAI platform assumptions

Only current documented mechanisms. Supported compatibility scaffold; portable format, tunnel and inherited permissions are qualified in the capability report. No invented registration IDs or private APIs.

## Next milestone readiness

M1 authorized only after C-1 (single M0 commit, no main merge) and C-2 (F-2 registration). Commit alone does not authorize M1; the explicit conditional Owner decision authorizes it after both conditions. Stop after M1.

## Continuity handoff

XMem scope: task_ref M0, task_version 1, role implementer. Scope identifiers, not measurements. Owner conditional approval supersedes earlier pending-approval handoff. Repository evidence remains authoritative.
