import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {ProjectService, replay} from "../packages/core/project-service.ts";
import {MemoryProjectStore} from "../packages/storage/memory.ts";
import {evaluateRisk, evaluateRiskLegacy, exclusionScopeIssues, invalidRiskOverrides, CompletenessService, riskResolutionRevision} from "../packages/core/completeness-service.ts";
import {itemFingerprint, modeFingerprint, fingerprint} from "../packages/core/validation.ts";
import type {Item, Project} from "../packages/shared-types/domain.ts";

const owner = {type: "owner_action" as const, ref: "fixture:risk-context"};
function fixture(statement = "Record evaluations") {
  const service = new ProjectService(new MemoryProjectStore());
  let p = service.create({idempotency_key: "create", title: "Risk scope", idea: statement, source_ref: owner}, "owner");
  const run = (command: unknown) => p = service.execute({project_id: p.project_id, expected_version: p.model_version,
    idempotency_key: "fixture-" + p.model_version, command}, "owner");
  run({kind: "DELIVERY_MODE_SELECTED", mode: "FAST_DEVELOPMENT", reason: "fixture",
    fingerprint: modeFingerprint(p, "FAST_DEVELOPMENT", "fixture"), owner_action: {intent: "CONFIRM", source_ref: owner}});
  run({kind: "ITEM_CONFIRMED", item_id: p.items[0]!.id, fingerprint: itemFingerprint(p.items[0]!), owner_action: {intent: "CONFIRM", source_ref: owner}});
  return {service, get: () => p, run};
}
function reasons(p: Project) {return evaluateRisk(p).findings.map(f => f.reason_code);}

test("operational terms and provenance tags do not create medical/destructive risks; actual behavior still does", () => {
  for (const statement of ["系统健康页和 readiness", "破坏性变化分类，变单位需新契约", "service health check; breaking changes classification"]) {
    const p = fixture(statement).get();
    p.items[0]!.tags = ["source:medical", "module:destructive", "ref:illegal"];
    assert.equal(reasons(p).includes("SENSITIVE_DATA"), false);
    assert.equal(reasons(p).includes("DESTRUCTIVE_ACTION"), false);
    assert.equal(reasons(p).includes("REGULATED_OR_HIGH_CONSEQUENCE"), false);
  }
  for (const statement of ["系统健康页，同时保存患者医疗记录", "breaking changes; permanently delete medical records", "破坏性变化分类；永久删除数据库"])
    assert.ok(reasons(fixture(statement).get()).some(r => ["SENSITIVE_DATA", "DESTRUCTIVE_ACTION"].includes(r)));
  for (const statement of ["未来支持支付", "是否删除医疗记录待定", "不处理个人数据", "记录用户健康数据", "用户健康页", "patient health dashboard", "system health endpoint shows personal health"])
    assert.ok(evaluateRisk(fixture(statement).get()).findings.length > 0, "ambiguous/deferred prose is not automatic risk approval");
});

test("mixed scope is named and cannot be excluded, but a separately scoped payment capability can", () => {
  for (const statement of ["本期支持用量统计；以后支持支付", "payment and inventory management", "保存评测报告，同时延期收费", "支付和用量统计", "本期用量统计，支付后置", "延期支付，保留退款", "defer payment but keep refund", "首期支持收费，以后支持退款", "本期影子计费不收费", "shadow billing with real payment disabled"] ) {
    const f = fixture(statement), p = f.get(), finding = evaluateRisk(p).findings.find(r => r.reason_code === "PAYMENT_OR_FINANCIAL")!;
    assert.deepEqual(finding.exclusion_requires_split_ids, [p.items[0]!.id]);
    assert.throws(() => f.run({kind: "MODE_OVERRIDE_RESOLVED", override_id: finding.override_id, resolution: "DEFER_OR_EXCLUDE",
      rationale: "Only future payments are excluded", owner_action: {intent: "RESOLVE_OVERRIDE", source_ref: owner}}), /RISK_SCOPE_SPLIT_REQUIRED/);
    assert.deepEqual(f.service.get(p.project_id), p);
  }
  const f = fixture("支付功能延期"), p = f.get(), finding = evaluateRisk(p).findings[0]!;
  f.run({kind: "MODE_OVERRIDE_RESOLVED", override_id: finding.override_id, resolution: "DEFER_OR_EXCLUDE",
    rationale: "首期完全排除这条支付能力，其他功能保留。", owner_action: {intent: "RESOLVE_OVERRIDE", source_ref: owner}});
  assert.equal(f.get().delivery_policy!.risk_overrides[0]!.rationale, "首期完全排除这条支付能力，其他功能保留。");
  assert.equal(invalidRiskOverrides(f.get()).length, 0);
  assert.equal(f.service.history(p.project_id).at(-1)!.command.kind, "MODE_OVERRIDE_RESOLVED");
  assert.deepEqual(replay(f.service.history(p.project_id)), f.get());
  const legacy = structuredClone(f.get());
  legacy.delivery_policy!.risk_overrides[0]!.source_refs.pop();
  assert.equal(evaluateRisk(legacy).findings[0]!.status, "BLOCKING", "unchanged legacy scope still needs its exact Owner rationale reviewed");
  assert.equal(invalidRiskOverrides(legacy).length, 1);
});

