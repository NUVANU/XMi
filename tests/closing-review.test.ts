import test from "node:test";
import type {TestContext} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import fs from "node:fs";
import {syncBuiltinESMExports} from "node:module";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import {Ajv2020} from "ajv/dist/2020.js";
import {createXmiServer, toolDescriptors} from "../apps/mcp-server/server.ts";
import {inputs, outputs} from "../apps/mcp-server/contracts.ts";
import {createSingleReviewRouter, readSingle} from "../apps/local-module-review/single.ts";
import {createModuleReviewHost} from "../apps/local-module-review/adapter.ts";
import {processUserPrompt} from "../apps/local-module-review/hook.ts";
import {ProjectService} from "../packages/core/project-service.ts";
import {SqliteProjectStore} from "../packages/storage/sqlite.ts";
import {InterviewService} from "../packages/core/interview-service.ts";
import {SolutionService} from "../packages/core/solution-service.ts";
import {evaluateRisk} from "../packages/core/completeness-service.ts";
import {itemFingerprint, modeFingerprint} from "../packages/core/validation.ts";
import {reviewProjectService} from "./fixtures/spec-review-project.ts";
import {DomainError} from "../packages/core/errors.ts";

const session = "00000000-0000-4000-8000-000000000001", turn = "00000000-0000-4000-8000-000000000002";
const source = {type: "conversation_turn" as const, ref: "fixture:closing-review"};
function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "xmi-closing-review-")), db = join(directory, "product.sqlite"), log = join(directory, "session.jsonl");
  const store = new SqliteProjectStore(db), service = new ProjectService(store), seed = reviewProjectService();
  const p = seed.project; store.transaction(tx => {for (const event of seed.service.history(p.project_id)) tx.append(event); tx.save(p);}); seed.store.close();
  const router = createSingleReviewRouter(directory, db, undefined, service);
  const prompt = (text: string) => processUserPrompt({hook_event_name: "UserPromptSubmit", session_id: session, turn_id: turn,
    prompt: text, transcript_path: log}, directory, directory);
  const display = (text: string) => writeFileSync(log, JSON.stringify({type: "session_meta", payload: {id: session}}) + "\n" +
    JSON.stringify({type: "response_item", payload: {type: "message", role: "assistant", phase: "final_answer", content: [{type: "output_text", text}]}}) + "\n");
  const run = (command: unknown) => {const p = service.get(seed.project.project_id); return service.execute({project_id: p.project_id,
    expected_version: p.model_version, idempotency_key: "seed-" + p.model_version, command});};
  const add = (id: string, statement = "A pending scope rule.") => run({kind: "CANDIDATE_EXTRACTED", candidate:
    {id, type: "constraint", statement, status: "PROPOSED", source_refs: [source], tags: ["module:Closing"]}});
  const args = (id: string) => {const p = service.get(seed.project.project_id), item = p.items.find(i => i.id === id)!;
    return {schema_version: "0.1.0" as const, project_id: p.project_id, expected_version: p.model_version, idempotency_key: "action-" + id,
      operation: "xmi_item_confirm" as const, item_id: id, item_version: item.version, fingerprint: itemFingerprint(item), intent: "CONFIRM" as const};};
  const prepare = (requests: unknown[]) => router.prepare(service.get(seed.project.project_id), requests, session);
  const commit = () => {const r = readSingle(directory, session)!; return router.commit(r.project_id, r.project_version, r.review_id, session);};
  prompt("继续");
  t.after(() => {store.close(); rmSync(directory, {recursive: true, force: true});});
  return {directory, db, service, p, router, prompt, display, run, add, args, prepare, commit};
}

