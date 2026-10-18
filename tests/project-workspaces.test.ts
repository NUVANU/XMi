import test from "node:test";
import type {TestContext} from "node:test";
import assert from "node:assert/strict";
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {tmpdir} from "node:os";
import {spawnSync} from "node:child_process";
import {DatabaseSync} from "node:sqlite";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js";
import {ElicitRequestSchema} from "@modelcontextprotocol/sdk/types.js";
import {ProjectWorkspaces} from "../apps/mcp-server/project-workspaces.ts";
import {createXmiServer} from "../apps/mcp-server/server.ts";
import {outputs} from "../apps/mcp-server/contracts.ts";
import {ProjectService} from "../packages/core/project-service.ts";
import {MemoryProjectStore} from "../packages/storage/memory.ts";
import {contextCurrent, projectGuide} from "../packages/storage/project-context.ts";
import {XSpecService} from "../packages/core/xspec-service.ts";
import {reviewProject} from "./fixtures/spec-review-project.ts";
import {createSingleReviewRouter} from "../apps/local-module-review/single.ts";
import {processUserPrompt} from "../apps/local-module-review/hook.ts";

const source = {type: "conversation_turn" as const, ref: "fixture:project-local"};
const idea = {schema_version: "0.1.0", title: "Portable notes", initial_idea: "Record local public notes", source_ref: source, idempotency_key: "create"};
async function call(client: Client, name: keyof typeof outputs, args: Record<string, unknown>) {
  const r = await client.callTool({name, arguments: args}); const value = r.structuredContent;
  assert.ok(outputs[name].safeParse(value).success); return JSON.parse(JSON.stringify(value));
}
async function fixture(t: TestContext, native = false) {
  const root = mkdtempSync(join(tmpdir(), "xmi-project-local-")), folder = join(root, "project"); mkdirSync(folder);
  writeFileSync(join(folder, "existing-source.txt"), "Keep my engineering files.");
  const memory = new MemoryProjectStore(), legacy = new ProjectService(memory), manager = new ProjectWorkspaces(join(root, "locations.sqlite"));
  const session = "00000000-0000-4000-8000-000000000001", turn = "00000000-0000-4000-8000-000000000002";
  const nativeDir = join(root, "native"), sessions = join(root, "sessions"), log = join(sessions, "test.jsonl"); mkdirSync(sessions);
  const prompt = (text: string) => processUserPrompt({hook_event_name: "UserPromptSubmit", session_id: session, turn_id: turn,
    prompt: text, transcript_path: log}, nativeDir, sessions);
  if (native) prompt("继续");
  let consent: "accept" | "cancel" = "accept", approvals = 0, beforeApproval = () => {};
  const server = createXmiServer(legacy, {workspaces: manager, workspaceOptions: binding => ({options: {
    projectDirectory: binding.root, storagePath: binding.database,
    singleReview: native ? createSingleReviewRouter(nativeDir, binding.database, session, binding.service) : undefined}})});
  const client = new Client({name: "portable-project-fixture", version: "1"}, {capabilities: {elicitation: {form: {}}}});
  client.setRequestHandler(ElicitRequestSchema, async request => {
    assert.ok("requestedSchema" in request.params);
    approvals++; beforeApproval(); return consent === "cancel" ? {action: "cancel"} : {action: "accept", content:
      Object.fromEntries(Object.keys(request.params.requestedSchema.properties).map(key => [key, true]))};
  });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
  t.after(async () => {await client.close(); await server.close(); memory.close(); rmSync(root, {recursive: true, force: true});});
  const create = () => call(client, "xmi_project_create", {...idea, project_directory: folder});
  return {root, folder, manager, legacy, client, session, log, prompt, create, approvals: () => approvals, cancel: () => consent = "cancel",
    beforeApproval: (fn: () => void) => beforeApproval = fn};
}

