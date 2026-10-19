import type { DeliveryMode, Item, Project, RiskOverrideResolution } from "../shared-types/domain.ts";
import { fingerprint } from "./validation.ts";
import { WEB_MICRO_SAAS_V0_RULES, DIGITAL_GAME_V0_RULES } from "./profile-rules.ts";
import type { ApplicabilityKey, ProfileArea, ProfileRule } from "./profile-rules.ts";
import { riskContext, unsafeExclusionItems } from "./risk-context.ts";
import { assessFeasibility } from "./solution-feasibility.ts";
import { solutionBlockingInputs } from "./solution-options.ts";
import { paymentScope } from "./payment-scope.ts";

const ranks: Record<DeliveryMode, number> = {FAST_VALIDATION: 0, FAST_DEVELOPMENT: 1, PRODUCT_GRADE: 2};
const targets: Record<DeliveryMode, "PROTOTYPE_READY" | "BUILD_READY" | "PRODUCT_SPEC_READY"> = {
  FAST_VALIDATION: "PROTOTYPE_READY", FAST_DEVELOPMENT: "BUILD_READY", PRODUCT_GRADE: "PRODUCT_SPEC_READY",
};
const active = (item: Item) => item.status !== "REJECTED" && item.status !== "SUPERSEDED";
const text = (item: Item) => `${item.statement} ${(item.tags ?? []).join(" ")}`.toLowerCase();
const words = (value: string[]) => value.map((v) => v.toLowerCase());

export type Applicability = "APPLICABLE" | "NOT_APPLICABLE" | "UNRESOLVED";
export type ProfileRuleResult = {
  rule_id: string; area: ProfileArea; label: string; minimum_mode: DeliveryMode;
  applicability: Applicability; considered: boolean; confirmed: boolean; evidence_ids: string[];
};
export type CompletenessBlocker = {
  id: string; category: "PROFILE" | "DECISION" | "RISK" | "CONTRADICTION" | "OPEN_QUESTION";
  reason: string; affected_ids: string[];
};
export type HardGateResult = {gate: number; name: string; status: "PASS" | "FAIL" | "DEFERRED"; reason: string};
export type ReadinessEvaluation = {
  target: "PROTOTYPE_READY" | "BUILD_READY" | "PRODUCT_SPEC_READY" | null;
  qualification: null;
  readiness_status: "NOT_READY_M8" | "READY_FOR_XDEV";
  score: number;
  dimensions: Record<string, number>;
  hard_gates: HardGateResult[];
  mode_gates: HardGateResult[];
  hard_gate_ready: boolean;
  blockers: CompletenessBlocker[];
  profile_results: ProfileRuleResult[];
};


export type M7ReadinessEvidence = {
  xui_compatible: boolean;
  xdev_compatible: boolean;
  owner_confirmed_export: boolean;
  immutable_export_exists: boolean;
};
export type M8AuditEvidence = {
  audit_run_id: string | null;
  audit_status: "PASS" | "BLOCKING" | "UNAVAILABLE";
  isolation_status: "BOUNDED_SNAPSHOT_FALLBACK" | "UNAVAILABLE";
  assurance_level: "BASIC_SELF_CHECK" | "INDEPENDENT_SPEC_REVIEW" | "INDEPENDENT_PRODUCT_AUDIT" | null;
  blocking_finding_count: number;
};
export type M8ReadinessEvidence = M7ReadinessEvidence & {audit: M8AuditEvidence};
const noM8Evidence: M8ReadinessEvidence = {xui_compatible: false, xdev_compatible: false,
  owner_confirmed_export: false, immutable_export_exists: false, audit: {audit_run_id: null,
    audit_status: "UNAVAILABLE", isolation_status: "UNAVAILABLE", assurance_level: null, blocking_finding_count: 0}};

export type RiskReasonCode = "AUTH_OR_PRIVATE_DATA" | "PAYMENT_OR_FINANCIAL" | "SENSITIVE_DATA" |
  "DESTRUCTIVE_ACTION" | "ADMIN_ACCESS" | "EXTERNAL_SIDE_EFFECT" | "REGULATED_OR_HIGH_CONSEQUENCE";
export type RiskFinding = {
  override_id: string; reason_code: RiskReasonCode; rationale: string; minimum_mode: DeliveryMode;
  scope_ids: string[]; status: "SATISFIED_BY_PROJECT_MODE" | "RESOLVED_BY_OVERRIDE" | "BLOCKING";
  active_resolution: RiskOverrideResolution | null;
  exclusion_requires_split_ids?: string[];
};
export type RiskEvaluation = {
  evaluation_status: "DETERMINISTIC_M5";
  requested_mode: DeliveryMode | null; effective_mode: DeliveryMode | null;
  minimum_mode: DeliveryMode; findings: RiskFinding[]; unresolved_blocker_count: number;
  scope_overrides_export: "XDEV-DELIVERY-HANDOFF/1";
};

