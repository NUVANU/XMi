import { z } from "zod";
import type { DeliveryMode, Item, Project } from "../shared-types/domain.ts";
import { canonical, fingerprint } from "./validation.ts";
import { isRiskScopeDeferred } from "./completeness-service.ts";
import { paymentScope } from "./payment-scope.ts";

export const auditFindingSchema = z.strictObject({
  id: z.string().regex(/^AUDIT-FINDING-[A-Z0-9-]+$/),
  severity: z.enum(["INFO", "WARNING", "BLOCKING"]),
  category: z.string().min(1).max(100),
  message: z.string().min(1).max(4000),
  affected_ids: z.array(z.string().min(1).max(100)).max(50),
  suggested_question: z.string().min(1).max(2000).nullable(),
});
export type AuditFinding = z.infer<typeof auditFindingSchema>;

export const auditResultSchema = z.strictObject({
  audit_run_id: z.string().regex(/^AUDIT-[A-Z0-9-]+$/),
  project_id: z.string().regex(/^XMI-[A-Z0-9-]+$/),
  product_model_version: z.number().int().positive(),
  target_mode: z.enum(["FAST_VALIDATION", "FAST_DEVELOPMENT", "PRODUCT_GRADE"]).nullable(),
  assurance_level: z.enum(["BASIC_SELF_CHECK", "INDEPENDENT_SPEC_REVIEW", "INDEPENDENT_PRODUCT_AUDIT"]).nullable(),
  deterministic_status: z.enum(["PASS", "BLOCKING"]),
  independent_review_status: z.literal("UNAVAILABLE"),
  isolation_status: z.literal("BOUNDED_SNAPSHOT_FALLBACK"),
  readiness_eligible: z.literal(false),
  findings: z.array(auditFindingSchema),
  evaluated_at: z.iso.datetime(),
  state_fingerprint_before: z.string().regex(/^[a-f0-9]{64}$/),
  state_fingerprint_after: z.string().regex(/^[a-f0-9]{64}$/),
  state_unchanged: z.boolean(),
  limitation: z.string().min(1).max(4000),
});
export type AuditResult = z.infer<typeof auditResultSchema>;

const active = (item: Item) => item.status !== "REJECTED" && item.status !== "SUPERSEDED";
const confirmed = (project: Project) => project.items.filter((item) => item.status === "CONFIRMED");
const body = (item: Item) => `${item.statement} ${(item.tags ?? []).join(" ")}`.toLowerCase();
const assurance: Record<DeliveryMode, "BASIC_SELF_CHECK" | "INDEPENDENT_SPEC_REVIEW" | "INDEPENDENT_PRODUCT_AUDIT"> = {
  FAST_VALIDATION: "BASIC_SELF_CHECK", FAST_DEVELOPMENT: "INDEPENDENT_SPEC_REVIEW", PRODUCT_GRADE: "INDEPENDENT_PRODUCT_AUDIT",
};

function finding(category: string, message: string, affectedIds: string[], question: string | null = null): AuditFinding {
  const seed = {category, affected_ids: [...affectedIds].sort(), message};
  return {id: `AUDIT-FINDING-${category.replace(/[^A-Z0-9]+/gi, "-").toUpperCase()}-${fingerprint(seed).slice(0, 10).toUpperCase()}`,
    severity: "BLOCKING", category, message, affected_ids: [...affectedIds].sort(), suggested_question: question};
}

function accountOrPrivate(project: Project): boolean {
  return project.items.filter(active).some((item) => item.type === "permission_rule" ||
    /account|login|sign.?in|private data|tenant|role|permission|账号|登录|私有数据|租户|角色|权限/i.test(body(item)));
}
function hasConfirmed(project: Project, types: Item["type"][], pattern: RegExp): boolean {
  return confirmed(project).some((item) => types.includes(item.type) && pattern.test(body(item)));
}
function linkedAcceptance(project: Project, requirement: Item): Item[] {
  return confirmed(project).filter((item) => item.type === "acceptance_criterion" && item.links?.includes(requirement.id));
}

/**
 * Deterministic M8 audit over a bounded clone only. It intentionally receives no ProjectService,
 * Store or mutation callback. The shell/host isolation layer is still F-3 and is not claimed here;
 * the returned result marks independent review unavailable until that outer boundary is verified.
 */