test("creation in an existing engineering folder uses local canonical state and complete readable process files", async t => {
  const f = await fixture(t), created = await f.create(); assert.equal(created.ok, true);
  assert.equal(created.storage.context_status, "CURRENT"); assert.equal(created.storage.database_relative_path, ".xmi/xmi-state.sqlite");
  assert.equal(readFileSync(join(f.folder, "existing-source.txt"), "utf8"), "Keep my engineering files.");
  const binding = f.manager.resolve(created.data.project_id)!;
  try {
    assert.equal(binding.service.history(binding.id).length, 1); assert.equal(contextCurrent(f.folder, binding.service.get(binding.id)), true);
    const model = JSON.parse(readFileSync(join(f.folder, ".xmi/context/model.json"), "utf8"));
    assert.equal(model.project.items[0].status, "PROPOSED");
    assert.equal(JSON.parse(readFileSync(join(f.folder, ".xmi/context/history.json"), "utf8")).events.length, 1);
    assert.equal(readFileSync(join(f.folder, "XMI-START-HERE.md"), "utf8"), projectGuide(binding.id));
    assert.throws(() => f.legacy.get(binding.id), /PROJECT_NOT_FOUND/);
  } finally {binding.close();}
  assert.equal((await f.create()).data.project_id, created.data.project_id);
});

test("new project missing location, cancellation and conflicting files never fall back to the shared store", async t => {
  const f = await fixture(t);
  assert.equal((await call(f.client, "xmi_project_create", idea)).error.code, "PROJECT_DIRECTORY_REQUIRED"); assert.equal(f.approvals(), 0);
  writeFileSync(join(f.folder, "XMI-START-HERE.md"), "Important existing file");
  assert.equal((await f.create()).error.code, "PROJECT_FILE_CONFLICT"); assert.equal(f.approvals(), 0);
  rmSync(join(f.folder, "XMI-START-HERE.md")); f.cancel();
  assert.equal((await f.create()).error.code, "OWNER_DECLINED"); assert.equal(existsSync(join(f.folder, ".xmi")), false);
  assert.equal(existsSync(join(f.root, "locations.sqlite")), false);
});

test("project routing isolates two folders and leaves existing shared projects untouched", async t => {
  const f = await fixture(t), old = f.legacy.create({title: "Legacy", idea: "Existing project", source_ref: source, idempotency_key: "old"});
  const a = await f.create(), other = join(f.root, "second");
  const b = await call(f.client, "xmi_project_create", {...idea, project_directory: other}); assert.equal(b.ok, true);
  assert.notEqual(a.data.project_id, b.data.project_id);
  const route = {schema_version: "0.1.0", project_id: a.data.project_id};
  assert.equal((await call(f.client, "xmi_project_get", {...route, project_directory: other})).error.code, "PROJECT_COPY_CONFLICT");
  const patch = {kind: "ADD_CANDIDATE", candidate: {id: "REQ-LOCAL", type: "functional_requirement", statement: "Save a public note.",
    status: "PROPOSED", source_refs: [source], tags: ["module:Notes"]}};
  const saved = await call(f.client, "xmi_patch_apply", {...route, expected_version: 1, idempotency_key: "draft", patch});
  assert.equal(saved.ok, true); assert.equal(saved.storage.context_status, "CURRENT");
  assert.equal((await call(f.client, "xmi_project_get", {schema_version: "0.1.0", project_id: b.data.project_id})).data.total_items, 1);
  assert.equal((await call(f.client, "xmi_project_get", {schema_version: "0.1.0", project_id: old.project_id})).data.model_version, old.model_version);
  assert.equal(f.legacy.history(old.project_id).length, 1);
});

test("directory retargeted during creation consent cannot redirect the approved write", async t => {
  const f = await fixture(t), unexpected = join(f.root, "unreviewed-folder"); mkdirSync(unexpected);
  f.beforeApproval(() => {renameSync(f.folder, join(f.root, "original-folder")); symlinkSync(unexpected, f.folder, "junction");});
  const result = await f.create(); assert.equal(result.error.code, "PROJECT_DIRECTORY_CHANGED");
  assert.equal(existsSync(join(unexpected, ".xmi")), false);
});

test("closed folder move and a fresh agent registry recover the same identity/history without chat logs", async t => {
  const f = await fixture(t), created = await f.create(), id = created.data.project_id;
  const copied = join(f.root, "copy"); cpSync(f.folder, copied, {recursive: true});
  assert.throws(() => f.manager.resolve(id, copied), /PROJECT_COPY_CONFLICT/);
  rmSync(copied, {recursive: true, force: true});
  const moved = join(f.root, "moved"); renameSync(f.folder, moved);
  assert.throws(() => f.manager.resolve(id), /PROJECT_DIRECTORY_NOT_FOUND/);
  const binding = f.manager.resolve(id, moved)!;
  try {assert.equal(binding.service.get(id).project_id, id); assert.equal(binding.service.history(id).length, 1); assert.equal(f.manager.sync(binding).context_status, "CURRENT");}
  finally {binding.close();}
  const fresh = new ProjectWorkspaces(join(f.root, "new-agent/locations.sqlite")), reopened = fresh.resolve(id, moved)!;
  try {assert.equal(reopened.service.get(id).model_version, 1); assert.equal(fresh.status(reopened).context_status, "CURRENT");}
  finally {reopened.close();}
  assert.equal(existsSync(join(f.root, "new-agent/locations.sqlite")), false, "read-only recovery does not persist an index");
});

