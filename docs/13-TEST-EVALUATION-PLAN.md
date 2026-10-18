# 13 - Test and Evaluation Plan

Independent-review phase one adds synthetic core/MCP cases for exact model/file/material/policy and complete scoped bindings, all16 document delivery/coverage, grounded nonblank findings, overflow refusal, compiler-exact metadata-only derivation, immutable separate-store integrity, cross-project refusal, cancellation/unknown/restart/idempotency, bounded findings pagination, unconfigured no-op and strict rejection of supplied reviewer authority. TEST_ONLY records never supply real independent-review evidence. The actual commands/results, including any environmental failure, are recorded in INDEPENDENT-SPEC-REVIEW-PHASE1-20261016.md; passing more deterministic tests does not satisfy F-3.

## 1. Test layers

### Unit tests

- status transitions;
- explicit confirmation enforcement;
- stable ID/reference generation;
- question scoring;
- profile rules;
- readiness hard gates;
- XSpec compilation;
- migrations;
- idempotency/version conflicts.

### Schema/contract tests

- JSON schemas parse;
- samples validate;
- XSpec references resolve;
- consumer import fixtures (XUi and XDev) accept valid packages and reject invalid ones;
- MCP input/output schemas match domain types.

### Conversation fixture tests

Replay structured transcripts for:

- vague idea;
- contradictory answers;
- user says “I do not know”;
- user changes a confirmed decision;
- user asks XMi to decide everything;
- long interview resumed in a new session;
- imported malicious instruction;
- unsupported product profile.

### Audit/adversarial tests

Include polished-looking specs that contain:

- hidden assumptions;
- no data isolation;
- missing account deletion;
- payment success but no payment failure behavior;
- untestable “smart AI” requirement;
- contradictory roles;
- solution that violates offline/privacy constraint;
- stale model recommendation;
- unresolved blocker concealed by high score.

### Plugin selection tests

- requests that should invoke XMi;
- requests that should not invoke XMi;
- correct MCP tool choice;
- invalid/missing arguments;
- confirmation required for mutation;
- tool-only workflow without UI.

### End-to-end tests

1. Create idea.
2. Complete interview fixture.
3. Confirm decisions.
4. Run completeness/audit/readiness.
5. Compile/validate/export.
6. Resume from a new session.
7. Import into XDev fixture.

## 2. V0 release metrics

| Metric | V0 gate |
|---|---:|
| Falsely confirmed material statements | 0 |
| XSpec schema validity in release suite | 100% |
| Broken internal references | 0 |
| Readiness false-pass on blocker fixtures | 0 |
| P0/P1 requirements without valid AC when ready | 0 |
| Duplicate-question rate in curated fixtures | <= 5% |
| Resume state mismatch on curated fixtures | 0 |
| Consumer import success for valid packages | 100% |
| Consumer import rejection for invalid packages | 100% |
| Secret/raw conversation content in default logs | 0 known cases |

## 3. Evaluation dataset

Create at least:

- 10 happy-path Micro-SaaS ideas;
- 10 incomplete ideas;
- 10 contradictory/adversarial ideas;
- 5 unsupported product types;
- 5 long/resume scenarios.

Every fixture has expected:

- material confirmed facts;
- blocking questions;
- applicable profile checks;
- readiness result;
- required requirements/AC categories;
- forbidden assumptions.

## 4. Model behavior evaluation

Do not use exact prose matching. Evaluate structured outcomes:

- selected question category;
- extracted item status;
- provenance;
- contradiction detection;
- missing area detection;
- readiness decision.

## 5. Public plugin test materials

For a future public submission, maintain exactly the current required positive and negative test-case counts and formats. M0/M9 must recheck current official requirements before submission work.

## 6. Evidence rule

Every milestone report records exact commands and exit results. Model self-report is not test evidence.

### 6.1 Source class of every number

Any number, measurement, count, duration, byte size or hash cited in a document, report, milestone report or XSpec must declare its source class:

- `MEASURED` - produced by an executed command, a file or tool read, or a recorded observation. The record must name the exact command, file path or tool that produced it.
- `ESTIMATED` - not produced by execution. The premise and assumptions must be stated explicitly in the same record.

An `ESTIMATED` value must never be presented as `MEASURED`. An unlabelled number carries no authority and must not be used as the basis of a readiness or gate decision.

### 6.2 Environment stamp on every evidence record

Every evidence record must state the environment in which it was produced: runtime version, platform and date.

When the environment does not match the specification or the pinned runtime, the `Result` value must be **`PASSED_ENV_MISMATCH`** instead of `PASS`. This is the only marker XMi defines for this condition; no alternative or project-local spelling is valid inside an XMi package.

`PASSED_ENV_MISMATCH` means "the check ran and passed, but in an environment that does not match the specification". It is not a synonym for any of the following, and must not be used for them:

- `FAIL` - the check ran and did not pass;
- `BLOCKED` - the check could not be run;
- an unrecorded environment - the environment stamp is missing, which is a rule violation under this section, not a marker.

A `PASSED_ENV_MISMATCH` result:

