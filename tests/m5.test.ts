import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CompletenessService, evaluateRisk } from "../packages/core/completeness-service.ts";
import { WEB_MICRO_SAAS_V0_RULES } from "../packages/core/profile-rules.ts";
import { DecisionService } from "../packages/core/decision-service.ts";
import { ProjectService } from "../packages/core/project-service.ts";
import { MemoryProjectStore } from "../packages/storage/memory.ts";
import { itemFingerprint, modeFingerprint } from "../packages/core/validation.ts";
import type { Candidate, DeliveryMode, Item, Project } from "../packages/shared-types/domain.ts";

const now = "2026-09-16T14:00:00.000Z";
const owner = {type: "owner_action" as const, ref: "fixture:m5-owner"};
const source = {type: "conversation_turn" as const, ref: "fixture:m5"};
const ranks: Record<DeliveryMode, number> = {FAST_VALIDATION: 0, FAST_DEVELOPMENT: 1, PRODUCT_GRADE: 2};

function confirmed(id: string, type: Item["type"], statement: string, options: Partial<Item> = {}): Item {
  return {id, type, statement, status: "CONFIRMED", source_refs: [source], priority: "P2", version: 1,
    created_at: now, updated_at: now, confirmed_by: "owner", confirmed_at: now, ...options};
}
function project(items: Item[], mode: DeliveryMode = "FAST_DEVELOPMENT"): Project {
  return {schema_version: "0.2.0", project_id: "XMI-M5-FIXTURE", xspec_id: "XSPEC-M5-FIXTURE",
    title: "M5 fixture", profile: "web-micro-saas-v0", lifecycle_state: "CLARIFICATION", model_version: 7,
    delivery_policy: {requested_mode: mode, effective_mode: mode,
      readiness_target: mode === "FAST_VALIDATION" ? "PROTOTYPE_READY" : mode === "FAST_DEVELOPMENT" ? "BUILD_READY" : "PRODUCT_SPEC_READY",
      selection_source: "OWNER_CONFIRMED", selected_at: now,
      history: [{from_mode: null, to_mode: mode, reason: "fixture", changed_by: "owner", changed_at: now}], risk_overrides: []},
    items, open_questions: [], current_xspec_version: null, created_at: now, updated_at: now};
}
function candidate(id: string, type: Candidate["type"], statement: string, tags?: string[]): Candidate {
  return {id, type, statement, status: "PROPOSED", source_refs: [source], priority: "P2", tags};
}
function modeCommand(p: Project, mode: DeliveryMode) {
  const reason = "M5 fixture mode";
  return {kind: "DELIVERY_MODE_SELECTED" as const, mode, reason, fingerprint: modeFingerprint(p, mode, reason),
    owner_action: {intent: "CONFIRM" as const, source_ref: owner}};
}
function exec(service: ProjectService, p: Project, command: unknown,
  actor: "owner" | "agent", key: string): Project {
  return service.execute({project_id: p.project_id, expected_version: p.model_version, idempotency_key: key, command}, actor);
}

const completeness = new CompletenessService();
const decisions = new DecisionService();

test("M5 archived requirements do not dilute AC coverage or block active requirement confirmation", () => {
  const p = project([
    confirmed("REQ-LIVE", "functional_requirement", "Save entry", {priority: "P0"}),
    confirmed("AC-LIVE", "acceptance_criterion", "Entry persists", {links: ["REQ-LIVE"]}),
    confirmed("REQ-OLD", "functional_requirement", "Old behavior", {priority: "P1", status: "REJECTED"}),
  ]);
  const result = completeness.evaluate(p);
  assert.equal(result.hard_gates.find((gate) => gate.gate === 6)?.status, "PASS");
  assert.equal(result.hard_gates.find((gate) => gate.gate === 7)?.status, "PASS");
  assert.equal(result.dimensions.acceptance_testability, 100);
  assert.equal(result.hard_gate_ready, false);
  for (const status of ["PROPOSED", "ASSUMED", "INFERRED"] as const) {
    p.items[2]!.status = status;
    assert.equal(completeness.evaluate(p).hard_gates.find((gate) => gate.gate === 6)?.status, "FAIL");
  }
  p.items[2]!.status = "REJECTED";
  p.items[1]!.status = "REJECTED";
  assert.equal(completeness.evaluate(p).hard_gates.find((gate) => gate.gate === 7)?.status, "FAIL");
});

