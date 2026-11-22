import type { Item, Project } from "../../packages/shared-types/domain.ts";
import { fingerprint, itemFingerprint, modeFingerprint } from "../../packages/core/validation.ts";
import type { DeliveryMode } from "../../packages/shared-types/domain.ts";
import { evaluateRisk } from "../../packages/core/completeness-service.ts";
import { requireCondition } from "../../packages/core/errors.ts";
import type { DeliveryWorkflow } from "../../packages/core/document-delivery.ts";
import type { XSpecValidation } from "../../packages/core/xspec-service.ts";

export function projectView(p: Project, offset = 0, limit = 10) {
  const blockers = p.open_questions.filter((q) => q.status === "BLOCKING");
  return {
    project_id: p.project_id, xspec_id: p.xspec_id ?? null, title: p.title,
    model_version: p.model_version, lifecycle_state: p.lifecycle_state,
    effective_mode: p.delivery_policy?.effective_mode ?? null,
    readiness_target: p.delivery_policy?.readiness_target ?? null,
    achieved_readiness: null, readiness_status: "NOT_EVALUATED",
    items: p.items.slice(offset, offset + limit).map((i) => ({
      id: i.id, type: i.type, statement: i.statement.slice(0, 400), statement_truncated: i.statement.length > 400,
      status: i.status, version: i.version, fingerprint: itemFingerprint(i),
      source_refs: i.source_refs.slice(0, 3).map((r) => ({type: r.type, ref: r.ref.slice(0, 160)})),
      source_refs_truncated: i.source_refs.length > 3 || i.source_refs.some((r) => r.ref.length > 160),
    })),
    total_items: p.items.length, next_offset: offset + limit < p.items.length ? offset + limit : null,
    blockers: blockers.slice(0, 10).map((q) => ({id: q.id, question: q.question.slice(0, 400)})),
    blockers_truncated: blockers.length > 10 || blockers.some((q) => q.question.length > 400),
    mode_selection_required: p.delivery_policy === null,
  };
}
export function exactItemView(project: Project, ids: string[]) {
  const items = new Map(project.items.map(item => [item.id, item]));
  return {detail: "items" as const, project_id: project.project_id, model_version: project.model_version,
    items: ids.map(id => {
      const item = items.get(id);
      requireCondition(item, "ITEM_NOT_FOUND");
      return {...item, fingerprint: itemFingerprint(item)};
    })};
}

const ref = ({id, type, status, version}: Item) => ({id, type, status, version});
const active = (item: Item) => item.status !== "REJECTED" && item.status !== "SUPERSEDED";
const excerpt = (value: string) => value.length > 120 ? value.slice(0, 119) + "…" : value;

function changesBetween(project: Project, baseline?: Project) {
  if (!baseline) return [];
  const before = new Map(baseline.items.map(item => [item.id, item]));
  const after = new Map(project.items.map(item => [item.id, item]));
  return [...new Set([...after.keys(), ...before.keys()])].flatMap(id => {
    const old = before.get(id), current = after.get(id);
    if (old && current && fingerprint(old) === fingerprint(current)) return [];
    const latest = (current ?? old)!;
    const change = !current ? "REMOVED" as const : old ? "UPDATED" as const : "ADDED" as const;
    return [{row: {...ref(latest), change, ...(current ? {excerpt: excerpt(current.statement)} : {})},
      links: [...(old?.links ?? []), ...(current?.links ?? [])]}];
  });
}