- must not be reported as a plain pass, and must not be counted as one in a pass/fail tally;
- may count toward a readiness or release gate only with an explicit Owner decision that records the environment difference and the resulting limitation;
- remains usable as a signal until it is re-run in the specified environment.

### 6.2.1 Real-host unavailability marker (M9)

`NOT_EXECUTED_HOST_UNAVAILABLE` is the only M9 result marker for a check whose truth requires a real supported host installation/invocation but that host is unavailable to the evidence-producing environment.

- It means the check was **not executed**; it must never be counted as a pass or replaced by a synthetic conclusion value.
- It is distinct from `BLOCKED`: use it specifically for missing ChatGPT/Codex/IDE host execution capability, while `BLOCKED` remains appropriate for missing dependencies, inaccessible parent commits or other non-host execution blockers.
- The evidence record must name the unavailable host/surface and place the item in its blocked/carried surface list.
- A later real-host run supersedes the unavailable marker with its measured result; the earlier evidence record remains a historical snapshot.

### 6.3 Hash semantics for evidence records

A `file_sha256` entry in an evidence record is a **snapshot, not a standing claim**: it is the LF-normalised
SHA-256 of that file **at the moment the record was written**. Later milestones legitimately change those files.
Two rules keep this unambiguous:

- An earlier record is **not** rewritten to follow later changes. Rewriting it would make the record claim a
  content that did not exist when it was produced, which is worse than the drift it would hide.
- A later change **must name the earlier records it invalidated** in its own `superseded_recorded_hashes`, listing
  the affected files and their new hashes. A record that invalidates nothing omits the field.

Two narrow exceptions may update an earlier record in place, and both must be logged inside that record: a
correction to the record itself (wording, count, typo) made while its own milestone is still the head, and a change
to a file that only that record's own milestone owns.

Reading a hash therefore means asking **which record is current for that file**, not whether every record agrees.


### 6.4 Canonical byte framing of delivered and landed files

The hashes in 6.3 are only comparable if the bytes they describe have a defined shape, and a delivered patch is
only applicable if its line arithmetic matches the real file. Two framing rules cover that. Both are mechanical;
neither is a matter of style.

**Landed files.** Every file a milestone creates or modifies is LF-only and ends with exactly one `\n`. A file
must not end with a blank line.

**Delivered patches.** A hunk must not claim a line beyond the last line of the real base file. The usual cause is
a reconstructed base carrying one extra trailing newline, which turns the final hunk's trailing blank context line
into a phantom line that does not exist in the real file. The landing side checks this. A candidate is **not**
required to certify it: a candidate that cannot apply its own patch against the real parent cannot know, so the
judgement belongs to the side that can execute it.

**Scope.** This rule governs version-controlled repository content only. Local-only directories and file
patterns that `.gitignore` excludes — the local Python environment, the npm cache, XMem runtime data and
the manual backup copies — are outside it: no milestone creates or modifies them, their bytes belong to
local tooling, and a vendored package metadata file may legitimately carry CRLF. The framing test
therefore skips exactly the ignored top-level directories and ignored file patterns named in
`.gitignore`. **That skip set is part of this rule:** when `.gitignore` gains an ignored top-level
directory, the test's skip set must be extended in the same commit, or the test will begin scanning
local machine state and fail for a reason that is not a repository defect.

Named exemptions, recorded here rather than inferred:

- `docs/adr/ADR-006-XMI-XDEV-DELIVERY-HANDOFF-ENVELOPE.md` ends with a blank line. It is a frozen closed-baseline
  contract whose recorded hashes appear in `docs/evidence/M7-BASELINE.json` and the F-2, F-8, F-9 and
  export-independence records, so rewriting its final newline would invalidate those snapshots for no benefit.
- `plugins/xmi/skills/.gitkeep` is a zero-byte placeholder and stays zero bytes.

- `packages/mammoth-api/` retained files listed in UPSTREAM.json are pinned third-party source/license bytes (Owner-approved ADR-020). The framing test verifies their exact SHA-256 instead of rewriting upstream bytes. Generated and other owned files still follow normal framing; separate tests verify archive provenance, source set and browser reproduction.

No other exemption exists. A milestone that believes it needs one must add it here with its reason, and the
framing test below must be updated in the same commit.

This is a rule and not a preference because three landings needed correction for exactly this: M5 (two hunks past
end of file), M8 (ten files each one blank line long, two hunks past end of file) and M9 (a landed trailing blank
line). The failure is quiet: every product test stays green while the patch does not apply.

## 7. Delivery-mode evaluation

Add fixtures that run the same product idea through all three modes and verify:

- correct recommendation and explicit confirmation;
- correct target/achieved readiness level;
- no false production claim from FAST_VALIDATION;
- FAST_DEVELOPMENT catches missing core failure/data/permission decisions;
- PRODUCT_GRADE catches missing lifecycle/NFR/traceability/risk details;
- high-risk scope creates a blocker or valid explicit resolution;
- project upgrade returns a gap set and preserves existing confirmed state;
- prior exports/history remain immutable;
- XDev mapping preserves the selected mode and scope overrides.

Release suite target: zero cross-mode false-readiness cases.
