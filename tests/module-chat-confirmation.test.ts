import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, toNamespacedPath } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createXmiServer, toolDescriptors } from "../apps/mcp-server/server.ts";
import { inputs, outputs } from "../apps/mcp-server/contracts.ts";
import { SqliteProjectStore } from "../packages/storage/sqlite.ts";
import { ProjectService, replay } from "../packages/core/project-service.ts";
import type { DomainEvent, Project } from "../packages/shared-types/domain.ts";
import { fingerprint } from "../packages/core/validation.ts";
import { prepareModuleConfirmation } from "../packages/core/module-confirmation.ts";
import { createModuleReviewHost, createModuleReviewRouter, readPending, writeRecord, withReviewLock } from "../apps/local-module-review/adapter.ts";
import { processUserPrompt } from "../apps/local-module-review/hook.ts";
import { checkReviewDisplay } from "../apps/local-module-review/display-check.ts";

const session = "00000000-0000-0000-0000-000000000001";
const turn = "00000000-0000-0000-0000-000000000002";
const source = {type: "conversation_turn" as const, ref: "fixture:user-answer"};
function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "xmi-module-fixture-"));
  const db = join(directory, "state.sqlite");
  const store = new SqliteProjectStore(db);
  const service = new ProjectService(store);
  t.after(() => { store.close(); rmSync(directory, {recursive: true, force: true}); });
  let project = service.create({title: "Fixture", idea: "A game", source_ref: source, idempotency_key: "create"});
  for (let i = 1; i <= 3; i++) project = service.execute({project_id: project.project_id,
    expected_version: project.model_version, idempotency_key: "add" + i,
    command: {kind: "CANDIDATE_EXTRACTED", candidate: {id: "REQ-" + i, type: "functional_requirement",
      statement: i === 1 ? "保持远程普攻\n嘲讽时改变目标" : "规则" + i, status: "PROPOSED",
      source_refs: [source], tags: ["module:" + (i === 3 ? "装备" : "技能")], priority: "P0"}}});
  const nativeHost = createModuleReviewHost(directory, session, db, service);
  const transcript = join(directory, "fixture-session.jsonl");
  const display = (text: string, phase = "final") => writeFileSync(transcript, JSON.stringify({type: "session_meta", payload: {id: session}}) + "\n" +
    JSON.stringify({type: "response_item", payload: {type: "message", role: "assistant", phase,
      content: [{type: "output_text", text}]}}) + "\n");
  const appendMessage = (role: string, text: string, phase?: string, kinds?: unknown) => appendFileSync(transcript,
    JSON.stringify({type: "response_item", payload: {type: "message", role, ...(phase ? {phase} : {}),
      ...(kinds === undefined ? {} : {internal_chat_message_metadata_passthrough: {content_item_kinds: kinds}}),
      content: [{type: role === "assistant" ? "output_text" : "input_text", text}]}}) + "\n");
  const host = {...nativeHost, prepare(project: Project, module: string) {
    const prepared = nativeHost.prepare(project, module); display(prepared.review_text); return prepared;
  }};
  const grantPrompt = (text: string, id = session) => processUserPrompt({hook_event_name: "UserPromptSubmit",
    session_id: id, turn_id: turn, prompt: text, transcript_path: transcript}, directory, directory);
  // Legacy end-to-end fixtures exercise the two distinct steps, not a hook write.
  const prompt = (text: string, id = session) => {
    const context = grantPrompt(text, id);
    const record = readPending(directory, id);
    if (record?.status !== "GRANTED") return context;
    try {
      nativeHost.commit(record.review.project_id, record.review.project_version, record.review.review_id);
      return context + "\n确认成功";
    } catch { return context + "\n未取得成功回执"; }
  };
  return {directory, db, store, service, project, host, prompt, grantPrompt, display, appendMessage};
}

test("exiting design revokes a pending module list without instructing another XMi review", t => {
  const f = fixture(t);
  f.grantPrompt("启用 XMi");
  f.host.prepare(f.project, "技能");
  const before = fingerprint(f.service.get(f.project.project_id));
  const context = f.grantPrompt("退出 XMi 设计模式");
  assert.match(context, /设计模式已退出/);
  assert.doesNotMatch(context, /重新展示|review_commit|At finalization/);
  assert.equal(readPending(f.directory, session)?.status, "INVALIDATED");
  assert.equal(fingerprint(f.service.get(f.project.project_id)), before);
});

test("module list includes full ordinary statements from one module and creates no confirmation", t => {
  const f = fixture(t);
  f.prompt("继续讨论");
  const prepared = f.host.prepare(f.project, "技能");
  assert.deepEqual(prepared.review.items.map(item => item.id), ["REQ-1", "REQ-2"]);
  assert.match(prepared.review_text, /1\. REQ-1/);
  assert.match(prepared.review_text, /嘲讽时改变目标/);
  assert.doesNotMatch(prepared.review_text, /owner_action|source_refs|file_path/);
  assert.equal(f.service.get(f.project.project_id).model_version, f.project.model_version);
});

test("genuine adapter prompt fixture confirms a module atomically with source event, retry is harmless", t => {
  const f = fixture(t);
  f.prompt("继续");
  f.host.prepare(f.project, "技能");
  assert.match(f.prompt("确认好了"), /确认成功/);
  const project = f.service.get(f.project.project_id);
  assert.equal(project.model_version, f.project.model_version + 2);
  assert.ok(project.items.filter(item => item.tags?.includes("module:技能")).every(item => item.status === "CONFIRMED"));
  assert.equal(project.items.find(item => item.id === "REQ-3")!.status, "PROPOSED");
  assert.match(project.items.find(item => item.id === "REQ-1")!.source_refs.at(-1)!.ref, /^codex-user-prompt:/);
  assert.match(f.prompt("确认好了"), /routing only/);
  assert.equal(f.host.status(project).status, "CONFIRMED");
});

