import test from "node:test";
import assert from "node:assert/strict";
import { InterviewService } from "../packages/core/interview-service.ts";
import type { Project } from "../packages/shared-types/domain.ts";

const now = "2026-09-16T12:00:00.000Z";
function item(id: string, type: Project["items"][number]["type"], statement: string,
  status: Project["items"][number]["status"] = "CONFIRMED", tags?: string[]): Project["items"][number] {
  return {id, type, statement, status, source_refs: [{type: "owner_action", ref: `fixture:${id}`}],
    priority: "P0", version: 1, created_at: now, updated_at: now,
    ...(status === "CONFIRMED" ? {confirmed_by: "owner", confirmed_at: now} : {}), tags};
}
function project(items: Project["items"], mode: "FAST_VALIDATION" | "FAST_DEVELOPMENT" | "PRODUCT_GRADE" = "FAST_DEVELOPMENT"): Project {
  return {schema_version: "0.2.0", project_id: "XMI-M4-FIXTURE", xspec_id: "XSPEC-M4-FIXTURE",
    title: "M4 fixture", profile: "web-micro-saas-v0", lifecycle_state: "CLARIFICATION", model_version: 8,
    delivery_policy: {requested_mode: mode, effective_mode: mode,
      readiness_target: mode === "FAST_VALIDATION" ? "PROTOTYPE_READY" : mode === "FAST_DEVELOPMENT" ? "BUILD_READY" : "PRODUCT_SPEC_READY",
      selection_source: "OWNER_CONFIRMED", selected_at: now, history: [], risk_overrides: []},
    items, open_questions: [], current_xspec_version: null, created_at: now, updated_at: now};
}

const service = new InterviewService();

test("M4 extracts bounded candidates with provenance and no confirmation", () => {
  const p = project([item("VISION-1", "vision", "Help freelancers invoice clients")]);
  const result = service.analyzeAnswer(p,
    "Users sign in with email. Each user can only see their own invoices. If payment fails, show a retry option.",
    {type: "conversation_turn", ref: "turn-m4-1"});
  assert.ok(result.candidates.length >= 2 && result.candidates.length <= 8);
  assert.equal(result.candidates.every((c) => c.status === "PROPOSED"), true);
  assert.equal(result.candidates.every((c) => c.source_refs[0]?.ref === "turn-m4-1"), true);
  assert.ok(result.risk_hints.some((r) => r.reason_code === "AUTH_OR_PRIVATE_DATA"));
});

test("M4 contradiction detection never overwrites confirmed state", () => {
  const p = project([item("PERM-1", "permission_rule", "Each customer can only access their own private workspace data")]);
  const result = service.analyzeAnswer(p, "Customers should not be limited to their own private workspace data.",
    {type: "conversation_turn", ref: "turn-m4-2"});
  assert.equal(result.contradictions.length, 1);
  assert.equal(result.contradictions[0]!.confirmed_item_id, "PERM-1");
  assert.equal(p.items[0]!.statement, "Each customer can only access their own private workspace data");
  assert.equal(p.items[0]!.status, "CONFIRMED");
});

test("M4 deterministic ranking is mode aware and returns at most three questions", () => {
  const base = [
    item("VISION-1", "vision", "Help freelancers invoice clients"),
    item("ACTOR-1", "actor", "Freelancers are the main user"),
    item("FLOW-1", "flow", "Create an invoice and send it to a client", "CONFIRMED", ["core"]),
    item("EXC-1", "exclusion", "No payroll in V0", "CONFIRMED", ["scope"]),
    item("DATA-1", "data_entity", "Invoices are persisted", "CONFIRMED", ["data"]),
    item("AC-1", "acceptance_criterion", "A created invoice appears in the invoice list")
  ];
  const fast = service.questions(project(base, "FAST_VALIDATION"));
  const product = service.questions(project(base, "PRODUCT_GRADE"));
  assert.ok(fast.length <= 3 && product.length <= 3);
  assert.ok(!fast.some((q) => q.stage === "READINESS_CLOSURE"));
  assert.ok(product.some((q) => ["ROLES_PERMISSIONS", "FAILURE_EDGE", "NON_FUNCTIONAL", "READINESS_CLOSURE"].includes(q.stage)));
  const again = service.questions(project(base, "PRODUCT_GRADE"));
  assert.deepEqual(product, again, "ranking must be deterministic");
});

