import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {AuditService} from "../packages/core/audit-service.ts";
import {CompletenessService, evaluateRisk, riskResolutionRevision} from "../packages/core/completeness-service.ts";
import type {M8ReadinessEvidence} from "../packages/core/completeness-service.ts";
import {SolutionService} from "../packages/core/solution-service.ts";
import {XSpecService} from "../packages/core/xspec-service.ts";
import {canonical} from "../packages/core/validation.ts";
import type {DeliveryMode, Item, Project} from "../packages/shared-types/domain.ts";
import {metadata, inputs} from "../apps/mcp-server/contracts.ts";

const now = "2026-09-18T10:00:00.000Z";
const source = {type: "owner_action" as const, ref: "fixture:m8-owner"};
const auditor = new AuditService();
const completeness = new CompletenessService();
const xspecs = new XSpecService();

test("M8 payment exclusion applies only to complete current confirmed scope and does not waive independent review", () => {
  const p = baseProject("FAST_DEVELOPMENT");
  p.items.push(confirmed("REQ-PAY-SCOPE", "functional_requirement", "Payment is outside this release."));
  const risk = evaluateRisk(p).findings.find((entry) => entry.reason_code === "PAYMENT_OR_FINANCIAL")!;
  const override = {id: risk.override_id, scope_ids: [...risk.scope_ids], minimum_mode: risk.minimum_mode,
    reason_code: risk.reason_code, rationale: "Owner defers this exact scope", status: "CONFIRMED" as const,
    resolution: "DEFER_OR_EXCLUDE", source_refs: [source, riskResolutionRevision]};
  const blocked = (project: Project) => auditor.run(project).findings.some((entry) => entry.category === "PAYMENT_FAILURE");
  assert.equal(blocked(p), true);
  p.delivery_policy!.risk_overrides.push(override);
  assert.equal(blocked(p), false);
  assert.equal(completeness.evaluate(p).profile_results.find((row) => row.rule_id === "commercial.payment-failure")?.applicability, "NOT_APPLICABLE");
  assert.equal(auditor.run(p).independent_review_status, "UNAVAILABLE");
  for (const resolution of ["STUB_OR_SANDBOX", "UPGRADE_SCOPE", "UPGRADE_PROJECT"]) {
    const changed = structuredClone(p);
    changed.delivery_policy!.risk_overrides.at(-1)!.resolution = resolution;
    assert.equal(blocked(changed), true, resolution);
  }
  for (const change of [
    (value: Project) => { value.delivery_policy!.risk_overrides.at(-1)!.status = "RETRACTED"; },
    (value: Project) => { value.delivery_policy!.risk_overrides.at(-1)!.scope_ids = []; },
    (value: Project) => { value.items.push(confirmed("REQ-NEW-PAY", "functional_requirement", "Payment checkout")); },
    (value: Project) => { value.items.push(confirmed("REQ-NEW-CHARGE", "functional_requirement", "自动扣款")); },
    (value: Project) => { value.items.find((item) => item.id === "REQ-PAY-SCOPE")!.status = "PROPOSED"; },
  ]) {
    const changed = structuredClone(p); change(changed);
    assert.notEqual(completeness.evaluate(changed).profile_results.find((row) => row.rule_id === "commercial.payment-failure")?.applicability, "NOT_APPLICABLE");
    if (changed.items.find((item) => item.id === "REQ-PAY-SCOPE")!.status === "CONFIRMED") assert.equal(blocked(changed), true);
  }
});

test("M8 account closure aliases are shared by audit and profile, while deletion deferral alone is insufficient", () => {
  for (const statement of ["关闭账户后撤销访问并保留审计记录", "停用账号后禁止登录", "禁用账户后保留记录"]) {
    const p = baseProject();
    p.items = p.items.filter((item) => !["REQ-DELETE-M8", "AC-DELETE-M8"].includes(item.id));
    p.items.push(confirmed("REQ-CLOSE", "functional_requirement", statement));
    assert.equal(auditor.run(p).findings.some((row) => row.category === "ACCOUNT_DELETION"), false);
    assert.equal(completeness.evaluate(p).profile_results.find((row) => row.rule_id === "identity.account-deletion")?.confirmed, true);
    p.items.at(-1)!.statement = "永久删除后置";
    assert.equal(auditor.run(p).findings.some((row) => row.category === "ACCOUNT_DELETION"), true);
    p.items.at(-1)!.statement = statement;
    p.items.at(-1)!.status = "PROPOSED";
    assert.equal(auditor.run(p).findings.some((row) => row.category === "ACCOUNT_DELETION"), true);
  }
});

