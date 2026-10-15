// F-10: the export gate.
//
// Registered on 2026-09-18 after the F-9 probe measured that an unresolved blocking mode-risk was
// reported (gate 9 / gate 102 FAIL, readiness NOT_READY) but NOT enforced: the package still came out
// `valid` and `package_valid`, and `finalizeForExport` wrote all sixteen files.
//
// Decided: an unresolved blocking mode-risk refuses the export. docs/08 section 5 lists
// "no unresolved mode-risk blocker" among the common hard gates beside supported-profile and valid
// schema/references, and both of those already refuse an export here; docs/16 section 4 states it
// directly as "blocks export". No consumer's opinion is involved, so this does not undo F-7: no
// external party may veto XMi's deliverable, but XMi's own undecided policy may hold it back until the
// Owner decides. ADR-008 records the whole gate.
//
// Kept in a separate file: the earlier test files belong to closed baselines.
import test from "node:test";
import assert from "node:assert/strict";
import { evaluateRisk } from "../packages/core/completeness-service.ts";
import { ProjectService } from "../packages/core/project-service.ts";
import { SolutionService } from "../packages/core/solution-service.ts";
import { MemoryProjectStore } from "../packages/storage/memory.ts";
import { itemFingerprint, modeFingerprint } from "../packages/core/validation.ts";
import { XSpecService } from "../packages/core/xspec-service.ts";
import type { Candidate, DeliveryMode, Project } from "../packages/shared-types/domain.ts";

const now = "2026-09-18T19:00:00.000Z";
const owner = {type: "owner_action" as const, ref: "fixture:mode-risk-export-gate"};
const source = {type: "conversation_turn" as const, ref: "fixture:mode-risk-export-gate"};
const xspecs = new XSpecService();

function service(): ProjectService { return new ProjectService(new MemoryProjectStore(), () => now); }
function exec(svc: ProjectService, p: Project, command: unknown, actor: "owner" | "agent", key: string): Project {
  return svc.execute({project_id: p.project_id, expected_version: p.model_version, idempotency_key: key, command}, actor);
}
function item(id: string, type: Candidate["type"], statement: string, tags?: string[], links?: string[]): Candidate {
  return {id, type, statement, status: "PROPOSED", source_refs: [source], priority: "P2", tags, links};
}
const prerequisites = (): Candidate[] => [
  item("VISION-G", "vision", "Help independent shop owners record their orders in a small web application.", ["problem", "outcome"]),
  item("ACTOR-G", "actor", "Independent shop owners are the primary users.", ["primary-user"]),
  item("FLOW-G", "flow", "A shop owner opens the web app, records an order and sees the saved result.", ["core"]),
  item("DATA-G", "data_entity", "Order records live in the owning workspace and are kept between sessions.", ["data-sensitivity"]),
  item("SOLCON-G", "solution_constraint", "Use a cloud-hosted web application boundary.", ["deployment", "local-cloud"]),
  item("SCALE-G", "non_functional_requirement", "Pilot scale is about 100 active users with sub-second interaction targets.", ["scale", "latency"]),
  item("NOINT-G", "exclusion", "No external integrations are used in V0.", ["integrations-none"]),
  item("COST-G", "non_functional_requirement", "Prefer low operating cost and low maintenance burden for the Owner.", ["cost", "maintenance"]),
  item("PLATFORM-G", "non_functional_requirement", "Support modern desktop and mobile web browsers.", ["platform", "browser"]),
];
const payment = (): Candidate => item("REQ-PAY-G", "functional_requirement",
  "Charge customers with Stripe and refund failed payments.");
const paymentAc = (): Candidate => item("AC-PAY-G", "acceptance_criterion",
  "Given a failed charge, the refund is recorded and the order is marked unpaid.", ["automated"], ["REQ-PAY-G"]);