test("M4 suppresses already covered areas and penalizes a registered duplicate question", () => {
  const p = project([
    item("VISION-1", "vision", "Help freelancers invoice clients"),
    item("ACTOR-1", "actor", "Freelancers are the main user"),
    item("FLOW-1", "flow", "Create an invoice", "CONFIRMED", ["core"]),
  ], "FAST_DEVELOPMENT");
  p.open_questions.push({id: "Q-SCOPE_EXCLUSIONS", question: "What is out of scope?", status: "OPEN", priority: "P0", reason: "already asked"});
  const questions = service.questions(p);
  assert.equal(questions.some((q) => q.id === "Q-SCOPE_EXCLUSIONS"), false);
  assert.equal(questions.some((q) => q.stage === "INTAKE" || q.stage === "USERS_ACTORS" || q.stage === "CORE_JOURNEY"), false);
});

test("M4 gap analysis reuses confirmed state and asks only missing target-mode depth", () => {
  const p = project([
    item("VISION-1", "vision", "Help freelancers invoice clients"),
    item("ACTOR-1", "actor", "Freelancers"),
    item("FLOW-1", "flow", "Create invoice", "CONFIRMED", ["core"]),
    item("EXC-1", "exclusion", "No payroll", "CONFIRMED", ["scope"]),
    item("DATA-1", "data_entity", "Persist invoices", "CONFIRMED", ["data"]),
    item("AC-1", "acceptance_criterion", "Invoice is visible after creation")
  ], "FAST_VALIDATION");
  const gap = service.modeGap(p, "PRODUCT_GRADE");
  assert.equal(gap.requires_upgrade, true);
  assert.ok(gap.reusable_confirmed_item_ids.includes("FLOW-1"));
  assert.ok(gap.missing_stage_ids.includes("ROLES_PERMISSIONS"));
  assert.ok(gap.missing_stage_ids.includes("READINESS_CLOSURE"));
  assert.ok(gap.missing_questions.length <= 3);
});

test("M4 resume packet is bounded and derived from canonical state", () => {
  const items = Array.from({length: 14}, (_, i) => item(`REQ-${i}`, "functional_requirement", `Requirement ${i}`));
  const p = project(items, "FAST_DEVELOPMENT");
  p.open_questions = Array.from({length: 8}, (_, i) => ({id: `BLOCK-${i}`, question: `Blocker ${i}`, status: "BLOCKING" as const, priority: "P0" as const, reason: "fixture"}));
  const packet = service.resumePacket(p);
  assert.equal(packet.bounded, true);
  assert.ok(packet.recent_confirmed.length <= 8);
  assert.ok(packet.blockers.length <= 5);
  assert.ok(packet.next_questions.length <= 3);
});


test("M12 default interview batch stays within the highest-priority module", () => {
  const p = project([]);
  const questions = service.questions(p);
  assert.equal(questions.length, 3);
  assert.equal(new Set(questions.map((q) => q.stage)).size, 1);
  assert.equal(new Set(questions.map((q) => q.score.total)).size, 1);
  assert.equal(new Set(questions.map((q) => q.id)).size, 3);
  assert.equal(new Set(questions.map((q) => q.question)).size, 3);
  assert.deepEqual(service.questions(p, undefined, 1), questions.slice(0, 1));
  assert.deepEqual(service.questions(p, undefined, 2), questions.slice(0, 2));
  const large = service.questions(p, undefined, 8);
  assert.equal(large.every((q) => q.stage === questions[0]!.stage), true);
});

test("M12 state module asks separate save, sharing and retention questions", () => {
  const p = project([
    item("VISION-1", "vision", "Tool concept"), item("ACTOR-1", "actor", "Staff"),
    item("FLOW-1", "flow", "Core action", "CONFIRMED", ["core"]),
    item("EXC-1", "exclusion", "Scope decided", "CONFIRMED", ["scope"]),
    item("AC-1", "acceptance_criterion", "Observable result")
  ], "FAST_VALIDATION");
  const questions = service.questions(p);
  assert.deepEqual(questions.map((q) => q.stage), ["STATE_DATA", "STATE_DATA", "STATE_DATA"]);
  assert.equal(questions.some((q) => /saved/i.test(q.question)), true);
  assert.equal(questions.some((q) => /share/i.test(q.question)), true);
  assert.equal(questions.some((q) => /remov/i.test(q.question)), true);
});
