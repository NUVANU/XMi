import { z } from "zod";
import { candidateSchema, modeSchema, productProfileSchema, sourceSchema } from "../../packages/shared-types/domain.ts";
import { moduleConfirmationSchema } from "../../packages/core/module-confirmation.ts";
import {specReviewStatusSchema, hostSpecReviewStatusSchema} from "../../packages/core/spec-review-service.ts";
import {documentReviewStatusSchema} from "../../packages/core/document-review.ts";
import {deliveryWorkflowSchema} from "../../packages/core/document-delivery.ts";

const id = z.string().regex(/^XMI-[A-Z0-9-]+$/).max(100);
const version = z.number().int().positive();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const boundedSource = sourceSchema.extend({ref: z.string().min(1).max(500)});
const boundedCandidate = candidateSchema.extend({
  id: z.string().min(3).max(100), statement: z.string().min(1).max(8000),
  source_refs: z.array(boundedSource).min(1).max(10),
  links: z.array(z.string().max(100)).max(20).optional(),
  tags: z.array(z.string().max(100)).max(20).optional(),
  supersedes: z.string().max(100).nullable().optional(),
});
// A blueprint can reference all eight feasibility groups (up to 20 IDs each).
// Ordinary candidates retain their existing 20-link boundary.
const candidate = z.discriminatedUnion("type", [
  boundedCandidate.extend({type: candidateSchema.shape.type.exclude(["solution_blueprint"])}),
  boundedCandidate.extend({type: z.literal("solution_blueprint"),
    links: z.array(z.string().max(100)).max(160).optional()}),
]);
const base = {schema_version: z.literal("0.1.0")};
const projectDirectory = z.string().min(1).max(1000);
const project = {...base, project_id: id, project_directory: projectDirectory.optional()};
const mutation = {...project, expected_version: version, idempotency_key: z.string().min(1).max(100)};
const itemAction = {...mutation, item_id: z.string().min(3).max(100), item_version: version, fingerprint: hash};
const page = {offset: z.number().int().min(0).max(100000).optional(), limit: z.number().int().min(1).max(20).optional()};
const interviewModule = z.string().trim().min(1).max(80);
const nativeSession = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i).optional();
const patchInput = z.strictObject({...mutation, patch: z.strictObject({kind: z.literal("ADD_CANDIDATE"), candidate})});
const confirmInput = z.strictObject({...itemAction, intent: z.literal("CONFIRM"),
  selected_option_id: z.string().min(1).max(100).optional(), solution_disposition: z.enum(["APPROVE_BLUEPRINT", "DELEGATE_WITHIN_BLUEPRINT"]).optional()});
const rejectInput = z.strictObject({...itemAction, intent: z.literal("REJECT"), reason: z.string().min(1).max(2000)});
const modeSelectInput = z.strictObject({...mutation, mode: modeSchema,
  reason: z.string().min(1).max(2000), fingerprint: hash, intent: z.literal("SELECT_MODE"), change: z.enum(["SELECT", "UPGRADE"])});
const riskResolveInput = z.strictObject({...mutation, override_id: z.string().regex(/^MODE-OVERRIDE-[A-Z0-9-]+$/).max(100),
  resolution: z.enum(["UPGRADE_SCOPE", "UPGRADE_PROJECT", "STUB_OR_SANDBOX", "DEFER_OR_EXCLUDE"]),
  rationale: z.string().min(1).max(2000), intent: z.literal("RESOLVE_OVERRIDE")});
const riskRetractInput = z.strictObject({...mutation, override_id: z.string().regex(/^MODE-OVERRIDE-[A-Z0-9-]+$/).max(100),
  reason: z.string().min(1).max(2000), intent: z.literal("RETRACT_OVERRIDE")});
