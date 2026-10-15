# Milestone Report - M10

## Status

**LANDED — PARTIAL**

The M10 candidate was landed on branch `codex/m10-consumer-handoff-alpha` as the child of `fd95635063936100e04c69c43b647a0d31a3c579`, on the repository-pinned Node `24.20.0` / npm `11.19.0`, and the acceptance/packaging decisions it implements are now verified locally. The delivered patch applied to the real parent with rc=0 on the first attempt and 14 of its 16 declared hashes matched exactly.

The M10 **exit gate is still not satisfied**, and the landing did not weaken that statement: a real non-fixture dogfood XSpec has not been executed, a real XDev import report is unavailable, no independent XUi consumer runtime exists, and real-session explicit/negative host selection has not been executed. The landing reproduced the candidate's three blocking reasons independently rather than accepting them on report, so `docs/evidence/M10-PRIVATE-ALPHA-GATE.json` is landed byte-identical with `overall: NOT_PASSED`.

Four landing corrections were required, none in product code: the new framing test's skip set (two local-only directories the candidate's snapshot could not contain), the M9 README assertion the candidate invalidated without updating, the scope definition this exposed in `docs/13` section 6.4, and the landing-side one-byte `AGENTS.md` newline normalisation. The full record is `docs/evidence/M10-BASELINE.json`.

## Implemented

- Added Owner-approved ADR-009 verbatim and moved hosted-surface testing from the V0 private-alpha Plugin list to the deferred public-plugin gate exactly as authorised.
- Added Owner-approved `docs/13` section 6.4 canonical byte-framing text verbatim and the prescribed repository framing test.
- Added the Owner-approved local marketplace descriptor at `plugins/xmi/.agents/plugins/marketplace.json` verbatim.
- Updated the local plugin README and `docs/10` with the host command spellings supplied as external measured evidence from `codex-cli 0.155.0-alpha.2.6`; the evidence is attributed to the handoff provider, not this container.
- Corrected the V0.1 roadmap title to `Stateful Codex local private plugin alpha` and explicitly points hosted ChatGPT scope to ADR-009/public plugin gates; the V0.1 Includes list is unchanged.
- Added a M10 static acceptance test that locks the marketplace shape, ADR-009 release-gate move, readiness suffix family, XMem background-only rule and explicit limitation language.
- Added explicit consumer-handoff, dogfood-gap, ambiguity/rework and private-alpha gate records rather than manufacturing unavailable runtime evidence.
- Left all M8 readiness marker semantics unchanged.

## Execution model and reasoning effort

- Model: GPT-5.6 Sol.
- Reasoning effort: UNKNOWN; no authoritative per-turn setting is exposed to this task.
- Model self-report is not counted as test evidence.

## Carried preconditions

- **F-2 — PARTIALLY_CLOSED.** The frozen `XDEV-DELIVERY-HANDOFF/1` semantics remain Owner-relayed as accepted, but this candidate has no executable real XDev importer/runtime. No lossless compatibility claim is made.
- **F-3 — OPEN.** Effective shell/host isolation and a real independent LLM review remain unverified; deterministic bounded-snapshot behavior is not relabelled as that evidence.
- **I-3 — OPEN.** Host form UI/human identity trust remains unverified. Existing Owner-gated writes still fail closed without genuine form elicitation.
- **Hosted ChatGPT/public surfaces — carried to the public-plugin gate by Owner-approved ADR-009.** This is a scope decision, not an environment excuse and not a waiver of public-release requirements.

## Implementation details

### ADR-009 and private-alpha surface scope

ADR-009 is landed exactly as the handoff supplied it. Its section 3 sentence saying local install was “not yet measured” is retained as historical decision text; later evidence in the handoff measured successful local installation/MCP registration. This report records that later evidence rather than rewriting the ADR snapshot.

### Local marketplace and command surface

The new marketplace descriptor keeps the creator-compatible package root at `plugins/xmi/` with `path: "./"`. The handoff provider measured the relevant command spelling on `codex-cli 0.155.0-alpha.2.6`, including `codex plugin marketplace add`, `codex plugin add`, `codex plugin remove`, marketplace removal and `codex mcp list`. This candidate container did not execute that host.

### `interface.capabilities`

The manifest remains `interface.capabilities: []`. External host evidence proves installation and MCP registration can succeed with that value, but it does not prove whether a capability declaration is required for **real-session explicit Skill invocation**. Because this candidate cannot run that host session, C16 is `NOT_EXECUTED_HOST_UNAVAILABLE`; the manifest is not changed by intuition.

### Manual configuration stop condition

