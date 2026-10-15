import { z } from "zod";

export const modeSchema = z.enum(["FAST_VALIDATION", "FAST_DEVELOPMENT", "PRODUCT_GRADE"]);
export type DeliveryMode = z.infer<typeof modeSchema>;
export const productProfileSchema = z.enum(["web-micro-saas-v0", "digital-game-v0", "unsupported"]);
export type ProductProfile = z.infer<typeof productProfileSchema>;
export const sourceSchema = z.strictObject({
  type: z.enum(["conversation_turn", "document", "owner_action", "system_rule", "import"]),
  ref: z.string().min(1),
  excerpt: z.string().max(1000).optional(),
});
export type SourceRef = z.infer<typeof sourceSchema>;

export const decisionImpactSchema = z.strictObject({
  user_experience: z.string().min(1).max(2000),
  cost: z.string().min(1).max(2000),
  complexity: z.string().min(1).max(2000),
  privacy: z.string().min(1).max(2000),
  xdev: z.string().min(1).max(2000),
});
export const decisionOptionSchema = z.strictObject({
  id: z.string().min(1).max(100),
  label: z.string().min(1).max(400),
  impact: decisionImpactSchema,
});
export const decisionDetailSchema = z.strictObject({
  question: z.string().min(1).max(2000),
  why_it_matters: z.string().min(1).max(4000),
  options: z.array(decisionOptionSchema).min(2).max(8),
  recommendation: z.strictObject({
    option_id: z.string().min(1).max(100),
    rationale: z.string().min(1).max(4000),
    confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
  }),
  owner_selection: z.string().min(1).max(100).nullable(),
  linked_requirements: z.array(z.string().min(1).max(100)).max(50),
  linked_flows: z.array(z.string().min(1).max(100)).max(50),
  supersession_history: z.array(z.string().min(1).max(100)).max(50),
});
export type DecisionDetail = z.infer<typeof decisionDetailSchema>;

export const feasibilityKeySchema = z.enum([
  "TARGET_USERS", "CORE_FLOW", "DATA_SENSITIVITY", "LOCAL_CLOUD_REQUIREMENT",
  "SCALE_LATENCY_NEEDS", "INTEGRATION_CONSTRAINTS", "COST_MAINTENANCE_PREFERENCE", "TARGET_PLATFORM",
]);
export type FeasibilityKey = z.infer<typeof feasibilityKeySchema>;

export const feasibilityEvidenceSchema = z.strictObject({
  key: feasibilityKeySchema,
  evidence_ids: z.array(z.string().min(1).max(100)).min(1).max(20),
});

const solutionRating = z.enum(["LOW", "MEDIUM", "HIGH"]);
const solutionFit = z.enum(["WEAK", "MEDIUM", "STRONG"]);
export const solutionOptionSchema = z.strictObject({
  id: z.string().regex(/^SOLUTION-OPTION-[A-Z0-9-]+$/).max(100),
  label: z.string().min(1).max(400),
  summary: z.string().min(1).max(2000),
  evaluation: z.strictObject({
    fit_to_confirmed_requirements: solutionFit,
    implementation_complexity: solutionRating,
    operational_complexity: solutionRating,
    expected_cost: solutionRating,
    privacy_security: solutionFit,
    vendor_lock_in: solutionRating,
    offline_local_requirements: solutionFit,
    xdev_support_maturity: solutionFit,
    owner_maintenance_ability: solutionFit,
    migration_path: z.string().min(1).max(2000),
  }),
  trade_offs: z.array(z.string().min(1).max(2000)).min(1).max(12),
  risks: z.array(z.string().min(1).max(2000)).max(12),
});
export type SolutionOption = z.infer<typeof solutionOptionSchema>;

