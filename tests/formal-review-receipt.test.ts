import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import {createXmiServer} from "../apps/mcp-server/server.ts";
import {buildReviewBundle} from "../packages/core/spec-review-service.ts";
import {AuditService} from "../packages/core/audit-service.ts";
import {formalReviewBinding, FormalReviewReceipts} from "../apps/mcp-server/formal-review-receipt.ts";
import {formalReviewAnchors} from "../apps/mcp-server/formal-review-anchors.ts";
import {compactFormalMaterial, expandFormalMaterial} from "../packages/core/formal-review-material.ts";
import {reviewProject, reviewProjectService} from "./fixtures/spec-review-project.ts";

test("formal receipt is authenticated and bound to the project, version and exact snapshot", async t => {
  const directory = mkdtempSync(join(tmpdir(), "xmi-formal-receipt-"));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  const {project: p, service: projects} = reviewProjectService();
  const bundle = buildReviewBundle(p, undefined, projects), binding = formalReviewBinding(bundle);
  const receipts = new FormalReviewReceipts(directory), hash = "a".repeat(64);
  const response = {schema_version: "XMI-REVIEW-RESPONSE/1", bundle_sha256: bundle.bundle_sha256,
    covered_ids: bundle.required_ids, covered_files: bundle.candidate.files.map(file => file.path),
    scope_requirements: bundle.scope_requirements, findings: [], unresolved_ids: []};
  const value = {schema_version: "XMI-WINDOWS-FORMAL-SPEC-REVIEW/1", binding, completed_at: new Date().toISOString(),
    executable_sha256: hash, isolation: {kind: "WINDOWS_APPCONTAINER_AND_TOOL_FREE_HOST", evidence_sha256: hash},
    native: {thread_id: "thread", turn_id: "turn", message_id: "message", model: "fixture", response_sha256: hash}, response};
  assert.throws(() => receipts.publish({...value, binding: {...binding, snapshot_sha256: hash}}, bundle, () => p, projects),
    {code: "FORMAL_REVIEW_RECEIPT_BINDING"});
  assert.throws(() => receipts.publish(value, bundle, () => ({...p, model_version: p.model_version + 1}), projects),
    {code: "SPEC_REVIEW_STALE"});
  assert.equal(receipts.read(p, projects), null);
  receipts.publish(value, bundle, () => p, projects);
  assert.deepEqual(receipts.read(p, projects), value);
  assert.equal(receipts.read({...p, project_id: "XMI-OTHER"}, projects), null);
  assert.equal(receipts.read({...p, model_version: p.model_version + 1}, projects), null);
  assert.equal(receipts.read({...p, title: p.title + " changed"}, projects), null);
  const auditor = new AuditService();
  const verified = {...binding, findings: [], unresolved_ids: []};
  assert.equal(auditor.run(p, verified).independent_review_status, "PASS");
  assert.equal(auditor.run(p, {...verified, unresolved_ids: ["REQ-REVIEW"]}).readiness_eligible, false);
  assert.equal(auditor.run(p, {...verified, snapshot_sha256: hash}).independent_review_status, "UNAVAILABLE");
  const server = createXmiServer(projects, {formalReviews: receipts});
  const client = new Client({name: "formal-readback", version: "1.0.0"});
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => {await client.close(); await server.close();});
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const readAudit = async () => {
    const result = await client.callTool({name: "xmi_readiness_evaluate", arguments: {
      schema_version: "0.1.0", project_id: p.project_id, expected_version: p.model_version,
    }});
    return result.structuredContent as {data: {audit: ReturnType<AuditService["run"]>; readiness: {
      mode_gates: {gate: number; status: string}[]; hard_gates: {gate: number; status: string}[]}}};
  };
  const accepted = await readAudit();
  assert.equal(accepted.data.audit.formal_receipt?.run_id, binding.run_id);
  assert.equal(accepted.data.readiness.mode_gates.find(g => g.gate === 103)?.status, "PASS");
  assert.equal(accepted.data.readiness.hard_gates.find(g => g.gate === 15)?.status, "FAIL");
  const snapshot = readdirSync(directory, {withFileTypes: true}).find(file => file.isDirectory())!.name;
  const path = join(directory, snapshot, `${bundle.bundle_sha256}.json`);
  const envelope = JSON.parse(readFileSync(path, "utf8"));
  envelope.receipt.native.turn_id = "altered";
  writeFileSync(path, JSON.stringify(envelope));
  assert.equal(receipts.read(p, projects), null);
  const rejected = await readAudit();
  assert.equal(rejected.data.audit.independent_review_status, "UNAVAILABLE");
  assert.equal(rejected.data.readiness.mode_gates.find(g => g.gate === 103)?.status, "FAIL");
});

