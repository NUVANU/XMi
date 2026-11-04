import type {Actor, Candidate, Command, DeliveryMode, RiskOverrideResolution, SourceRef} from "../../packages/shared-types/domain.ts";
import {MemoryProjectStore} from "../../packages/storage/memory.ts";
import {ProjectService} from "../../packages/core/project-service.ts";
import {SolutionService} from "../../packages/core/solution-service.ts";
import {DecisionService} from "../../packages/core/decision-service.ts";
import {evaluateRisk} from "../../packages/core/completeness-service.ts";
import {itemFingerprint, modeFingerprint} from "../../packages/core/validation.ts";
import {XSpecService} from "../../packages/core/xspec-service.ts";

// These owner_action events are explicitly synthetic test approvals, never human consent.
export const syntheticSource = (label: string): SourceRef & {type: "owner_action"} =>
  ({type: "owner_action", ref: "fixture:SYNTHETIC_NOT_HUMAN:" + label});

export function buildFixture(options: {mode?: DeliveryMode; omitIdentity?: boolean; riskResolution?: RiskOverrideResolution} = {}) {
  const store = new MemoryProjectStore(), service = new ProjectService(store);
  let sequence = 0;
  let project = service.create({title: "Synthetic colored-block exercise", idea: "Help a visitor practice sorting public colored blocks.",
    profile: "web-micro-saas-v0", source_ref: {type: "document", ref: "fixture:synthetic-inputs"},
    idempotency_key: "synthetic-create"}, "owner");
  const apply = (command: Command, actor: Actor = "agent") => {
    project = service.execute({project_id: project.project_id, expected_version: project.model_version,
      idempotency_key: "synthetic-event-" + (++sequence), command}, actor);
    return project;
  };
  const confirm = (id: string) => {
    const item = project.items.find(row => row.id === id)!;
    return apply({kind: "ITEM_CONFIRMED", item_id: id, fingerprint: itemFingerprint(item),
      owner_action: {intent: "CONFIRM", source_ref: syntheticSource(id)}}, "owner");
  };
  const add = (candidate: Candidate, adopt = true) => {
    apply({kind: "CANDIDATE_EXTRACTED", candidate});
    if (adopt) confirm(candidate.id);
    return project;
  };
  confirm(project.items[0]!.id);
  const selectMode = (mode: DeliveryMode) => {
    const reason = "Explicit synthetic fixture mode selection";
    apply({kind: project.delivery_policy ? "DELIVERY_MODE_UPGRADED" : "DELIVERY_MODE_SELECTED", mode,
      reason, fingerprint: modeFingerprint(project, mode, reason),
      owner_action: {intent: "CONFIRM", source_ref: syntheticSource("mode-" + mode)}}, "owner");
  };
  selectMode(options.mode ?? "FAST_VALIDATION");
  const definitions: Array<[string, Candidate["type"], string, string[]]> = [
    ["ACT-PRIMARY", "actor", "The primary user is a visitor sorting public colored blocks.", ["primary-user"]],
    ["GOAL-OUTCOME", "goal", "The outcome is practicing visible color ordering.", ["purpose"]],
    ["FLOW-CORE", "flow", "The core flow opens a color board, rearranges its blocks, then displays the resulting order.", ["core"]],
    ["CON-SCOPE", "constraint", "First version scope is a colored-block sorting exercise.", ["scope", "mvp"]],
    ["CON-IDENTITY", "constraint", "Anonymous guest usage for the exercise.", ["identity"]],
    ["PERM-VISITOR", "permission_rule", "Each visitor session is isolated to its public colored blocks.", ["role", "permission", "isolation"]],
    ["CON-DATA", "constraint", "Public synthetic colored blocks are ephemeral within a session.", ["persistence", "data-sensitivity"]],
    ["CON-REGULATED", "constraint", "Only public colored blocks are in scope.", ["regulated"]],
    ["SOLCON-PLATFORM", "solution_constraint", "Browser-only operation on this local device.", ["local-cloud", "platform"]],
    ["NFR-LATENCY", "non_functional_requirement", "One visitor expects visible feedback within 100 ms.", ["scale", "latency"]],
    ["EXC-INTEGRATION", "exclusion", "No external integration is part of this exercise.", ["integrations-none"]],
    ["SOLCON-COST", "solution_constraint", "The operating budget is zero recurring cost.", ["cost"]],
    ["REQ-SORT", "functional_requirement", "A visitor can rearrange public color blocks.", ["sorting"]],
    ["REQ-FAILURE", "functional_requirement", "When the color board cannot load, show a failure notice.", ["fallback"]],
  ];
  for (const [id, type, statement, tags] of definitions) {
    if (options.omitIdentity && id === "CON-IDENTITY") continue;
    add({id, type, statement, tags, status: "PROPOSED", source_refs: [{type: "document", ref: "fixture:synthetic-inputs:" + id}],
      priority: id === "REQ-SORT" ? "P0" : "P1", links: id === "FLOW-CORE" ? ["ACT-PRIMARY"] : []});
  }
  add({id: "AC-SORT", type: "acceptance_criterion", statement: "Given a displayed order, when a visitor swaps two blocks, the displayed positions are swapped.",
    status: "PROPOSED", priority: "P0", tags: ["automated"], links: ["REQ-SORT"], source_refs: [{type: "document", ref: "fixture:synthetic-acceptance"}]});
  add({id: "AC-FAILURE", type: "acceptance_criterion", statement: "Given an unavailable color board, the failure notice is visible.",
    status: "PROPOSED", tags: ["automated"], links: ["REQ-FAILURE"], source_refs: [{type: "document", ref: "fixture:synthetic-failure-acceptance"}]});
  if (!options.riskResolution) add({id: "CON-COMMERCIAL", type: "constraint", statement: "The exercise has no purchase plan.", status: "PROPOSED",
    tags: ["profile-applicability:commercial:not-applicable"], source_refs: [{type: "document", ref: "fixture:synthetic-commercial-boundary"}]});
  if (options.riskResolution) {
    add({id: "REQ-PAYMENT", type: "functional_requirement", statement: "A visitor can submit a real payment.", status: "PROPOSED", priority: "P0",
      links: [], tags: ["payment"], source_refs: [{type: "document", ref: "fixture:synthetic-payment"}]});
    add({id: "AC-PAYMENT", type: "acceptance_criterion", statement: "Payment failure displays a payment failure message.",
      status: "PROPOSED", links: ["REQ-PAYMENT"], tags: ["automated"], source_refs: [{type: "document", ref: "fixture:synthetic-payment-acceptance"}]});
    for (const finding of evaluateRisk(project).findings.filter(row => row.status === "BLOCKING")) {
      if (options.riskResolution === "UPGRADE_PROJECT" && project.delivery_policy!.effective_mode !== finding.minimum_mode) selectMode(finding.minimum_mode);
      apply({kind: "MODE_OVERRIDE_RESOLVED", override_id: finding.override_id, resolution: options.riskResolution,
        rationale: "Synthetic scope disposition covers exactly this isolated capability.",
        owner_action: {intent: "RESOLVE_OVERRIDE", source_ref: syntheticSource("disposition:" + finding.override_id)}}, "owner");
    }
  }
  const unresolved = evaluateRisk(project).findings.filter(row => row.status === "BLOCKING");
  if (unresolved.length) throw new Error("Synthetic fixture has unresolved risks: " + JSON.stringify(unresolved));
  const blueprint = new SolutionService().propose(project, {type: "document", ref: "fixture:synthetic-blueprint"});
  add(blueprint, false);
  apply({kind: "SOLUTION_BLUEPRINT_APPROVED", item_id: blueprint.id,
    fingerprint: itemFingerprint(project.items.find(row => row.id === blueprint.id)!),
    owner_action: {intent: "APPROVE_BLUEPRINT", source_ref: syntheticSource("blueprint")}}, "owner");
  return {store, service, apply, add, confirm, get project() {return service.get(project.project_id);},
    xspec: new XSpecService(undefined, service)};
}

export function decisionCandidate(index: number, module = "sorting"): Candidate {
  const impact = {user_experience: "Show the exact selected order.", cost: "No recurring cost.", complexity: "One explicit behavior branch.",
    privacy: "Only public synthetic blocks are used.", xdev: "Implement only after explicit adoption."};
  const result = new DecisionService().propose({id: "DEC-CHOICE-" + index, question: "Which ordering should apply?",
    why_it_matters: "The order determines the visible result.",
    options: [{id: "LEFT", label: "Left first", impact}, {id: "RIGHT", label: "Right first", impact: {...impact, user_experience: "Show right first."}}],
    recommendation: {option_id: "LEFT", rationale: "Matches the recorded sorting example.", confidence: "LOW"},
    linked_requirements: ["REQ-SORT"], linked_flows: ["FLOW-CORE"], source_ref: {type: "document", ref: "fixture:synthetic-choice"}});
  result.tags = [...(result.tags ?? []), "module:" + module];
  return result;
}
