import test from "node:test";
import type {TestContext} from "node:test";
import assert from "node:assert/strict";
import {appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {join, resolve, sep} from "node:path";
import {tmpdir} from "node:os";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import {ElicitRequestSchema} from "@modelcontextprotocol/sdk/types.js";
import {DocumentReviewRunner} from "../apps/mcp-server/document-review.ts";
import {createXmiServer} from "../apps/mcp-server/server.ts";
import {inputs, outputs, metadata} from "../apps/mcp-server/contracts.ts";
import {materialReadCommand} from "../apps/mcp-server/native-spec-review.ts";
import {buildReviewTransport, reviewPagePath} from "../apps/mcp-server/review-transport.ts";
import {buildReviewBundle} from "../packages/core/spec-review-service.ts";
import {collectDocumentReview, documentReviewMaterial, documentReviewStatusSchema} from "../packages/core/document-review.ts";
import {canonical} from "../packages/core/validation.ts";
import {SqliteSpecReviewStore} from "../packages/storage/spec-review-store.ts";
import {reviewProject, reviewProjectService} from "./fixtures/spec-review-project.ts";
import {documentDelivery, documentReviewSummarySchema, unavailableDocumentReview} from "../packages/core/document-delivery.ts";
import {XSpecService} from "../packages/core/xspec-service.ts";

const session = "00000000-0000-4000-8000-000000000001", child = "00000000-0000-4000-8000-000000000002";
const line = (v: unknown) => JSON.stringify(v) + "\n";
function response(p: ReturnType<typeof reviewProject>) {
  return {schema_version: "XMI-DOCUMENT-REVIEW-RESPONSE/1", project_id: p.project_id, model_version: p.model_version,
    findings: [{id: "DOC-1", severity: "BLOCKING", statement: "Save/reload failure recovery needs definition; otherwise users may lose input.",
      evidence: [{item_id: "REQ-REVIEW", quote: "Save a note and reload it."}], suggestion: "Specify failure feedback and retry."},
    {id: "DOC-2", statement: "Define persistence when storage is full, to make the outcome testable.",
      evidence: [{item_id: "DATA-REVIEW", quote: "Public data persists locally."}], suggestion: "State the failure outcome.", edge_ids: ["extra metadata"]}],
    questions: ["What happens if local storage is unavailable?"]};
}

test("document review retains grounded suggestions without coverage ledgers and separates bad findings/extra references", () => {
  const p = reviewProject(35), bundle = buildReviewBundle(p), raw = response(p);
  const result = collectDocumentReview(bundle, undefined, {...raw,
    findings: [...raw.findings, {...raw.findings[0], evidence: [{file_path: "invented.md", quote: "not supplied"}]}, {statement: "missing evidence"}],
    unresolved_ids: Array.from({length: 17}, (_, i) => `BILL-${i}`), questions: [...raw.questions, null]});
  assert.equal(result.findings.length, 2); assert.equal(result.findings[0]!.severity, "BLOCKING");
  assert.equal(result.follow_up_refs.length, 17); assert.equal(result.questions.length, 1);
  assert.ok(result.notes.some(n => n.includes("引用未能"))); assert.ok(result.notes.some(n => n.includes("17个")));
  assert.ok(result.findings.every(f => f.evidence.every(e => bundle.candidate.files.some(d => d.path === e.file_path && d.content.includes(e.quote)))));
  for (const wrong of [{project_id: "other"}, {model_version: p.model_version + 1}])
    assert.throws(() => collectDocumentReview(bundle, undefined, {...raw, ...wrong}), /DOCUMENT_REVIEW_VERSION_MISMATCH/);
});

test("readable document and module inputs omit full model/json and distinguish unavailable module material", () => {
  const p = reviewProject(); p.items.find(i => i.id === "REQ-REVIEW")!.tags = ["module:Notes"];
  const b = buildReviewBundle(p), all = documentReviewMaterial(b), module = documentReviewMaterial(b, "Notes");
  assert.equal(all.documents.length, 14); assert.ok(all.documents.every(d => d.path.endsWith(".md")));
  assert.equal("model" in all, false); assert.equal("candidate" in all, false);
  assert.ok(module.documents[0]!.content.includes("Save a note and reload it."));
  assert.ok(module.documents[0]!.content.includes("Create a note then see the saved result."));
  assert.ok(module.documents[0]!.content.includes("Valid input persists on reload; invalid input creates nothing."));
  assert.equal(module.documents[0]!.content.includes("Public data persists locally."), false);
  assert.throws(() => documentReviewMaterial(b, "Missing"), /DOCUMENT_REVIEW_MODULE_NOT_FOUND/);
  const result = collectDocumentReview(b, "Notes", response(p));
  assert.equal(result.findings.length, 1); assert.ok(result.notes.some(n => n.includes("补充材料")));
});

function fixture(t: TestContext) {
  const data = reviewProjectService(), root = mkdtempSync(join(tmpdir(), "xmi-document-review-"));
  const sessions = join(root, "sessions"), date = join(sessions, "2026", "10", "17"), native = join(root, "native"), directory = join(root, "review");
  mkdirSync(date, {recursive: true}); mkdirSync(native);
  const parent = join(date, `rollout-${session}.jsonl`), childLog = join(date, `rollout-${child}.jsonl`);
  writeFileSync(parent, line({type: "session_meta", payload: {id: session}}));
  writeFileSync(join(native, session + ".host.json"), line({session_id: session, event: "UserPromptSubmit"}));
  const runner = new DocumentReviewRunner({directory, sessions, native});
  t.after(() => {runner.close(); data.store.close(); rmSync(root, {recursive: true, force: true});});
  const start = () => documentReviewStatusSchema.parse(runner.start(data.project, "one", session, () => data.service.get(data.project.project_id)));
  function deliver(options: {badQuote?: boolean; partial?: boolean; clean?: boolean} = {}) {
    const prepared = start(), job = prepared.host_job!; assert.ok(job);
    const db = new SqliteSpecReviewStore(join(directory, "reviews.sqlite"));
    const saved = db.get(data.project.project_id, prepared.run_id!)!; db.close();
    const host = saved.run.host!, packet = readFileSync(host.material_path, "utf8"), value = response(data.project);
    if (options.clean) {value.findings = []; value.questions = [];}
    if (options.badQuote) value.findings[0]!.evidence[0]!.quote = "not supplied";
    const path = "/root/" + job.task_name, text = JSON.stringify(value), pages = buildReviewTransport(packet).pages;
    writeFileSync(childLog, [
      {type: "session_meta", payload: {id: child, parent_thread_id: session, thread_source: "subagent",
        source: {subagent: {thread_spawn: {parent_thread_id: session, agent_path: path}}}}},
      ...pages.flatMap((page, i) => [
        {type: "response_item", payload: {type: "custom_tool_call", namespace: "functions", name: "exec", call_id: `read-${i}`}},
        {type: "event_msg", payload: {type: "item_completed", item: {type: "CommandExecution", status: "completed",
          command: ["pwsh", "-Command", materialReadCommand(reviewPagePath(host.material_path, i))], aggregated_output: page + "\n"}}},
        {type: "response_item", payload: {type: "custom_tool_call_output", call_id: `read-${i}`, output: [
          {type: "input_text", text: "Script completed\nWall time 0.5 seconds\nOutput:\n"},
          {type: "input_text", text: options.partial ? page.slice(0, 20) : page}]}}
      ]),
      // No context-token ledger is needed to return grounded document advice.
      {type: "response_item", payload: {type: "message", role: "assistant", phase: "final_answer", content: [{type: "output_text", text}]}}
    ].map(line).join(""));
    appendFileSync(parent, [
      {type: "response_item", payload: {type: "function_call", namespace: "collaboration", name: "spawn_agent", call_id: "launch-1",
        arguments: JSON.stringify({task_name: job.task_name, fork_turns: "none", message: "synthetic document review fixture"})}},
      {type: "event_msg", payload: {type: "item_completed", item: {type: "SubAgentActivity", kind: "started", id: "launch-1", agent_thread_id: child, agent_path: path}}},
      {type: "event_msg", payload: {type: "item_completed", item: {type: "SubAgentActivity", kind: "completed", agent_thread_id: child, agent_path: path}}},
      {type: "response_item", payload: {type: "agent_message", author: path, recipient: "/root", content: [{type: "input_text",
        text: `Message Type: FINAL_ANSWER\nTask name: /root\nSender: ${path}\nPayload:\n${text}`}]}},
    ].map(line).join(""));
    return {prepared, host, packet};
  }
  return {...data, runner, directory, start, deliver};
}

test("default document runner collects actual-source fixtures once, preserves advisory priority and canonical state", t => {
  const f = fixture(t), before = canonical(f.project), events = f.service.history(f.project.project_id), {prepared, packet} = f.deliver();
  const input = JSON.parse(packet); assert.equal(input.schema_version, "XMI-DOCUMENT-REVIEW-PACKET/1"); assert.equal("model" in input, false);
  assert.equal(input.documents.length, 14); assert.equal("covered_ids" in input.response_schema.properties, false);
  assert.equal(f.runner.status(f.project, prepared.run_id!, session).state, "RUNNING", "status does not commit");
  const done = f.start(); assert.equal(done.state, "COMPLETED"); assert.equal(done.source_verified, true);
  assert.equal(done.total_findings, 2); assert.equal(done.findings[0]!.severity, "BLOCKING"); assert.equal(done.gate_eligible, false);
  assert.deepEqual(f.start(), done);
  const page = documentReviewStatusSchema.parse(f.runner.status(f.project, prepared.run_id!, session, 0, 1));
  assert.equal(page.findings.length, 1); assert.equal(page.next_offset, 1);
  const db = new SqliteSpecReviewStore(join(f.directory, "reviews.sqlite"));
  assert.equal(db.get(f.project.project_id, prepared.run_id!)!.sequence, 3); db.close();
  assert.equal(canonical(f.service.get(f.project.project_id)), before); assert.deepEqual(f.service.history(f.project.project_id), events);
  assert.equal(f.runner.status({...f.project, model_version: f.project.model_version + 1}, prepared.run_id!, session).state, "STALE");
});

test("one ungrounded opinion leaves the other native opinion available with a note", t => {
  const f = fixture(t); f.deliver({badQuote: true}); const done = f.start();
  assert.equal(done.state, "COMPLETED"); assert.equal(done.total_findings, 1); assert.equal(done.findings[0]!.id, "DOC-2");
  assert.ok(done.notes.some(n => n.includes("引用未能")));
});

test("incomplete native delivery and changed packet cannot be committed as document advice", t => {
  const f = fixture(t), {host} = f.deliver({partial: true});
  assert.equal(f.start().state, "INCOMPLETE");
  appendFileSync(host.material_path, "tampered"); assert.equal(f.start().state, "UNVERIFIED");
});

test("native MCP routes to document rereview, accepts module selector and refuses author approval/result fields", async t => {
  const f = fixture(t), server = createXmiServer(f.service, {hostSpecReview: f.runner});
  const client = new Client({name: "document-review-fixture", version: "1"}), [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b); t.after(async () => {await client.close(); await server.close();});
  const args = {schema_version: "0.1.0", project_id: f.project.project_id, expected_version: f.project.model_version, idempotency_key: "mcp", session_id: session};
  const result = await client.callTool({name: "xmi_spec_review_start", arguments: args});
  const envelope = outputs.xmi_spec_review_start.parse(result.structuredContent);
  assert.ok(envelope && typeof envelope === "object" && "ok" in envelope && envelope.ok && "data" in envelope);
  const review = documentReviewStatusSchema.parse(envelope.data);
  assert.equal(review.schema_version, "XMI-DOCUMENT-REVIEW/1"); assert.equal(review.state, "AWAITING_AGENT");
  assert.equal(inputs.xmi_spec_review_start.safeParse({...args, interview_module: "Notes"}).success, true);
  for (const extra of [{approved: true}, {result: "PASS"}, {reviewer_json: response(f.project)}])
    assert.equal(inputs.xmi_spec_review_start.safeParse({...args, ...extra}).success, false);
  assert.equal(metadata.xmi_spec_review_start.write, true); assert.equal(metadata.xmi_spec_review_status.write, false);
  assert.ok(metadata.xmi_spec_review_start.description.includes("do not enumerate"));
});

test("delivery lookup survives runner restart, checks native source and version, and ignores newer module advice", t => {
  const f = fixture(t);
  assert.equal(f.runner.summary(f.project).state, "NOT_STARTED");
  const {prepared, host} = f.deliver();
  assert.equal(f.runner.summary(f.project).state, "RUNNING", "read-only lookup cannot commit a returned result");
  f.start();
  const summary = f.runner.summary(f.project);
  assert.equal(summary.state, "COMPLETED"); assert.equal(summary.source_verified, true);
  assert.equal(summary.run_id, prepared.run_id); assert.equal(summary.finding_count, 2);
  assert.equal(documentDelivery(summary, true).stage, "REVIEW_FINDINGS");
  const db = new SqliteSpecReviewStore(join(f.directory, "reviews.sqlite"));
  const saved = db.get(f.project.project_id, prepared.run_id!)!;
  db.prepare(saved.bundle, "module-only", {...host, interview_module: "Notes"}); db.close();
  assert.equal(f.runner.summary(f.project).run_id, prepared.run_id, "module review cannot replace the full review");
  const stale = f.runner.summary({...f.project, model_version: f.project.model_version + 1});
  assert.equal(stale.state, "STALE"); assert.equal(stale.reviewed_model_version, f.project.model_version);
  assert.equal(documentDelivery(stale, true).stage, "REFRESH_REVIEW");
  const root = join(f.directory, "..");
  const restarted = new DocumentReviewRunner({directory: f.directory, sessions: join(root, "sessions"), native: join(root, "native")});
  try {
    assert.deepEqual(restarted.summary(f.project), summary);
    appendFileSync(host.material_path, "changed");
    assert.equal(restarted.summary(f.project).state, "UNVERIFIED");
  } finally {restarted.close();}
});

test("clean review enables the light delivery step, not formal readiness or product adoption", t => {
  const f = fixture(t), before = canonical(f.service.get(f.project.project_id));
  f.deliver({clean: true}); f.start();
  const summary = f.runner.summary(f.project), workflow = documentDelivery(summary, true);
  assert.equal(workflow.stage, "READY_TO_EXPORT"); assert.equal(workflow.formal_assurance, "NOT_ESTABLISHED");
  const xspec = new XSpecService(), finalized = xspec.finalizeForExport(f.project, {}, summary);
  assert.equal(finalized.validation.package_valid, true);
  assert.equal(finalized.validation.readiness_evaluation.hard_gate_ready, false);
  assert.equal(finalized.artifact.files.length, 16);
  const report = finalized.artifact.files.find(file => file.path === "READINESS-REPORT.md")!.content;
  assert.ok(report.includes("Document review: COMPLETED")); assert.ok(report.includes(summary.run_id!));
  assert.ok(report.includes("Formal permission isolation: NOT VERIFIED"));
  const document = JSON.parse(finalized.artifact.files.find(file => file.path === "xspec.json")!.content);
  assert.equal(document.readiness.status, "NOT_READY");
  assert.equal(document.readiness.hard_gates.find((g: {id: string}) => g.id === "RG-SPEC-REVIEW").passed, false);
  assert.equal(canonical(f.service.get(f.project.project_id)), before);
  assert.equal(documentDelivery(unavailableDocumentReview(f.project), true).stage, "REVIEW_UNAVAILABLE");
  assert.equal(documentDelivery({...summary, note_count: 1}, true).stage, "REVIEW_FINDINGS");
  assert.equal(documentDelivery(summary, false).stage, "CHECK_SPEC");
  for (const changed of [{source_verified: false}, {run_id: null}, {current_model_version: summary.current_model_version + 1}, {formal_isolation_verified: true}]) {
    assert.equal(documentReviewSummarySchema.safeParse({...summary, ...changed}).success, false);
  }
});

test("MCP audit, readiness, compilation and validation report the collected review rather than unavailable advice", async t => {
  const f = fixture(t); f.deliver({clean: true}); f.start();
  const server = createXmiServer(f.service, {hostSpecReview: f.runner});
  const client = new Client({name: "delivery-review-fixture", version: "1"});
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
  t.after(async () => {await client.close(); await server.close();});
  const before = canonical(f.service.get(f.project.project_id));
  for (const name of ["xmi_audit_run", "xmi_readiness_evaluate", "xmi_xspec_compile", "xmi_xspec_validate"] as const) {
    const result = await client.callTool({name, arguments: {schema_version: "0.1.0", project_id: f.project.project_id,
      expected_version: f.project.model_version}});
    const envelope = JSON.parse(JSON.stringify(outputs[name].parse(result.structuredContent)));
    assert.equal(envelope.ok, true, JSON.stringify(envelope));
    assert.equal(envelope.data.delivery_workflow.document_review.state, "COMPLETED", name);
    assert.equal(envelope.data.delivery_workflow.document_review.source_verified, true);
    assert.equal(envelope.data.delivery_workflow.formal_assurance, "NOT_ESTABLISHED");
  }
  assert.equal(canonical(f.service.get(f.project.project_id)), before);
});

for (const changeDuringApproval of [false, true]) test(`export carries the actual review and binds it to exact consent (changed=${changeDuringApproval})`, async t => {
  const f = fixture(t), {host} = f.deliver(); f.start();
  const name = `document-delivery-${f.project.project_id.replace(/^XMI-/, "")}-${changeDuringApproval}`;
  const target = resolve("exports", name), root = resolve("exports"); assert.ok(target.startsWith(root + sep));
  t.after(() => rmSync(target, {recursive: true, force: true}));
  const server = createXmiServer(f.service, {hostSpecReview: f.runner});
  const client = new Client({name: "reviewed-export-fixture", version: "1"}, {capabilities: {elicitation: {form: {}}}});
  let approvals = 0;
  client.setRequestHandler(ElicitRequestSchema, async request => {
    approvals++;
    assert.match(request.params.message, /独立文档复审：已完成/);
    assert.match(request.params.message, /意见 2 项、问题 1 项/);
    assert.doesNotMatch(request.params.message, /独立审查：未执行/);
    assert.match(request.params.message, /正式权限隔离：未验证/);
    if (changeDuringApproval) appendFileSync(host.material_path, "changed after consent preview");
    return {action: "accept", content: {approve: true}};
  });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
  t.after(async () => {await client.close(); await server.close();});
  const before = canonical(f.service.get(f.project.project_id));
  const result = await client.callTool({name: "xmi_export_package", arguments: {schema_version: "0.1.0",
    project_id: f.project.project_id, expected_version: f.project.model_version, idempotency_key: name, package_name: name}});
  const envelope = JSON.parse(JSON.stringify(outputs.xmi_export_package.parse(result.structuredContent)));
  assert.equal(approvals, 1);
  if (changeDuringApproval) {
    assert.equal(envelope.ok, false); assert.equal(envelope.error.code, "DOCUMENT_REVIEW_CHANGED");
    assert.throws(() => readFileSync(join(target, "manifest.json"), "utf8"));
  } else {
    assert.equal(envelope.ok, true, JSON.stringify(envelope)); assert.equal(envelope.data.readiness_status, "NOT_READY");
    assert.equal(envelope.data.delivery_workflow.stage, "EXPORTED");
    assert.equal(envelope.data.delivery_workflow.document_review.finding_count, 2);
    const report = readFileSync(join(target, "READINESS-REPORT.md"), "utf8");
    assert.match(report, /Document review: COMPLETED/); assert.match(report, /Findings\/questions\/verification notes: 2\/1\/0/);
    assert.match(report, /Formal permission isolation: NOT VERIFIED/);
  }
  assert.equal(canonical(f.service.get(f.project.project_id)), before);
});
