import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createXmiServer } from "../apps/mcp-server/server.ts";
import { inputs, outputs } from "../apps/mcp-server/contracts.ts";
import type { ToolName } from "../apps/mcp-server/contracts.ts";
import { InterviewService } from "../packages/core/interview-service.ts";
import { ProjectService } from "../packages/core/project-service.ts";
import { MemoryProjectStore } from "../packages/storage/memory.ts";

const now = "2026-10-02T12:00:00.000Z";
const source = {type: "conversation_turn" as const, ref: "fixture:module-owner-answer"};
function fixture() {
  const store = new MemoryProjectStore();
  const service = new ProjectService(store);
  const created = service.create({title: "Module interview", idea: "A game with equipment combinations",
    profile: "digital-game-v0", source_ref: source, idempotency_key: "create"}, "agent");
  return {store, service, projectId: created.project_id};
}

test("M12 module resume preserves draft rows and does not replace them with generic stage questions", () => {
  const {store, service, projectId} = fixture();
  const p = service.get(projectId);
  const at = now;
  p.items.push({id: "REQ-EQUIPMENT", type: "functional_requirement", statement: "Shield and wand provide different damage attributes",
    status: "PROPOSED", source_refs: [source], tags: ["module:装备设计"], version: 1, created_at: at, updated_at: at});
  const interview = new InterviewService();
  const packet = interview.resumePacket(p);
  assert.equal(packet.module_review?.module, "装备设计");
  assert.equal(packet.module_review?.items[0]?.status, "PROPOSED");
  assert.equal(packet.module_review?.items[0]?.source_refs[0]?.ref, source.ref);
  assert.equal(packet.module_review?.completion, "NOT_EVALUATED");
  assert.equal(packet.module_review?.confirmation_pending, true);
  assert.equal(packet.module_review?.review_brief.format, "MODULE_REVIEW_BRIEF");
  assert.equal(packet.module_review?.review_brief.decision_limit, 8);
  assert.deepEqual(packet.module_review?.review_brief.sections, ["CURRENT_DESIGN", "PENDING_DECISIONS_WITH_RECOMMENDATIONS", "EFFECTS_AND_CONFLICTS", "BATCH_REPLY"]);
  assert.equal(interview.resumePacket(p, undefined, 1).module_review?.review_brief.decision_limit, 1);
  assert.deepEqual(packet.next_questions, []);
  assert.equal(interview.moduleReview(p, "道具设计")?.total_items, 0);
  assert.equal(interview.moduleReview(p, "道具设计")?.module, "道具设计");
  store.close();
});

test("M12 module view bounds rows and text without hiding partial coverage or replacing confirmed facts", () => {
  const {store, service, projectId} = fixture();
  const p = service.get(projectId);
  for (let i = 0; i < 16; i++) p.items.push({id: "REQ-" + i, type: "functional_requirement", statement: "规则".repeat(1000),
    status: i === 15 ? "CONFIRMED" : "PROPOSED", source_refs: [source], tags: ["module:道具设计"],
    version: 1, created_at: now, updated_at: now});
  p.items.push({...p.items[1]!, id: "REQ-REJECTED", status: "REJECTED"});
  p.items.push({...p.items[2]!, id: "REQ-OLD", status: "SUPERSEDED"});
  p.items.push({...p.items[3]!, id: "REQ-OTHER", tags: ["module:订单流程"]});
  const before = JSON.stringify(p);
  const view = new InterviewService().moduleReview(p, "道具设计")!;
  assert.equal(view.total_items, 16);
  assert.equal(view.items.length, 12);
  assert.equal(view.truncated, true);
  assert.equal(view.items.every((row) => row.statement.length <= 1200 && row.statement_truncated), true);
  assert.ok(view.items.some((row) => row.status === "CONFIRMED"));
  assert.ok(!view.items.some((row) => ["REQ-REJECTED", "REQ-OLD", "REQ-OTHER"].includes(row.id)));
  assert.equal(JSON.stringify(p), before);
  store.close();
});