test("ordinary settings and a selected structured option share one complete review and one genuine confirmation", t => {
  const f = fixture(t); f.add("REQ-CLOSE-A"); f.add("REQ-CLOSE-B", "另一条完整规则，不能截断。");
  const decision = new InterviewService().analyzeAnswer(f.service.get(f.p.project_id), "用户进入游戏。玩家控制主角。", source).review_decisions
    .find(i => i.id === "DEC-RELATION-USER-PLAYER")!;
  f.run({kind: "CANDIDATE_EXTRACTED", candidate: decision});
  const before = f.service.get(f.p.project_id), events = f.service.history(f.p.project_id).length;
  const prepared = f.prepare([f.args("REQ-CLOSE-A"), {...f.args(decision.id), selected_option_id: "SAME_ENTITY"}, f.args("REQ-CLOSE-B")]);
  assert.equal(prepared.action, "BATCH"); assert.match(prepared.review_text, /本次 3 项/); assert.ok(prepared.review_text.includes("另一条完整规则"));
  for (const option of decision.decision_detail!.options) assert.ok(prepared.review_text.includes(option.label));
  assert.equal(f.service.history(f.p.project_id).length, events); assert.throws(f.commit, /NATIVE_OWNER_REPLY_REQUIRED/);
  f.display(prepared.review_text); assert.match(f.prompt("确认好了"), /尚未正式写入/); f.commit();
  const after = f.service.get(f.p.project_id); assert.equal(after.model_version, before.model_version + 3);
  assert.equal(after.items.find(i => i.id === decision.id)!.decision_detail!.owner_selection, "SAME_ENTITY");
  assert.ok(["REQ-CLOSE-A", "REQ-CLOSE-B", decision.id].every(id => after.items.find(i => i.id === id)!.status === "CONFIRMED"));
  const applied = f.service.history(f.p.project_id).slice(-3);
  assert.ok(applied.every(e => e.actor === "owner" && "owner_action" in e.command && /^codex-user-prompt:/u.test(e.command.owner_action.source_ref.ref)));
  f.commit(); assert.equal(f.service.history(f.p.project_id).length, events + 3);
  assert.equal(readSingle(f.directory, session)!.commands, null);
});

test("scope adoption can precede its explicit risk disposition without weakening the scope confirmation gate", t => {
  const f = fixture(t); f.add("REQ-BILL", "Provide a payment billing ledger.");
  const p = f.service.get(f.p.project_id), risk = evaluateRisk(p).findings.find(i => i.scope_ids.includes("REQ-BILL"))!;
  assert.ok(risk);
  const resolve = {schema_version: "0.1.0", project_id: p.project_id, expected_version: p.model_version, idempotency_key: "risk",
    operation: "xmi_mode_override_resolve", override_id: risk.override_id, resolution: "UPGRADE_SCOPE", rationale: "Keep this financial scope at its required depth.", intent: "RESOLVE_OVERRIDE"};
  assert.throws(() => f.prepare([resolve, f.args("REQ-BILL")]), /MODE_OVERRIDE_SCOPE_NOT_CONFIRMED/);
  const prepared = f.prepare([f.args("REQ-BILL"), resolve]); assert.ok(prepared.review_text.includes("Keep this financial scope"));
  f.display(prepared.review_text); f.prompt("确认好了"); f.commit();
  assert.equal(f.service.get(p.project_id).delivery_policy!.risk_overrides.find(r => r.id === risk.override_id)!.status, "CONFIRMED");
});

test("a ready blueprint and an explicit rejection can be reviewed together; changed blueprint dependencies are not waived", t => {
  const f = fixture(t); f.add("REQ-DISCARD");
  const candidate = new SolutionService().propose(f.service.get(f.p.project_id), source); candidate.id = "BLUEPRINT-CLOSE"; candidate.blueprint_detail!.blueprint_id = candidate.id;
  f.run({kind: "CANDIDATE_EXTRACTED", candidate});
  const reject = {...f.args("REQ-DISCARD"), operation: "xmi_item_reject", intent: "REJECT", reason: "Outside this version."};
  const prepared = f.prepare([{...f.args(candidate.id), solution_disposition: "APPROVE_BLUEPRINT"}, reject]);
  assert.match(prepared.review_text, /批准采用这份技术方案/); assert.match(prepared.review_text, /Outside this version/);
  f.display(prepared.review_text); f.prompt("确认好了"); f.commit();
  assert.equal(f.service.get(f.p.project_id).items.find(i => i.id === candidate.id)!.blueprint_detail!.owner_disposition, "APPROVED");
  const g = fixture(t); g.add("REQ-NEW-FACT");
  const next = new SolutionService().propose(g.service.get(g.p.project_id), source); next.id = "BLUEPRINT-STALE"; next.blueprint_detail!.blueprint_id = next.id;
  g.run({kind: "CANDIDATE_EXTRACTED", candidate: next});
  assert.throws(() => g.prepare([{...g.args(next.id), solution_disposition: "APPROVE_BLUEPRINT"}, g.args("REQ-NEW-FACT")]), /BATCH_BLUEPRINT_DEPENDENCY_CHANGED/);
});