test("derived-file failure reports STALE after durable draft; explicit repair changes no event or confirmation", async t => {
  const f = await fixture(t), created = await f.create(), id = created.data.project_id, broken = join(f.folder, ".xmi/context/design.md");
  rmSync(broken); mkdirSync(broken);
  const args = {schema_version: "0.1.0", project_id: id, expected_version: 1, idempotency_key: "save-once",
    patch: {kind: "ADD_CANDIDATE", candidate: {id: "REQ-ONCE", type: "functional_requirement", statement: "Only one draft.", status: "PROPOSED", source_refs: [source]}}};
  const saved = await call(f.client, "xmi_patch_apply", args); assert.equal(saved.ok, true); assert.equal(saved.storage.context_status, "STALE");
  assert.equal(JSON.parse(readFileSync(join(f.folder, ".xmi/context/state.json"), "utf8")).state, "UPDATING");
  rmSync(broken, {recursive: true});
  const repaired = spawnSync(process.execPath, ["tools/project-context.mjs", "--project-dir", f.folder], {encoding: "utf8"});
  assert.equal(repaired.status, 0, repaired.stderr); assert.equal(JSON.parse(repaired.stdout).context_status, "CURRENT");
  const binding = f.manager.resolve(id)!;
  try {assert.equal(binding.service.history(id).length, 2); assert.equal(binding.service.get(id).items.at(-1)!.status, "PROPOSED");} finally {binding.close();}
  assert.equal((await call(f.client, "xmi_patch_apply", args)).data.model_version, 2);
});

test("wrong manifest identity, malformed history and data-directory junctions fail before new mutations", async t => {
  const f = await fixture(t), made = await f.create(), id = made.data.project_id, manifest = join(f.folder, ".xmi/project.json");
  const initial = readFileSync(manifest, "utf8"); writeFileSync(manifest, initial.replace(id, "XMI-OTHER"));
  assert.throws(() => f.manager.resolve(id), /PROJECT_IDENTITY_MISMATCH/); writeFileSync(manifest, initial);
  const db = new DatabaseSync(join(f.folder, ".xmi/xmi-state.sqlite"));
  try {db.exec("DROP TRIGGER events_no_update; UPDATE events SET body='{}'");} finally {db.close();}
  assert.throws(() => f.manager.resolve(id));
  const linked = join(f.root, "linked"), outside = join(f.root, "outside"); mkdirSync(linked); mkdirSync(outside);
  symlinkSync(outside, join(linked, ".xmi"), "junction");
  assert.throws(() => f.manager.plan(linked), /PROJECT_PATH_LINK_REFUSED/);
});

test("canonical transaction marks readable material dirty even if a different request published CURRENT earlier", async t => {
  const f = await fixture(t), made = await f.create(), id = made.data.project_id, binding = f.manager.resolve(id)!;
  try {
    assert.equal(f.manager.sync(binding).context_status, "CURRENT");
    binding.service.execute({project_id: id, expected_version: 1, idempotency_key: "writer-before-crash",
      command: {kind: "CANDIDATE_EXTRACTED", candidate: {id: "REQ-DIRTY", type: "functional_requirement",
        statement: "A saved draft before process interruption.", status: "PROPOSED", source_refs: [source]}}}, "agent");
    // Simulate termination before the MCP wrapper can regenerate reading files.
    assert.equal(JSON.parse(readFileSync(join(f.folder, ".xmi/context/state.json"), "utf8")).state, "UPDATING");
    assert.equal(f.manager.status(binding).context_status, "STALE");
    assert.equal(f.manager.sync(binding).context_status, "CURRENT"); assert.equal(binding.service.history(id).length, 2);
  } finally {binding.close();}
});

