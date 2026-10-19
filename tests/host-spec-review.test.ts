import test from "node:test";
import type {TestContext} from "node:test";
import assert from "node:assert/strict";
import {appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, relative, toNamespacedPath} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import {HostSpecReviewRunner} from "../apps/mcp-server/host-spec-review.ts";
import {freezeNativePosition, materialReadCommand, nativeSessionLog} from "../apps/mcp-server/native-spec-review.ts";
import {createXmiServer} from "../apps/mcp-server/server.ts";
import {inputs, outputs} from "../apps/mcp-server/contracts.ts";
import {buildReviewBundle, hostSpecReviewStatusSchema} from "../packages/core/spec-review-service.ts";
import type {SpecReviewResponse} from "../packages/core/spec-review-service.ts";
import {SqliteSpecReviewStore} from "../packages/storage/spec-review-store.ts";
import {canonical} from "../packages/core/validation.ts";
import {buildReviewTransport, reviewPagePath} from "../apps/mcp-server/review-transport.ts";
import {reviewProjectService} from "./fixtures/spec-review-project.ts";

const session = "00000000-0000-4000-8000-000000000001", child = "00000000-0000-4000-8000-000000000002";
const line = (value: unknown) => JSON.stringify(value) + "\n";
function fixture(t: TestContext) {
  const data = reviewProjectService(), root = mkdtempSync(join(tmpdir(), "xmi-host-review-fixture-"));
  const sessions = join(root, "sessions"), date = join(sessions, "2026", "10", "16"), native = join(root, "native"), directory = join(root, "review");
  mkdirSync(date, {recursive: true}); mkdirSync(native);
  const parentPath = join(date, `rollout-${session}.jsonl`), childPath = join(date, `rollout-${child}.jsonl`);
  writeFileSync(parentPath, line({type: "session_meta", payload: {id: session}}));
  writeFileSync(join(native, session + ".host.json"), JSON.stringify({session_id: session, event: "UserPromptSubmit"}));
  const runner = new HostSpecReviewRunner({directory, sessions, native});
  t.after(() => {runner.close(); data.store.close(); rmSync(root, {recursive: true, force: true});});
  const start = () => runner.start(data.project, "review-one", session, () => data.service.get(data.project.project_id));
  function deliver(response?: SpecReviewResponse, options: {fork?: string; tools?: boolean; command?: string; partial?: boolean; parent?: string;
    outerPartial?: boolean; omitPage?: boolean; reorder?: boolean; compacted?: boolean; context?: number} = {}) {
    const prepared = start(), job = prepared.host_job!; assert.ok(job);
    const store = new SqliteSpecReviewStore(join(directory, "reviews.sqlite"));
    const saved = store.get(data.project.project_id, prepared.run_id!)!; store.close();
    const binding = saved.run.host!, packet = readFileSync(binding.material_path, "utf8"), bundle = saved.bundle;
    const value = response ?? {schema_version: "XMI-REVIEW-RESPONSE/1", bundle_sha256: bundle.bundle_sha256,
      covered_ids: bundle.required_ids, covered_files: bundle.candidate.files.map(f => f.path), scope_requirements: bundle.scope_requirements,
      findings: [], unresolved_ids: []};
    const path = "/root/" + job.task_name, text = JSON.stringify(value);
    let pages = buildReviewTransport(packet).pages;
    if (options.omitPage) pages = pages.slice(0, -1);
    if (options.reorder) pages = [...pages].reverse();
    const rows = [
      {type: "session_meta", payload: {id: child, parent_thread_id: session, thread_source: "subagent",
        source: {subagent: {thread_spawn: {parent_thread_id: session, agent_path: path}}}}},
      ...pages.flatMap((page, i) => [
        {type: "response_item", payload: {type: "custom_tool_call", namespace: "functions", name: "exec", call_id: `read-${i}`}},
        {type: "event_msg", payload: {type: "item_completed", item: {type: "CommandExecution", status: "completed",
          command: ["pwsh", "-Command", options.command ?? materialReadCommand(reviewPagePath(binding.material_path, i))],
          aggregated_output: options.partial ? page.slice(0, 500) : page + "\n"}}},
        {type: "response_item", payload: {type: "custom_tool_call_output", call_id: `read-${i}`, output: [
          {type: "input_text", text: "Script completed\nWall time 0.5 seconds\nOutput:\n"},
          {type: "input_text", text: options.outerPartial ? page.slice(0, 500) : page}]}}
      ]),
      {type: "event_msg", payload: {type: "token_count", info: {model_context_window: 475000, last_token_usage: {total_tokens: options.context ?? 50000}}}},
      ...(options.compacted ? [{type: "compacted", payload: {}}] : []),
      ...(options.tools ? [{type: "response_item", payload: {type: "function_call", name: "apply_patch", arguments: "{}"}}] : []),
      {type: "response_item", payload: {type: "message", role: "assistant", phase: "final_answer", content: [{type: "output_text", text}]}},
    ];
    writeFileSync(childPath, rows.map(line).join(""));
    appendFileSync(options.parent ?? parentPath, [
      {type: "response_item", payload: {type: "function_call", namespace: "collaboration", name: "spawn_agent", call_id: "launch-1",
        arguments: JSON.stringify({task_name: job.task_name, fork_turns: options.fork ?? "none", message: "encrypted task content"})}},
      {type: "event_msg", payload: {type: "item_completed", item: {type: "SubAgentActivity", kind: "started", id: "launch-1", agent_thread_id: child, agent_path: path}}},
      {type: "event_msg", payload: {type: "item_completed", item: {type: "SubAgentActivity", kind: "completed", agent_thread_id: child, agent_path: path}}},
      {type: "response_item", payload: {type: "agent_message", author: path, recipient: "/root", content: [{type: "input_text",
        text: `Message Type: FINAL_ANSWER\nTask name: /root\nSender: ${path}\nPayload:\n${text}`}]}},
    ].map(line).join(""));
    return {prepared, binding, value};
  }
  return {...data, root, sessions, directory, runner, start, deliver, parentPath, childPath};
}

