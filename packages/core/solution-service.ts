import type { AICapabilityProfile, Candidate, DeliveryMode, ModelResolutionRecord, Project, SourceRef } from "../shared-types/domain.ts";
import { requireCondition } from "./errors.ts";
import { evaluateRisk } from "./completeness-service.ts";
import { assessFeasibility, confirmedSolutionInputs } from "./solution-feasibility.ts";
import { recommendSolutions } from "./solution-options.ts";
import { fingerprint } from "./validation.ts";

export type ModelResolutionInput = {
  provider: string;
  model: string;
  alternatives?: string[];
  resolved_at: string;
  source_version: string;
  capability_match: string[];
  pricing_privacy_assumptions: string[];
  revalidation_requirement: string;
};

export type SolutionReview = {
  status: "BLOCKED_PREREQUISITES" | "BLOCKED_RISK" | "PROPOSAL_AVAILABLE" | "PERSISTED";
  feasibility: ReturnType<typeof assessFeasibility>;
  risk_blocker_ids: string[];
  persisted_item_id: string | null;
  persisted_status: string | null;
  proposed_patch: {kind: "ADD_CANDIDATE"; candidate: Candidate} | null;
  limitation: string;
};

const confirmedText = (project: Project) => confirmedSolutionInputs(project)
  .map((item) => `${item.statement} ${(item.tags ?? []).join(" ")}`);
const first = (values: string[], re: RegExp, fallback: string) => values.find((value) => re.test(value)) ?? fallback;
const has = (values: string[], re: RegExp) => values.some((value) => re.test(value));

function modeProfile(mode: DeliveryMode, profile: Project["profile"]) {
  if (profile === "digital-game-v0") return {
    stack: "Digital-game solution boundary: preserve confirmed target platforms, core mechanics, state ownership and online/offline constraints. XDev chooses implementation architecture within the approved blueprint.",
    gaps: [mode === "FAST_VALIDATION"
      ? "A game prototype does not establish production networking, distribution, persistence, moderation or payment readiness."
      : "Game implementation and release still require the mode-specific review, consumer compatibility and operational evidence."],
  };
  if (mode === "FAST_VALIDATION") return {
    stack: "Bounded General product prototype profile: prefer local, mock or sandbox boundaries where confirmed constraints permit; do not infer production topology.",
    gaps: [
      "FAST_VALIDATION does not establish production deployment, tenant isolation, recovery, observability or release operations.",
      "Real integrations, private data, payment and destructive behavior require the M5 risk floor and explicit scoped treatment before implementation.",
    ],
  };
  if (mode === "FAST_DEVELOPMENT") return {
    stack: "Deployable General product MVP profile: explicit web client, bounded backend/data ownership, isolation boundary and integration-failure behavior.",
    gaps: [
      "FAST_DEVELOPMENT is not a production certification; full operations, recovery evidence, domain audit and immutable release evidence remain later gates.",
    ],
  };
  return {
    stack: "Product-grade General product planning profile: explicit deployment, data/identity boundaries, operations, recovery, security/privacy and maintainability constraints for XDev planning.",
    gaps: [
      "A PRODUCT_GRADE blueprint narrows the solution space but does not replace M8 independent audit, M7 deterministic export/consumer validation or release evidence.",
    ],
  };
}