export const policyReviewRequest = z.discriminatedUnion("operation", [
  modeSelectInput.extend({operation: z.literal("xmi_delivery_mode_select")}),
  riskResolveInput.extend({operation: z.literal("xmi_mode_override_resolve")}),
  riskRetractInput.extend({operation: z.literal("xmi_mode_override_retract")}),
]);
export const singleReviewRequest = z.discriminatedUnion("operation", [
  patchInput.extend({operation: z.literal("xmi_patch_apply")}),
  confirmInput.extend({operation: z.literal("xmi_item_confirm")}),
  rejectInput.extend({operation: z.literal("xmi_item_reject")}),
  ...policyReviewRequest.options,
]);
export const inputs = {
  xmi_spec_review_start: z.strictObject({...mutation, session_id: nativeSession, interview_module: interviewModule.optional()}),
  xmi_spec_review_status: z.strictObject({...project, run_id: z.string().uuid().optional(), session_id: nativeSession, ...page}),
  xmi_item_review_prepare: z.union([
    z.strictObject({...base, project_directory: projectDirectory.optional(), request: singleReviewRequest, session_id: nativeSession}),
    z.strictObject({...project, expected_version: version, requests: z.array(singleReviewRequest).min(1).max(50), session_id: nativeSession}),
  ]),
  xmi_item_review_status: z.strictObject({...project, session_id: nativeSession}),
  xmi_item_review_commit: z.strictObject({...project, expected_version: version, review_id: z.string().uuid(), session_id: nativeSession}),
  xmi_module_review_prepare: z.strictObject({...project, expected_version: version, interview_module: interviewModule, session_id: nativeSession}),
  xmi_module_review_status: z.strictObject({...project, session_id: nativeSession}),
  xmi_module_review_commit: z.strictObject({...project, expected_version: version, review_id: z.string().uuid(), session_id: nativeSession}),
  xmi_project_create: z.strictObject({...base, project_directory: projectDirectory.optional(), title: z.string().min(1).max(200).optional(),
    initial_idea: z.string().min(1).max(8000), requested_profile: productProfileSchema.exclude(["unsupported"]).optional(),
    source_ref: boundedSource, idempotency_key: z.string().min(1).max(100)}),
  xmi_project_get: z.strictObject({...project, ...page, expected_version: version.optional()}),
  xmi_project_resume: z.strictObject({...project, question_count: z.number().int().min(1).max(8).optional(),
    interview_module: interviewModule.optional()}),
  xmi_document_assess: z.strictObject({...project, expected_version: version,
    file_path: z.string().min(1).max(1000)}),
  xmi_answer_analyze: z.strictObject({...project, expected_version: version,
    answer: z.string().min(1).max(8000), item_id: z.string().min(3).max(100).optional(),
    item_type: candidateSchema.shape.type.optional(), source_ref: boundedSource,
    next_question_count: z.number().int().min(1).max(8).optional(), interview_module: interviewModule.optional()}),
  xmi_patch_apply: patchInput,
  xmi_item_confirm: confirmInput,
  xmi_item_reject: rejectInput,
  xmi_delivery_mode_recommend: z.strictObject({...project,
    intended_outcome: z.enum(["PROTOTYPE", "CONTROLLED_MVP", "PUBLIC_PAID_OR_LONG_TERM"])}),
  xmi_delivery_mode_select: modeSelectInput,
  xmi_delivery_mode_get: z.strictObject({...project, proposal: z.strictObject({
    mode: modeSchema, reason: z.string().min(1).max(2000),
  }).optional()}),
  xmi_mode_risk_evaluate: z.strictObject({...project, expected_version: version}),
  xmi_mode_override_resolve: riskResolveInput,
  xmi_mode_override_retract: riskRetractInput,
  xmi_mode_gap_analyze: z.strictObject({...project, expected_version: version, target_mode: modeSchema}),
  xmi_audit_run: z.strictObject({...project, expected_version: version}),
  xmi_readiness_evaluate: z.strictObject({...project, expected_version: version}),
  xmi_xspec_compile: z.strictObject({...project, expected_version: version}),
  xmi_xspec_validate: z.strictObject({...project, expected_version: version}),
  xmi_export_package: z.strictObject({...mutation, package_name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/),
    overwrite: z.boolean().optional()}),
};
export type ToolName = keyof typeof inputs;
export type Input<N extends ToolName> = z.infer<(typeof inputs)[N]>;
export const errorSchema = z.strictObject({
  code: z.string(), message: z.string(), retryable: z.boolean(),
  details: z.strictObject({current_version: version.optional(), required_milestone: z.enum(["M4", "M5"]).optional()}),
  user_action: z.string(),
});
const receipt = z.strictObject({project_id: id, model_version: version, next_action: z.string()});
const target = z.enum(["PROTOTYPE_READY", "BUILD_READY", "PRODUCT_SPEC_READY"]);
const itemView = z.strictObject({id: z.string(), type: candidateSchema.shape.type,
  statement: z.string().max(400), statement_truncated: z.boolean(),
  status: z.enum(["CONFIRMED", "INFERRED", "PROPOSED", "ASSUMED", "OPEN", "BLOCKING", "REJECTED", "SUPERSEDED"]),
  version, fingerprint: hash,
  source_refs: z.array(z.strictObject({type: sourceSchema.shape.type, ref: z.string().max(160)})).max(3),
  source_refs_truncated: z.boolean(),
});
const view = z.strictObject({
  project_id: id, xspec_id: z.string().nullable(), model_version: version,
  title: z.string(), lifecycle_state: z.string(), effective_mode: modeSchema.nullable(),
  readiness_target: target.nullable(), achieved_readiness: z.null(), readiness_status: z.literal("NOT_EVALUATED"),
  items: z.array(itemView).max(20), total_items: z.number().int().nonnegative(),
  next_offset: z.number().int().nonnegative().nullable(),
  blockers: z.array(z.strictObject({id: z.string(), question: z.string().max(400)})).max(10),
  blockers_truncated: z.boolean(), mode_selection_required: z.boolean(),
});
const modePolicy = z.strictObject({
  requested_mode: modeSchema, effective_mode: modeSchema, readiness_target: target,
  selection_source: z.string(), selected_at: z.string(),
  history: z.array(z.strictObject({from_mode: modeSchema.nullable(), to_mode: modeSchema,
    reason: z.string().max(400), changed_by: z.string(), changed_at: z.string()})).max(10),
  history_truncated: z.boolean(), risk_override_count: z.number().int().nonnegative(),
  risk_override_retracted_count: z.number().int().nonnegative(),
});
const overrideResolution = z.enum(["UPGRADE_SCOPE", "UPGRADE_PROJECT", "STUB_OR_SANDBOX", "DEFER_OR_EXCLUDE"]);
const riskReason = z.enum(["AUTH_OR_PRIVATE_DATA", "PAYMENT_OR_FINANCIAL", "SENSITIVE_DATA", "DESTRUCTIVE_ACTION",
  "ADMIN_ACCESS", "EXTERNAL_SIDE_EFFECT", "REGULATED_OR_HIGH_CONSEQUENCE"]);