function duplicateLog(f: ReturnType<typeof fixture>) {
  const resumed = join(f.sessions, "2026", "10", "16", `rollout-resumed-${session}_${child}.jsonl`);
  writeFileSync(resumed, line({type: "session_meta", payload: {id: session}}));
  // Deliberately make the indexed file older than the other candidate. Selection
  // must follow the native route, not mtime or lexicographic ordering.
  utimesSync(resumed, new Date("2026-01-01"), new Date("2026-01-01"));
  utimesSync(f.parentPath, new Date("2026-10-16"), new Date("2026-10-16"));
  return resumed;
}
function nativeIndex(f: ReturnType<typeof fixture>, path: unknown, id = session) {
  const db = new DatabaseSync(join(f.root, "state_5.sqlite"));
  try {
    db.exec("CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT)");
    db.prepare("INSERT INTO threads VALUES (?,?)").run(id, path as string);
  } finally {db.close();}
}

test("a unique log retains compatibility and does not create a native thread index", t => {
  const f = fixture(t);
  assert.equal(nativeSessionLog(f.sessions, session), realpathSync.native(f.parentPath));
  assert.equal(existsSync(join(f.root, "state_5.sqlite")), false);
});

test("resumed parent with duplicate headers follows the exact read-only native route end to end", t => {
  const f = fixture(t), resumed = duplicateLog(f);
  nativeIndex(f, toNamespacedPath(resumed));
  const before = readFileSync(join(f.root, "state_5.sqlite"));
  assert.equal(nativeSessionLog(f.sessions, session), realpathSync.native(resumed));
  assert.equal(freezeNativePosition(f.sessions, session).parent_log, relative(f.sessions, realpathSync.native(resumed)));
  const {binding} = f.deliver(undefined, {parent: resumed});
  assert.equal(binding.parent_log, relative(f.sessions, realpathSync.native(resumed)));
  assert.equal(f.start().state, "COMPLETED");
  assert.deepEqual(readFileSync(join(f.root, "state_5.sqlite")), before, "the native index is never modified");
});

test("duplicate logs without an authoritative native route remain ambiguous", t => {
  const f = fixture(t); duplicateLog(f);
  assert.throws(() => nativeSessionLog(f.sessions, session), /HOST_REVIEW_NATIVE_LOG_UNAVAILABLE/);
  assert.equal(existsSync(join(f.root, "state_5.sqlite")), false);
});