type RiskRule = {reason_code: RiskReasonCode; minimum_mode: DeliveryMode; rationale: string; pattern: RegExp};
// Projection-version provenance, never an approval token. Only a new Owner-gated
// resolution can add it; old histories retain their original bytes and meaning.
export const riskResolutionRevision = {type: "system_rule" as const, ref: "xmi-risk-resolution/2"};
function currentResolution(entry: NonNullable<Project["delivery_policy"]>["risk_overrides"][number]): boolean {
  const last = entry.source_refs.at(-1);
  return last?.type === riskResolutionRevision.type && last.ref === riskResolutionRevision.ref;
}
const riskRules: readonly RiskRule[] = [
  {reason_code: "AUTH_OR_PRIVATE_DATA", minimum_mode: "FAST_DEVELOPMENT",
    rationale: "Authentication, authorization, tenant isolation or private-data behavior needs at least reviewed treatment.",
    pattern: /auth|login|sign.?in|permission|tenant|private data|own data|登录|认证|权限|租户|私有数据|自己的数据/i},
  {reason_code: "PAYMENT_OR_FINANCIAL", minimum_mode: "PRODUCT_GRADE",
    rationale: "Payment, billing, refunds or financial records are high-risk scope and cannot stay at prototype depth by convenience.",
    pattern: /payment|billing|refund|stripe|charge|subscription|支付|账单|退款|收费|订阅/i},
  {reason_code: "SENSITIVE_DATA", minimum_mode: "PRODUCT_GRADE",
    rationale: "Sensitive personal or regulated-domain data requires stronger specification and audit depth.",
    pattern: /sensitive|personal data|pii|health|medical|biometric|government id|敏感|个人数据|医疗|健康|生物识别|证件/i},
  {reason_code: "DESTRUCTIVE_ACTION", minimum_mode: "PRODUCT_GRADE",
    rationale: "Irreversible deletion or destructive migration requires explicit confirmation, recovery and failure policy.",
    pattern: /delete permanently|irreversible|destructive|drop data|永久删除|不可逆|破坏性|销毁/i},
  {reason_code: "ADMIN_ACCESS", minimum_mode: "PRODUCT_GRADE",
    rationale: "Administrator impersonation or privileged access requires product-grade permission and audit treatment.",
    pattern: /admin imperson|administrator access|superuser|root access|管理员冒充|管理员访问|超级管理员/i},
  {reason_code: "EXTERNAL_SIDE_EFFECT", minimum_mode: "FAST_DEVELOPMENT",
    rationale: "External side effects require explicit permission, failure, retry and duplicate-operation behavior.",
    pattern: /send|publish|post|transfer|webhook|external action|自动发送|发布|转账|外部操作|回调/i},
  {reason_code: "REGULATED_OR_HIGH_CONSEQUENCE", minimum_mode: "PRODUCT_GRADE",
    rationale: "Safety-critical, legal/compliance or regulated behavior requires product-grade specification and review.",
    pattern: /regulated|compliance|\blegal\b|safety.?critical|high consequence|监管|合规|法律|安全关键|高后果/i},
];

