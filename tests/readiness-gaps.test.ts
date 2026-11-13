import test from "node:test";
import assert from "node:assert/strict";
import {AuditService} from "../packages/core/audit-service.ts";
import {CompletenessService} from "../packages/core/completeness-service.ts";
import {canonical} from "../packages/core/validation.ts";
import {reviewProject} from "./fixtures/spec-review-project.ts";

test("confirmed current integration exclusions satisfy integration applicability without another Owner event", () => {
  for (const statement of [
    "No external integrations in the first version scope.",
    "No external integrations are used in V0.",
    "No external services for the current release.",
    "不接入外部服务或 API。",
  ]) {
    const project = reviewProject();
    project.items.find(item => item.id === "EXCL-REVIEW")!.statement = statement;
    const before = canonical(project);
    const result = new CompletenessService().evaluate(project);
    assert.equal(result.hard_gates.find(gate => gate.gate === 10)?.status, "PASS", statement);
    for (const id of ["state.integration-unavailable", "integration.provider-fallback", "security.secret-handling"]) {
      const row = result.profile_results.find(row => row.rule_id === id)!;
      assert.equal(row.applicability, "NOT_APPLICABLE", statement + " / " + id);
      assert.equal(row.confirmed, true);
      assert.deepEqual(row.evidence_ids, ["EXCL-REVIEW"]);
    }
    const audit = new AuditService().run(project);
    assert.equal(audit.independent_review_status, "UNAVAILABLE");
    assert.equal(result.mode_gates.find(gate => gate.gate === 103)?.status, "FAIL");
    assert.equal(canonical(project), before);
  }
});

test("not-applicable profile rows retain the confirmed scope decision as audit provenance", () => {
  const project = reviewProject();
  project.items.push({...project.items.find(item => item.id === "EXCL-REVIEW")!, id: "EXCL-COMMERCIAL",
    statement: "Free local demo.", tags: ["profile-applicability:commercial:not-applicable"]});
  const before = canonical(project);
  const result = new CompletenessService().evaluate(project);
  for (const id of ["commercial.free-paid", "commercial.subscription", "commercial.payment-failure", "commercial.usage-limits"]) {
    const row = result.profile_results.find(row => row.rule_id === id)!;
    assert.equal(row.applicability, "NOT_APPLICABLE", id);
    assert.equal(row.confirmed, true, id);
    assert.equal(row.considered, true, id);
    assert.deepEqual(row.evidence_ids, ["EXCL-COMMERCIAL"], id);
  }
  project.items.find(item => item.id === "EXCL-COMMERCIAL")!.status = "PROPOSED";
  const proposed = new CompletenessService().evaluate(project);
  assert.notEqual(proposed.profile_results.find(row => row.rule_id === "commercial.free-paid")?.applicability, "NOT_APPLICABLE");
  project.items.find(item => item.id === "EXCL-COMMERCIAL")!.status = "CONFIRMED";
  assert.equal(canonical(project), before);
});

test("questions, proposals, exceptions and independent positive clauses keep integration decisions open", () => {
  for (const statement of [
    "No external integrations except email notifications.",
    "No external integrations in the first version scope, but email notifications are required.",
    "No external integrations in the first version scope. Send email notifications.",
    "是否不接入外部服务或 API？",
  ]) {
    const project = reviewProject();
    project.items.find(item => item.id === "EXCL-REVIEW")!.statement = statement;
    const result = new CompletenessService().evaluate(project);
    assert.notEqual(result.profile_results.find(row => row.rule_id === "integration.provider-fallback")?.applicability,
      "NOT_APPLICABLE", statement);
  }
  const project = reviewProject();
  project.items.find(item => item.id === "EXCL-REVIEW")!.status = "PROPOSED";
  const pending = new CompletenessService().evaluate(project);
  assert.equal(pending.profile_results.find(row => row.rule_id === "integration.provider-fallback")?.applicability, "UNRESOLVED");
  project.items.find(item => item.id === "EXCL-REVIEW")!.status = "CONFIRMED";
  project.items.push({...project.items.find(item => item.id === "REQ-REVIEW")!, id: "REQ-LIVE-EMAIL",
    statement: "Send email notifications.", links: []});
  const conflict = new CompletenessService().evaluate(project);
  assert.equal(conflict.profile_results.find(row => row.rule_id === "integration.provider-fallback")?.applicability, "UNRESOLVED");
  assert.equal(conflict.hard_gates.find(gate => gate.gate === 10)?.status, "FAIL");
});

test("unambiguous confirmed actor, flow, public-data scope and browser constraints are reused as profile evidence", () => {
  const project = reviewProject();
  const result = new CompletenessService().evaluate(project);
  for (const id of ["product.primary-user", "product.core-journey", "security.data-sensitivity", "nfr.devices-browsers"]) {
    assert.equal(result.profile_results.find(row => row.rule_id === id)?.confirmed, true, id);
  }
  for (const [type, ruleId] of [["actor", "product.primary-user"], ["flow", "product.core-journey"]] as const) {
    const competing = structuredClone(project);
    competing.items.push({...competing.items.find(item => item.type === type)!, id: "OTHER-" + type, status: "PROPOSED"});
    assert.equal(new CompletenessService().evaluate(competing).profile_results.find(row => row.rule_id === ruleId)?.confirmed, false);
    const uncertain = structuredClone(project);
    uncertain.items.find(item => item.type === type)!.statement = "Undecided?";
    assert.equal(new CompletenessService().evaluate(uncertain).profile_results.find(row => row.rule_id === ruleId)?.confirmed, false);
  }
});