test("module hook grants without canonical writes; commit rejects forged binding and retries once", t => {
  const f = fixture(t); f.grantPrompt("继续");
  const {review} = f.host.prepare(f.project, "技能");
  const commit = () => f.host.commit(f.project.project_id, f.project.model_version, review.review_id);
  assert.throws(commit, /NATIVE_OWNER_REPLY_REQUIRED/);
  f.grantPrompt("确认好了");
  assert.equal(f.host.status(f.project).status, "GRANTED");
  assert.equal(f.service.get(f.project.project_id).model_version, f.project.model_version);
  const grant = readPending(f.directory, session)!;
  writeRecord(f.directory, session, {...grant, review: {...grant.review, module: "伪造"}});
  assert.throws(commit, /FINGERPRINT_MISMATCH/);
  writeRecord(f.directory, session, grant);
  assert.throws(() => f.host.commit(f.project.project_id, f.project.model_version + 1, review.review_id), /VERSION_CONFLICT/);
  assert.throws(() => f.host.commit(f.project.project_id, f.project.model_version, turn), /CHAT_CONFIRMATION_UNAVAILABLE/);
  const otherDb = createModuleReviewHost(f.directory, session, join(f.directory, "other.sqlite"), f.service);
  assert.throws(() => otherDb.commit(f.project.project_id, f.project.model_version, review.review_id), /CHAT_CONFIRMATION_UNAVAILABLE/);
  const otherSession = createModuleReviewHost(f.directory, turn, f.db, f.service);
  assert.throws(() => otherSession.commit(f.project.project_id, f.project.model_version, review.review_id), /CHAT_CONFIRMATION_UNAVAILABLE/);
  const first = commit();
  assert.equal(first.model_version, f.project.model_version + 2);
  assert.deepEqual(commit(), first);
  assert.equal(f.service.history(f.project.project_id).length, f.project.model_version + 2);
});

test("module grant survives transaction rollback and committed-sidecar failure without duplicate events", t => {
  const f = fixture(t); f.grantPrompt("继续");
  const {review} = f.host.prepare(f.project, "技能"); f.grantPrompt("确认好了");
  let receipts = 0;
  const failing = new ProjectService({close() {}, transaction: work => f.store.transaction(tx => work({...tx,
    saveReceipt(key, receipt) { if (++receipts === 2) throw new Error("late failure"); tx.saveReceipt(key, receipt); },
  }))});
  const badHost = createModuleReviewHost(f.directory, session, f.db, failing);
  assert.throws(() => badHost.commit(f.project.project_id, f.project.model_version, review.review_id), /STORAGE_FAILURE/);
  assert.equal(readPending(f.directory, session)!.status, "GRANTED");
  assert.equal(f.service.history(f.project.project_id).length, f.project.model_version);
  const rename = fs.renameSync;
  const mock = t.mock.method(fs, "renameSync", (...args: Parameters<typeof fs.renameSync>) => {
    if (String(args[1]) === join(f.directory, session + ".json")) throw Object.assign(new Error("sidecar denied"), {code: "EACCES"});
    return rename(...args);
  });
  syncBuiltinESMExports();
  try { assert.throws(() => f.host.commit(f.project.project_id, f.project.model_version, review.review_id), /sidecar denied/); }
  finally { mock.mock.restore(); syncBuiltinESMExports(); }
  assert.equal(readPending(f.directory, session)!.status, "GRANTED");
  assert.equal(f.service.history(f.project.project_id).length, f.project.model_version + 2);
  f.host.commit(f.project.project_id, f.project.model_version, review.review_id);
  assert.equal(readPending(f.directory, session)!.status, "CONFIRMED");
  assert.equal(f.service.history(f.project.project_id).length, f.project.model_version + 2);
});

test("new native prompts and competing reviews expire grants; busy native prompt rolls back an in-flight batch", t => {
  for (const next of ["改第1条", "现在状态如何？"]) {
    const f = fixture(t); f.grantPrompt("继续"); const {review} = f.host.prepare(f.project, "技能"); f.grantPrompt("确认好了");
    f.grantPrompt(next);
    assert.equal(readPending(f.directory, session)!.status, "INVALIDATED");
    assert.throws(() => f.host.commit(f.project.project_id, f.project.model_version, review.review_id), /NATIVE_OWNER_REPLY_REQUIRED/);
  }
  const f = fixture(t); f.grantPrompt("继续"); const {review} = f.host.prepare(f.project, "技能"); f.grantPrompt("确认好了");
  withReviewLock(f.directory, session, () => assert.throws(() => f.host.prepare(f.project, "装备"), /CHAT_REVIEW_BUSY/));
  let interrupted = false;
  const racingService = new ProjectService({close() {}, transaction: work => f.store.transaction(tx => work({...tx,
    saveReceipt(key, receipt) {
      tx.saveReceipt(key, receipt);
      if (!interrupted) { interrupted = true; assert.throws(() => f.grantPrompt("更改"), /CHAT_REVIEW_BUSY/); }
    },
  }))});
  const racingHost = createModuleReviewHost(f.directory, session, f.db, racingService);
  assert.throws(() => racingHost.commit(f.project.project_id, f.project.model_version, review.review_id), /NATIVE_OWNER_REPLY_EXPIRED/);
  assert.equal(f.service.history(f.project.project_id).length, f.project.model_version);
  assert.throws(() => f.host.commit(f.project.project_id, f.project.model_version, review.review_id), /NATIVE_OWNER_REPLY_EXPIRED/);
  f.host.prepare(f.project, "装备");
  assert.throws(() => f.host.commit(f.project.project_id, f.project.model_version, review.review_id), /CHAT_CONFIRMATION_UNAVAILABLE/);
});

test("module commit MCP accepts routing only and requires a genuine fixture grant", async t => {
  const f = fixture(t); f.grantPrompt("继续"); const {review} = f.host.prepare(f.project, "技能");
  const server = createXmiServer(f.service, {moduleReview: createModuleReviewRouter(f.directory, f.db, undefined, f.service)});
  const client = new Client({name: "module-commit-fixture", version: "1"}, {capabilities: {}});
  const [left, right] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(right), client.connect(left)]);
  t.after(async () => {await client.close(); await server.close();});
  const args = {schema_version: "0.1.0", project_id: f.project.project_id, expected_version: f.project.model_version,
    review_id: review.review_id, session_id: session};
  for (const extra of [{approved: true}, {actor: "owner"}, {source_ref: source}, {prompt: "确认好了"}]) {
    assert.equal((await client.callTool({name: "xmi_module_review_commit", arguments: {...args, ...extra}})).isError, true);
  }
  assert.equal((await client.callTool({name: "xmi_module_review_commit", arguments: args})).isError, true);
  f.grantPrompt("确认好了");
  const applied = await client.callTool({name: "xmi_module_review_commit", arguments: args});
  assert.equal(applied.isError, false);
  assert.ok(outputs.xmi_module_review_commit.safeParse(applied.structuredContent).success);
  const descriptor = toolDescriptors.find(tool => tool.name === "xmi_module_review_commit")!;
  assert.equal(descriptor.annotations!.readOnlyHint, false);
  assert.equal(descriptor.annotations!.destructiveHint, false);
  assert.match(descriptor.description!, /GRANTED/);
});

