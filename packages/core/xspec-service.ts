import {createHash} from "node:crypto";
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import type {DeliveryMode, Item, Project} from "../shared-types/domain.ts";
import {CompletenessService, evaluateRisk, invalidRiskOverrides} from "./completeness-service.ts";
import type {M8ReadinessEvidence, ReadinessEvaluation} from "./completeness-service.ts";
import {requireCondition} from "./errors.ts";
import {solutionBlockingInputs} from "./solution-options.ts";
import {canonical, fingerprint, rejectSecrets, schemaValidators} from "./validation.ts";
import {projectPath} from "../storage/project-files.ts";
import {documentDelivery, documentDeliveryMarkdown} from "./document-delivery.ts";
import type {DeliveryWorkflow, DocumentReviewSummary} from "./document-delivery.ts";

export const HANDOFF_CONTRACT_VERSION = "XDEV-DELIVERY-HANDOFF/1";
const HANDOFF_VERSION_VALUE = "1";
const XMI_VERSION = "0.3.0-reference-records";
const UNKNOWN_COMPATIBILITY = "UNDETERMINED_PROPOSAL";

export const XSPEC_PACKAGE_FILES = [
  "manifest.json", "xspec.json", "PRODUCT-VISION.md", "TARGET-USERS.md", "USER-JOURNEYS.md",
  "FUNCTIONAL-REQUIREMENTS.md", "NON-FUNCTIONAL-REQUIREMENTS.md", "DATA-AND-PERMISSIONS.md",
  "INTEGRATIONS.md", "TECHNICAL-SOLUTION-BLUEPRINT.md", "ACCEPTANCE-CRITERIA.md", "DECISIONS.md",
  "OUT-OF-SCOPE.md", "OPEN-QUESTIONS.md", "READINESS-REPORT.md", "CHANGELOG.md",
] as const;
export type XSpecPackagePath = typeof XSPEC_PACKAGE_FILES[number];

export type ValidationIssue = {
  code: string;
  message: string;
  user_action: string;
  path?: string;
};
export type ConsumerImportResult = {
  consumer: "XUI" | "XDEV";
  accepted: boolean;
  errors: ValidationIssue[];
  handoff_contract_version: string | null;
  project_mode: DeliveryMode | null;
  mapped_profile: "prototype" | "quick_verified" | "full_governance" | null;
  owner_selected: false;
  selection_provenance_authenticated: false;
  scope_dispositions: Array<{
    id: string;
    scope_ids: string[];
    minimum_mode: DeliveryMode;
    mapped_minimum_profile: "prototype" | "quick_verified" | "full_governance";
    resolution: "UPGRADE_SCOPE" | "UPGRADE_PROJECT" | "STUB_OR_SANDBOX" | "DEFER_OR_EXCLUDE";
    action: "ESCALATE_SCOPED_TASKS" | "ESCALATE_PROJECT" | "NON_LIVE_PATH" | "EXCLUDE_SCOPE";
    escalates: boolean;
  }>;
};
export type CompiledArtifact = {
  spec_id: string;
  spec_version: string;
  product_model_version: number;
  canonical_sha256: string;
  generated_at: string;
  files: Array<{path: XSpecPackagePath; sha256: string; content: string}>;
};
export type ScopeOverrideNormalisation = {
  override_id: string;
  recorded_minimum_mode: DeliveryMode;
  exported_minimum_mode: DeliveryMode;
};
export type XSpecValidation = {
  valid: boolean;
  package_valid: boolean;
  schema_valid: boolean;
  references_valid: boolean;
  coverage_valid: boolean;
  integrity_valid: boolean;
  package_manifest_valid: boolean;
  errors: ValidationIssue[];
  scope_override_normalisations: ScopeOverrideNormalisation[];
  consumers: {xui: ConsumerImportResult; xdev: ConsumerImportResult};
  readiness_evaluation: ReadinessEvaluation;
};

type JsonObject = Record<string, unknown>;
type ConfirmedView = {
  id: string;
  statement: string;
  status: "CONFIRMED";
  priority?: "P0" | "P1" | "P2" | "P3";
  source_refs: Array<{type: string; ref: string; excerpt?: string}>;
  links: string[];
};

type DeliveryProfile = {
  project_mode: DeliveryMode;
  selection_source: "OWNER_CONFIRMED" | "IMPORTED_SUITE_POLICY";
  readiness_target: "PROTOTYPE_READY" | "BUILD_READY" | "PRODUCT_SPEC_READY";
  scope_overrides: Array<{
    id: string;
    scope_ids: string[];
    minimum_mode: DeliveryMode;
    resolution: "UPGRADE_SCOPE" | "UPGRADE_PROJECT" | "STUB_OR_SANDBOX" | "DEFER_OR_EXCLUDE";
    rationale: string;
  }>;
  handoff_contract_version?: string;
};

export type ReferenceRecord = {
  id: string; kind: "CONFIRMED_CONSTRAINT" | "HISTORICAL"; item_type: Item["type"];
  status: "CONFIRMED" | "REJECTED" | "SUPERSEDED"; item_version: number;
  statement: string; source_refs: Item["source_refs"];
};
function referenceRecords(project: Project): ReferenceRecord[] {
  const linked = new Set(activeConfirmed(project).flatMap(item => item.links ?? []));
  return byId(project.items.filter(item =>
    (item.status === "CONFIRMED" && ["constraint", "solution_constraint"].includes(item.type)) ||
    (linked.has(item.id) && ["REJECTED", "SUPERSEDED"].includes(item.status)))
    .map(item => ({id: item.id, kind: item.status === "CONFIRMED" ? "CONFIRMED_CONSTRAINT" as const : "HISTORICAL" as const,
      item_type: item.type, status: item.status as ReferenceRecord["status"], item_version: item.version,
      statement: item.statement, source_refs: item.source_refs.map(source => ({...source}))})));
}

export type XSpecDocument = JsonObject & {
  schema_version: "0.2.0" | "0.3.0";
  reference_records?: ReferenceRecord[];
  spec_id: string;
  spec_version: string;
  delivery_profile: DeliveryProfile;
  readiness: JsonObject;
  integrity: {canonical_sha256: string};
  generated_at: string;
};

type ConsumerOptions = {
  preserve_scope_override_triples?: boolean;
  supported_handoff_versions?: string[];
  supported_xspec_versions?: string[];
};