function explicitNotApplicable(project: Project, key: ApplicabilityKey): boolean {
  if (key === "ALWAYS") return false;
  const tag = `profile-applicability:${key.toLowerCase()}:not-applicable`;
  return project.items.some((item) => item.status === "CONFIRMED" && item.tags?.includes(tag));
}
function applicabilitySignal(project: Project, key: ApplicabilityKey): boolean {
  if (key === "ALWAYS") return true;
  const items = project.items.filter(active);
  if (key === "ACCOUNT_OR_PRIVATE") return items.some((item) => item.type === "permission_rule" ||
    /account|login|sign.?in|private data|tenant|role|permission|账号|登录|私有数据|租户|角色|权限/i.test(text(item)));
  if (key === "COMMERCIAL") return items.some((item) =>
    /payment|paid|billing|price|subscription|refund|charge|quota|支付|付费|账单|价格|订阅|退款|额度/i.test(text(item)));
  if (key === "GAME_ONLINE") return items.some((item) =>
    /online|multiplayer|network|matchmaking|server|联机|多人|网络|匹配|服务器/i.test(text(item)));
  return items.some((item) => item.type === "integration" ||
    /integration|provider|api|email|notification|webhook|oauth|map|ai service|集成|供应商|接口|邮件|通知|地图|外部服务/i.test(text(item)));
}
function applicability(project: Project, key: ApplicabilityKey): {value: Applicability; conflict: boolean} {
  if (key === "ALWAYS") return {value: "APPLICABLE", conflict: false};
  const excluded = explicitNotApplicable(project, key);
  const signaled = applicabilitySignal(project, key);
  if (excluded && signaled) return {value: "UNRESOLVED", conflict: true};
  if (excluded) return {value: "NOT_APPLICABLE", conflict: false};
  if (signaled) return {value: "APPLICABLE", conflict: false};
  return {value: "UNRESOLVED", conflict: false};
}
function evidence(project: Project, rule: ProfileRule): Item[] {
  const tags = words(rule.evidence_tags); const keywords = words(rule.evidence_keywords);
  return project.items.filter(active).filter((item) => {
    const body = text(item);
    if (rule.id === "security.data-sensitivity" && item.status === "CONFIRMED" && rule.evidence_types.includes(item.type) &&
      item.statement.split(/[。；;\n]/u).some(clause => !/[?？]|是否|待定/u.test(clause) &&
        /^(?:首期|本期|当前|V0)?(?:评测)?(?:数据|资料|案例)(?:范围)?[：:\s]*(?:仅使用|只使用|仅采用|只采用|仅限于?|限定为|全部为|均为)[：:\s]*公开(?:的)?合成(?:数据|资料|案例)(?=[\s，,]|$)/iu.test(clause.trim()))) return true;
    if (rule.id === "security.regulated-risk" && item.type === "exclusion") return item.status === "CONFIRMED" &&
      !/[?？]|是否|待定|不(?:再)?(?:排除|后置|延期)|未(?:排除|后置|延期)/u.test(item.statement) && /后置|延期|排除|不接入|\b(?:deferred|excluded)\b/i.test(item.statement) &&
      /医疗|生物识别|个人健康|监管资料|\b(?:medical|biometric|regulated data|personal health)\b/i.test(item.statement);
    if (rule.id === "integration.external-data" && rule.evidence_types.includes(item.type) &&
      item.statement.split(/[。；;\n]/u).some(sentence =>
        !/[?？]|是否|待定/u.test(sentence) && sentence.split(/[，,]/u).some(clause =>
          !/(?:不|未|禁止|无需)[^，,。；;\n]{0,24}(?:发送|外发)/u.test(clause) &&
          /(?:数据|资料|证据|文本)[^，,。；;\n]{0,24}发送(?:到|至)[^，,。；;\n]{0,40}(?:\bAPI\b|接口)/iu.test(clause)))) return true;
    return rule.evidence_types.includes(item.type) && (tags.some((tag) => item.tags?.map((t) => t.toLowerCase()).includes(tag)) ||
      keywords.some((keyword) => body.includes(keyword)));
  });
}
function ruleResults(project: Project): ProfileRuleResult[] {
  const rules = project.profile === "digital-game-v0" ? DIGITAL_GAME_V0_RULES : WEB_MICRO_SAAS_V0_RULES;
  const payment = paymentScope(project, isRiskScopeDeferred(project, "PAYMENT_OR_FINANCIAL"));
  return rules.map((rule) => {
    if (rule.id === "commercial.payment-failure") {
      const app = payment.not_applicable ? "NOT_APPLICABLE" : payment.conflict ? "UNRESOLVED" :
        payment.current_ids.length ? "APPLICABLE" : applicability(project, rule.applicability).value;
      return {rule_id: rule.id, area: rule.area, label: rule.label, minimum_mode: rule.minimum_mode,
        applicability: app as Applicability, considered: payment.not_applicable || payment.failure_ids.length > 0,
        confirmed: payment.not_applicable || !payment.conflict && payment.failure_ids.length > 0,
        evidence_ids: payment.not_applicable || payment.conflict ? [...payment.exclusion_ids, ...payment.current_ids] : payment.failure_ids};
    }
    const app = applicability(project, rule.applicability).value;
    const hits = app === "NOT_APPLICABLE" ? [] : evidence(project, rule);
    return {rule_id: rule.id, area: rule.area, label: rule.label, minimum_mode: rule.minimum_mode,
      applicability: app, considered: app === "NOT_APPLICABLE" || hits.length > 0,
      confirmed: app === "NOT_APPLICABLE" || hits.some((item) => item.status === "CONFIRMED"),
      evidence_ids: hits.map((item) => item.id)};
  });
}
function mode(project: Project): DeliveryMode { return project.delivery_policy?.effective_mode ?? "FAST_VALIDATION"; }
function requiredResults(project: Project, results: ProfileRuleResult[]): ProfileRuleResult[] {
  const selected = mode(project);
  return results.filter((result) => ranks[selected] >= ranks[result.minimum_mode]);
}
function classificationBlockers(project: Project): CompletenessBlocker[] {
  const blockers: CompletenessBlocker[] = [];
  const keys: ApplicabilityKey[] = project.profile === "digital-game-v0"
    ? ["ACCOUNT_OR_PRIVATE", "COMMERCIAL", "INTEGRATION", "GAME_ONLINE"]
    : ["ACCOUNT_OR_PRIVATE", "COMMERCIAL", "INTEGRATION"];
  for (const key of keys) {
    const state = applicability(project, key);
    if (state.value === "UNRESOLVED") blockers.push({id: `BLOCK-PROFILE-${key}`, category: "PROFILE",
      reason: state.conflict
        ? `Applicability for ${key} conflicts with a confirmed not-applicable decision; Owner resolution is required.`
        : `Applicability for ${key} is unresolved; record an explicit applicable scope or confirmed not-applicable decision.`,
      affected_ids: []});
  }
  return blockers;
}
function profileBlockers(project: Project, results: ProfileRuleResult[]): CompletenessBlocker[] {
  const required = requiredResults(project, results);
  const payment = paymentScope(project, isRiskScopeDeferred(project, "PAYMENT_OR_FINANCIAL"));
  const conflicts: CompletenessBlocker[] = payment.conflict ? [{id: "BLOCK-PROFILE-PAYMENT-SCOPE-CONFLICT", category: "PROFILE",
    reason: "Current payment behavior conflicts with a confirmed real-payment exclusion; Owner resolution is required.",
    affected_ids: [...payment.exclusion_ids, ...payment.current_ids]}] : [];
  return [...conflicts, ...required.filter((result) => result.applicability === "APPLICABLE" && !result.considered).map((result) => ({
    id: `BLOCK-PROFILE-${result.rule_id.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}`,
    category: "PROFILE" as const, reason: `Required profile area has not been considered: ${result.label}.`, affected_ids: [],
  }))];
}
function decisionBlockers(project: Project): CompletenessBlocker[] {
  return project.items.filter(active).filter((item) => item.type === "decision" && item.tags?.includes("material"))
    .filter((item) => item.status !== "CONFIRMED" || !item.decision_detail?.owner_selection)
    .map((item) => ({id: `BLOCK-DECISION-${item.id}`, category: "DECISION" as const,
      reason: "Material decision is not explicitly approved with an Owner selection.", affected_ids: [item.id]}));
}
function matches(item: Item, re: RegExp): boolean { return active(item) && re.test(text(item)); }
function hasConfirmed(project: Project, types: Item["type"][], re?: RegExp): boolean {
  return project.items.some((item) => item.status === "CONFIRMED" && types.includes(item.type) && (!re || matches(item, re)));
}
function referencesValid(project: Project): boolean {
  const ids = new Set(project.items.map((item) => item.id));
  return project.items.every((item) => {
    if (item.supersedes && !ids.has(item.supersedes)) return false;
    if (item.links?.some((link) => !ids.has(link))) return false;
    const detail = item.decision_detail;
    if (!detail) return true;
    if (!detail.options.some((option) => option.id === detail.recommendation.option_id)) return false;
    if (detail.owner_selection && !detail.options.some((option) => option.id === detail.owner_selection)) return false;
    return [...detail.linked_requirements, ...detail.linked_flows, ...detail.supersession_history].every((id) => ids.has(id));
  });
}
function acCoverage(project: Project): boolean {
  const reqs = project.items.filter((item) => item.type === "functional_requirement" &&
    (item.priority === "P0" || item.priority === "P1") && item.status !== "REJECTED" && item.status !== "SUPERSEDED");
  return reqs.every((req) => req.status === "CONFIRMED" && project.items.some((item) => item.type === "acceptance_criterion" &&
    item.status === "CONFIRMED" && item.links?.includes(req.id)));
}
function dimensions(project: Project, results: ProfileRuleResult[], evidence: M8ReadinessEvidence): Record<string, number> {
  const required = requiredResults(project, results);
  const ratio = (area: ProfileArea) => {
    const rows = required.filter((row) => row.area === area && row.applicability !== "NOT_APPLICABLE");
    if (!rows.length) return 100;
    return Math.round(100 * rows.filter((row) => row.confirmed).length / rows.length);
  };
  const acReqs = project.items.filter((item) => active(item) && item.type === "functional_requirement" && (item.priority === "P0" || item.priority === "P1"));
  const acScore = !acReqs.length ? 0 : Math.round(100 * acReqs.filter((req) => req.status === "CONFIRMED" &&
    project.items.some((ac) => ac.type === "acceptance_criterion" && ac.status === "CONFIRMED" && ac.links?.includes(req.id))).length / acReqs.length);
  return {
    vision_clarity: ratio("PRODUCT_USERS"), user_actor_clarity: ratio("PRODUCT_USERS"), core_flow_coverage: ratio("FUNCTIONAL_STATES"),
    requirements_specificity: Math.round((ratio("PRODUCT_USERS") + ratio("DATA")) / 2), acceptance_testability: acScore,
    data_permission_completeness: Math.round((ratio("DATA") + ratio("IDENTITY_ACCESS")) / 2),
    integration_clarity: ratio("NOTIFICATIONS_INTEGRATIONS"), security_privacy_completeness: ratio("SECURITY_PRIVACY"),
    solution_feasibility: Math.round(100 * assessFeasibility(project).satisfied_count / 8),
    consumer_compatibility: (Number(evidence.xui_compatible) + Number(evidence.xdev_compatible)) * 50,
  };
}