function aiProfile(project: Project): AICapabilityProfile | null {
  const values = confirmedText(project);
  const ai = project.items.filter((item) => item.status === "CONFIRMED")
    .filter((item) => /\bai\b|llm|language model|vision model|image generation|speech model|模型|大模型|人工智能|生图|语音/i
      .test(`${item.statement} ${(item.tags ?? []).join(" ")}`));
  if (!ai.length) return null;
  const seed = ai.map((item) => ({id: item.id, version: item.version, statement: item.statement}));
  const modalities = new Set<"TEXT" | "IMAGE" | "AUDIO" | "VIDEO">(["TEXT"]);
  if (has(values, /image|vision|photo|图像|图片|视觉|生图/i)) modalities.add("IMAGE");
  if (has(values, /audio|speech|voice|语音|音频/i)) modalities.add("AUDIO");
  if (has(values, /video|视频/i)) modalities.add("VIDEO");
  const unresolved: string[] = [];
  const read = (re: RegExp, label: string) => {
    const value = first(values, re, "UNSPECIFIED");
    if (value === "UNSPECIFIED") unresolved.push(label);
    return value;
  };
  return {
    id: `AI-CAPABILITY-${fingerprint(seed).slice(0, 12).toUpperCase()}`,
    modalities: [...modalities],
    latency: read(/latency|response time|实时|延迟|响应时间/i, "AI latency target"),
    quality_reasoning: read(/reasoning|quality|accuracy|推理|质量|准确/i, "AI quality/reasoning target"),
    tool_use: read(/tool|function call|agent action|工具|函数调用|代理操作/i, "AI tool-use boundary"),
    context_size: read(/context|long document|token|上下文|长文档/i, "AI context-size need"),
    privacy_data_residency: read(/privacy|residency|private data|local data|隐私|数据驻留|私有数据/i, "AI privacy/data residency"),
    cost_envelope: read(/cost|budget|quota|成本|预算|额度/i, "AI cost envelope"),
    structured_output_reliability: read(/structured|json|schema|结构化|模式/i, "AI structured-output reliability"),
    safety_constraints: read(/safety|moderation|guardrail|安全|审核|护栏/i, "AI safety constraints"),
    offline_on_device_need: read(/offline|on[- ]?device|local model|离线|端侧|本地模型/i, "AI offline/on-device need"),
    unresolved_constraints: unresolved,
  };
}

type ApprovalTrigger = "RECURRING_COST" | "PRIVACY_DATA_EXPOSURE" | "THIRD_PARTY_LOCK_IN" |
  "PRODUCT_BEHAVIOR" | "OFFLINE_CAPABILITY" | "LEGAL_COMPLIANCE_RISK" | "LONG_TERM_MAINTENANCE";

function approvalTriggers(project: Project): ApprovalTrigger[] {
  const values = confirmedText(project).join("\n");
  const triggers = new Set<ApprovalTrigger>(["LONG_TERM_MAINTENANCE"]);
  if (/cost|budget|cloud|subscription|payment|成本|预算|云|订阅|支付/i.test(values)) triggers.add("RECURRING_COST");
  if (/private|personal|sensitive|tenant|隐私|私有|个人|敏感|租户/i.test(values)) triggers.add("PRIVACY_DATA_EXPOSURE");
  if (/integration|provider|api|oauth|stripe|openai|供应商|接口|第三方/i.test(values)) triggers.add("THIRD_PARTY_LOCK_IN");
  if (/offline|local|on[- ]?device|离线|本地|端侧/i.test(values)) triggers.add("OFFLINE_CAPABILITY");
  if (/regulated|compliance|legal|监管|合规|法律/i.test(values)) triggers.add("LEGAL_COMPLIANCE_RISK");
  if (/flow|behavior|journey|流程|行为|路径/i.test(values)) triggers.add("PRODUCT_BEHAVIOR");
  return [...triggers];
}

export class SolutionService {
  review(project: Project, sourceRef: SourceRef): SolutionReview {
    const feasibility = assessFeasibility(project);
    const latest = project.items.filter((item) => item.type === "solution_blueprint" && item.status !== "REJECTED" && item.status !== "SUPERSEDED").at(-1);
    if (latest?.blueprint_detail?.feasibility_fingerprint === feasibility.fingerprint) {
      return {status: "PERSISTED", feasibility, risk_blocker_ids: [], persisted_item_id: latest.id,
        persisted_status: latest.status, proposed_patch: null,
        limitation: "The current feasibility fingerprint already has a persisted blueprint item; read canonical state before proposing a replacement."};
    }
    if (!project.delivery_policy || !feasibility.ready) {
      return {status: "BLOCKED_PREREQUISITES", feasibility, risk_blocker_ids: [], persisted_item_id: null,
        persisted_status: null, proposed_patch: null,
        limitation: "All eight confirmed feasibility inputs and a selected delivery mode are required before XMi may propose a solution blueprint."};
    }
    const risk = evaluateRisk(project);
    const riskBlockers = risk.findings.filter((finding) => finding.status === "BLOCKING").map((finding) => finding.override_id);
    if (riskBlockers.length) {
      return {status: "BLOCKED_RISK", feasibility, risk_blocker_ids: riskBlockers, persisted_item_id: null,
        persisted_status: null, proposed_patch: null,
        limitation: "M5 mode-risk blockers must be resolved before a blueprint can be proposed; M6 does not waive or export scoped overrides."};
    }
    return {status: "PROPOSAL_AVAILABLE", feasibility, risk_blocker_ids: [], persisted_item_id: null,
      persisted_status: null, proposed_patch: {kind: "ADD_CANDIDATE", candidate: this.propose(project, sourceRef)},
      limitation: "This is an unconfirmed proposal. Saving it does not approve it; Owner approval or bounded delegation is a separate host-confirmed write."};
  }

