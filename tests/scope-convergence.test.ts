import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {existsSync, readFileSync, rmSync} from "node:fs";
import {resolve, sep} from "node:path";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import {ElicitRequestSchema} from "@modelcontextprotocol/sdk/types.js";
import {createXmiServer} from "../apps/mcp-server/server.ts";
import {outputs} from "../apps/mcp-server/contracts.ts";
import type {ToolName} from "../apps/mcp-server/contracts.ts";
import {canonical} from "../packages/core/validation.ts";
import {reviewProjectService} from "./fixtures/spec-review-project.ts";

for (const approve of [false, true]) test(`default XSpec delivery needs only exact export consent (${approve}) and no reviewer setup`, async t => {
  const seeded = reviewProjectService(), server = createXmiServer(seeded.service);
  const client = new Client({name: "scope-convergence-fixture", version: "1"}, {capabilities: {elicitation: {form: {}}}});
  const packageName = `scope-convergence-test-${randomUUID()}`, root = resolve("exports"), target = resolve(root, packageName);
  assert.ok(target.startsWith(root + sep));
  assert.equal(existsSync(target), false);
  let approvals = 0;
  client.setRequestHandler(ElicitRequestSchema, async request => {
    approvals++;
    assert.match(request.params.message, /独立审查：未执行（可选，不阻止本次导出）/);
    assert.match(request.params.message, /正式就绪状态：NOT_READY/);
    assert.ok(request.params.message.includes(packageName));
    assert.equal(request.params.message.includes('"operation"'), false);
    return approve ? {action: "accept", content: {approve: true}} : {action: "cancel"};
  });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
  t.after(async () => {await client.close(); await server.close(); seeded.store.close(); rmSync(target, {recursive: true, force: true});});
  const tools = (await client.listTools()).tools;
  assert.equal(tools.length, 26);
  assert.equal(tools.some(tool => tool.name.startsWith("xmi_spec_review_")), false);
  const instructions = client.getInstructions()!;
  assert.match(instructions, /Independent document rereview is optional and deferred/);
  assert.match(instructions, /do not start product coding, playable prototype development or art asset generation/);
  assert.match(instructions, /FAST_VALIDATION\/PROTOTYPE_READY are specification readiness targets/);
  assert.match(instructions, /do not create\/message it without explicit authorization/);
  const resumed = await client.callTool({name: "xmi_project_resume", arguments: {
    schema_version: "0.1.0", project_id: seeded.project.project_id}});
  const resumedData = JSON.parse(JSON.stringify(outputs.xmi_project_resume.parse(resumed.structuredContent)));
  assert.equal(resumedData.ok, true);
  if (resumedData.ok) assert.match(resumedData.data.next_action, /Continue XSpec design, not product implementation or asset creation/);
  const before = canonical(seeded.service.get(seeded.project.project_id)), events = seeded.service.history(seeded.project.project_id);
  const route = {schema_version: "0.1.0", project_id: seeded.project.project_id, expected_version: seeded.project.model_version};
  const call = async (name: ToolName, extra: Record<string, unknown> = {}) => {
    const result = await client.callTool({name, arguments: {...route, ...extra}});
    const parsed = outputs[name].parse(result.structuredContent);
    return JSON.parse(JSON.stringify(parsed));
  };
  const compiled = await call("xmi_xspec_compile"); assert.equal(compiled.ok, true);
  assert.equal(compiled.data.artifact.files.length, 16);
  const checked = await call("xmi_xspec_validate"); assert.equal(checked.ok, true);
  assert.equal(checked.data.validation.package_valid, true);
  assert.equal(checked.data.validation.readiness_evaluation.hard_gate_ready, false);
  assert.equal(approvals, 0);
  const exported = await call("xmi_export_package", {package_name: packageName, idempotency_key: packageName});
  assert.equal(approvals, 1, JSON.stringify(exported));
  assert.equal(existsSync(target), approve);
  if (approve) {
    assert.equal(exported.ok, true); assert.equal(exported.data.readiness_status, "NOT_READY");
    assert.equal(exported.data.file_count, 16);
    const doc = JSON.parse(readFileSync(resolve(target, "xspec.json"), "utf8"));
    assert.equal(doc.readiness.status, "NOT_READY");
    assert.equal(doc.readiness.hard_gates.find((gate: {id: string}) => gate.id === "RG-SPEC-REVIEW").passed, false);
  } else {
    assert.equal(exported.error.code, "OWNER_DECLINED");
  }
  assert.equal(canonical(seeded.service.get(seeded.project.project_id)), before);
  assert.deepEqual(seeded.service.history(seeded.project.project_id), events);
});