export function evaluateRiskLegacy(project: Project): RiskEvaluation {
  const legacyRiskRules: readonly RiskRule[] = [
  {reason_code: "AUTH_OR_PRIVATE_DATA", minimum_mode: "FAST_DEVELOPMENT",
    rationale: "Authentication, authorization, tenant isolation or private-data behavior needs at least reviewed treatment.",
    pattern: /auth|login|sign.?in|permission|tenant|private data|own data|登录|认证|权限|租户|私有数据|自己的数据/i},
  {reason_code: "PAYMENT_OR_FINANCIAL", minimum_mode: "PRODUCT_GRADE",
    rationale: "Payment, billing, refunds or financial records are high-risk scope and cannot stay at prototype depth by convenience.",
    pattern: /payment|billing|refund|stripe|charge|subscription|支付|账单|退款|收费|订阅/i},
  {reason_code: "SENSITIVE_DATA", minimum_mode: "PRODUCT_GRADE",
    rationale: "Sensitive personal or regulated-domain data requires stronger specification and audit depth.",
    pattern: /sensitive|personal data|pii|health|medical|biometric|government id|敏感|个人数据|医疗|健康|生物识别|证件/i},
  {reason_code: "DESTRUCTIVE_ACTION", minimum_mode: "PRODUCT_GRADE",
    rationale: "Irreversible deletion or destructive migration requires explicit confirmation, recovery and failure policy.",
    pattern: /delete permanently|irreversible|destructive|drop data|永久删除|不可逆|破坏性|销毁/i},
  {reason_code: "ADMIN_ACCESS", minimum_mode: "PRODUCT_GRADE",
    rationale: "Administrator impersonation or privileged access requires product-grade permission and audit treatment.",
    pattern: /admin imperson|administrator access|superuser|root access|管理员冒充|管理员访问|超级管理员/i},
  {reason_code: "EXTERNAL_SIDE_EFFECT", minimum_mode: "FAST_DEVELOPMENT",
    rationale: "External side effects require explicit permission, failure, retry and duplicate-operation behavior.",
    pattern: /send|publish|post|transfer|webhook|external action|自动发送|发布|转账|外部操作|回调/i},
  {reason_code: "REGULATED_OR_HIGH_CONSEQUENCE", minimum_mode: "PRODUCT_GRADE",
    rationale: "Safety-critical, legal/compliance or regulated behavior requires product-grade specification and review.",
    pattern: /regulated|compliance|legal|safety.?critical|high consequence|监管|合规|法律|安全关键|高后果/i},
];


  const currentMode = project.delivery_policy?.effective_mode ?? null;
  const findings = legacyRiskRules.flatMap((rule) => {
    const scope = project.items.filter((item) => matches(item, rule.pattern)).map((item) => item.id).sort().slice(0, 50);
    if (!scope.length) return [];
    const overrideId = `MODE-OVERRIDE-${rule.reason_code.replace(/_/g, "-")}-${fingerprint(scope).slice(0, 12).toUpperCase()}`;
    const resolved = project.delivery_policy?.risk_overrides.find((entry) => entry.id === overrideId && entry.status === "CONFIRMED");
    const activeResolution = resolved && ["UPGRADE_SCOPE", "UPGRADE_PROJECT", "STUB_OR_SANDBOX", "DEFER_OR_EXCLUDE"].includes(resolved.resolution)
      ? resolved.resolution as RiskOverrideResolution : null;
    const projectSatisfies = currentMode !== null && ranks[currentMode] >= ranks[rule.minimum_mode];
    const overrideSatisfies = activeResolution !== null && activeResolution !== "UPGRADE_PROJECT";
    const status = projectSatisfies ? "SATISFIED_BY_PROJECT_MODE" as const : overrideSatisfies ? "RESOLVED_BY_OVERRIDE" as const : "BLOCKING" as const;
    return [{override_id: overrideId, reason_code: rule.reason_code, rationale: rule.rationale,
      minimum_mode: rule.minimum_mode, scope_ids: scope, status, active_resolution: activeResolution}];
  });
  const minimum = findings.reduce<DeliveryMode>((value, finding) => ranks[finding.minimum_mode] > ranks[value] ? finding.minimum_mode : value,
    "FAST_VALIDATION");
  return {evaluation_status: "DETERMINISTIC_M5", requested_mode: project.delivery_policy?.requested_mode ?? null,
    effective_mode: currentMode, minimum_mode: minimum, findings,
    unresolved_blocker_count: findings.filter((finding) => finding.status === "BLOCKING").length,
    scope_overrides_export: "XDEV-DELIVERY-HANDOFF/1"};
}