export function incrementalProjectView(project: Project, workflow: DeliveryWorkflow, query: {
  since_version?: number; offset?: number; limit?: number;
}, baseline?: Project) {
  const {since_version: since, offset = 0, limit = 8} = query;
  const changes = changesBetween(project, baseline);
  const changedIds = new Set(changes.map(change => change.row.id));
  const linked = new Set(changes.flatMap(change => change.links));
  const acceptance = project.items.filter(item => active(item) && item.type === "acceptance_criterion" &&
    (changedIds.has(item.id) || linked.has(item.id) || item.links?.some(id => changedIds.has(id))));
  const pending = project.items.filter(item => active(item) && item.status !== "CONFIRMED")
    .sort((a, b) => Number(b.status === "BLOCKING") - Number(a.status === "BLOCKING") ||
      (a.priority ?? "P3").localeCompare(b.priority ?? "P3"));
  const questions = project.open_questions.filter(q => q.status === "BLOCKING" || q.status === "OPEN")
    .sort((a, b) => Number(b.status === "BLOCKING") - Number(a.status === "BLOCKING") || a.priority.localeCompare(b.priority));
  const unchanged = since === project.model_version;
  const comparable = unchanged || baseline !== undefined;
  return {
    detail: "incremental" as const, project_id: project.project_id, model_version: project.model_version,
    title: project.title, lifecycle_state: project.lifecycle_state, effective_mode: project.delivery_policy?.effective_mode ?? null,
    readiness_target: project.delivery_policy?.readiness_target ?? null, readiness_status: "NOT_EVALUATED" as const, snapshot_consistent: true as const,
    since_version: since ?? null,
    change_status: since === undefined ? "OVERVIEW" : unchanged ? "UNCHANGED" : baseline ? "CHANGED" : "BASELINE_UNAVAILABLE",
    policy_changed: baseline ? fingerprint(baseline.delivery_policy) !== fingerprint(project.delivery_policy) : unchanged ? false : null,
    questions_changed: baseline ? fingerprint(baseline.open_questions) !== fingerprint(project.open_questions) : unchanged ? false : null,
    changed_items: changes.slice(offset, offset + limit).map(change => change.row),
    change_count: comparable ? changes.length : null, next_offset: offset + limit < changes.length ? offset + limit : null,
    pending_items: pending.slice(0, 6).map(ref), pending_item_count: pending.length,
    open_questions: questions.slice(0, 6).map(q => ({id: q.id, status: q.status, priority: q.priority, excerpt: excerpt(q.question)})),
    open_question_count: questions.length, blocking_question_count: questions.filter(q => q.status === "BLOCKING").length,
    related_acceptance_ids: acceptance.slice(0, 12).map(item => item.id), related_acceptance_count: acceptance.length,
    delivery_workflow: shortDeliveryView(workflow),
  };
}

function shortDeliveryView(workflow: DeliveryWorkflow) {
  const review = workflow.document_review;
  return {stage: workflow.stage, formal_assurance: workflow.formal_assurance, review_state: review.state, review_run_id: review.run_id,
    reviewed_model_version: review.reviewed_model_version, review_source_verified: review.source_verified,
    finding_count: review.finding_count, question_count: review.question_count, note_count: review.note_count,
    ...(review.delivery_triage ? {delivery_triage: review.delivery_triage} : {}), next_action: workflow.next_action};
}

export function shortValidationView(result: {project_id: string; model_version: number; validation: XSpecValidation; delivery_workflow: DeliveryWorkflow}) {
  const {validation: v, delivery_workflow: workflow, ...identity} = result;
  const r = v.readiness_evaluation;
  const gate = ({gate, status}: typeof r.hard_gates[number]) => ({gate, status});
  return {...identity, detail: "summary" as const, validation: {valid: v.valid, package_valid: v.package_valid,
    error_count: v.errors.length, error_codes: [...new Set(v.errors.map(error => error.code))].slice(0, 8),
    consumers: {xui: v.consumers.xui.accepted, xdev: v.consumers.xdev.accepted}, readiness_evaluation: {
      target: r.target, readiness_status: r.readiness_status, hard_gate_ready: r.hard_gate_ready,
      hard_gates: r.hard_gates.map(gate), mode_gates: r.mode_gates.map(gate),
    }}, delivery_workflow: shortDeliveryView(workflow)};
}

export function modeView(p: Project, proposal?: {mode: DeliveryMode; reason: string}) {
  const policy = p.delivery_policy;
  return {project_id: p.project_id, model_version: p.model_version,
    proposal_fingerprint: proposal ? modeFingerprint(p, proposal.mode, proposal.reason) : null,
    policy: policy ? {
      requested_mode: policy.requested_mode, effective_mode: policy.effective_mode,
      readiness_target: policy.readiness_target, selection_source: policy.selection_source, selected_at: policy.selected_at,
      history: policy.history.slice(-10).map((h) => ({...h, reason: h.reason.slice(0, 400)})),
      history_truncated: policy.history.length > 10 || policy.history.some((h) => h.reason.length > 400),
      risk_override_count: policy.risk_overrides.filter((entry) => entry.status === "CONFIRMED").length,
      risk_override_retracted_count: policy.risk_overrides.filter((entry) => entry.status === "RETRACTED").length,
    } : null,
    selection_required: !policy, fingerprint_algorithm: "SHA256_CANONICAL_MODE_REQUEST",
    risk_evaluation: evaluateRisk(p),
  };
}
export const mutationView = (p: Project) => ({project_id: p.project_id, model_version: p.model_version,
  next_action: "Read the canonical project; no readiness or export is granted."});
