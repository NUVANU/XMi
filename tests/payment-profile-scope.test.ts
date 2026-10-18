import test from "node:test";
import assert from "node:assert/strict";
import {CompletenessService, evaluateRisk, riskResolutionRevision} from "../packages/core/completeness-service.ts";
import {AuditService} from "../packages/core/audit-service.ts";
import {ProjectService} from "../packages/core/project-service.ts";
import {MemoryProjectStore} from "../packages/storage/memory.ts";
import type {Item, Project} from "../packages/shared-types/domain.ts";

const source = {type: "owner_action" as const, ref: "fixture:payment-profile"};
const now = "2026-10-16T00:00:00.000Z";
function item(id: string, type: Item["type"], statement: string, status: Item["status"] = "CONFIRMED"): Item {
  return {id, type, statement, status, source_refs: [source], version: 1, created_at: now, updated_at: now,
    ...(status === "CONFIRMED" ? {confirmed_by: "owner", confirmed_at: now} : {})};
}
function project(items: Item[]): Project {
  const p = new ProjectService(new MemoryProjectStore()).create({idempotency_key: "create", title: "Scope fixture", idea: "Record reviews", source_ref: source});
  p.items = items;
  p.delivery_policy = {requested_mode: "FAST_DEVELOPMENT", effective_mode: "FAST_DEVELOPMENT", readiness_target: "BUILD_READY",
    selection_source: "OWNER_CONFIRMED", selected_at: now, history: [], risk_overrides: []};
  return p;
}
const completeness = new CompletenessService(), audit = new AuditService();
const row = (p: Project, key = "commercial.payment-failure") => completeness.evaluate(p).profile_results.find(r => r.rule_id === key)!;
const paymentFindings = (p: Project) => audit.run(p).findings.filter(f => f.category.startsWith("PAYMENT_"));
const exclusion = () => item("EXCL-PAY", "exclusion", "真实支付及其配套扣款、退款与失败处理流程均后置。");

test("profile recognizes confirmed explicit synthetic scope, not vague, questioned, negated or unconfirmed scope", () => {
  for (const statement of ["首期评测资料仅使用公开合成案例。", "数据范围：仅采用公开的合成数据。", "本期案例全部为公开合成案例。"])
    assert.deepEqual(row(project([item("SCOPE", "constraint", statement)]), "security.data-sensitivity").evidence_ids, ["SCOPE"]);
  for (const statement of ["公开合成案例", "是否仅使用公开合成案例？", "资料不只使用公开合成案例。", "资料仅使用公开合成案例吗？"])
    assert.equal(row(project([item("SCOPE", "constraint", statement)]), "security.data-sensitivity").considered, false, statement);
  for (const status of ["PROPOSED", "ASSUMED", "INFERRED", "OPEN", "BLOCKING", "REJECTED", "SUPERSEDED"] as const)
    assert.equal(row(project([item("SCOPE", "constraint", "资料仅使用公开合成案例。", status)]), "security.data-sensitivity").confirmed, false, status);
  assert.equal(row(project([item("SCOPE", "vision", "资料仅使用公开合成案例。")]), "security.data-sensitivity").considered, false);
});

test("only confirmed relevant high-risk data exclusions evidence regulated scope without removing risk", () => {
  const medical = item("EXCL-DATA", "exclusion", "真实医疗健康资料或生物识别资料接入能力后置。");
  const p = project([medical]);
  assert.deepEqual(row(p, "security.regulated-risk").evidence_ids, [medical.id]);
  assert.equal(row(p, "security.regulated-risk").confirmed, true);
  assert.ok(evaluateRisk(p).findings.some(f => f.reason_code === "SENSITIVE_DATA" && f.status === "BLOCKING"));
  for (const status of ["PROPOSED", "ASSUMED", "INFERRED", "REJECTED", "SUPERSEDED"] as const) {
    medical.status = status;
    assert.equal(row(p, "security.regulated-risk").considered, false, status);
  }
  medical.status = "CONFIRMED";
  for (const statement of ["支付后置。", "是否排除医疗资料？", "医疗资料", "模块健康检查后置。"]){
    medical.statement = statement;
    assert.equal(row(p, "security.regulated-risk").considered, false, statement);
  }
});