const riskFinding = z.strictObject({
  override_id: z.string().regex(/^MODE-OVERRIDE-[A-Z0-9-]+$/), reason_code: riskReason, rationale: z.string(),
  minimum_mode: modeSchema, scope_ids: z.array(z.string()),
  exclusion_requires_split_ids: z.array(z.string()).optional(),
  status: z.enum(["SATISFIED_BY_PROJECT_MODE", "RESOLVED_BY_OVERRIDE", "BLOCKING"]),
  active_resolution: overrideResolution.nullable(),
});
const riskEvaluation = z.strictObject({
  evaluation_status: z.literal("DETERMINISTIC_M5"), requested_mode: modeSchema.nullable(), effective_mode: modeSchema.nullable(),
  minimum_mode: modeSchema, findings: z.array(riskFinding).max(20), unresolved_blocker_count: z.number().int().nonnegative(),
  scope_overrides_export: z.literal("XDEV-DELIVERY-HANDOFF/1"),
});
const feasibilityKey = z.enum(["TARGET_USERS", "CORE_FLOW", "DATA_SENSITIVITY", "LOCAL_CLOUD_REQUIREMENT",
  "SCALE_LATENCY_NEEDS", "INTEGRATION_CONSTRAINTS", "COST_MAINTENANCE_PREFERENCE", "TARGET_PLATFORM"]);
const feasibility = z.strictObject({
  ready: z.boolean(), satisfied_count: z.number().int().min(0).max(8), total_count: z.literal(8),
  inputs: z.array(z.strictObject({key: feasibilityKey, satisfied: z.boolean(), evidence_ids: z.array(z.string()).max(20),
    reason: z.string()})).length(8), fingerprint: hash,
});
const solutionReview = z.strictObject({
  status: z.enum(["BLOCKED_PREREQUISITES", "BLOCKED_RISK", "PROPOSAL_AVAILABLE", "PERSISTED"]),
  feasibility, risk_blocker_ids: z.array(z.string().regex(/^MODE-OVERRIDE-[A-Z0-9-]+$/)).max(20),
  persisted_item_id: z.string().regex(/^BLUEPRINT-[A-Z0-9-]+$/).nullable(), persisted_status: z.string().nullable(),
  proposed_patch: z.strictObject({kind: z.literal("ADD_CANDIDATE"), candidate}).nullable(), limitation: z.string(),
});

const packagePath = z.enum([
  "manifest.json", "xspec.json", "PRODUCT-VISION.md", "TARGET-USERS.md", "USER-JOURNEYS.md",
  "FUNCTIONAL-REQUIREMENTS.md", "NON-FUNCTIONAL-REQUIREMENTS.md", "DATA-AND-PERMISSIONS.md",
  "INTEGRATIONS.md", "TECHNICAL-SOLUTION-BLUEPRINT.md", "ACCEPTANCE-CRITERIA.md", "DECISIONS.md",
  "OUT-OF-SCOPE.md", "OPEN-QUESTIONS.md", "READINESS-REPORT.md", "CHANGELOG.md",
]);
const compiledArtifact = z.strictObject({
  spec_id: z.string().regex(/^XSPEC-[A-Z0-9-]+$/), spec_version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/),
  product_model_version: version, canonical_sha256: hash, generated_at: z.iso.datetime(),
  files: z.array(z.strictObject({path: packagePath, sha256: hash, content: z.string()})).length(16),
});
const validationIssue = z.strictObject({code: z.string(), message: z.string(), user_action: z.string(), path: z.string().optional()});
const scopeOverrideNormalisation = z.strictObject({override_id: z.string(),
  recorded_minimum_mode: modeSchema, exported_minimum_mode: modeSchema});
