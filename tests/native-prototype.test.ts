import assert from "node:assert/strict";
import test from "node:test";
import type {TestContext} from "node:test";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import {createXmiServer} from "../apps/mcp-server/server.ts";
import {createNativePrototypeRouter} from "../apps/local-module-review/prototype.ts";
import {processUserPrompt} from "../apps/local-module-review/hook.ts";
import {processStopPreflight} from "../apps/local-module-review/stop-check.ts";
import {ProjectService} from "../packages/core/project-service.ts";
import {MemoryProjectStore} from "../packages/storage/memory.ts";
import {reviewProjectService} from "./fixtures/spec-review-project.ts";

const session = "00000000-0000-4000-8000-000000000001", turn = "00000000-0000-4000-8000-000000000002";
const option = "确认输出开发文档";
const draft = {goal: "捡到钥匙，打开迷宫的门。", presentation: "2D", questions: [],
  first_version: [{show: "拿到钥匙后才能开门过关。", check: "没钥匙时门关着，捡到钥匙后显示过关。"}],
  flow: {steps: [{id: "start", label: "进入迷宫", kind: "START"}, {id: "door", label: "带着钥匙吗？", kind: "CHOICE"},
    {id: "find", label: "继续找钥匙", kind: "ACTION"}, {id: "end", label: "开门过关", kind: "OUTCOME"}],
  edges: [{from: "start", to: "door"}, {from: "door", to: "end", label: "是"}, {from: "door", to: "find", label: "否"},
    {from: "find", to: "door"}, {from: "find", to: "door"}]}};

async function fixture(t: TestContext, formal = false) {
  const root = mkdtempSync(join(tmpdir(), "xmi-native-prototype-")), directory = join(root, "reviews"), sessions = join(root, "sessions");
  const log = join(sessions, `rollout-${session}.jsonl`), db = join(root, "xmi.sqlite");
  mkdirSync(sessions);
  const seeded = formal ? reviewProjectService() : undefined;
  const service = seeded?.service ?? new ProjectService(new MemoryProjectStore());
  const project = seeded?.project ?? service.create({title: "钥匙迷宫", idea: draft.goal, idempotency_key: "native-maze",
    profile: "digital-game-v0", source_ref: {type: "conversation_turn", ref: "fixture:maze"}});
  const nativePrototype = createNativePrototypeRouter(directory, db);
  const server = createXmiServer(service, {nativePrototype}), client = new Client({name: "xmi-native-prototype-fixture", version: "1"});
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  t.after(async () => {await client.close(); await server.close(); seeded?.store.close(); rmSync(root, {recursive: true, force: true});});
  const display = (text: string) => writeFileSync(log, [
    {type: "session_meta", payload: {id: session}},
    {type: "response_item", payload: {type: "message", role: "assistant", phase: "final_answer", content: [{type: "output_text", text}]}},
  ].map(row => JSON.stringify(row)).join("\n") + "\n");
  const prompt = (text: string) => processUserPrompt({hook_event_name: "UserPromptSubmit", session_id: session, turn_id: turn,
    prompt: text, transcript_path: log}, directory, sessions);
  prompt("启用 XMi");
  const args = {schema_version: "0.1.0", project_id: project.project_id, expected_version: project.model_version};
  const call = async (name: string, values: Record<string, unknown> = {}) => {
    const output = await client.callTool({name, arguments: {...args, ...values}});
    return JSON.parse(JSON.stringify(output.structuredContent));
  };
  return {root, directory, sessions, service, project, client, call, display, prompt};
}

test("native XMi defaults to a lightweight flow and one authentic selection publishes the exact XSpec", async t => {
  const f = await fixture(t), resumed = await f.call("xmi_project_resume", {detail: "incremental"});
  assert.equal(resumed.data.default_design_flow, "LIGHTWEIGHT");
  assert.match(resumed.data.delivery_workflow.next_action, /xmi_prototype_preview/u);
  assert.ok((await f.client.listTools()).tools.some(tool => tool.name === "xmi_prototype_export"));
  const {data: preview} = await f.call("xmi_prototype_preview", {draft, session_id: session});
  assert.equal(preview.questions.length, 0);
  assert.equal(preview.flow.edges.length, 4);
  const {review_text} = preview.native_review;
  assert.match(review_text, /flowchart TB/u);
  assert.match(review_text, /确认输出开发文档/u);
  const generate = () => f.call("xmi_prototype_export", {session_id: session, snapshot_id: preview.snapshot_id});
  assert.equal((await generate()).error.code, "NATIVE_OWNER_REPLY_REQUIRED");
  assert.equal(existsSync(join(f.root, "prototype-exports")), false);
  const stop = {hook_event_name: "Stop", session_id: session, last_assistant_message: review_text.replace("开门过关", "关门过关")};
  const fix = processStopPreflight(stop, f.directory, f.sessions);
  assert.equal(fix.decision, "block");
  assert.match(String(fix.reason), /native_review\.review_text/u);
  assert.deepEqual(processStopPreflight({...stop, last_assistant_message: review_text}, f.directory, f.sessions), {});
  f.display(review_text);
  assert.match(f.prompt(option), /xmi_prototype_export/u);
  const result = await generate();
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.achieved_level, "PROTOTYPE_READY");
  assert.equal(result.data.readiness, "READY_FOR_XDEV");
  const m = JSON.parse(readFileSync(join(result.data.package_directory, "manifest.json"), "utf8"));
  assert.equal(m.producer_evidence.source_coverage, "COMPLETE");
  assert.match(m.producer_evidence.mode_selection.event.owner_source_ref.ref, /^codex-user-prompt:/u);
  assert.deepEqual(await generate(), result);
  assert.deepEqual(f.service.get(f.project.project_id), f.project);
});

test("native prototype selection fails closed for an altered display and a model-supplied approval", async t => {
  const f = await fixture(t);
  const {data} = await f.call("xmi_prototype_preview", {draft, session_id: session});
  const args = {session_id: session, snapshot_id: data.snapshot_id};
  assert.equal((await f.call("xmi_prototype_export", {...args, approval: option})).error.code, "INVALID_ARGUMENTS");
  f.display(data.native_review.review_text + "\n\n另一个方案是关门过关。");
  assert.match(f.prompt(option), /REVIEW_DIGEST_MISMATCH/u);
  assert.equal((await f.call("xmi_prototype_export", args)).error.code, "NATIVE_OWNER_REPLY_REQUIRED");
  assert.equal(existsSync(join(f.root, "prototype-exports")), false);
});

test("the default route keeps formally specified projects on their existing readiness path", async t => {
  const f = await fixture(t, true);
  const resumed = await f.call("xmi_project_resume", {detail: "incremental"});
  assert.equal(resumed.data.default_design_flow, "STANDARD");
  const {data: preview} = await f.call("xmi_prototype_preview", {draft, session_id: session});
  assert.equal(preview.export_enabled, false);
  assert.equal(preview.native_review, undefined);
  assert.equal((await f.call("xmi_prototype_export", {snapshot_id: preview.snapshot_id, session_id: session})).error.code, "NATIVE_OWNER_REPLY_REQUIRED");
  assert.deepEqual(f.service.get(f.project.project_id), f.project);
});