test("confirmed payment-only exclusion permits shadow/BYOK/SDK guards/rejected charge while preserving financial risk scope", () => {
  const p = project([exclusion(),
    item("SHADOW", "constraint", "费用仅作影子记录，actual_payable=null，不形成真实应付。"),
    item("BYOK", "functional_requirement", "BYOK费用归属：客户直接支付的模型费用不再标为平台代付应收；平台代调用需独立授权。"),
    item("SDK", "acceptance_criterion", "Given：依赖检查。When：发现导入支付/模型SDK。Then：阻止合并。"),
    item("REFUSE", "acceptance_criterion", "Given：尝试真实charge。When：预检调用。Then：拒绝；账单标非报价不扣款。"),
    item("DENIED", "acceptance_criterion", "Given：有效运行。When：保存计划后尝试付款。Then：查询按权限处理；付款被拒；库存和现金状态不变。"),
    item("COST", "functional_requirement", "记录实际模型费用，支付V0禁用；账单不改变评分。")]);
  const risk = evaluateRisk(p).findings.find(f => f.reason_code === "PAYMENT_OR_FINANCIAL")!;
  p.delivery_policy!.risk_overrides.push({id: risk.override_id, reason_code: risk.reason_code, scope_ids: risk.scope_ids,
    minimum_mode: "PRODUCT_GRADE", resolution: "UPGRADE_SCOPE", status: "CONFIRMED", rationale: "Retain accounting assurance", source_refs: [source, riskResolutionRevision]});
  const before = structuredClone(p), financial = evaluateRisk(p).findings.find(f => f.reason_code === "PAYMENT_OR_FINANCIAL");
  assert.equal(row(p).applicability, "NOT_APPLICABLE");
  assert.ok(row(p).evidence_ids.includes("EXCL-PAY"));
  assert.equal(row(p, "commercial.free-paid").applicability, "APPLICABLE");
  assert.deepEqual(paymentFindings(p), []);
  assert.deepEqual(evaluateRisk(p).findings.find(f => f.reason_code === "PAYMENT_OR_FINANCIAL"), financial);
  assert.deepEqual(p, before);
  assert.equal(audit.run(p).readiness_eligible, false);
  assert.equal(completeness.evaluate(p).hard_gate_ready, false);
});

test("real payment without failure remains blocked; a confirmed failure rule is accepted consistently", () => {
  for (const statement of ["A successful payment activates the plan.", "平台自动扣款并收取服务费。", "Process real refunds.", "付款后开放服务。"]) {
    const p = project([item("LIVE", "functional_requirement", statement)]);
    assert.equal(row(p).applicability, "APPLICABLE", statement);
    assert.ok(paymentFindings(p).some(f => f.category === "PAYMENT_FAILURE"), statement);
    p.items.push(item("FAIL", "decision", "支付失败保留原订单状态，并显示拒绝原因。"));
    assert.equal(row(p).confirmed, true);
    assert.deepEqual(paymentFindings(p), []);
  }
});

test("confirmed opposite payment behavior blocks even with a failure rule, including mixed prose", () => {
  for (const statement of ["自动扣款。", "影子费用；平台自动扣款。", "支付关闭但平台收款。", "禁止支付SDK；平台调用支付接口。", "首期启用支付SDK。", "Integrate payment SDK.", "平台开始收费。", "BYOK费用归属；平台代收真实支付。", "支付关闭，退款仍启用。", "支付失败保留订单；平台自动扣款。"]){
    const p = project([exclusion(), item("LIVE", "functional_requirement", statement), item("FAIL", "functional_requirement", "支付失败保留订单。")]);
    assert.equal(row(p).applicability, "UNRESOLVED", statement);
    assert.ok(completeness.evaluate(p).blockers.some(b => b.id === "BLOCK-PROFILE-PAYMENT-SCOPE-CONFLICT"), statement);
    assert.ok(paymentFindings(p).some(f => f.category === "PAYMENT_SCOPE_CONFLICT"), statement);
  }
  for (const statement of ["Given：尝试真实charge。When：预检。Then：平台执行扣款并拒绝无效查询。", "Given：支付成功。When：尝试查询。Then：拒绝无效查询。"]){
    const p = project([exclusion(), item("MIXED", "acceptance_criterion", statement)]);
    assert.equal(row(p).applicability, "UNRESOLVED", statement);
    assert.ok(paymentFindings(p).some(f => f.category === "PAYMENT_SCOPE_CONFLICT"), statement);
  }
});