test("M5 confirmed technical constraints can evidence explicit recovery behavior without promoting drafts or unrelated text", () => {
  const p = project([
    confirmed("SOL-AUTH", "solution_constraint", "忘记密码通过本机维护入口重置，并使旧登录失效"),
    confirmed("SOL-BACKUP", "solution_constraint", "数据库与文件一致性备份，恢复时暂停写入并检查完整性"),
  ]);
  const rows = () => completeness.evaluate(p).profile_results.filter((row) =>
    ["identity.recovery", "nfr.availability-recovery"].includes(row.rule_id));
  assert.equal(rows().every((row) => row.confirmed), true);
  p.items.forEach((item) => { item.status = "PROPOSED"; });
  assert.equal(rows().some((row) => row.confirmed), false);
  p.items.forEach((item) => { item.status = "CONFIRMED"; item.statement = "采用独立应用与SQLite"; });
  assert.equal(rows().some((row) => row.confirmed), false);
});

test("M5 Web/Micro-SaaS profile is data-driven and covers every docs/08 V0 area", () => {
  const areas = new Set(WEB_MICRO_SAAS_V0_RULES.map((rule) => rule.area));
  assert.deepEqual([...areas].sort(), ["COMMERCIAL", "DATA", "FUNCTIONAL_STATES", "IDENTITY_ACCESS",
    "NON_FUNCTIONAL", "NOTIFICATIONS_INTEGRATIONS", "PRODUCT_USERS", "SECURITY_PRIVACY"]);
  for (const label of ["entities and ownership", "persistence versus ephemeral data", "import/export", "retention/deletion",
    "audit/logging needs", "backup/recovery expectations", "empty state", "invalid input", "loading/timeout",
    "unavailable integration", "permission denied", "duplicate operation", "cancellation/retry", "partial failure"]) {
    assert.ok(WEB_MICRO_SAAS_V0_RULES.some((rule) => rule.label === label), label);
  }
  assert.equal(completeness.profileRules(), WEB_MICRO_SAAS_V0_RULES);
});

test("M5 completeness evaluates considered/applicable state without mutating or confirming features", () => {
  const p = project([confirmed("VISION-1", "vision", "Problem and desired outcome are confirmed")]);
  const before = structuredClone(p);
  const result = completeness.evaluate(p);
  assert.deepEqual(p, before);
  assert.equal(result.hard_gate_ready, false);
  assert.ok(result.blockers.some((blocker) => blocker.category === "PROFILE"));
  assert.equal(p.items.some((item) => item.status !== "CONFIRMED"), false);
  assert.equal(result.profile_results.some((row) => row.applicability === "UNRESOLVED"), true);
});

test("M5 explicit not-applicable policy is required for conditional profile areas", () => {
  const p = project([
    confirmed("VISION-1", "vision", "Problem and desired outcome"),
    confirmed("DEC-NO-COMMERCIAL", "decision", "This conditional area does not apply in V0", {tags: ["profile-applicability:commercial:not-applicable"]}),
    confirmed("DEC-NO-INTEGRATION", "decision", "This conditional area does not apply in V0", {tags: ["profile-applicability:integration:not-applicable"]}),
    confirmed("DEC-NO-ACCOUNT", "decision", "This conditional area does not apply in V0", {tags: ["profile-applicability:account_or_private:not-applicable"]}),
  ], "FAST_VALIDATION");
  const result = completeness.evaluate(p);
  assert.equal(result.profile_results.filter((row) => row.area === "COMMERCIAL").every((row) => row.applicability === "NOT_APPLICABLE"), true);
  assert.equal(result.blockers.some((blocker) => blocker.id === "BLOCK-PROFILE-COMMERCIAL"), false);
});