test("no native event means no preparation or model consent", t => {
  const f = fixture(t);
  assert.throws(() => f.host.prepare(f.project, "技能"), /CHAT_CONFIRMATION_UNAVAILABLE/);
  assert.throws(() => processUserPrompt({session_id: session, turn_id: turn, prompt: "确认好了"}, f.directory));
  assert.equal(f.service.get(f.project.project_id).model_version, f.project.model_version);
});

test("current Codex final_answer phase confirms the complete exact module list", t => {
  const f = fixture(t); f.prompt("继续");
  const prepared = f.host.prepare(f.project, "技能");
  f.display("模块说明\n\n" + prepared.review_text, "final_answer");
  f.appendMessage("user", "确认好了");
  assert.match(f.prompt("确认好了"), /确认成功/);
  const project = f.service.get(f.project.project_id);
  assert.equal(project.model_version, f.project.model_version + 2);
  assert.ok(project.items.filter(item => item.tags?.includes("module:技能")).every(item => item.status === "CONFIRMED"));
  assert.equal(project.items.find(item => item.id === "REQ-3")!.status, "PROPOSED");
});

test("commentary, analysis and unknown phases do not authorize the displayed list", t => {
  const f = fixture(t); f.prompt("继续");
  for (const phase of ["commentary", "analysis", "future_final"]) {
    const prepared = f.host.prepare(f.project, "技能");
    f.display(prepared.review_text, phase);
    assert.match(f.prompt("确认好了"), /未能核验/);
    assert.equal(f.host.status(f.project).status, "INVALIDATED");
    assert.equal(f.service.get(f.project.project_id).model_version, f.project.model_version);
  }
});

test("native hook and transcript reply edge whitespace differences preserve exact approval", t => {
  for (const phase of ["final", "final_answer"]) {
    for (const [loggedReply, hookReply] of [
      ["确认好了\n", "确认好了"],
      ["确认好了\r\n", "确认好了"],
      ["\t 确认好了 \n", "确认好了"],
      ["确认好了", "\r\n确认好了 \t"],
      [" 确认好了\r\n", "\t确认好了\n"],
    ]) {
      const f = fixture(t); f.prompt("继续");
      const prepared = f.host.prepare(f.project, "技能");
      f.display(prepared.review_text, phase);
      f.appendMessage("user", loggedReply!);
      assert.match(f.prompt(hookReply!), /确认成功/);
      const project = f.service.get(f.project.project_id);
      assert.equal(project.model_version, f.project.model_version + 2);
      assert.equal(f.host.status(project).status, "CONFIRMED");
      assert.equal(project.items.find(item => item.id === "REQ-3")!.status, "PROPOSED");
    }
  }
});

test("punctuated and review-specific native approvals tolerate only edge whitespace", t => {
  for (const specific of [false, true]) {
    const f = fixture(t); f.prompt("继续");
    const prepared = f.host.prepare(f.project, "技能");
    const reply = specific ? "确认模块 " + prepared.review.review_id : "确认好了。";
    f.display(prepared.review_text, "final_answer");
    f.appendMessage("user", reply + "\r\n");
    assert.match(f.prompt("\t" + reply + " "), /确认成功/);
    assert.equal(f.service.get(f.project.project_id).model_version, f.project.model_version + 2);
  }
});

test("whitespace normalization never removes internal changes or qualified assent", t => {
  const f = fixture(t); f.prompt("继续");
  for (const loggedReply of ["确认 好了\n", "确认\n好了", "确认好了，但第2条需修改\n"]) {
    const prepared = f.host.prepare(f.project, "技能");
    f.display(prepared.review_text, "final_answer");
    f.appendMessage("user", loggedReply);
    // Even an affirmative hook input cannot erase different transcript content.
    assert.match(f.prompt("确认好了"), /未能核验/);
    assert.equal(f.service.get(f.project.project_id).model_version, f.project.model_version);
    f.host.prepare(f.project, "技能");
    assert.match(f.prompt(loggedReply), /没有批准/);
    assert.equal(f.service.get(f.project.project_id).model_version, f.project.model_version);
  }
});

test("reply edge normalization does not relax exact review text whitespace", t => {
  const f = fixture(t); f.prompt("继续");
  for (const alter of [(text: string) => text.replace("保持远程", "保持 远程"),
    (text: string) => text.replace("嘲讽时", "\n嘲讽时")]) {
    const prepared = f.host.prepare(f.project, "技能");
    f.display(alter(prepared.review_text), "final_answer");
    f.appendMessage("user", "确认好了\n");
    assert.match(f.prompt("确认好了"), /未能核验/);
    assert.equal(f.service.get(f.project.project_id).model_version, f.project.model_version);
  }
});

test("a later final in either observed phase supersedes the old displayed review", t => {
  const f = fixture(t); f.prompt("继续");
  for (const [initial, later] of [["final", "final_answer"], ["final_answer", "final"]]) {
    const prepared = f.host.prepare(f.project, "技能");
    f.display(prepared.review_text, initial);
    f.appendMessage("assistant", "当前清单已失效，请重新生成。", later);
    assert.match(f.prompt("确认好了"), /未能核验/);
    assert.equal(f.service.get(f.project.project_id).model_version, f.project.model_version);
  }
});

test("final_answer still refuses modified or truncated review content", t => {
  const f = fixture(t); f.prompt("继续");
  for (const transform of [(text: string) => text.replace("远程", "近战"), (text: string) => text.slice(0, -12)]) {
    const prepared = f.host.prepare(f.project, "技能");
    f.display(transform(prepared.review_text), "final_answer");
    assert.match(f.prompt("确认好了"), /未能核验/);
    assert.equal(f.service.get(f.project.project_id).model_version, f.project.model_version);
  }
});

