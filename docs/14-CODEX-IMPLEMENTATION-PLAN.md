# 14 - Codex Implementation Plan

Owner-authorized continuation (2026-10-15): repair the separate cloud dependency tree using compatible patched versions, normal peer resolution and targeted runtime/migration checks; preserve Sites identity, authentication, storage and product schemas. Isolate any unpatched build-only chain with an artifact check and retain its audit disclosure. Synchronize only the sanitized local/MCP public source to the corrected repository NUVANU/XMi, preserving its existing Apache-2.0 license/history. Review repository access/security settings without changing them. Hosted deployment and formal distribution releases remain subject to the prior Owner review hold. See CLOUD-DEPENDENCY-SECURITY-FIX-20261015.md.

Owner-approved dependency correction (2026-10-15): implement ADR-020 API-only Mammoth derivative, remove unused CLI/sprintf-js chain, retain exact source/license provenance, reproduce browser artifacts with component inventory, verify clean/full/production-only installs and DOCX regressions. Preserve parser isolation and product state. Synchronize private cloud source without unrelated template upgrades, peer bypass, deployment or public packaging. Present results and remaining independent cloud blockers before Owner release review.

2026-10-15 Owner approved preparing a local public Alpha candidate for NUVANU/XMi: clean public source, user README/install/platform docs, dependency-light packaging, first-run configuration, CI and verification, plus closure of the already approved native module-grant documentation. This is corrective release preparation, not a new product milestone or remote-service approval. Frozen handoff contracts and known risk-scope semantics remain unchanged. Publication is a later explicit action after review.

2026-10-13 Owner-approved M5/M8 corrective scope: repair active requirement filtering, scope-bound exclusion auditing and narrowly grounded Profile evidence recognition. No new milestone, schema change or gate waiver. Implementation and verification: READINESS-SCOPE-FIX-20261013.md.

## Global rule

Implement one milestone at a time. Do not proceed when its exit gate fails. M0 must finish and receive Owner approval before product implementation.

## M0 - Capability Probe and Anti-Drift Baseline

### Goal

Verify current OpenAI plugin/Skills/MCP/UI/subagent capabilities and establish a repository baseline without inventing unstable interfaces.

### Deliverables

- `docs/M0-CAPABILITY-REPORT.md`
- `docs/M0-IMPLEMENTATION-DECISION.md`
- final repository structure proposal;
- toolchain/package manager decision;
- build/lint/test baseline;
- official source links and verification date;
- list of discrepancies with `17-OPENAI-PLATFORM-BASELINE.md`;
- initial ADRs confirmed or amended.

### Required checks

- current plugin manifest/scaffolding;
- local/repo/private testing flow;
- Skills authoring and invocation;
- local Codex MCP and remote ChatGPT MCP transports;
- optional MCP Apps UI;
- supported plugin surfaces and IDE fallback;
- subagent isolation for Auditor;
- tool safety annotations;
- public submission requirements, for planning only.

### Exit gate

- no unverified private API assumptions;
- baseline commands pass;
- Owner approves implementation path.

### Stop

Do not implement M1 in the same PR.

## M1 - Domain Schemas and Project Store

### Goal

Implement canonical Product Model types, event log, snapshots, migrations and explicit confirmation invariants.

### Deliverables

- shared domain types;
- runtime validation;
- local SQLite adapter;
- in-memory test adapter;
- project/create/get/resume domain services;
- event history;
- migration/checkpoint behavior.

### Tests

- cannot create `CONFIRMED` without confirmation event;
- optimistic version conflict;
- idempotent mutation;
- atomic write/transaction rollback;
- resume from snapshot/event log;
- schema sample validation.

### Exit gate

All M1 tests pass; no chat transcript dependency.

## M2 - MCP Server and Core Tool Contracts

### Goal

Expose narrow tools around M1 domain services.

### Deliverables

- MCP server with current supported transport(s);
- project create/get/resume;
- answer analyze;
- patch apply;
- confirm/reject;
- structured errors;
- tool metadata and safety annotations;
- contract tests.

### Exit gate

Tools work without custom UI and cannot bypass domain invariants.

## M3 - XMi Discovery Skill Prototype

### Goal

Implement the ordinary-language workflow and tool sequencing.

### Deliverables

- `xmi-discovery/SKILL.md`;
- references for statuses, stages and question style;
- explicit and implicit invocation tests;
- negative invocation tests;
- transcript fixtures.

### Exit gate

Skill does not immediately generate a final PRD and does not falsely confirm proposals.

## M4 - Adaptive Interview and Question Selector