test("legacy pre-fix event chain reproduces the exact old snapshot and rationale; re-evaluation flags the obsolete disposition", () => {
  const old = JSON.parse(readFileSync("tests/fixtures/risk-legacy-v1.json", "utf8"));
  assert.deepEqual(replay(old.events), old.snapshot);
  assert.equal(fingerprint(replay(old.events)), fingerprint(old.snapshot));
  assert.equal(evaluateRiskLegacy(old.snapshot).findings.length, 1);
  assert.equal(evaluateRisk(old.snapshot).findings.length, 0);
  assert.deepEqual(invalidRiskOverrides(old.snapshot), [old.snapshot.delivery_policy.risk_overrides[0].id]);
  assert.ok(new CompletenessService().evaluate(old.snapshot).blockers.some(b => b.id.startsWith("BLOCK-RISK-REVIEW-")));
});

test("legacy blueprint approval replays with the original risk rules, while current evaluation requests a fresh disposition", () => {
  const old = JSON.parse(readFileSync("tests/fixtures/risk-legacy-blueprint-v1.json", "utf8"));
  assert.deepEqual(replay(old.events), old.snapshot);
  assert.equal(evaluateRiskLegacy(old.snapshot).unresolved_blocker_count, 0);
  assert.equal(evaluateRisk(old.snapshot).unresolved_blocker_count, 1);
  assert.equal(invalidRiskOverrides(old.snapshot).length, 1);
});

test("risk scopes contain every active matching item beyond 50 and changes invalidate old dispositions", () => {
  const p = fixture().get(), template = p.items[0]!;
  p.items = Array.from({length: 65}, (_, n): Item => ({...template, id: "PAY-" + n, statement: "Payment processing"}));
  let finding = evaluateRisk(p).findings[0]!;
  assert.equal(finding.scope_ids.length, 65);
  p.delivery_policy!.risk_overrides.push({id: finding.override_id, scope_ids: finding.scope_ids,
    minimum_mode: finding.minimum_mode, reason_code: finding.reason_code, rationale: "Sandbox", status: "CONFIRMED", resolution: "STUB_OR_SANDBOX", source_refs: [owner, riskResolutionRevision]});
  assert.equal(evaluateRisk(p).findings[0]!.status, "RESOLVED_BY_OVERRIDE");
  p.items[0]!.status = "PROPOSED";
  assert.equal(evaluateRisk(p).findings[0]!.status, "BLOCKING");
  assert.equal(invalidRiskOverrides(p).length, 1);
  p.items[0]!.status = "CONFIRMED";
  p.items.push({...template, id: "PAY-NEW", statement: "Payment refund", status: "PROPOSED"});
  finding = evaluateRisk(p).findings[0]!;
  assert.equal(finding.status, "BLOCKING");
  assert.equal(invalidRiskOverrides(p).length, 1);
  p.items.at(-1)!.status = "REJECTED";
  assert.equal(evaluateRisk(p).findings[0]!.scope_ids.length, 65);
  assert.deepEqual(exclusionScopeIssues(p, ["MISSING"], "PAYMENT_OR_FINANCIAL"), ["MISSING"]);
});
