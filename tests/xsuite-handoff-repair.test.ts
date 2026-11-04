import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {createHash} from "node:crypto";
import {Ajv2020} from "ajv/dist/2020.js";
import {XSpecService, XSPEC_PACKAGE_FILES, importForConsumer} from "../packages/core/xspec-service.ts";
import type {CompiledArtifact, ProducerEvidence, XSpecDocument} from "../packages/core/xspec-service.ts";
import {InterviewService} from "../packages/core/interview-service.ts";
import {fingerprint, itemFingerprint} from "../packages/core/validation.ts";
import {buildFixture, decisionCandidate, syntheticSource} from "./fixtures/xsuite-handoff.ts";

const document = (artifact: CompiledArtifact) => JSON.parse(artifact.files.find(file => file.path === "xspec.json")!.content) as XSpecDocument;
const manifest = (artifact: CompiledArtifact) => JSON.parse(artifact.files.find(file => file.path === "manifest.json")!.content) as
  {producer_evidence: ProducerEvidence; file_sha256: Record<string, string>; canonical_xspec_sha256: string};
const patchManifest = (artifact: CompiledArtifact, modify: (value: ReturnType<typeof manifest>) => void) => {
  const result = structuredClone(artifact), row = result.files.find(file => file.path === "manifest.json")!;
  const value = manifest(result); modify(value); row.content = JSON.stringify(value); return result;
};
const validateEvidence = new Ajv2020({strict: false}).compile(JSON.parse(readFileSync(new URL("../docs/public/producer-evidence.schema.json", import.meta.url), "utf8")));

test("J02: the optional producer evidence matches the real same-version domain history", () => {
  const fixture = buildFixture(), artifact = fixture.xspec.compile(fixture.project), evidence = manifest(artifact).producer_evidence;
  assert.equal(validateEvidence(evidence), true);
  assert.equal(evidence.source_coverage, "COMPLETE");
  assert.equal(evidence.evidence_status, "SOURCE_REFERENCED_NOT_AUTHENTICATED");
  assert.equal(evidence.subject.product_model_version, fixture.project.model_version);
  assert.equal(evidence.subject.canonical_xspec_sha256, artifact.canonical_sha256);
  for (const row of [evidence.mode_selection, ...evidence.item_confirmations]) {
    const event = fixture.service.history(fixture.project.project_id).find(event => event.event_id === row.event!.event_id)!;
    assert.equal(event.hash, row.event!.event_hash);
    assert.equal(event.version, row.event!.event_version);
    assert.equal(event.actor, "owner");
    assert.ok(row.event!.owner_source_ref.ref.startsWith("fixture:SYNTHETIC_NOT_HUMAN:"));
  }
  assert.equal(evidence.item_confirmations.some(row => row.item_id.startsWith("BLUEPRINT-")), true);
  assert.equal(artifact.files.length, 16);
  assert.deepEqual(artifact.files.map(file => file.path), [...XSPEC_PACKAGE_FILES]);
  assert.deepEqual(fixture.xspec.compile(fixture.project), artifact);
  assert.equal(fixture.xspec.validate(fixture.project, artifact).package_valid, true);
});

test("J02: unbound history and old optional-free packages never gain source proof", () => {
  const fixture = buildFixture(), unbound = new XSpecService(), artifact = unbound.compile(fixture.project);
  assert.equal(manifest(artifact).producer_evidence.source_coverage, "UNAVAILABLE");
  assert.equal(manifest(artifact).producer_evidence.mode_selection.event, null);
  const legacy = patchManifest(artifact, value => {delete (value as Partial<typeof value>).producer_evidence;});
  assert.equal(unbound.validate(fixture.project, legacy).package_valid, true);
  assert.equal(manifest(legacy).producer_evidence, undefined);
});

test("J02: altered subject, sources, event versions and malformed evidence fail validation", () => {
  const fixture = buildFixture(), artifact = fixture.xspec.compile(fixture.project);
  const changes = [
    (proof: ProducerEvidence) => {proof.subject.product_model_version++;},
    (proof: ProducerEvidence) => {proof.mode_selection.event!.event_version++;},
    (proof: ProducerEvidence) => {proof.item_confirmations[0]!.event!.owner_source_ref.ref = "fixture:wrong-source";},
    (proof: ProducerEvidence) => {proof.item_confirmations.push(proof.item_confirmations[0]!);},
    (proof: ProducerEvidence) => {proof.mode_selection.event = null;},
  ];
  for (const change of changes) {
    const bad = patchManifest(artifact, value => change(value.producer_evidence));
    assert.equal(fixture.xspec.validate(fixture.project, bad).package_valid, false);
  }
  const wrong = buildFixture();
  assert.throws(() => new XSpecService(undefined, wrong.service).compile(fixture.project));
  const old = fixture.project;
  fixture.add(decisionCandidate(1), false);
  assert.throws(() => fixture.xspec.compile(old), /PRODUCER_HISTORY_VERSION_MISMATCH/);
});

