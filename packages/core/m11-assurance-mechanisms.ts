import { z } from "zod";
import type { DeliveryMode, Project } from "../shared-types/domain.ts";
import { fingerprint } from "./validation.ts";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const projectId = z.string().regex(/^XMI-[A-Z0-9-]+$/);
const assuranceLevel = z.enum(["BASIC_SELF_CHECK", "INDEPENDENT_SPEC_REVIEW", "INDEPENDENT_PRODUCT_AUDIT"]);

export const reviewedEscalationRecordSchema = z.strictObject({
  schema_version: z.literal("M11-F3-ESCALATION/1"),
  project_id: projectId,
  product_model_version: z.number().int().positive(),
  snapshot_sha256: hash,
  required_assurance_level: assuranceLevel,
  trigger: z.enum(["EFFECTIVE_ISOLATION_UNVERIFIED", "INDEPENDENT_REVIEW_UNAVAILABLE"]),
  reviewed_by: z.literal("OWNER"),
  disposition: z.enum(["DEFER_CLOSURE", "PROVIDE_VERIFIED_ISOLATION", "PROVIDE_INDEPENDENT_REVIEW_RUNTIME"]),
  evidence_ref: z.string().min(1).max(500),
  recorded_at: z.iso.datetime(),
  canonical_state_mutated: z.literal(false),
});
export type ReviewedEscalationRecord = z.infer<typeof reviewedEscalationRecordSchema>;

export const independentReviewEvidenceSchema = z.strictObject({
  schema_version: z.literal("M11-INDEPENDENT-REVIEW/1"),
  project_id: projectId,
  product_model_version: z.number().int().positive(),
  snapshot_sha256: hash,
  assurance_level: assuranceLevel,
  reviewer_boundary: z.literal("EXTERNAL_RUNTIME"),
  isolation_verification: z.literal("VERIFIED_EFFECTIVE_ISOLATION"),
  result: z.enum(["PASS", "BLOCKING"]),
  blocking_finding_count: z.number().int().nonnegative(),
  finding_ids: z.array(z.string().min(1).max(100)).max(100),
  evidence_ref: z.string().min(1).max(500),
  reviewed_at: z.iso.datetime(),
  canonical_state_mutated: z.literal(false),
});
export type IndependentReviewEvidence = z.infer<typeof independentReviewEvidenceSchema>;

const hostMutation = z.enum([
  "xmi_project_create",
  "xmi_patch_apply",
  "xmi_item_confirm",
  "xmi_item_reject",
  "xmi_delivery_mode_select",
  "xmi_mode_override_resolve",
  "xmi_mode_override_retract",
  "xmi_export_package",
]);

export const hostFormEvidenceSchema = z.strictObject({
  schema_version: z.literal("M11-HOST-FORM-EVIDENCE/1"),
  operation: hostMutation,
  project_id: projectId,
  product_model_version: z.number().int().positive(),
  change_fingerprint: hash,
  source_ref: z.string().regex(/^mcp-elicitation:[a-f0-9]{64}$/),
  related_request_id: z.string().min(1).max(200),
  response_action: z.literal("accept"),
  approve: z.literal(true),
  observed_at: z.iso.datetime(),
  human_identity_status: z.literal("NOT_ESTABLISHED"),
});
export type HostFormEvidence = z.infer<typeof hostFormEvidenceSchema>;

export type F3FallbackDecision = {
  pathway: "BOUNDED_SNAPSHOT_ADVISORY" | "REVIEWED_ESCALATION_REQUIRED" | "INDEPENDENT_REVIEW_RECORD_REQUIRED";
  independent_review_gate_eligible: false;
  escalation_required: boolean;
  reason: string;
};

const modeRank: Record<DeliveryMode, number> = {FAST_VALIDATION: 0, FAST_DEVELOPMENT: 1, PRODUCT_GRADE: 2};

export function independentReviewRequired(project: Project): boolean {
  const selected = project.delivery_policy?.effective_mode;
  if (!selected) return true;
  if (selected !== "FAST_VALIDATION") return true;
  return project.delivery_policy?.risk_overrides.some((entry) => entry.status === "CONFIRMED" &&
    entry.resolution === "UPGRADE_SCOPE" && modeRank[entry.minimum_mode] > modeRank[selected]) ?? false;
}

