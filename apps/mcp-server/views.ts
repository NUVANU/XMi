import type { Project } from "../../packages/shared-types/domain.ts";
import { itemFingerprint, modeFingerprint } from "../../packages/core/validation.ts";
import type { DeliveryMode } from "../../packages/shared-types/domain.ts";
import { evaluateRisk } from "../../packages/core/completeness-service.ts";

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
