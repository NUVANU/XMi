import type { FeasibilityKey, Item, Project } from "../shared-types/domain.ts";
import { fingerprint } from "./validation.ts";

export type FeasibilityInputState = {
  key: FeasibilityKey;
  satisfied: boolean;
  evidence_ids: string[];
  reason: string;
};

export type FeasibilityAssessment = {
  ready: boolean;
  satisfied_count: number;
  total_count: 8;
  inputs: FeasibilityInputState[];
  fingerprint: string;
};

// A blueprint is derived output, never input evidence for its own freshness or product decisions.
export const confirmedSolutionInputs = (project: Project) => project.items.filter((item) =>
  item.status === "CONFIRMED" && item.type !== "solution_blueprint");
const confirmed = confirmedSolutionInputs;
const body = (item: Item) => `${item.statement} ${(item.tags ?? []).join(" ")}`.toLowerCase();

function hits(project: Project, types: Item["type"][], pattern?: RegExp, tags: string[] = []): Item[] {
  return confirmed(project).filter((item) => types.includes(item.type)).filter((item) => {
    if (!pattern && !tags.length) return true;
    const tagSet = new Set((item.tags ?? []).map((tag) => tag.toLowerCase()));
    return tags.some((tag) => tagSet.has(tag)) || !!pattern?.test(body(item));
  });
}

function input(key: FeasibilityKey, items: Item[], reason: string): FeasibilityInputState {
  return {key, satisfied: items.length > 0, evidence_ids: items.map((item) => item.id).sort().slice(0, 20), reason};
}

export function assessFeasibility(project: Project): FeasibilityAssessment {
  const inputs: FeasibilityInputState[] = [
    input("TARGET_USERS", hits(project, ["actor"]), "A confirmed target user/actor is required before solution selection."),
    input("CORE_FLOW", hits(project, ["flow"]), "A confirmed core flow is required before solution selection."),
    input("DATA_SENSITIVITY", hits(project, ["decision", "risk", "data_entity", "constraint", "solution_constraint"],
      /sensitive|non[- ]?sensitive|private|public data|personal data|pii|regulated|敏感|非敏感|私有|公开数据|个人数据|监管/i,
      ["data-sensitivity"]), "Data sensitivity must be explicitly known."),
    input("LOCAL_CLOUD_REQUIREMENT", hits(project, ["decision", "constraint", "solution_constraint", "non_functional_requirement"],
      /local|cloud|on[- ]?device|browser[- ]?only|hosted|self[- ]?host|本地|云端|端侧|浏览器|托管|自托管/i,
      ["deployment", "local-cloud"]), "The local/cloud requirement must be explicitly known."),
    input("SCALE_LATENCY_NEEDS", hits(project, ["non_functional_requirement", "constraint", "solution_constraint"],
      /scale|concurrent|latency|response time|throughput|users|规模|并发|延迟|响应时间|吞吐|用户量/i,
      ["scale", "latency", "performance"]), "Rough scale or latency needs must be known."),
    input("INTEGRATION_CONSTRAINTS", hits(project, ["integration", "decision", "constraint", "exclusion", "solution_constraint"],
      /integration|provider|api|oauth|payment|email|map|ai|no external|no integration|集成|供应商|接口|支付|邮件|地图|无外部|不集成/i,
      ["integration", "integrations-none"]), "Integration constraints, including an explicit none decision, must be known."),
    input("COST_MAINTENANCE_PREFERENCE", hits(project, ["non_functional_requirement", "decision", "constraint", "solution_constraint"],
      /cost|budget|maintenance|maintain|operator|ops burden|成本|预算|维护|运维|操作能力/i,
      ["cost", "maintenance"]), "Cost and maintenance preference must be known."),
    input("TARGET_PLATFORM", hits(project, ["non_functional_requirement", "decision", "constraint", "solution_constraint"],
      /web|browser|mobile|desktop|platform|ios|android|网页|浏览器|移动端|桌面|平台/i,
      ["platform", "device", "browser"]), "The target platform must be explicitly known."),
  ];
  const evidence = inputs.flatMap((entry) => entry.evidence_ids.map((id) => {
    const item = project.items.find((candidate) => candidate.id === id)!;
    return {id: item.id, version: item.version, fingerprint: fingerprint(item)};
  }));
  const extraConstraints = confirmed(project).filter((item) => !evidence.some((entry) => entry.id === item.id));
  evidence.push(...extraConstraints.map((item) => ({id: item.id, version: item.version, fingerprint: fingerprint(item)})).sort((a, b) => a.id.localeCompare(b.id)));
  const value = fingerprint({profile: project.profile, mode: project.delivery_policy?.effective_mode ?? null,
    risk_overrides: project.delivery_policy?.risk_overrides ?? [], evidence});
  const satisfied = inputs.filter((entry) => entry.satisfied).length;
  return {ready: satisfied === 8, satisfied_count: satisfied, total_count: 8, inputs, fingerprint: value};
}