export function evaluateRisk(project: Project): RiskEvaluation {
  const currentMode = project.delivery_policy?.effective_mode ?? null;
  const findings = riskRules.flatMap((rule) => {
    const scope = project.items.filter((item) => active(item) && rule.pattern.test(riskContext(item.statement))).map((item) => item.id).sort();
    if (!scope.length) return [];
    const overrideId = `MODE-OVERRIDE-${rule.reason_code.replace(/_/g, "-")}-${fingerprint(scope).slice(0, 12).toUpperCase()}`;
    const resolved = project.delivery_policy?.risk_overrides.find((entry) => entry.id === overrideId && entry.status === "CONFIRMED" && currentResolution(entry) &&
      entry.reason_code === rule.reason_code && fingerprint([...entry.scope_ids].sort()) === fingerprint(scope) &&
      scope.every(id => project.items.some(item => item.id === id && item.status === "CONFIRMED")));
    const activeResolution = resolved && ["UPGRADE_SCOPE", "UPGRADE_PROJECT", "STUB_OR_SANDBOX", "DEFER_OR_EXCLUDE"].includes(resolved.resolution)
      ? resolved.resolution as RiskOverrideResolution : null;
    const projectSatisfies = currentMode !== null && ranks[currentMode] >= ranks[rule.minimum_mode];
    const splitIds = unsafeExclusionItems(project.items.filter(item => scope.includes(item.id)), rule.pattern);
    const exclusionSafe = activeResolution !== "DEFER_OR_EXCLUDE" || splitIds.length === 0;
    const overrideSatisfies = exclusionSafe && activeResolution !== null && activeResolution !== "UPGRADE_PROJECT";
    const status = projectSatisfies ? "SATISFIED_BY_PROJECT_MODE" as const : overrideSatisfies ? "RESOLVED_BY_OVERRIDE" as const : "BLOCKING" as const;
    return [{override_id: overrideId, reason_code: rule.reason_code, rationale: rule.rationale,
      minimum_mode: rule.minimum_mode, scope_ids: scope, status, active_resolution: activeResolution, exclusion_requires_split_ids: splitIds}];
  });
  const minimum = findings.reduce<DeliveryMode>((value, finding) => ranks[finding.minimum_mode] > ranks[value] ? finding.minimum_mode : value,
    "FAST_VALIDATION");
  return {evaluation_status: "DETERMINISTIC_M5", requested_mode: project.delivery_policy?.requested_mode ?? null,
    effective_mode: currentMode, minimum_mode: minimum, findings,
    unresolved_blocker_count: findings.filter((finding) => finding.status === "BLOCKING").length,
    scope_overrides_export: "XDEV-DELIVERY-HANDOFF/1"};
}