test("J02: domain-calculated FAST_VALIDATION READY and legal NOT_READY preserve all gates", () => {
  const ready = buildFixture(), finalized = ready.xspec.finalizeForExport(ready.project);
  assert.equal(finalized.validation.package_valid, true);
  assert.equal((document(finalized.artifact).readiness as {status: string}).status, "READY_FOR_XDEV");
  const candidate = buildFixture({omitIdentity: true}), notReady = candidate.xspec.finalizeForExport(candidate.project);
  assert.equal(notReady.validation.package_valid, true);
  assert.equal((document(notReady.artifact).readiness as {status: string}).status, "NOT_READY");
  assert.equal(notReady.validation.readiness_evaluation.hard_gate_ready, false);
});

test("J02 R1-F01: genuine event references cannot endorse rewritten content and recomputed package hashes", () => {
  for (const rewrite of ["requirement", "scope", "readiness"] as const) {
    const fixture = buildFixture(rewrite === "scope" ? {riskResolution: "STUB_OR_SANDBOX"} : {});
    const artifact = fixture.xspec.compile(fixture.project), payload = artifact.files.find(file => file.path === "xspec.json")!;
    const xspec = document(artifact);
    if (rewrite === "requirement") (xspec.requirements as Array<{statement: string}>)[0]!.statement = "Different unapproved synthetic behavior.";
    else if (rewrite === "scope") xspec.delivery_profile.scope_overrides[0]!.resolution = "UPGRADE_SCOPE";
    else {
      xspec.readiness.status = "READY_FOR_XDEV"; xspec.readiness.achieved_level = xspec.readiness.target_level;
      for (const gate of xspec.readiness.hard_gates as Array<{passed: boolean}>) gate.passed = true;
    }
    const canonicalInput = {...xspec} as Record<string, unknown>; delete canonicalInput.integrity;
    xspec.integrity.canonical_sha256 = fingerprint(canonicalInput);
    payload.content = JSON.stringify(xspec, null, 2) + "\n";
    payload.sha256 = createHash("sha256").update(payload.content).digest("hex");
    artifact.canonical_sha256 = xspec.integrity.canonical_sha256;
    const tampered = patchManifest(artifact, value => {
      value.file_sha256["xspec.json"] = payload.sha256;
      value.canonical_xspec_sha256 = xspec.integrity.canonical_sha256;
      value.producer_evidence.subject.canonical_xspec_sha256 = xspec.integrity.canonical_sha256;
      if (rewrite === "scope") value.producer_evidence.scope_dispositions[0]!.resolution = "UPGRADE_SCOPE";
    });
    const result = fixture.xspec.validate(fixture.project, tampered);
    assert.equal(result.integrity_valid, true); assert.equal(result.package_manifest_valid, true);
    assert.equal(result.package_valid, false);
    assert.ok(result.errors.some(error => error.code === "XSPEC_PRODUCER_EVIDENCE_MISMATCH"));
  }
});

test("J02 R2-F01: unchanged genuine proof cannot endorse a rewritten body with recomputed internal hashes", () => {
  for (const rewrite of ["requirement", "scope", "readiness"] as const) {
    const fixture = buildFixture(rewrite === "scope" ? {riskResolution: "STUB_OR_SANDBOX"} : {});
    const artifact = fixture.xspec.compile(fixture.project), originalProof = structuredClone(manifest(artifact).producer_evidence);
    const payload = artifact.files.find(file => file.path === "xspec.json")!, xspec = document(artifact);
    if (rewrite === "requirement") (xspec.requirements as Array<{statement: string}>)[0]!.statement = "Different unapproved synthetic behavior.";
    else if (rewrite === "scope") xspec.delivery_profile.scope_overrides[0]!.resolution = "UPGRADE_SCOPE";
    else {
      xspec.readiness.status = "READY_FOR_XDEV"; xspec.readiness.achieved_level = xspec.readiness.target_level;
      for (const gate of xspec.readiness.hard_gates as Array<{passed: boolean}>) gate.passed = true;
    }
    const canonicalInput = {...xspec} as Record<string, unknown>; delete canonicalInput.integrity;
    xspec.integrity.canonical_sha256 = fingerprint(canonicalInput);
    payload.content = JSON.stringify(xspec, null, 2) + "\n";
    payload.sha256 = createHash("sha256").update(payload.content).digest("hex");
    artifact.canonical_sha256 = xspec.integrity.canonical_sha256;
    const tampered = patchManifest(artifact, value => {
      value.file_sha256["xspec.json"] = payload.sha256;
      value.canonical_xspec_sha256 = xspec.integrity.canonical_sha256;
    });
    assert.deepEqual(manifest(tampered).producer_evidence, originalProof);
    assert.notEqual(originalProof.subject.canonical_xspec_sha256, xspec.integrity.canonical_sha256);
    const result = fixture.xspec.validate(fixture.project, tampered);
    assert.equal(result.integrity_valid, true); assert.equal(result.package_manifest_valid, true);
    assert.equal(result.package_valid, false);
    assert.ok(result.errors.some(error => error.code === "XSPEC_PRODUCER_EVIDENCE_MISMATCH"));
  }
});