test("explicit injected host context preserves the current exact list before a real user reply", t => {
  for (const kinds of [["agents_md.instructions"], ["environments.environment_context"],
    ["agents_md.instructions", "environments.environment_context"]]) {
    const f = fixture(t); f.prompt("继续");
    const prepared = f.host.prepare(f.project, "技能");
    f.display(prepared.review_text, "final_answer");
    f.appendMessage("user", "# AGENTS.md instructions\n<environment_context>fixture</environment_context>", undefined, kinds);
    f.appendMessage("user", "确认好了\n", undefined, ["user.text"]);
    assert.match(f.prompt("确认好了"), /确认成功/);
    assert.equal(f.service.get(f.project.project_id).model_version, f.project.model_version + 2);
    assert.equal(f.service.get(f.project.project_id).items.find(item => item.id === "REQ-3")!.status, "PROPOSED");
  }
});

test("missing, unknown, malformed and mixed metadata never hides an intervening user change", t => {
  for (const kinds of [undefined, [], "agents_md.instructions", ["future.host_context"],
    ["agents_md.instructions", "user.text"], ["environments.environment_context", null]]) {
    const f = fixture(t); f.prompt("继续");
    const prepared = f.host.prepare(f.project, "技能");
    f.display(prepared.review_text, "final_answer");
    f.appendMessage("user", "# AGENTS.md instructions\n先修改第1条", undefined, kinds);
    f.appendMessage("user", "确认好了", undefined, ["user.text"]);
    assert.match(f.prompt("确认好了"), /未能核验/);
    assert.equal(f.service.get(f.project.project_id).model_version, f.project.model_version);
  }
});

test("injected host context cannot conceal a real user change or an altered list", t => {
  for (const altered of [false, true]) {
    const f = fixture(t); f.prompt("继续");
    const prepared = f.host.prepare(f.project, "技能");
    f.display(altered ? prepared.review_text.replace("远程", "近战") : prepared.review_text, "final_answer");
    f.appendMessage("user", "项目上下文", undefined, ["agents_md.instructions", "environments.environment_context"]);
    if (!altered) f.appendMessage("user", "先修改第1条", undefined, ["user.text"]);
    f.appendMessage("user", "确认好了", undefined, ["user.text"]);
    assert.match(f.prompt("确认好了"), /未能核验/);
    assert.equal(f.service.get(f.project.project_id).model_version, f.project.model_version);
  }
});

test("explicit Codex open-page metadata preserves an exact review for null and selected pages", t => {
  for (const [pageId, kinds] of [[null, ["additional_content.codex_apps_open_page"]],
    ["fixture-page", ["environments.environment_context", "additional_content.codex_apps_open_page"]]]) {
    const f = fixture(t); f.prompt("continue");
    const review = f.host.prepare(f.project, "\u6280\u80fd");
    f.display(review.review_text, "final_answer");
    f.appendMessage("user", "<external_codex_apps_open_page>" + JSON.stringify({page_id: pageId}) +
      "</external_codex_apps_open_page>", undefined, kinds);
    f.appendMessage("user", "\u786e\u8ba4\u597d\u4e86\n", undefined, ["user.text"]);
    assert.match(f.prompt("\u786e\u8ba4\u597d\u4e86"), /\u786e\u8ba4\u6210\u529f/);
    assert.equal(f.service.get(f.project.project_id).model_version, f.project.model_version + 2);
    assert.equal(f.service.get(f.project.project_id).items.find(item => item.id === "REQ-3")!.status, "PROPOSED");
  }
});

test("open-page text without exclusive known host metadata cannot hide a user change", t => {
  for (const kinds of [undefined, ["user.text"], ["additional_content.codex_apps_open_page", "user.text"],
    ["additional_content.codex_apps_open_page", "future.host_context"],
    ["additional_content.codex_apps_open_page", null]]) {
    const f = fixture(t); f.prompt("continue");
    const prepared = f.host.prepare(f.project, "\u6280\u80fd");
    f.display(prepared.review_text, "final_answer");
    f.appendMessage("user", '<external_codex_apps_open_page>{"page_id":null}</external_codex_apps_open_page>', undefined, kinds);
    f.appendMessage("user", "\u786e\u8ba4\u597d\u4e86", undefined, ["user.text"]);
    assert.match(f.prompt("\u786e\u8ba4\u597d\u4e86"), /\u672a\u80fd\u6838\u9a8c/);
    assert.equal(f.service.get(f.project.project_id).model_version, f.project.model_version);
  }
});

test("open-page metadata cannot conceal a real later reply or an altered review", t => {
  for (const altered of [false, true]) {
    const f = fixture(t); f.prompt("continue");
    const prepared = f.host.prepare(f.project, "\u6280\u80fd");
    f.display(altered ? prepared.review_text.slice(0, -12) : prepared.review_text, "final_answer");
    f.appendMessage("user", '<external_codex_apps_open_page>{"page_id":null}</external_codex_apps_open_page>',
      undefined, ["additional_content.codex_apps_open_page"]);
    if (!altered) f.appendMessage("user", "change item 1", undefined, ["user.text"]);
    f.appendMessage("user", "\u786e\u8ba4\u597d\u4e86", undefined, ["user.text"]);
    assert.match(f.prompt("\u786e\u8ba4\u597d\u4e86"), /\u672a\u80fd\u6838\u9a8c/);
    assert.equal(f.service.get(f.project.project_id).model_version, f.project.model_version);
  }
});

test("an intervening different user reply expires a final_answer review", t => {
  const f = fixture(t); f.prompt("继续");
  const prepared = f.host.prepare(f.project, "技能");
  f.display(prepared.review_text, "final_answer");
  f.appendMessage("user", "先修改第1条\n");
  f.appendMessage("user", "确认好了\n");
  assert.match(f.prompt("确认好了"), /未能核验/);
  assert.equal(f.service.get(f.project.project_id).model_version, f.project.model_version);
});

test("numbered changes and ambiguous assent invalidate review without confirming", t => {
  const f = fixture(t);
  f.prompt("继续");
  for (const reply of ["好的", "确认好了，但第2条改为近战", "第1条改一下"]) {
    f.host.prepare(f.project, "技能");
    assert.match(f.prompt(reply), /没有批准/);
    assert.equal(f.host.status(f.project).status, "INVALIDATED");
    assert.equal(f.service.get(f.project.project_id).model_version, f.project.model_version);
  }
});