The three local absolute-path substitutions are treated as a **partial hit** on `docs/16` section 3 for the nontechnical target user. They are documented and acceptable for a technical private-alpha installer, but M10 does not claim nontechnical self-installation. A local configuration helper/validator is proposed as follow-up work, not silently invented in this acceptance patch.

### Consumer runtime boundary

The XUi result is `BLOCKED`, not PASS: no independent XUi runtime exists in the supplied project and the XMi `importForConsumer(..., "XUI")` path is a producer-side conformance stub. The real XDev result is also `BLOCKED` in this candidate because the materials still record runtime support as implementation pending and no executable importer is supplied here. F-2 stays `PARTIALLY_CLOSED`.

### Non-fixture real dogfood

No real dogfood XSpec is claimed. The checked-in `ScopeGuard` artifact is a sample, and the handoff explicitly requires a non-fixture real project. The materials do not identify an Owner-confirmed real supported-profile idea. Inventing one and marking its requirements confirmed would violate XMi's own confirmation/provenance invariants. `docs/evidence/M10-DOGFOOD-GAP-REPORT.md` records the exact host execution needed to close C25.

### XMem background policy

XMem remains background-only. M10 exposes no fourth user mode and does not modify XMem internals; the canonical mode remains the XMi-owned selection inherited by consumers.

## Not implemented

- Real-parent `git apply --check -p1` against commit `fd95635063936100e04c69c43b647a0d31a3c579` in this container.
- Full repository build/lint/test on the pinned Node/npm runtime.
- Real-session Codex explicit Skill invocation and real-host negative selection behavior.
- A real non-fixture M10 dogfood run from FAST_DEVELOPMENT through one upgrade to PRODUCT_GRADE.
- A real dogfood XSpec produced by that run.
- Real XDev importer/runtime execution against those exact bytes.
- Any real XUi runtime execution; no such runtime exists in the supplied project.
- Root `AGENTS.md` byte-framing correction; the handoff explicitly assigns that one-byte action to the landing side because the file contains machine-local paths and is forbidden from this patch.
- Remote/public infrastructure, hosted ChatGPT testing, public marketplace submission, authentication, Secure MCP Tunnel or paid infrastructure.

## Requirements covered

- `XMI-FR-025` — local package/marketplace and version-qualified install/remove documentation advanced; explicit invocation/negative real-host checks remain open.
- `XMI-FR-020`, `XMI-NFR-017` — producer-side conformance evidence is retained, but real XDev/XUi consumer acceptance is **not** claimed and blocks closure.
- `XMI-FR-016/019/021` — prior deterministic compiler/export evidence is retained; M10 real dogfood execution remains blocked.
- `XMI-NFR-012` — ADR-009 keeps private local and public hosted work explicitly separate.
- `XMI-NFR-018/019` — canonical byte framing and source/environment labelling are made explicit.

## Files changed

The exact candidate list and LF-normalised hashes are recorded in `docs/evidence/M10-CANDIDATE-SELFCHECK.json`. No `AGENTS.md` hunk is included.

## Tests actually run

