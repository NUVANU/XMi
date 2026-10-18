import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync, readdirSync, rmSync} from "node:fs";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import {ElicitRequestSchema} from "@modelcontextprotocol/sdk/types.js";
import {CompletenessService} from "../packages/core/completeness-service.ts";
import {SolutionService} from "../packages/core/solution-service.ts";
import {fingerprint, schemaValidators} from "../packages/core/validation.ts";
import {HANDOFF_CONTRACT_VERSION, importForConsumer, XSpecService, XSPEC_PACKAGE_FILES} from "../packages/core/xspec-service.ts";
import type {CompiledArtifact, XSpecDocument} from "../packages/core/xspec-service.ts";
import type {DeliveryMode, Item, Project} from "../packages/shared-types/domain.ts";
import {inputs, metadata} from "../apps/mcp-server/contracts.ts";
import {createXmiServer, toolDescriptors} from "../apps/mcp-server/server.ts";
import type {ProjectService} from "../packages/core/project-service.ts";

const now = "2026-09-17T09:00:00.000Z";
const source = {type: "owner_action" as const, ref: "fixture:m7-owner"};
const xspecs = new XSpecService();

function confirmed(id: string, type: Item["type"], statement: string, options: Partial<Item> = {}): Item {
  return {id, type, statement, status: "CONFIRMED", source_refs: [source], priority: "P1", version: 1,
    created_at: now, updated_at: now, confirmed_by: "owner", confirmed_at: now, ...options};
}

function baseItems(): Item[] {
  const decision = confirmed("DEC-M7", "decision", "Use explicit web account isolation for private workspaces.", {
    decision_detail: {
      question: "How should private workspace access be isolated?", why_it_matters: "It changes privacy and XDev boundaries.",
      options: [
        {id: "TENANT", label: "Tenant-isolated accounts", impact: {user_experience: "Sign in", cost: "Medium", complexity: "Medium", privacy: "Strong", xdev: "Auth/isolation"}},
        {id: "SHARED", label: "Shared workspace", impact: {user_experience: "Simple", cost: "Low", complexity: "Low", privacy: "Weak", xdev: "No isolation"}},
      ], recommendation: {option_id: "TENANT", rationale: "Matches confirmed private-data boundary.", confidence: "HIGH"},
      owner_selection: "TENANT", linked_requirements: ["REQ-M7"], linked_flows: ["FLOW-M7"], supersession_history: [],
    },
  });
  return [
    confirmed("VISION-M7", "vision", "Help independent shop owners record orders in a small web application.", {priority: "P0", tags: ["problem", "outcome"]}),
    confirmed("ACTOR-M7", "actor", "Independent shop owners are the primary users.", {priority: "P0", tags: ["primary-user"]}),
    confirmed("GOAL-M7", "goal", "Save an order and see the durable result.", {priority: "P0"}),
    // M5's lexical risk matcher flags the token "payments" even inside an explicit exclusion, which
    // would raise a BLOCKING PAYMENT_OR_FINANCIAL finding and (correctly) stop the blueprint proposal.
    // The fixture therefore states the MVP boundary without naming a live high-risk scope; the
    // underlying false positive is recorded as a design observation in M7-BASELINE.json.
    confirmed("EXC-M7", "exclusion", "V0 is limited to recording orders; unrelated back-office and money-movement modules are out of scope.", {tags: ["scope", "mvp"]}),
    confirmed("FLOW-M7", "flow", "A shop owner opens the web app, records an order and sees the saved result.", {priority: "P0", tags: ["core"], links: ["ACTOR-M7", "REQ-M7"]}),
    confirmed("REQ-M7", "functional_requirement", "An authenticated shop owner can save an order in only their own workspace.", {priority: "P0", links: ["FLOW-M7"]}),
    confirmed("AC-M7", "acceptance_criterion", "Given a valid order, saving it makes the order visible on reload; invalid input is rejected without creating a record.", {priority: "P0", links: ["REQ-M7"], tags: ["automated"]}),
    confirmed("DATA-M7", "data_entity", "Order records are private to the owning workspace and persist after the session.", {tags: ["data-sensitivity", "ownership", "persistence"]}),
    confirmed("PERM-M7", "permission_rule", "Each signed-in user can access only their own private workspace data.", {priority: "P0", tags: ["role", "permission", "isolation"]}),
    confirmed("SOLCON-DEPLOY-M7", "solution_constraint", "Use a cloud-hosted web application boundary.", {tags: ["deployment", "local-cloud"]}),
    confirmed("NFR-SCALE-M7", "non_functional_requirement", "Pilot scale is about 100 active users with sub-second interaction targets.", {tags: ["scale", "latency"]}),
    confirmed("EXC-INT-M7", "exclusion", "No external integrations are used in V0.", {tags: ["integrations-none"]}),
    confirmed("NFR-COST-M7", "non_functional_requirement", "Prefer low operating cost and low maintenance burden for the Owner.", {tags: ["cost", "maintenance"]}),
    confirmed("NFR-PLATFORM-M7", "non_functional_requirement", "Support modern desktop and mobile web browsers.", {tags: ["platform", "browser"]}),
    confirmed("NFR-SEC-M7", "non_functional_requirement", "Keep tenant data isolated and recover from ordinary service failure.", {tags: ["security", "recovery"]}),
    decision,
    confirmed("RISK-M7", "risk", "Private workspace data requires tenant isolation and careful authorization.", {priority: "P1"}),
  ];
}