test("same-version preparation recovers omitted confirmations without promoting a historical receipt", t => {
  const directory = mkdtempSync(join(tmpdir(), "xmi-formal-recovery-"));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  const {project, service} = reviewProjectService();
  const history = service.history(project.project_id), oldBundle = buildReviewBundle(project), hash = "b".repeat(64);
  const receipts = new FormalReviewReceipts(directory), binding = formalReviewBinding(oldBundle);
  const old = {schema_version: "XMI-WINDOWS-FORMAL-SPEC-REVIEW/1", binding, completed_at: new Date().toISOString(),
    executable_sha256: hash, isolation: {kind: "WINDOWS_APPCONTAINER_AND_TOOL_FREE_HOST", evidence_sha256: hash},
    native: {thread_id: "thread", turn_id: "turn", message_id: "message", model: "fixture", response_sha256: hash},
    response: {schema_version: "XMI-REVIEW-RESPONSE/1", bundle_sha256: oldBundle.bundle_sha256,
      covered_ids: oldBundle.required_ids, covered_files: oldBundle.candidate.files.map(file => file.path),
      scope_requirements: oldBundle.scope_requirements, findings: [], unresolved_ids: ["REQ-REVIEW"]}};
  receipts.publish(old, oldBundle, () => project);
  const prepared = receipts.prepare(project, service), material = JSON.parse(prepared.bundle.material);
  assert.equal(prepared.recovery.previous_run_id, binding.run_id);
  assert.equal(prepared.recovery.recovered_confirmation_count, 1);
  assert.equal(prepared.recovery.needs_formal_review, true);
  assert.equal(prepared.receipt, null);
  assert.equal(receipts.read(project, service), null);
  assert.deepEqual(receipts.read(project), old);
  assert.deepEqual(service.history(project.project_id), history);
  const proof = JSON.parse(material.candidate_files.find((file: {path: string}) => file.path === "manifest.json").content).producer_evidence;
  assert.equal(proof.source_coverage, "COMPLETE");
  assert.match(proof.item_confirmations.find((row: {item_id: string}) => row.item_id === "REQ-REVIEW").event.owner_source_ref.ref, /^SRC-/u);
  assert.equal(material.candidate_files.length, 16);
  const report = material.candidate_files.find((file: {path: string}) => file.path === "READINESS-REPORT.md").content;
  assert.doesNotMatch(report, /NOT PASS \*\*RG-(?:AUDIT|EXPORT|SPEC-REVIEW|CONSUMER)/u);
  assert.throws(() => receipts.prepare(project, {history: () => history.slice(0, -1)}), {code: "PRODUCER_HISTORY_VERSION_MISMATCH"});
});