| Command / check | Result | Environment | Source class | Evidence |
|---|---|---|---|---|
| M9 parent snapshot hash cross-check for touched files recorded in M9-BASELINE | `PASSED_ENV_MISMATCH` | Linux; candidate container; 2026-09-19 | MEASURED | Supplied full-text parent preimages reproduce the recorded current M9 hashes for every M9-recorded file checked before edit; this is not real-parent Git verification. |
| `node --experimental-strip-types --check tests/baseline.test.ts` and `tests/m10.test.ts` | `PASSED_ENV_MISMATCH` | Node 22.16.0; Linux; 2026-09-19 | MEASURED | Both changed/new TypeScript test files completed syntax checking; this is not a TypeScript build. |
| `node --experimental-strip-types --test tests/m10.test.ts` | `PASSED_ENV_MISMATCH` | Node 22.16.0; Linux; 2026-09-19 | MEASURED | 5 tests executed / 5 passed / 0 failed after one test-only regex correction; does not count as pinned-runtime repository PASS. |
| `node --experimental-strip-types --test --test-name-pattern=repository... tests/baseline.test.ts` | `PASSED_ENV_MISMATCH` | Node 22.16.0; Linux; 2026-09-19 | MEASURED | Framing test executed and passed on the supplied candidate source scope; root `AGENTS.md` is intentionally absent and must be corrected by landing side before full-repo acceptance. |
| Framing non-vacuity mutation (`\n\n` tail) then byte-exact restore | `PASSED_ENV_MISMATCH` | Node 22.16.0; Linux; 2026-09-19 | MEASURED | Mutated run exit 1 with `docs/02-PRODUCT-ROADMAP.md: must not end with a blank line`; restore hash returned to `68df210f90671b86f246c7c2304cedf234b0becb14e2f894568d40ef8ae26681`. |
| Dependency availability probe (`npm view zod@4.6.5 version --fetch-timeout=5000 --fetch-retries=0`) | `BLOCKED` | Node 22.16.0 / npm 10.9.2; Linux; 2026-09-19 | MEASURED | Registry DNS failed with `EAI_AGAIN`. The real `package-lock.json` is also intentionally excluded from the handoff, so exact `npm ci` restoration is not available in this snapshot. |
| `npm run build` | `BLOCKED` | mismatched runtime / unavailable dependency tree | MEASURED | No authoritative TypeScript build result can be produced here. |
| `npm run lint` | `BLOCKED` | mismatched runtime / unavailable dependency tree | MEASURED | No repository ESLint execution is available; source scan separately guards the prior M9 `no-explicit-any` failure class. |
| `npm test` | `BLOCKED` | Node 22.16.0 / missing dependencies | MEASURED | Full pinned-runtime suite cannot execute here. Baseline at parent is handoff-provided external evidence, not rerun by this candidate. |
| Real local Codex explicit invocation / negative routing | `NOT_EXECUTED_HOST_UNAVAILABLE` | current candidate container; 2026-09-19 | MEASURED | This environment exposes no executable real Codex session; the handoff provider's installation evidence is cited separately. |
| Real non-fixture dogfood + XDev import | `BLOCKED` | current candidate/source set; 2026-09-19 | MEASURED | No Owner-confirmed real dogfood project and no executable real XDev importer/runtime are supplied. |
| Real XUi import | `BLOCKED` | current project/source set; 2026-09-19 | MEASURED | Independent XUi consumer runtime does not exist; only XMi's conformance stub exists. |

The table above is the **candidate container's** record and is landed unchanged. The rows it marks `BLOCKED` for runtime reasons were executed at landing:

| Command / check | Result | Environment | Source class | Evidence |
|---|---|---|---|---|
| `git apply --check -p1` of the delivered patch against the real parent `fd95635` | `PASS` | Win32; first attempt; 2026-09-19 | MEASURED | exit 0, 17 targets, 24 hunks, 0 count errors, 0 CRLF |
| Declared-hash cross-check, 16 files | `PASS` | Win32; LF-normalised SHA-256 | MEASURED | 14 exact matches; the 2 differences are the landing's own corrections 1 and 3 |
| `npm run build` | `PASS` | Node 24.20.0 / npm 11.19.0 | MEASURED | exit 0 |
| `npm run lint` | `PASS` | Node 24.20.0 / npm 11.19.0 | MEASURED | exit 0 |
| `npm test` | `PASS` | Node 24.20.0 / npm 11.19.0 | MEASURED | 146 tests, 146 pass, 0 fail (140 at M9 close) |
| Framing non-vacuity control, both assertion classes | `PASS` | Node 24.20.0 | MEASURED | appending one LF fails with `must not end with a blank line`; CRLF conversion fails with `contains a CR byte`; both restored byte-identical (`68df210f…`) |
| Full-repository framing scan | `PASS` | Win32 | MEASURED | 158 files: 0 CR bytes, 0 trailing blank lines, 0 missing final LF |
| Real-host install using the candidate's delivered bytes | `PASS` | `codex-cli 0.155.0-alpha.9.2`, host app `26.915.31945` | MEASURED | `plugin marketplace add` rc=0, `plugin add` rc=0, `plugin list` reports `installed, enabled`, `codex mcp list` registers `xmi` |
| MCP server start from the local copy, before path substitution | `FAIL` as designed | Win32 | MEASURED | the unsubstituted `<abs-path-to-node>` command cannot be spawned — the three substitutions are a real prerequisite, which is what the candidate's `PARTIAL_STOP_CONDITION_HIT` ruling states |
| MCP server start after substituting the three paths | `PASS` | Node 24.20.0 | MEASURED | `initialize` ok (protocol `2025-06-18`), 19 tools (11 read-only), exit code 0, 40,960-byte SQLite created |
| Real-session explicit invocation / negative routing / real dogfood / real consumers | `NOT_EXECUTED` | 2026-09-19 | MEASURED | unchanged; see Known limitations |

## Measurement sources

