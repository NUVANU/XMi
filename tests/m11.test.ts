import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluateRisk, riskResolutionRevision} from "../packages/core/completeness-service.ts";
import { SolutionService } from "../packages/core/solution-service.ts";
import { XSpecService, importForConsumer } from "../packages/core/xspec-service.ts";
import type { XSpecDocument } from "../packages/core/xspec-service.ts";
import { fingerprint } from "../packages/core/validation.ts";
import type { DeliveryMode, Item, Project } from "../packages/shared-types/domain.ts";
import { inputs } from "../apps/mcp-server/contracts.ts";
import {
  assessHostFormEvidence,
  assessIndependentReviewEvidence,
  decideF3Fallback,
  hostFormEvidenceSchema,
  independentReviewEvidenceSchema,
  reviewedEscalationRecordSchema,
} from "../packages/core/m11-assurance-mechanisms.ts";

const now = "2026-09-19T08:00:00.000Z";
const source = {type: "owner_action" as const, ref: "fixture:m11-owner"};

function confirmed(id: string, type: Item["type"], statement: string, options: Partial<Item> = {}): Item {
  return {id, type, statement, status: "CONFIRMED", source_refs: [source], priority: "P1", version: 1,
    created_at: now, updated_at: now, confirmed_by: "owner", confirmed_at: now, ...options};
}

function producerProject(mode: DeliveryMode = "FAST_VALIDATION"): Project {
  const project: Project = {schema_version: "0.2.0", project_id: "XMI-M11-CONFORMANCE", xspec_id: "XSPEC-M11-CONFORMANCE",
    title: "M11 producer conformance", profile: "web-micro-saas-v0", lifecycle_state: "SOLUTION_REVIEW", model_version: 60,
    delivery_policy: {requested_mode: mode, effective_mode: mode,
      readiness_target: mode === "FAST_VALIDATION" ? "PROTOTYPE_READY" : mode === "FAST_DEVELOPMENT" ? "BUILD_READY" : "PRODUCT_SPEC_READY",
      selection_source: "OWNER_CONFIRMED", selected_at: now,
      history: [{from_mode: null, to_mode: mode, reason: "fixture", changed_by: "owner", changed_at: now}], risk_overrides: []},
    items: [
      confirmed("VISION-M11", "vision", "Help small teams record catalog entries and verify the saved result.", {priority: "P0", tags: ["problem", "outcome"]}),
      confirmed("ACTOR-M11", "actor", "A small-team operator is the primary user.", {priority: "P0", tags: ["primary-user"]}),
      confirmed("GOAL-M11", "goal", "Save a catalog entry and see it on reload.", {priority: "P0"}),
      confirmed("EXC-M11", "exclusion", "The first version is limited to the core catalog workflow.", {tags: ["scope", "mvp"]}),
      confirmed("FLOW-M11", "flow", "The operator signs in, creates a catalog entry and sees the saved result.", {priority: "P0", tags: ["core"], links: ["ACTOR-M11", "REQ-M11"]}),
      confirmed("REQ-M11", "functional_requirement", "An account user can save a catalog entry in only their own tenant workspace.", {priority: "P0", links: ["FLOW-M11"]}),
      confirmed("AC-M11", "acceptance_criterion", "Given valid input, saving persists the entry and invalid input creates no record.", {priority: "P0", links: ["REQ-M11"], tags: ["automated"]}),
      confirmed("PERM-M11", "permission_rule", "Role permissions enforce tenant isolation so each user accesses only their own tenant records.", {priority: "P0", tags: ["role", "permission", "isolation"]}),
      confirmed("DATA-M11", "data_entity", "Catalog records persist between sessions and are owned by the tenant.", {tags: ["data-sensitivity", "ownership", "persistence"]}),
      confirmed("SOLCON-M11", "solution_constraint", "Use a cloud-hosted browser web boundary for the prototype.", {tags: ["deployment", "local-cloud"]}),
      confirmed("NFR-SCALE-M11", "non_functional_requirement", "Pilot scale is about one hundred active users with sub-second interaction targets.", {tags: ["scale", "latency"]}),
      confirmed("INT-M11", "integration", "Email API integration has an explicit fallback when the provider is unavailable.", {tags: ["provider", "fallback"]}),
      confirmed("NFR-COST-M11", "non_functional_requirement", "Keep operating cost and maintenance burden low for the Owner.", {tags: ["cost", "maintenance"]}),
      confirmed("NFR-PLATFORM-M11", "non_functional_requirement", "Support modern desktop and mobile web browsers.", {tags: ["platform", "browser"]}),
      confirmed("CONSTRAINT-COMMERCIAL-M11", "constraint", "V0 has a free and paid product boundary without live charging in this fixture.", {tags: ["pricing", "commercial"]}),
      confirmed("CONSTRAINT-RISKCLASS-M11", "constraint", "The fixture is an ordinary low-consequence catalog domain.", {tags: ["high-risk"]}),
    ], open_questions: [], current_xspec_version: null, created_at: now, updated_at: now};
  const auth = evaluateRisk(project).findings.find((finding) => finding.reason_code === "AUTH_OR_PRIVATE_DATA");
  assert.ok(auth);
  project.delivery_policy!.risk_overrides.push({id: auth.override_id, scope_ids: [...auth.scope_ids], minimum_mode: auth.minimum_mode,
    reason_code: auth.reason_code, rationale: auth.rationale, status: "CONFIRMED", resolution: "STUB_OR_SANDBOX", source_refs: [source, riskResolutionRevision]});
  const proposal = new SolutionService().propose(project, {type: "system_rule", ref: "fixture:m11-solution"});
  assert.ok(proposal.blueprint_detail);
  proposal.blueprint_detail.owner_disposition = "APPROVED";
  project.items.push({...proposal, status: "CONFIRMED", version: 1, created_at: now, updated_at: now,
    confirmed_by: "owner", confirmed_at: now});
  return project;
}

