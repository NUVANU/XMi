import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import type {TestContext} from "node:test";
import {processCompaction} from "../apps/local-module-review/compaction.ts";
import {processUserPrompt} from "../apps/local-module-review/hook.ts";
import {createSingleReviewRouter} from "../apps/local-module-review/single.ts";
import {parseLocalXmemConfig} from "../apps/local-module-review/xmem-compaction.ts";
import type {CompactionMemory} from "../apps/local-module-review/xmem-compaction.ts";
import {ProjectService} from "../packages/core/project-service.ts";
import {itemFingerprint} from "../packages/core/validation.ts";
import {SqliteProjectStore} from "../packages/storage/sqlite.ts";

const source = {type: "conversation_turn" as const, ref: "fixture:compaction"};
const saved = {project_id: "XMEM-TEST", policy_hash: "a".repeat(64), package_id: "handoff-example"};

function fixture(t: TestContext) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "xmi-compact-")));
  const cwd = join(root, "project"), directory = join(root, "native"), xmi = join(cwd, ".xmi");
  mkdirSync(xmi, {recursive: true});
  const database = join(xmi, "xmi-state.sqlite");
  const store = new SqliteProjectStore(database), service = new ProjectService(store);
  const p = service.create({title: "Synthetic compaction check", idea: "Keep a design across context changes.", source_ref: source, idempotency_key: "create"});
  writeFileSync(join(xmi, "project.json"), JSON.stringify({schema_version: "XMI-LOCAL-PROJECT/1",
    project_id: p.project_id, create_hash: "a".repeat(64), database: "xmi-state.sqlite"}));
  t.after(() => {store.close(); rmSync(root, {recursive: true, force: true});});
  const session_id = randomUUID(), turn_id = randomUUID();
  const record = join(directory, session_id + ".compaction.json");
  const event = {session_id, turn_id, trigger: "auto", cwd};
  const prompt = (text: string, transcript_path?: string) => processUserPrompt({hook_event_name: "UserPromptSubmit",
    session_id, turn_id: randomUUID(), cwd, prompt: text, transcript_path}, directory, root);
  const compact = (hook_event_name: "PreCompact" | "PostCompact", memory: CompactionMemory, extras: Record<string, unknown> = {}) =>
    processCompaction({...event, hook_event_name, ...extras}, directory, memory);
  return {root, cwd, directory, database, record, session_id, prompt, compact, service, p};
}

test("Codex compaction creates one version-bound reminder even without XMem", async t => {
  const f = fixture(t);
  const memory: CompactionMemory = {save: async () => null, restore: async () => assert.fail("No checkpoint to restore")};
  await f.compact("PreCompact", memory);
  assert.equal(existsSync(f.record), false, "ignore unrelated chats");
  f.prompt("启用 XMi，继续产品设计");
  await f.compact("PreCompact", memory);
  assert.equal(JSON.parse(readFileSync(f.record, "utf8")).phase, "PREPARED");
  assert.doesNotMatch(f.prompt("继续"), /压缩完成事件/u);
  await f.compact("PostCompact", memory, {turn_id: randomUUID()});
  assert.doesNotMatch(f.prompt("继续"), /压缩完成事件/u);
  await f.compact("PostCompact", memory);
  const message = f.prompt("继续");
  assert.match(message, /使用 XMi 的本地续跑记录/u);
  assert.ok(message.includes(JSON.stringify({schema_version: "0.1.0", project_id: f.p.project_id,
    project_directory: f.cwd, detail: "incremental", since_version: 1})));
  await f.compact("PostCompact", memory);
  assert.doesNotMatch(f.prompt("继续"), /压缩完成事件/u);
  assert.deepEqual(f.service.get(f.p.project_id), f.p);
});