export function exclusionScopeIssues(project: Project, scopeIds: string[], reason: string): string[] {
  const rule = riskRules.find(entry => entry.reason_code === reason);
  if (!rule) return [...scopeIds];
  const items = scopeIds.map(id => project.items.find(item => item.id === id));
  if (items.some(item => !item)) return [...scopeIds];
  return unsafeExclusionItems(items as Item[], rule.pattern);
}

export function invalidRiskOverrides(project: Project): string[] {
  const findings = evaluateRisk(project).findings;
  return (project.delivery_policy?.risk_overrides ?? []).filter(entry => entry.status === "CONFIRMED")
    .filter(entry => !currentResolution(entry) || entry.scope_ids.some(id => !project.items.some(item => item.id === id && item.status === "CONFIRMED")) || !findings.some(finding => finding.override_id === entry.id &&
      finding.reason_code === entry.reason_code && fingerprint(finding.scope_ids) === fingerprint([...entry.scope_ids].sort())) ||
      (entry.resolution === "DEFER_OR_EXCLUDE" && exclusionScopeIssues(project, entry.scope_ids, entry.reason_code).length > 0))
    .map(entry => entry.id);
}

/** Only a current, complete Owner disposition can remove behavior from this release's audit. */
export function isRiskScopeDeferred(project: Project, reason: RiskReasonCode): boolean {
  const rule = riskRules.find((entry) => entry.reason_code === reason)!;
  const scope = project.items.filter((item) => active(item) && rule.pattern.test(riskContext(item.statement)));
  if (!scope.length || unsafeExclusionItems(scope, rule.pattern).length > 0 || scope.some((item) => item.status !== "CONFIRMED")) return false;
  if (reason === "PAYMENT_OR_FINANCIAL" && project.items.some((item) => active(item) &&
    /payment|billing|subscription|charge|支付|账单|订阅|扣款/i.test(text(item)) && !scope.includes(item))) return false;
  const current = evaluateRisk(project).findings.find((entry) => entry.reason_code === reason)!;
  const disposition = project.delivery_policy?.risk_overrides.find((entry) => entry.id === current.override_id);
  return disposition?.status === "CONFIRMED" && currentResolution(disposition) && disposition.resolution === "DEFER_OR_EXCLUDE" &&
    disposition.reason_code === reason && disposition.minimum_mode === current.minimum_mode &&
    fingerprint([...disposition.scope_ids].sort()) === fingerprint(current.scope_ids);
}

function solutionGate(project: Project): {pass: boolean; reason: string} {
  const assessment = assessFeasibility(project);
  const blueprint = project.items.filter((item) => item.type === "solution_blueprint" && item.status !== "REJECTED" && item.status !== "SUPERSEDED").at(-1);
  if (!blueprint?.blueprint_detail) return {pass: false, reason: "No Technical Solution Blueprint has been persisted."};
  if (blueprint.blueprint_detail.feasibility_fingerprint !== assessment.fingerprint) {
    return {pass: false, reason: "The latest blueprint is stale relative to the confirmed feasibility inputs or delivery policy."};
  }
  const unresolved = solutionBlockingInputs(project);
  if (unresolved.length) return {pass: false, reason: unresolved.join(" ")};
  const disposition = blueprint.blueprint_detail.owner_disposition;
  if (disposition === "DELEGATED_TO_XDEV" && !blueprint.blueprint_detail.delegation) {
    return {pass: false, reason: "The approved XDev delegation boundary is missing."};
  }
  const approved = blueprint.status === "CONFIRMED" && (disposition === "APPROVED" || disposition === "DELEGATED_TO_XDEV");
  return approved ? {pass: true, reason: "The current blueprint is explicitly approved or delegated within its XDev boundary."}
    : {pass: false, reason: "The current blueprint is still a proposal and has no explicit Owner approval/delegation."};
}