### Goal

Implement stage progression, candidate extraction, contradiction detection and next-question ranking.

### Deliverables

- interview domain service;
- question candidate generator contract;
- deterministic score/ranking;
- contradiction issues;
- bounded resume packet;
- duplicate question prevention.

### Exit gate

Curated interview fixtures meet expected state and duplicate-question target.

## M5 - Completeness Profile and Decision Engine

### Goal

Implement the Web App / Micro-SaaS profile and material decision lifecycle.

### Deliverables

- profile rule format;
- initial profile rules;
- applicable/not-applicable decisions;
- option comparison;
- approval/supersession events;
- blocker generation.

### Exit gate

Incomplete/adversarial fixtures raise expected blockers and cannot be marked ready.

## M6 - Technical Solution Blueprint

### Goal

Generate bounded solution recommendations from confirmed product constraints.

### Deliverables

- feasibility input model;
- option/trade-off structure;
- technical blueprint proposal;
- Owner approval/delegation workflow;
- AI capability profile and dated model-resolution record.

### Exit gate

No solution recommendation silently becomes an approved material decision.

## M7 - XSpec Compiler and Deterministic Validation

### Goal

Compile immutable XSpec versions and companion Markdown views.

### Deliverables

- schema-compliant compiler;
- stable ID/reference checks;
- AC coverage validation;
- manifest hashes;
- export package;
- sample fixtures;
- consumer import stub/fixture (XUi and XDev).

### Exit gate

All valid samples validate; all intentionally invalid samples fail with actionable errors.

## M8 - Independent Auditor and Readiness Gate

### Goal

Add isolated read-only audit and final hard-gate evaluation.

### Deliverables

- deterministic audit rules;
- isolated Auditor workflow;
- audit findings schema;
- readiness dimensions;
- hard gates;
- `xmi-audit-export` Skill.

### Exit gate

False-readiness adversarial suite has zero pass cases; Auditor cannot mutate Product Model.

## M9 - Plugin Packaging, Optional UI and Cross-Surface E2E

### Goal

Package private XMi plugin and validate ChatGPT/Codex workflows.

### Deliverables

- current official plugin package;
- private/developer-mode installation instructions;
- optional Product Map/Decision/Readiness UI if core tools are stable;
- text fallback;
- ChatGPT and Codex E2E report;
- IDE Skill+MCP fallback instructions if needed.

### Exit gate

One XMi project can be started on one supported surface and resumed on another supported test surface through canonical state.

## M10 - Consumer Handoff Dogfood and Private Alpha Gate

### Goal

Use XMi on a real product idea and hand the XSpec to the consumer import fixtures (XUi and XDev).

### Deliverables

- one complete real XSpec;
- consumer import reports;
- ambiguity/rework log;
- private-alpha README and limitations;
- release evidence mapped to `16-RELEASE-GATE.md`.

### Exit gate

All private alpha gates pass. Public marketplace submission remains a separate Owner decision.

## M11 - V0.1 Private Alpha Closure

### Goal

Close the V0.1 private-alpha gate. Two things have to be true: the mechanism work M10 left open has to be finished,
and every gate item that depends on something outside this project has to become a named precondition with a named
owner instead of an unattributed carry.

### Deliverables

- ADR-010 and the resulting `docs/16` sections 1 and 5 edit;
- F-3 and I-3 mechanism work with an explicit statement of what remains unclaimed;
- an Owner acceptance protocol covering real-session host invocation and the shape of a real dogfood input;
- per-item attribution for every private-alpha item that still does not pass: the named precondition, the owner,
  and the evidence form that would close it;
- the registration cleanup carried over from M10;
- release evidence mapped to `16-RELEASE-GATE.md`.

### Exit gate

Two parts. Neither may be reported as the other.

- **Mechanism exit.** Every private-alpha item is either PASS with executed evidence or
  `BLOCKED_ON_<named precondition>` carrying a named owner and the evidence form that would close it. No item may
  remain a bare "carried".
- **Closure exit.** All private-alpha gates pass under the ADR-010 definition. This part depends on the Owner
  supplying the named preconditions and cannot be produced by any candidate patch.

### Owner-approved installation and first-run extension (2026-09-20)

M11 additionally delivers the novice installation, “启用 XMi” activation, create/resume, guided product interview,
plain-language mode selection, confirmed data location, review/save and continuation flow in
`M11-INSTALL-FIRST-RUN.md` (M11-ONB-01 through M11-ONB-08).