function project(mode: DeliveryMode = "FAST_DEVELOPMENT"): Project {
  const p: Project = {schema_version: "0.2.0", project_id: "XMI-M7-FIXTURE", xspec_id: "XSPEC-M7-FIXTURE",
    title: "M7 fixture", profile: "web-micro-saas-v0", lifecycle_state: "SOLUTION_REVIEW", model_version: 31,
    delivery_policy: {requested_mode: mode, effective_mode: mode,
      readiness_target: mode === "FAST_VALIDATION" ? "PROTOTYPE_READY" : mode === "FAST_DEVELOPMENT" ? "BUILD_READY" : "PRODUCT_SPEC_READY",
      selection_source: "OWNER_CONFIRMED", selected_at: now,
      history: [{from_mode: null, to_mode: mode, reason: "fixture", changed_by: "owner", changed_at: now}], risk_overrides: []},
    items: baseItems(), open_questions: [], current_xspec_version: null, created_at: now, updated_at: now};
  const proposal = new SolutionService().propose(p, {type: "system_rule", ref: "fixture:m7-solution"});
  assert.ok(proposal.blueprint_detail);
  proposal.blueprint_detail.owner_disposition = "APPROVED";
  const blueprint: Item = {...proposal, status: "CONFIRMED", version: 1, created_at: now, updated_at: now,
    confirmed_by: "owner", confirmed_at: now};
  p.items.push(blueprint);
  return p;
}

function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function artifactXSpec(artifact: CompiledArtifact): XSpecDocument {
  return JSON.parse(artifact.files.find((file) => file.path === "xspec.json")!.content) as XSpecDocument;
}
function mutateArtifact(artifact: CompiledArtifact, mutate: (xspec: XSpecDocument) => void): CompiledArtifact {
  const clone = structuredClone(artifact);
  const xfile = clone.files.find((file) => file.path === "xspec.json")!;
  const xspec = JSON.parse(xfile.content) as XSpecDocument;
  mutate(xspec);
  xfile.content = JSON.stringify(xspec, null, 2) + "\n";
  xfile.sha256 = sha256(xfile.content);
  const manifestFile = clone.files.find((file) => file.path === "manifest.json")!;
  const manifest = JSON.parse(manifestFile.content) as {file_sha256: Record<string, string>; canonical_xspec_sha256: string};
  manifest.file_sha256["xspec.json"] = xfile.sha256;
  manifest.canonical_xspec_sha256 = xspec.integrity.canonical_sha256;
  manifestFile.content = JSON.stringify(manifest, null, 2) + "\n";
  manifestFile.sha256 = sha256(manifestFile.content);
  return clone;
}

function withOverride(p: Project, resolution: "UPGRADE_SCOPE" | "UPGRADE_PROJECT" | "STUB_OR_SANDBOX" | "DEFER_OR_EXCLUDE",
  minimum: DeliveryMode, mode: DeliveryMode = "FAST_DEVELOPMENT"): Project {
  const clone = structuredClone(p);
  clone.delivery_policy!.requested_mode = mode;
  clone.delivery_policy!.effective_mode = mode;
  clone.delivery_policy!.readiness_target = mode === "FAST_VALIDATION" ? "PROTOTYPE_READY" : mode === "FAST_DEVELOPMENT" ? "BUILD_READY" : "PRODUCT_SPEC_READY";
  clone.delivery_policy!.risk_overrides = [{id: `MODE-OVERRIDE-M7-${resolution}`, scope_ids: ["REQ-M7"], minimum_mode: minimum,
    reason_code: "OTHER", rationale: "fixture", status: "CONFIRMED", resolution, source_refs: [source]}];
  return clone;
}

test("M7 compiles the exact sixteen-file package deterministically without a readiness claim", () => {
  const p = project();
  const first = xspecs.compile(p);
  const second = xspecs.compile(structuredClone(p));
  assert.equal(first.files.length, XSPEC_PACKAGE_FILES.length);
  assert.deepEqual(first.files.map((file) => file.path), [...XSPEC_PACKAGE_FILES]);
  assert.deepEqual(first, second);
  assert.match(first.spec_id, /^XSPEC-[A-Z0-9-]+$/);
  const xspec = artifactXSpec(first);
  assert.equal((xspec.readiness as {status: string}).status, "NOT_READY");
  const gates = (xspec.readiness as {hard_gates: Array<{id: string; passed: boolean; details: string}>}).hard_gates;
  const audit = gates.find((gate) => gate.id === "RG-AUDIT")!;
  assert.equal(audit.passed, false);
  assert.match(audit.details, /unavailable|independent audit/i); // M8 contract progression: gate 13 is now a real PASS/FAIL gate, never DEFERRED.
  assert.equal(gates.some((gate) => /^RG-\d+$/.test(gate.id)), false, "stable XSpec gate IDs must not reuse Product Model numeric IDs directly");
});