test("wrong session cannot confirm another session list", t => {
  const f = fixture(t); f.prompt("继续"); f.host.prepare(f.project, "技能");
  assert.match(f.prompt("确认好了", "00000000-0000-0000-0000-000000000099"), /routing only/);
  assert.equal(f.service.get(f.project.project_id).model_version, f.project.model_version);
});

test("hidden, truncated or altered assistant lists do not authorize chat confirmation", t => {
  const f = fixture(t); f.prompt("继续");
  for (const text of ["确认清单已准备，请确认", "## 技能：模块确认清单\n不完整的清单"]) {
    f.host.prepare(f.project, "技能"); f.display(text);
    assert.match(f.prompt("确认好了"), /未能核验/);
    assert.equal(f.service.get(f.project.project_id).model_version, f.project.model_version);
  }
});

test("unsupported transcript format and wrong-session transcript fail closed", t => {
  const f = fixture(t); f.prompt("继续");
  const transcript = join(f.directory, "fixture-session.jsonl");
  for (const header of [{type: "future_format", payload: {id: session}},
    {type: "session_meta", payload: {id: "00000000-0000-0000-0000-000000000099"}}]) {
    f.host.prepare(f.project, "技能");
    writeFileSync(transcript, JSON.stringify(header) + "\n");
    assert.match(f.prompt("确认好了"), /未能核验/);
    assert.equal(f.service.get(f.project.project_id).model_version, f.project.model_version);
  }
});

test("display diagnostics distinguish missing path, read, session, log and review failures", t => {
  const f = fixture(t); f.prompt("继续");
  const prepared = f.host.prepare(f.project, "技能");
  const pending = readPending(f.directory, session)!;
  const transcript = join(f.directory, "fixture-session.jsonl");
  const check = (path: string | null | undefined = transcript) => checkReviewDisplay(path, f.directory, pending, "确认好了");
  assert.equal(check(null).reason, "NO_TRANSCRIPT_PATH");
  assert.equal(check(join(f.directory, "absent.jsonl")).reason, "READ_FAILED");
  assert.equal(check(join(f.directory, "absent.jsonl")).read_error, "ENOENT");
  assert.equal(check().reason, "MATCH");
  assert.equal(check().last_final_phase, "final");
  // The checker never treats unsupported or partially written JSON as approval.
  writeFileSync(transcript, "{partial");
  assert.equal(check().reason, "INVALID_LOG");
  writeFileSync(transcript, JSON.stringify({type: "session_meta", payload: {id: "other"}}) + "\n");
  assert.equal(check().reason, "SESSION_MISMATCH");
  f.display(prepared.review_text, "analysis");
  assert.equal(check().reason, "NO_CURRENT_FINAL");
  f.display("没有清单", "final_answer");
  assert.equal(check().reason, "REVIEW_NOT_IN_FINAL");
  f.display(prepared.review_text.replace("远程", "近战"), "final_answer");
  assert.equal(check().reason, "REVIEW_DIGEST_MISMATCH");
  f.display(prepared.review_text);
  f.appendMessage("user", "先修改规则");
  assert.equal(check().reason, "NO_CURRENT_FINAL");
  f.display(prepared.review_text);
  appendFileSync(transcript, "{partial");
  assert.equal(check().reason, "INVALID_LOG");
  writeFileSync(transcript, JSON.stringify({type: "session_meta", payload: {id: session}}) + "\n" +
    JSON.stringify({type: "response_item", payload: {type: "message", role: "assistant", phase: "final_answer",
      content: [{type: "input_text", text: prepared.review_text}]}}) + "\n");
  assert.equal(check().reason, "UNSUPPORTED_FINAL_CONTENT");
  const outside = mkdtempSync(join(tmpdir(), "xmi-outside-session-"));
  t.after(() => rmSync(outside, {recursive: true, force: true}));
  const outsidePath = join(outside, "untrusted.jsonl");
  writeFileSync(outsidePath, "{}");
  assert.equal(check(outsidePath).reason, "PATH_OUTSIDE_SESSIONS");
  assert.equal(f.service.get(f.project.project_id).model_version, f.project.model_version);
});