function confirmed(id: string, type: Item["type"], statement: string, options: Partial<Item> = {}): Item {
  return {id, type, statement, status: "CONFIRMED", source_refs: [source], priority: "P1", version: 1,
    created_at: now, updated_at: now, confirmed_by: "owner", confirmed_at: now, ...options};
}

function baseProject(mode: DeliveryMode = "FAST_VALIDATION"): Project {
  const p: Project = {schema_version: "0.2.0", project_id: "XMI-M8-FIXTURE", xspec_id: "XSPEC-M8-FIXTURE",
    title: "M8 fixture", profile: "web-micro-saas-v0", lifecycle_state: "SOLUTION_REVIEW", model_version: 40,
    delivery_policy: {requested_mode: mode, effective_mode: mode,
      readiness_target: mode === "FAST_VALIDATION" ? "PROTOTYPE_READY" : mode === "FAST_DEVELOPMENT" ? "BUILD_READY" : "PRODUCT_SPEC_READY",
      selection_source: "OWNER_CONFIRMED", selected_at: now,
      history: [{from_mode: null, to_mode: mode, reason: "fixture", changed_by: "owner", changed_at: now}], risk_overrides: []},
    items: [
      confirmed("VISION-M8", "vision", "Help small teams record catalog entries and verify the saved result.", {priority: "P0", tags: ["problem", "outcome"]}),
      confirmed("ACTOR-M8", "actor", "A small-team operator is the primary user.", {priority: "P0", tags: ["primary-user"]}),
      confirmed("GOAL-M8", "goal", "Save a catalog entry and see it on reload.", {priority: "P0"}),
      confirmed("EXC-M8", "exclusion", "The first version is limited to the core catalog workflow.", {tags: ["scope", "mvp"]}),
      confirmed("FLOW-M8", "flow", "The operator signs in, creates a catalog entry and sees the saved result.", {priority: "P0", tags: ["core"], links: ["ACTOR-M8", "REQ-M8"]}),
      confirmed("REQ-M8", "functional_requirement", "An account user can save a catalog entry in only their own tenant workspace.", {priority: "P0", links: ["FLOW-M8"]}),
      confirmed("AC-M8", "acceptance_criterion", "Given valid input, saving persists the entry and invalid input creates no record.", {priority: "P0", links: ["REQ-M8"], tags: ["automated"]}),
      confirmed("REQ-DELETE-M8", "functional_requirement", "A user can delete their account and request removal of owned catalog records.", {priority: "P2", links: []}),
      confirmed("AC-DELETE-M8", "acceptance_criterion", "When account deletion is confirmed, access is revoked and the deletion workflow is recorded.", {priority: "P2", links: ["REQ-DELETE-M8"], tags: ["manual"]}),
      confirmed("PERM-M8", "permission_rule", "Role permissions enforce tenant isolation so each user accesses only their own tenant records.", {priority: "P0", tags: ["role", "permission", "isolation"]}),
      confirmed("DATA-M8", "data_entity", "Catalog records persist between sessions and are owned by the tenant.", {tags: ["data-sensitivity", "ownership", "persistence"]}),
      confirmed("SOLCON-M8", "solution_constraint", "Use a cloud-hosted browser web boundary for the prototype.", {tags: ["deployment", "local-cloud"]}),
      confirmed("NFR-SCALE-M8", "non_functional_requirement", "Pilot scale is about 100 active users with sub-second interaction targets.", {tags: ["scale", "latency"]}),
      confirmed("INT-M8", "integration", "Email API integration has an explicit fallback when the provider is unavailable.", {tags: ["provider", "fallback"]}),
      confirmed("NFR-COST-M8", "non_functional_requirement", "Keep operating cost and maintenance burden low for the Owner.", {tags: ["cost", "maintenance"]}),
      confirmed("NFR-PLATFORM-M8", "non_functional_requirement", "Support modern desktop and mobile web browsers.", {tags: ["platform", "browser"]}),
      confirmed("CONSTRAINT-COMMERCIAL-M8", "constraint", "V0 has a free and paid product boundary without live charging in this fixture.", {tags: ["pricing", "commercial"]}),
      confirmed("CONSTRAINT-RISKCLASS-M8", "constraint", "The fixture is an ordinary low-consequence catalog domain.", {tags: ["high-risk"]}),
    ], open_questions: [], current_xspec_version: null, created_at: now, updated_at: now};
  const auth = evaluateRisk(p).findings.find((finding) => finding.reason_code === "AUTH_OR_PRIVATE_DATA");
  assert.ok(auth);
  p.delivery_policy!.risk_overrides.push({id: auth.override_id, scope_ids: [...auth.scope_ids], minimum_mode: auth.minimum_mode,
    reason_code: auth.reason_code, rationale: auth.rationale, status: "CONFIRMED", resolution: "STUB_OR_SANDBOX", source_refs: [source, riskResolutionRevision]});
  const proposal = new SolutionService().propose(p, {type: "system_rule", ref: "fixture:m8-solution"});
  assert.ok(proposal.blueprint_detail);
  proposal.blueprint_detail.owner_disposition = "APPROVED";
  p.items.push({...proposal, status: "CONFIRMED", version: 1, created_at: now, updated_at: now,
    confirmed_by: "owner", confirmed_at: now});
  return p;
}