const consumerResult = z.strictObject({
  consumer: z.enum(["XUI", "XDEV"]), accepted: z.boolean(), errors: z.array(validationIssue),
  handoff_contract_version: z.string().nullable(), project_mode: modeSchema.nullable(),
  mapped_profile: z.enum(["prototype", "quick_verified", "full_governance"]).nullable(),
  owner_selected: z.literal(false), selection_provenance_authenticated: z.literal(false),
  scope_dispositions: z.array(z.strictObject({id: z.string(), scope_ids: z.array(z.string()), minimum_mode: modeSchema,
    mapped_minimum_profile: z.enum(["prototype", "quick_verified", "full_governance"]),
    resolution: overrideResolution, action: z.enum(["ESCALATE_SCOPED_TASKS", "ESCALATE_PROJECT", "NON_LIVE_PATH", "EXCLUDE_SCOPE"]),
    escalates: z.boolean()})),
});
const hardGate = z.strictObject({gate: z.number().int(), name: z.string(), status: z.enum(["PASS", "FAIL", "DEFERRED"]), reason: z.string()});
const readinessEvaluation = z.strictObject({
  target: target.nullable(), qualification: z.null(), readiness_status: z.enum(["NOT_READY_M8", "READY_FOR_XDEV"]), score: z.number(),
  dimensions: z.record(z.string(), z.number()), hard_gates: z.array(hardGate), mode_gates: z.array(hardGate),
  hard_gate_ready: z.boolean(), blockers: z.array(z.unknown()), profile_results: z.array(z.unknown()),
});
const auditFinding = z.strictObject({id: z.string().regex(/^AUDIT-FINDING-[A-Z0-9-]+$/),
  severity: z.enum(["INFO", "WARNING", "BLOCKING"]), category: z.string(), message: z.string(),
  affected_ids: z.array(z.string()).max(50), suggested_question: z.string().nullable()});
const auditResult = z.strictObject({audit_run_id: z.string().regex(/^AUDIT-[A-Z0-9-]+$/), project_id: id,
  product_model_version: version, target_mode: modeSchema.nullable(), assurance_level: z.enum(["BASIC_SELF_CHECK",
    "INDEPENDENT_SPEC_REVIEW", "INDEPENDENT_PRODUCT_AUDIT"]).nullable(), deterministic_status: z.enum(["PASS", "BLOCKING"]),
  independent_review_status: z.literal("UNAVAILABLE"), isolation_status: z.literal("BOUNDED_SNAPSHOT_FALLBACK"),
  readiness_eligible: z.literal(false), findings: z.array(auditFinding), evaluated_at: z.iso.datetime(),
  state_fingerprint_before: hash, state_fingerprint_after: hash, state_unchanged: z.boolean(), limitation: z.string()});
const xspecValidation = z.strictObject({
  valid: z.boolean(), package_valid: z.boolean(), schema_valid: z.boolean(), references_valid: z.boolean(), coverage_valid: z.boolean(),
  integrity_valid: z.boolean(), package_manifest_valid: z.boolean(), errors: z.array(validationIssue),
  scope_override_normalisations: z.array(scopeOverrideNormalisation),
  consumers: z.strictObject({xui: consumerResult, xdev: consumerResult}), readiness_evaluation: readinessEvaluation,
});

const moduleReview = z.strictObject({module: interviewModule,
  available_modules: z.array(interviewModule).max(20), modules_truncated: z.boolean(),
  review_brief: z.strictObject({format: z.literal("MODULE_REVIEW_BRIEF"),
    sections: z.tuple([z.literal("CURRENT_DESIGN"), z.literal("PENDING_DECISIONS_WITH_RECOMMENDATIONS"),
      z.literal("EFFECTS_AND_CONFLICTS"), z.literal("BATCH_REPLY")]),
    decision_limit: z.number().int().min(1).max(8), recommendations_status: z.literal("UNADOPTED"), confirmation_granted: z.literal(false)}),
  pending_decisions: z.array(z.strictObject({id: z.string(), question: z.string().max(400), question_truncated: z.boolean(),
    priority: z.enum(["P0", "P1", "P2", "P3"]), blocking: z.boolean(),
    options: z.array(z.strictObject({id: z.string(), label: z.string().max(400)})).max(8)})).max(8),
  total_pending_decisions: z.number().int().nonnegative(), pending_decisions_truncated: z.boolean(),
  items: z.array(z.strictObject({id: z.string(), type: candidateSchema.shape.type,
    status: z.enum(["INFERRED", "PROPOSED", "ASSUMED", "OPEN", "BLOCKING", "CONFIRMED"]),
    statement: z.string().max(1200), statement_truncated: z.boolean(), item_version: version,
    source_refs: z.array(boundedSource).max(3), sources_truncated: z.boolean(),
    links: z.array(z.string()).max(20), links_truncated: z.boolean(), supersedes: z.string().nullable()})).max(12),
  total_items: z.number().int().nonnegative(), truncated: z.boolean(), confirmation_pending: z.boolean(),
  completion: z.literal("NOT_EVALUATED")});