test("mode change is explicit and first; duplicates, foreign versions, proposals and unchosen decisions do not prepare", t => {
  const f = fixture(t); f.add("REQ-CLOSE"); const p = f.service.get(f.p.project_id), reason = "A product-level specification target.";
  const mode = {schema_version: "0.1.0", project_id: p.project_id, expected_version: p.model_version, idempotency_key: "mode",
    operation: "xmi_delivery_mode_select", mode: "PRODUCT_GRADE", reason, fingerprint: modeFingerprint(p, "PRODUCT_GRADE", reason), intent: "SELECT_MODE", change: "UPGRADE"};
  assert.throws(() => f.prepare([f.args("REQ-CLOSE"), mode]), /BATCH_MODE_MUST_BE_FIRST/);
  assert.throws(() => f.prepare([f.args("REQ-CLOSE"), f.args("REQ-CLOSE")]), /BATCH_DUPLICATE_TARGET/);
  assert.throws(() => f.prepare([{...f.args("REQ-CLOSE"), project_id: "XMI-OTHER"}]), /VERSION_CONFLICT/);
  assert.throws(() => f.prepare([]), /BATCH_REVIEW_SIZE_INVALID/);
  const prepared = f.prepare([mode, f.args("REQ-CLOSE")]); f.display(prepared.review_text); f.prompt("确认好了"); f.commit();
  assert.equal(f.service.get(p.project_id).delivery_policy!.effective_mode, "PRODUCT_GRADE");
});

for (const [name, reply, modify] of [["numbered change", "第2项修改，其他同意", false], ["qualified confirmation", "确认好了，但第1项不要", false],
  ["altered display", "确认好了", true]] as const) test(`${name} never grants a partial or altered batch`, t => {
  const f = fixture(t); f.add("REQ-ONE"); f.add("REQ-TWO"); const before = f.service.get(f.p.project_id);
  const prepared = f.prepare([f.args("REQ-ONE"), f.args("REQ-TWO")]); f.display(prepared.review_text);
  if (modify) f.display(prepared.review_text.replace("本次 2 项", "本次 1 项"));
  f.prompt(reply); assert.equal(readSingle(f.directory, session)!.status, "INVALIDATED");
  assert.throws(f.commit, /NATIVE_OWNER_REPLY_REQUIRED/); assert.deepEqual(f.service.get(f.p.project_id), before);
});

test("late transaction failure rolls back every action and receipt; a granted batch may retry", t => {
  const f = fixture(t); f.add("REQ-ONE"); f.add("REQ-TWO"); const before = f.service.get(f.p.project_id), events = f.service.history(f.p.project_id).length;
  const prepared = f.prepare([f.args("REQ-ONE"), f.args("REQ-TWO")]); f.display(prepared.review_text); f.prompt("确认好了");
  const record = readSingle(f.directory, session)!;
  assert.throws(() => f.service.confirmActions({project_id: before.project_id, project_version: before.model_version,
    review_id: prepared.review_id, commands: record.commands}, {type: "owner_action", ref: record.grant_source_ref!.ref}, () => {throw new DomainError("STORAGE_FAILURE");}), /STORAGE_FAILURE/);
  assert.deepEqual(f.service.get(before.project_id), before); assert.equal(f.service.history(before.project_id).length, events);
  f.commit(); assert.equal(f.service.history(before.project_id).length, events + 2);
});

test("50 committed actions recover from a sidecar write failure without another reply or duplicate events", t => {
  const f = fixture(t), ids = Array.from({length: 50}, (_, i) => "REQ-BATCH-" + i);
  for (const id of ids) f.add(id);
  const p = f.service.get(f.p.project_id), requests = ids.map(id => {const item = p.items.find(i => i.id === id)!;
    return {schema_version: "0.1.0", project_id: p.project_id, expected_version: p.model_version, idempotency_key: id,
      operation: "xmi_item_confirm", item_id: id, item_version: item.version, fingerprint: itemFingerprint(item), intent: "CONFIRM"};});
  const prepared = f.prepare(requests); assert.match(prepared.review_text, /本次 50 项/);
  f.display(prepared.review_text); f.prompt("确认好了");
  const before = f.service.history(f.p.project_id).length, original = fs.renameSync;
  const mock = t.mock.method(fs, "renameSync", (...args: Parameters<typeof fs.renameSync>) => {
    if (String(args[1]).endsWith(session + ".single.json")) throw Object.assign(new Error("sidecar busy"), {code: "EPERM"}); return original(...args);
  }); syncBuiltinESMExports();
  try {assert.throws(f.commit, /sidecar busy/);} finally {mock.mock.restore(); syncBuiltinESMExports();}
  assert.equal(readSingle(f.directory, session)!.status, "GRANTED"); assert.equal(f.service.history(f.p.project_id).length, before + 50);
  f.commit(); assert.equal(f.service.history(f.p.project_id).length, before + 50);
});