test("M5 mode-specific profile depth expands monotonically", () => {
  const empty: Item[] = [];
  const fast = completeness.evaluate(project(empty, "FAST_VALIDATION")).profile_results
    .filter((row) => ranks.FAST_VALIDATION >= ranks[row.minimum_mode]).length;
  const dev = completeness.evaluate(project(empty, "FAST_DEVELOPMENT")).profile_results
    .filter((row) => ranks.FAST_DEVELOPMENT >= ranks[row.minimum_mode]).length;
  const product = completeness.evaluate(project(empty, "PRODUCT_GRADE")).profile_results
    .filter((row) => ranks.PRODUCT_GRADE >= ranks[row.minimum_mode]).length;
  assert.ok(fast < dev && dev < product);
});

test("M5 polished score cannot override a hard blocker", () => {
  const items = WEB_MICRO_SAAS_V0_RULES.map((rule, index) => confirmed(`ITEM-${index + 1}`, rule.evidence_types[0]!,
    rule.evidence_keywords[0] ?? rule.label, {tags: rule.evidence_tags.slice(0, 1)}));
  const p = project(items, "PRODUCT_GRADE");
  p.open_questions.push({id: "BLOCK-POLISHED", question: "A material contradiction remains", status: "BLOCKING", priority: "P0", reason: "adversarial fixture"});
  const result = completeness.evaluate(p);
  assert.ok(result.score >= 60, `expected explanatory score to look healthy, got ${result.score}`);
  assert.equal(result.hard_gate_ready, false);
  assert.equal(result.hard_gates.find((gate) => gate.gate === 2)?.status, "FAIL");
  assert.equal(result.qualification, null);
});

test("M5 deterministic risk evaluation sets a minimum mode and never silently downgrades", () => {
  const item = confirmed("REQ-PAYMENT", "functional_requirement", "Customers pay a recurring subscription with Stripe and can request refunds", {priority: "P0"});
  const fast = evaluateRisk(project([item], "FAST_VALIDATION"));
  const payment = fast.findings.find((finding) => finding.reason_code === "PAYMENT_OR_FINANCIAL")!;
  assert.equal(payment.minimum_mode, "PRODUCT_GRADE");
  assert.equal(payment.status, "BLOCKING");
  assert.equal(fast.minimum_mode, "PRODUCT_GRADE");
  const product = evaluateRisk(project([item], "PRODUCT_GRADE"));
  assert.equal(product.findings.find((finding) => finding.reason_code === "PAYMENT_OR_FINANCIAL")?.status, "SATISFIED_BY_PROJECT_MODE");
  // M7 freezes the XMi-side handoff contract marker; F-2 remains PARTIALLY_CLOSED until real XDev evidence.
  assert.equal(product.scope_overrides_export, "XDEV-DELIVERY-HANDOFF/1");
});