const successData = {
  xmi_spec_review_start: z.union([specReviewStatusSchema, hostSpecReviewStatusSchema, documentReviewStatusSchema]),
  xmi_spec_review_status: z.union([specReviewStatusSchema, hostSpecReviewStatusSchema, documentReviewStatusSchema]),
  xmi_item_review_prepare: z.strictObject({project_id: id, model_version: version, review_id: z.string().uuid(),
    review_text: z.string(), reply: z.literal("确认好了"), host_ready: z.literal(true), action: z.enum(["PROPOSE", "APPROVE", "DELEGATE", "REJECT", "BATCH"])}),
  xmi_item_review_status: z.strictObject({project_id: id, model_version: version, host_ready: z.boolean(), review_id: z.string().uuid().nullable(),
    status: z.enum(["NONE", "PENDING", "GRANTED", "APPLIED", "INVALIDATED", "FAILED", "STALE"]), applied_version: version.nullable()}),
  xmi_item_review_commit: receipt,
  xmi_project_create: receipt,
  xmi_project_get: view,
  xmi_document_assess: z.strictObject({project_id: id, model_version: version,
    sha256: hash, format: z.enum(["md", "txt", "docx", "pdf"]), sections_scanned: z.number().int().nonnegative(),
    truncated: z.boolean(), candidates: z.array(candidate).max(40),
    review_decisions: z.array(candidate).max(8),
    contradictions: z.array(z.strictObject({id: z.string(), confirmed_item_id: z.string(),
      candidate_statement: z.string(), confirmed_statement: z.string(), reason: z.string(),
      severity: z.literal("BLOCKING")})).max(40),
    ambiguities: z.array(z.strictObject({terms: z.array(z.string()), question: z.string(),
      source_refs: z.array(boundedSource).max(10)})), next_questions: z.array(z.unknown()).max(8), warning: z.string()}),
  xmi_project_resume: z.strictObject({project: view, snapshot_consistent: z.boolean(), delivery_workflow: deliveryWorkflowSchema,
    recent_event_ids: z.array(z.string()).max(10), next_action: z.string(),
    question_selection_status: z.literal("AVAILABLE"),
    resume_packet: z.strictObject({project_id: id, model_version: version, mode: modeSchema.nullable(),
      recent_confirmed: z.array(z.strictObject({id: z.string(), type: candidateSchema.shape.type, statement: z.string()})).max(8),
      blockers: z.array(z.strictObject({id: z.string(), question: z.string()})).max(5),
      next_questions: z.array(z.unknown()).max(8), module_review: moduleReview.nullable(), bounded: z.literal(true)}),
    solution_review: solutionReview}),
  xmi_answer_analyze: z.strictObject({project_id: id, model_version: version,
    analysis_status: z.literal("DETERMINISTIC_M4"),
    structural_conflicts: z.array(z.enum(["DUPLICATE_ITEM_ID"])),
    proposed_patch: z.strictObject({kind: z.literal("ADD_CANDIDATE"), candidate}).nullable(),
    candidate_patches: z.array(z.strictObject({kind: z.literal("ADD_CANDIDATE"), candidate})).max(8),
    contradictions: z.array(z.strictObject({id: z.string(), confirmed_item_id: z.string(),
      candidate_statement: z.string(), confirmed_statement: z.string(), reason: z.string(), severity: z.literal("BLOCKING")})).max(8),
    review_decisions: z.array(candidate).max(8),
    risk_hints: z.array(z.strictObject({reason_code: z.string(), rationale: z.string(), minimum_mode: modeSchema})).max(8),
    next_questions: z.array(z.unknown()).max(3), module_review: moduleReview.nullable(), warning: z.string()}),
  xmi_module_review_prepare: z.strictObject({review: moduleConfirmationSchema, review_text: z.string(), host_ready: z.literal(true)}),
  xmi_module_review_status: z.strictObject({project_id: id, model_version: version, host_ready: z.boolean(),
    review_id: z.string().uuid().nullable(), status: z.enum(["NONE", "PENDING", "GRANTED", "CONFIRMED", "INVALIDATED", "FAILED", "STALE"])}),
  xmi_module_review_commit: z.strictObject({project_id: id, model_version: version, next_action: z.string()}),
  xmi_patch_apply: receipt, xmi_item_confirm: receipt, xmi_item_reject: receipt,
  xmi_delivery_mode_recommend: z.strictObject({project_id: id, model_version: version,
    recommendation: modeSchema, reason: z.string(), limitations: z.array(z.string()),
    confirmed: z.literal(false), risk_evaluation: riskEvaluation}),
  xmi_delivery_mode_select: receipt,
  xmi_delivery_mode_get: z.strictObject({project_id: id, model_version: version, policy: modePolicy.nullable(),
    proposal_fingerprint: hash.nullable(),
    selection_required: z.boolean(), fingerprint_algorithm: z.literal("SHA256_CANONICAL_MODE_REQUEST"),
    risk_evaluation: riskEvaluation}),
  xmi_mode_risk_evaluate: z.strictObject({project_id: id, model_version: version, risk_evaluation: riskEvaluation}),
  xmi_mode_override_resolve: z.strictObject({project_id: id, model_version: version, next_action: z.string(),
    resolved_override_id: z.string().regex(/^MODE-OVERRIDE-[A-Z0-9-]+$/), resolution: overrideResolution,
    risk_evaluation: riskEvaluation}),
  xmi_mode_override_retract: z.strictObject({project_id: id, model_version: version, next_action: z.string(),
    retracted_override_id: z.string().regex(/^MODE-OVERRIDE-[A-Z0-9-]+$/), reason: z.string(),
    risk_evaluation: riskEvaluation}),
  xmi_mode_gap_analyze: z.strictObject({project_id: id, model_version: version, current_mode: modeSchema.nullable(),
    target_mode: modeSchema, requires_upgrade: z.boolean(), missing_stage_ids: z.array(z.string()),
    reusable_confirmed_item_ids: z.array(z.string()).max(50), missing_questions: z.array(z.unknown()).max(3)}),
  xmi_audit_run: z.strictObject({project_id: id, model_version: version, audit: auditResult, delivery_workflow: deliveryWorkflowSchema}),
  xmi_readiness_evaluate: z.strictObject({project_id: id, model_version: version, audit: auditResult, readiness: readinessEvaluation, delivery_workflow: deliveryWorkflowSchema}),
  xmi_xspec_compile: z.strictObject({project_id: id, model_version: version, status: z.literal("CANDIDATE_NOT_READY_M8"),
    artifact: compiledArtifact, scope_override_normalisations: z.array(scopeOverrideNormalisation), delivery_workflow: deliveryWorkflowSchema}),
  xmi_xspec_validate: z.strictObject({project_id: id, model_version: version, validation: xspecValidation, delivery_workflow: deliveryWorkflowSchema}),
  xmi_export_package: z.strictObject({project_id: id, model_version: version, spec_id: z.string().regex(/^XSPEC-[A-Z0-9-]+$/),
    spec_version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/), canonical_sha256: hash, file_count: z.literal(16),
    exported_relative_path: z.string().regex(/^(?:exports|docs\/xspec)\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/), already_present: z.boolean(),
    readiness_status: z.enum(["NOT_READY", "READY_FOR_XDEV"]), delivery_workflow: deliveryWorkflowSchema}),
};
const storageStatus = z.strictObject({project_directory: projectDirectory, database_relative_path: z.literal(".xmi/xmi-state.sqlite"),
  context_status: z.enum(["CURRENT", "STALE"]), canonical_version: version, reason: z.string().max(1000)}).optional();