function evidence(mode: DeliveryMode, audit: "PASS" | "FAIL" | "UNAVAILABLE" = "UNAVAILABLE"): M8ReadinessEvidence {
  const assurance = mode === "FAST_VALIDATION" ? "BASIC_SELF_CHECK" : mode === "FAST_DEVELOPMENT" ? "INDEPENDENT_SPEC_REVIEW" : "INDEPENDENT_PRODUCT_AUDIT";
  return {xui_compatible: true, xdev_compatible: true, owner_confirmed_export: true, immutable_export_exists: true,
    audit: {audit_run_id: audit === "UNAVAILABLE" ? null : "AUDIT-M8-VERIFIED", audit_status: audit === "PASS" ? "PASS" : audit === "FAIL" ? "BLOCKING" : "UNAVAILABLE",
      isolation_status: audit === "UNAVAILABLE" ? "UNAVAILABLE" : "BOUNDED_SNAPSHOT_FALLBACK", assurance_level: audit === "UNAVAILABLE" ? null : assurance,
      blocking_finding_count: audit === "FAIL" ? 1 : 0}};
}
function auditEvidence(project: Project): M8ReadinessEvidence {
  const result = auditor.run(project);
  return {xui_compatible: true, xdev_compatible: true, owner_confirmed_export: true, immutable_export_exists: true,
    audit: {audit_run_id: result.audit_run_id,
      audit_status: result.deterministic_status === "BLOCKING" ? "BLOCKING" : "UNAVAILABLE",
      isolation_status: result.isolation_status, assurance_level: result.assurance_level,
      blocking_finding_count: result.findings.filter((finding) => finding.severity === "BLOCKING").length}};
}

test("M8 Auditor is read-only over Product Model bytes and generated IDs satisfy declared patterns", () => {
  const p = baseProject();
  const before = canonical(p); const version = p.model_version;
  const result = auditor.run(p);
  assert.equal(canonical(p), before);
  assert.equal(p.model_version, version);
  assert.equal(result.state_unchanged, true);
  assert.match(result.audit_run_id, /^AUDIT-[A-Z0-9-]+$/);
  for (const finding of result.findings) assert.match(finding.id, /^AUDIT-FINDING-[A-Z0-9-]+$/);
  assert.equal(result.independent_review_status, "UNAVAILABLE", "candidate must not fabricate independent-host isolation/LLM evidence");
});

test("M8 gates 13, 103 and 104 are real judgements with PASS and FAIL paths", () => {
  const fd = baseProject("FAST_DEVELOPMENT");
  const fdPass = completeness.evaluate(fd, [], evidence("FAST_DEVELOPMENT", "PASS"));
  const fdFail = completeness.evaluate(fd, [], evidence("FAST_DEVELOPMENT", "UNAVAILABLE"));
  assert.equal(fdPass.hard_gates.find((gate) => gate.gate === 13)?.status, "PASS");
  assert.equal(fdPass.mode_gates.find((gate) => gate.gate === 103)?.status, "PASS");
  assert.equal(fdFail.hard_gates.find((gate) => gate.gate === 13)?.status, "FAIL");
  assert.equal(fdFail.mode_gates.find((gate) => gate.gate === 103)?.status, "FAIL");
  const pg = baseProject("PRODUCT_GRADE");
  const pgPass = completeness.evaluate(pg, [], evidence("PRODUCT_GRADE", "PASS"));
  const pgFail = completeness.evaluate(pg, [], evidence("PRODUCT_GRADE", "FAIL"));
  assert.equal(pgPass.mode_gates.find((gate) => gate.gate === 104)?.status, "PASS");
  assert.equal(pgFail.mode_gates.find((gate) => gate.gate === 104)?.status, "FAIL");
  assert.equal([...fdPass.hard_gates, ...fdPass.mode_gates, ...pgPass.hard_gates, ...pgPass.mode_gates]
    .filter((gate) => [13, 103, 104].includes(gate.gate)).some((gate) => gate.status === "DEFERRED"), false);
});