test("draft or rejected exclusions, partial exclusions and provenance tags cannot waive payment requirements", () => {
  for (const status of ["PROPOSED", "ASSUMED", "INFERRED", "REJECTED", "SUPERSEDED"] as const){
    const excluded = exclusion(); excluded.status = status;
    const p = project([excluded, item("SHADOW", "constraint", "Shadow billing only.")]);
    assert.notEqual(row(p).applicability, "NOT_APPLICABLE");
    assert.ok(paymentFindings(p).some(f => f.category === "PAYMENT_FAILURE"));
  }
  for (const statement of ["退款后置。", "是否将真实支付后置？", "真实支付失败处理后置。", "真实支付后置但本期自动扣款。"]){
    const p = project([item("EXCL", "exclusion", statement), item("LIVE", "functional_requirement", "Payment checkout")]);
    assert.notEqual(row(p).applicability, "NOT_APPLICABLE", statement);
    assert.ok(paymentFindings(p).length, statement);
  }
  const p = project([exclusion(), item("LIVE", "functional_requirement", "Platform collects payments.")]);
  p.items[1]!.tags = ["shadow", "payment-disabled", "source:excluded"];
  assert.notEqual(row(p).applicability, "NOT_APPLICABLE");
});

test("a proposed opposite payment behavior cannot silently inherit an exclusion", () => {
  const p = project([exclusion(), item("LIVE", "functional_requirement", "平台自动扣款。", "PROPOSED")]);
  assert.equal(row(p).applicability, "UNRESOLVED");
  assert.ok(completeness.evaluate(p).blockers.some(b => b.id === "BLOCK-PROFILE-PAYMENT-SCOPE-CONFLICT"));
  p.items[1]!.status = "REJECTED";
  assert.equal(row(p).applicability, "NOT_APPLICABLE");
});

test("questions and deferred or negated failure rules cannot satisfy live payment failure behavior", () => {
  for (const statement of ["支付失败处理后置。", "不处理支付失败。", "无需支付失败处理。", "支付失败怎么处理？", "Payment failure is not handled."]){
    const p = project([item("LIVE", "functional_requirement", "Platform collects payments."), item("FAIL", "decision", statement)]);
    assert.equal(row(p).confirmed, false, statement);
    assert.ok(paymentFindings(p).some(f => f.category === "PAYMENT_FAILURE"), statement);
  }
});


// Regression fixtures from the confirmed EAMI 1303 clauses; they confer no real Owner authority.
test("EAMI disabled payment lists and rejected requests do not re-enable payment or waive financial risk", () => {
  const p = project([exclusion(),
    item("EXCL-COMMERCE", "exclusion", "套餐及影子账单均后置，不属于首期交付。真实支付、扣款、退款及配套失败处理继续后置。"),
    item("PAYMENT-GATE", "functional_requirement", "首期真实支付、扣款、退款及配套支付流程关闭，请求这些行为时由功能闸门拒绝执行；不收集卡号或支付密钥，不把测试价目转成正式收费依据。模型用量和成本记录只用于运行核对，不形成客户应付，不要求实现影子账单。以后启用商业报价或支付须另行批准。"),
    item("PAYMENT-AC", "acceptance_criterion", "给定首期平台，请求训练、自我改进、经营结果评分、企业经营写动作、真实支付、扣款或退款、未批准扩展或共享世界团队运行时，相应功能闸门拒绝执行；保存方案仍只存提案，不伪造训练奖励、经营成绩或已批准扩展。支付保持关闭，不收集卡号或支付密钥，不将测试价目升级为正式收费依据；模型用量与成本不生成客户应付，缺失或估算数据不得冒充完整实际成本。首期不要求影子账单。")]);
  const before = structuredClone(p), financial = evaluateRisk(p);
  assert.equal(row(p).applicability, "NOT_APPLICABLE");
  assert.deepEqual(paymentFindings(p), []);
  assert.deepEqual(evaluateRisk(p), financial);
  assert.ok(financial.findings.some(f => f.reason_code === "PAYMENT_OR_FINANCIAL" && f.status === "BLOCKING"));
  assert.deepEqual(p, before);
  assert.equal(completeness.evaluate(p).hard_gate_ready, false);
  assert.equal(audit.run(p).readiness_eligible, false);
});