export const outputs = Object.fromEntries(Object.entries(successData).map(([name, data]) => [
  name, z.discriminatedUnion("ok", [
    z.strictObject({...base, ok: z.literal(true), data, storage: storageStatus}),
    z.strictObject({...base, ok: z.literal(false), error: errorSchema, storage: storageStatus}),
  ]),
])) as unknown as Record<ToolName, z.ZodType>;

export const metadata: Record<ToolName, {title: string; description: string; write: boolean; destructive: boolean}> = {
  xmi_spec_review_start: {title: "Optional document rereview", description: "On explicit Owner request only; never an export prerequisite. Native Codex freezes readable specification documents, or interview_module statements and directly linked settings. Follow host_job to launch one fresh-context Agent; reuse the original key/version/session/module to collect its native result. Return issues, exact supplied quotes, impact, suggestions and missing-material questions; do not enumerate covered IDs/files/scopes. Invalid findings are reported separately while grounded findings survive; extra unresolved references are follow-up hints. No full Product Model is sent to the Agent. Historical strict runs remain readable. Generic hosts without this adapter remain UNAVAILABLE. Advisory only: cannot confirm decisions, grant formal assurance, select providers or approve export.", write: true, destructive: false},
  xmi_spec_review_status: {title: "Read document rereview suggestions", description: "Read-only version-bound document rereview status and paginated suggestions, questions and notes. Never launches an Agent or commits a result; use the original start request to collect once. Native sources and supplied quotations are checked without a coverage ledger. Invalid individual findings do not discard grounded suggestions. Empty findings are not PASS; advisory severity never changes readiness. Historical strict results retain their original contract. Cannot accept reviewer JSON, confirm product changes or approve export.", write: false, destructive: false},
  xmi_item_review_prepare: {title: "Prepare chat confirmation list", description: "For finalization collect known pending settings, selected decisions, blueprints and risk dispositions into one numbered batch via requests (1-50), top-level project_id/expected_version; every row uses the same base version. A mode change must be first; duplicate targets, proposal creation and invalid dependency orders refuse before asking the Owner. Preserve blueprint freshness and risk gates. Use request for a sole remaining or explicitly requested single action. Prepare a complete readable chat list for an item action, PROPOSED blueprint save, delivery-mode selection/upgrade or exact risk resolution/withdrawal. Pass current native hook session_id only as routing. Display the entire review_text in the final chat response; only the genuine next Owner reply confirms the exact displayed operation. Preparation grants no Owner authority and does not change canonical Product Model state. Never use per-item popup forms in native-chat mode.", write: false, destructive: false},
  xmi_item_review_status: {title: "Read single-item native reply receipt", description: "Read the current chat's single-item review metadata with canonical version read-back. GRANTED records a genuine reply but still needs xmi_item_review_commit; APPLIED proves execution. Pass session_id from the genuine current hook as routing only. APPLIED describes the requested operation; saving a proposal does not confirm it. This read cannot approve anything.", write: false, destructive: false},
  xmi_item_review_commit: {title: "Apply a genuinely authorized single-item review", description: "Apply only the exact pending operation already authorized by the genuine native UserPromptSubmit event after complete displayed-list verification. Requires its current review ID, project version and session routing; model arguments cannot supply approval, actor or user text. No additional popup or human reply is requested. Without the private original-event grant, changed state or mismatched binding refuses the write. Read canonical state after success; proposal saving remains unconfirmed.", write: true, destructive: true},
  xmi_module_review_prepare: {title: "Prepare module-end confirmation list", description: "Local Codex only: prepare the next batch of at most 50 ordinary pending items tagged with this module at the exact project version, in canonical item order. Each real reply confirms only the displayed batch; refresh state and prepare another batch if pending items remain. Pass session_id from current native XMi hook context; it is a routing selector, never approval. Display the complete returned review_text; ask the Owner to reply 确认好了 or numbered changes. Does not confirm anything. Requires an actual native hook record for that session; never fall back to repeated item forms.", write: true, destructive: false},
  xmi_module_review_status: {title: "Check native module confirmation receipt", description: "Read module review receipt and canonical version using session_id from current native XMi hook context. The selector grants no Owner authority; missing launch environment does not block a valid explicit route. No approval input accepted. Actual next native user prompt plus displayed-list check remains necessary; refresh canonical state before claiming success.", write: false, destructive: false},
  xmi_module_review_commit: {title: "Commit native module approval", description: "Local Codex only. Commit only a GRANTED module review persisted by the trusted native hook after the actual next Owner reply and complete display validation. Routing and exact review binding are not approval. Never supply approved, actor, prompt or source. The batch is atomic; retry the same binding after a transient failure or missing sidecar receipt without creating another review. Read canonical state after success. No grant, invalidated list, changed scope or wrong binding must fail; never reconstruct a grant from MATCH diagnostics.", write: true, destructive: false},
  xmi_project_create: {title: "Start XMi project", description: "Use to start an idea-to-spec project, not to build an app. Local runtime requires project_directory: use the verified user project root as the default, or ask once if unavailable; never infer MCP cwd. Saves one project-local canonical DB and readable process materials after host form approval. Existing shared projects are not migrated; the idea remains unconfirmed.", write: true, destructive: false},
  xmi_project_get: {title: "Read XMi project", description: "Use to inspect a known project's paginated canonical items and fingerprints. Supply project_directory when opening a moved folder or from a new host; identity must match .xmi/project.json. storage.context_status distinguishes current and stale readable files; Markdown edits are not approval. Not a general conversation or other-project search. Readiness is not evaluated in M2.", write: false, destructive: false},
  xmi_document_assess: {title: "Assess an existing design document", description: "Use only for an Owner-selected local Markdown, TXT, DOCX or PDF file after a trusted host form approves reading that exact path. Returns bounded unconfirmed proposals with source digest and positions. It does not persist the file or any claim.", write: false, destructive: false},
  xmi_project_resume: {title: "Resume XMi project", description: "Use to resume a known project's concrete module review brief: current design, pending decisions with host recommendations, effects/conflicts and one numbered batch reply. Use project_directory plus the original project_id to resume a portable folder on another host; read XMI-START-HERE.md first. Returns bounded saved rows and pending decisions, not a one-detail-at-a-time interview. It never confirms content or evaluates completion.", write: false, destructive: false},
  xmi_answer_analyze: {title: "Analyze an interview answer", description: "Use to extract PROPOSED candidates and flag possible conflicts. With interview_module, returns saved context and a MODULE_REVIEW_BRIEF contract for current design, pending decisions with host recommendations, effects and batch reply. Present the whole module brief after saving, not just the latest answer. It does not persist or confirm.", write: false, destructive: false},
  xmi_patch_apply: {title: "Save an unconfirmed candidate", description: "Use to add one reviewed non-confirmation candidate. A non-blueprint PROPOSED draft sourced only from conversation turns or documents saves without a host form and retains its provenance; inferred, assumed, blueprint and other-source proposals still require Owner review. In local native-chat mode, use xmi_item_review_prepare for blueprint proposal saving instead of this form path. This tool never confirms an item or selects a mode, and cannot perform arbitrary updates, deletion or implementation tasks.", write: true, destructive: false},
  xmi_item_confirm: {title: "Ask Owner to confirm an item", description: "For hosts using form/page review, request explicit Owner confirmation of an exact item/version/fingerprint. In local native-chat mode use xmi_item_review_prepare and the genuine reply grant instead; this endpoint refuses new popup writes. Structured decisions use DECISION_APPROVED; M6 solution blueprints require an explicit APPROVE_BLUEPRINT or DELEGATE_WITHIN_BLUEPRINT disposition and dedicated events. Model text, actor fields and tool approval hints cannot authorize any of them.", write: true, destructive: true},
  xmi_item_reject: {title: "Ask Owner to reject an item", description: "For hosts using form/page review, request rejection of an exact item with rationale. In local native-chat mode use xmi_item_review_prepare and the genuine reply grant instead; no per-item popup. Preserves event history; does not delete the item or export.", write: true, destructive: true},
  xmi_delivery_mode_recommend: {title: "Explain a delivery outcome", description: "Use to map an explicitly stated prototype, controlled MVP or public/paid/long-term outcome to an unconfirmed mode recommendation and show the current deterministic M5 risk floor. It does not select the mode or claim readiness.", write: false, destructive: false},
  xmi_delivery_mode_select: {title: "Ask Owner to select delivery mode", description: "Use for exact canonical mode selection or upgrade with version/fingerprint/reason. In native Codex use xmi_item_review_prepare/commit; generic hosts use bounded readable form consent. Never silently change a mode or claim readiness; M5 risk evaluation may still require scoped treatment.", write: true, destructive: true},
  xmi_delivery_mode_get: {title: "Read delivery mode", description: "Use to inspect the one canonical delivery policy, bounded history and deterministic M5 risk evaluation. It does not claim achieved readiness or consumer compatibility.", write: false, destructive: false},
  xmi_mode_risk_evaluate: {title: "Evaluate delivery-mode risk", description: "Read-only deterministic M5 evaluation of canonical product scope. Returns risk findings, minimum modes and unresolved scoped blockers; it never mutates state or treats absence of a finding as production safety proof.", write: false, destructive: false},
  xmi_mode_override_resolve: {title: "Ask Owner to resolve a mode-risk override", description: "Use only for an exact current risk finding with idempotency. In native Codex use xmi_item_review_prepare/commit; generic hosts use bounded readable form consent. Records an auditable resolution under the frozen XDEV-DELIVERY-HANDOFF/1 carrier; XDev semantic acceptance is Owner-relayed, while runtime support and M10 end-to-end evidence remain outstanding.", write: true, destructive: true},
  xmi_mode_override_retract: {title: "Ask Owner to withdraw a mode-risk override", description: "Use only when an already confirmed override is no longer a correct disposition, with a reason. In native Codex use xmi_item_review_prepare/commit; generic hosts use bounded readable form consent. Withdrawal changes the record's status to RETRACTED, keeps the auditable resolution that was made, and returns the underlying risk to unresolved, so the mode-risk gates fail until the Owner resolves it again. It removes the override from the exported handoff envelope; it does not delete history, change the selected mode, or make the risk itself go away.", write: true, destructive: true},
  xmi_mode_gap_analyze: {title: "Analyze interview mode gaps", description: "Use to compare retained confirmed state with the interview depth needed for a target mode. Returns reusable state and bounded missing questions; it does not change the selected mode or claim readiness.", write: false, destructive: false},
  xmi_audit_run: {title: "Run bounded independent audit", description: "Checks specification quality locally before XSpec delivery; never requires external model setup. Returns delivery_workflow with the actual full-spec document review status separately from formal assurance. Runs M8 deterministic audit rules against a bounded cloned Product Model snapshot. It has no Product Model mutation path and reports the current isolation/independent-review limitation explicitly rather than converting unavailable dependencies into a pass.", write: false, destructive: false},
  xmi_readiness_evaluate: {title: "Evaluate M8 readiness gates", description: "Evaluates display dimensions separately from the hard and mode-specific gates using the current Product Model, XSpec consumer checks and bounded audit result. Also returns delivery_workflow for lightweight document review, revision, validation and export; unavailable formal isolation does not require a new audit platform for candidate delivery. Scores never override blockers and the tool does not mutate Product Model state.", write: false, destructive: false},
  xmi_xspec_compile: {title: "Compile XSpec candidate", description: "Deterministically compiles the canonical Product Model version into the published sixteen-file XSpec package shape. Compilation is derived only: it does not rewrite Product Model facts and remains a candidate until M8 hard gates are satisfied.", write: false, destructive: false},
  xmi_xspec_validate: {title: "Validate XSpec candidate", description: "Runs schema, stable-ID/reference, P0/P1 acceptance coverage, manifest/integrity and XUi/XDev conformance-stub checks. Returns the actual document review and next delivery step. It is read-only and cannot convert compilation into formal readiness.", write: false, destructive: false},
  xmi_export_package: {title: "Export validated XSpec package", description: "Writes the exact validated sixteen-file package under project docs/xspec for project-local storage, or controlled exports for legacy storage after trusted host-form approval. It refuses rather than warns: an unresolved blocking mode-risk, a blocking open question, an unapproved blueprint, a broken reference or an unsupported profile stops the write, while consumer compatibility is only reported. It may replace an existing named package only when overwrite is explicitly requested and approved; M8 reports READY_FOR_XDEV only when every hard and mode gate passes; otherwise the exported package remains NOT_READY.", write: true, destructive: true},
};