test("J02: three modes remain exact, and unavailable higher assurance is NOT_READY", () => {
  const rows = [["FAST_VALIDATION", "prototype", "PROTOTYPE_READY"], ["FAST_DEVELOPMENT", "quick_verified", "BUILD_READY"],
    ["PRODUCT_GRADE", "full_governance", "PRODUCT_SPEC_READY"]] as const;
  for (const [mode, profile, target] of rows) {
    const fixture = buildFixture({mode}), result = fixture.xspec.finalizeForExport(fixture.project), xspec = document(result.artifact);
    const consumer = importForConsumer(xspec, "XDEV");
    assert.equal(consumer.project_mode, mode); assert.equal(consumer.mapped_profile, profile);
    assert.equal(xspec.delivery_profile.readiness_target, target);
    assert.equal(consumer.validation_scope, "LOCAL_CONFORMANCE"); assert.equal(consumer.downstream_receipt, "NOT_OBSERVED");
    assert.equal(consumer.implementation_authorized, false); assert.equal(consumer.selection_provenance_authenticated, false);
    if (mode !== "FAST_VALIDATION") assert.equal((xspec.readiness as {status: string}).status, "NOT_READY");
  }
});

test("J02: package hash corruption and missing payloads are distinct from legal NOT_READY", () => {
  const fixture = buildFixture(), artifact = fixture.xspec.compile(fixture.project);
  const missing = structuredClone(artifact); missing.files.pop();
  assert.equal(fixture.xspec.validate(fixture.project, missing).package_valid, false);
  const corrupt = structuredClone(artifact); corrupt.files.find(file => file.path === "PRODUCT-VISION.md")!.content += "tampered";
  assert.equal(fixture.xspec.validate(fixture.project, corrupt).package_valid, false);
});

test("J02: valid scoped dispositions retain exact references and cannot turn local acceptance into permission", () => {
  for (const resolution of ["STUB_OR_SANDBOX", "UPGRADE_SCOPE", "UPGRADE_PROJECT", "DEFER_OR_EXCLUDE"] as const) {
    const fixture = buildFixture({riskResolution: resolution}), artifact = fixture.xspec.compile(fixture.project), xspec = document(artifact);
    const evidence = manifest(artifact).producer_evidence;
    assert.ok(evidence.scope_dispositions.length > 0);
    for (const scope of evidence.scope_dispositions) {
      const original = fixture.project.delivery_policy!.risk_overrides.find(row => row.id === scope.id)!;
      assert.equal(scope.resolution, resolution); assert.deepEqual(scope.scope_ids, original.scope_ids);
      assert.ok(scope.source_refs.some(ref => ref.type === "owner_action"));
      assert.equal(scope.event!.command_kind, "MODE_OVERRIDE_RESOLVED");
      assert.deepEqual(xspec.delivery_profile.scope_overrides.find(row => row.id === scope.id)!.scope_ids, scope.scope_ids);
    }
    assert.equal(importForConsumer(xspec, "XDEV").implementation_authorized, false);
    const bad = patchManifest(artifact, value => {value.producer_evidence.scope_dispositions[0]!.scope_ids = ["REQ-WRONG"];});
    assert.equal(fixture.xspec.validate(fixture.project, bad).package_valid, false);
  }
});

test("D4: recorded impacts, recommendations and links are projected without adoption or source mutation", () => {
  const fixture = buildFixture(); fixture.add(decisionCandidate(1), false);
  const before = fixture.project, digest = fingerprint(before), interview = new InterviewService();
  const brief = interview.moduleReview(before, "sorting", 3)!;
  const decision = before.items.find(row => row.id === "DEC-CHOICE-1")!;
  assert.deepEqual(brief.pending_decisions[0]!.options, decision.decision_detail!.options);
  assert.deepEqual(brief.pending_decisions[0]!.recommendation, decision.decision_detail!.recommendation);
  assert.deepEqual(brief.pending_decisions[0]!.linked_requirements, ["REQ-SORT"]);
  assert.equal(brief.review_brief.recommendations_status, "UNADOPTED"); assert.equal(brief.review_brief.confirmation_granted, false);
  brief.pending_decisions[0]!.options[0]!.impact.user_experience = "Changed preview copy";
  assert.equal(fingerprint(before), digest); assert.equal(fingerprint(fixture.project), digest);
  assert.equal(decision.decision_detail!.owner_selection, null);
  assert.throws(() => fixture.apply({kind: "DECISION_APPROVED", item_id: decision.id, selected_option_id: "LEFT",
    fingerprint: itemFingerprint(decision), owner_action: {intent: "APPROVE_DECISION", source_ref: syntheticSource("unauthorized-agent")}}, "agent"));
});