test("M5 decision lifecycle compares, approves and supersedes with append-only events", () => {
  const store = new MemoryProjectStore();
  const service = new ProjectService(store, () => now);
  let p = service.create({idempotency_key: "create", title: "decision", idea: "Choose account model", source_ref: source});
  const proposal = decisions.propose({id: "DEC-ACCOUNT", question: "Should V0 require accounts?", why_it_matters: "Changes UX, privacy and XDev scope.",
    options: [
      {id: "ANON", label: "Anonymous", impact: {user_experience: "Lower friction", cost: "Low", complexity: "Low", privacy: "Less identity data", xdev: "Simpler auth scope"}},
      {id: "ACCOUNT", label: "Account-based", impact: {user_experience: "Persistent identity", cost: "Medium", complexity: "Medium", privacy: "Identity data", xdev: "Auth and isolation required"}},
    ], recommendation: {option_id: "ANON", rationale: "Lowest-risk validation default.", confidence: "MEDIUM"}, source_ref: source});
  p = exec(service, p, {kind: "CANDIDATE_EXTRACTED", candidate: proposal}, "agent", "proposal");
  assert.equal(decisions.compare(p.items.find((item) => item.id === "DEC-ACCOUNT")!).options.length, 2);
  p = exec(service, p, decisions.approve(p.items.find((item) => item.id === "DEC-ACCOUNT")!, "ANON", owner), "owner", "approve-1");
  assert.equal(p.items.find((item) => item.id === "DEC-ACCOUNT")?.decision_detail?.owner_selection, "ANON");
  assert.equal(service.history(p.project_id).at(-1)?.command.kind, "DECISION_APPROVED");

  const replacement = decisions.propose({id: "DEC-ACCOUNT-V2", question: "Should V1 require accounts?", why_it_matters: "Persistent work now needs identity.",
    options: [
      {id: "ANON", label: "Anonymous", impact: {user_experience: "Simple", cost: "Low", complexity: "Low", privacy: "Low data", xdev: "Simple"}},
      {id: "ACCOUNT", label: "Account-based", impact: {user_experience: "Persistent", cost: "Medium", complexity: "Medium", privacy: "Identity data", xdev: "Auth required"}},
    ], recommendation: {option_id: "ACCOUNT", rationale: "Needed for persistent work.", confidence: "HIGH"}, source_ref: source});
  p = exec(service, p, {kind: "CANDIDATE_EXTRACTED", candidate: replacement}, "agent", "proposal-2");
  p = exec(service, p, decisions.approve(p.items.find((item) => item.id === "DEC-ACCOUNT-V2")!, "ACCOUNT", owner), "owner", "approve-2");
  p = exec(service, p, decisions.supersede(p.items.find((item) => item.id === "DEC-ACCOUNT")!,
    p.items.find((item) => item.id === "DEC-ACCOUNT-V2")!, owner), "owner", "supersede");
  assert.equal(p.items.find((item) => item.id === "DEC-ACCOUNT")?.status, "SUPERSEDED");
  assert.equal(p.items.find((item) => item.id === "DEC-ACCOUNT-V2")?.supersedes, "DEC-ACCOUNT");
  assert.deepEqual(p.items.find((item) => item.id === "DEC-ACCOUNT-V2")?.decision_detail?.supersession_history, ["DEC-ACCOUNT"]);
  assert.equal(service.history(p.project_id).at(-1)?.command.kind, "ITEM_SUPERSEDED");
  store.close();
});

test("M5 risk override resolution is owner-only, idempotent and re-resolution is auditable", () => {
  const store = new MemoryProjectStore();
  const service = new ProjectService(store, () => now);
  let p = service.create({idempotency_key: "create", title: "risk", idea: "Prototype payment", source_ref: source});
  p = exec(service, p, modeCommand(p, "FAST_VALIDATION"), "owner", "mode");
  p = exec(service, p, {kind: "CANDIDATE_EXTRACTED", candidate: candidate("REQ-PAY", "functional_requirement", "Charge customers with Stripe and refund failed payments")}, "agent", "risk");
  // F-12: an override is a delivery-scope contract, so every item its scope names must already be
  // confirmed before the resolution is recorded.
  const finding = evaluateRisk(p).findings.find((entry) => entry.reason_code === "PAYMENT_OR_FINANCIAL")!;
  for (const scopeId of finding.scope_ids) {
    const scopeItem = p.items.find((item) => item.id === scopeId)!;
    p = exec(service, p, {kind: "ITEM_CONFIRMED", item_id: scopeItem.id, fingerprint: itemFingerprint(scopeItem),
      owner_action: {intent: "CONFIRM", source_ref: owner}}, "owner", "confirm-" + scopeId);
  }
  const command = {kind: "MODE_OVERRIDE_RESOLVED" as const, override_id: finding.override_id, resolution: "STUB_OR_SANDBOX" as const,
    rationale: "Use sandbox only in the prototype", owner_action: {intent: "RESOLVE_OVERRIDE" as const, source_ref: owner}};
  const first = exec(service, p, command, "owner", "resolve-1");
  const retry = service.execute({project_id: p.project_id, expected_version: p.model_version, idempotency_key: "resolve-1", command}, "owner");
  assert.deepEqual(retry, first);
  assert.equal(evaluateRisk(first).findings.find((entry) => entry.override_id === finding.override_id)?.status, "RESOLVED_BY_OVERRIDE");
  const secondCommand = {...command, resolution: "DEFER_OR_EXCLUDE" as const, rationale: "Defer payments entirely"};
  const second = service.execute({project_id: first.project_id, expected_version: first.model_version, idempotency_key: "resolve-2", command: secondCommand}, "owner");
  assert.equal(second.delivery_policy?.risk_overrides.find((entry) => entry.id === finding.override_id)?.resolution, "DEFER_OR_EXCLUDE");
  assert.equal(service.history(second.project_id).filter((event) => event.command.kind === "MODE_OVERRIDE_RESOLVED").length, 2);
  assert.throws(() => service.execute({project_id: second.project_id, expected_version: second.model_version, idempotency_key: "bad-upgrade",
    command: {...command, resolution: "UPGRADE_PROJECT" as const}}, "owner"), /MODE_UPGRADE_REQUIRED/);
  store.close();
});