test("M12 module-tagged answers save as drafts and resume across a fresh MCP connection", async () => {
  const {store, service, projectId} = fixture();
  let client: Client;
  let server: ReturnType<typeof createXmiServer>;
  async function connect() {
    server = createXmiServer(service);
    client = new Client({name: "module-interview-fixture", version: "1"}, {capabilities: {elicitation: {form: {}}}});
    // Supports the older form-gated draft baseline as well as the separately approved autosave path.
    // No confirmation tool is invoked; the installed verifier also tests drafts with no form capability.
    client.setRequestHandler(ElicitRequestSchema, async (request) => {
      assert.match(request.params.message, /xmi_patch_apply/);
      return {action: "accept", content: {approve: true}};
    });
    const [a,b] = InMemoryTransport.createLinkedPair();
    await server.connect(a); await client.connect(b);
  }
  async function call(name: ToolName, args: Record<string, unknown>) {
    const result = await client.callTool({name, arguments: {schema_version: "0.1.0", project_id: projectId, ...args}});
    assert.equal(outputs[name].safeParse(result.structuredContent).success, true);
    return JSON.parse(JSON.stringify(result.structuredContent));
  }
  await connect();
  try {
    const originalVersion = service.get(projectId).model_version;
    const analyzed = await call("xmi_answer_analyze", {expected_version: originalVersion,
      answer: "装备可以在战斗外自由切换。装备属性决定伤害效果。", item_id: "REQ-EQUIPMENT-ANSWER",
      item_type: "functional_requirement", source_ref: source, interview_module: "装备设计"});
    assert.equal(analyzed.ok, true);
    assert.equal(service.get(projectId).model_version, originalVersion);
    assert.ok(analyzed.data.proposed_patch.candidate.tags.includes("module:装备设计"));
    assert.ok(analyzed.data.candidate_patches.every((patch: {candidate: {tags: string[]}}) => patch.candidate.tags.includes("module:装备设计")));
    assert.deepEqual(analyzed.data.next_questions, []);
    assert.equal(analyzed.data.module_review.review_brief.decision_limit, 8);
    const saved = await call("xmi_patch_apply", {expected_version: originalVersion,
      idempotency_key: "save-equipment", patch: analyzed.data.proposed_patch});
    assert.equal(saved.ok, true);
    await client!.close(); await server!.close(); await connect();
    const resumed = await call("xmi_project_resume", {});
    const review = resumed.data.resume_packet.module_review;
    assert.equal(review.module, "装备设计");
    assert.equal(review.items[0].statement, analyzed.data.proposed_patch.candidate.statement);
    assert.equal(review.items[0].status, "PROPOSED");
    assert.deepEqual(resumed.data.resume_packet.next_questions, []);
    assert.equal(review.completion, "NOT_EVALUATED");
    assert.equal(review.review_brief.decision_limit, 8);
    const switched = await call("xmi_project_resume", {interview_module: "技能设计"});
    assert.equal(switched.data.resume_packet.module_review.module, "技能设计");
    assert.equal(switched.data.resume_packet.module_review.total_items, 0);
    const invalid = await call("xmi_answer_analyze", {expected_version: service.get(projectId).model_version,
      answer: "自动确认", source_ref: source, interview_module: "装备设计", approved: true});
    assert.equal(invalid.error.code, "INVALID_ARGUMENTS");
    assert.equal(service.get(projectId).items.find((row) => row.id === "REQ-EQUIPMENT-ANSWER")?.status, "PROPOSED");
  } finally {await client!.close(); await server!.close(); store.close();}
});