test("M7 generated XSpec IDs satisfy the schema-declared identifier pattern", () => {
  const p = project();
  delete p.xspec_id;
  const artifact = xspecs.compile(p);
  assert.match(artifact.spec_id, /^XSPEC-[A-Z0-9-]+$/);
  const doc = artifactXSpec(artifact);
  assert.equal(doc.spec_id, artifact.spec_id);
  assert.equal(schemaValidators.xspec!(doc), true, JSON.stringify(schemaValidators.xspec!.errors));
});

test("M7 canonical self-hash excludes integrity and is reproducible; manifest carries both canonical and file hashes", () => {
  const artifact = xspecs.compile(project());
  const xspec = artifactXSpec(artifact);
  const copy: Record<string, unknown> = {...xspec};
  delete copy.integrity;
  assert.equal(xspec.integrity.canonical_sha256, fingerprint(copy));
  const manifest = JSON.parse(artifact.files.find((file) => file.path === "manifest.json")!.content) as
    {canonical_xspec_sha256: string; file_sha256: Record<string, string>; files: string[]; manifest_self_hash_policy: string};
  assert.equal(manifest.canonical_xspec_sha256, xspec.integrity.canonical_sha256);
  assert.deepEqual(manifest.files, [...XSPEC_PACKAGE_FILES]);
  for (const file of artifact.files.filter((entry) => entry.path !== "manifest.json")) assert.equal(manifest.file_sha256[file.path], sha256(file.content));
  assert.equal(manifest.manifest_self_hash_policy, "MANIFEST_NOT_SELF_HASHED_TO_AVOID_RECURSION");
});

test("M7 validates every checked-in sample against its declared canonical schema", () => {
  for (const name of readdirSync("samples").filter((entry) => entry.endsWith(".json"))) {
    const value = JSON.parse(readFileSync(`samples/${name}`, "utf8"));
    const validator = name.startsWith("sample-xspec") ? schemaValidators.xspec
      : name.startsWith("sample-xmi-project") ? schemaValidators["xmi-project"]
      : name.startsWith("sample-readiness-report") ? schemaValidators["readiness-report"] : undefined;
    if (!validator) continue;
    assert.equal(validator(value), true, `${name}: ${JSON.stringify(validator.errors)}`);
  }
});

test("M7 consumer stubs accept the same valid package but never authenticate selection provenance", () => {
  const p = project();
  const artifact = xspecs.compile(p);
  const validation = xspecs.validate(p, artifact);
  assert.equal(validation.valid, true);
  assert.equal(validation.consumers.xui.accepted, true);
  assert.equal(validation.consumers.xdev.accepted, true);
  assert.equal(validation.consumers.xdev.mapped_profile, "quick_verified");
  assert.equal(validation.consumers.xdev.owner_selected, false);
  assert.equal(validation.consumers.xdev.selection_provenance_authenticated, false);
  assert.equal(validation.readiness_evaluation.hard_gates.find((gate) => gate.gate === 14)?.status, "PASS");
  assert.equal(validation.readiness_evaluation.hard_gates.find((gate) => gate.gate === 15)?.status, "FAIL");
  assert.equal(validation.readiness_evaluation.hard_gates.find((gate) => gate.gate === 13)?.status, "FAIL"); // M8 turns the former M7 DEFERRED audit gate into a real judgement.
  assert.equal(validation.readiness_evaluation.hard_gate_ready, false);
  assert.equal(validation.readiness_evaluation.dimensions.consumer_compatibility, 100);
});


test("M7 frozen enum mapping is explicit for all three project modes", () => {
  const rows = [
    ["FAST_VALIDATION", "PROTOTYPE_READY", "BASIC_SELF_CHECK", "prototype"],
    ["FAST_DEVELOPMENT", "BUILD_READY", "INDEPENDENT_SPEC_REVIEW", "quick_verified"],
    ["PRODUCT_GRADE", "PRODUCT_SPEC_READY", "INDEPENDENT_PRODUCT_AUDIT", "full_governance"],
  ] as const;
  for (const [mode, level, assurance, profile] of rows) {
    // The FAST_VALIDATION mapping check is a consumer-contract test, not a solution-risk test.
    // Build the already-approved blueprint under the minimum reviewed mode, then project the
    // canonical delivery selection to FAST_VALIDATION so this fixture does not silently waive M5 risk policy.
    const p = project(mode === "FAST_VALIDATION" ? "FAST_DEVELOPMENT" : mode);
    if (mode === "FAST_VALIDATION") {
      p.delivery_policy!.requested_mode = mode;
      p.delivery_policy!.effective_mode = mode;
      p.delivery_policy!.readiness_target = "PROTOTYPE_READY";
      p.delivery_policy!.history.push({from_mode: "FAST_DEVELOPMENT", to_mode: mode, reason: "consumer mapping fixture",
        changed_by: "owner", changed_at: now});
    }
    const xspec = artifactXSpec(xspecs.compile(p));
    assert.equal(xspec.delivery_profile.readiness_target, level);
    assert.equal((xspec.readiness as {assurance_level: string}).assurance_level, assurance);
    const imported = importForConsumer(xspec, "XDEV");
    assert.equal(imported.accepted, true, JSON.stringify(imported.errors));
    assert.equal(imported.mapped_profile, profile);
  }
});

