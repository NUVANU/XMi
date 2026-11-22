import assert from "node:assert/strict";
import test from "node:test";
import type {TestContext} from "node:test";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import {createXmiServer, toolDescriptors} from "../apps/mcp-server/server.ts";
import {inputs, outputs} from "../apps/mcp-server/contracts.ts";
import {canonical, itemFingerprint} from "../packages/core/validation.ts";
import {reviewProjectService} from "./fixtures/spec-review-project.ts";

async function fixture(t: TestContext) {
  const {project, service, store} = reviewProjectService();
  const client = new Client({name: "incremental-context-test", version: "1"});
  const server = createXmiServer(service);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  t.after(async () => {await client.close(); await server.close(); store.close();});
  const args = {schema_version: "0.1.0" as const, project_id: project.project_id};
  async function call(name: keyof typeof inputs, extra: Record<string, unknown> = {}) {
    const response = await client.callTool({name, arguments: {...args, ...extra}});
    return JSON.parse(JSON.stringify(outputs[name].parse(response.structuredContent)));
  }
  return {project, service, args, call};
}

test("both readers remain advertised and exact reads require version and unique IDs", () => {
  const base = {schema_version: "0.1.0", project_id: "XMI-SAMPLE", expected_version: 20};
  const selectors = {item_ids: ["REQ-ONE"]};
  assert.equal(inputs.xmi_project_get.safeParse({...base, ...selectors}).success, true);
  assert.equal(inputs.xmi_project_get.safeParse({...base, ...selectors, expected_version: undefined}).success, false);
  assert.equal(inputs.xmi_project_get.safeParse({...base, ...selectors, limit: 2}).success, false);
  assert.equal(inputs.xmi_project_get.safeParse({...base, item_ids: ["REQ-ONE", "REQ-ONE"]}).success, false);
  assert.equal(inputs.xmi_project_resume.safeParse({...base, detail: "incremental", since_version: 19}).success, true);
  assert.equal(inputs.xmi_project_resume.safeParse({...base, detail: "incremental", interview_module: "Notes"}).success, false);
  assert.match(toolDescriptors.find(tool => tool.name === "xmi_project_resume")!.description!, /detail incremental/);
  assert.match(toolDescriptors.find(tool => tool.name === "xmi_project_get")!.description!, /item_ids.*complete/);
});

test("incremental resume is version bound, includes acceptance references and exact reads retain provenance", async t => {
  const {project, service, call} = await fixture(t);
  const statement = "Preserve the saved outcome. ".repeat(22);
  const after = service.execute({project_id: project.project_id, expected_version: project.model_version, idempotency_key: "incremental-new",
    command: {kind: "CANDIDATE_EXTRACTED", candidate: {id: "REQ-NEW", type: "functional_requirement",
      statement, status: "PROPOSED", links: ["AC-REVIEW"],
      source_refs: [{type: "conversation_turn", ref: "fixture:incremental"}]}}});
  const next = service.execute({project_id: project.project_id, expected_version: after.model_version, idempotency_key: "incremental-next",
    command: {kind: "CANDIDATE_EXTRACTED", candidate: {id: "REQ-NEXT", type: "functional_requirement",
      statement: "Second pending change.", status: "PROPOSED", source_refs: [{type: "conversation_turn", ref: "fixture:next"}]}}});
  const since_version = project.model_version, expected_version = next.model_version;
  const delta = await call("xmi_project_resume", {detail: "incremental", since_version, expected_version, limit: 1});
  assert.equal(delta.ok, true);
  assert.equal(delta.data.model_version, expected_version);
  assert.equal(delta.data.change_status, "CHANGED");
  assert.equal(delta.data.changed_items[0].id, "REQ-NEW");
  assert.equal(delta.data.changed_items[0].excerpt.length, 120);
  assert.deepEqual(delta.data.related_acceptance_ids, ["AC-REVIEW"]);
  assert.equal(delta.data.next_offset, 1);
  const page = await call("xmi_project_resume", {detail: "incremental", since_version, expected_version, offset: 1, limit: 1});
  assert.equal(page.data.changed_items[0].id, "REQ-NEXT");
  assert.equal(page.data.next_offset, null);
  const unpinnedPage = await call("xmi_project_resume", {detail: "incremental", since_version, offset: 1, limit: 1});
  assert.equal(unpinnedPage.error.code, "EXPECTED_VERSION_REQUIRED");
  assert.equal(delta.data.change_count, 2);
  assert.equal(delta.data.pending_item_count, 2);
  const exact = await call("xmi_project_get", {expected_version, item_ids: ["REQ-NEW"]});
  const item = next.items.find(entry => entry.id === "REQ-NEW")!;
  assert.deepEqual(exact.data.items[0], {...item, fingerprint: itemFingerprint(item)});
  const same = await call("xmi_project_resume", {detail: "incremental", since_version: expected_version});
  assert.equal(same.data.change_status, "UNCHANGED");
  assert.equal(same.data.change_count, 0);
  assert.equal(same.data.pending_item_count, 2);
  const overview = await call("xmi_project_resume", {detail: "incremental"});
  assert.equal(overview.data.change_status, "OVERVIEW");
  assert.equal(overview.data.change_count, null);
  const oldPage = await call("xmi_project_resume", {detail: "incremental", since_version, expected_version: after.model_version});
  assert.equal(oldPage.error.code, "PROJECT_VERSION_CONFLICT");
  const missing = await call("xmi_project_get", {expected_version, item_ids: ["MISSING"]});
  assert.equal(missing.error.code, "ITEM_NOT_FOUND");
  assert.equal(canonical(service.get(project.project_id)), canonical(next));
});

test("short validation reports the same result for every gate and keeps full evidence available", async t => {
  const {project, service, call} = await fixture(t);
  const expected_version = project.model_version;
  const full = await call("xmi_xspec_validate", {expected_version});
  const short = await call("xmi_xspec_validate", {expected_version, detail: "summary"});
  assert.equal(full.ok, true);
  assert.equal(short.ok, true);
  assert.equal(short.data.validation.package_valid, full.data.validation.package_valid);
  assert.equal(short.data.validation.consumers.xdev, full.data.validation.consumers.xdev.accepted);
  const a = full.data.validation.readiness_evaluation, b = short.data.validation.readiness_evaluation;
  assert.equal(b.readiness_status, a.readiness_status);
  assert.equal(b.hard_gate_ready, a.hard_gate_ready);
  const gate = ({gate, status}: {gate: number; status: string}) => ({gate, status});
  assert.deepEqual(b.hard_gates, a.hard_gates.map(gate));
  assert.deepEqual(b.mode_gates, a.mode_gates.map(gate));
  assert.equal(short.data.delivery_workflow.review_state, full.data.delivery_workflow.document_review.state);
  assert.equal(short.data.delivery_workflow.formal_assurance, full.data.delivery_workflow.formal_assurance);
  assert.ok(JSON.stringify(short).length < JSON.stringify(full).length);
  assert.equal(canonical(service.get(project.project_id)), canonical(project));
});
