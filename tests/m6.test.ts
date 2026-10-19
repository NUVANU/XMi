import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CompletenessService } from "../packages/core/completeness-service.ts";
import { ProjectService } from "../packages/core/project-service.ts";
import { SolutionService } from "../packages/core/solution-service.ts";
import { assessFeasibility } from "../packages/core/solution-feasibility.ts";
import { MemoryProjectStore } from "../packages/storage/memory.ts";
import { candidateSchema } from "../packages/shared-types/domain.ts";
import type { Candidate, DeliveryMode, Item, Project } from "../packages/shared-types/domain.ts";
import { itemFingerprint, modeFingerprint, validateProject } from "../packages/core/validation.ts";
import { createXmiServer } from "../apps/mcp-server/server.ts";
import { inputs } from "../apps/mcp-server/contracts.ts";

const now = "2026-09-17T06:00:00.000Z";
const source = {type: "conversation_turn" as const, ref: "fixture:m6"};
const owner = {type: "owner_action" as const, ref: "fixture:m6-owner"};

function confirmed(id: string, type: Item["type"], statement: string, tags: string[] = []): Item {
  return {id, type, statement, status: "CONFIRMED", source_refs: [source], priority: "P1", tags,
    version: 1, created_at: now, updated_at: now, confirmed_by: "owner", confirmed_at: now};
}

function completeItems(ai = false): Item[] {
  return [
    confirmed("ACTOR-M6", "actor", "Independent shop owners are the primary users.", ["primary-user"]),
    confirmed("FLOW-M6", "flow", "A shop owner opens the web app, records an order and sees the saved result.", ["core"]),
    confirmed("DATA-M6", "data_entity", "Catalog records are public and contain no restricted records.", ["data-sensitivity"]),
    confirmed("SOLCON-DEPLOY-M6", "solution_constraint", "Use a cloud-hosted web application boundary.", ["deployment", "local-cloud"]),
    confirmed("NFR-SCALE-M6", "non_functional_requirement", "Pilot scale is about 100 active users with sub-second interaction targets.", ["scale", "latency"]),
    ai
      ? confirmed("INT-AI-M6", "integration", "An AI service summarizes confirmed user notes; provider choice is not yet approved.", ["integration"])
      : confirmed("EXC-INT-M6", "exclusion", "No external integrations are used in V0.", ["integrations-none"]),
    confirmed("NFR-COST-M6", "non_functional_requirement", "Prefer low operating cost and low maintenance burden for the Owner.", ["cost", "maintenance"]),
    confirmed("NFR-PLATFORM-M6", "non_functional_requirement", "Support modern desktop and mobile web browsers.", ["platform", "browser"]),
  ];
}

function project(items: Item[], mode: DeliveryMode = "FAST_DEVELOPMENT"): Project {
  return {schema_version: "0.2.0", project_id: "XMI-M6-FIXTURE", xspec_id: "XSPEC-M6-FIXTURE",
    title: "M6 fixture", profile: "web-micro-saas-v0", lifecycle_state: "CLARIFICATION", model_version: 20,
    delivery_policy: {requested_mode: mode, effective_mode: mode,
      readiness_target: mode === "FAST_VALIDATION" ? "PROTOTYPE_READY" : mode === "FAST_DEVELOPMENT" ? "BUILD_READY" : "PRODUCT_SPEC_READY",
      selection_source: "OWNER_CONFIRMED", selected_at: now,
      history: [{from_mode: null, to_mode: mode, reason: "fixture", changed_by: "owner", changed_at: now}], risk_overrides: []},
    items, open_questions: [], current_xspec_version: null, created_at: now, updated_at: now};
}

function proposalCandidate(p: Project): Candidate {
  const review = new SolutionService().review(p, {type: "system_rule", ref: "fixture:m6-solution"});
  assert.equal(review.status, "PROPOSAL_AVAILABLE");
  assert.ok(review.proposed_patch);
  return review.proposed_patch.candidate;
}

function execute(service: ProjectService, p: Project, command: unknown, actor: "owner" | "agent", key: string): Project {
  return service.execute({project_id: p.project_id, expected_version: p.model_version, idempotency_key: key, command}, actor);
}