export function decideF3Fallback(project: Project, input: {
  effective_isolation_verified: boolean;
  independent_reviewer_available: boolean;
}): F3FallbackDecision {
  if (!independentReviewRequired(project)) {
    return {pathway: "BOUNDED_SNAPSHOT_ADVISORY", independent_review_gate_eligible: false,
      escalation_required: false,
      reason: "A bounded cloned snapshot may provide deterministic advisory findings when independent review is not required; it is never relabelled as independent review."};
  }
  if (!input.effective_isolation_verified || !input.independent_reviewer_available) {
    return {pathway: "REVIEWED_ESCALATION_REQUIRED", independent_review_gate_eligible: false,
      escalation_required: true,
      reason: "A required independent review cannot be satisfied until effective isolation and an independent reviewer are both available; record the exact blocker for Owner review."};
  }
  return {pathway: "INDEPENDENT_REVIEW_RECORD_REQUIRED", independent_review_gate_eligible: false,
    escalation_required: false,
    reason: "Infrastructure availability is not review evidence. A version- and snapshot-bound independent-review record is still required."};
}

const assuranceRank: Record<IndependentReviewEvidence["assurance_level"], number> = {
  BASIC_SELF_CHECK: 0,
  INDEPENDENT_SPEC_REVIEW: 1,
  INDEPENDENT_PRODUCT_AUDIT: 2,
};
const requiredAssurance: Record<DeliveryMode, IndependentReviewEvidence["assurance_level"]> = {
  FAST_VALIDATION: "BASIC_SELF_CHECK",
  FAST_DEVELOPMENT: "INDEPENDENT_SPEC_REVIEW",
  PRODUCT_GRADE: "INDEPENDENT_PRODUCT_AUDIT",
};

export function assessIndependentReviewEvidence(project: Project, value: unknown): {eligible: boolean; reason: string} {
  const parsed = independentReviewEvidenceSchema.safeParse(value);
  if (!parsed.success) return {eligible: false, reason: "INDEPENDENT_REVIEW_RECORD_INVALID"};
  const record = parsed.data;
  if (record.project_id !== project.project_id || record.product_model_version !== project.model_version) {
    return {eligible: false, reason: "INDEPENDENT_REVIEW_PROJECT_VERSION_MISMATCH"};
  }
  if (record.snapshot_sha256 !== fingerprint(project)) {
    return {eligible: false, reason: "INDEPENDENT_REVIEW_SNAPSHOT_MISMATCH"};
  }
  const mode = project.delivery_policy?.effective_mode;
  if (!mode) return {eligible: false, reason: "INDEPENDENT_REVIEW_MODE_NOT_SELECTED"};
  if (assuranceRank[record.assurance_level] < assuranceRank[requiredAssurance[mode]]) {
    return {eligible: false, reason: "INDEPENDENT_REVIEW_ASSURANCE_TOO_LOW"};
  }
  if (record.result !== "PASS" || record.blocking_finding_count !== 0) {
    return {eligible: false, reason: "INDEPENDENT_REVIEW_BLOCKING"};
  }
  return {eligible: true, reason: "INDEPENDENT_REVIEW_RECORD_ELIGIBLE"};
}

export function assessHostFormEvidence(expected: {
  operation: HostFormEvidence["operation"];
  project_id: string;
  product_model_version: number;
  change_fingerprint: string;
}, value: unknown): {protocol_bound: boolean; human_identity_authenticated: false; reason: string} {
  const parsed = hostFormEvidenceSchema.safeParse(value);
  if (!parsed.success) return {protocol_bound: false, human_identity_authenticated: false, reason: "HOST_FORM_EVIDENCE_INVALID"};
  const record = parsed.data;
  if (record.operation !== expected.operation || record.project_id !== expected.project_id ||
      record.product_model_version !== expected.product_model_version || record.change_fingerprint !== expected.change_fingerprint) {
    return {protocol_bound: false, human_identity_authenticated: false, reason: "HOST_FORM_EVIDENCE_BINDING_MISMATCH"};
  }
  if (record.source_ref !== `mcp-elicitation:${record.change_fingerprint}`) {
    return {protocol_bound: false, human_identity_authenticated: false, reason: "HOST_FORM_EVIDENCE_SOURCE_MISMATCH"};
  }
  return {protocol_bound: true, human_identity_authenticated: false, reason: "HOST_FORM_PROTOCOL_EVIDENCE_ACCEPTED_IDENTITY_UNESTABLISHED"};
}
