import test from "node:test";
import type {TestContext} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync, rmSync, readdirSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import {ElicitRequestSchema} from "@modelcontextprotocol/sdk/types.js";
import {Ajv2020} from "ajv/dist/2020.js";
import {createXmiServer, toolDescriptors} from "../apps/mcp-server/server.ts";
import {inputs, outputs, metadata} from "../apps/mcp-server/contracts.ts";
import type {ToolName} from "../apps/mcp-server/contracts.ts";
import {SpecReviewRunner} from "../apps/mcp-server/spec-review-runner.ts";
import {SqliteSpecReviewStore} from "../packages/storage/spec-review-store.ts";
import {buildReviewBundle} from "../packages/core/spec-review-service.ts";
import {canonical} from "../packages/core/validation.ts";
import {fitsNativeReview} from "../apps/mcp-server/item-review.ts";
import {reviewProjectService} from "./fixtures/spec-review-project.ts";

const ajv = new Ajv2020({strict: false, validateFormats: false});
const validators = Object.fromEntries(toolDescriptors.map(tool => [tool.name, ajv.compile(tool.outputSchema!)]));
async function call(client: Client, name: ToolName, args: Record<string, unknown>) {
  const result = await client.callTool({name, arguments: args}), envelope = result.structuredContent;
  assert.ok(validators[name]!(envelope), JSON.stringify(validators[name]!.errors));
  assert.equal(outputs[name].safeParse(envelope).success, true);
  return JSON.parse(JSON.stringify(envelope));
}
async function fixture(t: TestContext, configured = false, consent: "accept" | "cancel" | "unsupported" = "accept") {
  const seeded = reviewProjectService(), directory = mkdtempSync(join(tmpdir(), "xmi-spec-mcp-")), path = join(directory, "reviews.sqlite");
  const reviewStore = new SqliteSpecReviewStore(path); let executions = 0, approvals = 0;
  const runner = configured ? new SpecReviewRunner(reviewStore, {execution_kind: "TEST_ONLY", execute: async ({bundle_sha256}) => {
    executions++; const b = buildReviewBundle(seeded.service.get(seeded.project.project_id));
    return {schema_version: "XMI-REVIEW-RESPONSE/1", bundle_sha256, covered_ids: b.required_ids, covered_files: b.candidate.files.map(f => f.path), scope_requirements: b.scope_requirements,
      findings: [], unresolved_ids: []};
  }}) : new SpecReviewRunner();
  const server = createXmiServer(seeded.service, {specReview: runner});
  const client = new Client({name: "spec-review-test-host", version: "1"}, {capabilities: consent === "unsupported" ? {} : {elicitation: {form: {}}}});
  if (consent !== "unsupported") client.setRequestHandler(ElicitRequestSchema, async request => {
    approvals++; assert.ok(fitsNativeReview(request.params.message)); assert.ok(request.params.message.includes("合成"));
    assert.equal(request.params.message.includes('"operation"'), false);
    return consent === "cancel" ? {action: "cancel"} : {action: "accept", content: {approve: true}};
  });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
  t.after(async () => {await client.close(); await server.close(); reviewStore.close(); seeded.store.close(); rmSync(directory, {recursive: true, force: true});});
  const route = {schema_version: "0.1.0", project_id: seeded.project.project_id};
  const start = {...route, expected_version: seeded.project.model_version, idempotency_key: "one"};
  return {...seeded, client, route, start, reviewStore, executions: () => executions, approvals: () => approvals};
}

test("spec-review tools advertise strict finite schemas and correct phase-one read/write/closed-world hints", () => {
  assert.equal(metadata.xmi_spec_review_start.write, true); assert.equal(metadata.xmi_spec_review_start.destructive, false);
  assert.equal(metadata.xmi_spec_review_status.write, false);
  for (const name of ["xmi_spec_review_start", "xmi_spec_review_status"] as const) {
    const d = toolDescriptors.find(tool => tool.name === name)!;
    assert.equal(d.annotations!.openWorldHint, false); assert.equal(d.inputSchema.additionalProperties, false);
    for (const bad of [{approved: true}, {reviewer: "external"}, {isolation_verified: true}, {result: "PASS"}, {api_key: "fixture"}, {endpoint: "https://invalid.example"}, {model: "chosen"}, {bundle: {}}])
      assert.equal(inputs[name].safeParse({schema_version: "0.1.0", project_id: "XMI-TEST", expected_version: 1, idempotency_key: "one", ...bad}).success, false);
  }
  assert.equal(inputs.xmi_spec_review_status.safeParse({schema_version: "0.1.0", project_id: "XMI-TEST", limit: 21}).success, false);
});

test("unconfigured MCP start/status is a v2 unavailable result without consent, writes or changes to legacy readiness/audit", async t => {
  const f = await fixture(t, false, "unsupported"), before = canonical(f.service.get(f.project.project_id)), events = f.service.history(f.project.project_id);
  const result = await call(f.client, "xmi_spec_review_start", f.start);
  assert.equal(result.data.schema_version, "XMI-SPEC-REVIEW/2"); assert.equal(result.data.state, "UNAVAILABLE");
  assert.equal(result.data.gate_eligible, false); assert.equal(result.data.run_id, null);
  assert.equal(f.approvals(), 0); assert.equal(f.executions(), 0); assert.equal(f.reviewStore.find(f.project.project_id, "one"), null);
  const status = await call(f.client, "xmi_spec_review_status", f.route); assert.deepEqual(status.data, result.data);
  const ready = await call(f.client, "xmi_readiness_evaluate", {...f.route, expected_version: f.project.model_version});
  assert.equal(ready.data.audit.independent_review_status, "UNAVAILABLE"); assert.equal(ready.data.audit.readiness_eligible, false);
  assert.equal(ready.data.readiness.mode_gates.find((g: {gate: number}) => g.gate === 103).status, "FAIL");
  assert.equal(canonical(f.service.get(f.project.project_id)), before); assert.deepEqual(f.service.history(f.project.project_id), events);
  const old = await call(f.client, "xmi_spec_review_start", {...f.start, expected_version: 1}); assert.equal(old.error.code, "PROJECT_VERSION_CONFLICT");
});