test("M8 hard_gate_ready is computed only from gates; FAST_VALIDATION cannot claim a higher level", () => {
  const p = baseProject("FAST_VALIDATION");
  const ready = completeness.evaluate(p, [], evidence("FAST_VALIDATION", "UNAVAILABLE"));
  assert.equal(ready.hard_gate_ready, true, JSON.stringify([...ready.hard_gates, ...ready.mode_gates].filter((g) => g.status !== "PASS")));
  assert.equal(ready.readiness_status, "READY_FOR_XDEV");
  assert.equal(ready.target, "PROTOTYPE_READY");
  const artifact = xspecs.compile(p, evidence("FAST_VALIDATION", "UNAVAILABLE"));
  const doc = JSON.parse(artifact.files.find((file) => file.path === "xspec.json")!.content) as {readiness: {status: string; target_level: string; achieved_level: string | null}};
  assert.equal(doc.readiness.status, "READY_FOR_XDEV");
  assert.equal(doc.readiness.target_level, "PROTOTYPE_READY");
  assert.equal(doc.readiness.achieved_level, "PROTOTYPE_READY");
  assert.notEqual(doc.readiness.achieved_level, "BUILD_READY");
  assert.notEqual(doc.readiness.achieved_level, "PRODUCT_SPEC_READY");
});

type Adversarial = {id: string; kind: string; mutation: string; expected_category: string; expected: "NOT_READY"};
const adversarial = JSON.parse(readFileSync("tests/fixtures/m8-adversarial-fixtures.json", "utf8")) as Adversarial[];
function mutateFixture(input: Project, mutation: string): Project {
  const p = structuredClone(input);
  const add = (item: Item) => p.items.push(item);
  if (mutation === "ADD_HIDDEN_ASSUMPTION") add({id: "REQ-ASSUMED-M8", type: "functional_requirement", statement: "Assume a material P0 behavior without Owner confirmation.",
    status: "ASSUMED", source_refs: [{type: "system_rule", ref: "fixture:m8-assumption"}], priority: "P0", version: 1, created_at: now, updated_at: now});
  else if (mutation === "REMOVE_DATA_ISOLATION") {
    // The mutation must actually remove the isolation declaration, not just one carrier of it.
    // Dropping PERM-M8 alone left REQ-M8 still stating "only their own tenant workspace", so the
    // auditor's DATA_ISOLATION rule correctly stayed silent: the fixture never created the state it
    // claimed. Removing the permission rule and neutralising the requirement that keeps declaring
    // tenant ownership is what a project with account scope and no isolation rule looks like.
    p.items = p.items.filter((item) => item.id !== "PERM-M8");
    p.items.find((item) => item.id === "REQ-M8")!.statement = "An account user can save a catalog entry.";
  }
  else if (mutation === "REMOVE_ACCOUNT_DELETION") p.items = p.items.filter((item) => item.id !== "REQ-DELETE-M8" && item.id !== "AC-DELETE-M8");
  else if (mutation === "ADD_PAYMENT_SUCCESS_ONLY") add(confirmed("REQ-PAY-SUCCESS-M8", "functional_requirement", "A successful payment activates the paid plan.", {priority: "P2", links: []}));
  else if (mutation === "ADD_UNTESTABLE_SMART_AI") add(confirmed("REQ-SMART-AI-M8", "functional_requirement", "The product provides a smart AI assistant.", {priority: "P2", links: []}));
  else if (mutation === "ADD_ROLE_CONTRADICTION") p.open_questions.push({id: "OPEN-ROLE-M8", question: "Which role may access the tenant record?", status: "BLOCKING",
    priority: "P0", reason: "Contradictory role and permission statements remain unresolved.", affected_ids: ["PERM-M8"]});
  else if (mutation === "MAKE_SOLUTION_OFFLINE_MISMATCH") {
    add(confirmed("CONSTRAINT-OFFLINE-M8", "constraint", "The product must work offline and remain local-only.", {tags: ["offline"]}));
    const bp = p.items.find((item) => item.type === "solution_blueprint" && item.blueprint_detail)!;
    bp.blueprint_detail!.deployment_topology = "Cloud managed web service with a server-side backend.";
    bp.blueprint_detail!.recommended_stack_profile = "Managed cloud web stack.";
  } else if (mutation === "ADD_STALE_MODEL_RESOLUTION") {
    const bp = p.items.find((item) => item.type === "solution_blueprint" && item.blueprint_detail)!;
    bp.blueprint_detail!.ai_capability_profile = {id: "AI-CAPABILITY-M8", modalities: ["TEXT"], latency: "interactive", quality_reasoning: "bounded",
      tool_use: "none", context_size: "bounded", privacy_data_residency: "tenant boundary", cost_envelope: "low",
      structured_output_reliability: "required", safety_constraints: "standard", offline_on_device_need: "none", unresolved_constraints: []};
    bp.blueprint_detail!.model_resolution = {id: "MODEL-RESOLUTION-M8", capability_profile_id: "AI-CAPABILITY-M8", provider: "Example",
      model: "Example-1", alternatives: [], resolved_at: "2026-09-17T00:00:00.000Z", source_version: "catalog-2026-09-17",
      capability_match: ["text"], pricing_privacy_assumptions: ["assumption"], revalidation_requirement: "Revalidate before XDev implementation."};
  } else if (mutation === "ADD_HIDDEN_BLOCKER") p.open_questions.push({id: "OPEN-BLOCK-M8", question: "Blocking product choice", status: "BLOCKING",
    priority: "P0", reason: "A polished specification still contains an unresolved blocker.", affected_ids: ["REQ-M8"]});
  else assert.fail(`Unknown mutation ${mutation}`);
  return p;
}