export const aiCapabilityProfileSchema = z.strictObject({
  id: z.string().regex(/^AI-CAPABILITY-[A-Z0-9-]+$/).max(100),
  modalities: z.array(z.enum(["TEXT", "IMAGE", "AUDIO", "VIDEO"])).min(1).max(4),
  latency: z.string().min(1).max(2000),
  quality_reasoning: z.string().min(1).max(2000),
  tool_use: z.string().min(1).max(2000),
  context_size: z.string().min(1).max(2000),
  privacy_data_residency: z.string().min(1).max(2000),
  cost_envelope: z.string().min(1).max(2000),
  structured_output_reliability: z.string().min(1).max(2000),
  safety_constraints: z.string().min(1).max(2000),
  offline_on_device_need: z.string().min(1).max(2000),
  unresolved_constraints: z.array(z.string().min(1).max(2000)).max(20),
});
export type AICapabilityProfile = z.infer<typeof aiCapabilityProfileSchema>;

export const modelResolutionSchema = z.strictObject({
  id: z.string().regex(/^MODEL-RESOLUTION-[A-Z0-9-]+$/).max(100),
  capability_profile_id: z.string().regex(/^AI-CAPABILITY-[A-Z0-9-]+$/).max(100),
  provider: z.string().min(1).max(200),
  model: z.string().min(1).max(200),
  alternatives: z.array(z.string().min(1).max(200)).max(8),
  resolved_at: z.iso.datetime(),
  source_version: z.string().min(1).max(500),
  capability_match: z.array(z.string().min(1).max(2000)).min(1).max(20),
  pricing_privacy_assumptions: z.array(z.string().min(1).max(2000)).min(1).max(20),
  revalidation_requirement: z.string().min(1).max(2000),
});
export type ModelResolutionRecord = z.infer<typeof modelResolutionSchema>;

export const blueprintDetailSchema = z.strictObject({
  blueprint_id: z.string().regex(/^BLUEPRINT-[A-Z0-9-]+$/).max(100),
  mode: modeSchema,
  feasibility_inputs: z.array(feasibilityEvidenceSchema).length(8),
  feasibility_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  deployment_topology: z.string().min(1).max(4000),
  client_form_factor: z.string().min(1).max(4000),
  backend_need: z.string().min(1).max(4000),
  persistence_data_ownership: z.string().min(1).max(4000),
  authentication_authorization: z.string().min(1).max(4000),
  integration_boundaries: z.string().min(1).max(4000),
  ai_capability_boundary: z.string().min(1).max(4000),
  reliability_privacy_constraints: z.string().min(1).max(4000),
  recommended_stack_profile: z.string().min(1).max(4000),
  alternatives_tradeoffs: z.string().min(1).max(4000),
  xdev_must_preserve: z.array(z.string().min(1).max(2000)).min(1).max(30),
  decisions_delegated_to_xdev: z.array(z.string().min(1).max(2000)).min(1).max(20),
  options: z.array(solutionOptionSchema).min(2).max(6),
  recommendation: z.strictObject({
    option_id: z.string().regex(/^SOLUTION-OPTION-[A-Z0-9-]+$/).max(100),
    why_it_fits: z.string().min(1).max(4000),
    trade_offs: z.array(z.string().min(1).max(2000)).min(1).max(12),
    risks: z.array(z.string().min(1).max(2000)).max(12),
    owner_decision_required: z.boolean(),
    confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
    unresolved_inputs: z.array(z.string().min(1).max(2000)).max(20),
  }),
  production_gaps: z.array(z.string().min(1).max(2000)).min(1).max(20),
  approval_triggers: z.array(z.enum([
    "RECURRING_COST", "PRIVACY_DATA_EXPOSURE", "THIRD_PARTY_LOCK_IN", "PRODUCT_BEHAVIOR",
    "OFFLINE_CAPABILITY", "LEGAL_COMPLIANCE_RISK", "LONG_TERM_MAINTENANCE",
  ])).min(1).max(7),
  owner_disposition: z.enum(["APPROVED", "DELEGATED_TO_XDEV"]).nullable(),
  delegation: z.strictObject({
    delegated_to: z.literal("XDEV"),
    boundaries: z.array(z.string().min(1).max(2000)).min(1).max(20),
  }).nullable(),
  ai_capability_profile: aiCapabilityProfileSchema.nullable(),
  model_resolution: modelResolutionSchema.nullable(),
});
export type BlueprintDetail = z.infer<typeof blueprintDetailSchema>;