function seedService(mode: DeliveryMode = "FAST_DEVELOPMENT", profile: Project["profile"] = "web-micro-saas-v0") {
  const store = new MemoryProjectStore();
  const service = new ProjectService(store, () => now);
  let p = service.create({idempotency_key: "create", title: "M6 service fixture", idea: "Build a small shop tool", profile, source_ref: source});
  const reason = "M6 fixture mode";
  p = execute(service, p, {kind: "DELIVERY_MODE_SELECTED", mode, reason, fingerprint: modeFingerprint(p, mode, reason),
    owner_action: {intent: "CONFIRM", source_ref: owner}}, "owner", "mode");
  for (const [index, item] of completeItems().entries()) {
    const candidate: Candidate = {id: item.id, type: item.type, statement: item.statement, status: "PROPOSED",
      source_refs: [source], priority: item.priority, tags: item.tags};
    p = execute(service, p, {kind: "CANDIDATE_EXTRACTED", candidate}, "agent", `add-${index}`);
    const current = p.items.find((entry) => entry.id === item.id)!;
    p = execute(service, p, {kind: "ITEM_CONFIRMED", item_id: current.id, fingerprint: itemFingerprint(current),
      owner_action: {intent: "CONFIRM", source_ref: owner}}, "owner", `confirm-${index}`);
  }
  return {store, service, project: p};
}

const solutions = new SolutionService();
const completeness = new CompletenessService();

test("M6 requires all eight confirmed feasibility inputs before proposing a blueprint", () => {
  // Drop the actor item rather than slicing the fixture. TARGET_USERS is the only key that matches
  // on item type alone (no keyword pattern), so removing it leaves exactly one prerequisite
  // unsatisfied. Slicing would not: SOLCON-DEPLOY-M6 states "cloud-hosted web application boundary",
  // which legitimately satisfies both LOCAL_CLOUD_REQUIREMENT and TARGET_PLATFORM, so the first seven
  // items already cover all eight keys. One statement may establish more than one prerequisite; that
  // is intended behaviour, not a gate leak.
  const p = project(completeItems().filter((item) => item.id !== "ACTOR-M6"));
  const assessment = assessFeasibility(p);
  assert.equal(assessment.total_count, 8);
  assert.equal(assessment.satisfied_count, 7);
  assert.equal(assessment.ready, false);
  const review = solutions.review(p, {type: "system_rule", ref: "fixture:m6"});
  assert.equal(review.status, "BLOCKED_PREREQUISITES");
  assert.equal(review.proposed_patch, null);
});

test("M6 proposal covers the documented blueprint structure and remains unconfirmed", () => {
  const p = project(completeItems());
  const candidate = proposalCandidate(p);
  assert.equal(candidate.type, "solution_blueprint");
  assert.equal(candidate.status, "PROPOSED");
  assert.equal(candidate.blueprint_detail?.feasibility_inputs.length, 8);
  assert.ok(candidate.blueprint_detail?.deployment_topology);
  assert.ok(candidate.blueprint_detail?.client_form_factor);
  assert.ok(candidate.blueprint_detail?.backend_need);
  assert.ok(candidate.blueprint_detail?.persistence_data_ownership);
  assert.ok(candidate.blueprint_detail?.authentication_authorization);
  assert.ok(candidate.blueprint_detail?.integration_boundaries);
  assert.ok(candidate.blueprint_detail?.ai_capability_boundary);
  assert.ok(candidate.blueprint_detail?.reliability_privacy_constraints);
  assert.ok(candidate.blueprint_detail?.recommended_stack_profile);
  assert.ok(candidate.blueprint_detail?.alternatives_tradeoffs);
  assert.ok(candidate.blueprint_detail?.xdev_must_preserve.length);
  assert.ok(candidate.blueprint_detail?.decisions_delegated_to_xdev.length);
  assert.equal(candidate.blueprint_detail?.owner_disposition, null);
  assert.equal(candidate.blueprint_detail?.recommendation.owner_decision_required, true);
  assert.equal(candidateSchema.safeParse(candidate).success, true);
});

