import {ProjectService} from "../../packages/core/project-service.ts";
import {MemoryProjectStore} from "../../packages/storage/memory.ts";
import {SolutionService} from "../../packages/core/solution-service.ts";
import {evaluateRisk, riskResolutionRevision} from "../../packages/core/completeness-service.ts";
import {itemFingerprint, modeFingerprint} from "../../packages/core/validation.ts";
import type {Item, Project} from "../../packages/shared-types/domain.ts";

export const reviewSource = {type: "owner_action" as const, ref: "fixture:spec-review"};
const now = "2026-10-16T00:00:00.000Z";
export function reviewProject(financial = 0): Project {
  const p = new ProjectService(new MemoryProjectStore()).create({idempotency_key: "create", title: "Synthetic review", idea: "Record public notes", source_ref: reviewSource});
  p.model_version = 30;
  p.delivery_policy = {requested_mode: "FAST_DEVELOPMENT", effective_mode: "FAST_DEVELOPMENT", readiness_target: "BUILD_READY",
    selection_source: "OWNER_CONFIRMED", selected_at: now,
    history: [{from_mode: null, to_mode: "FAST_DEVELOPMENT", reason: "fixture", changed_by: "owner", changed_at: now}], risk_overrides: []};
  const add = (id: string, type: Item["type"], statement: string, links?: string[]) => p.items.push({id, type, statement, status: "CONFIRMED",
    priority: "P2", source_refs: [reviewSource], links, version: 1, created_at: now, updated_at: now, confirmed_by: "owner", confirmed_at: now});
  p.items = [];
  add("VISION-REVIEW", "vision", "Record public notes and see the saved outcome.");
  add("ACTOR-REVIEW", "actor", "A note author.");
  add("FLOW-REVIEW", "flow", "Create a note then see the saved result.");
  add("REQ-REVIEW", "functional_requirement", "Save a note and reload it.", ["FLOW-REVIEW"]);
  add("AC-REVIEW", "acceptance_criterion", "Valid input persists on reload; invalid input creates nothing.", ["REQ-REVIEW"]);
  add("DATA-REVIEW", "data_entity", "Public data persists locally.");
  add("DEPLOY-REVIEW", "solution_constraint", "Use a local web browser.");
  add("SCALE-REVIEW", "non_functional_requirement", "100 users with latency under one second.");
  add("COST-REVIEW", "non_functional_requirement", "Low cost and maintenance.");
  add("EXCL-REVIEW", "exclusion", "No external integrations in the first version scope.");
  for (let index = 0; index < financial; index++) add(`BILL-${index}`, "risk", `Shadow billing record ${index}; retain truthful estimates.`);
  if (financial) {
    const risk = evaluateRisk(p).findings.find(f => f.reason_code === "PAYMENT_OR_FINANCIAL")!;
    p.delivery_policy.risk_overrides.push({id: risk.override_id, scope_ids: risk.scope_ids, reason_code: risk.reason_code,
      minimum_mode: "PRODUCT_GRADE", status: "CONFIRMED", resolution: "UPGRADE_SCOPE", rationale: "Preserve enhanced scoped assurance",
      source_refs: [reviewSource, riskResolutionRevision]});
  }
  const blueprint = new SolutionService().propose(p, reviewSource);
  blueprint.blueprint_detail!.owner_disposition = "APPROVED";
  p.items.push({...blueprint, status: "CONFIRMED", version: 1, created_at: now, updated_at: now, confirmed_by: "owner", confirmed_at: now});
  return p;
}

/** Replayable synthetic state for MCP tests, never a real project or grant. */
export function reviewProjectService() {
  const store = new MemoryProjectStore(), service = new ProjectService(store), sample = reviewProject();
  let p = service.create({idempotency_key: "create", title: sample.title, idea: sample.items[0]!.statement, source_ref: reviewSource});
  const run = (command: unknown) => p = service.execute({project_id: p.project_id, expected_version: p.model_version,
    idempotency_key: `seed-${p.model_version}`, command}, "owner");
  run({kind: "DELIVERY_MODE_SELECTED", mode: "FAST_DEVELOPMENT", reason: "fixture", fingerprint: modeFingerprint(p, "FAST_DEVELOPMENT", "fixture"),
    owner_action: {intent: "CONFIRM", source_ref: reviewSource}});
  run({kind: "ITEM_CONFIRMED", item_id: p.items[0]!.id, fingerprint: itemFingerprint(p.items[0]!), owner_action: {intent: "CONFIRM", source_ref: reviewSource}});
  for (const item of sample.items.slice(1).filter(i => i.type !== "solution_blueprint")) {
    const content = {id: item.id, type: item.type, statement: item.statement, source_refs: item.source_refs, links: item.links, priority: item.priority};
    run({kind: "CANDIDATE_EXTRACTED", candidate: {...content, status: "PROPOSED"}});
    const saved = p.items.at(-1)!;
    run({kind: "ITEM_CONFIRMED", item_id: saved.id, fingerprint: itemFingerprint(saved), owner_action: {intent: "CONFIRM", source_ref: reviewSource}});
  }
  const blueprint = new SolutionService().propose(p, reviewSource);
  run({kind: "CANDIDATE_EXTRACTED", candidate: blueprint});
  const saved = p.items.at(-1)!;
  run({kind: "SOLUTION_BLUEPRINT_APPROVED", item_id: saved.id, fingerprint: itemFingerprint(saved), owner_action: {intent: "APPROVE_BLUEPRINT", source_ref: reviewSource}});
  return {store, service, project: p};
}