test("native failure diagnostics retain only bounded metadata, never prompt, path or review text", t => {
  const f = fixture(t); f.prompt("继续"); f.host.prepare(f.project, "技能");
  const message = processUserPrompt({hook_event_name: "UserPromptSubmit", session_id: session,
    turn_id: turn, prompt: "确认好了", transcript_path: null}, f.directory, f.directory);
  assert.match(message, /诊断码：NO_TRANSCRIPT_PATH/);
  const text = readFileSync(join(f.directory, session + ".host.json"), "utf8");
  const marker = JSON.parse(text);
  assert.equal(marker.display_check.reason, "NO_TRANSCRIPT_PATH");
  assert.equal(marker.display_check.ok, false);
  assert.doesNotMatch(text, /确认好了|保持远程|fixture-session|state\.sqlite|transcript_path"/);
  assert.equal(f.host.status(f.project).status, "INVALIDATED");
  assert.equal(f.service.get(f.project.project_id).model_version, f.project.model_version);
});

test("Windows native hook extended transcript paths confirm only the current bounded session", {skip: process.platform !== "win32"}, t => {
  const f = fixture(t); f.prompt("继续");
  const prepared = f.host.prepare(f.project, "技能");
  f.display(prepared.review_text, "final_answer");
  f.appendMessage("user", "确认好了\n");
  const path = toNamespacedPath(join(f.directory, "fixture-session.jsonl"));
  assert.ok(path.startsWith("\\\\?\\"));
  const pending = readPending(f.directory, session)!;
  assert.equal(checkReviewDisplay(path, f.directory, pending, "确认好了").reason, "MATCH");
  assert.equal(checkReviewDisplay(path, toNamespacedPath(f.directory), pending, "确认好了").reason, "MATCH");
  const outside = mkdtempSync(join(tmpdir(), "xmi-native-outside-"));
  t.after(() => rmSync(outside, {recursive: true, force: true}));
  assert.equal(checkReviewDisplay(path, toNamespacedPath(outside), pending, "确认好了").reason, "PATH_OUTSIDE_SESSIONS");
  const message = processUserPrompt({hook_event_name: "UserPromptSubmit", session_id: session,
    turn_id: turn, prompt: "确认好了", transcript_path: path}, f.directory, f.directory);
  assert.match(message, /xmi_module_review_commit/);
  f.host.commit(f.project.project_id, f.project.model_version, prepared.review.review_id);
  const project = f.service.get(f.project.project_id);
  assert.equal(project.model_version, f.project.model_version + 2);
  assert.equal(f.host.status(project).status, "CONFIRMED");
  assert.equal(project.items.find(item => item.id === "REQ-3")!.status, "PROPOSED");
  const marker = JSON.parse(readFileSync(join(f.directory, session + ".host.json"), "utf8"));
  assert.equal(marker.display_check.reason, "MATCH");
  assert.equal(marker.display_check.ok, true);
  assert.doesNotMatch(JSON.stringify(marker), /保持远程|fixture-session|确认好了/);
});

test("stale project and invalid last member roll back every confirmation", t => {
  const f = fixture(t); f.prompt("继续"); f.host.prepare(f.project, "技能");
  const pending = readPending(f.directory, session)!;
  pending.review.items[1]!.fingerprint = "0".repeat(64);
  writeRecord(f.directory, session, pending);
  assert.match(f.prompt("确认好了"), /未取得成功回执/);
  assert.equal(f.service.get(f.project.project_id).model_version, f.project.model_version);
  const review = prepareModuleConfirmation(f.project, "技能").review;
  review.project_version -= 1;
  assert.throws(() => f.service.confirmModule(review, {type: "owner_action", ref: "fixture:owner"}), /VERSION_CONFLICT/);
  assert.equal(f.service.get(f.project.project_id).model_version, f.project.model_version);
});

test("a 491-event synthetic project confirms five items with one history validation", t => {
  const f = fixture(t);
  const events = f.store.transaction(tx => tx.events(f.project.project_id));
  const initialCount = events.length;
  for (let i = initialCount; i < 491; i++) {
    const event: Omit<DomainEvent, "hash"> = {event_id: "fixture-large-" + i,
      project_id: f.project.project_id, version: i + 1, actor: "agent", occurred_at: f.project.updated_at,
      previous_hash: events.at(-1)!.hash, command: {kind: "CANDIDATE_EXTRACTED", candidate: {
        id: "REQ-LARGE-" + i, type: "functional_requirement", statement: "合成测试规则".repeat(120), status: "PROPOSED",
        source_refs: [source], priority: "P1", tags: ["module:" + (i < initialCount + 3 ? "技能" : "其他")]}}};
    events.push({...event, hash: fingerprint(event)});
  }
  const project = replay(events);
  f.store.transaction(tx => { for (const event of events.slice(initialCount)) tx.append(event); tx.save(project); });
  let historyReads = 0;
  const service = new ProjectService({close() {}, transaction: work => f.store.transaction(tx => work({...tx,
    events(id) { historyReads++; return tx.events(id); }}))});
  const review = prepareModuleConfirmation(project, "技能").review;
  assert.equal(review.items.length, 5);
  const start = performance.now();
  const confirmed = service.confirmModule(review, {type: "owner_action", ref: "fixture:owner"});
  t.diagnostic("Synthetic 491-event / five-item batch duration_ms=" + Math.round(performance.now() - start));
  assert.equal(historyReads, 1);
  assert.equal(confirmed.model_version, 496);
  assert.ok(review.items.every(member => confirmed.items.find(item => item.id === member.id)!.status === "CONFIRMED"));
  assert.equal(f.service.get(project.project_id).model_version, 496);
});

test("one-history batch still rejects corrupt event chains and snapshots before adoption", t => {
  const f = fixture(t);
  const review = prepareModuleConfirmation(f.project, "技能").review;
  for (const corruptEvents of [true, false]) {
    const service = new ProjectService({close() {}, transaction: work => f.store.transaction(tx => work({...tx,
      events(id) {const events = tx.events(id); if (corruptEvents) events.at(-1)!.hash = "0".repeat(64); return events;},
      snapshot(id) {const snapshot = tx.snapshot(id); return corruptEvents ? snapshot : {...snapshot as Project, title: "tampered"};},
    }))});
    assert.throws(() => service.confirmModule(review, {type: "owner_action", ref: "fixture:owner"}),
      corruptEvents ? /CORRUPT_EVENT_CHAIN/ : /CORRUPT_SNAPSHOT/);
    assert.equal(f.service.get(f.project.project_id).model_version, f.project.model_version);
  }
});

test("a late receipt failure rolls back earlier events, snapshots and receipts in the batch", t => {
  const f = fixture(t);
  const review = prepareModuleConfirmation(f.project, "技能").review;
  let writes = 0;
  const service = new ProjectService({close() {}, transaction: work => f.store.transaction(tx => work({...tx,
    saveReceipt(key, receipt) { if (++writes === 2) throw new Error("fixture:late receipt failure"); tx.saveReceipt(key, receipt); },
  }))});
  assert.throws(() => service.confirmModule(review, {type: "owner_action", ref: "fixture:owner"}), /STORAGE_FAILURE/);
  assert.equal(writes, 2);
  assert.equal(f.service.get(f.project.project_id).model_version, f.project.model_version);
  f.store.transaction(tx => {
    assert.equal(tx.events(f.project.project_id).length, f.project.model_version);
    for (let i = 0; i < review.items.length; i++) assert.equal(tx.receipt(f.project.project_id + ":module-review:" + review.review_id + ":" + i), undefined);
  });
});

test("duplicate, cross-module, and material decisions cannot bypass batch invariants", t => {
  const f = fixture(t);
  const review = prepareModuleConfirmation(f.project, "技能").review;
  const ref = {type: "owner_action" as const, ref: "fixture:owner"};
  assert.throws(() => f.service.confirmModule({...review, items: [review.items[0], review.items[0]]}, ref), /DUPLICATE_ITEM_ID/);
  assert.throws(() => f.service.confirmModule({...review, module: "装备"}, ref), /MODULE_ITEM_NOT_APPROVABLE/);
  const marked = structuredClone(f.project);
  marked.items.find(item => item.id === "REQ-1")!.type = "decision";
  assert.equal(prepareModuleConfirmation(marked, "技能").review.items.length, 1);
  assert.equal(f.service.get(f.project.project_id).model_version, f.project.model_version);
});

test("missing launch environment accepts a real explicit native session route without adoption", t => {
  const f = fixture(t); f.prompt("继续");
  const router = createModuleReviewRouter(f.directory, f.db);
  assert.throws(() => router.prepare(f.project, "技能"), /CHAT_CONFIRMATION_SESSION_REQUIRED/);
  assert.equal(router.status(f.project, session).host_ready, true);
  const prepared = router.prepare(f.project, "技能", session);
  assert.equal(prepared.host_ready, true);
  assert.equal(f.service.get(f.project.project_id).model_version, f.project.model_version);
  f.display(prepared.review_text);
  assert.match(f.prompt("确认好了"), /确认成功/);
});

test("explicit route overrides wrong launch environment and never chooses the newest other session", t => {
  const f = fixture(t); f.prompt("继续");
  const other = "00000000-0000-0000-0000-000000000099";
  f.prompt("另外的聊天", other);
  const router = createModuleReviewRouter(f.directory, f.db, "invalid-launch-value");
  assert.throws(() => router.prepare(f.project, "技能"), /CHAT_CONFIRMATION_SESSION_REQUIRED/);
  router.prepare(f.project, "技能", session);
  assert.equal(readPending(f.directory, other), null);
  assert.equal(readPending(f.directory, session)!.review.module, "技能");
  assert.equal(f.service.get(f.project.project_id).model_version, f.project.model_version);
});

test("fabricated session selector is not hook delivery or approval", t => {
  const f = fixture(t); f.prompt("继续");
  const router = createModuleReviewRouter(f.directory, f.db);
  const unknown = "00000000-0000-0000-0000-000000000077";
  assert.equal(router.status(f.project, unknown).host_ready, false);
  assert.throws(() => router.prepare(f.project, "技能", unknown), /CHAT_CONFIRMATION_UNAVAILABLE/);
  assert.equal(readPending(f.directory, unknown), null);
  assert.equal(f.service.get(f.project.project_id).model_version, f.project.model_version);
});

test("MCP routing contract works without CODEX_THREAD_ID and rejects consent flags", async t => {
  const f = fixture(t); f.prompt("继续");
  const server = createXmiServer(f.service, {moduleReview: createModuleReviewRouter(f.directory, f.db)});
  const client = new Client({name: "missing-env-fixture", version: "1"}, {capabilities: {}});
  const [left, right] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(right), client.connect(left)]);
  t.after(async () => { await client.close(); await server.close(); });
  const args = {schema_version: "0.1.0", project_id: f.project.project_id,
    expected_version: f.project.model_version, interview_module: "技能", session_id: session};
  for (const field of [{approved: true}, {owner_action: {}}, {prompt: "确认好了"}, {actor: "owner"}]) {
    const rejected = await client.callTool({name: "xmi_module_review_prepare", arguments: {...args, ...field}});
    assert.equal(rejected.isError, true);
  }
  const status = await client.callTool({name: "xmi_module_review_status", arguments: {
    schema_version: "0.1.0", project_id: f.project.project_id, session_id: session}});
  assert.ok(outputs.xmi_module_review_status.safeParse(status.structuredContent).success);
  assert.equal(status.isError, false);
  const prepared = await client.callTool({name: "xmi_module_review_prepare", arguments: args});
  assert.equal(prepared.isError, false);
  assert.ok(outputs.xmi_module_review_prepare.safeParse(prepared.structuredContent).success);
  assert.equal(f.service.get(f.project.project_id).model_version, f.project.model_version);
});

