import assert from "node:assert/strict";
import test from "node:test";
import {existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import {createXmiServer} from "../apps/mcp-server/server.ts";
import {DreamKidsDocumentSession} from "../apps/dreamkids-prototype/document-session.ts";
import {prototypePreview, prototypePreviewSchema} from "../packages/core/prototype-preview.ts";
import {ProjectService} from "../packages/core/project-service.ts";
import {MemoryProjectStore} from "../packages/storage/memory.ts";

const gameDraft = {goal: "做一个捡到钥匙才能开门的迷宫。", presentation: "2D", questions: [],
  first_version: [{show: "拿到钥匙后开门过关。", check: "空手碰门仍关闭，捡钥匙再碰门会显示过关。"}],
  flow: {steps: [{id: "start", label: "进入迷宫", kind: "START"}, {id: "door", label: "带着钥匙吗？", kind: "CHOICE"},
    {id: "key", label: "去找钥匙", kind: "ACTION"}, {id: "end", label: "开门过关", kind: "OUTCOME"}],
  edges: [{from: "start", to: "door"}, {from: "door", to: "end", label: "是"}, {from: "door", to: "key", label: "否"},
    {from: "key", to: "door"}, {from: "key", to: "door"}]}};
const toolDraft = {goal: "做一个统计作息记录的工具。", questions: [],
  first_version: [{show: "输入几段时长后显示总时长。", check: "输入 30 和 20 分钟，显示 50 分钟。"}],
  flow: {steps: [{id: "input", label: "输入各段时长", kind: "START"}, {id: "output", label: "看到合计", kind: "OUTCOME"}],
    edges: [{from: "input", to: "output"}]}};
function fixture(profile: "digital-game-v0" | "web-micro-saas-v0", idea: string) {
  const service = new ProjectService(new MemoryProjectStore());
  const project = service.create({idempotency_key: "fixture", title: "第一版", idea, profile,
    source_ref: {type: "conversation_turn", ref: "fixture:idea"}});
  return {project, service, session: new DreamKidsDocumentSession(project.project_id, () => service.get(project.project_id))};
}

for (const [profile, draft, title] of [["digital-game-v0", gameDraft, "游戏流程图"],
  ["web-micro-saas-v0", toolDraft, "使用流程图"]] as const) {
  test(title + " and one chat choice return a validated standard XSpec, without changing the source project", () => {
    const {project, service, session} = fixture(profile, draft.goal);
    const preview = session.show(prototypePreview(project, draft));
    assert.equal(preview.flow_title, title);
    assert.equal(preview.export_enabled, true);
    assert.equal(preview.flow.edges.length, profile === "digital-game-v0" ? 4 : 1);
    assert.throws(() => session.selectOption(preview.snapshot_id, "确认"), /PROTOTYPE_OPTION_REQUIRED/);
    const response = session.selectOption(preview.snapshot_id, "确认输出开发文档");
    assert.equal(response.action, "DOCUMENT_READY");
    assert.equal(response.validation.package_valid, true);
    assert.equal(response.artifact.files.length, 16);
    const spec = JSON.parse(response.artifact.files.find(file => file.path === "xspec.json")!.content);
    assert.equal(spec.requirements[0].statement, draft.first_version[0]!.show);
    assert.equal(spec.acceptance_criteria[0].statement, draft.first_version[0]!.check);
    assert.match(spec.user_flows[0].steps[0], new RegExp(title));
    assert.equal(spec.solution_blueprint.status, "DELEGATED_TO_XDEV");
    assert.deepEqual(session.selectOption(preview.snapshot_id, "2"), response);
    assert.deepEqual(service.get(project.project_id), project);
  });
}

test("collect experience choices together, re-render once, refuse old snapshots and unsupported public/paid scope", async () => {
  const {project, session} = fixture("digital-game-v0", gameDraft.goal);
  const questions = [{id: "timer", question: "要计时吗？",
    options: [{id: "timed", label: "限时挑战"}, {id: "free", label: "自由探索"}]},
  {id: "presentation", question: "想看怎样的画面？", options: [{id: "flat", label: "2D"}, {id: "solid", label: "3D"}]}];
  const before = session.show(prototypePreview(project, {...gameDraft, presentation: undefined, questions}));
  assert.throws(() => session.selectOption(before.snapshot_id, "2"), /PROTOTYPE_CHOICES_PENDING/);
  await assert.rejects(session.answerChoices(before.snapshot_id, {timer: "free"}, async () => before), /PROTOTYPE_CHOICES_PENDING/);
  await assert.rejects(session.answerChoices(before.snapshot_id, {timer: "free", presentation: "flat"}, async () =>
    prototypePreview(project, {...gameDraft, goal: "做一轮 20 秒限时挑战。"})), /PROTOTYPE_CHOICE_NOT_APPLIED/);
  const after = await session.answerChoices(before.snapshot_id, {timer: "free", presentation: "flat"}, async answers => {
    assert.deepEqual(answers.map(item => item.answer), ["自由探索", "2D 平面"]);
    return prototypePreview(project, gameDraft);
  });
  assert.notEqual(before.snapshot_id, after.snapshot_id);
  assert.throws(() => session.selectOption(before.snapshot_id, "2"), /PROTOTYPE_PREVIEW_CHANGED/);
  assert.deepEqual(after.selected_choices.map(choice => choice.answer), ["自由探索", "2D 平面"]);
  const result = session.selectOption(after.snapshot_id, "确认输出开发文档");
  assert.equal(result.action, "DOCUMENT_READY");
  assert.match(result.artifact.files.find(file => file.path === "xspec.json")!.content, /自由探索/u);
  assert.equal(session.selectOption(after.snapshot_id, "我想改一点").action, "REVISE_DESIGN");
  assert.throws(() => session.selectOption(after.snapshot_id, "2"), /PROTOTYPE_PREVIEW_CHANGED/);
  const publicProject = fixture("digital-game-v0", "用户通过真实支付购买道具和订阅。");
  const unsafe = publicProject.session.show(prototypePreview(publicProject.project, gameDraft));
  assert.equal(unsafe.export_enabled, false);
  assert.throws(() => publicProject.session.selectOption(unsafe.snapshot_id, "2"), /PROTOTYPE_CHOICES_PENDING/);
});

test("only an opted-in MCP host exposes read-only preview and rejects stale versions", async t => {
  const {project, service} = fixture("web-micro-saas-v0", toolDraft.goal);
  for (const enabled of [false, true]) {
    const server = createXmiServer(service, {dreamKidsPrototype: enabled});
    const client = new Client({name: "dreamkids-test", version: "1"});
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    t.after(async () => {await client.close(); await server.close();});
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const {tools} = await client.listTools();
    assert.equal(tools.some(tool => tool.name === "xmi_prototype_preview" && tool.annotations?.readOnlyHint), enabled);
    const args = {schema_version: "0.1.0", project_id: project.project_id, expected_version: project.model_version, draft: toolDraft};
    const result = await client.callTool({name: "xmi_prototype_preview", arguments: args});
    assert.equal(result.isError, !enabled);
    if (enabled) {
      const envelope = result.structuredContent as {data?: unknown} | undefined;
      const preview = prototypePreviewSchema.parse(envelope?.data);
      assert.equal(preview.flow_title, "使用流程图");
      const stale = await client.callTool({name: "xmi_prototype_preview", arguments: {...args, expected_version: project.model_version + 1}});
      assert.equal(stale.isError, true);
    }
  }
});

test("one DreamKids document choice publishes a PROTOTYPE_READY game with exact producer coverage", t => {
  const {project, service} = fixture("digital-game-v0", gameDraft.goal);
  const temp = mkdtempSync(join(tmpdir(), "xmi-dreamkids-export-")), directory = join(temp, "xspec");
  t.after(() => rmSync(temp, {recursive: true, force: true}));
  const session = new DreamKidsDocumentSession(project.project_id, () => service.get(project.project_id), {outputDirectory: directory});
  const preview = session.show(prototypePreview(project, gameDraft));
  assert.equal(preview.questions.length, 0);
  assert.equal(existsSync(directory), false);
  assert.throws(() => session.selectOption(preview.snapshot_id, "确认"), /PROTOTYPE_OPTION_REQUIRED/);
  assert.equal(existsSync(directory), false);
  const result = session.selectOption(preview.snapshot_id, "确认输出开发文档");
  assert.equal(result.action, "DOCUMENT_READY");
  assert.ok(result.package_directory);
  const files = readdirSync(result.package_directory);
  assert.equal(files.length, 16);
  const spec = JSON.parse(readFileSync(join(result.package_directory, "xspec.json"), "utf8"));
  const manifest = JSON.parse(readFileSync(join(result.package_directory, "manifest.json"), "utf8"));
  assert.ok(result.validation.readiness_evaluation.hard_gate_ready,
    JSON.stringify(result.validation.readiness_evaluation.blockers));
  assert.equal(spec.readiness.achieved_level, "PROTOTYPE_READY");
  assert.equal(spec.readiness.owner_confirmed_export, true);
  assert.equal(spec.readiness.blocking_count, 0);
  assert.equal(manifest.producer_evidence.source_coverage, "COMPLETE");
  const mode = manifest.producer_evidence.mode_selection.event;
  assert.equal(mode.owner_source_ref.ref, "dreamkids:confirmed-prototype-document:" + preview.snapshot_id);
  assert.equal(result.validation.consumers.xdev.accepted, true);
  assert.equal(result.validation.consumers.xdev.implementation_authorized, false);
  assert.deepEqual(session.selectOption(preview.snapshot_id, "2"), result);
  const resumed = new DreamKidsDocumentSession(project.project_id, () => service.get(project.project_id),
    {outputDirectory: directory, clock: () => "2026-11-23T00:00:00.000Z"});
  assert.equal(resumed.show(prototypePreview(project, gameDraft)).snapshot_id, preview.snapshot_id);
  assert.deepEqual(resumed.selectOption(preview.snapshot_id, "2"), result);
  assert.equal(readdirSync(directory, {withFileTypes: true}).filter(entry => entry.isDirectory()).length, 1);
  assert.deepEqual(service.get(project.project_id), project);
  const document = join(result.package_directory, "xspec.json");
  writeFileSync(document, "changed");
  assert.throws(() => session.selectOption(preview.snapshot_id, "2"), /XSPEC_EXPORT_PACKAGE_MISMATCH/);
  assert.equal(readFileSync(document, "utf8"), "changed");
});

test("a draft with cross-device shared play cannot use the private single-player profile", () => {
  const {project, session} = fixture("digital-game-v0", gameDraft.goal);
  const preview = session.show(prototypePreview(project, {...gameDraft,
    first_version: [{show: "朋友可用各自设备同时进入同一房间一起竞技", check: "两台设备各自接续同一房间进度"}]}));
  assert.equal(preview.export_enabled, false);
  assert.throws(() => session.selectOption(preview.snapshot_id, "2"), /PROTOTYPE_CHOICES_PENDING/);
});

test("configured export refuses an intrinsically valid but not-ready prototype", t => {
  const {project} = fixture("web-micro-saas-v0", toolDraft.goal);
  const directory = mkdtempSync(join(tmpdir(), "xmi-dreamkids-unready-"));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  const session = new DreamKidsDocumentSession(project.project_id, () => project, {outputDirectory: directory});
  const preview = session.show(prototypePreview(project, toolDraft));
  assert.throws(() => session.selectOption(preview.snapshot_id, "确认输出开发文档"), /XSPEC_PROTOTYPE_NOT_READY/);
  assert.equal(readdirSync(directory, {withFileTypes: true}).some(entry => entry.isDirectory()), false);
});
