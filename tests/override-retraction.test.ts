// F-9: withdrawing a mode-risk override.
//
// Registered on 2026-09-17 and closed here. `risk_overrides` was append-or-replace only, so an
// override recorded wrongly stayed in the project permanently and was exported, while rejecting the
// underlying items did not help either (the compiler projected every CONFIRMED override regardless of
// whether its finding still existed).
//
// The fix is a withdrawal command, not a deletion:
//   * the record is kept and marked RETRACTED, so the resolution that was once made stays auditable;
//   * the underlying risk becomes unresolved again, which fails the mode-risk gates;
//   * every existing reader already treats a non-CONFIRMED entry as inert, so no reader changed.
// Withdrawal is checked against the recorded override, never against a current risk finding, because
// the case that used to be unrepairable is precisely the one where the finding no longer exists.
//
// Everything here is driven through the real ProjectService and the real XSpecService: no hand-built
// canonical state, so the suite proves the command's effect rather than a reader's tolerance of it.
//
// Kept in a separate file on purpose: tests/m5.test.ts and tests/m7.test.ts belong to closed
// baselines and their recorded hashes must stay intact.
import test from "node:test";
import assert from "node:assert/strict";
import { CompletenessService, evaluateRisk } from "../packages/core/completeness-service.ts";
import { ProjectService } from "../packages/core/project-service.ts";
import { SolutionService } from "../packages/core/solution-service.ts";
import { MemoryProjectStore } from "../packages/storage/memory.ts";
import { itemFingerprint, modeFingerprint } from "../packages/core/validation.ts";
import { XSpecService } from "../packages/core/xspec-service.ts";
import type { CompiledArtifact, XSpecDocument } from "../packages/core/xspec-service.ts";
import { modeView } from "../apps/mcp-server/views.ts";
import { inputs, metadata } from "../apps/mcp-server/contracts.ts";
import type { Candidate, DeliveryMode, Project } from "../packages/shared-types/domain.ts";

const now = "2026-09-18T00:00:00.000Z";
const owner = {type: "owner_action" as const, ref: "fixture:override-retraction"};
const source = {type: "conversation_turn" as const, ref: "fixture:override-retraction"};
const xspecs = new XSpecService();

function service(): ProjectService { return new ProjectService(new MemoryProjectStore(), () => now); }
function exec(svc: ProjectService, p: Project, command: unknown, actor: "owner" | "agent", key: string): Project {
  return svc.execute({project_id: p.project_id, expected_version: p.model_version, idempotency_key: key, command}, actor);
}
function modeCommand(p: Project, mode: DeliveryMode) {
  const reason = "override retraction fixture mode";
  return {kind: "DELIVERY_MODE_SELECTED" as const, mode, reason, fingerprint: modeFingerprint(p, mode, reason),
    owner_action: {intent: "CONFIRM" as const, source_ref: owner}};
}
function addConfirmed(svc: ProjectService, p: Project, c: Candidate): Project {
  let next = exec(svc, p, {kind: "CANDIDATE_EXTRACTED", candidate: c}, "agent", "add-" + c.id);
  const stored = next.items.find((item) => item.id === c.id)!;
  next = exec(svc, next, {kind: "ITEM_CONFIRMED", item_id: stored.id, fingerprint: itemFingerprint(stored),
    owner_action: {intent: "CONFIRM", source_ref: owner}}, "owner", "confirm-" + c.id);
  return next;
}
function item(id: string, type: Candidate["type"], statement: string, tags?: string[], priority: Candidate["priority"] = "P1"): Candidate {
  return {id, type, statement, status: "PROPOSED", source_refs: [source], priority, tags};
}
// The eight confirmed feasibility inputs the solution blueprint needs, worded so that no risk rule
// fires at FAST_DEVELOPMENT. Overlap between inputs is fine; a blocking risk would not be.
function prerequisites(): Candidate[] {
  return [
    item("VISION-F9", "vision", "Help independent shop owners record their orders in a small web application.", ["problem", "outcome"], "P0"),
    item("ACTOR-F9", "actor", "Independent shop owners are the primary users.", ["primary-user"], "P0"),
    item("FLOW-F9", "flow", "A shop owner opens the web app, records an order and sees the saved result.", ["core"], "P0"),
    item("DATA-F9", "data_entity", "Order records live in the owning workspace and are kept between sessions.", ["data-sensitivity"]),
    item("SOLCON-DEPLOY-F9", "solution_constraint", "Use a cloud-hosted web application boundary.", ["deployment", "local-cloud"]),
    item("NFR-SCALE-F9", "non_functional_requirement", "Pilot scale is about 100 active users with sub-second interaction targets.", ["scale", "latency"]),
    item("EXC-INT-F9", "exclusion", "No external integrations are used in V0.", ["integrations-none"]),
    item("NFR-COST-F9", "non_functional_requirement", "Prefer low operating cost and low maintenance burden for the Owner.", ["cost", "maintenance"]),
    item("NFR-PLATFORM-F9", "non_functional_requirement", "Support modern desktop and mobile web browsers.", ["platform", "browser"]),
  ];
}
const paymentItem = (): Candidate => item("REQ-PAY-F9", "functional_requirement",
  "Charge customers with Stripe and refund failed payments.");