export const candidateSchema = z.strictObject({
  id: z.string().min(3),
  type: z.enum(["vision", "actor", "goal", "flow", "functional_requirement",
    "acceptance_criterion", "data_entity", "permission_rule", "integration",
    "non_functional_requirement", "decision", "risk", "exclusion", "constraint", "solution_constraint", "solution_blueprint"]),
  statement: z.string().min(1).max(20000),
  status: z.enum(["INFERRED", "PROPOSED", "ASSUMED", "OPEN", "BLOCKING"]),
  source_refs: z.array(sourceSchema).min(1),
  priority: z.enum(["P0", "P1", "P2", "P3"]).optional(),
  supersedes: z.string().nullable().optional(),
  links: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  decision_detail: decisionDetailSchema.optional(),
  blueprint_detail: blueprintDetailSchema.optional(),
});
export type Candidate = z.infer<typeof candidateSchema>;
export type Item = Omit<Candidate, "status"> & {
  status: Candidate["status"] | "CONFIRMED" | "REJECTED" | "SUPERSEDED";
  version: number; created_at: string; updated_at: string;
  confirmed_by?: string | null; confirmed_at?: string | null;
};
export type RiskOverrideResolution = "UPGRADE_SCOPE" | "UPGRADE_PROJECT" | "STUB_OR_SANDBOX" | "DEFER_OR_EXCLUDE";
export type DeliveryPolicy = {
  requested_mode: DeliveryMode; effective_mode: DeliveryMode;
  readiness_target: "PROTOTYPE_READY" | "BUILD_READY" | "PRODUCT_SPEC_READY";
  selection_source: "OWNER_CONFIRMED" | "IMPORTED_SUITE_POLICY" | "SYSTEM_MIGRATION";
  selected_at: string;
  history: { from_mode: DeliveryMode | null; to_mode: DeliveryMode; reason: string;
    changed_by: "owner" | "suite_policy" | "system_migration"; changed_at: string }[];
  risk_overrides: { id: string; scope_ids: string[]; minimum_mode: DeliveryMode;
    reason_code: string; rationale: string; status: "CONFIRMED" | "RETRACTED"; resolution: string; source_refs: SourceRef[] }[];
};
export type Project = {
  schema_version: "0.2.0"; project_id: string; xspec_id?: string;
  title: string; profile: ProductProfile;
  delivery_policy: DeliveryPolicy | null;
  lifecycle_state: "DRAFT" | "DISCOVERY" | "CLARIFICATION" | "SOLUTION_REVIEW" | "AUDIT" |
    "NOT_READY" | "READY_FOR_XDEV" | "EXPORTED" | "AMENDMENT_REQUIRED" | "ARCHIVED";
  model_version: number; items: Item[];
  open_questions: { id: string; question: string; status: "OPEN" | "BLOCKING" | "RESOLVED" | "REJECTED";
    priority: "P0" | "P1" | "P2" | "P3"; reason: string; affected_ids?: string[] }[];
  current_xspec_version?: string | null;
  created_at?: string; updated_at: string;
};
const ownerConfirmation = z.strictObject({
  intent: z.literal("CONFIRM"),
  source_ref: sourceSchema.extend({ type: z.literal("owner_action") }),
});
const ownerAction = <T extends string>(intent: T) => z.strictObject({
  intent: z.literal(intent),
  source_ref: sourceSchema.extend({ type: z.literal("owner_action") }),
});
export const legacyConfirmationSchema = z.strictObject({
  event_id: z.string().min(1), item_id: z.string().min(3), item_version: z.number().int().positive(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/), actor: z.literal("owner"),
  confirmed_at: z.iso.datetime(), source_ref: sourceSchema.extend({type: z.literal("owner_action")}),
});
const overrideResolution = z.enum(["UPGRADE_SCOPE", "UPGRADE_PROJECT", "STUB_OR_SANDBOX", "DEFER_OR_EXCLUDE"]);
export const commandSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("PROJECT_CREATED"), title: z.string().min(1).max(200),
    idea: z.string().min(1).max(20000), profile: productProfileSchema.optional(), source_ref: sourceSchema }),
  z.strictObject({ kind: z.literal("CANDIDATE_EXTRACTED"), candidate: candidateSchema }),
  z.strictObject({ kind: z.literal("ITEM_CONFIRMED"), item_id: z.string().min(3),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/), owner_action: ownerConfirmation }),
  z.strictObject({ kind: z.literal("ITEM_REJECTED"), item_id: z.string().min(3),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/), owner_action: ownerConfirmation.extend({intent: z.literal("REJECT")}),
    reason: z.string().min(1).max(2000).optional() }),
  z.strictObject({ kind: z.literal("DECISION_APPROVED"), item_id: z.string().min(3),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/), selected_option_id: z.string().min(1).max(100),
    owner_action: ownerAction("APPROVE_DECISION") }),
  z.strictObject({ kind: z.literal("ITEM_SUPERSEDED"), item_id: z.string().min(3), replacement_item_id: z.string().min(3),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/), replacement_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    owner_action: ownerAction("SUPERSEDE") }),
  z.strictObject({ kind: z.enum(["DELIVERY_MODE_SELECTED", "DELIVERY_MODE_UPGRADED"]), mode: modeSchema,
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/), reason: z.string().min(1).max(2000), owner_action: ownerConfirmation }),
  z.strictObject({ kind: z.literal("MODE_OVERRIDE_RESOLVED"), override_id: z.string().regex(/^MODE-OVERRIDE-[A-Z0-9-]+$/),
    risk_revision: z.literal(2).optional(), resolution: overrideResolution, rationale: z.string().min(1).max(2000), owner_action: ownerAction("RESOLVE_OVERRIDE") }),
  // F-9: an override has to stay withdrawable, otherwise a wrongly recorded resolution is permanent.
  // Withdrawal is a state change, never a deletion: the record and its resolution are preserved so
  // that the decision remains auditable and the underlying risk simply becomes unresolved again.
  z.strictObject({ kind: z.literal("MODE_OVERRIDE_RETRACTED"), override_id: z.string().regex(/^MODE-OVERRIDE-[A-Z0-9-]+$/),
    reason: z.string().min(1).max(2000), owner_action: ownerAction("RETRACT_OVERRIDE") }),
  z.strictObject({ kind: z.literal("SOLUTION_BLUEPRINT_APPROVED"), item_id: z.string().regex(/^BLUEPRINT-[A-Z0-9-]+$/),
    risk_revision: z.literal(2).optional(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/), owner_action: ownerAction("APPROVE_BLUEPRINT") }),
  z.strictObject({ kind: z.literal("SOLUTION_BLUEPRINT_DELEGATED"), item_id: z.string().regex(/^BLUEPRINT-[A-Z0-9-]+$/),
    risk_revision: z.literal(2).optional(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/), delegated_to: z.literal("XDEV"),
    boundaries: z.array(z.string().min(1).max(2000)).min(1).max(20), owner_action: ownerAction("DELEGATE_BLUEPRINT") }),
  z.strictObject({ kind: z.literal("SCHEMA_MIGRATED"), legacy_snapshot: z.record(z.string(), z.unknown()),
    confirmation_events: z.array(legacyConfirmationSchema),
    source_ref: sourceSchema.extend({type: z.literal("import")}) }),
]);
export type Command = z.infer<typeof commandSchema>;
export const eventSchema = z.strictObject({
  event_id: z.string().min(1), project_id: z.string().regex(/^XMI-[A-Z0-9-]+$/),
  version: z.number().int().positive(), actor: z.enum(["owner", "agent"]),
  occurred_at: z.iso.datetime(), command: commandSchema,
  previous_hash: z.string(), hash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type DomainEvent = z.infer<typeof eventSchema>;
export type Actor = DomainEvent["actor"];
export type Receipt = { request_hash: string; project_id: string; version: number };
export type Checkpoint = { project_id: string; version: number; kind: "SNAPSHOT" | "PRE_MIGRATION";
  content: unknown; hash: string };