function auditRequired(project: Project): boolean {
  const selected = project.delivery_policy?.effective_mode;
  if (!selected) return true;
  if (selected !== "FAST_VALIDATION") return true;
  return project.delivery_policy?.risk_overrides.some((entry) => entry.status === "CONFIRMED" &&
    entry.resolution === "UPGRADE_SCOPE" && ranks[entry.minimum_mode] > ranks[selected]) ?? false;
}
function auditPass(project: Project, evidence: M8ReadinessEvidence): {pass: boolean; reason: string} {
  const required = auditRequired(project);
  if (!required && evidence.audit.audit_status === "UNAVAILABLE") {
    return {pass: true, reason: "Independent audit is optional for FAST_VALIDATION when no scoped escalation requires it."};
  }
  const pass = evidence.audit.audit_status === "PASS" && evidence.audit.isolation_status !== "UNAVAILABLE" &&
    evidence.audit.blocking_finding_count === 0;
  return {pass, reason: pass ? "Independent bounded-snapshot audit evidence has no blocking finding."
    : evidence.audit.audit_status === "UNAVAILABLE" ? "Required independent audit evidence is unavailable."
    : "Independent audit evidence contains a blocking finding or lacks an effective isolation boundary."};
}
function hardGates(project: Project, blockers: CompletenessBlocker[], contradictionCount: number, risk: RiskEvaluation,
  evidence: M8ReadinessEvidence): HardGateResult[] {
  const p0p1 = project.items.filter((item) => active(item) && item.type === "functional_requirement" && (item.priority === "P0" || item.priority === "P1"));
  const accountPrivate = applicabilitySignal(project, "ACCOUNT_OR_PRIVATE");
  const integration = applicabilitySignal(project, "INTEGRATION");
  const solution = solutionGate(project);
  const pass = (gate: number, name: string, condition: boolean, reason: string): HardGateResult =>
    ({gate, name, status: condition ? "PASS" : "FAIL", reason: condition ? "Satisfied by canonical XMi state." : reason});
  return [
    pass(1, "supported profile selected", ["web-micro-saas-v0", "digital-game-v0"].includes(project.profile), "The selected product category has no validated completeness profile."),
    pass(2, "no unresolved BLOCKING item", blockers.length === 0 && !project.open_questions.some((q) => q.status === "BLOCKING"), "One or more canonical blockers remain."),
    pass(3, "no unresolved contradiction involving confirmed state", contradictionCount === 0, "A confirmed-state contradiction remains unresolved."),
    pass(4, "core vision, target user and MVP boundary confirmed",
      hasConfirmed(project, ["vision", "goal"]) && hasConfirmed(project, ["actor"]) &&
      hasConfirmed(project, ["decision", "constraint", "exclusion"], /mvp|scope|first version|首版|范围|不做/i), "Core product framing is not fully confirmed."),
    pass(5, "core user journey confirmed", hasConfirmed(project, ["flow"]), "No confirmed core flow exists."),
    pass(6, "every P0/P1 requirement confirmed", p0p1.every((item) => item.status === "CONFIRMED"), "A P0/P1 requirement is not confirmed."),
    pass(7, "every P0/P1 requirement has valid AC", acCoverage(project), "A P0/P1 requirement lacks a linked confirmed acceptance criterion."),
    pass(8, "role/data isolation resolved when applicable", !accountPrivate ||
      (hasConfirmed(project, ["permission_rule"], /role|permission|角色|权限/i) && hasConfirmed(project, ["permission_rule", "functional_requirement"], /isolation|own data|tenant|隔离|自己的数据|租户/i)),
    "Account/private-data scope exists without confirmed role and isolation decisions."),
    pass(9, "high-risk privacy/security questions resolved", risk.unresolved_blocker_count === 0, "A risk minimum or override is unresolved."),
    pass(10, "integration fallback/failure behavior resolved", !integration ||
      hasConfirmed(project, ["integration", "functional_requirement", "acceptance_criterion", "decision"], /fallback|unavailable|fail|降级|不可用|失败/i),
    "An integration exists without confirmed fallback/failure behavior."),
    pass(11, "solution blueprint approved or delegated", solution.pass, solution.reason),
    pass(12, "deterministic schema/reference validation", referencesValid(project), "A canonical item contains an invalid reference or decision option link."),
    pass(13, "independent Auditor has no blocking finding", auditPass(project, evidence).pass, auditPass(project, evidence).reason),
    pass(14, "consumer import compatibility passes", evidence.xui_compatible && evidence.xdev_compatible,
      "Both XUi and XDev conformance consumers must accept the exact immutable package."),
    pass(15, "Owner confirms export version", evidence.owner_confirmed_export && evidence.immutable_export_exists,
      "The exact immutable export must exist and the Owner must confirm that export version."),
  ];
}
function modeGates(project: Project, results: ProfileRuleResult[], risk: RiskEvaluation, evidence: M8ReadinessEvidence): HardGateResult[] {
  const selected = project.delivery_policy?.effective_mode;
  if (!selected) return [{gate: 0, name: "delivery mode selected", status: "FAIL", reason: "No canonical delivery mode is selected."}];
  const req = requiredResults(project, results);
  const coverage = req.every((row) => row.applicability === "NOT_APPLICABLE" || row.confirmed);
  const basic: HardGateResult[] = [
    {gate: 101, name: `${targets[selected]} profile depth`, status: coverage ? "PASS" : "FAIL",
      reason: coverage ? "Mode-required profile rows are confirmed or explicitly not applicable." : "Mode-required profile rows remain unconfirmed."},
    {gate: 102, name: "mode risk floor", status: risk.unresolved_blocker_count === 0 ? "PASS" : "FAIL",
      reason: risk.unresolved_blocker_count === 0 ? "No unresolved mode-risk blocker." : "At least one scope requires stronger treatment or explicit resolution."},
  ];
  if (selected !== "FAST_VALIDATION") {
    const reviewed = evidence.audit.audit_status === "PASS" && evidence.audit.isolation_status !== "UNAVAILABLE" &&
      evidence.audit.blocking_finding_count === 0 &&
      (evidence.audit.assurance_level === "INDEPENDENT_SPEC_REVIEW" || evidence.audit.assurance_level === "INDEPENDENT_PRODUCT_AUDIT");
    basic.push({gate: 103, name: "independent Spec Reviewer", status: reviewed ? "PASS" : "FAIL",
      reason: reviewed ? "Independent review evidence has no blocking finding." : "FAST_DEVELOPMENT or higher requires independent review evidence."});
  }
  if (selected === "PRODUCT_GRADE") {
    const audited = evidence.audit.audit_status === "PASS" && evidence.audit.isolation_status !== "UNAVAILABLE" &&
      evidence.audit.blocking_finding_count === 0 && evidence.audit.assurance_level === "INDEPENDENT_PRODUCT_AUDIT" &&
      evidence.immutable_export_exists;
    basic.push({gate: 104, name: "product audit and immutable evidence", status: audited ? "PASS" : "FAIL",
      reason: audited ? "Independent Product Audit and immutable export evidence are present."
        : "PRODUCT_GRADE requires an independent Product Audit with no blocking finding plus immutable export evidence."});
  }
  return basic;
}