test("M12 module brief gathers related pending decisions together without treating known proposals as unanswered", () => {
  const {store, service, projectId} = fixture();
  const p = service.get(projectId);
  p.items.push({id: "REQ-RANGE", type: "functional_requirement", statement: "自动技能四周一格，手动技能不限制距离。",
    status: "PROPOSED", source_refs: [source], tags: ["module:技能设计"], version: 1, created_at: now, updated_at: now});
  p.items.push({id: "DEC-HEALTH", type: "decision", statement: "最低血量按绝对值还是百分比？", status: "OPEN", priority: "P0",
    source_refs: [source], tags: ["module:技能设计"], version: 1, created_at: now, updated_at: now});
  p.items.push({id: "DEC-RANGE", type: "decision", statement: "嘲讽是否突破技能射程？", status: "BLOCKING", priority: "P0",
    source_refs: [source], tags: ["module:技能设计"], version: 1, created_at: now, updated_at: now});
  p.items.push({id: "DEC-DONE", type: "decision", statement: "共享冷却已决定", status: "CONFIRMED", priority: "P0",
    source_refs: [source], tags: ["module:技能设计"], version: 1, created_at: now, updated_at: now});
  p.items.push({id: "DEC-OTHER", type: "decision", statement: "订单权限待定", status: "OPEN", priority: "P0",
    source_refs: [source], tags: ["module:订单设计"], version: 1, created_at: now, updated_at: now});
  p.open_questions.push({id: "Q-TIE", question: "同血量时如何选敌？", status: "OPEN", priority: "P0", reason: "Behavior unclear", affected_ids: ["REQ-RANGE"]});
  p.open_questions.push({id: "Q-OTHER", question: "其他模块问题", status: "OPEN", priority: "P0", reason: "Unrelated", affected_ids: ["DEC-OTHER"]});
  const before = JSON.stringify(p);
  const brief = new InterviewService().moduleReview(p, "技能设计")!;
  assert.deepEqual(brief.pending_decisions.map((row) => row.id), ["DEC-RANGE", "DEC-HEALTH", "Q-TIE"]);
  assert.equal(brief.total_pending_decisions, 3);
  assert.equal(brief.pending_decisions_truncated, false);
  assert.ok(brief.items.some((row) => row.id === "REQ-RANGE"));
  assert.ok(!brief.pending_decisions.some((row) => ["REQ-RANGE", "DEC-DONE", "DEC-OTHER", "Q-OTHER"].includes(row.id)));
  assert.equal(JSON.stringify(p), before);
  store.close();
});

test("M12 module arguments reject empty or oversized names and leave legacy calls valid", () => {
  const args = {schema_version: "0.1.0", project_id: "XMI-FIXTURE"};
  for (const interview_module of ["", " ", "a".repeat(81)]) {
    assert.equal(inputs.xmi_project_resume.safeParse({...args, interview_module}).success, false);
    assert.equal(inputs.xmi_answer_analyze.safeParse({...args, expected_version: 1, answer: "Answer", source_ref: source, interview_module}).success, false);
  }
  assert.equal(inputs.xmi_project_resume.safeParse(args).success, true);
});

test("M12 pending overview is bounded independently of the Owner's active-decision maximum", () => {
  const {store, service, projectId} = fixture();
  const p = service.get(projectId);
  for (let index = 0; index < 10; index++) p.items.push({id: "DEC-" + index, type: "decision", statement: "需要讨论的规则 " + index,
    status: "OPEN", priority: "P0", source_refs: [source], tags: ["module:技能设计"],
    version: 1, created_at: now, updated_at: now});
  const view = new InterviewService().moduleReview(p, "技能设计", 1)!;
  assert.equal(view.review_brief.decision_limit, 1);
  assert.equal(view.pending_decisions.length, 8);
  assert.equal(view.total_pending_decisions, 10);
  assert.equal(view.pending_decisions_truncated, true);
  assert.equal(view.review_brief.recommendations_status, "UNADOPTED");
  assert.equal(view.review_brief.confirmation_granted, false);
  assert.equal(view.completion, "NOT_EVALUATED");
  store.close();
});

test("M12 a table revision retains the prior confirmed rule and checks related module conflicts", () => {
  const {store, service, projectId} = fixture();
  const p = service.get(projectId);
  p.items.push({id: "REQ-OLD-RULE", type: "functional_requirement", statement: "Equipment changes are allowed during combat",
    status: "CONFIRMED", source_refs: [source], tags: ["module:战斗规则"], version: 1, created_at: now, updated_at: now});
  const interview = new InterviewService();
  const answer = interview.analyzeAnswer(p, "Equipment changes are not allowed during combat", source);
  assert.equal(answer.contradictions[0]?.confirmed_item_id, "REQ-OLD-RULE");
  const newRow = answer.candidates[0]!;
  p.items.push({...newRow, tags: ["module:装备设计"], links: ["REQ-OLD-RULE"], supersedes: "REQ-OLD-RULE",
    version: 1, created_at: now, updated_at: now});
  assert.equal(interview.moduleReview(p, "战斗规则")?.items[0]?.status, "CONFIRMED");
  const revised = interview.moduleReview(p, "装备设计")!;
  assert.equal(revised.items[0]?.status, "PROPOSED");
  assert.deepEqual(revised.items[0]?.links, ["REQ-OLD-RULE"]);
  assert.equal(revised.items[0]?.supersedes, "REQ-OLD-RULE");
  assert.equal(revised.completion, "NOT_EVALUATED");
  store.close();
});