test("module tools validate metadata and arguments; preparation uses no elicitation", async t => {
  const f = fixture(t); f.prompt("继续");
  const server = createXmiServer(f.service, {moduleReview: f.host});
  const client = new Client({name: "fixture", version: "1"}, {capabilities: {}});
  const [left, right] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(right), client.connect(left)]);
  t.after(async () => { await client.close(); await server.close(); });
  const args = {schema_version: "0.1.0", project_id: f.project.project_id,
    expected_version: f.project.model_version, interview_module: "技能"};
  for (const extra of [{approved: true}, {actor: "owner"}, {prompt: "确认好了"}]) {
    assert.equal(inputs.xmi_module_review_prepare.safeParse({...args, ...extra}).success, false);
  }
  const result = await client.callTool({name: "xmi_module_review_prepare", arguments: args});
  assert.equal(result.isError, false);
  assert.ok(outputs.xmi_module_review_prepare.safeParse(result.structuredContent).success);
  const descriptor = toolDescriptors.find(tool => tool.name === "xmi_module_review_prepare")!;
  assert.equal(descriptor.annotations!.destructiveHint, false);
  assert.match(descriptor.description!, /Does not confirm anything/);
  assert.match(descriptor.description!, /next batch of at most 50/);
  assert.match(descriptor.description!, /only the displayed batch/);
  assert.equal(f.service.get(f.project.project_id).model_version, f.project.model_version);
});