// A compile-able project at FAST_DEVELOPMENT holding one confirmed override: the payment risk floor is
// PRODUCT_GRADE, so the risk really is unresolved (min ranks above the mode, which is also what makes
// the resolution recordable under the F-4 guard), and a stub is recorded against it.
function resolvedProject(svc: ProjectService): {p: Project; overrideId: string; itemId: string} {
  let p = svc.create({idempotency_key: "create", title: "retraction fixture",
    idea: "Record orders for independent shop owners.", source_ref: owner}, "owner");
  for (const c of prerequisites()) p = addConfirmed(svc, p, c);
  p = exec(svc, p, modeCommand(p, "FAST_DEVELOPMENT"), "owner", "mode");
  assert.equal(evaluateRisk(p).unresolved_blocker_count, 0, "the fixture must start risk-free");

  const proposal = new SolutionService().propose(p, {type: "system_rule", ref: "fixture:override-retraction"});
  p = exec(svc, p, {kind: "CANDIDATE_EXTRACTED", candidate: proposal}, "agent", "blueprint");
  const blueprint = p.items.find((entry) => entry.id === proposal.id)!;
  p = exec(svc, p, {kind: "SOLUTION_BLUEPRINT_APPROVED", item_id: blueprint.id, fingerprint: itemFingerprint(blueprint),
    owner_action: {intent: "APPROVE_BLUEPRINT", source_ref: owner}}, "owner", "approve-blueprint");

  p = exec(svc, p, {kind: "CANDIDATE_EXTRACTED", candidate: paymentItem()}, "agent", "pay");
  // F-12: an override is a delivery-scope contract, so every item its scope names must already be
  // confirmed. Confirm the scope this finding names, then record the resolution against it.
  const finding = evaluateRisk(p).findings.find((entry) => entry.reason_code === "PAYMENT_OR_FINANCIAL");
  assert.ok(finding, "the fixture must produce a risk finding");
  for (const scopeId of finding.scope_ids) {
    const scopeItem = p.items.find((entry) => entry.id === scopeId)!;
    p = exec(svc, p, {kind: "ITEM_CONFIRMED", item_id: scopeItem.id, fingerprint: itemFingerprint(scopeItem),
      owner_action: {intent: "CONFIRM", source_ref: owner}}, "owner", "confirm-" + scopeId);
  }
  assert.equal(finding.minimum_mode, "PRODUCT_GRADE");
  assert.equal(finding.status, "BLOCKING");
  p = exec(svc, p, {kind: "MODE_OVERRIDE_RESOLVED", override_id: finding.override_id,
    resolution: "STUB_OR_SANDBOX", rationale: "The payment path ships as a sandbox stub only",
    owner_action: {intent: "RESOLVE_OVERRIDE", source_ref: owner}}, "owner", "resolve");
  return {p, overrideId: finding.override_id, itemId: "REQ-PAY-F9"};
}
function retract(svc: ProjectService, p: Project, overrideId: string, key: string,
  actor: "owner" | "agent" = "owner", reason = "The stub disposition is no longer correct"): Project {
  return exec(svc, p, {kind: "MODE_OVERRIDE_RETRACTED", override_id: overrideId, reason,
    owner_action: {intent: "RETRACT_OVERRIDE", source_ref: owner}}, actor, key);
}
function artifactXSpec(artifact: CompiledArtifact): XSpecDocument {
  return JSON.parse(artifact.files.find((file) => file.path === "xspec.json")!.content) as XSpecDocument;
}
function scopeOverrides(artifact: CompiledArtifact): unknown[] {
  return (artifactXSpec(artifact).delivery_profile as {scope_overrides: unknown[]}).scope_overrides;
}