function add(svc: ProjectService, p: Project, c: Candidate): Project {
  return exec(svc, p, {kind: "CANDIDATE_EXTRACTED", candidate: c}, "agent", "add-" + c.id);
}
function confirmItem(svc: ProjectService, p: Project, id: string): Project {
  const stored = p.items.find((entry) => entry.id === id)!;
  return exec(svc, p, {kind: "ITEM_CONFIRMED", item_id: stored.id, fingerprint: itemFingerprint(stored),
    owner_action: {intent: "CONFIRM", source_ref: owner}}, "owner", "confirm-" + id);
}
function addConfirmed(svc: ProjectService, p: Project, c: Candidate): Project {
  return confirmItem(svc, add(svc, p, c), c.id);
}
// A compile-able project at the given mode whose only outstanding issue is the payment risk.
function paymentProject(svc: ProjectService, mode: DeliveryMode = "FAST_DEVELOPMENT"): Project {
  let p = svc.create({idempotency_key: "create", title: "export gate fixture",
    idea: "Record orders for independent shop owners.", source_ref: owner}, "owner");
  for (const c of prerequisites()) p = addConfirmed(svc, p, c);
  const reason = "export gate fixture mode";
  p = exec(svc, p, {kind: "DELIVERY_MODE_SELECTED", mode, reason, fingerprint: modeFingerprint(p, mode, reason),
    owner_action: {intent: "CONFIRM", source_ref: owner}}, "owner", "mode");
  const proposal = new SolutionService().propose(p, {type: "system_rule", ref: "fixture:mode-risk-export-gate"});
  p = add(svc, p, proposal);
  const blueprint = p.items.find((entry) => entry.id === proposal.id)!;
  p = exec(svc, p, {kind: "SOLUTION_BLUEPRINT_APPROVED", item_id: blueprint.id, fingerprint: itemFingerprint(blueprint),
    owner_action: {intent: "APPROVE_BLUEPRINT", source_ref: owner}}, "owner", "approve-blueprint");
  return add(svc, p, payment());
}
function currentOverrideId(p: Project): string {
  // The id is a fingerprint of the scope state, so it changes whenever the scope items change.
  return evaluateRisk(p).findings.find((entry) => entry.reason_code === "PAYMENT_OR_FINANCIAL")!.override_id;
}

// ---------------------------------------------------------------------------
// The gate itself.
// ---------------------------------------------------------------------------
test("F-10 an unresolved blocking mode-risk refuses the export and says which risk", () => {
  const svc = service();
  const p = paymentProject(svc);
  const artifact = xspecs.compile(p);
  const validation = xspecs.validate(p, artifact);
  const blocker = validation.errors.find((error) => error.code === "XSPEC_UNRESOLVED_MODE_RISK");
  assert.ok(blocker, JSON.stringify(validation.errors));
  assert.match(blocker.message, /PAYMENT_OR_FINANCIAL/);
  assert.match(blocker.message, /REQ-PAY-G/, "the message names the scope that needs a decision");
  assert.ok(blocker.user_action.length > 0);
  assert.equal(validation.package_valid, false, "it is a package-intrinsic refusal, not a consumer opinion");
  assert.equal(validation.valid, false);
  assert.throws(() => xspecs.finalizeForExport(p), /XSPEC_PACKAGE_INVALID/);
});

test("F-10 the refusal is package-intrinsic: it is not attributed to XUi or XDev", () => {
  const svc = service();
  const p = paymentProject(svc);
  const validation = xspecs.validate(p, xspecs.compile(p));
  assert.equal(validation.consumers.xdev.accepted, false);
  assert.ok(validation.consumers.xdev.errors.some((error) => error.code === "XSPEC_UNRESOLVED_MODE_RISK"),
    "the consumer sees the package error as a package error, not as its own objection");
  assert.equal(validation.readiness_evaluation.hard_gate_ready, false);
  assert.equal(validation.readiness_evaluation.hard_gates.find((gate) => gate.gate === 9)?.status, "FAIL");
  assert.equal(validation.readiness_evaluation.mode_gates.find((gate) => gate.gate === 102)?.status, "FAIL");
});