test("M6 generated identifiers satisfy every newly declared identifier pattern", () => {
  const p = project(completeItems(true), "PRODUCT_GRADE");
  const candidate = proposalCandidate(p);
  const detail = candidate.blueprint_detail!;
  assert.match(candidate.id, /^BLUEPRINT-[A-Z0-9-]+$/);
  assert.equal(detail.blueprint_id, candidate.id);
  for (const option of detail.options) assert.match(option.id, /^SOLUTION-OPTION-[A-Z0-9-]+$/);
  assert.ok(detail.ai_capability_profile);
  assert.match(detail.ai_capability_profile!.id, /^AI-CAPABILITY-[A-Z0-9-]+$/);
  const resolution = solutions.resolveModel(detail.ai_capability_profile!, {
    provider: "Example Provider", model: "Example Model", alternatives: ["Alternative Model"],
    resolved_at: "2026-09-17T06:30:00.000Z", source_version: "catalog-snapshot-2026-09-17",
    capability_match: ["Matches the provider-neutral text capability profile."],
    pricing_privacy_assumptions: ["Pricing and residency must be rechecked against the cited snapshot."],
    revalidation_requirement: "XDev must revalidate model availability, pricing, privacy and capability fit immediately before implementation.",
  });
  assert.match(resolution.id, /^MODEL-RESOLUTION-[A-Z0-9-]+$/);
  assert.equal(resolution.capability_profile_id, detail.ai_capability_profile!.id);
  const attached = solutions.attachModelResolution(candidate, resolution);
  assert.equal(attached.blueprint_detail?.ai_capability_profile?.id, resolution.capability_profile_id);
  assert.equal(attached.blueprint_detail?.model_resolution?.resolved_at, "2026-09-17T06:30:00.000Z");
});

test("M6 keeps provider-neutral capability profile separate from dated model resolution", () => {
  const candidate = proposalCandidate(project(completeItems(true), "PRODUCT_GRADE"));
  assert.ok(candidate.blueprint_detail?.ai_capability_profile);
  assert.equal(candidate.blueprint_detail?.model_resolution, null);
  assert.throws(() => solutions.resolveModel(null as never, {
    provider: "x", model: "y", resolved_at: now, source_version: "z", capability_match: ["x"],
    pricing_privacy_assumptions: ["x"], revalidation_requirement: "recheck",
  }), /AI_CAPABILITY_PROFILE_REQUIRED/);
});

test("M6 is mode aware and never hides production gaps", () => {
  for (const mode of ["FAST_VALIDATION", "FAST_DEVELOPMENT", "PRODUCT_GRADE"] as const) {
    const candidate = proposalCandidate(project(completeItems(), mode));
    assert.equal(candidate.blueprint_detail?.mode, mode);
    assert.ok((candidate.blueprint_detail?.production_gaps.length ?? 0) > 0);
  }
  const fast = proposalCandidate(project(completeItems(), "FAST_VALIDATION"));
  assert.match(fast.blueprint_detail!.production_gaps.join(" "), /production|生产|operations|deployment/i);
});

test("M6 respects M5 risk floors before solution selection", () => {
  const items = [...completeItems(), confirmed("REQ-PAY-M6", "functional_requirement",
    "Customers pay a recurring subscription with Stripe and refunds are supported.")];
  const review = solutions.review(project(items, "FAST_VALIDATION"), {type: "system_rule", ref: "fixture:m6-risk"});
  assert.equal(review.status, "BLOCKED_RISK");
  assert.equal(review.proposed_patch, null);
  assert.ok(review.risk_blocker_ids.every((id) => /^MODE-OVERRIDE-[A-Z0-9-]+$/.test(id)));
});