The earlier mechanism-exit result is historical. Expanded M11 completion requires this implementation,
targeted automated checks and real-host acceptance. Current blocker: BLOCKED_ON_INSTALL_FIRST_RUN_ACCEPTANCE;
XMI owns implementation, OWNER owns host evidence. Apply it to existing Plugin/Continuity/Documentation gates,
without rewriting earlier evidence or adding top-level gate bullets. Dogfood and F-3 remain required.
## M12 - General interview and source-first XSpec

Implement the Owner-approved M12 scope in [M12-SCOPE.md](M12-SCOPE.md): selectable interview pace, conflict and terminology review, digital-game capability checks, and consent-gated assessment of Markdown/TXT/DOCX/PDF source documents. Reuse canonical Product Model and versioned XSpec services. Update schemas, fixtures, selection metadata and traceability together. Report unmet real-host, independent-audit and consumer gates rather than treating them as passed.

Owner extended XMI-FR-033 on 2026-10-02 to visible module design tables refined over multiple rounds, with behavior/effect explanation, contextual priority questions, gap review and canonical draft resume. Implement as the M12 correction described in M12-SCOPE.md; generic stages are coverage prompts, not concrete module boundaries. Preserve confirmation/provenance and the XMi/XDev boundary.

The subsequent Owner trial requires the complete module review brief each round: current design, pending choices plus host recommendations/reasons, effects/conflicts and numbered batch reply. Use the updated M12-SCOPE.md maximum/pacing and conditional-dependency rules; a latest-answer recap plus a lone edge question does not satisfy this extension.

## Required milestone report

Use `templates/MILESTONE-REPORT.md`.

## PR discipline

- one milestone per PR;
- no M0+M1 combined PR;
- schemas and tests updated together;
- no broad refactor during a feature milestone;
- architecture deviations documented as ADR before implementation.

## Delivery-mode requirements by milestone

- **M0:** include mode contract and current XDev adapter mapping in capability/architecture reports; do not implement product behavior.
- **M1:** implement `delivery_policy`, mode events/history, schema 0.2 migration and invariant tests.
- **M2:** expose typed mode recommend/select/get/risk/override/gap MCP tools.
- **M3:** teach Discovery Skill to explain and confirm one project outcome without asking about Agent topology.
- **M4:** make question selection mode-aware and upgrade-gap-aware.
- **M5:** implement mode-specific completeness rules and scoped risk escalation.
- **M6:** make solution blueprints mode-aware without hiding production gaps.
- **M7:** compile XSpec 0.2 delivery profile and validate consumer compatibility.
- **M8:** enforce mode-specific audit/readiness gates and cross-mode false-pass tests.
- **M9:** render optional three-mode cards/status with text fallback and one canonical state.
- **M10:** dogfood all three modes or at minimum FAST_DEVELOPMENT plus one upgrade to PRODUCT_GRADE; verify XDev mapping and XMem background policy.
- **M11:** complete the F-3 and I-3 mechanism work, convert every remaining private-alpha blocker into a named
  precondition with a named owner, and deliver the Owner acceptance protocol. Do not claim the closure exit.

## M13 - General technical solution recommendations

Owner requested on 2026-10-01: extend the existing M6 blueprint to compare compatible frontend/client, backend, persistence, deployment and game-engine solutions; preserve specified technology, exclusions and unresolved checks; export concrete composition without changing XDev implementation ownership or schemas. Acceptance: targeted selection, stale-blueprint, confirmation and lossless human/machine export tests, build, lint and regression suite.

## M14 - Owner-private cloud XMi

Owner-authorized confirmation correction (2026-10-08): replace ordinary item confirmation/rejection JSON with full readable product text; bound local form length before elicitation and return an actionable error for oversized reviews without truncating/confirming anything. Preserve all semantic fields, exact binding/provenance and material gates. The existing authenticated cloud review page retains full scrolling review. Verify long provenance, long statements, hostile content, stale/cancel/no-consent and shared cloud behavior; update the same installed plugin/Site.

Owner-authorized corrective scope (2026-10-07): extend ADR-011 draft autosave to ordinary document-derived PROPOSED candidates in the shared M12/M14 service, preserve provenance and explicit adoption, update the installed local Skill and publish the same owner-private Site. Acceptance: no form for document/mixed-source drafts, exact retries, stale/secret refusals, and retained confirmation gates in local and durable cloud tests. No original file retention, schema migration or new service.