test("restore accepts a matched XMem handoff and falls back to the canonical delta after edits", async t => {
  const f = fixture(t);
  let restored = 0;
  const memory: CompactionMemory = {save: async checkpoint => {
    assert.equal(checkpoint.project_id, f.p.project_id);
    return saved;
  }, restore: async (checkpoint, pointer) => {
    assert.deepEqual(pointer, saved);
    assert.equal(checkpoint.session_id, f.session_id);
    restored++;
    return true;
  }};
  f.prompt("启用 XMi，继续");
  await f.compact("PreCompact", memory);
  await f.compact("PostCompact", memory);
  assert.match(f.prompt("继续"), /XMem 已校验恢复检查点/u);
  await f.compact("PreCompact", memory);
  f.service.execute({project_id: f.p.project_id, expected_version: 1, idempotency_key: "change",
    command: {kind: "CANDIDATE_EXTRACTED", candidate: {id: "REQ-ISOLATED", type: "functional_requirement",
      statement: "An unconfirmed requirement.", status: "PROPOSED", source_refs: [source]}}});
  await f.compact("PostCompact", memory);
  assert.match(f.prompt("继续"), /本地续跑记录.*"since_version":1/u);
  assert.equal(restored, 1);
  assert.equal(f.service.get(f.p.project_id).items.at(-1)?.status, "PROPOSED");
});

test("pending confirmation survives compaction and still requires the exact genuine reply", async t => {
  const f = fixture(t);
  f.prompt("启用 XMi，继续");
  const router = createSingleReviewRouter(f.directory, f.database, f.session_id, f.service);
  const item = f.p.items[0]!;
  const review = router.prepare(f.p, {schema_version: "0.1.0", project_id: f.p.project_id, expected_version: 1,
    item_id: item.id, item_version: item.version, fingerprint: itemFingerprint(item), idempotency_key: "test-review",
    operation: "xmi_item_confirm", intent: "CONFIRM"}, f.session_id);
  const transcript = join(f.root, "fixture.jsonl");
  writeFileSync(transcript, [JSON.stringify({type: "session_meta", payload: {id: f.session_id}}),
    JSON.stringify({type: "response_item", payload: {type: "message", role: "assistant", phase: "final_answer",
      content: [{type: "output_text", text: review.review_text}]}})].join("\n") + "\n");
  const memory: CompactionMemory = {save: async checkpoint => {
    assert.equal(checkpoint.pending_review, "PENDING"); return saved;
  }, restore: async () => false};
  await f.compact("PreCompact", memory, {trigger: "manual"});
  await f.compact("PostCompact", memory, {trigger: "manual"});
  assert.throws(() => router.commit(f.p.project_id, 1, review.review_id, f.session_id), /NATIVE_OWNER_REPLY_REQUIRED/);
  assert.match(f.prompt("确认", transcript), /压缩前有确认清单/u);
  assert.equal(f.service.get(f.p.project_id).items[0]?.status, "PROPOSED");
  router.commit(f.p.project_id, 1, review.review_id, f.session_id);
  assert.equal(f.service.get(f.p.project_id).items[0]?.status, "CONFIRMED");
});

test("failed companion, mismatched project and explicit exit cannot replay continuation", async t => {
  const f = fixture(t);
  const memory: CompactionMemory = {save: async () => {throw new Error("optional companion failed");},
    restore: async () => assert.fail("No checkpoint to restore")};
  f.prompt("启用 XMi，继续");
  await f.compact("PreCompact", memory);
  await f.compact("PostCompact", memory, {cwd: f.root});
  assert.doesNotMatch(f.prompt("继续"), /压缩完成事件/u);
  await f.compact("PostCompact", memory);
  assert.match(f.prompt("继续"), /本地续跑记录/u);
  await f.compact("PreCompact", memory);
  await f.compact("PostCompact", memory);
  f.prompt("退出 XMi 设计模式");
  assert.doesNotMatch(f.prompt("启用 XMi，继续"), /压缩完成事件/u);
});

test("uninstalled, disabled, remote, restricted and unrelated transports do not provide an XMem client", () => {
  const base = {name: "xmem", enabled: true, transport: {type: "stdio", command: "node", args: ["unrelated.js"]}};
  assert.equal(parseLocalXmemConfig(null), null);
  assert.equal(parseLocalXmemConfig(base), null);
  assert.equal(parseLocalXmemConfig({...base, enabled: false}), null);
  assert.equal(parseLocalXmemConfig({...base, transport: {type: "streamable_http", url: "https://example.invalid"}}), null);
  assert.equal(parseLocalXmemConfig({...base, enabled_tools: ["xmem_session_read"]}), null);
});