  propose(project: Project, sourceRef: SourceRef): Candidate {
    const assessment = assessFeasibility(project);
    requireCondition(project.delivery_policy, "MODE_SELECTION_REQUIRED");
    requireCondition(assessment.ready, "SOLUTION_PREREQUISITES_INCOMPLETE");
    requireCondition(evaluateRisk(project).unresolved_blocker_count === 0, "SOLUTION_RISK_BLOCKED");
    const mode = project.delivery_policy.effective_mode;
    const values = confirmedText(project);
    const profile = modeProfile(mode, project.profile);
    const account = has(values, /account|login|auth|permission|private|tenant|账号|登录|认证|权限|私有|租户/i);
    const integration = has(values, /integration|provider|api|oauth|payment|email|map|ai|集成|供应商|接口|支付|邮件|地图|人工智能/i);
    const selection = recommendSolutions(project);
    const {options, recommended, local} = selection;
    const capability = aiProfile(project);
    const blueprintId = `BLUEPRINT-${fingerprint({project_id: project.project_id, assessment: assessment.fingerprint, mode}).slice(0, 12).toUpperCase()}`;
    const preserve = confirmedSolutionInputs(project).filter((item) => (["solution_constraint", "constraint", "non_functional_requirement", "exclusion"].includes(item.type) ||
        item.tags?.some((tag) => ["technology-choice", "stack", "engine"].includes(tag))))
      .map((item) => item.statement);
    requireCondition(preserve.length < 30, "SOLUTION_CONSTRAINT_LIMIT");
    preserve.push("XDev may refine module architecture and implementation details but must return an amendment request before replacing an approved material solution constraint.");
    const delegated = ["Module boundaries and internal decomposition within the approved stack profile.",
      "Library/package and internal API choices that do not change recurring cost, privacy exposure, lock-in, product behavior, offline capability, legal risk or maintenance commitment."];
    return {
      id: blueprintId, type: "solution_blueprint", statement: `Technical Solution Blueprint proposal for ${project.title}`,
      status: "PROPOSED", source_refs: [sourceRef, {type: "system_rule", ref: "xmi:m13-solution-catalog:2026-10-01"}], priority: "P0",
      links: [...new Set(assessment.inputs.flatMap((entry) => entry.evidence_ids))], tags: ["m6", "solution-blueprint", mode.toLowerCase()],
      blueprint_detail: {
        blueprint_id: blueprintId, mode,
        feasibility_inputs: assessment.inputs.map((entry) => ({key: entry.key, evidence_ids: entry.evidence_ids})),
        feasibility_fingerprint: assessment.fingerprint,
        deployment_topology: selection.game || selection.mobile || selection.desktop ? "按确认的目标设备发布客户端；只在确认了联网或共享状态需求时引入服务端。" : local ? "Local-first/browser-hosted boundary unless a confirmed integration requires a server-side component."
          : "Web client plus a bounded application/backend boundary; deployment provider remains an implementation choice unless explicitly confirmed.",
        client_form_factor: first(assessment.inputs.find((entry) => entry.key === "TARGET_PLATFORM")!.evidence_ids.map((id) => project.items.find((item) => item.id === id)!.statement), /web|browser|mobile|desktop|pc|windows|android|ios|网页|浏览器|移动端|桌面|平台/i, project.profile === "digital-game-v0" ? "Game target platform remains unresolved." : "Web browser client form factor as defined by the supported V0 profile."),
        backend_need: selection.game ? "后端仅在已确认的联网、账户或共享状态需求要求时引入；单机存档不自动要求服务端。" : integration || account ? "Backend boundary is required for confirmed identity, private-data or integration behavior; keep it narrow and policy-enforcing."
          : "No backend is implied beyond confirmed persistence/integration needs; XDev may keep the prototype local where the approved mode permits.",
        persistence_data_ownership: first(values, /persist|save|data|owner|retain|delete|保存|持久|数据|所有权|保留|删除/i,
          "Preserve confirmed data ownership and persistence decisions; do not invent new retained data."),
        authentication_authorization: account ? "Enforce confirmed identity, role and isolation rules at the authoritative data/service boundary."
          : "No account/authentication system is added unless the confirmed Product Model requires it.",
        integration_boundaries: integration ? "Keep every confirmed external provider behind an explicit failure/fallback and data-sharing boundary."
          : "No external integration is added silently; an approved Product Model amendment is required for new external side effects.",
        ai_capability_boundary: capability ? `Provider-neutral AI capability profile ${capability.id} constrains later model resolution; it does not select a provider.`
          : "No product AI capability is confirmed; do not add an AI provider/model dependency silently.",
        reliability_privacy_constraints: first(values, /availability|recovery|privacy|security|sensitive|可用性|恢复|隐私|安全|敏感/i,
          "Reliability/privacy implementation must preserve confirmed risk and data-sensitivity boundaries; unconfirmed production assurances remain gaps."),
        recommended_stack_profile: `${recommended.summary} ${profile.stack}`,
        alternatives_tradeoffs: options.map((option) => `${option.label}: ${option.summary} ${option.trade_offs.join(" ")}`).join("\n"),
        xdev_must_preserve: preserve,
        decisions_delegated_to_xdev: delegated,
        options,
        recommendation: {option_id: recommended.id,
          why_it_fits: selection.why,
          trade_offs: recommended.trade_offs, risks: recommended.risks, owner_decision_required: true,
          confidence: "LOW", unresolved_inputs: [...selection.unresolved, ...(capability?.unresolved_constraints ?? [])].slice(0, 20)},
        production_gaps: profile.gaps,
        approval_triggers: approvalTriggers(project), owner_disposition: null, delegation: null,
        ai_capability_profile: capability, model_resolution: null,
      },
    };
  }