test("M7 R-4 rejects mode/target discrepancies instead of silently rewriting them", () => {
  const xspec = artifactXSpec(xspecs.compile(project("FAST_DEVELOPMENT")));
  xspec.delivery_profile.readiness_target = "PRODUCT_SPEC_READY";
  const imported = importForConsumer(xspec, "XDEV");
  assert.equal(imported.accepted, false);
  assert.equal(imported.project_mode, "FAST_DEVELOPMENT");
  assert.ok(imported.errors.some((error) => error.code === "DELIVERY_PROFILE_INCONSISTENT"));
});

test("M7 frozen handoff contract defaults to version 1 and rejects unsupported versions", () => {
  const xspec = artifactXSpec(xspecs.compile(project()));
  delete xspec.delivery_profile.handoff_contract_version;
  const defaulted = importForConsumer(xspec, "XDEV");
  assert.equal(defaulted.accepted, true);
  assert.equal(defaulted.handoff_contract_version, "1");
  xspec.delivery_profile.handoff_contract_version = "2";
  const rejected = importForConsumer(xspec, "XDEV");
  assert.equal(rejected.accepted, false);
  assert.ok(rejected.errors.some((error) => error.code === "HANDOFF_CONTRACT_UNSUPPORTED"));
  assert.equal(HANDOFF_CONTRACT_VERSION, "XDEV-DELIVERY-HANDOFF/1");
});

test("M7 implements every frozen scope-override resolution disposition without category-only escalation", () => {
  const cases = [
    ["UPGRADE_SCOPE", "PRODUCT_GRADE", "FAST_DEVELOPMENT", "ESCALATE_SCOPED_TASKS", true],
    ["STUB_OR_SANDBOX", "PRODUCT_GRADE", "FAST_DEVELOPMENT", "NON_LIVE_PATH", false],
    ["DEFER_OR_EXCLUDE", "PRODUCT_GRADE", "FAST_DEVELOPMENT", "EXCLUDE_SCOPE", false],
    ["UPGRADE_PROJECT", "PRODUCT_GRADE", "PRODUCT_GRADE", "ESCALATE_PROJECT", true],
  ] as const;
  for (const [resolution, minimum, mode, action, escalates] of cases) {
    const xspec = artifactXSpec(xspecs.compile(withOverride(project(mode), resolution, minimum, mode)));
    const result = importForConsumer(xspec, "XDEV");
    assert.equal(result.accepted, true, JSON.stringify(result.errors));
    assert.equal(result.scope_dispositions[0]?.action, action);
    assert.equal(result.scope_dispositions[0]?.escalates, escalates);
    assert.deepEqual(result.scope_dispositions[0]?.scope_ids, ["REQ-M7"]);
  }
});

test("M7 rejects instead of degrading scoped overrides when the XDev stub cannot preserve the triple", () => {
  const xspec = artifactXSpec(xspecs.compile(withOverride(project(), "UPGRADE_SCOPE", "PRODUCT_GRADE")));
  const result = importForConsumer(xspec, "XDEV", {preserve_scope_override_triples: false});
  assert.equal(result.accepted, false);
  assert.ok(result.errors.some((error) => error.code === "XDEV_SCOPE_OVERRIDE_PRESERVATION_REQUIRED"));
  assert.equal(result.scope_dispositions[0]?.scope_ids[0], "REQ-M7", "the triple remains structured and is never rewritten into free text");
});

test("M7 rejects an override whose minimum mode is below the selected project mode", () => {
  // F-8: the compiler now reports the floor that actually applies, so a below-floor override can no
  // longer be produced by compilation. It is built here by mutation instead; the assertions are
  // unchanged, because the subject of this test is the consumer, not the compiler.
  const artifact = mutateArtifact(xspecs.compile(withOverride(project("PRODUCT_GRADE"), "STUB_OR_SANDBOX", "PRODUCT_GRADE", "PRODUCT_GRADE")), (x) => {
    x.delivery_profile.scope_overrides[0]!.minimum_mode = "FAST_DEVELOPMENT";
    const copy: Record<string, unknown> = {...x}; delete copy.integrity; x.integrity.canonical_sha256 = fingerprint(copy);
  });
  const xspec = artifactXSpec(artifact);
  const result = importForConsumer(xspec, "XDEV");
  assert.equal(result.accepted, false);
  assert.ok(result.errors.some((error) => error.code === "SCOPE_OVERRIDE_MINIMUM_BELOW_PROJECT"));
});

