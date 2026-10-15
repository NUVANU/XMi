// Export-independence and override-floor tests.
//
// Covers the 2026-09-17 Owner requirement that XMi must be able to produce its own deliverable on
// its own (XDev is a companion product, not a precondition), the producer-side invariant that closes
// F-4, and the two reachable consumer branches from F-5.
//
// Kept in a separate file on purpose: tests/m7.test.ts belongs to the closed M7 baseline and its
// recorded hashes must stay intact.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { evaluateRisk, riskResolutionRevision} from "../packages/core/completeness-service.ts";
import { SolutionService } from "../packages/core/solution-service.ts";
import { ProjectService } from "../packages/core/project-service.ts";
import { MemoryProjectStore } from "../packages/storage/memory.ts";
import { fingerprint, itemFingerprint, modeFingerprint } from "../packages/core/validation.ts";
import { XSpecService } from "../packages/core/xspec-service.ts";
import type { CompiledArtifact, XSpecDocument } from "../packages/core/xspec-service.ts";
import type { Candidate, DeliveryMode, Item, Project } from "../packages/shared-types/domain.ts";

const now = "2026-09-17T12:00:00.000Z";
const owner = {type: "owner_action" as const, ref: "fixture:export-independence"};
const source = {type: "conversation_turn" as const, ref: "fixture:export-independence"};
const xspecs = new XSpecService();
const TARGET: Record<DeliveryMode, "PROTOTYPE_READY" | "BUILD_READY" | "PRODUCT_SPEC_READY"> = {
  FAST_VALIDATION: "PROTOTYPE_READY", FAST_DEVELOPMENT: "BUILD_READY", PRODUCT_GRADE: "PRODUCT_SPEC_READY"};