- **MEASURED** parent baseline facts and host-install facts are taken from the M10 handoff's recorded M9 landing and external host evidence; this report names them as external rather than as candidate execution.
- **MEASURED** candidate source counts, hashes, suffix hits, hunk arithmetic, CRLF/tail scans and source-level test outcomes are generated in this container and recorded in `M10-CANDIDATE-SELFCHECK.json`.
- No performance, quality percentage, cost or coverage percentage is estimated by this candidate.

## Assumptions

- The M10 combined handoff full-text files are the authoritative supplied source snapshot. Where M9-BASELINE records a current hash, the candidate cross-checks the supplied preimage against it before editing.
- The actual Git object for parent `fd95635063936100e04c69c43b647a0d31a3c579` is not available here; real-parent patch applicability remains a landing-side judgement.

## Known limitations

- **Capability exists, candidate environment lacks it:** real Codex session explicit invocation and negative selection are `NOT_EXECUTED_HOST_UNAVAILABLE`; the handoff explicitly reports a real host exists.
- **Capability/runtime does not exist in the current project:** independent XUi consumer execution is `BLOCKED`, because only the XMi producer-side stub exists.
- **Required real consumer runtime not supplied to this candidate:** real XDev import is `BLOCKED`; F-2 remains `PARTIALLY_CLOSED`.
- **Required real dogfood input/execution absent:** no non-fixture Owner-confirmed supported-profile project is supplied or executed, so no real dogfood XSpec/gap report is fabricated.
- **Owner moved it out of this gate:** hosted ChatGPT/public surface testing is a public-plugin item under ADR-009 and remains unapproved infrastructure work under ADR-005.
- **F-3 and I-3 remain open** under their existing definitions.
- **Manual local path configuration** is recorded as a partial stop-condition hit for the nontechnical target user.
- Registered M8 precision observations and the suspected `docs/12` historical/dangling reference are not deep-fixed in M10.

Landing-side additions, none of which change the gate verdict:

- **Real-session host selection was not executed on either side.** The landing re-ran the real host flow for installation and MCP registration, but the judgement environment cannot launch an interactive Codex session either, so `explicit invocation` and `negative routing` stay `NOT_EXECUTED`. Installation being measured twice must not be read as invocation being measured once.
- **`exports/` and `_e2e/` are test-run artefacts that no `.gitignore` entry covers.** They appear as untracked files after any `npm test` run. The landing deleted them before committing, and the framing test skips them by name, but a future milestone should decide whether they belong in `.gitignore` rather than deleting them by hand each time.
- **`PACKAGE-SHA256.json` records `AGENTS.md` as 4,020 bytes while the file is 5,473.** The mismatch predates M10 and was deliberately not repaired: that file is on the candidate forbidden list and, per `docs/13` section 6.4, the `AGENTS.md` change is a landing-side one-byte normalisation that invalidates no evidence record because none registers its hash.

## Architecture deviations

None. ADR-009 is an explicit Owner-approved architecture/release-scope decision; no other accepted ADR is silently rewritten. XDev/XUi/XMem responsibilities are not changed.

## New dependencies

None.

## Privacy/security impact

No remote endpoint, tunnel, authentication, multi-tenant hosting or paid infrastructure is added. Machine-specific paths remain placeholders in repository files. Existing host-form consent and fail-closed audit/readiness behavior are unchanged.

## Schema/migration impact

None. M10 adds packaging/evidence/docs/tests only and does not change Product Model, XSpec or readiness schemas.

## OpenAI platform assumptions

No new private API is assumed. Local command spelling is version-qualified external evidence from the handoff provider. Hosted/public plugin work remains deferred under ADR-009/ADR-005.

## Next milestone readiness

**LANDED, but NOT READY for a private-alpha PASS claim.** The landing ran the pinned repository gates and they are green (build 0 / lint 0 / 146 of 146 tests), performed the landing-side `AGENTS.md` newline correction, and re-measured real-host installation. What remains is not landing work:

1. **Real-session explicit invocation and negative host selection** must be executed in a genuine interactive Codex session. Neither the candidate container nor the landing judgement environment can launch one.
2. **A non-fixture real dogfood project** must be selected and completed with the required `FAST_DEVELOPMENT` → `PRODUCT_GRADE` upgrade. Inventing one would violate the confirmation/provenance invariants, so it needs an Owner-confirmed supported-profile idea.
3. **Real consumer evidence** is required. The literal XUi consumer gate additionally needs a product decision or runtime that does not exist today; it must not be hidden by XMi self-conformance.
4. **F-2, F-3 and I-3** keep their existing open/partial status.

M11 should therefore be scoped from this list rather than from a fresh reading of `docs/16`, and the returned patch has to keep the byte-framing scope rule in step with `.gitignore`.