test("M6 proposal cannot silently pass hard gate 11 or use generic confirmation", () => {
  const {store, service, project: seeded} = seedService();
  let p = seeded;
  const proposal = proposalCandidate(p);
  p = execute(service, p, {kind: "CANDIDATE_EXTRACTED", candidate: proposal}, "agent", "blueprint-proposal");
  const item = p.items.find((entry) => entry.id === proposal.id)!;
  assert.equal(item.status, "PROPOSED");
  assert.equal(p.lifecycle_state, "SOLUTION_REVIEW");
  assert.equal(completeness.evaluate(p).hard_gates.find((gate) => gate.gate === 11)?.status, "FAIL");
  assert.throws(() => execute(service, p, {kind: "ITEM_CONFIRMED", item_id: item.id, fingerprint: itemFingerprint(item),
    owner_action: {intent: "CONFIRM", source_ref: owner}}, "owner", "generic-confirm"), /USE_SOLUTION_BLUEPRINT_APPROVAL/);
  assert.equal(service.get(p.project_id).items.find((entry) => entry.id === proposal.id)?.status, "PROPOSED");
  store.close();
});

test("M6 dedicated Owner approval passes gate 11 and remains idempotent", () => {
  const {store, service, project: seeded} = seedService();
  let p = seeded;
  const proposal = proposalCandidate(p);
  p = execute(service, p, {kind: "CANDIDATE_EXTRACTED", candidate: proposal}, "agent", "blueprint-proposal");
  const item = p.items.find((entry) => entry.id === proposal.id)!;
  const command = {kind: "SOLUTION_BLUEPRINT_APPROVED" as const, item_id: item.id, fingerprint: itemFingerprint(item),
    owner_action: {intent: "APPROVE_BLUEPRINT" as const, source_ref: owner}};
  assert.throws(() => service.execute({project_id: p.project_id, expected_version: p.model_version,
    idempotency_key: "agent-approve", command}, "agent"), /OWNER_ACTION_REQUIRED/);
  const before = p;
  p = execute(service, p, command, "owner", "approve-blueprint");
  const retry = service.execute({project_id: before.project_id, expected_version: before.model_version,
    idempotency_key: "approve-blueprint", command}, "owner");
  assert.deepEqual(retry, p);
  assert.equal(p.items.find((entry) => entry.id === item.id)?.blueprint_detail?.owner_disposition, "APPROVED");
  assert.equal(completeness.evaluate(p).hard_gates.find((gate) => gate.gate === 11)?.status, "PASS");
  store.close();
});

test("M6 explicit delegation records the bounded XDev boundary and passes gate 11", () => {
  const {store, service, project: seeded} = seedService();
  let p = seeded;
  const proposal = proposalCandidate(p);
  p = execute(service, p, {kind: "CANDIDATE_EXTRACTED", candidate: proposal}, "agent", "blueprint-proposal");
  const item = p.items.find((entry) => entry.id === proposal.id)!;
  const boundaries = item.blueprint_detail!.decisions_delegated_to_xdev;
  p = execute(service, p, {kind: "SOLUTION_BLUEPRINT_DELEGATED", item_id: item.id, fingerprint: itemFingerprint(item),
    delegated_to: "XDEV", boundaries, owner_action: {intent: "DELEGATE_BLUEPRINT", source_ref: owner}}, "owner", "delegate-blueprint");
  const confirmedItem = p.items.find((entry) => entry.id === item.id)!;
  assert.equal(confirmedItem.blueprint_detail?.owner_disposition, "DELEGATED_TO_XDEV");
  assert.deepEqual(confirmedItem.blueprint_detail?.delegation?.boundaries, boundaries);
  assert.equal(completeness.evaluate(p).hard_gates.find((gate) => gate.gate === 11)?.status, "PASS");
  store.close();
});