test("enumerated disabled actions, denied requests and separately approved future payment remain non-live", () => {
  for (const statement of [
    "首期真实支付、扣款、退款及配套支付流程关闭。",
    "真实支付、扣款、退款及配套失败处理继续后置。",
    "真实支付、扣款、退款与失败处理流程均后置。",
    "支付、扣款或退款均禁用。",
    "请求支付、扣款或退款时由功能闸门拒绝执行。",
    "以后启用商业报价或支付须另行批准。",
  ]) {
    const p = project([exclusion(), item("GUARD", "functional_requirement", statement)]);
    assert.equal(row(p).applicability, "NOT_APPLICABLE", statement);
    assert.deepEqual(paymentFindings(p), [], statement);
  }
});

test("new non-live forms preserve affirmative, ambiguous and negated-disposition payment blockers", () => {
  for (const statement of [
    "支付、扣款、退款关闭；平台仍自动扣款。",
    "真实支付、扣款、退款后置，但现在平台收款。",
    "请求支付时功能闸门拒绝执行，但平台仍发起退款。",
    "以后启用支付须另行批准，但本期自动扣款。",
    "以后启用支付须另行批准并立即扣款。",
    "请求已支付成功的订单时，功能闸门拒绝执行。",
    "请求支付，随后平台执行扣款时功能闸门拒绝执行。",
    "支付、扣款、退款不关闭。",
    "是否把支付、扣款、退款关闭？",
    "支付、扣款、退款关闭待定。",
    "不将支付、扣款、退款后置。",
    "不能把支付、扣款、退款关闭。",
    "不允许将支付、扣款、退款后置。",
    "禁止将支付、扣款、退款后置。",
  ]) {
    const p = project([exclusion(), item("MIXED", "functional_requirement", statement)]);
    assert.equal(row(p).applicability, "UNRESOLVED", statement);
    assert.ok(paymentFindings(p).some(f => f.category === "PAYMENT_SCOPE_CONFLICT"), statement);
  }
});

test("profile recognizes explicit synthetic materials sent to the selected API without inventing a provider", () => {
  for (const statement of [
    "必要合成资料发送到所选API，真实资料接入后置，密钥不进入日志、夹具或报告。",
    "必要公开合成资料发送至配置的LLM API；启用前核验数据处理条件。",
  ]) {
    const p = project([item("LLM-API", "integration", statement)]), before = structuredClone(p);
    assert.equal(row(p, "integration.external-data").confirmed, true, statement);
    assert.deepEqual(row(p, "integration.external-data").evidence_ids, ["LLM-API"]);
    assert.deepEqual(p, before);
  }
});

test("new API-data evidence rejects questions, negations, unresolved claims, local storage and wrong types", () => {
  for (const statement of [
    "是否将必要合成资料发送到所选API？",
    "必要合成资料发送到所选API，可以吗？",
    "不将必要合成资料发送到所选API。",
    "必要合成资料不发送到所选API。",
    "禁止将必要合成资料发送到所选API。",
    "必要合成资料发送到所选API待定。",
    "必要合成资料发送到本地文件目录。",
    "API返回合成资料。",
    "API地址保存在本地。",
  ]) assert.equal(row(project([item("LLM-API", "integration", statement)]), "integration.external-data").considered, false, statement);
  const statement = "必要合成资料发送到所选API。";
  for (const status of ["PROPOSED", "ASSUMED", "INFERRED", "OPEN", "BLOCKING", "REJECTED", "SUPERSEDED"] as const)
    assert.equal(row(project([item("LLM-API", "integration", statement, status)]), "integration.external-data").confirmed, false, status);
  assert.equal(row(project([item("LLM-API", "vision", statement)]), "integration.external-data").considered, false);
});