test("a competing native prompt revokes a batch during commit and rolls back all domain writes", t => {
  const f = fixture(t); f.add("REQ-ONE"); f.add("REQ-TWO"); const before = f.service.get(f.p.project_id);
  const prepared = f.prepare([f.args("REQ-ONE"), f.args("REQ-TWO")]); f.display(prepared.review_text); f.prompt("确认好了");
  const original = f.service.confirmActions.bind(f.service);
  t.mock.method(f.service, "confirmActions", (...[input, source, validate]: Parameters<ProjectService["confirmActions"]>) => original(input, source, () => {
    assert.throws(() => f.prompt("等等，这批先别确认"), /CHAT_REVIEW_BUSY/); validate();
  }));
  assert.throws(f.commit, /NATIVE_OWNER_REPLY_EXPIRED/); assert.deepEqual(f.service.get(f.p.project_id), before);
});

test("new reply and a later module list invalidate the whole pending batch", t => {
  const f = fixture(t); f.add("REQ-ONE"); f.add("REQ-TWO");
  const prepared = f.prepare([f.args("REQ-ONE"), f.args("REQ-TWO")]); f.display(prepared.review_text); f.prompt("确认好了");
  f.prompt("等等，我还要改"); assert.equal(readSingle(f.directory, session)!.status, "INVALIDATED"); assert.throws(f.commit, /NATIVE_OWNER_REPLY_REQUIRED/);
  f.prepare([f.args("REQ-ONE"), f.args("REQ-TWO")]);
  createModuleReviewHost(f.directory, session, f.db, f.service).prepare(f.service.get(f.p.project_id), "Closing");
  assert.equal(readSingle(f.directory, session)!.commands, null);
});

test("MCP exposes a closed single-or-batch contract, uses no form, and refuses forged authority/mixed forms", async t => {
  const f = fixture(t); f.add("REQ-ONE"); f.add("REQ-TWO");
  const server = createXmiServer(f.service, {singleReview: f.router}), client = new Client({name: "closing-fixture", version: "1"}, {capabilities: {}});
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b); t.after(async () => {await client.close(); await server.close();});
  const p = f.service.get(f.p.project_id), args = {schema_version: "0.1.0", project_id: p.project_id, expected_version: p.model_version,
    session_id: session, requests: [f.args("REQ-ONE"), f.args("REQ-TWO")]};
  const validate = new Ajv2020({strict: false, validateFormats: false}).compile(toolDescriptors.find(t => t.name === "xmi_item_review_prepare")!.inputSchema);
  assert.ok(validate(args));
  for (const extra of [{request: f.args("REQ-ONE")}, {approved: true}, {actor: "owner"}, {requests: Array(51).fill(f.args("REQ-ONE"))}]) {
    assert.equal(validate({...args, ...extra}), false); assert.equal(inputs.xmi_item_review_prepare.safeParse({...args, ...extra}).success, false);
  }
  const result = await client.callTool({name: "xmi_item_review_prepare", arguments: args}); assert.ok(outputs.xmi_item_review_prepare.safeParse(result.structuredContent).success);
  const value = result.structuredContent as {ok: boolean; data: {action: string; review_text: string; review_id: string}};
  assert.equal(value.ok, true); assert.equal(value.data.action, "BATCH"); f.display(value.data.review_text); f.prompt("确认好了");
  const committed = await client.callTool({name: "xmi_item_review_commit", arguments: {schema_version: "0.1.0", project_id: p.project_id,
    expected_version: p.model_version, session_id: session, review_id: value.data.review_id}});
  assert.equal((committed.structuredContent as {ok: boolean}).ok, true);
});