test("formal reviewer selects exact source spans without losing any frozen material", () => {
  const bundle = buildReviewBundle(reviewProject()), original = JSON.parse(bundle.material);
  const binding = formalReviewBinding(bundle), anchored = formalReviewAnchors(bundle);
  const visible = JSON.parse(anchored.text);
  const joinSpans = (spans: [number | null, string][]) => spans.map(([, text]) => text).join("");
  const frozen = {...visible, model: {...visible.model, items: visible.model.items.map(
    ({statement_spans, ...item}: {statement_spans: [number | null, string][]}) => ({...item, statement: joinSpans(statement_spans)}))},
  candidate_files: visible.candidate_files.map(({content_spans, ...file}: {content_spans: [number | null, string][]}) =>
    ({...file, content: joinSpans(content_spans)}))};
  assert.deepEqual(frozen, original);
  const item = visible.model.items.find((row: {id: string}) => row.id === "REQ-REVIEW");
  const response = {schema_version: "XMI-REVIEW-RESPONSE/1", bundle_sha256: bundle.bundle_sha256,
    covered_ids: bundle.required_ids, covered_files: bundle.candidate.files.map(file => file.path),
    scope_requirements: bundle.scope_requirements, unresolved_ids: [],
    findings: [{id: "FORMAL-TEST", severity: "WARNING", affected_ids: ["FLOW-REVIEW"], statement: "Review the saved outcome.",
      evidence_anchors: [item.statement_spans[0][0]], suggestion: "Verify the saved outcome."}]};
  const received = anchored.collect({run_id: binding.run_id, response}, binding.run_id);
  assert.deepEqual(received.findings[0]!.evidence, [{item_id: "REQ-REVIEW", quote: "Save a note and reload it."}]);
  assert.deepEqual(received.findings[0]!.affected_ids, ["FLOW-REVIEW", "REQ-REVIEW"]);
  response.findings[0]!.evidence_anchors = [Number.MAX_SAFE_INTEGER];
  assert.throws(() => anchored.collect({run_id: binding.run_id, response}, binding.run_id), {code: "FORMAL_REVIEW_ANCHOR_INVALID"});
});

test("compact formal review reconstructs every source and rejects citations using a span from another source", () => {
  const original = buildReviewBundle(reviewProject());
  const full = JSON.parse(original.material), material = compactFormalMaterial(full);
  assert.deepEqual(expandFormalMaterial(JSON.parse(material)), full);
  const bundle = {...original, material}, binding = formalReviewBinding(original);
  const presentation = formalReviewAnchors(bundle), compact = JSON.parse(presentation.text);
  const item = compact.model.items.find((row: {id: string}) => row.id === "REQ-REVIEW");
  const evidence = {source: "item:REQ-REVIEW", span: item.statement_refs[0]};
  const response = {schema_version: "XMI-REVIEW-RESPONSE/1", bundle_sha256: bundle.bundle_sha256,
    covered_ids: bundle.required_ids, covered_files: bundle.candidate.files.map(file => file.path),
    scope_requirements: bundle.scope_requirements, unresolved_ids: [],
    findings: [{id: "COMPACT-TEST", severity: "WARNING", affected_ids: ["REQ-REVIEW"], statement: "Review the saved outcome.",
      evidence_anchors: [evidence], suggestion: "Verify the saved outcome."}]};
  const collect = () => presentation.collect({run_id: binding.run_id, response}, binding.run_id);
  assert.deepEqual(collect().findings[0]!.evidence, [{item_id: "REQ-REVIEW", quote: "Save a note and reload it."}]);
  response.covered_ids = bundle.required_ids.slice(1);
  assert.throws(collect, {code: "SPEC_REVIEW_COVERAGE_INCOMPLETE"});
  response.covered_ids = bundle.required_ids;
  evidence.source = "item:FLOW-REVIEW";
  assert.throws(collect, {code: "FORMAL_REVIEW_ANCHOR_INVALID"});
});

test("formal reviewer may invent finding labels but must select unresolved IDs from the frozen specification", () => {
  const bundle = buildReviewBundle(reviewProject()), binding = formalReviewBinding(bundle);
  for (const material of [bundle.material, compactFormalMaterial(JSON.parse(bundle.material))]) {
    const anchors = formalReviewAnchors({...bundle, material});
    const response = {schema_version: "XMI-REVIEW-RESPONSE/1", bundle_sha256: bundle.bundle_sha256,
      covered_ids: bundle.required_ids, covered_files: bundle.candidate.files.map(file => file.path),
      scope_requirements: bundle.scope_requirements, findings: [], unresolved_ids: ["XMI-Q-B-PAYMENT-COLLECTION"]};
    const collect = () => anchors.collect({run_id: binding.run_id, response}, binding.run_id);
    const schema = JSON.parse(JSON.stringify(anchors.outputSchema)) as {
      properties: {response: {properties: {unresolved_ids: {items: {enum: string[]}}}}};
    };
    assert.deepEqual(schema.properties.response.properties.unresolved_ids.items.enum, bundle.required_ids);
    assert.throws(collect, {name: "ZodError"});
    response.unresolved_ids = ["REQ-REVIEW"];
    assert.deepEqual(collect().unresolved_ids, ["REQ-REVIEW"]);
  }
});