function confirmed(id: string, type: Item["type"], statement: string, options: Partial<Item> = {}): Item {
  return {id, type, statement, status: "CONFIRMED", source_refs: [source], priority: "P1", version: 1,
    created_at: now, updated_at: now, confirmed_by: "owner", confirmed_at: now, ...options};
}
function candidate(id: string, type: Candidate["type"], statement: string, tags?: string[]): Candidate {
  return {id, type, statement, status: "PROPOSED", source_refs: [source], priority: "P2", tags};
}
function baseItems(): Item[] {
  return [
    confirmed("VISION-X", "vision", "Help independent shop owners record orders in a small web application.", {priority: "P0", tags: ["problem", "outcome"]}),
    confirmed("ACTOR-X", "actor", "Independent shop owners are the primary users.", {priority: "P0", tags: ["primary-user"]}),
    confirmed("GOAL-X", "goal", "Save an order and see the durable result.", {priority: "P0"}),
    confirmed("EXC-X", "exclusion", "V0 is limited to recording orders; unrelated back-office and money-movement modules are out of scope.", {tags: ["scope", "mvp"]}),
    confirmed("FLOW-X", "flow", "A shop owner opens the web app, records an order and sees the saved result.", {priority: "P0", tags: ["core"], links: ["ACTOR-X", "REQ-X"]}),
    confirmed("REQ-X", "functional_requirement", "An authenticated shop owner can save an order in only their own workspace.", {priority: "P0", links: ["FLOW-X"]}),
    confirmed("AC-X", "acceptance_criterion", "Given a valid order, saving it makes the order visible on reload; invalid input is rejected without creating a record.", {priority: "P0", links: ["REQ-X"], tags: ["automated"]}),
    confirmed("DATA-X", "data_entity", "Order records are private to the owning workspace and persist after the session.", {tags: ["data-sensitivity", "ownership", "persistence"]}),
    confirmed("PERM-X", "permission_rule", "Each signed-in user can access only their own private workspace data.", {priority: "P0", tags: ["role", "permission", "isolation"]}),
    confirmed("SOLCON-DEPLOY-X", "solution_constraint", "Use a cloud-hosted web application boundary.", {tags: ["deployment", "local-cloud"]}),
    confirmed("NFR-SCALE-X", "non_functional_requirement", "Pilot scale is about 100 active users with sub-second interaction targets.", {tags: ["scale", "latency"]}),
    confirmed("EXC-INT-X", "exclusion", "No external integrations are used in V0.", {tags: ["integrations-none"]}),
    confirmed("NFR-COST-X", "non_functional_requirement", "Prefer low operating cost and low maintenance burden for the Owner.", {tags: ["cost", "maintenance"]}),
    confirmed("NFR-PLATFORM-X", "non_functional_requirement", "Support modern desktop and mobile web browsers.", {tags: ["platform", "browser"]}),
    confirmed("NFR-SEC-X", "non_functional_requirement", "Keep tenant data isolated and recover from ordinary service failure.", {tags: ["security", "recovery"]}),
    confirmed("DEC-X", "decision", "Use explicit web account isolation for private workspaces.", {
      decision_detail: {
        question: "How should private workspace access be isolated?", why_it_matters: "It changes privacy and XDev boundaries.",
        options: [
          {id: "TENANT", label: "Tenant-isolated accounts", impact: {user_experience: "Sign in", cost: "Medium", complexity: "Medium", privacy: "Strong", xdev: "Auth/isolation"}},
          {id: "SHARED", label: "Shared workspace", impact: {user_experience: "Simple", cost: "Low", complexity: "Low", privacy: "Weak", xdev: "No isolation"}},
        ], recommendation: {option_id: "TENANT", rationale: "Matches confirmed private-data boundary.", confidence: "HIGH"},
        owner_selection: "TENANT", linked_requirements: ["REQ-X"], linked_flows: ["FLOW-X"], supersession_history: [],
      },
    }),
    confirmed("RISK-X", "risk", "Private workspace data requires tenant isolation and careful authorization.", {priority: "P1"}),
  ];
}
function projectFixture(mode: DeliveryMode = "FAST_DEVELOPMENT"): Project {
  const p: Project = {schema_version: "0.2.0", project_id: "XMI-EXPORT-INDEPENDENCE", xspec_id: "XSPEC-EXPORT-INDEPENDENCE",
    title: "export independence fixture", profile: "web-micro-saas-v0", lifecycle_state: "SOLUTION_REVIEW", model_version: 41,
    delivery_policy: {requested_mode: mode, effective_mode: mode, readiness_target: TARGET[mode],
      selection_source: "OWNER_CONFIRMED", selected_at: now,
      history: [{from_mode: null, to_mode: mode, reason: "fixture", changed_by: "owner", changed_at: now}], risk_overrides: []},
    items: baseItems(), open_questions: [], current_xspec_version: null, created_at: now, updated_at: now};
  const proposal = new SolutionService().propose(p, {type: "system_rule", ref: "fixture:export-independence"});
  assert.ok(proposal.blueprint_detail);
  proposal.blueprint_detail.owner_disposition = "APPROVED";
  p.items.push({...proposal, status: "CONFIRMED", version: 1, created_at: now, updated_at: now,
    confirmed_by: "owner", confirmed_at: now});
  return p;
}
function withOverride(p: Project, resolution: "UPGRADE_SCOPE" | "UPGRADE_PROJECT" | "STUB_OR_SANDBOX" | "DEFER_OR_EXCLUDE",
  minimum: DeliveryMode, mode: DeliveryMode = "FAST_DEVELOPMENT"): Project {
  const clone = structuredClone(p);
  clone.delivery_policy!.requested_mode = mode;
  clone.delivery_policy!.effective_mode = mode;
  clone.delivery_policy!.readiness_target = TARGET[mode];
  clone.items.find(item => item.id === "REQ-X")!.statement = "Charge customers using Stripe.";
  const finding = evaluateRisk(clone).findings.find(entry => entry.reason_code === "PAYMENT_OR_FINANCIAL")!;
  clone.delivery_policy!.risk_overrides = [{id: finding.override_id, scope_ids: ["REQ-X"], minimum_mode: minimum,
    reason_code: finding.reason_code, rationale: "fixture", status: "CONFIRMED", resolution, source_refs: [source, riskResolutionRevision]}];
  return clone;
}
function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function artifactXSpec(artifact: CompiledArtifact): XSpecDocument {
  return JSON.parse(artifact.files.find((file) => file.path === "xspec.json")!.content) as XSpecDocument;
}
function reseal(xspec: XSpecDocument): void {
  const copy: Record<string, unknown> = {...xspec};
  delete copy.integrity;
  xspec.integrity.canonical_sha256 = fingerprint(copy);
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
function service(): ProjectService { return new ProjectService(new MemoryProjectStore(), () => now); }
function exec(svc: ProjectService, p: Project, command: unknown, actor: "owner" | "agent", key: string): Project {
  return svc.execute({project_id: p.project_id, expected_version: p.model_version, idempotency_key: key, command}, actor);
}
function modeCommand(p: Project, mode: DeliveryMode) {
  const reason = "export independence fixture mode";
  return {kind: "DELIVERY_MODE_SELECTED" as const, mode, reason, fingerprint: modeFingerprint(p, mode, reason),
    owner_action: {intent: "CONFIRM" as const, source_ref: owner}};
}

// ---------------------------------------------------------------------------
// F-4 route A: the write path must not record an override the frozen contract declares invalid.
// ---------------------------------------------------------------------------
test("override resolution is refused when the project mode already satisfies that risk", () => {
  const svc = service();
  let p = svc.create({idempotency_key: "create", title: "floor", idea: "Record orders.", source_ref: owner}, "owner");
  p = exec(svc, p, modeCommand(p, "PRODUCT_GRADE"), "owner", "mode");
  p = exec(svc, p, {kind: "CANDIDATE_EXTRACTED",
    candidate: candidate("PERM-FLOOR", "permission_rule", "Tenant data requires authentication and isolation.")}, "agent", "perm");
  const finding = evaluateRisk(p).findings.find((entry) => entry.reason_code === "AUTH_OR_PRIVATE_DATA")!;
  assert.equal(finding.minimum_mode, "FAST_DEVELOPMENT");
  assert.equal(finding.status, "SATISFIED_BY_PROJECT_MODE");
  assert.throws(() => exec(svc, p, {kind: "MODE_OVERRIDE_RESOLVED", override_id: finding.override_id,
    resolution: "STUB_OR_SANDBOX", rationale: "Sandbox only", owner_action: {intent: "RESOLVE_OVERRIDE", source_ref: owner}},
    "owner", "resolve"), /MODE_OVERRIDE_RISK_ALREADY_SATISFIED/);
  assert.equal(evaluateRisk(p).findings.find((entry) => entry.override_id === finding.override_id)?.status,
    "SATISFIED_BY_PROJECT_MODE", "a refused resolution must not change canonical state");
});

test("override resolution is still allowed when minimum_mode equals the project mode", () => {
  const svc = service();
  let p = svc.create({idempotency_key: "create", title: "floor-equal", idea: "Record orders.", source_ref: owner}, "owner");
  p = exec(svc, p, modeCommand(p, "FAST_DEVELOPMENT"), "owner", "mode");
  p = exec(svc, p, {kind: "CANDIDATE_EXTRACTED",
    candidate: candidate("PERM-EQUAL", "permission_rule", "Tenant authentication.")}, "agent", "perm");
  const finding = evaluateRisk(p).findings.find((entry) => entry.reason_code === "AUTH_OR_PRIVATE_DATA")!;
  assert.equal(finding.minimum_mode, "FAST_DEVELOPMENT");
  // F-12: an override is a delivery-scope contract, so every item its scope names must already be
  // confirmed before the resolution is recorded.
  for (const scopeId of finding.scope_ids) {
    const scopeItem = p.items.find((entry) => entry.id === scopeId)!;
    p = exec(svc, p, {kind: "ITEM_CONFIRMED", item_id: scopeItem.id, fingerprint: itemFingerprint(scopeItem),
      owner_action: {intent: "CONFIRM", source_ref: owner}}, "owner", "confirm-" + scopeId);
  }
  const resolved = exec(svc, p, {kind: "MODE_OVERRIDE_RESOLVED", override_id: finding.override_id,
    resolution: "DEFER_OR_EXCLUDE", rationale: "Excluded from this prototype",
    owner_action: {intent: "RESOLVE_OVERRIDE", source_ref: owner}}, "owner", "resolve");
  const recorded = resolved.delivery_policy!.risk_overrides[0]!;
  assert.equal(recorded.minimum_mode, "FAST_DEVELOPMENT");
  assert.equal(recorded.resolution, "DEFER_OR_EXCLUDE");
  assert.equal(recorded.status, "CONFIRMED");
});

test("the upgrade-first rule is still enforced for UPGRADE_PROJECT", () => {
  const svc = service();
  let p = svc.create({idempotency_key: "create", title: "upgrade-first", idea: "Record orders.", source_ref: owner}, "owner");
  p = exec(svc, p, modeCommand(p, "FAST_VALIDATION"), "owner", "mode");
  p = exec(svc, p, {kind: "CANDIDATE_EXTRACTED",
    candidate: candidate("REQ-PAY", "functional_requirement", "Charge customers with Stripe and refund failed payments.")}, "agent", "pay");
  const finding = evaluateRisk(p).findings.find((entry) => entry.reason_code === "PAYMENT_OR_FINANCIAL")!;
  assert.equal(finding.minimum_mode, "PRODUCT_GRADE");
  assert.throws(() => exec(svc, p, {kind: "MODE_OVERRIDE_RESOLVED", override_id: finding.override_id,
    resolution: "UPGRADE_PROJECT", rationale: "Raise the project", owner_action: {intent: "RESOLVE_OVERRIDE", source_ref: owner}},
    "owner", "resolve"), /MODE_UPGRADE_REQUIRED/);
});

// ---------------------------------------------------------------------------
// Export independence: a consumer rejection is reported, never a locked door.
// ---------------------------------------------------------------------------
test("a scope-override floor below the project mode is normalised at export and reported, never silently", () => {
  // A minimum_mode below the project mode stays reachable through a later mode upgrade, so the
  // export projection reports the floor that actually applies: max(recorded, project mode).
  const below = withOverride(projectFixture("FAST_DEVELOPMENT"), "STUB_OR_SANDBOX", "FAST_VALIDATION", "FAST_DEVELOPMENT");
  assert.equal(below.delivery_policy!.risk_overrides[0]!.minimum_mode, "FAST_VALIDATION",
    "the Product Model keeps the recorded floor");
  const {artifact, validation} = xspecs.finalizeForExport(below);
  assert.equal(artifact.files.length, 16);
  const override = (artifactXSpec(artifact).delivery_profile as
    {scope_overrides: Array<{scope_ids: string[]; minimum_mode: string; resolution: string}>}).scope_overrides[0]!;
  assert.equal(override.minimum_mode, "FAST_DEVELOPMENT", "the export reports the applicable floor");
  assert.equal(override.resolution, "STUB_OR_SANDBOX", "the resolution is preserved verbatim");
  assert.deepEqual(override.scope_ids, ["REQ-X"], "the scope triple is exported intact, never dropped");
  assert.deepEqual(validation.scope_override_normalisations,
    [{override_id: below.delivery_policy!.risk_overrides[0]!.id, recorded_minimum_mode: "FAST_VALIDATION",
      exported_minimum_mode: "FAST_DEVELOPMENT"}], "the normalisation is reported, not silent");
  assert.equal(validation.package_valid, true);
  assert.equal(validation.valid, true, "after normalisation a conforming consumer accepts the package");
  assert.equal(validation.consumers.xdev.accepted, true);
  assert.equal(below.delivery_policy!.risk_overrides[0]!.minimum_mode, "FAST_VALIDATION",
    "the Product Model record is not mutated by the projection");
});

test("a consumer-only failure does not make the package invalid, and readiness stays honest", () => {
  // Feed a below-floor override through the consumer by mutation, bypassing the projection.
  const p = withOverride(projectFixture("FAST_DEVELOPMENT"), "UPGRADE_SCOPE", "PRODUCT_GRADE");
  const artifact = mutateArtifact(xspecs.compile(p), (x) => {
    (x.delivery_profile as {scope_overrides: Array<{minimum_mode: string}>}).scope_overrides[0]!.minimum_mode = "FAST_VALIDATION";
    reseal(x);
  });
  const validation = xspecs.validate(p, artifact);
  assert.equal(validation.package_valid, true, "the artifact itself is sound");
  assert.equal(validation.valid, false, "full validity still accounts for consumer disposition");
  assert.equal(validation.consumers.xdev.accepted, false);
  assert.ok(validation.consumers.xdev.errors.some((error) => error.code === "SCOPE_OVERRIDE_MINIMUM_BELOW_PROJECT"));
  assert.equal(validation.readiness_evaluation.hard_gates.find((gate) => gate.gate === 14)?.status, "FAIL");
  assert.equal(validation.readiness_evaluation.hard_gate_ready, false);
});

test("the normal fully-conformant path is unchanged by the export decoupling", () => {
  const {artifact, validation} = xspecs.finalizeForExport(projectFixture("FAST_DEVELOPMENT"));
  assert.equal(artifact.files.length, 16);
  assert.equal(validation.package_valid, true);
  assert.equal(validation.valid, true);
  assert.equal(validation.consumers.xui.accepted, true);
  assert.equal(validation.consumers.xdev.accepted, true);
  const xspec = artifactXSpec(artifact);
  const gate = (xspec.readiness as {hard_gates: Array<{id: string; passed: boolean}>}).hard_gates
    .find((entry) => entry.id === "RG-CONSUMER")!;
  assert.equal(gate.passed, true);
});

test("an intrinsically unsound package is still refused by export", () => {
  const p = projectFixture("FAST_DEVELOPMENT");
  p.open_questions = [{id: "Q-X", question: "Is the retention window acceptable?", status: "BLOCKING",
    priority: "P0", reason: "fixture"}];
  const validation = xspecs.validate(p, xspecs.compile(p));
  assert.equal(validation.package_valid, false);
  assert.ok(validation.errors.some((error) => error.code === "XSPEC_BLOCKING_QUESTION"));
  assert.throws(() => xspecs.finalizeForExport(p), /XSPEC_PACKAGE_INVALID/);
});

// ---------------------------------------------------------------------------
// F-5: the two reachable consumer branches that had no direct test.
// ---------------------------------------------------------------------------
test("F-5 scope-reference branch: an override naming a missing scope is rejected", () => {
  const p = withOverride(projectFixture("FAST_DEVELOPMENT"), "UPGRADE_SCOPE", "PRODUCT_GRADE");
  const artifact = mutateArtifact(xspecs.compile(p), (x) => {
    (x.delivery_profile as {scope_overrides: Array<{scope_ids: string[]}>}).scope_overrides[0]!.scope_ids = ["REQ-DOES-NOT-EXIST"];
    reseal(x);
  });
  const validation = xspecs.validate(p, artifact);
  assert.ok(validation.errors.some((error) => error.code === "XSPEC_SCOPE_REFERENCE_NOT_FOUND"),
    JSON.stringify(validation.errors));
  assert.equal(validation.package_valid, false);
  assert.ok(validation.errors.every((error) => error.user_action.length > 0));
});

test("F-5 blocking-question branch: a blocking open question is rejected", () => {
  const p = projectFixture("FAST_DEVELOPMENT");
  p.open_questions = [{id: "Q-BLOCK", question: "Is the retention window acceptable?", status: "BLOCKING",
    priority: "P0", reason: "fixture"}];
  const validation = xspecs.validate(p, xspecs.compile(p));
  assert.ok(validation.errors.some((error) => error.code === "XSPEC_BLOCKING_QUESTION"), JSON.stringify(validation.errors));
  assert.equal(validation.package_valid, false);
  assert.ok(validation.errors.every((error) => error.user_action.length > 0));
});