export class CompletenessService {
  profileRules(profile: Project["profile"] = "web-micro-saas-v0"): readonly ProfileRule[] {
    return profile === "digital-game-v0" ? DIGITAL_GAME_V0_RULES : WEB_MICRO_SAAS_V0_RULES;
  }

  evaluate(project: Project, contradictions: {severity: "BLOCKING"}[] = [], evidence: M8ReadinessEvidence = noM8Evidence): ReadinessEvaluation {
    const results = ruleResults(project);
    const risk = evaluateRisk(project);
    const blockers = [
      ...classificationBlockers(project), ...profileBlockers(project, results), ...decisionBlockers(project),
      ...project.open_questions.filter((q) => q.status === "BLOCKING").map((q) => ({id: q.id, category: "OPEN_QUESTION" as const,
        reason: q.reason, affected_ids: q.affected_ids ?? []})),
      ...contradictions.map((_, index) => ({id: `BLOCK-CONTRADICTION-${index + 1}`, category: "CONTRADICTION" as const,
        reason: "An unresolved contradiction involves confirmed state.", affected_ids: []})),
      ...risk.findings.filter((finding) => finding.status === "BLOCKING").map((finding) => ({id: `BLOCK-RISK-${finding.override_id}`,
        category: "RISK" as const, reason: finding.rationale, affected_ids: finding.scope_ids})),
      ...invalidRiskOverrides(project).map(id => ({id: `BLOCK-RISK-REVIEW-${id}`, category: "RISK" as const,
        reason: "A recorded risk disposition has stale or mixed scope. Review retained versus excluded capabilities before export.",
        affected_ids: project.delivery_policy!.risk_overrides.find(entry => entry.id === id)!.scope_ids})),
    ];
    const dim = dimensions(project, results, evidence);
    const score = Math.round(Object.values(dim).reduce((sum, value) => sum + value, 0) / Object.values(dim).length);
    const gates = hardGates(project, blockers, contradictions.length, risk, evidence);
    const modeGateResults = modeGates(project, results, risk, evidence);
    const hardGateReady = gates.every((gate) => gate.status === "PASS") && modeGateResults.every((gate) => gate.status === "PASS");
    return {target: project.delivery_policy?.readiness_target ?? null, qualification: null,
      readiness_status: hardGateReady ? "READY_FOR_XDEV" : "NOT_READY_M8",
      score, dimensions: dim, hard_gates: gates, mode_gates: modeGateResults, hard_gate_ready: hardGateReady,
      blockers, profile_results: results};
  }
}