for (const kind of ["missing_row", "null_route", "wrong_header", "outside_sessions", "unsupported_schema", "corrupt_index", "duplicate_routes"])
  test(`duplicate-log resolution refuses ${kind} instead of choosing a newer file`, t => {
    const f = fixture(t), resumed = duplicateLog(f), index = join(f.root, "state_5.sqlite");
    if (kind === "corrupt_index") writeFileSync(index, "not a native database");
    else if (kind === "unsupported_schema" || kind === "duplicate_routes") {
      const db = new DatabaseSync(index);
      try {
        if (kind === "unsupported_schema") db.exec("CREATE TABLE unsupported (id TEXT)");
        else {db.exec("CREATE TABLE threads (id TEXT, rollout_path TEXT)");
          for (const path of [f.parentPath, resumed]) db.prepare("INSERT INTO threads VALUES (?,?)").run(session, path);}
      } finally {db.close();}
    } else if (kind === "missing_row") nativeIndex(f, resumed, child);
    else if (kind === "null_route") nativeIndex(f, null);
    else if (kind === "wrong_header") {
      writeFileSync(f.childPath, line({type: "session_meta", payload: {id: child}})); nativeIndex(f, f.childPath);
    } else {
      const outside = join(f.root, "outside.jsonl"); writeFileSync(outside, line({type: "session_meta", payload: {id: session}})); nativeIndex(f, outside);
    }
    assert.throws(() => nativeSessionLog(f.sessions, session), /HOST_REVIEW_(?:NATIVE_LOG_UNAVAILABLE|PATH_OUTSIDE_SESSIONS)/);
  });

test("host review prepare/collect binds native sources and never changes product events or grants formal isolation", t => {
  const f = fixture(t), before = canonical(f.service.get(f.project.project_id)), events = f.service.history(f.project.project_id);
  const {prepared} = f.deliver();
  const read = f.runner.status(f.project, prepared.run_id!, session);
  assert.equal(read.state, "RUNNING"); assert.equal(read.source_verified, true);
  const db = new SqliteSpecReviewStore(join(f.directory, "reviews.sqlite"));
  assert.equal(db.get(f.project.project_id, prepared.run_id!)!.sequence, 1, "status never appends"); db.close();
  const completed = f.start(); assert.equal(completed.state, "COMPLETED"); assert.equal(completed.source_verified, true);
  assert.equal(completed.coverage.required_documents, 16); assert.equal(completed.coverage.complete, true);
  assert.equal(completed.gate_eligible, false); assert.equal(completed.isolation_status, "HOST_INHERITED_PERMISSIONS");
  assert.equal(hostSpecReviewStatusSchema.safeParse(completed).success, true);
  assert.deepEqual(f.start(), completed);
  assert.equal(canonical(f.service.get(f.project.project_id)), before); assert.deepEqual(f.service.history(f.project.project_id), events);
  assert.equal(f.runner.status({...f.project, model_version: f.project.model_version + 1}, prepared.run_id!, session).state, "STALE");
});

for (const [name, options] of Object.entries({
  inherited_context: {fork: "all"}, extra_tool: {tools: true}, different_command: {command: "Get-ChildItem"}, truncated_material: {partial: true},
})) test(`host collector rejects ${name} without committing a review`, t => {
  const f = fixture(t), {prepared} = f.deliver(undefined, options);
  const rejected = f.start(); assert.equal(rejected.state, options.partial ? "INCOMPLETE" : "UNVERIFIED"); assert.equal(rejected.source_verified, false);
  const db = new SqliteSpecReviewStore(join(f.directory, "reviews.sqlite"));
  assert.equal(db.get(f.project.project_id, prepared.run_id!)!.sequence, 1); db.close();
});

test("host review refuses incomplete coverage and forged caller data", t => {
  const f = fixture(t), bundle = buildReviewBundle(f.project);
  f.deliver({schema_version: "XMI-REVIEW-RESPONSE/1", bundle_sha256: bundle.bundle_sha256, covered_ids: [],
    covered_files: bundle.candidate.files.map(f => f.path), scope_requirements: bundle.scope_requirements, findings: [], unresolved_ids: []});
  assert.match(f.start().reason, /SPEC_REVIEW_COVERAGE_INCOMPLETE/);
  for (const extra of [{response: {}}, {approved: true}, {agent_id: child}, {transcript_path: "other"}, {gate_eligible: true}])
    assert.equal(inputs.xmi_spec_review_start.safeParse({schema_version: "0.1.0", project_id: f.project.project_id,
      expected_version: f.project.model_version, idempotency_key: "one", session_id: session, ...extra}).success, false);
});

for (const [name, options] of Object.entries({missing_page: {omitPage: true}, reversed_pages: {reorder: true},
  outer_tool_truncation: {outerPartial: true}, compacted_context: {compacted: true}, exhausted_context: {context: 460000}}))
  test(`paged collector rejects ${name} without coverage or canonical writes`, t => {
    const f = fixture(t), before = canonical(f.service.get(f.project.project_id));
    f.deliver(undefined, options); const result = f.start();
    assert.equal(result.state, "INCOMPLETE"); assert.equal(result.coverage.complete, false); assert.equal(result.host_job, null);
    assert.equal(canonical(f.service.get(f.project.project_id)), before);
  });