test("M7 intentionally invalid fixtures fail with actionable deterministic errors", () => {
  const fixtures = JSON.parse(readFileSync("tests/fixtures/m7-invalid-xspec-fixtures.json", "utf8")) as
    {id: string; mutation: string; expected_code: string}[];
  const p = project();
  const base = xspecs.compile(p);
  for (const fixture of fixtures) {
    let artifact = structuredClone(base);
    if (fixture.mutation === "READY_STATUS") artifact = mutateArtifact(artifact, (x) => {(x.readiness as {status: string}).status = "READY_FOR_XDEV";});
    if (fixture.mutation === "BROKEN_REFERENCE") artifact = mutateArtifact(artifact, (x) => {
      ((x.requirements as Array<{links: string[]}>)[0]!).links = ["FLOW-DOES-NOT-EXIST"];
      const copy: Record<string, unknown> = {...x}; delete copy.integrity; x.integrity.canonical_sha256 = fingerprint(copy);
    });
    if (fixture.mutation === "MISSING_AC") artifact = mutateArtifact(artifact, (x) => {
      ((x.requirements as Array<{acceptance_criterion_ids: string[]}>)[0]!).acceptance_criterion_ids = [];
      const copy: Record<string, unknown> = {...x}; delete copy.integrity; x.integrity.canonical_sha256 = fingerprint(copy);
    });
    if (fixture.mutation === "INTEGRITY") artifact = mutateArtifact(artifact, (x) => {x.integrity.canonical_sha256 = "0".repeat(64);});
    if (fixture.mutation === "HANDOFF_VERSION") artifact = mutateArtifact(artifact, (x) => {
      x.delivery_profile.handoff_contract_version = "2"; const copy: Record<string, unknown> = {...x}; delete copy.integrity; x.integrity.canonical_sha256 = fingerprint(copy);
    });
    if (fixture.mutation === "MINIMUM_BELOW_PROJECT") {
      // F-8: compilation reports the applicable floor, so mutate a valid package down instead.
      artifact = mutateArtifact(xspecs.compile(withOverride(project("PRODUCT_GRADE"), "STUB_OR_SANDBOX", "PRODUCT_GRADE", "PRODUCT_GRADE")), (x) => {
        x.delivery_profile.scope_overrides[0]!.minimum_mode = "FAST_DEVELOPMENT";
        const copy: Record<string, unknown> = {...x}; delete copy.integrity; x.integrity.canonical_sha256 = fingerprint(copy);
      });
    }
    const validation = xspecs.validate(p, artifact);
    assert.equal(validation.valid, false, fixture.id);
    assert.equal(validation.consumers.xui.accepted, false, `${fixture.id}: XUi must reject invalid packages`);
    assert.equal(validation.consumers.xdev.accepted, false, `${fixture.id}: XDev must reject invalid packages`);
    assert.ok(validation.errors.some((error) => error.code.includes(fixture.expected_code)),
      `${fixture.id}: ${JSON.stringify(validation.errors)}`);
    assert.ok(validation.errors.every((error) => error.user_action.length > 0), fixture.id);
  }
});

test("M7 compilation is deterministic and a later Product Model version cannot mutate prior exported bytes", () => {
  const aProject = project();
  const a = xspecs.compile(aProject);
  const frozen = a.files.map((file) => file.content).join("\u0000");
  const bProject = structuredClone(aProject);
  bProject.model_version += 1;
  bProject.updated_at = "2026-09-17T09:30:00.000Z";
  bProject.items.push(confirmed("GOAL-M7-V2", "goal", "A later amendment adds a reporting goal."));
  const b = xspecs.compile(bProject);
  assert.equal(a.files.map((file) => file.content).join("\u0000"), frozen);
  assert.notEqual(b.spec_version, a.spec_version);
  assert.notEqual(b.canonical_sha256, a.canonical_sha256);
});

test("M7 export package contains no service-storage or event-log shadow state", () => {
  const artifact = xspecs.compile(project());
  const text = artifact.files.map((file) => file.content).join("\n");
  for (const forbidden of ["state.sqlite", '"event_id"', '"previous_hash"', '"request_hash"', '"checkpoint"']) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
});

test("M7 gate 14 and 15 are real judgements and M8 turns gate 13 into a real audit judgement", () => {
  const p = project();
  const completeness = new CompletenessService();
  const before = completeness.evaluate(p);
  assert.equal(before.hard_gates.find((gate) => gate.gate === 13)?.status, "FAIL",
    "a FAST_DEVELOPMENT project cannot pass the independent-auditor gate without audit evidence");
  assert.equal(before.hard_gates.find((gate) => gate.gate === 14)?.status, "FAIL");
  assert.equal(before.hard_gates.find((gate) => gate.gate === 15)?.status, "FAIL");
  // M8 turns gate 13 from DEFERRED into a real judgement, so the evidence object now carries the
  // audit block that gate reads. Gate 14 and 15 expectations stay exactly as M7 left them.
  const after = completeness.evaluate(p, [], {xui_compatible: true, xdev_compatible: true,
    owner_confirmed_export: true, immutable_export_exists: true,
    audit: {audit_run_id: "AUDIT-M8-M7-FIXTURE", audit_status: "PASS", isolation_status: "BOUNDED_SNAPSHOT_FALLBACK",
      assurance_level: "INDEPENDENT_SPEC_REVIEW", blocking_finding_count: 0}});
  assert.equal(after.hard_gates.find((gate) => gate.gate === 13)?.status, "PASS");
  assert.equal(after.hard_gates.find((gate) => gate.gate === 14)?.status, "PASS");
  assert.equal(after.hard_gates.find((gate) => gate.gate === 15)?.status, "PASS");
  assert.equal(after.hard_gate_ready, false,
    JSON.stringify([...after.hard_gates, ...after.mode_gates].filter((gate) => gate.status !== "PASS")));
  assert.equal(after.readiness_status, "NOT_READY_M8"); // M8 milestone marker progression; readiness semantics remain hard-gate driven.
});

