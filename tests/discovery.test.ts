import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createXmiServer } from "../apps/mcp-server/server.ts";
import { inputs, outputs } from "../apps/mcp-server/contracts.ts";
import type { ToolName } from "../apps/mcp-server/contracts.ts";
import { MemoryProjectStore } from "../packages/storage/memory.ts";
import { ProjectService } from "../packages/core/project-service.ts";
import type { Project } from "../packages/shared-types/domain.ts";

const skillDir = "plugins/xmi/skills/xmi-discovery";
const read = (path: string) => readFileSync(path, "utf8");
type Claims = {confirmed_ids: string[]; selected_mode: string | null; saved: boolean;
  readiness: string; final_spec: boolean; confirmation_mechanism_verified: boolean; implementation_tasks: string[]};
type Step = {kind: "user"; text: string} | {kind: "new_session"} |
  {kind: "assistant"; text: string; questions: string[]; claims: Claims} |
  {kind: "tool"; name: ToolName; args: Record<string, unknown>; form: "accept" | "decline" | "none";
    expect: {ok: boolean; code?: string; version?: number; first_status?: string; mode?: string}};
type Transcript = {id: string; invocation: "explicit" | "implicit"; request: string; steps: Step[]};
const fixtures = JSON.parse(read("tests/fixtures/m3-transcripts.json")) as Transcript[];
function bind(value: unknown, context: Record<string, unknown>): unknown {
  if (typeof value === "string" && value.startsWith("$")) {
    let current: unknown = context;
    for (const part of value.slice(1).split(".")) {
      assert.ok(current && typeof current === "object" && part in current, "Unresolved fixture binding: " + value);
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }
  if (Array.isArray(value)) return value.map((entry) => bind(entry, context));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, bind(v, context)]));
  return value;
}
function checkClaims(claims: Claims, p?: Project) {
  assert.equal(claims.final_spec, false, "Discovery cannot claim final spec");
  assert.equal(claims.confirmation_mechanism_verified, false, "No real host UI pass exists");
  assert.equal(claims.readiness, "NOT_EVALUATED");
  assert.deepEqual(claims.implementation_tasks, []);
  if (claims.saved) assert.ok(p, "No canonical state exists");
  for (const id of claims.confirmed_ids) assert.equal(p?.items.find((i) => i.id === id)?.status, "CONFIRMED");
  if (claims.selected_mode) assert.equal(p?.delivery_policy?.effective_mode, claims.selected_mode);
}

test("M3 Skill has valid routed resources and discoverable invocation policy without executable helpers", () => {
  const skill = read(skillDir + "/SKILL.md");
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skill);
  assert.ok(frontmatter);
  const entries = Object.fromEntries(frontmatter[1]!.split(/\r?\n/).map((line) => {
    const index = line.indexOf(":");
    return [line.slice(0,index), JSON.parse(line.slice(index + 1).trim())];
  }));
  assert.equal(entries.name, "xmi-discovery");
  assert.ok(entries.description.length > 0);
  assert.match(read(skillDir + "/agents/openai.yaml"), /allow_implicit_invocation: true/);
  const links = [...skill.matchAll(/\]\((references\/[^)]+)\)/g)].map((match) => match[1]!);
  assert.deepEqual(links.sort(), ["references/module-design-interview.md", "references/stages-and-questions.md", "references/statuses.md", "references/technical-solutions.md", "references/tool-workflow.md"]);
  for (const link of links) assert.ok(existsSync(resolve(skillDir, link)));
  assert.equal(existsSync(skillDir + "/scripts"), false);
  assert.deepEqual(readdirSync(skillDir).sort(), ["SKILL.md", "agents", "references"]);
  assert.deepEqual(JSON.parse(read("plugins/xmi/.mcp.json")), {mcpServers: {xmi: {
    command: "<abs-path-to-node>",
    args: ["<abs-path-to-xmi-repo>/apps/mcp-server/main.ts", "--db", "<abs-path-to-xmi-state.sqlite>"],
  }}});
});

for (const fixture of fixtures) {
  test("M3 transcript replay: " + fixture.id, async () => {
    const store = new MemoryProjectStore();
    const service = new ProjectService(store);
    let form: "accept" | "decline" | "none" = "none";
    let consentRequests = 0;
    let client: Client;
    let server: ReturnType<typeof createXmiServer>;
    async function connect() {
      server = createXmiServer(service);
      client = new Client({name: "m3-transcript-host", version: "1"}, {capabilities: {elicitation: {form: {}}}});
      client.setRequestHandler(ElicitRequestSchema, async () => {
        consentRequests++;
        assert.notEqual(form, "none", "Unexpected approval request");
        return form === "accept" ? {action: "accept", content: {approve: true}} : {action: "decline"};
      });
      const [a,b] = InMemoryTransport.createLinkedPair();
      await server.connect(a); await client.connect(b);
    }
    await connect();
    const context: Record<string, unknown> = {};
    const state = () => typeof context.project_id === "string" ? service.get(context.project_id) : undefined;
    try {
      for (const raw of fixture.steps) {
        if (raw.kind === "new_session") {
          await client!.close(); await server!.close(); await connect(); continue;
        }
        if (raw.kind === "user") continue;
        if (raw.kind === "assistant") {
          const step = bind(raw, context) as typeof raw;
          assert.ok(step.text.length);
          assert.ok(step.questions.length >= 1 && step.questions.length <= 3);
          checkClaims(step.claims, state());
          continue;
        }
        form = raw.form;
        const args = bind(raw.args, context) as Record<string, unknown>;
        assert.equal(inputs[raw.name].safeParse(args).success, true, raw.name);
        const before = state()?.model_version;
        const count = consentRequests;
        const output = await client!.callTool({name: raw.name, arguments: args});
        assert.equal(outputs[raw.name].safeParse(output.structuredContent).success, true);
        const result = JSON.parse(JSON.stringify(output.structuredContent));
        context.result = result;
        assert.equal(result.ok, raw.expect.ok);
        if (raw.expect.code) assert.equal(result.error.code, raw.expect.code);
        if (result.ok && result.data.project_id) context.project_id = result.data.project_id;
        const p = state();
        if (p) context.version = p.model_version;
        if (result.ok && result.data.items?.[0]) context.item = result.data.items[0];
        if (raw.expect.version !== undefined) assert.equal(p?.model_version, raw.expect.version);
        if (raw.expect.first_status) assert.equal(p?.items[0]!.status, raw.expect.first_status);
        if (raw.expect.mode) assert.equal(p?.delivery_policy?.effective_mode, raw.expect.mode);
        if (raw.form === "none") assert.equal(consentRequests, count);
        if (!result.ok) assert.equal(p?.model_version, before, "Failed tool changed canonical state");
      }
    } finally {await client!.close(); await server!.close(); store.close();}
  });
}