test("M6 makes an approved blueprint stale when confirmed feasibility evidence changes", () => {
  const {store, service, project: seeded} = seedService();
  let p = seeded;
  const proposal = proposalCandidate(p);
  p = execute(service, p, {kind: "CANDIDATE_EXTRACTED", candidate: proposal}, "agent", "blueprint-proposal");
  let item = p.items.find((entry) => entry.id === proposal.id)!;
  p = execute(service, p, {kind: "SOLUTION_BLUEPRINT_APPROVED", item_id: item.id, fingerprint: itemFingerprint(item),
    owner_action: {intent: "APPROVE_BLUEPRINT", source_ref: owner}}, "owner", "approve-blueprint");
  assert.equal(completeness.evaluate(p).hard_gates.find((gate) => gate.gate === 11)?.status, "PASS");
  const extra: Candidate = {id: "NFR-MAINT-M6-V2", type: "non_functional_requirement",
    statement: "Owner can maintain the service only with a managed operations burden.", status: "PROPOSED",
    source_refs: [source], priority: "P1", tags: ["maintenance"]};
  p = execute(service, p, {kind: "CANDIDATE_EXTRACTED", candidate: extra}, "agent", "extra-cost");
  item = p.items.find((entry) => entry.id === extra.id)!;
  p = execute(service, p, {kind: "ITEM_CONFIRMED", item_id: item.id, fingerprint: itemFingerprint(item),
    owner_action: {intent: "CONFIRM", source_ref: owner}}, "owner", "confirm-extra-cost");
  const gate = completeness.evaluate(p).hard_gates.find((entry) => entry.gate === 11)!;
  assert.equal(gate.status, "FAIL");
  assert.match(gate.reason, /stale/i);
  store.close();
});

test("M6 solution feasibility dimension is real while consumer compatibility stays deferred at zero", () => {
  const incomplete = completeness.evaluate(project(completeItems().slice(0, 4)));
  const complete = completeness.evaluate(project(completeItems()));
  assert.ok(incomplete.dimensions.solution_feasibility < 100);
  assert.equal(complete.dimensions.solution_feasibility, 100);
  assert.equal(complete.dimensions.consumer_compatibility, 0);
});

test("M6 schema change is backward-compatible for projects without M6 fields", () => {
  const legacyM5Project = project(completeItems());
  assert.doesNotThrow(() => validateProject(legacyM5Project));
  assert.equal(legacyM5Project.items.some((item) => "blueprint_detail" in item), false);
});

test("M6 resume exposes a bounded unconfirmed solution review without requiring custom UI", async (t) => {
  const {store, service, project: seeded} = seedService();
  const server = createXmiServer(service);
  const client = new Client({name: "m6-resume", version: "1"}, {capabilities: {}});
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  t.after(async () => {await client.close(); await server.close(); store.close();});
  const r = await client.callTool({name: "xmi_project_resume", arguments: {schema_version: "0.1.0", project_id: seeded.project_id}});
  const body = JSON.parse(JSON.stringify(r.structuredContent)) as {ok: boolean; data: {solution_review: {status: string; proposed_patch: {candidate: Candidate} | null}}};
  assert.equal(body.ok, true);
  assert.equal(body.data.solution_review.status, "PROPOSAL_AVAILABLE");
  assert.equal(body.data.solution_review.proposed_patch?.candidate.status, "PROPOSED");
});

test("I-3 M6 blueprint approval fails closed without host form consent", async (t) => {
  const {store, service, project: seeded} = seedService();
  let p = seeded;
  const proposal = proposalCandidate(p);
  p = execute(service, p, {kind: "CANDIDATE_EXTRACTED", candidate: proposal}, "agent", "blueprint-proposal");
  const item = p.items.find((entry) => entry.id === proposal.id)!;
  const server = createXmiServer(service);
  const client = new Client({name: "m6-no-form", version: "1"}, {capabilities: {}});
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  t.after(async () => {await client.close(); await server.close(); store.close();});
  const r = await client.callTool({name: "xmi_item_confirm", arguments: {schema_version: "0.1.0", project_id: p.project_id,
    expected_version: p.model_version, idempotency_key: "approve", item_id: item.id, item_version: item.version,
    fingerprint: itemFingerprint(item), intent: "CONFIRM", solution_disposition: "APPROVE_BLUEPRINT"}});
  const body = JSON.parse(JSON.stringify(r.structuredContent)) as {ok: boolean; error: {code: string}};
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "CONSENT_UNAVAILABLE");
  assert.equal(service.get(p.project_id).items.find((entry) => entry.id === item.id)?.status, "PROPOSED");
});