// ---------------------------------------------------------------------------
// The withdrawal itself.
// ---------------------------------------------------------------------------
test("F-9 an Owner withdraws a confirmed override and the record is kept, never deleted", () => {
  const svc = service();
  const {p, overrideId} = resolvedProject(svc);
  const before = p.delivery_policy!.risk_overrides[0]!;
  assert.equal(before.status, "CONFIRMED");
  // F-12 requires the scope item to be confirmed before the override is recorded, so the item now
  // carries the Owner's confirmation ref too and the resolution inherits it alongside the resolving
  // Owner action: the attribution still names the scope items and the Owner.
  assert.equal(before.source_refs.length, 4, "scope and Owner attribution is retained alongside projection-version provenance");
  assert.equal(before.source_refs.at(-2)!.type, "owner_action");
  assert.deepEqual(before.source_refs.at(-1), {type: "system_rule", ref: "xmi-risk-resolution/2"});

  const after = retract(svc, p, overrideId, "retract");
  assert.equal(after.delivery_policy!.risk_overrides.length, 1, "the record survives withdrawal");
  const entry = after.delivery_policy!.risk_overrides[0]!;
  assert.equal(entry.status, "RETRACTED");
  assert.equal(entry.id, before.id);
  assert.equal(entry.resolution, "STUB_OR_SANDBOX", "the resolution that was made stays auditable");
  assert.equal(entry.minimum_mode, before.minimum_mode);
  assert.deepEqual(entry.scope_ids, before.scope_ids);
  assert.equal(entry.source_refs.length, before.source_refs.length + 1, "the withdrawal is attributed too");
  assert.deepEqual(entry.source_refs.at(-1), owner);

  const events = svc.history(p.project_id).filter((event) => event.command.kind === "MODE_OVERRIDE_RETRACTED");
  assert.equal(events.length, 1);
  assert.equal((events[0]!.command as {reason: string}).reason, "The stub disposition is no longer correct");
});

test("F-9 withdrawal returns the underlying risk to unresolved and fails the mode-risk gates", () => {
  const svc = service();
  const {p, overrideId} = resolvedProject(svc);
  const resolved = evaluateRisk(p).findings.find((entry) => entry.override_id === overrideId)!;
  assert.equal(resolved.status, "RESOLVED_BY_OVERRIDE");
  assert.equal(resolved.active_resolution, "STUB_OR_SANDBOX");
  assert.equal(evaluateRisk(p).unresolved_blocker_count, 0);

  const after = retract(svc, p, overrideId, "retract");
  const finding = evaluateRisk(after).findings.find((entry) => entry.override_id === overrideId)!;
  assert.equal(finding.status, "BLOCKING", "the risk is unresolved again, not satisfied");
  assert.equal(finding.active_resolution, null);
  assert.equal(evaluateRisk(after).unresolved_blocker_count, 1);
  const evaluation = new CompletenessService().evaluate(after, []);
  assert.equal(evaluation.hard_gates.find((gate) => gate.gate === 9)?.status, "FAIL");
  assert.equal(evaluation.mode_gates.find((gate) => gate.gate === 102)?.status, "FAIL");
  assert.equal(evaluation.hard_gate_ready, false);
});

test("F-9 a withdrawn override leaves the exported handoff envelope", () => {
  const svc = service();
  const {p, overrideId} = resolvedProject(svc);
  assert.equal(scopeOverrides(xspecs.compile(p)).length, 1, "an override in force reaches the consumer");
  const after = retract(svc, p, overrideId, "retract");
  assert.equal(scopeOverrides(xspecs.compile(after)).length, 0,
    "only overrides that are in force may reach a consumer");
});

// ---------------------------------------------------------------------------
// Guards: what withdrawal must refuse.
// ---------------------------------------------------------------------------
test("F-9 withdrawal refuses an unknown override, a second withdrawal and a non-Owner actor", () => {
  const svc = service();
  const {p, overrideId} = resolvedProject(svc);
  assert.throws(() => retract(svc, p, "MODE-OVERRIDE-NOT-RECORDED-0", "unknown"), /MODE_OVERRIDE_NOT_FOUND/);
  assert.throws(() => retract(svc, p, overrideId, "as-agent", "agent"), /OWNER_ACTION_REQUIRED/);
  assert.equal(svc.get(p.project_id).delivery_policy!.risk_overrides[0]!.status, "CONFIRMED",
    "a refused withdrawal must not change canonical state");
  const after = retract(svc, p, overrideId, "retract");
  const attribution = after.delivery_policy!.risk_overrides[0]!.source_refs.length;
  assert.throws(() => retract(svc, after, overrideId, "retract-again"), /MODE_OVERRIDE_NOT_CONFIRMED/);
  assert.equal(svc.get(p.project_id).delivery_policy!.risk_overrides[0]!.source_refs.length, attribution);
});

test("F-9 withdrawal requires a selected delivery mode", () => {
  const svc = service();
  const p = svc.create({idempotency_key: "create", title: "no mode", idea: "Record orders.", source_ref: owner}, "owner");
  assert.throws(() => retract(svc, p, "MODE-OVERRIDE-ANY-0", "retract"), /MODE_SELECTION_REQUIRED/);
});