test("F-10 deciding the risk re-opens the export, and the decision is the Owner's", () => {
  const svc = service();
  let p = confirmItem(svc, paymentProject(svc), "REQ-PAY-G");
  p = addConfirmed(svc, p, paymentAc());
  p = exec(svc, p, {kind: "MODE_OVERRIDE_RESOLVED", override_id: currentOverrideId(p), resolution: "STUB_OR_SANDBOX",
    rationale: "The payment path ships as a sandbox stub only",
    owner_action: {intent: "RESOLVE_OVERRIDE", source_ref: owner}}, "owner", "resolve");
  const validation = xspecs.validate(p, xspecs.compile(p));
  assert.equal(validation.package_valid, true, JSON.stringify(validation.errors));
  const compiled = JSON.parse(xspecs.compile(p).files.find(file => file.path === "xspec.json")!.content);
  assert.equal(compiled.delivery_profile.scope_overrides[0].rationale, "The payment path ships as a sandbox stub only");
  assert.equal(validation.errors.some((error) => error.code === "XSPEC_UNRESOLVED_MODE_RISK"), false);
  assert.equal(xspecs.finalizeForExport(p).artifact.files.length, 16);
});

// ---------------------------------------------------------------------------
// Controls: the gate must not over-block.
// ---------------------------------------------------------------------------
test("F-10 a risk the project mode already satisfies does not refuse the export", () => {
  const svc = service();
  const p = paymentProject(svc, "PRODUCT_GRADE");
  const validation = xspecs.validate(p, xspecs.compile(p));
  assert.equal(validation.errors.some((error) => error.code === "XSPEC_UNRESOLVED_MODE_RISK"), false);
  assert.equal(validation.package_valid, true, JSON.stringify(validation.errors));
  assert.equal(xspecs.finalizeForExport(p).artifact.files.length, 16);
});

test("F-10 rejecting the item that raised the risk does not refuse the export", () => {
  const svc = service();
  const p = paymentProject(svc);
  const target = p.items.find((entry) => entry.id === "REQ-PAY-G")!;
  const rejected = exec(svc, p, {kind: "ITEM_REJECTED", item_id: target.id, fingerprint: itemFingerprint(target),
    reason: "Not part of this release after all", owner_action: {intent: "REJECT", source_ref: owner}}, "owner", "reject");
  const validation = xspecs.validate(rejected, xspecs.compile(rejected));
  assert.equal(validation.package_valid, true, JSON.stringify(validation.errors));
  assert.equal(xspecs.finalizeForExport(rejected).artifact.files.length, 16);
});

// ---------------------------------------------------------------------------
// F-12 closure: the Owner-gated write path now refuses an override for scope that is not yet
// CONFIRMED. This strengthens the previous characterization instead of teaching export to tolerate
// a broken scope reference. The repair remains two steps: confirm scope + AC, then re-resolve the
// current fingerprinted override id.
// ---------------------------------------------------------------------------
test("F-12 refuses a mode-risk override until every affected scope item is confirmed", () => {
  const svc = service();
  const p = paymentProject(svc);
  assert.throws(() => exec(svc, p, {kind: "MODE_OVERRIDE_RESOLVED", override_id: currentOverrideId(p), resolution: "STUB_OR_SANDBOX",
    rationale: "Stub it for now", owner_action: {intent: "RESOLVE_OVERRIDE", source_ref: owner}}, "owner", "resolve"),
  /MODE_OVERRIDE_SCOPE_NOT_CONFIRMED/);
  assert.equal(p.delivery_policy!.risk_overrides.length, 0, "the refused write must not leave an override record behind");
  let fixed = confirmItem(svc, p, "REQ-PAY-G");
  fixed = addConfirmed(svc, fixed, paymentAc());
  fixed = exec(svc, fixed, {kind: "MODE_OVERRIDE_RESOLVED", override_id: currentOverrideId(fixed),
    resolution: "STUB_OR_SANDBOX", rationale: "Re-resolved after confirming the scope",
    owner_action: {intent: "RESOLVE_OVERRIDE", source_ref: owner}}, "owner", "resolve-again");
  const repaired = xspecs.validate(fixed, xspecs.compile(fixed));
  assert.equal(repaired.errors.some((error) => error.code === "XSPEC_SCOPE_REFERENCE_NOT_FOUND"), false);
  assert.equal(repaired.package_valid, true, JSON.stringify(repaired.errors));
  assert.equal(xspecs.finalizeForExport(fixed).artifact.files.length, 16);
});