test("M7 MCP surface adds the three documented tools and export is write+destructive", () => {
  for (const name of ["xmi_xspec_compile", "xmi_xspec_validate", "xmi_export_package"] as const) assert.ok(metadata[name]);
  // 17 since F-9 added the Owner withdrawal tool for a mode-risk override. The M7 assertion above
  // still checks exactly the three contracts it owns; only the surface total moved.
  assert.equal(toolDescriptors.length, 28); // Module and single-item lists plus native receipts/commit.
  assert.equal(metadata.xmi_xspec_compile.write, false);
  assert.equal(metadata.xmi_xspec_validate.write, false);
  assert.equal(metadata.xmi_export_package.write, true);
  assert.equal(metadata.xmi_export_package.destructive, true);
  assert.equal(inputs.xmi_export_package.safeParse({schema_version: "0.1.0", project_id: "XMI-M7-FIXTURE",
    expected_version: 31, idempotency_key: "export", package_name: "m7", actor: "owner"}).success, false);
});

test("M7 all four risk-policy tool schemas expose the frozen handoff contract marker", () => {
  for (const name of ["xmi_delivery_mode_recommend", "xmi_delivery_mode_get", "xmi_mode_risk_evaluate", "xmi_mode_override_resolve"]) {
    const descriptor = toolDescriptors.find((entry) => entry.name === name)!;
    const schema = JSON.stringify(descriptor.outputSchema);
    assert.ok(schema.includes("XDEV-DELIVERY-HANDOFF/1"), name);
    assert.equal(schema.includes("OPEN_PRECONDITION_M7"), false, name);
  }
});

test("I-3 M7 export fails closed without host-form consent", async (t) => {
  const p = project();
  const service = {get: () => structuredClone(p)} as unknown as ProjectService;
  const server = createXmiServer(service);
  const client = new Client({name: "m7-no-form", version: "1"}, {capabilities: {}});
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  const name = `m7-no-form-${process.pid}`;
  t.after(async () => {await client.close(); await server.close(); rmSync(`exports/${name}`, {recursive: true, force: true});});
  const response = await client.callTool({name: "xmi_export_package", arguments: {schema_version: "0.1.0",
    project_id: p.project_id, expected_version: p.model_version, idempotency_key: "export-no-form", package_name: name}});
  const body = JSON.parse(JSON.stringify(response.structuredContent)) as {ok: boolean; error: {code: string}};
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "CONSENT_UNAVAILABLE");
});

test("M7 exact export retry is idempotent and does not ask for a second host approval", async (t) => {
  const p = project();
  const service = {get: () => structuredClone(p)} as unknown as ProjectService;
  const server = createXmiServer(service);
  let approvals = 0;
  const client = new Client({name: "m7-export-retry", version: "1"}, {capabilities: {elicitation: {form: {}}}});
  client.setRequestHandler(ElicitRequestSchema, async () => {approvals++; return {action: "accept", content: {approve: true}};});
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  const name = `m7-retry-${process.pid}`;
  t.after(async () => {await client.close(); await server.close(); rmSync(`exports/${name}`, {recursive: true, force: true});});
  const args = {schema_version: "0.1.0", project_id: p.project_id, expected_version: p.model_version,
    idempotency_key: "export-retry", package_name: name};
  const first = JSON.parse(JSON.stringify((await client.callTool({name: "xmi_export_package", arguments: args})).structuredContent)) as
    {ok: boolean; data: {already_present: boolean}};
  const second = JSON.parse(JSON.stringify((await client.callTool({name: "xmi_export_package", arguments: args})).structuredContent)) as
    {ok: boolean; data: {already_present: boolean}};
  assert.equal(first.ok, true);
  assert.equal(first.data.already_present, false);
  assert.equal(second.ok, true);
  assert.equal(second.data.already_present, true);
  assert.equal(approvals, 1);
});