test("M8 false-readiness adversarial fixtures all remain NOT_READY and high score cannot override a blocker", () => {
  const baseline = baseProject("FAST_VALIDATION");
  const baseEval = completeness.evaluate(baseline, [], evidence("FAST_VALIDATION", "UNAVAILABLE"));
  assert.equal(baseEval.hard_gate_ready, true);
  for (const fixture of adversarial) {
    const p = mutateFixture(baseline, fixture.mutation);
    const audit = auditor.run(p);
    assert.ok(audit.findings.some((finding) => finding.category === fixture.expected_category), `${fixture.id}: ${JSON.stringify(audit.findings)}`);
    const result = completeness.evaluate(p, [], auditEvidence(p));
    assert.equal(result.hard_gate_ready, false, fixture.id);
    assert.equal(result.readiness_status, "NOT_READY_M8", fixture.id);
    if (fixture.id === "high-score-hidden-blocker") {
      assert.equal(result.score, baseEval.score, "adding a blocker does not lower the explanatory score, so the gate must do the blocking");
      assert.equal(result.hard_gates.find((gate) => gate.gate === 2)?.status, "FAIL");
    }
  }
});

test("F-11 confirmed P2 requirement without AC compiles as a visible candidate and fails validation actionably without weakening schema", () => {
  const p = baseProject();
  p.items.push(confirmed("REQ-F11-M8", "functional_requirement", "Optional P2 export note remains confirmed while its AC is still missing.", {priority: "P2", links: []}));
  const artifact = xspecs.compile(p);
  const doc = JSON.parse(artifact.files.find((file) => file.path === "xspec.json")!.content) as {requirements: Array<{id: string}>};
  assert.ok(doc.requirements.some((requirement) => requirement.id === "REQ-F11-M8"), "the confirmed requirement must not be silently dropped");
  const validation = xspecs.validate(p, artifact);
  const issue = validation.errors.find((error) => error.code === "XSPEC_REQUIREMENT_ACCEPTANCE_MISSING");
  assert.ok(issue, JSON.stringify(validation.errors));
  assert.match(issue.user_action, /acceptance criterion/i);
  assert.equal(validation.schema_valid, false);
  assert.equal(validation.package_valid, false);
  assert.throws(() => xspecs.finalizeForExport(p), /XSPEC_PACKAGE_INVALID/);
});

test("M8 audit/readiness MCP contracts are read-only computations; no hidden storage claim is encoded", () => {
  assert.ok(inputs.xmi_audit_run);
  assert.ok(inputs.xmi_readiness_evaluate);
  assert.equal(metadata.xmi_audit_run.write, false);
  assert.equal(metadata.xmi_readiness_evaluate.write, false);
  assert.equal(metadata.xmi_audit_run.destructive, false);
  assert.equal(metadata.xmi_readiness_evaluate.destructive, false);
});