test("D4: actual 1-8 limits, displayed/remaining counts and subsequent confirmed progress agree", () => {
  const fixture = buildFixture();
  const interview = new InterviewService();
  const empty = interview.moduleReview(fixture.project, "sorting", 3)!;
  assert.equal(empty.total_pending_decisions, 0); assert.equal(empty.displayed_pending_decisions, 0);
  assert.equal(empty.remaining_pending_decisions, 0); assert.equal(empty.pending_decisions_truncated, false);
  for (let i = 1; i <= 3; i++) fixture.add(decisionCandidate(i), false);
  const three = interview.moduleReview(fixture.project, "sorting", 3)!;
  assert.equal(three.pending_decisions.length, 3); assert.equal(three.remaining_pending_decisions, 0);
  assert.equal(three.pending_decisions_truncated, false);
  for (let i = 4; i <= 9; i++) fixture.add(decisionCandidate(i), false);
  for (const limit of [1, 3, 8]) {
    const brief = interview.moduleReview(fixture.project, "sorting", limit)!;
    assert.equal(brief.review_brief.decision_limit, limit); assert.equal(brief.pending_decisions.length, limit);
    assert.equal(brief.displayed_pending_decisions, limit); assert.equal(brief.remaining_pending_decisions, 9 - limit);
    assert.equal(brief.pending_decisions_truncated, true);
  }
  const item = fixture.project.items.find(row => row.id === "DEC-CHOICE-1")!;
  fixture.apply({kind: "DECISION_APPROVED", item_id: item.id, selected_option_id: "LEFT", fingerprint: itemFingerprint(item),
    owner_action: {intent: "APPROVE_DECISION", source_ref: syntheticSource("adopt-choice-1")}}, "owner");
  const after = interview.moduleReview(fixture.project, "sorting", 8)!;
  assert.equal(after.total_pending_decisions, 8); assert.equal(after.pending_decisions_truncated, false);
  assert.equal(after.pending_decisions.some(row => row.id === item.id), false);
  for (const limit of [0, 100, NaN, 2.9]) {
    const brief = interview.moduleReview(fixture.project, "sorting", limit)!;
    assert.ok(brief.pending_decisions.length <= brief.review_brief.decision_limit);
    assert.ok(brief.review_brief.decision_limit >= 1 && brief.review_brief.decision_limit <= 8);
  }
});

test("J02: withdrawing a scope disposition does not emit stale source authority or mutate old artifacts", () => {
  const fixture = buildFixture({riskResolution: "STUB_OR_SANDBOX"}), old = fixture.xspec.compile(fixture.project), oldHash = fingerprint(old);
  const dispositions = [...fixture.project.delivery_policy!.risk_overrides];
  for (const row of dispositions) fixture.apply({kind: "MODE_OVERRIDE_RETRACTED", override_id: row.id,
    reason: "Synthetic explicit withdrawal", owner_action: {intent: "RETRACT_OVERRIDE", source_ref: syntheticSource("withdraw:" + row.id)}}, "owner");
  const current = fixture.xspec.compile(fixture.project);
  assert.deepEqual(manifest(current).producer_evidence.scope_dispositions, []);
  assert.equal(fingerprint(old), oldHash);
  assert.equal(fixture.xspec.validate(fixture.project, current).package_valid, false);
});

test("D4: absent recorded choices stay unavailable and long question previews remain explicit", () => {
  const fixture = buildFixture(), candidate = decisionCandidate(1);
  candidate.decision_detail!.question = "x".repeat(600); fixture.add(candidate, false);
  fixture.add({id: "CON-OPEN", type: "constraint", statement: "An unresolved effect needs an answer.", status: "OPEN",
    tags: ["module:sorting"], source_refs: [{type: "document", ref: "fixture:open-question"}]}, false);
  const brief = new InterviewService().moduleReview(fixture.project, "sorting", 8)!;
  assert.equal(brief.pending_decisions.find(row => row.id === candidate.id)!.question_truncated, true);
  const open = brief.pending_decisions.find(row => row.id === "CON-OPEN")!;
  assert.deepEqual(open.options, []); assert.equal(open.recommendation, null); assert.equal(open.why_it_matters, null);
});