test("M3 transcript truth checks reject fabricated confirmation, readiness, persistence and implementation", () => {
  const good: Claims = {confirmed_ids: [], selected_mode: null, saved: false, readiness: "NOT_EVALUATED",
    final_spec: false, confirmation_mechanism_verified: false, implementation_tasks: []};
  for (const bad of [
    {...good, confirmed_ids: ["REQ-NOT-CONFIRMED"]},
    {...good, selected_mode: "FAST_VALIDATION"},
    {...good, saved: true},
    {...good, readiness: "PRODUCT_SPEC_READY"},
    {...good, final_spec: true},
    {...good, confirmation_mechanism_verified: true},
    {...good, implementation_tasks: ["Implement unapproved feature"]},
  ]) assert.throws(() => checkClaims(bad));
});

test("M3 fixtures include explicit/implicit discovery, negative routing and realistic safety continuations", () => {
  assert.deepEqual(new Set(fixtures.map((f) => f.invocation)), new Set(["explicit", "implicit"]));
  const invocation = JSON.parse(read("tests/fixtures/m3-invocation-prompts.json")) as {id: string; request: string}[];
  const behavior = JSON.parse(read("tests/fixtures/m3-behavior-prompts.json")) as {id: string}[];
  assert.equal(new Set(invocation.map((f) => f.id)).size, invocation.length);
  assert.equal(new Set(behavior.map((f) => f.id)).size, behavior.length);
  for (const id of ["explicit-intake", "implicit-intake", "negative-code", "negative-summary", "negative-design"]) {
    assert.ok(invocation.some((f) => f.id === id));
  }
  for (const id of ["casual-assent", "declined-form", "risk-fast-mode", "resume-known-users", "untrusted-document", "stale-confirmation"]) {
    assert.ok(behavior.some((f) => f.id === id));
  }
});

test("M3 recorded forward-test outcomes cover routing without promoting simulation to host proof", () => {
  // Regression check of recorded independent observations, not a fresh model invocation.
  const evidence = JSON.parse(read("docs/evidence/M3-FORWARD-TESTS.json"));
  assert.equal(evidence.source_class, "MEASURED");
  assert.equal(evidence.installed_host_discovery_pass, false);
  assert.equal(evidence.real_host_confirmation_ui_pass, false);
  assert.equal(evidence.auditor_isolation_pass, false);
  assert.equal(evidence.initial_routing.counted_as_blind_pass, false);
  const expected: Record<string, [boolean, boolean]> = {
    "explicit-intake": [true, true], "implicit-intake": [true, true], "implicit-resume": [true, true],
    "negative-code": [false, false], "negative-summary": [false, false], "negative-design": [false, false],
    "explicit-out-of-scope": [true, false], "implicit-scope": [true, true],
  };
  const routes = evidence.clean_routing.results as {id: string; invoked: boolean; scope_suitable: boolean}[];
  assert.deepEqual(routes.map((r) => r.id).sort(), Object.keys(expected).sort());
  for (const route of routes) assert.deepEqual([route.invoked, route.scope_suitable], expected[route.id]);
  const prompts = JSON.parse(read("tests/fixtures/m3-behavior-prompts.json")) as {id: string}[];
  const results = evidence.behavior.results as {id: string; next_response: string; review_result: string}[];
  assert.deepEqual(results.map((r) => r.id).sort(), prompts.map((r) => r.id).sort());
  for (const result of results) {
    assert.ok(result.next_response.length);
    assert.equal(result.review_result, "PASS");
  }
});


test("M11 activation stays short and M12 interview uses module batches with host consent", () => {
  const skill = read(skillDir + "/SKILL.md");
  const guide = read(skillDir + "/references/stages-and-questions.md");
  assert.match(skill, /启用 XMi/);
  assert.match(skill, /Every module round must present one complete review brief/);
  assert.match(guide, /Concrete modules use the complete review brief/);
  assert.match(skill, /skipping everything already answered/);
  assert.match(skill, /A conversational “好的” is not a replacement for a required review/);
  assert.match(skill, /conversation\/document-sourced non-blueprint PROPOSED drafts skip review/);
  assert.match(skill, /delivery-mode selection\/upgrade, risk resolution\/withdrawal/);
  assert.match(skill, /Never fall back to raw JSON dialogs/);
  assert.match(skill, /mode selection is a separate/);
  assert.match(skill, /Do not invent users/);
});