test("M6 fixture catalog includes prerequisite, production-gap, risk and approval adversarial cases", () => {
  const fixtures = JSON.parse(readFileSync("tests/fixtures/m6-solution-fixtures.json", "utf8")) as
    {id: string; expect_status?: string; expect_proposal?: boolean; expect_gate_11?: string; expect_production_gaps?: boolean}[];
  assert.ok(fixtures.some((fixture) => fixture.id === "missing-feasibility-inputs" && fixture.expect_proposal === false));
  assert.ok(fixtures.some((fixture) => fixture.expect_status === "BLOCKED_RISK"));
  assert.ok(fixtures.some((fixture) => fixture.expect_production_gaps === true));
  assert.ok(fixtures.some((fixture) => fixture.expect_gate_11 === "FAIL"));
  assert.ok(fixtures.some((fixture) => fixture.expect_gate_11 === "PASS"));
});


test("M13 material game questions block approval, delegation and gate 11 until answered", () => {
  const {store, service, project: seeded} = seedService("FAST_DEVELOPMENT", "digital-game-v0");
  let p = seeded;
  const proposal = proposalCandidate(p);
  p = execute(service, p, {kind: "CANDIDATE_EXTRACTED", candidate: proposal}, "agent", "game-blueprint");
  const item = p.items.find((entry) => entry.id === proposal.id)!;
  const approval = {kind: "SOLUTION_BLUEPRINT_APPROVED", item_id: item.id, fingerprint: itemFingerprint(item),
    owner_action: {intent: "APPROVE_BLUEPRINT", source_ref: owner}};
  assert.throws(() => execute(service, p, approval, "owner", "game-approve"), /SOLUTION_INPUTS_UNRESOLVED/);
  assert.throws(() => execute(service, p, {kind: "SOLUTION_BLUEPRINT_DELEGATED", item_id: item.id,
    fingerprint: itemFingerprint(item), delegated_to: "XDEV", boundaries: ["Choose an engine."],
    owner_action: {intent: "DELEGATE_BLUEPRINT", source_ref: owner}}, "owner", "game-delegate"), /SOLUTION_INPUTS_UNRESOLVED/);
  // Even a historical approved item must not satisfy this gate through its own generated 2D/3D text.
  const historical = structuredClone(p);
  historical.items.find((entry) => entry.id === item.id)!.status = "CONFIRMED";
  historical.items.find((entry) => entry.id === item.id)!.blueprint_detail!.owner_disposition = "APPROVED";
  assert.equal(completeness.evaluate(historical).hard_gates.find((gate) => gate.gate === 11)?.status, "FAIL");
  const visual: Candidate = {id: "NFR-GAME-VISUAL", type: "non_functional_requirement", statement: "Use 2D visuals.",
    status: "PROPOSED", source_refs: [source], tags: ["visual-target"]};
  p = execute(service, p, {kind: "CANDIDATE_EXTRACTED", candidate: visual}, "agent", "visual-add");
  const current = p.items.find((entry) => entry.id === visual.id)!;
  p = execute(service, p, {kind: "ITEM_CONFIRMED", item_id: current.id, fingerprint: itemFingerprint(current),
    owner_action: {intent: "CONFIRM", source_ref: owner}}, "owner", "visual-confirm");
  assert.throws(() => execute(service, p, approval, "owner", "old-game-approve"), /STALE_SOLUTION_BLUEPRINT/);
  const replacement = proposalCandidate(p);
  p = execute(service, p, {kind: "CANDIDATE_EXTRACTED", candidate: replacement}, "agent", "game-replacement");
  const latest = p.items.find((entry) => entry.id === replacement.id)!;
  p = execute(service, p, {kind: "SOLUTION_BLUEPRINT_APPROVED", item_id: latest.id, fingerprint: itemFingerprint(latest),
    owner_action: {intent: "APPROVE_BLUEPRINT", source_ref: owner}}, "owner", "new-game-approve");
  assert.equal(completeness.evaluate(p).hard_gates.find((gate) => gate.gate === 11)?.status, "PASS");
  store.close();
});

function multiInputConstraints(): Item[] {
  return Array.from({length: 3}, (_, index) => confirmed(`SOLCON-MULTI-${index}`, "solution_constraint",
    "Use React and Node.js with SQLite: local web API, public data, low latency and low maintenance."));
}