test("134 ordinary pending rules require three separate displayed native fixture replies", t => {
  const f = fixture(t);
  const events = f.store.transaction(tx => tx.events(f.project.project_id));
  const initialCount = events.length;
  for (let i = initialCount; i < 867; i++) {
    const batchIndex = i - initialCount;
    const event: Omit<DomainEvent, "hash"> = {event_id: "fixture-batches-" + i,
      project_id: f.project.project_id, version: i + 1, actor: "agent", occurred_at: f.project.updated_at,
      previous_hash: events.at(-1)!.hash, command: {kind: "CANDIDATE_EXTRACTED", candidate: {
        id: "REQ-BATCH-" + batchIndex, type: "functional_requirement", statement: "完整合成规则" + batchIndex,
        status: "PROPOSED", source_refs: [source], priority: "P1", links: ["REQ-1"],
        tags: ["module:" + (batchIndex < 134 ? "大模块" : "其他")]}}};
    events.push({...event, hash: fingerprint(event)});
  }
  let current = replay(events);
  f.store.transaction(tx => { for (const event of events.slice(initialCount)) tx.append(event); tx.save(current); });
  const initialVersion = current.model_version;
  const seen = new Set<string>();
  f.prompt("继续");
  for (const [batch, size, remaining] of [[0, 50, 84], [1, 50, 34], [2, 34, 0]]) {
    const prepared = f.host.prepare(current, "大模块");
    assert.equal(prepared.review.project_version, current.model_version);
    assert.equal(prepared.review.items.length, size);
    assert.match(prepared.review_text, new RegExp("本批 " + size + " 条"));
    assert.match(prepared.review_text, new RegExp("本批之后尚有 " + remaining + " 条待确认"));
    assert.match(prepared.review_text, /仅确认本批清单/);
    assert.equal(f.service.get(current.project_id).model_version, current.model_version);
    for (const [index, member] of prepared.review.items.entries()) {
      assert.equal(member.id, "REQ-BATCH-" + (batch * 50 + index));
      assert.equal(member.version, 1);
      assert.equal(seen.has(member.id), false);
      assert.ok(prepared.review_text.includes("> 完整合成规则" + (batch * 50 + index)));
      assert.match(prepared.review_text, /关联：REQ-1/);
      seen.add(member.id);
    }
    const started = performance.now();
    assert.match(f.prompt("确认好了"), /确认成功/);
    t.diagnostic("867-event fixture batch=" + batch + " size=" + size + " duration_ms=" + Math.round(performance.now() - started));
    current = f.service.get(current.project_id);
    assert.equal(current.model_version, initialVersion + seen.size);
    const moduleItems = current.items.filter(item => item.tags?.includes("module:大模块"));
    assert.equal(moduleItems.filter(item => item.status === "CONFIRMED").length, seen.size);
    assert.equal(moduleItems.filter(item => item.status === "PROPOSED").length, remaining);
    assert.ok(moduleItems.every(item => item.links?.includes("REQ-1")));
    assert.equal(current.items.find(item => item.id === "REQ-1")!.status, "PROPOSED");
    assert.equal(f.host.status(current).status, "CONFIRMED");
    assert.match(f.prompt("确认好了"), /routing only/);
    assert.equal(f.service.get(current.project_id).model_version, current.model_version);
  }
  assert.equal(seen.size, 134);
  assert.throws(() => f.host.prepare(current, "大模块"), /MODULE_REVIEW_EMPTY_OR_TOO_LARGE/);
});

test("1089-event isolated module hook with a 34 MB log records timing and atomic confirmation", t => {
  const f = fixture(t);
  const events = f.store.transaction(tx => tx.events(f.project.project_id));
  const initialCount = events.length;
  for (let i = initialCount; i < 1089; i++) {
    const event: Omit<DomainEvent, "hash"> = {event_id: "fixture-large-log-" + i,
      project_id: f.project.project_id, version: i + 1, actor: "agent", occurred_at: f.project.updated_at,
      previous_hash: events.at(-1)!.hash, command: {kind: "CANDIDATE_EXTRACTED", candidate: {
        id: "REQ-LARGE-" + i, type: "functional_requirement", statement: "Isolated performance fixture rule " + i,
        status: "PROPOSED", source_refs: [source], priority: "P1",
        tags: ["module:" + (i < initialCount + 16 ? "性能模块" : "其他")]}}};
    events.push({...event, hash: fingerprint(event)});
  }
  const current = replay(events);
  f.store.transaction(tx => { for (const event of events.slice(initialCount)) tx.append(event); tx.save(current); });
  f.prompt("继续");
  const prepared = f.host.prepare(current, "性能模块");
  const transcript = join(f.directory, "fixture-session.jsonl");
  const padding = JSON.stringify({type: "fixture_padding", payload: "x".repeat(1024)}) + "\n";
  writeFileSync(transcript, JSON.stringify({type: "session_meta", payload: {id: session}}) + "\n" +
    padding.repeat(Math.ceil(34315483 / Buffer.byteLength(padding))));
  f.appendMessage("assistant", prepared.review_text, "final_answer");
  f.appendMessage("user", "确认好了");
  const start = performance.now();
  assert.equal(checkReviewDisplay(transcript, f.directory, readPending(f.directory, session)!, "确认好了").reason, "MATCH");
  const displayMs = performance.now() - start;
  const hookStart = performance.now();
  assert.match(f.grantPrompt("确认好了"), /xmi_module_review_commit/);
  const hookMs = performance.now() - hookStart;
  assert.equal(readPending(f.directory, session)!.status, "GRANTED");
  assert.equal(f.service.get(current.project_id).model_version, 1089);
  const commitStart = performance.now();
  f.host.commit(current.project_id, 1089, prepared.review.review_id);
  const commitMs = performance.now() - commitStart;
  const after = f.service.get(current.project_id);
  assert.equal(after.model_version, 1105);
  assert.equal(prepared.review.items.length, 16);
  assert.ok(prepared.review.items.every(member => after.items.some(item => item.id === member.id && item.status === "CONFIRMED")));
  t.diagnostic(JSON.stringify({fixture: "1089 events / 1089 items / 16 confirmations / 34 MB synthetic log",
    display_ms: Math.round(displayMs), hook_ms: Math.round(hookMs), commit_ms: Math.round(commitMs), host_timeout_ms: 10000,
    exceeds_host_timeout: hookMs >= 10000, live_host_acceptance: false}));
});

test("numbered changes and stale state invalidate a partial batch without adopting undisplayed rows", t => {
  const f = fixture(t);
  const expanded = structuredClone(f.project);
  const template = expanded.items.find(item => item.id === "REQ-1")!;
  expanded.items = Array.from({length: 134}, (_, i) => ({...structuredClone(template), id: "REQ-PARTIAL-" + i}));
  const prepared = prepareModuleConfirmation(expanded, "技能");
  assert.equal(prepared.review.items.length, 50);
  assert.equal(prepared.review.items.at(-1)!.id, "REQ-PARTIAL-49");
  assert.doesNotMatch(prepared.review_text, /REQ-PARTIAL-50/);
  assert.match(prepared.review_text, /尚有 84 条待确认/);
  f.prompt("继续");
  f.host.prepare(f.project, "技能");
  assert.match(f.prompt("1 修改规则"), /已失效/);
  assert.equal(f.service.get(f.project.project_id).model_version, f.project.model_version);
  f.host.prepare(f.project, "技能");
  const newer = f.service.execute({project_id: f.project.project_id,
    expected_version: f.project.model_version, idempotency_key: "partial-stale",
    command: {kind: "CANDIDATE_EXTRACTED", candidate: {id: "REQ-NEW", type: "functional_requirement",
      statement: "新规则", status: "PROPOSED", source_refs: [source], tags: ["module:技能"]}}});
  assert.match(f.prompt("确认好了"), /未取得成功回执/);
  assert.equal(f.service.get(f.project.project_id).model_version, newer.model_version);
  assert.ok(f.service.get(f.project.project_id).items.every(item => item.status === "PROPOSED"));
});