test("native genuine-reply fixture confirms the selected local database, not the legacy database", async t => {
  const f = await fixture(t, true), made = await f.create(), id = made.data.project_id;
  const route = {schema_version: "0.1.0", project_id: id}, current = await call(f.client, "xmi_project_get", route), vision = current.data.items[0];
  const prepared = await call(f.client, "xmi_item_review_prepare", {schema_version: "0.1.0", session_id: f.session,
    request: {...route, expected_version: 1, idempotency_key: "adopt", operation: "xmi_item_confirm", item_id: vision.id,
      item_version: vision.version, fingerprint: vision.fingerprint, intent: "CONFIRM"}});
  assert.equal(prepared.ok, true);
  writeFileSync(f.log, JSON.stringify({type: "session_meta", payload: {id: f.session}}) + "\n" + JSON.stringify({type: "response_item",
    payload: {type: "message", role: "assistant", phase: "final_answer", content: [{type: "output_text", text: prepared.data.review_text}]}}) + "\n");
  assert.match(f.prompt("确认好了"), /尚未正式写入/);
  const committed = await call(f.client, "xmi_item_review_commit", {...route, expected_version: 1, session_id: f.session, review_id: prepared.data.review_id});
  assert.equal(committed.ok, true); assert.equal(committed.storage.context_status, "CURRENT");
  const model = JSON.parse(readFileSync(join(f.folder, ".xmi/context/model.json"), "utf8")); assert.equal(model.project.items[0].status, "CONFIRMED");
  assert.throws(() => f.legacy.get(id), /PROJECT_NOT_FOUND/);
  const moved = join(f.root, "confirmed-project-moved"); renameSync(f.folder, moved);
  const reopened = f.manager.resolve(id, moved)!;
  try {assert.equal(reopened.service.get(id).items[0]!.status, "CONFIRMED"); assert.equal(reopened.service.history(id).length, 2);}
  finally {reopened.close();}
});

test("project XSpec export is inside docs/xspec and refuses linked export destinations", t => {
  const base = mkdtempSync(join(tmpdir(), "xmi-project-export-")); t.after(() => rmSync(base, {recursive: true, force: true}));
  const service = new XSpecService(resolve(base)), p = reviewProject(), artifact = service.compile(p);
  const out = service.writeExport(artifact, "v1", false);
  assert.equal(out.relative_path, "docs/xspec/v1"); assert.equal(existsSync(join(base, out.relative_path, "manifest.json")), true);
  assert.equal(service.writeExport(artifact, "v1", false).already_present, true);
  const outside = join(base, "outside"); mkdirSync(outside); symlinkSync(outside, join(base, "docs/xspec/linked"), "junction");
  assert.throws(() => service.writeExport(artifact, "linked", true), /PROJECT_PATH_LINK_REFUSED/);
});

test("fresh actual native STDIO uses project folders and a second runtime resumes without the original chat", async t => {
  const root = mkdtempSync(join(tmpdir(), "xmi-project-stdio-")), folder = join(root, "project");
  t.after(() => rmSync(root, {recursive: true, force: true}));
  async function connect(db: string) {
    const client = new Client({name: "portable-stdio-fixture", version: "1"}, {capabilities: {elicitation: {form: {}}}});
    client.setRequestHandler(ElicitRequestSchema, async request => {
      assert.ok("requestedSchema" in request.params);
      return {action: "accept", content: Object.fromEntries(Object.keys(request.params.requestedSchema.properties).map(k => [k, true]))};
    });
    await client.connect(new StdioClientTransport({command: process.execPath, args: ["apps/mcp-server/main.ts", "--db", db], stderr: "pipe"})); return client;
  }
  const a = await connect(join(root, "legacy.sqlite")); let id: string;
  try {const created = await call(a, "xmi_project_create", {...idea, project_directory: folder}); assert.equal(created.ok, true); id = created.data.project_id;
    assert.equal(created.storage.context_status, "CURRENT");} finally {await a.close();}
  const db = new DatabaseSync(join(root, "legacy.sqlite")); try {assert.equal(db.prepare("SELECT count(*) AS n FROM snapshots").get()!.n, 0);} finally {db.close();}
  const b = await connect(join(root, "fresh-agent.sqlite"));
  try {const restored = await call(b, "xmi_project_resume", {schema_version: "0.1.0", project_id: id!, project_directory: folder});
    assert.equal(restored.ok, true); assert.equal(restored.data.project.model_version, 1); assert.equal(restored.storage.context_status, "CURRENT");}
  finally {await b.close();}
});