const modeRank: Record<DeliveryMode, number> = {FAST_VALIDATION: 0, FAST_DEVELOPMENT: 1, PRODUCT_GRADE: 2};
const xdevProfile: Record<DeliveryMode, "prototype" | "quick_verified" | "full_governance"> = {
  FAST_VALIDATION: "prototype", FAST_DEVELOPMENT: "quick_verified", PRODUCT_GRADE: "full_governance",
};
const assurance: Record<DeliveryMode, "BASIC_SELF_CHECK" | "INDEPENDENT_SPEC_REVIEW" | "INDEPENDENT_PRODUCT_AUDIT"> = {
  FAST_VALIDATION: "BASIC_SELF_CHECK", FAST_DEVELOPMENT: "INDEPENDENT_SPEC_REVIEW", PRODUCT_GRADE: "INDEPENDENT_PRODUCT_AUDIT",
};
const gateIds: Record<number, string> = {
  1: "RG-PROFILE", 2: "RG-BLOCKERS", 3: "RG-CONTRADICTION", 4: "RG-CORE-FRAMING", 5: "RG-CORE-JOURNEY",
  6: "RG-REQUIREMENTS", 7: "RG-AC", 8: "RG-ROLE-DATA", 9: "RG-RISK", 10: "RG-INTEGRATION",
  11: "RG-SOLUTION", 12: "RG-SCHEMA", 13: "RG-AUDIT", 14: "RG-CONSUMER", 15: "RG-EXPORT",
  101: "RG-MODE-PROFILE", 102: "RG-MODE-RISK", 103: "RG-SPEC-REVIEW", 104: "RG-PRODUCT-AUDIT-EVIDENCE",
};
const commonReadinessGateIds = Array.from({length: 15}, (_, index) => gateIds[index + 1]!);
function expectedReadinessGateIds(mode: DeliveryMode): string[] {
  const ids = [...commonReadinessGateIds, gateIds[101]!, gateIds[102]!];
  if (mode !== "FAST_VALIDATION") ids.push(gateIds[103]!);
  if (mode === "PRODUCT_GRADE") ids.push(gateIds[104]!);
  return ids;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
function pretty(value: unknown): string {
  return JSON.stringify(JSON.parse(canonical(value)) as unknown, null, 2) + "\n";
}
function activeConfirmed(project: Project, type?: Item["type"]): Item[] {
  return project.items.filter((item) => item.status === "CONFIRMED" && (!type || item.type === type));
}
function simple(item: Item): ConfirmedView {
  const base: ConfirmedView = {id: item.id, statement: item.statement, status: "CONFIRMED",
    source_refs: item.source_refs.map((source) => ({...source})), links: [...(item.links ?? [])]};
  if (item.priority) base.priority = item.priority;
  return base;
}
function byId<T extends {id: string}>(values: T[]): T[] { return [...values].sort((a, b) => a.id.localeCompare(b.id)); }
function specVersion(project: Project): string { return `0.3.${project.model_version}`; }
function specId(project: Project): string {
  const value = project.xspec_id ?? `XSPEC-${project.project_id.replace(/^XMI-/, "")}`;
  requireCondition(/^XSPEC-[A-Z0-9-]+$/.test(value), "XSPEC_ID_INVALID");
  return value;
}
function issue(code: string, message: string, user_action: string, path?: string): ValidationIssue {
  return {...(path ? {path} : {}), code, message, user_action};
}
function canonicalXSpecHash(value: XSpecDocument): string {
  const copy: JsonObject = {...value};
  delete copy.integrity;
  return fingerprint(copy);
}
function mapReadiness(evaluation: ReadinessEvaluation, mode: DeliveryMode, evidence: M8ReadinessEvidence): JsonObject {
  const gates = [...evaluation.hard_gates, ...evaluation.mode_gates].map((gate) => ({
    id: gateIds[gate.gate] ?? `RG-${gate.gate}`,
    passed: gate.status === "PASS",
    details: gate.status === "DEFERRED" ? `DEFERRED: ${gate.reason}` : gate.reason,
  }));
  return {
    status: evaluation.hard_gate_ready ? "READY_FOR_XDEV" : "NOT_READY",
    hard_gates: gates,
    blocking_count: evaluation.blockers.length,
    audit_run_id: evidence.audit.audit_run_id,
    owner_confirmed_export: evidence.owner_confirmed_export,
    dimensions: evaluation.dimensions,
    target_mode: mode,
    target_level: evaluation.target,
    achieved_level: evaluation.hard_gate_ready ? evaluation.target : null,
    assurance_level: assurance[mode],
    mode_gap_count: 0,
  };
}

// F-8 projection rule. A scope-override floor can end up below the project mode even though it was
// legal when recorded, because DELIVERY_MODE_UPGRADED preserves risk_overrides. The frozen contract
// (ADR-006 R-3) declares such a floor invalid and conforming consumers reject it, so the export
// projection reports the floor that actually applies: max(recorded, project mode). The Product Model
// keeps the historical value; nothing here is allowed to happen silently, which is why every
// normalisation is reported through scopeOverrideNormalisations below.
function exportedFloor(minimum: DeliveryMode, projectMode: DeliveryMode): DeliveryMode {
  return modeRank[minimum] < modeRank[projectMode] ? projectMode : minimum;
}
export function scopeOverrideNormalisations(project: Project): ScopeOverrideNormalisation[] {
  const policy = project.delivery_policy;
  if (!policy) return [];
  return policy.risk_overrides.filter((entry) => entry.status === "CONFIRMED")
    .filter((entry) => modeRank[entry.minimum_mode] < modeRank[policy.effective_mode])
    .map((entry) => ({override_id: entry.id, recorded_minimum_mode: entry.minimum_mode,
      exported_minimum_mode: policy.effective_mode}))
    .sort((a, b) => a.override_id.localeCompare(b.override_id));
}
function deliveryProfile(project: Project): DeliveryProfile {
  const policy = project.delivery_policy;
  requireCondition(policy, "MODE_SELECTION_REQUIRED");
  requireCondition(policy.selection_source !== "SYSTEM_MIGRATION", "XSPEC_SELECTION_SOURCE_UNSUPPORTED");
  const allowed = new Set(["UPGRADE_SCOPE", "UPGRADE_PROJECT", "STUB_OR_SANDBOX", "DEFER_OR_EXCLUDE"]);
  const overrides = policy.risk_overrides.filter((entry) => entry.status === "CONFIRMED").map((entry) => {
    requireCondition(allowed.has(entry.resolution), "XSPEC_SCOPE_OVERRIDE_UNRESOLVED");
    return {id: entry.id, scope_ids: [...entry.scope_ids],
      minimum_mode: exportedFloor(entry.minimum_mode, policy.effective_mode),
      resolution: entry.resolution as "UPGRADE_SCOPE" | "UPGRADE_PROJECT" | "STUB_OR_SANDBOX" | "DEFER_OR_EXCLUDE",
      rationale: entry.rationale};
  }).sort((a, b) => a.id.localeCompare(b.id));
  return {project_mode: policy.effective_mode, selection_source: policy.selection_source,
    readiness_target: policy.readiness_target, scope_overrides: overrides, handoff_contract_version: HANDOFF_VERSION_VALUE};
}

function compileDocument(project: Project, evidence: M8ReadinessEvidence): XSpecDocument {
  const policy = project.delivery_policy;
  requireCondition(policy, "MODE_SELECTION_REQUIRED");
  const vision = activeConfirmed(project, "vision")[0];
  requireCondition(vision, "XSPEC_VISION_REQUIRED");
  const blueprint = activeConfirmed(project, "solution_blueprint").at(-1);
  requireCondition(blueprint?.blueprint_detail, "XSPEC_BLUEPRINT_REQUIRED");
  requireCondition(blueprint.blueprint_detail.owner_disposition !== null, "XSPEC_BLUEPRINT_NOT_APPROVED");

  const actors = byId(activeConfirmed(project, "actor").map(simple));
  const actorIds = new Set(actors.map((item) => item.id));
  const requirements = byId(activeConfirmed(project, "functional_requirement").map((item) => ({...simple(item),
    acceptance_criterion_ids: activeConfirmed(project, "acceptance_criterion")
      .filter((ac) => ac.links?.includes(item.id)).map((ac) => ac.id).sort(),
  })));
  const reqIds = new Set(requirements.map((item) => item.id));
  const acceptance = byId(activeConfirmed(project, "acceptance_criterion").map((item) => ({...simple(item),
    requirement_ids: (item.links ?? []).filter((link) => reqIds.has(link)).sort(),
    testability: item.tags?.includes("manual") ? "MANUAL" : item.tags?.includes("automated") ? "AUTOMATED" : "MIXED",
  })));
  const flows = byId(activeConfirmed(project, "flow").map((item) => ({...simple(item),
    actor_ids: (item.links ?? []).filter((link) => actorIds.has(link)).sort(),
    steps: [item.statement],
    failure_paths: project.items.filter((other) => other.status === "CONFIRMED" && other.links?.includes(item.id) &&
      /fail|error|timeout|denied|invalid|失败|错误|超时|拒绝|无效/i.test(other.statement)).map((other) => other.statement).sort(),
  })));
  const decisions = byId(activeConfirmed(project, "decision").map((item) => {
    requireCondition(item.decision_detail?.owner_selection, "XSPEC_DECISION_SELECTION_REQUIRED");
    const selected = item.decision_detail.options.find((option) => option.id === item.decision_detail?.owner_selection);
    requireCondition(selected, "XSPEC_DECISION_SELECTION_REQUIRED");
    return {...simple(item), selected_option: selected.label,
      alternatives: item.decision_detail.options.filter((option) => option.id !== selected.id).map((option) => option.label)};
  }));
  const detail = blueprint.blueprint_detail;
  requireCondition(solutionBlockingInputs(project).length === 0, "SOLUTION_INPUTS_UNRESOLVED");
  requireCondition(detail.owner_disposition !== "DELEGATED_TO_XDEV" || detail.delegation, "SOLUTION_DELEGATION_REQUIRED");
  const recommended = detail.options.find((option) => option.id === detail.recommendation.option_id);
  requireCondition(recommended, "XSPEC_SOLUTION_RECOMMENDATION_INVALID");
  const completeness = new CompletenessService().evaluate(project, [], evidence);
  const confirmed = activeConfirmed(project);
  const references = referenceRecords(project);
  const sourceRefs = new Set([...confirmed, ...references].flatMap((item) => item.source_refs.map((source) => `${source.type}:${source.ref}`)));

  const xspec = {
    schema_version: "0.3.0" as const,
    spec_id: specId(project),
    spec_version: specVersion(project),
    project: {project_id: project.project_id, name: project.title, summary: vision.statement},
    profile: {id: project.profile, version: "0.2.0", supported: project.profile === "web-micro-saas-v0" || project.profile === "digital-game-v0"},
    delivery_profile: deliveryProfile(project),
    product_vision: simple(vision),
    actors,
    goals: byId(activeConfirmed(project, "goal").map(simple)),
    out_of_scope: byId(activeConfirmed(project, "exclusion").map(simple)),
    user_flows: flows,
    requirements,
    acceptance_criteria: acceptance,
    data_entities: byId(activeConfirmed(project, "data_entity").map(simple)),
    permission_rules: byId(activeConfirmed(project, "permission_rule").map(simple)),
    integrations: byId(activeConfirmed(project, "integration").map(simple)),
    non_functional_requirements: byId(activeConfirmed(project, "non_functional_requirement").map(simple)),
    decisions,
    risks: byId(activeConfirmed(project, "risk").map(simple)),
    reference_records: references,
    solution_blueprint: {
      status: detail.owner_disposition === "DELEGATED_TO_XDEV" ? "DELEGATED_TO_XDEV" : "CONFIRMED",
      recommended_option: `${recommended.label}: ${detail.recommended_stack_profile}`,
      constraints: [...detail.xdev_must_preserve, `选型依据：${detail.recommendation.why_it_fits}`,
        ...detail.recommendation.unresolved_inputs.map((input) => `选型待核查：${input}`),
        ...detail.recommendation.trade_offs.map((value) => `选型代价：${value}`),
        ...detail.recommendation.risks.map((value) => `选型风险：${value}`)],
      alternatives: detail.options.filter((option) => option.id !== recommended.id).map((option) => `${option.label}: ${option.summary} ${option.trade_offs.join(" ")} ${option.risks.join(" ")}`),
      delegated_to_xdev: [...(detail.owner_disposition === "DELEGATED_TO_XDEV"
        ? detail.delegation!.boundaries : detail.decisions_delegated_to_xdev)],
      model_capability_profile: detail.ai_capability_profile,
    },
    open_questions: project.open_questions.filter((q) => q.status === "OPEN" || q.status === "BLOCKING")
      .map((q) => ({id: q.id, question: q.question, status: q.status, priority: q.priority, reason: q.reason,
        affected_ids: q.affected_ids ?? []})).sort((a, b) => a.id.localeCompare(b.id)),
    readiness: mapReadiness(completeness, policy.effective_mode, evidence),
    provenance_summary: {confirmed_count: confirmed.length, source_ref_count: sourceRefs.size},
    integrity: {canonical_sha256: "0".repeat(64)},
    generated_at: project.updated_at,
  } as XSpecDocument;
  xspec.integrity.canonical_sha256 = canonicalXSpecHash(xspec);
  return xspec;
}

function listMarkdown(title: string, rows: Array<{id: string; statement: string}>): string {
  return `# ${title}\n\n${rows.length ? rows.map((row) => `- **${row.id}** — ${row.statement}`).join("\n") : "_None._"}\n`;
}
function markdownFiles(xspec: XSpecDocument): Record<Exclude<XSpecPackagePath, "manifest.json" | "xspec.json">, string> {
  const get = (key: string) => (xspec[key] as Array<{id: string; statement: string}> | undefined) ?? [];
  const blueprint = xspec.solution_blueprint as {status: string; recommended_option: string; constraints: string[]; alternatives?: string[]; delegated_to_xdev: string[]};
  const readiness = xspec.readiness as {status: string; hard_gates: Array<{id: string; passed: boolean; details?: string}>; target_mode: string; target_level: unknown; achieved_level: unknown};
  const questions = (xspec.open_questions as Array<{id: string; question: string; status: string}> | undefined) ?? [];
  const references = xspec.reference_records ?? [];
  const constraintView = listMarkdown("Confirmed Constraints", references.filter(record => record.kind === "CONFIRMED_CONSTRAINT"));
  const historyView = listMarkdown("Referenced History (not current requirements)", references.filter(record => record.kind === "HISTORICAL")
    .map(record => ({id: record.id + " [" + record.status + "] v" + record.item_version, statement: record.statement})));
  return {
    "PRODUCT-VISION.md": listMarkdown("Product Vision", [xspec.product_vision as {id: string; statement: string}]),
    "TARGET-USERS.md": listMarkdown("Target Users", get("actors")),
    "USER-JOURNEYS.md": listMarkdown("User Journeys", get("user_flows")),
    "FUNCTIONAL-REQUIREMENTS.md": listMarkdown("Functional Requirements", get("requirements")),
    "NON-FUNCTIONAL-REQUIREMENTS.md": listMarkdown("Non-Functional Requirements", get("non_functional_requirements")),
    "DATA-AND-PERMISSIONS.md": `# Data and Permissions\n\n## Data Entities\n\n${listMarkdown("", get("data_entities")).replace(/^# \n\n/, "")}\n## Permission Rules\n\n${listMarkdown("", get("permission_rules")).replace(/^# \n\n/, "")}`,
    "INTEGRATIONS.md": listMarkdown("Integrations", get("integrations")),
    "TECHNICAL-SOLUTION-BLUEPRINT.md": `# Technical Solution Blueprint\n\n- Status: **${blueprint.status}**\n- Recommended option: ${blueprint.recommended_option}\n\n## Constraints\n${blueprint.constraints.map((v) => `- ${v}`).join("\n") || "- None"}\n\n## Alternatives\n${(blueprint.alternatives ?? []).map((v) => `- ${v}`).join("\n") || "- None"}\n\n## Delegated to XDev\n${blueprint.delegated_to_xdev.map((v) => `- ${v}`).join("\n") || "- None"}\n\n${constraintView}`,
    "ACCEPTANCE-CRITERIA.md": listMarkdown("Acceptance Criteria", get("acceptance_criteria")),
    "DECISIONS.md": listMarkdown("Decisions", get("decisions")),
    "OUT-OF-SCOPE.md": listMarkdown("Out of Scope", get("out_of_scope")),
    "OPEN-QUESTIONS.md": `# Open Questions\n\n${questions.length ? questions.map((q) => `- **${q.id}** [${q.status}] — ${q.question}`).join("\n") : "_None._"}\n`,
    "READINESS-REPORT.md": `# Readiness Report\n\n> This view renders the embedded \`xspec.readiness\` object. It is not an instance of \`schemas/readiness-report.schema.json\`.\n\n- Status: **${readiness.status}**\n- Target mode: ${readiness.target_mode}\n- Target level: ${String(readiness.target_level)}\n- Achieved level: ${String(readiness.achieved_level)}\n\n## Hard gates\n${readiness.hard_gates.map((g) => `- ${g.passed ? "PASS" : "NOT PASS"} **${g.id}** — ${g.details ?? ""}`).join("\n")}\n`,
    "CHANGELOG.md": `# Changelog\n\n- XSpec ${xspec.spec_version as string} from Product Model version ${(xspec.project as {project_id: string}).project_id}/${String((xspec.provenance_summary as {confirmed_count: number}).confirmed_count)} confirmed records.\n- Generated deterministically at the Product Model timestamp ${xspec.generated_at as string}.\n- Prior exported artifacts are not mutated by compilation.\n\n${historyView}`,
  };
}

function requirementsMissingAcceptance(xspec: XSpecDocument): Array<{id: string; acceptance_criterion_ids: string[]}> {
  const requirements = (xspec.requirements as Array<{id: string; acceptance_criterion_ids?: string[]}> | undefined) ?? [];
  return requirements.filter((requirement) => !requirement.acceptance_criterion_ids?.length)
    .map((requirement) => ({id: requirement.id, acceptance_criterion_ids: []}));
}
function schemaFailureIsOnlyMissingAcceptance(xspec: XSpecDocument): boolean {
  const missing = requirementsMissingAcceptance(xspec);
  if (!missing.length) return false;
  const probe = structuredClone(xspec);
  const requirements = (probe.requirements as Array<{id: string; acceptance_criterion_ids?: string[]}> | undefined) ?? [];
  for (const requirement of requirements) if (!requirement.acceptance_criterion_ids?.length) {
    requirement.acceptance_criterion_ids = ["AC-M8-SCHEMA-PROBE"];
  }
  return !!schemaValidators.xspec!(probe);
}

function buildArtifact(project: Project, evidence: M8ReadinessEvidence, delivery?: DeliveryWorkflow): CompiledArtifact {
  const xspec = compileDocument(project, evidence);
  rejectSecrets(xspec);
  const schemaValid = !!schemaValidators.xspec!(xspec);
  // F-11: keep the published schema strict and keep every confirmed requirement in the candidate.
  // The one known incomplete state (a confirmed requirement with no AC yet) is allowed to compile
  // into a candidate so validate() can return a dedicated, actionable issue instead of crashing all
  // compile/validate/export tool paths. Any other schema defect still fails compilation immediately.
  requireCondition(schemaValid || schemaFailureIsOnlyMissingAcceptance(xspec), "XSPEC_SCHEMA_INVALID");
  const files = new Map<XSpecPackagePath, string>();
  files.set("xspec.json", pretty(xspec));
  for (const [path, content] of Object.entries(markdownFiles(xspec)) as Array<[Exclude<XSpecPackagePath, "manifest.json" | "xspec.json">, string]>) {
    files.set(path, content.endsWith("\n") ? content : content + "\n");
  }
  if (delivery) {
    requireCondition(delivery.document_review.project_id === project.project_id &&
      delivery.document_review.current_model_version === project.model_version, "DOCUMENT_REVIEW_VERSION_MISMATCH");
    files.set("READINESS-REPORT.md", files.get("READINESS-REPORT.md")! + documentDeliveryMarkdown(delivery));
  }
  const payloadHashes = Object.fromEntries([...files.entries()].map(([path, content]) => [path, sha256(content)]));
  const manifest = {
    package_version: "0.3.0",
    xspec_schema_version: "0.3.0",
    spec_id: xspec.spec_id,
    spec_version: xspec.spec_version,
    project_id: project.project_id,
    product_model_version: project.model_version,
    generated_at: xspec.generated_at,
    xmi_version: XMI_VERSION,
    xdev_min_version: UNKNOWN_COMPATIBILITY,
    xui_min_version: UNKNOWN_COMPATIBILITY,
    canonical_xspec_sha256: xspec.integrity.canonical_sha256,
    files: [...XSPEC_PACKAGE_FILES],
    file_sha256: payloadHashes,
    manifest_self_hash_policy: "MANIFEST_NOT_SELF_HASHED_TO_AVOID_RECURSION",
    compatibility_note: "XDev/XUi real minimum versions are not yet established; M7 provides conformance stubs only.",
  };
  files.set("manifest.json", pretty(manifest));
  const ordered = XSPEC_PACKAGE_FILES.map((path) => ({path, content: files.get(path)!, sha256: sha256(files.get(path)!)}));
  requireCondition(ordered.every((file) => typeof file.content === "string"), "XSPEC_PACKAGE_INCOMPLETE");
  return {spec_id: xspec.spec_id, spec_version: xspec.spec_version, product_model_version: project.model_version,
    canonical_sha256: xspec.integrity.canonical_sha256, generated_at: xspec.generated_at, files: ordered};
}

function parseXSpec(artifact: CompiledArtifact): XSpecDocument | null {
  try {
    const content = artifact.files.find((file) => file.path === "xspec.json")?.content;
    return content ? JSON.parse(content) as XSpecDocument : null;
  } catch { return null; }
}

function validateReferences(xspec: XSpecDocument): ValidationIssue[] {
  const collections = ["product_vision", "actors", "goals", "out_of_scope", "user_flows", "requirements", "acceptance_criteria",
    "data_entities", "permission_rules", "integrations", "non_functional_requirements", "decisions", "risks"];
  const all: Array<Record<string, unknown>> = [];
  for (const key of collections) {
    const value = xspec[key];
    if (Array.isArray(value)) all.push(...value.filter((row): row is Record<string, unknown> => !!row && typeof row === "object"));
    else if (value && typeof value === "object") all.push(value as Record<string, unknown>);
  }
  const records = xspec.schema_version === "0.3.0" && Array.isArray(xspec.reference_records)
    ? xspec.reference_records.filter((record): record is ReferenceRecord => !!record && typeof record === "object") : [];
  const ids = [...all, ...records].map((row) => row.id).filter((id): id is string => typeof id === "string");
  const idSet = new Set(ids);
  const errors: ValidationIssue[] = [];
  if (idSet.size !== ids.length) errors.push(issue("XSPEC_DUPLICATE_ID", "Stable IDs must be unique across the canonical XSpec.",
    "Rename the duplicate canonical record before compiling again."));
  const refFields = ["links", "actor_ids", "acceptance_criterion_ids", "requirement_ids"];
  for (const row of all) for (const field of refFields) {
    const refs = row[field];
    if (!Array.isArray(refs)) continue;
    const typedCollection = ({actor_ids: "actors", acceptance_criterion_ids: "acceptance_criteria", requirement_ids: "requirements"} as Record<string, string>)[field];
    const typedIds = typedCollection ? new Set(((xspec[typedCollection] as Array<{id: string}>) ?? []).map(item => item.id)) : null;
    for (const ref of refs) {
      if (typeof ref !== "string") continue;
      if (!idSet.has(ref)) errors.push(issue("XSPEC_REFERENCE_NOT_FOUND",
        `Reference ${ref} does not resolve to a canonical XSpec ID.`, "Confirm or correct the referenced item before export.", `${String(row.id)}.${field}`));
      else if (typedIds && !typedIds.has(ref)) errors.push(issue("XSPEC_REFERENCE_TYPE_INVALID",
        `Reference ${ref} is not a current ${typedCollection} item.`, "Use a current confirmed item of the required type; history cannot supply execution or acceptance coverage.", `${String(row.id)}.${field}`));
    }
  }
  const profile = xspec.delivery_profile;
  const scopeIds = new Set([...all.map(row => row.id), ...records.filter(record => record.kind === "CONFIRMED_CONSTRAINT" && record.status === "CONFIRMED").map(record => record.id)]);
  for (const override of profile.scope_overrides) for (const ref of override.scope_ids) if (!scopeIds.has(ref)) {
    errors.push(issue("XSPEC_SCOPE_REFERENCE_NOT_FOUND", `Scope override ${override.id} references missing scope ${ref}.`,
      "Resolve every scope override to an exported requirement/flow/item ID before handoff.", `delivery_profile.scope_overrides.${override.id}`));
  }
  return errors;
}

function validateCoverage(xspec: XSpecDocument): ValidationIssue[] {
  const reqs = (xspec.requirements as Array<{id: string; priority?: string; acceptance_criterion_ids: string[]}> | undefined) ?? [];
  const acs = new Set(((xspec.acceptance_criteria as Array<{id: string}> | undefined) ?? []).map((ac) => ac.id));
  return reqs.filter((req) => req.priority === "P0" || req.priority === "P1").flatMap((req) => {
    const valid = req.acceptance_criterion_ids.some((id) => acs.has(id));
    return valid ? [] : [issue("XSPEC_AC_COVERAGE_REQUIRED", `Requirement ${req.id} has no valid exported acceptance criterion.`,
      "Add and confirm at least one observable acceptance criterion linked to this P0/P1 requirement.", req.id)];
  });
}

export function importForConsumer(xspec: XSpecDocument, consumer: "XUI" | "XDEV", options: ConsumerOptions = {}): ConsumerImportResult {
  const errors: ValidationIssue[] = [];
  if (!(options.supported_xspec_versions ?? ["0.2.0", "0.3.0"]).includes(xspec.schema_version)) {
    errors.push(issue("XSPEC_SCHEMA_VERSION_UNSUPPORTED", "The consumer does not support this XSpec schema version.",
      "Use a consumer with explicit support for the declared XSpec version; do not relabel the package."));
  }
  if (!schemaValidators.xspec!(xspec)) errors.push(issue("XSPEC_SCHEMA_INVALID", "The declared XSpec format is invalid.",
    "Reject the package and correct its schema; do not promote historical records to authority."));
  else errors.push(...validateReferences(xspec), ...validateCoverage(xspec));

  const profile = xspec.delivery_profile;
  if (!profile) errors.push(issue("DELIVERY_PROFILE_REQUIRED", "The XSpec has no delivery_profile.",
    "Recompile from a project with a canonical selected delivery mode."));
  const contractVersion = profile?.handoff_contract_version ?? HANDOFF_VERSION_VALUE;
  const supported = options.supported_handoff_versions ?? [HANDOFF_VERSION_VALUE];
  if (!supported.includes(contractVersion)) errors.push(issue("HANDOFF_CONTRACT_UNSUPPORTED",
    `Handoff contract version ${contractVersion} is not supported by this consumer.`,
    `Use a consumer that explicitly supports ${HANDOFF_CONTRACT_VERSION}, or return an amendment request to XMi.`));
  const projectMode = profile?.project_mode ?? null;
  const scopeDispositions: ConsumerImportResult["scope_dispositions"] = [];
  if (profile && projectMode) {
    if (profile.readiness_target !== ({FAST_VALIDATION: "PROTOTYPE_READY", FAST_DEVELOPMENT: "BUILD_READY", PRODUCT_GRADE: "PRODUCT_SPEC_READY"} as const)[projectMode]) {
      errors.push(issue("DELIVERY_PROFILE_INCONSISTENT", "Project mode and readiness target disagree.",
        "Return the package to XMi/Owner; do not silently rewrite either field."));
    }
    if (consumer === "XDEV" && options.preserve_scope_override_triples === false && profile.scope_overrides.length) {
      errors.push(issue("XDEV_SCOPE_OVERRIDE_PRESERVATION_REQUIRED",
        "This XDev adapter cannot losslessly preserve scope_ids/minimum_mode/resolution.",
        "Reject the whole package and upgrade the adapter; do not reduce scoped overrides to free text."));
    }
    for (const override of profile.scope_overrides) {
      if (modeRank[override.minimum_mode] < modeRank[projectMode]) errors.push(issue("SCOPE_OVERRIDE_MINIMUM_BELOW_PROJECT",
        `Override ${override.id} has minimum_mode below the selected project mode.`,
        "Correct the inconsistent override in XMi rather than lowering or rewriting it downstream.", override.id));
      if (!override.scope_ids.length) errors.push(issue("SCOPE_OVERRIDE_TRIPLE_INCOMPLETE",
        `Override ${override.id} has no scope_ids.`, "Restore the complete scope_ids/minimum_mode/resolution triple or reject the package.", override.id));
      const mapped = xdevProfile[override.minimum_mode];
      const action = override.resolution === "UPGRADE_SCOPE" ? "ESCALATE_SCOPED_TASKS" as const
        : override.resolution === "UPGRADE_PROJECT" ? "ESCALATE_PROJECT" as const
        : override.resolution === "STUB_OR_SANDBOX" ? "NON_LIVE_PATH" as const : "EXCLUDE_SCOPE" as const;
      if (override.resolution === "UPGRADE_PROJECT" && override.minimum_mode !== projectMode) errors.push(issue("UPGRADE_PROJECT_NOT_REFLECTED",
        `Override ${override.id} says UPGRADE_PROJECT but project_mode is not the minimum_mode.`,
        "Return the discrepancy to XMi/Owner; do not silently change the selected mode.", override.id));
      scopeDispositions.push({id: override.id, scope_ids: [...override.scope_ids], minimum_mode: override.minimum_mode,
        mapped_minimum_profile: mapped, resolution: override.resolution, action,
        escalates: override.resolution === "UPGRADE_SCOPE" || override.resolution === "UPGRADE_PROJECT"});
    }
  }
  return {consumer, accepted: errors.length === 0, errors, handoff_contract_version: profile ? contractVersion : null,
    project_mode: projectMode, mapped_profile: projectMode && consumer === "XDEV" ? xdevProfile[projectMode] : null,
    owner_selected: false, selection_provenance_authenticated: false, scope_dispositions: scopeDispositions};
}

function packageManifestValid(artifact: CompiledArtifact, xspec: XSpecDocument | null): ValidationIssue[] {
  const errors: ValidationIssue[] = [];
  const expected = new Set(XSPEC_PACKAGE_FILES);
  const paths = artifact.files.map((file) => file.path);
  if (paths.length !== expected.size || paths.some((path) => !expected.has(path))) errors.push(issue("XSPEC_PACKAGE_FILESET_INVALID",
    "The package must contain exactly the published sixteen XSpec files.", "Recompile the package; do not add a seventeenth handoff file."));
  const manifestFile = artifact.files.find((file) => file.path === "manifest.json");
  if (!manifestFile) return [...errors, issue("XSPEC_MANIFEST_REQUIRED", "manifest.json is missing.", "Recompile the package.")];
  let manifest: Record<string, unknown>;
  try { manifest = JSON.parse(manifestFile.content) as Record<string, unknown>; }
  catch { return [...errors, issue("XSPEC_MANIFEST_INVALID", "manifest.json is not valid JSON.", "Recompile the package.")]; }
  const hashes = manifest.file_sha256;
  if (!hashes || typeof hashes !== "object") errors.push(issue("XSPEC_MANIFEST_HASHES_REQUIRED", "manifest.json has no payload hash table.", "Recompile the package."));
  else for (const file of artifact.files.filter((entry) => entry.path !== "manifest.json")) {
    if ((hashes as Record<string, unknown>)[file.path] !== sha256(file.content)) errors.push(issue("XSPEC_MANIFEST_HASH_MISMATCH",
      `Manifest hash mismatch for ${file.path}.`, "Reject the package and recompile from canonical state.", file.path));
  }
  if (xspec && manifest.xspec_schema_version !== xspec.schema_version) errors.push(issue("XSPEC_MANIFEST_SCHEMA_VERSION_MISMATCH",
    "Manifest schema version does not match xspec.json.", "Reject the package and recompile; do not relabel a new format as an older version."));
  if (xspec && manifest.canonical_xspec_sha256 !== xspec.integrity.canonical_sha256) errors.push(issue("XSPEC_MANIFEST_CANONICAL_HASH_MISMATCH",
    "Manifest canonical XSpec hash does not match xspec.json integrity.", "Reject the package and recompile; do not repair hashes by hand."));
  return errors;
}

export class XSpecService {
  private projectDirectory?: string;
  constructor(projectDirectory?: string) {this.projectDirectory = projectDirectory;}
  private exportRoot(packageName: string) {
    return this.projectDirectory ? projectPath(this.projectDirectory, "docs", "xspec", packageName) : resolve(process.cwd(), "exports", packageName);
  }
  private exportRelative(packageName: string) {return `${this.projectDirectory ? "docs/xspec" : "exports"}/${packageName}`;}
  compile(project: Project, evidence: Partial<M8ReadinessEvidence> = {}, delivery?: DeliveryWorkflow): CompiledArtifact {
    const resolved: M8ReadinessEvidence = {xui_compatible: evidence.xui_compatible ?? false,
      xdev_compatible: evidence.xdev_compatible ?? false, owner_confirmed_export: evidence.owner_confirmed_export ?? false,
      immutable_export_exists: evidence.immutable_export_exists ?? false, audit: evidence.audit ?? {audit_run_id: null,
        audit_status: "UNAVAILABLE", isolation_status: "UNAVAILABLE", assurance_level: null, blocking_finding_count: 0}};
    return buildArtifact(project, resolved, delivery);
  }

  validate(project: Project, artifact: CompiledArtifact, evidence: Partial<M8ReadinessEvidence> = {}): XSpecValidation {
    const xspec = parseXSpec(artifact);
    const errors: ValidationIssue[] = [];
    let schemaValid = false;
    if (!xspec) errors.push(issue("XSPEC_JSON_INVALID", "xspec.json is missing or malformed.", "Recompile the XSpec package."));
    else {
      schemaValid = !!schemaValidators.xspec!(xspec);
      if (!schemaValid) {
        const missingAcceptance = requirementsMissingAcceptance(xspec);
        if (missingAcceptance.length && schemaFailureIsOnlyMissingAcceptance(xspec)) {
          for (const requirement of missingAcceptance) errors.push(issue("XSPEC_REQUIREMENT_ACCEPTANCE_MISSING",
            `Confirmed requirement ${requirement.id} has no exported acceptance criterion, so the strict XSpec schema is not yet satisfiable.`,
            "Add and confirm at least one acceptance criterion for this requirement, or revise/reject the requirement; XMi will keep the confirmed requirement visible and will not weaken the schema.",
            requirement.id));
        } else {
          errors.push(issue("XSPEC_SCHEMA_INVALID", "xspec.json does not validate against schemas/xspec.schema.json.",
            "Fix the canonical Product Model/compiler mapping; do not weaken the schema."));
        }
      }
      const readiness = xspec.readiness as {status?: string; target_mode?: DeliveryMode; target_level?: unknown; achieved_level?: unknown;
        blocking_count?: number; hard_gates?: Array<{id?: string; passed?: boolean}>};
      if (readiness.status === "READY_FOR_XDEV") {
        const rows = readiness.hard_gates ?? [];
        const expectedIds = readiness.target_mode ? expectedReadinessGateIds(readiness.target_mode) : [];
        const present = new Set(rows.map((gate) => gate.id).filter((id): id is string => typeof id === "string"));
        const falseClaim = readiness.achieved_level !== readiness.target_level || readiness.blocking_count !== 0 ||
          expectedIds.length === 0 || expectedIds.some((id) => !present.has(id)) || rows.some((gate) => gate.passed !== true);
        if (falseClaim) errors.push(issue("FALSE_READINESS_CLAIM_M8",
          "READY_FOR_XDEV requires the exact target readiness level, zero canonical blockers, every required stable gate id, and every embedded hard/mode gate to pass.",
          "Keep readiness NOT_READY until the blocking or missing gate is resolved; display scores never override a failed gate."));
      }
    }
    const referenceErrors = xspec ? validateReferences(xspec) : [];
    const coverageErrors = xspec ? validateCoverage(xspec) : [];
    errors.push(...referenceErrors, ...coverageErrors);
    let integrityValid = false;
    if (xspec) {
      integrityValid = canonicalXSpecHash(xspec) === xspec.integrity?.canonical_sha256;
      if (!integrityValid) errors.push(issue("XSPEC_INTEGRITY_MISMATCH", "xspec.json canonical integrity hash cannot be reproduced.",
        "Reject the package and recompile; the integrity hash excludes the integrity field itself."));
      const questions = (xspec.open_questions as Array<{status?: string}> | undefined) ?? [];
      if (questions.some((q) => q.status === "BLOCKING")) errors.push(issue("XSPEC_BLOCKING_QUESTION",
        "The XSpec contains a blocking open question.", "Resolve the blocking question in XMi before consumer handoff."));
      const blueprint = xspec.solution_blueprint as {status?: string} | undefined;
      if (!blueprint || !["CONFIRMED", "DELEGATED_TO_XDEV"].includes(blueprint.status ?? "")) errors.push(issue("XSPEC_BLUEPRINT_NOT_APPROVED",
        "The solution blueprint is neither confirmed nor explicitly delegated.", "Obtain explicit Owner approval/delegation before export."));
      const profile = xspec.profile as {id?: string; supported?: boolean} | undefined;
      if (!["web-micro-saas-v0", "digital-game-v0"].includes(profile?.id ?? "") || profile?.supported !== true) errors.push(issue("XSPEC_PROFILE_UNSUPPORTED",
        "The package claims an unsupported V0 product profile.", "Use the Web App / Micro-SaaS V0 profile or stop the export."));
    }
    const manifestErrors = packageManifestValid(artifact, xspec);
    errors.push(...manifestErrors);
    // F-10: an unresolved blocking mode-risk is the one common hard gate that was reported but never
    // enforced at the export call. docs/08 section 5 lists it beside supported-profile and valid
    // schema/references, and both of those already refuse an export here; docs/16 section 4 states it
    // directly as "blocks export". No consumer's opinion is involved: this is XMi's own policy being
    // undecided, so refusing does not undo F-7 (no external party may veto XMi's deliverable).
    const invalidOverrides = invalidRiskOverrides(project);
    if (invalidOverrides.length) errors.push(issue("XSPEC_RISK_SCOPE_REVIEW_REQUIRED",
      "Stale or mixed whole-item risk dispositions: " + invalidOverrides.join(", "),
      "Withdraw the old disposition, split retained and deferred capabilities into separately reviewed items, and review the current scope. Existing product content is preserved."));
    const modeRisk = evaluateRisk(project);
    const blockingRisk = modeRisk.findings.filter((finding) => finding.status === "BLOCKING");
    if (blockingRisk.length > 0) errors.push(issue("XSPEC_UNRESOLVED_MODE_RISK",
      `${blockingRisk.length} mode-risk(s) are still unresolved: ${blockingRisk.map((finding) =>
        `${finding.reason_code} over ${finding.scope_ids.join(", ")}`).join("; ")}.`,
      "Resolve each one in XMi with an explicit disposition (upgrade scope, upgrade project, stub/sandbox, or defer/exclude), or reject the scope item that raised it, then export again."));
    // Package-intrinsic validity: everything wrong with the artifact itself, regardless of any
    // particular consumer's disposition. Consumer results are computed below from this baseline.
    const commonConsumerErrors = [...errors];
    const packageValid = commonConsumerErrors.length === 0;
    const xuiBase = xspec ? importForConsumer(xspec, "XUI") : importForConsumer({delivery_profile: undefined} as unknown as XSpecDocument, "XUI");
    const xdevBase = xspec ? importForConsumer(xspec, "XDEV") : importForConsumer({delivery_profile: undefined} as unknown as XSpecDocument, "XDEV");
    const xui: ConsumerImportResult = {...xuiBase, accepted: commonConsumerErrors.length === 0 && xuiBase.accepted,
      errors: [...commonConsumerErrors, ...xuiBase.errors]};
    const xdev: ConsumerImportResult = {...xdevBase, accepted: commonConsumerErrors.length === 0 && xdevBase.accepted,
      errors: [...commonConsumerErrors, ...xdevBase.errors]};
    errors.push(...xuiBase.errors.map((e) => ({...e, code: `XUI_${e.code}`})), ...xdevBase.errors.map((e) => ({...e, code: `XDEV_${e.code}`})));
    const readinessEvidence: M8ReadinessEvidence = {xui_compatible: xui.accepted, xdev_compatible: xdev.accepted,
      owner_confirmed_export: evidence.owner_confirmed_export ?? false, immutable_export_exists: evidence.immutable_export_exists ?? false,
      audit: evidence.audit ?? {audit_run_id: null, audit_status: "UNAVAILABLE", isolation_status: "UNAVAILABLE",
        assurance_level: null, blocking_finding_count: 0}};
    const readiness = new CompletenessService().evaluate(project, [], readinessEvidence);
    return {valid: errors.length === 0, package_valid: packageValid, schema_valid: schemaValid,
      references_valid: referenceErrors.length === 0,
      coverage_valid: coverageErrors.length === 0, integrity_valid: integrityValid, package_manifest_valid: manifestErrors.length === 0,
      errors, scope_override_normalisations: scopeOverrideNormalisations(project),
      consumers: {xui, xdev}, readiness_evaluation: readiness};
  }

  finalizeForExport(project: Project, evidence: Partial<M8ReadinessEvidence> = {}, review?: DocumentReviewSummary): {artifact: CompiledArtifact; validation: XSpecValidation; delivery_workflow?: DeliveryWorkflow} {
    const candidate = this.compile(project, evidence);
    const first = this.validate(project, candidate, evidence);
    // Export is gated on the package being sound, not on any one consumer's disposition. XMi must be
    // able to produce its deliverable on its own: a consumer-side rejection is reported alongside the
    // artifact and keeps readiness honest, but it must not be able to lock the door on XMi.
    requireCondition(first.package_valid, "XSPEC_PACKAGE_INVALID");
    // The exported readiness report carries the consumer results that were actually observed, so the
    // package never claims compatibility it does not have.
    const finalEvidence: M8ReadinessEvidence = {xui_compatible: first.consumers.xui.accepted,
      xdev_compatible: first.consumers.xdev.accepted, owner_confirmed_export: true, immutable_export_exists: true,
      audit: evidence.audit ?? {audit_run_id: null, audit_status: "UNAVAILABLE", isolation_status: "UNAVAILABLE",
        assurance_level: null, blocking_finding_count: 0}};
    const delivery = review ? documentDelivery(review, first.package_valid, first.readiness_evaluation) : undefined;
    const artifact = this.compile(project, finalEvidence, delivery);
    const validation = this.validate(project, artifact, finalEvidence);
    requireCondition(validation.package_valid, "XSPEC_PACKAGE_INVALID");
    return {artifact, validation, ...(delivery ? {delivery_workflow: delivery} : {})};
  }

  inspectExport(artifact: CompiledArtifact, packageName: string): {relative_path: string; status: "MISSING" | "IDENTICAL" | "DIFFERENT"} {
    requireCondition(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(packageName), "EXPORT_DESTINATION_INVALID");
    const target = this.exportRoot(packageName);
    const existingManifest = join(target, "manifest.json");
    if (!existsSync(target)) return {relative_path: this.exportRelative(packageName), status: "MISSING"};
    const manifest = artifact.files.find((file) => file.path === "manifest.json")!;
    if (existsSync(existingManifest) && readFileSync(existingManifest, "utf8") === manifest.content) {
      return {relative_path: this.exportRelative(packageName), status: "IDENTICAL"};
    }
    return {relative_path: this.exportRelative(packageName), status: "DIFFERENT"};
  }

  writeExport(artifact: CompiledArtifact, packageName: string, overwrite: boolean): {relative_path: string; already_present: boolean} {
    const inspected = this.inspectExport(artifact, packageName);
    if (inspected.status === "IDENTICAL") return {relative_path: inspected.relative_path, already_present: true};
    requireCondition(inspected.status !== "DIFFERENT" || overwrite, "EXPORT_DESTINATION_EXISTS");
    const target = this.exportRoot(packageName);
    if (inspected.status === "DIFFERENT") rmSync(target, {recursive: true, force: true});
    mkdirSync(target, {recursive: true});
    for (const file of artifact.files) writeFileSync(join(target, file.path), file.content, {encoding: "utf8"});
    return {relative_path: inspected.relative_path, already_present: false};
  }
}