test("M6 blueprint links deduplicate shared evidence without changing feasibility inputs", () => {
  const p = project([...completeItems(), ...multiInputConstraints()]);
  const assessment = assessFeasibility(p);
  const flat = assessment.inputs.flatMap((entry) => entry.evidence_ids);
  assert.ok(flat.length > 20, "Regression fixture must exceed the MCP link cap through shared evidence");
  const candidate = proposalCandidate(p);
  assert.deepEqual(candidate.links, [...new Set(flat)]);
  assert.deepEqual(candidate.blueprint_detail!.feasibility_inputs,
    assessment.inputs.map((entry) => ({key: entry.key, evidence_ids: entry.evidence_ids})));
  for (const item of multiInputConstraints()) assert.ok(candidate.links!.includes(item.id));
  assert.equal(candidate.status, "PROPOSED");
  assert.equal(candidate.blueprint_detail!.owner_disposition, null);
});

test("M6 blueprint links keep the approved finite transport limit without truncation", () => {
  const candidate = proposalCandidate(project([...completeItems(), ...multiInputConstraints()]));
  const request = {schema_version: "0.1.0", project_id: "XMI-M6-FIXTURE", expected_version: 20,
    idempotency_key: "m6-links-fixture", patch: {kind: "ADD_CANDIDATE", candidate}};
  assert.equal(inputs.xmi_patch_apply.safeParse(request).success, true);
  for (const count of [21, 160]) {
    const expanded = {...request, patch: {...request.patch,
      candidate: {...candidate, links: Array.from({length: count}, (_, index) => `DISTINCT-LINK-${index}`)}}};
    const parsed = inputs.xmi_patch_apply.safeParse(expanded);
    assert.equal(parsed.success, true);
    if (parsed.success) assert.deepEqual(parsed.data.patch.candidate.links, expanded.patch.candidate.links);
  }
  const overLimit = {...request, patch: {...request.patch,
    candidate: {...candidate, links: Array.from({length: 161}, (_, index) => `DISTINCT-LINK-${index}`)}}};
  const result = inputs.xmi_patch_apply.safeParse(overLimit);
  assert.equal(result.success, false);
  if (!result.success) assert.ok(result.error.issues.some((issue) =>
    issue.path.join(".") === "patch.candidate.links" && issue.code === "too_big"));
});

test("M6 MCP resume preserves multi-input blueprint links within its public contract", async (t) => {
  const {store, service, project: seeded} = seedService();
  let p = seeded;
  for (const [index, extra] of multiInputConstraints().entries()) {
    const candidate: Candidate = {id: extra.id, type: extra.type, statement: extra.statement,
      status: "PROPOSED", source_refs: extra.source_refs};
    p = execute(service, p, {kind: "CANDIDATE_EXTRACTED", candidate}, "agent", `multi-add-${index}`);
    const item = p.items.find((entry) => entry.id === candidate.id)!;
    p = execute(service, p, {kind: "ITEM_CONFIRMED", item_id: item.id, fingerprint: itemFingerprint(item),
      owner_action: {intent: "CONFIRM", source_ref: owner}}, "owner", `multi-confirm-${index}`);
  }
  const flat = assessFeasibility(p).inputs.flatMap((entry) => entry.evidence_ids);
  assert.ok(flat.length > 20);
  const server = createXmiServer(service);
  const client = new Client({name: "m6-multi-input-resume", version: "1"}, {capabilities: {}});
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  t.after(async () => {await client.close(); await server.close(); store.close();});
  const response = await client.callTool({name: "xmi_project_resume",
    arguments: {schema_version: "0.1.0", project_id: p.project_id}});
  const body = JSON.parse(JSON.stringify(response.structuredContent)) as {ok: boolean; data: {
    snapshot_consistent: boolean; solution_review: {proposed_patch: {candidate: Candidate}}}};
  assert.equal(body.ok, true);
  assert.equal(body.data.snapshot_consistent, true);
  assert.deepEqual(body.data.solution_review.proposed_patch.candidate.links, [...new Set(flat)]);
  assert.equal(service.get(p.project_id).model_version, p.model_version);
});