  resolveModel(profile: AICapabilityProfile, input: ModelResolutionInput): ModelResolutionRecord {
    requireCondition(!!profile, "AI_CAPABILITY_PROFILE_REQUIRED");
    requireCondition(Number.isFinite(Date.parse(input.resolved_at)), "INVALID_MODEL_RESOLUTION_DATE");
    requireCondition(input.source_version.trim().length > 0, "MODEL_RESOLUTION_SOURCE_REQUIRED");
    requireCondition(input.capability_match.length > 0, "MODEL_CAPABILITY_MATCH_REQUIRED");
    requireCondition(input.pricing_privacy_assumptions.length > 0, "MODEL_ASSUMPTIONS_REQUIRED");
    requireCondition(input.revalidation_requirement.trim().length > 0, "MODEL_REVALIDATION_REQUIRED");
    const id = `MODEL-RESOLUTION-${fingerprint({profile: profile.id, provider: input.provider, model: input.model,
      resolved_at: input.resolved_at, source_version: input.source_version}).slice(0, 12).toUpperCase()}`;
    return {id, capability_profile_id: profile.id, provider: input.provider, model: input.model,
      alternatives: input.alternatives ?? [], resolved_at: input.resolved_at, source_version: input.source_version,
      capability_match: input.capability_match, pricing_privacy_assumptions: input.pricing_privacy_assumptions,
      revalidation_requirement: input.revalidation_requirement};
  }

  attachModelResolution(candidate: Candidate, resolution: ModelResolutionRecord): Candidate {
    requireCondition(candidate.type === "solution_blueprint" && candidate.blueprint_detail, "BLUEPRINT_DETAIL_REQUIRED");
    requireCondition(candidate.blueprint_detail.ai_capability_profile, "AI_CAPABILITY_PROFILE_REQUIRED");
    requireCondition(resolution.capability_profile_id === candidate.blueprint_detail.ai_capability_profile.id,
      "MODEL_CAPABILITY_PROFILE_MISMATCH");
    return {...candidate, blueprint_detail: {...candidate.blueprint_detail, model_resolution: resolution}};
  }
}