// ---------------------------------------------------------------------------
// The case that used to be unrepairable, and the changed-mind path.
// ---------------------------------------------------------------------------
test("F-9 an override stays withdrawable after its finding has disappeared", () => {
  const svc = service();
  const {p, overrideId, itemId} = resolvedProject(svc);
  const item = p.items.find((entry) => entry.id === itemId)!;
  const rejected = exec(svc, p, {kind: "ITEM_REJECTED", item_id: item.id, fingerprint: itemFingerprint(item),
    reason: "Not part of this release after all", owner_action: {intent: "REJECT", source_ref: owner}}, "owner", "reject");
  assert.equal(evaluateRisk(rejected).findings.some((entry) => entry.override_id === overrideId), false,
    "the finding itself is gone, which is exactly the case that had no repair path");

  const after = retract(svc, rejected, overrideId, "retract");
  assert.equal(after.delivery_policy!.risk_overrides[0]!.status, "RETRACTED");
  assert.equal(scopeOverrides(xspecs.compile(after)).length, 0,
    "a stale override must not keep escalating or excluding scope in an exported package");
});

test("F-9 a withdrawn override can be resolved again, reusing the same record", () => {
  const svc = service();
  const {p, overrideId} = resolvedProject(svc);
  const after = retract(svc, p, overrideId, "retract");
  const again = exec(svc, after, {kind: "MODE_OVERRIDE_RESOLVED", override_id: overrideId,
    resolution: "DEFER_OR_EXCLUDE", rationale: "Take the payment path out of this release instead",
    owner_action: {intent: "RESOLVE_OVERRIDE", source_ref: owner}}, "owner", "resolve-again");
  assert.equal(again.delivery_policy!.risk_overrides.length, 1, "re-resolution reuses the record, never duplicates it");
  const entry = again.delivery_policy!.risk_overrides[0]!;
  assert.equal(entry.status, "CONFIRMED");
  assert.equal(entry.resolution, "DEFER_OR_EXCLUDE");
  assert.equal(evaluateRisk(again).unresolved_blocker_count, 0);
});

test("F-9 a retried withdrawal is idempotent and does not record the withdrawal twice", () => {
  const svc = service();
  const {p, overrideId} = resolvedProject(svc);
  const after = retract(svc, p, overrideId, "retract");
  // A durable retry repeats the same request: same expected_version, same idempotency key.
  const retried = retract(svc, p, overrideId, "retract");
  assert.equal(retried.model_version, after.model_version);
  assert.equal(retried.delivery_policy!.risk_overrides[0]!.source_refs.length,
    after.delivery_policy!.risk_overrides[0]!.source_refs.length);
  assert.equal(svc.history(p.project_id).filter((event) => event.command.kind === "MODE_OVERRIDE_RETRACTED").length, 1);
});

// ---------------------------------------------------------------------------
// View and contract surface.
// ---------------------------------------------------------------------------
test("F-9 the mode view separates overrides in force from withdrawn ones", () => {
  const svc = service();
  const {p, overrideId} = resolvedProject(svc);
  const before = modeView(p).policy!;
  assert.equal(before.risk_override_count, 1);
  assert.equal(before.risk_override_retracted_count, 0);
  const after = modeView(retract(svc, p, overrideId, "retract")).policy!;
  assert.equal(after.risk_override_count, 0, "a withdrawn override is not counted as in force");
  assert.equal(after.risk_override_retracted_count, 1);
});

test("F-9 the retraction tool contract is strict and stays a distinct Owner action", () => {
  assert.equal(metadata.xmi_mode_override_retract.write, true);
  assert.equal(metadata.xmi_mode_override_retract.destructive, true);
  const base = {schema_version: "0.1.0", project_id: "XMI-RETRACTION", expected_version: 2,
    idempotency_key: "k", override_id: "MODE-OVERRIDE-OTHER-0", intent: "RETRACT_OVERRIDE"};
  assert.equal(inputs.xmi_mode_override_retract.safeParse({...base, reason: "withdraw it"}).success, true);
  assert.equal(inputs.xmi_mode_override_retract.safeParse(base).success, false, "a reason is required");
  assert.equal(inputs.xmi_mode_override_retract.safeParse({...base, reason: ""}).success, false);
  assert.equal(inputs.xmi_mode_override_retract.safeParse({...base, reason: "withdraw it",
    resolution: "DEFER_OR_EXCLUDE"}).success, false, "retraction carries no resolution; the schema is strict");
  assert.equal(inputs.xmi_mode_override_retract.safeParse({...base, reason: "withdraw it", intent: "RESOLVE_OVERRIDE"})
    .success, false, "retraction cannot arrive as a resolution");
  assert.equal(inputs.xmi_mode_override_resolve.safeParse({...base, resolution: "DEFER_OR_EXCLUDE",
    rationale: "r", intent: "RESOLVE_OVERRIDE"}).success, true, "the resolution tool is unchanged");
});