test("user-quoted completion text and mismatching child origin cannot become native review evidence", t => {
  const f = fixture(t), prepared = f.start();
  appendFileSync(f.parentPath, line({type: "response_item", payload: {type: "message", role: "user", content: [{type: "input_text",
    text: JSON.stringify({type: "SubAgentActivity", kind: "completed", task_name: prepared.host_job!.task_name})}]}}));
  assert.equal(f.start().state, "AWAITING_AGENT");
  f.deliver();
  const lines = readFileSync(f.childPath, "utf8").split("\n");
  const header = JSON.parse(lines[0]!); header.payload.parent_thread_id = child;
  lines[0] = JSON.stringify(header); writeFileSync(f.childPath, lines.join("\n"));
  assert.equal(f.start().state, "UNVERIFIED");
});

test("changed material and same-version changed canonical content invalidate the frozen review", t => {
  const f = fixture(t), {prepared, binding} = f.deliver();
  const changed = {...f.project, title: f.project.title + " changed"};
  assert.equal(f.runner.status(changed, prepared.run_id!, session).state, "STALE");
  appendFileSync(binding.material_path, " ");
  assert.match(f.start().reason, /HOST_REVIEW_MATERIAL_CHANGED/);
  assert.equal(f.runner.status(f.project, prepared.run_id!, child).source_verified, false);
});

test("host review reports blocking findings with bounded pages and preserved coverage", t => {
  const f = fixture(t), bundle = buildReviewBundle(f.project), item = f.project.items[0]!;
  const findings = Array.from({length: 26}, (_, i) => ({id: `FINDING-${i}`, severity: "BLOCKING" as const,
    affected_ids: [item.id], statement: "Synthetic unresolved intent requires Owner review.",
    evidence: [{item_id: item.id, quote: item.statement.slice(0, 100)}], suggestion: "Ask the Owner; do not silently decide."}));
  f.deliver({schema_version: "XMI-REVIEW-RESPONSE/1", bundle_sha256: bundle.bundle_sha256, covered_ids: bundle.required_ids,
    covered_files: bundle.candidate.files.map(file => file.path), scope_requirements: bundle.scope_requirements, findings, unresolved_ids: []});
  const first = f.start(); assert.equal(first.state, "BLOCKING"); assert.equal(first.total_findings, 26);
  assert.equal(first.findings.length, 20); assert.equal(first.next_offset, 20);
  const second = f.runner.status(f.project, first.run_id!, session, 20, 20);
  assert.equal(second.findings.length, 6); assert.equal(second.next_offset, null); assert.equal(second.coverage.complete, true);
});

test("review storage migrates 109 to 110 without rewriting existing TEST_ONLY evidence", t => {
  const f = fixture(t), path = join(f.root, "old.sqlite"), bundle = buildReviewBundle(f.project);
  let store = new SqliteSpecReviewStore(path); const saved = store.prepare(bundle, "old"); store.close();
  const legacy = new DatabaseSync(path); legacy.exec("PRAGMA user_version=109"); legacy.close();
  store = new SqliteSpecReviewStore(path); assert.deepEqual(store.get(f.project.project_id, saved.run.run_id), saved); store.close();
  const migrated = new DatabaseSync(path); assert.equal(migrated.prepare("PRAGMA user_version").get()!.user_version, 110); migrated.close();
});

test("local MCP exposes the host workflow with strict versioned output and no per-row approval form", async t => {
  const f = fixture(t), server = createXmiServer(f.service, {hostSpecReview: f.runner});
  const client = new Client({name: "host-review-fixture", version: "1"}, {capabilities: {}});
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
  t.after(async () => {await client.close(); await server.close();});
  assert.equal((await client.listTools()).tools.length, 28);
  const r = await client.callTool({name: "xmi_spec_review_start", arguments: {schema_version: "0.1.0", project_id: f.project.project_id,
    expected_version: f.project.model_version, idempotency_key: "mcp-host", session_id: session}});
  const parsed = JSON.parse(JSON.stringify(outputs.xmi_spec_review_start.parse(r.structuredContent)));
  assert.equal(parsed.ok, true);
  if (parsed.ok) {assert.equal(parsed.data.schema_version, "XMI-HOST-SPEC-REVIEW/1"); assert.equal(parsed.data.state, "AWAITING_AGENT");}
});