test("M7 controlled writer uses only the exports root and preserves an identical prior artifact", () => {
  const artifact = xspecs.finalizeForExport(project()).artifact;
  const name = `m7-test-${process.pid}`;
  const first = xspecs.writeExport(artifact, name, false);
  try {
    assert.equal(first.relative_path, `exports/${name}`);
    assert.equal(first.already_present, false);
    const retry = xspecs.writeExport(artifact, name, false);
    assert.equal(retry.already_present, true);
  } finally {
    rmSync(`exports/${name}`, {recursive: true, force: true});
  }
});


test("M13 exported JSON and Markdown preserve concrete stack and option trade-offs", () => {
  const artifact = xspecs.compile(project());
  const xspec = artifactXSpec(artifact);
  const blueprint = xspec.solution_blueprint as {recommended_option: string; alternatives: string[]; constraints: string[]};
  assert.match(blueprint.recommended_option, /React/);
  assert.match(blueprint.recommended_option, /Node.js/);
  assert.match(blueprint.recommended_option, /PostgreSQL/);
  assert.ok(blueprint.alternatives.some((entry) => /FastAPI/.test(entry)));
  assert.ok(blueprint.constraints.some((entry) => /选型待核查/.test(entry)));
  const markdown = artifact.files.find((file) => file.path === "TECHNICAL-SOLUTION-BLUEPRINT.md")!.content;
  assert.match(markdown, /Node.js/);
  assert.match(markdown, /FastAPI/);
  assert.equal(schemaValidators.xspec(xspec), true);
});


test("M13 JSON and Markdown export the exact approved delegation boundary", () => {
  const p = project(); const detail = p.items.find((entry) => entry.type === "solution_blueprint")!.blueprint_detail!;
  detail.owner_disposition = "DELEGATED_TO_XDEV";
  const boundaries = ["Only choose test libraries; do not change the backend."];
  detail.delegation = {delegated_to: "XDEV", boundaries};
  const artifact = xspecs.compile(p);
  const blueprint = artifactXSpec(artifact).solution_blueprint as {delegated_to_xdev: string[]};
  assert.deepEqual(blueprint.delegated_to_xdev, boundaries);
  const markdown = artifact.files.find((file) => file.path === "TECHNICAL-SOLUTION-BLUEPRINT.md")!.content;
  assert.ok(markdown.includes(boundaries[0]!));
  assert.equal(markdown.includes(detail.decisions_delegated_to_xdev[0]!), false);
  detail.delegation = null;
  assert.throws(() => xspecs.compile(p), /SOLUTION_DELEGATION_REQUIRED/);
});

function referenceProject(): Project {
  const p = project();
  const old = confirmed("REQ-M7-OLD", "functional_requirement", "An archived requirement remains available only as history.", {
    status: "REJECTED", version: 3,
  });
  p.items.push(old, confirmed("CONSTRAINT-M7", "constraint", "Preserve the original record versions."));
  p.items.find(item => item.id === "REQ-M7")!.links!.push(old.id, "CONSTRAINT-M7", "SOLCON-DEPLOY-M7");
  return p;
}

test("M7 reference records preserve constraints and history without canonical mutation", () => {
  const p = referenceProject();
  const before = fingerprint(p);
  const artifact = xspecs.compile(p);
  const doc = artifactXSpec(artifact);
  const records = doc.reference_records as Array<{id: string; kind: string; status: string; item_version: number; statement: string; source_refs: unknown[]}>;
  assert.equal(doc.schema_version, "0.3.0");
  assert.equal(JSON.parse(artifact.files.find(file => file.path === "manifest.json")!.content).xspec_schema_version, "0.3.0");
  assert.equal(records.find(row => row.id === "REQ-M7-OLD")?.kind, "HISTORICAL");
  assert.equal(records.find(row => row.id === "REQ-M7-OLD")?.status, "REJECTED");
  assert.equal(records.find(row => row.id === "REQ-M7-OLD")?.item_version, 3);
  assert.deepEqual(records.find(row => row.id === "REQ-M7-OLD")?.source_refs, [source]);
  assert.equal(records.find(row => row.id === "CONSTRAINT-M7")?.statement, "Preserve the original record versions.");
  assert.equal(records.find(row => row.id === "SOLCON-DEPLOY-M7")?.kind, "CONFIRMED_CONSTRAINT");
  assert.equal((doc.requirements as Array<{id: string}>).some(row => row.id === "REQ-M7-OLD"), false);
  assert.equal(xspecs.validate(p, artifact).references_valid, true);
  assert.equal(importForConsumer(doc, "XDEV").accepted, true);
  assert.equal(fingerprint(p), before);
  assert.match(artifact.files.find(file => file.path === "CHANGELOG.md")!.content, /REQ-M7-OLD.*REJECTED/);
  assert.match(artifact.files.find(file => file.path === "TECHNICAL-SOLUTION-BLUEPRINT.md")!.content, /CONSTRAINT-M7/);
});