Owner authorized on 2026-10-05: host XMi on OpenAI Sites for direct mobile ChatGPT use, independent of the local computer. Follow ADR-014. Deliver authenticated stateless MCP, durable canonical state/recovery, explicit Owner review, document upload/assessment and downloadable validated XSpec packages. Preserve M12 module review briefs, M13 technical recommendations and existing confirmation/readiness gates. Separate actual deployment evidence from pending mobile Owner acceptance.

Owner-authorized corrective scope (2026-10-09): finish a module, display one exact numbered list in chat, and record the actual next “确认好了” reply through a natively trusted local UserPromptSubmit bridge. Follow ADR-015. Acceptance: no per-row forms, complete same-module list, genuine native event/session binding, changed/ambiguous replies do not adopt, stale-state refusal, atomic existing domain events/receipts and canonical read-back. Do not simulate hook trust/delivery. Cloud retains authenticated batch review until a comparable genuine original-prompt mechanism exists.

Correct the Owner-reported private-test-project session-binding failure within that scope: the trusted hook already ran, but MCP launch did not establish the environment-dependent adapter. Accept current native session routing as untrusted selection metadata, always construct the router, retain genuine original-prompt adoption gates, test missing/wrong environment and multi-chat cases, and preserve the existing trusted hook definition/install path. Verify actual private-test-project status read-only before asking for another reload; no live approval simulation.

Correct the subsequent private-test-project displayed-list compatibility failure within the same scope: accept the actual final_answer message phase alongside final, retain exact digest/latest-final/native-prompt/canonical gates, and test both successful adoption and non-final, stale, modified or truncated list rejection. Preserve the trusted live-source hook installation; do not replay failed live approval or reset its invalidation. See MODULE-FINAL-PHASE-FIX-20261009.md.

Correct the subsequent reply-copy mismatch within that same scope: trim only reply edge whitespace consistently in native eligibility and transcript comparison, preserving internal qualifiers and exact displayed review text. Test real observed trailing newline, CRLF/edge spaces/tabs, both final phases, qualified replies and intervening messages. No retroactive approval or live hook replay; see MODULE-REPLY-WHITESPACE-FIX-20261009.md.

Correct the actual native Windows extended-path failure within the same scope: retain bounded error/path-digest metadata to distinguish hook-time failures, then use native realpath resolution for both transcript and session root. The Owner's real event recorded EISDIR on an exact file path with \\?\ prefix; no directory search or guessed fallback is needed. Test that shape on Windows through isolated native fixtures and retain outside-session refusal. Verify a fresh genuine Owner receipt/read-back before live closure; see MODULE-NATIVE-PATH-FIX-20261009.md.

Correct the post-display batch timeout within that same scope: actual private-test-project history replay takes about 2.7 seconds, while the five-member confirmation repeated full replay six times under the existing ten-second trusted command budget. Validate history once in the same transaction and reuse only the internally checked sequential state/hash; retain snapshot/schema/actor/version/event/provenance/receipt and rollback checks. Test a synthetic 491-event five-member batch plus corrupt-state and late-write rollback cases. No cross-transaction cache or timeout/trust change; see MODULE-BATCH-TIMEOUT-FIX-20261010.md.

Owner-authorized single-item chat extension (2026-10-13): after another oversized blueprint dialog, Owner requested displaying a separately reviewed item in chat and confirming by text. Implement ADR-016: full readable item/decision/blueprint action list, genuine next native reply grant, narrow exact commit, one active review, stale/changed reply refusal, canonical receipt/read-back, no local item popup fallback. Keep mode/risk/file/export gates and cloud authenticated review. Verify tests and the selected local installation; never replay a failed live approval. See SINGLE-ITEM-CHAT-CONFIRMATION-20261013.md.

Owner-authorized corrective scope (2026-10-15): fix risk false positives, mixed whole-item exclusions and lost Owner rationale with historical replay compatibility; isolate the DOCX CLI dependency advisory path and verify private-test-project's real history read-only. Follow ADR-018, retain the frozen handoff triple and all product confirmation gates. Complete code/tests and Owner review before any new package or publication. Existing mixed private-test-project design items require a separately reviewed product disposition; do not create confirmation from this engineering authorization.

Owner-authorized confirmation correction (2026-10-15): extend ADR-016 native chat review to mode selection/upgrade and risk resolve/retract after another oversized legacy-risk dialog. Follow ADR-019. Remove shared raw JSON fallback; require readable reviews and apply lossless form bounds to every remaining desktop form. Verify genuine next-reply/provenance gates, current-state validation, old native endpoint refusal, cancellation/staleness, concurrent reply rollback, receipt recovery and cloud compatibility. Update selected local installation without changing hook trust. Present evidence before packaging/publication; do not approve private-test-project product scope.