test("MCP rejects author-supplied approval/source/identity/receipt and cross-project records without invoking a reviewer", async t => {
  const f = await fixture(t, true);
  for (const extra of [{approved: true}, {receipt: {result: "PASS"}}, {execution_kind: "LIVE"}, {source_ref: "trusted"}, {isolation_verification: "VERIFIED_EFFECTIVE_ISOLATION"}]) {
    const r = await call(f.client, "xmi_spec_review_start", {...f.start, ...extra}); assert.equal(r.error.code, "INVALID_ARGUMENTS");
  }
  assert.equal(f.approvals(), 0); assert.equal(f.executions(), 0);
  const absent = await call(f.client, "xmi_spec_review_status", {...f.route, run_id: "00000000-0000-4000-8000-000000000000"});
  assert.equal(absent.error.code, "SPEC_REVIEW_RUN_NOT_FOUND");
});

for (const consent of ["unsupported", "cancel"] as const) test(`MCP ${consent} consent leaves no review record, execution or canonical change`, async t => {
  const f = await fixture(t, true, consent), before = canonical(f.service.get(f.project.project_id));
  const r = await call(f.client, "xmi_spec_review_start", f.start);
  assert.equal(r.error.code, consent === "unsupported" ? "CONSENT_UNAVAILABLE" : "OWNER_DECLINED");
  assert.equal(f.reviewStore.find(f.project.project_id, "one"), null); assert.equal(f.executions(), 0);
  assert.equal(canonical(f.service.get(f.project.project_id)), before);
});

test("a complete synthetic MCP run is version-bound/idempotent and cannot open the real audit/export gates", async t => {
  const f = await fixture(t, true), before = canonical(f.service.get(f.project.project_id)), events = f.service.history(f.project.project_id);
  const result = await call(f.client, "xmi_spec_review_start", f.start);
  assert.equal(result.data.availability, "TEST_ONLY"); assert.equal(result.data.state, "COMPLETED"); assert.equal(result.data.gate_eligible, false);
  assert.equal(result.data.coverage.complete, true); assert.equal(result.data.coverage.covered_items, result.data.coverage.required_items);
  assert.equal(f.executions(), 1); assert.equal(f.approvals(), 1);
  assert.deepEqual((await call(f.client, "xmi_spec_review_start", f.start)).data, result.data); assert.equal(f.executions(), 1); assert.equal(f.approvals(), 1);
  assert.deepEqual((await call(f.client, "xmi_spec_review_status", {...f.route, run_id: result.data.run_id, offset: 20, limit: 20})).data.findings, []);
  const audit = await call(f.client, "xmi_audit_run", {...f.route, expected_version: f.project.model_version});
  assert.equal(audit.data.audit.independent_review_status, "UNAVAILABLE"); assert.equal(audit.data.audit.readiness_eligible, false);
  const ready = await call(f.client, "xmi_readiness_evaluate", {...f.route, expected_version: f.project.model_version});
  assert.equal(ready.data.readiness.hard_gate_ready, false); assert.equal(ready.data.readiness.hard_gates.find((g: {gate: number}) => g.gate === 15).status, "FAIL");
  assert.equal(canonical(f.service.get(f.project.project_id)), before); assert.deepEqual(f.service.history(f.project.project_id), events);
});

test("real generic STDIO discovers both new tools while refusing live review and creating no review sidecar", async t => {
  const directory = mkdtempSync(join(tmpdir(), "xmi-spec-stdio-")), path = join(directory, "product.sqlite");
  const client = new Client({name: "spec-review-stdio-fixture", version: "1"}, {capabilities: {elicitation: {form: {}}}});
  client.setRequestHandler(ElicitRequestSchema, async () => ({action: "accept", content: {approve: true}}));
  t.after(async () => {await client.close(); rmSync(directory, {recursive: true, force: true});});
  await client.connect(new StdioClientTransport({command: process.execPath, args: ["apps/mcp-server/generic.ts", "--db", path], stderr: "pipe"}));
  const tools = await client.listTools(); assert.equal(tools.tools.length, 26);
  assert.equal(tools.tools.some(tool => tool.name.startsWith("xmi_spec_review_")), false);
  const created = await call(client, "xmi_project_create", {schema_version: "0.1.0", project_directory: join(directory, "project"), initial_idea: "Synthetic public notes",
    source_ref: {type: "conversation_turn", ref: "fixture:stdio"}, idempotency_key: "create"});
  const route = {schema_version: "0.1.0", project_id: created.data.project_id};
  const result = await call(client, "xmi_spec_review_start", {...route, expected_version: 1, idempotency_key: "disabled"});
  assert.equal(result.data.state, "UNAVAILABLE");
  assert.equal((await call(client, "xmi_spec_review_status", route)).data.independent_review_status, "UNAVAILABLE");
  assert.deepEqual(readdirSync(directory).filter(name => /review/i.test(name)), []);
});