test("M5 structured decisions cannot become confirmed without an Owner selection", () => {
  const store = new MemoryProjectStore();
  const service = new ProjectService(store, () => now);
  let p = service.create({idempotency_key: "create", title: "decision", idea: "Choose storage", source_ref: source});
  const proposal = decisions.propose({id: "DEC-STORAGE", question: "Store data?", why_it_matters: "Persistence changes privacy and cost.",
    options: [
      {id: "NONE", label: "Ephemeral", impact: {user_experience: "No history", cost: "Low", complexity: "Low", privacy: "Low", xdev: "No DB"}},
      {id: "DB", label: "Persist", impact: {user_experience: "History", cost: "Medium", complexity: "Medium", privacy: "Data retained", xdev: "DB required"}},
    ], recommendation: {option_id: "NONE", rationale: "Low risk", confidence: "LOW"}, source_ref: source});
  p = exec(service, p, {kind: "CANDIDATE_EXTRACTED", candidate: proposal}, "agent", "proposal");
  const item = p.items.find((entry) => entry.id === "DEC-STORAGE")!;
  assert.throws(() => exec(service, p, {kind: "ITEM_CONFIRMED", item_id: item.id, fingerprint: itemFingerprint(item),
    owner_action: {intent: "CONFIRM", source_ref: owner}}, "owner", "generic-confirm"), /USE_DECISION_APPROVAL/);
  const preselected = structuredClone(item);
  preselected.decision_detail!.owner_selection = "NONE";
  p = service.execute({project_id: p.project_id, expected_version: p.model_version, idempotency_key: "proposal-selected",
    command: {kind: "CANDIDATE_EXTRACTED", candidate: {...proposal, id: "DEC-STORAGE-SELECTED", decision_detail: preselected.decision_detail}}}, "agent");
  const selected = p.items.find((entry) => entry.id === "DEC-STORAGE-SELECTED")!;
  assert.throws(() => exec(service, p, {kind: "ITEM_CONFIRMED", item_id: selected.id, fingerprint: itemFingerprint(selected),
    owner_action: {intent: "CONFIRM", source_ref: owner}}, "owner", "generic-confirm-selected"), /USE_DECISION_APPROVAL/);
  assert.equal(service.get(p.project_id).items.find((entry) => entry.id === "DEC-STORAGE")?.status, "PROPOSED");
  assert.equal(service.get(p.project_id).items.find((entry) => entry.id === "DEC-STORAGE-SELECTED")?.status, "PROPOSED");
  store.close();
});

test("M5 adversarial fixture catalog encodes incomplete and risk cases", () => {
  const fixtures = JSON.parse(readFileSync("tests/fixtures/m5-completeness-fixtures.json", "utf8")) as
    {id: string; mode: DeliveryMode; expect_ready?: boolean; expected_reason?: string; expected_minimum_mode?: DeliveryMode}[];
  assert.ok(fixtures.some((fixture) => fixture.id === "incomplete-fast-development" && fixture.expect_ready === false));
  assert.ok(fixtures.some((fixture) => fixture.id === "polished-but-blocked" && fixture.expect_ready === false));
  assert.ok(fixtures.some((fixture) => fixture.expected_reason === "PAYMENT_OR_FINANCIAL" && fixture.expected_minimum_mode === "PRODUCT_GRADE"));
});