function gateBulletCount(release: string): number {
  const privateGate = release.slice(release.indexOf("## 1. V0 private alpha gate"), release.indexOf("## 2. Public plugin gate - deferred"));
  const headings = ["Product fidelity", "Completeness/readiness", "XSpec", "Continuity", "Plugin", "Security/privacy", "Documentation"];
  return headings.reduce((count, heading, index) => {
    const start = privateGate.indexOf(`### ${heading}`);
    const next = index + 1 < headings.length ? privateGate.indexOf(`### ${headings[index + 1]}`, start + 1) : privateGate.length;
    assert.ok(start >= 0 && next > start, heading);
    return count + privateGate.slice(start, next).split("\n").filter((line) => line.startsWith("- ")).length;
  }, 0);
}

test("M11 ADR-010 keeps 28 private-alpha items and separates real-consumer verification", () => {
  const release = readFileSync("docs/16-RELEASE-GATE.md", "utf8");
  assert.equal(gateBulletCount(release), 28);
  assert.match(release, /Producer conformance: the XMi consumer-facing import surface reads a compiled XSpec without loss for both declared\n  consumer profiles\./);
  assert.match(release, /## 5\. Consumer verification gate - deferred \(ADR-010\)/);
  assert.match(release, /Real independent XUi consumer import verified against a compiled XSpec\./);
  assert.match(release, /Real XDev importer\/runtime import verified, with the frozen `XDEV-DELIVERY-HANDOFF\/1` mapping and all four/);
  assert.equal(release.includes("Consumer import fixture passes (XUi and XDev)."), false);
});

test("M11 producer conformance reads a compiled XSpec losslessly for both declared profiles and mutation is rejected", () => {
  const project = producerProject();
  const artifact = new XSpecService().compile(project);
  const xspec = JSON.parse(artifact.files.find((file) => file.path === "xspec.json")!.content) as XSpecDocument;
  const expected = xspec.delivery_profile.scope_overrides.map((entry) => ({id: entry.id, scope_ids: entry.scope_ids,
    minimum_mode: entry.minimum_mode, resolution: entry.resolution}));
  assert.ok(expected.length > 0, "the fixture must carry at least one typed scope override so losslessness is observable");

  for (const consumer of ["XUI", "XDEV"] as const) {
    const imported = importForConsumer(xspec, consumer);
    assert.equal(imported.accepted, true, `${consumer}: ${JSON.stringify(imported.errors)}`);
    assert.equal(imported.project_mode, xspec.delivery_profile.project_mode);
    assert.equal(imported.handoff_contract_version, xspec.delivery_profile.handoff_contract_version);
    assert.deepEqual(imported.scope_dispositions.map((entry) => ({id: entry.id, scope_ids: entry.scope_ids,
      minimum_mode: entry.minimum_mode, resolution: entry.resolution})), expected);
  }

  const corrupted = structuredClone(xspec);
  corrupted.delivery_profile.handoff_contract_version = "M11-CORRUPTED";
  for (const consumer of ["XUI", "XDEV"] as const) {
    const rejected = importForConsumer(corrupted, consumer);
    assert.equal(rejected.accepted, false);
    assert.ok(rejected.errors.some((error) => error.code === "HANDOFF_CONTRACT_UNSUPPORTED"),
      `${consumer}: mutation must make the producer-conformance assertion fail`);
  }
});

test("M11 F-3 mechanism distinguishes advisory fallback, reviewed escalation and eligible independent-review records", () => {
  const fast = producerProject("FAST_VALIDATION");
  assert.deepEqual(decideF3Fallback(fast, {effective_isolation_verified: false,
    independent_reviewer_available: false}).pathway, "BOUNDED_SNAPSHOT_ADVISORY");
  const project = producerProject("FAST_DEVELOPMENT");
  assert.deepEqual(decideF3Fallback(project, {effective_isolation_verified: false,
    independent_reviewer_available: false}).pathway, "REVIEWED_ESCALATION_REQUIRED");
  assert.deepEqual(decideF3Fallback(project, {effective_isolation_verified: true,
    independent_reviewer_available: true}).pathway, "INDEPENDENT_REVIEW_RECORD_REQUIRED");

  const review = {schema_version: "M11-INDEPENDENT-REVIEW/1", project_id: project.project_id,
    product_model_version: project.model_version, snapshot_sha256: fingerprint(project), assurance_level: "INDEPENDENT_SPEC_REVIEW",
    reviewer_boundary: "EXTERNAL_RUNTIME", isolation_verification: "VERIFIED_EFFECTIVE_ISOLATION", result: "PASS",
    blocking_finding_count: 0, finding_ids: [], evidence_ref: "fixture:m11-independent-review", reviewed_at: now,
    canonical_state_mutated: false} as const;
  assert.equal(independentReviewEvidenceSchema.safeParse(review).success, true);
  assert.deepEqual(assessIndependentReviewEvidence(project, review), {eligible: true, reason: "INDEPENDENT_REVIEW_RECORD_ELIGIBLE"});
  assert.equal(assessIndependentReviewEvidence({...project, model_version: project.model_version + 1}, review).eligible, false);

  const escalation = {schema_version: "M11-F3-ESCALATION/1", project_id: project.project_id,
    product_model_version: project.model_version, snapshot_sha256: fingerprint(project), required_assurance_level: "INDEPENDENT_SPEC_REVIEW",
    trigger: "INDEPENDENT_REVIEW_UNAVAILABLE", reviewed_by: "OWNER", disposition: "DEFER_CLOSURE",
    evidence_ref: "fixture:m11-reviewed-escalation", recorded_at: now, canonical_state_mutated: false} as const;
  assert.equal(reviewedEscalationRecordSchema.safeParse(escalation).success, true);
});

test("M11 I-3 mechanism binds host-form evidence while model-supplied authority remains invalid", () => {
  const hash = "a".repeat(64);
  const record = {schema_version: "M11-HOST-FORM-EVIDENCE/1", operation: "xmi_item_confirm",
    project_id: "XMI-M11-CONFORMANCE", product_model_version: 60, change_fingerprint: hash,
    source_ref: `mcp-elicitation:${hash}`, related_request_id: "fixture-request-m11", response_action: "accept",
    approve: true, observed_at: now, human_identity_status: "NOT_ESTABLISHED"} as const;
  assert.equal(hostFormEvidenceSchema.safeParse(record).success, true);
  assert.deepEqual(assessHostFormEvidence({operation: "xmi_item_confirm", project_id: record.project_id,
    product_model_version: record.product_model_version, change_fingerprint: hash}, record),
  {protocol_bound: true, human_identity_authenticated: false,
    reason: "HOST_FORM_PROTOCOL_EVIDENCE_ACCEPTED_IDENTITY_UNESTABLISHED"});
  assert.equal(hostFormEvidenceSchema.safeParse({...record, actor: "owner"}).success, false);

  const confirm = {schema_version: "0.1.0", project_id: "XMI-M11-CONFORMANCE", expected_version: 60,
    idempotency_key: "m11-confirm", item_id: "REQ-M11", item_version: 1, fingerprint: hash, intent: "CONFIRM"} as const;
  assert.equal(inputs.xmi_item_confirm.safeParse(confirm).success, true);
  for (const extra of [{actor: "owner"}, {approved: true}, {owner_action: {intent: "CONFIRM"}}, {consent_token: "fake"}]) {
    assert.equal(inputs.xmi_item_confirm.safeParse({...confirm, ...extra}).success, false);
  }
});

test("M11 cleanup keeps byte-framing scope aligned and removes the dangling docs/12 reference", () => {
  const ignored = readFileSync(".gitignore", "utf8").split("\n");
  assert.ok(ignored.includes("exports/"));
  assert.ok(ignored.includes("_e2e/"));
  const baseline = readFileSync("tests/baseline.test.ts", "utf8");
  for (const entry of ["exports", "_e2e", ".m0-python", ".npm-cache", ".xmem", ".xmem-codex-install"]) {
    assert.ok(baseline.includes(`\"${entry}\"`), entry);
  }
  const integration = readFileSync("docs/12-XUI-XDEV-XMEM-INTEGRATION.md", "utf8");
  assert.equal(integration.includes("docs/15-XMI-XDEV-XMEM-INTEGRATION.md"), false);
  assert.match(integration, /docs\/02-PRODUCT-ROADMAP\.md` V0\.2 owns the real XUi\/XDev adapters and contract tests/);

  const ownerProtocol = readFileSync("docs/M11-OWNER-ACCEPTANCE.md", "utf8");
  assert.match(ownerProtocol, /## Step 1 - Real-session host invocation/);
  assert.match(ownerProtocol, /## Step 2 - A real dogfood product idea/);
  assert.match(ownerProtocol, /## Step 3 - Independent consumer runtimes \(not scheduled\)/);
});

test("M11 keeps the M8 readiness suffix family unchanged because closure work does not change readiness semantics", () => {
  const files = [
    "apps/mcp-server/contracts.ts", "apps/mcp-server/server.ts", "packages/core/completeness-service.ts",
    "packages/core/xspec-service.ts", "tests/fixtures/m7-invalid-xspec-fixtures.json", "tests/m7.test.ts",
    "tests/m8.test.ts", "tests/m9.test.ts",
  ];
  const needles = ["NOT_READY_M8", "CANDIDATE_NOT_READY_M8", "FALSE_READINESS_CLAIM_M8"];
  const hits = files.flatMap((path) => readFileSync(path, "utf8").split("\n")
    .filter((line) => needles.some((needle) => line.includes(needle))).map((line) => ({path, line})));
  assert.equal(hits.length, 19);
  assert.equal(new Set(hits.map((hit) => hit.path)).size, 8);
});