export class AuditService {
  run(project: Project): AuditResult {
    const before = fingerprint(project);
    const snapshot = structuredClone(project);
    const findings: AuditFinding[] = [];

    const hidden = snapshot.items.filter(active).filter((item) => (item.status === "ASSUMED" || item.status === "INFERRED") &&
      (item.priority === "P0" || item.priority === "P1"));
    if (hidden.length) findings.push(finding("HIDDEN_ASSUMPTION",
      "A material P0/P1 assumption or inference remains non-confirmed and must not be presented as an authoritative product fact.",
      hidden.map((item) => item.id), "Confirm, reject or explicitly keep the material assumption non-authoritative before readiness."));

    const privateScope = accountOrPrivate(snapshot);
    if (privateScope && !hasConfirmed(snapshot, ["permission_rule", "functional_requirement", "decision"], /isolation|own data|tenant|隔离|自己的数据|租户/i)) {
      findings.push(finding("DATA_ISOLATION", "Account/private-data scope exists without a confirmed data-isolation rule.", [],
        "What confirmed rule prevents one user or tenant from accessing another user's private data?"));
    }
    if (privateScope && !hasConfirmed(snapshot, ["functional_requirement", "flow", "decision"], /delete (?:their )?account|close (?:their )?account|account deletion|注销|删除账号|关闭账[号户]|停用账[号户]|禁用账[号户]/i)) {
      findings.push(finding("ACCOUNT_DELETION", "Account-based scope has no confirmed account-deletion behavior.", [],
        "What should happen to the account and owned data when the user deletes or closes the account?"));
    }

    const payment = paymentScope(snapshot, isRiskScopeDeferred(snapshot, "PAYMENT_OR_FINANCIAL"));
    if (payment.conflict && payment.confirmed_current_ids.length) findings.push(finding("PAYMENT_SCOPE_CONFLICT",
      "Confirmed current payment behavior conflicts with a confirmed real-payment exclusion.",
      [...payment.exclusion_ids, ...payment.confirmed_current_ids], "Resolve the conflicting payment scope before readiness."));
    if (payment.confirmed_current_ids.length && !payment.failure_ids.length) {
      findings.push(finding("PAYMENT_FAILURE", "Payment/commercial success behavior exists without confirmed failure behavior.",
        payment.confirmed_current_ids, "What does the user see and what state is preserved when payment fails or is declined?"));
    }

    const smartAi = confirmed(snapshot).filter((item) => item.type === "functional_requirement" &&
      /smart ai|intelligent ai|helpful ai|high[- ]quality ai|智能.?ai|聪明的.?ai/i.test(body(item)));
    for (const requirement of smartAi) if (!linkedAcceptance(snapshot, requirement).length) {
      findings.push(finding("UNTESTABLE_AI_REQUIREMENT", `AI requirement ${requirement.id} has no linked observable acceptance criterion.`,
        [requirement.id], "What observable behavior or failure condition would make this AI requirement testable?"));
    }

    const roleQuestions = snapshot.open_questions.filter((question) => question.status === "BLOCKING" &&
      /role|permission|access|contradict|角色|权限|访问|矛盾/i.test(`${question.question} ${question.reason}`));
    if (roleQuestions.length) findings.push(finding("CONTRADICTORY_ROLES", "A blocking role/permission contradiction remains unresolved.",
      roleQuestions.flatMap((q) => q.affected_ids ?? []), "Resolve the conflicting role or permission rule before readiness."));

    const localConstraints = confirmed(snapshot).filter((item) => /offline|local[- ]only|on[- ]device|离线|仅本地|端侧/i.test(body(item)));
    const blueprint = confirmed(snapshot).filter((item) => item.type === "solution_blueprint" && item.blueprint_detail).at(-1);
    if (localConstraints.length && blueprint?.blueprint_detail &&
      /cloud|managed web|server[- ]side|云端|托管/i.test(`${blueprint.blueprint_detail.deployment_topology} ${blueprint.blueprint_detail.recommended_stack_profile}`) &&
      !/local[- ]first|offline|on[- ]device|本地优先|离线|端侧/i.test(`${blueprint.blueprint_detail.deployment_topology} ${blueprint.blueprint_detail.recommended_stack_profile}`)) {
      findings.push(finding("SOLUTION_CONSTRAINT_MISMATCH", "The approved solution blueprint conflicts with a confirmed offline/local constraint.",
        [blueprint.id, ...localConstraints.map((item) => item.id)], "Revise the blueprint or explicitly revise the confirmed offline/local product constraint."));
    }

    const modelResolution = blueprint?.blueprint_detail?.model_resolution;
    if (modelResolution && Date.parse(modelResolution.resolved_at) < Date.parse(snapshot.updated_at)) {
      findings.push(finding("STALE_MODEL_RECOMMENDATION", "The dated model resolution predates the current Product Model snapshot and requires revalidation before implementation.",
        [blueprint.id], "Revalidate the model recommendation against the current capability, pricing and privacy assumptions."));
    }

    const blockers = snapshot.open_questions.filter((question) => question.status === "BLOCKING");
    if (blockers.length) findings.push(finding("UNRESOLVED_BLOCKER", "A blocking canonical question remains unresolved; display scores cannot override it.",
      blockers.flatMap((q) => q.affected_ids ?? []), "Resolve the blocking question before any READY_FOR_XDEV claim."));

    const ordered = findings.sort((a, b) => a.id.localeCompare(b.id));
    const after = fingerprint(project);
    const mode = snapshot.delivery_policy?.effective_mode ?? null;
    const runSeed = {project_id: snapshot.project_id, model_version: snapshot.model_version, mode, findings: ordered};
    const result: AuditResult = {
      audit_run_id: `AUDIT-${fingerprint(runSeed).slice(0, 16).toUpperCase()}`,
      project_id: snapshot.project_id,
      product_model_version: snapshot.model_version,
      target_mode: mode,
      assurance_level: mode ? assurance[mode] : null,
      deterministic_status: ordered.some((entry) => entry.severity === "BLOCKING") ? "BLOCKING" : "PASS",
      independent_review_status: "UNAVAILABLE",
      isolation_status: "BOUNDED_SNAPSHOT_FALLBACK",
      readiness_eligible: false,
      findings: ordered,
      evaluated_at: snapshot.updated_at,
      state_fingerprint_before: before,
      state_fingerprint_after: after,
      state_unchanged: before === after && canonical(project) === canonical(structuredClone(project)),
      limitation: "M8 deterministic rules ran over a bounded cloned Product Model snapshot with no write-capable service. Effective shell/host isolation and the independent LLM review step are not verified in this environment, so this result cannot by itself satisfy a mode that requires independent review.",
    };
    return auditResultSchema.parse(result);
  }
}