test("M7 reference records cannot authorize archived scope or fill typed execution references", () => {
  const doc = artifactXSpec(xspecs.compile(referenceProject()));
  doc.delivery_profile.scope_overrides.push({id: "MODE-OVERRIDE-M7-HISTORY", scope_ids: ["REQ-M7-OLD"],
    minimum_mode: "PRODUCT_GRADE", resolution: "DEFER_OR_EXCLUDE", rationale: "reference boundary fixture"});
  assert.ok(importForConsumer(doc, "XDEV").errors.some(error => error.code === "XSPEC_SCOPE_REFERENCE_NOT_FOUND"));
  doc.delivery_profile.scope_overrides = [];
  (doc.requirements as Array<{acceptance_criterion_ids: string[]}>)[0]!.acceptance_criterion_ids = ["REQ-M7-OLD"];
  assert.ok(importForConsumer(doc, "XUI").errors.some(error => error.code === "XSPEC_REFERENCE_TYPE_INVALID"));
});

test("M7 reference records accept confirmed constraint scope but reject unknown and proposed targets", () => {
  const p = referenceProject();
  p.items.push({...confirmed("REQ-M7-PENDING", "functional_requirement", "Pending remains non-authoritative."), status: "PROPOSED"});
  p.items.find(item => item.id === "REQ-M7")!.links!.push("REQ-M7-MISSING", "REQ-M7-PENDING");
  const doc = artifactXSpec(xspecs.compile(p));
  const records = doc.reference_records as Array<{id: string}>;
  assert.equal(records.some(row => row.id === "REQ-M7-PENDING"), false);
  const unknown = importForConsumer(doc, "XDEV").errors.filter(error => error.code === "XSPEC_REFERENCE_NOT_FOUND");
  assert.ok(unknown.some(error => error.message.includes("REQ-M7-MISSING")));
  assert.ok(unknown.some(error => error.message.includes("REQ-M7-PENDING")));
  const clean = artifactXSpec(xspecs.compile(referenceProject()));
  clean.delivery_profile.scope_overrides.push({id: "MODE-OVERRIDE-M7-CONSTRAINT", scope_ids: ["CONSTRAINT-M7"],
    minimum_mode: "PRODUCT_GRADE", resolution: "DEFER_OR_EXCLUDE", rationale: "reference boundary fixture"});
  assert.equal(importForConsumer(clean, "XDEV").accepted, true);
});

test("M7 reference records reject forged authority and duplicate identifiers", () => {
  const doc = artifactXSpec(xspecs.compile(referenceProject()));
  const forged = structuredClone(doc);
  const history = (forged.reference_records as Array<{kind: string; status: string}>).find(row => row.kind === "HISTORICAL")!;
  history.status = "CONFIRMED";
  assert.equal(schemaValidators.xspec!(forged), false);
  assert.equal(importForConsumer(forged, "XDEV").accepted, false);
  const duplicate = structuredClone(doc);
  (duplicate.reference_records as unknown[]).push((duplicate.reference_records as unknown[])[0]);
  assert.ok(importForConsumer(duplicate, "XDEV").errors.some(error => error.code === "XSPEC_DUPLICATE_ID"));
});

test("M7 reference records retain legacy 0.2 validation and require explicit new version support", () => {
  const legacy = JSON.parse(readFileSync("samples/sample-xspec.micro-saas.json", "utf8")) as XSpecDocument;
  assert.equal(legacy.schema_version, "0.2.0");
  assert.equal(schemaValidators.xspec!(legacy), true);
  assert.equal(importForConsumer(legacy, "XDEV").accepted, true);
  const current = artifactXSpec(xspecs.compile(referenceProject()));
  const downgraded = structuredClone(current);
  downgraded.schema_version = "0.2.0";
  assert.equal(schemaValidators.xspec!(downgraded), false);
  const oldOnly = importForConsumer(current, "XDEV", {supported_xspec_versions: ["0.2.0"]});
  assert.ok(oldOnly.errors.some(error => error.code === "XSPEC_SCHEMA_VERSION_UNSUPPORTED"));
});

test("M7 reference records reject a manifest that relabels the new schema as legacy", () => {
  const p = referenceProject();
  const artifact = xspecs.compile(p);
  const manifest = artifact.files.find(file => file.path === "manifest.json")!;
  const body = JSON.parse(manifest.content) as {xspec_schema_version: string};
  body.xspec_schema_version = "0.2.0";
  manifest.content = JSON.stringify(body, null, 2) + "\n";
  manifest.sha256 = sha256(manifest.content);
  const validation = xspecs.validate(p, artifact);
  assert.equal(validation.schema_valid, true);
  assert.equal(validation.package_manifest_valid, false);
  assert.ok(validation.errors.some(error => error.code === "XSPEC_MANIFEST_SCHEMA_VERSION_MISMATCH"));
});

test("M7 reference records return schema errors for malformed external record input", () => {
  const p = referenceProject();
  const artifact = xspecs.compile(p);
  for (const value of [{bad: true}, [null]]) {
    const malformed = mutateArtifact(artifact, doc => {
      (doc as Record<string, unknown>).reference_records = value;
    });
    const validation = xspecs.validate(p, malformed);
    assert.equal(validation.schema_valid, false);
    assert.equal(validation.valid, false);
    assert.ok(validation.errors.some(error => error.code === "XSPEC_SCHEMA_INVALID"));
  }
});
