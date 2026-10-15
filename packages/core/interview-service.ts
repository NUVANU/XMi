import {riskContext} from "./risk-context.ts";
import type { Candidate, DeliveryMode, Project, SourceRef } from "../shared-types/domain.ts";

export type InterviewStage =
  | "INTAKE" | "USERS_ACTORS" | "CORE_JOURNEY" | "SCOPE_EXCLUSIONS" | "STATE_DATA"
  | "ROLES_PERMISSIONS" | "FAILURE_EDGE" | "INTEGRATIONS" | "NON_FUNCTIONAL"
  | "SOLUTION_CONSTRAINTS" | "ACCEPTANCE_CRITERIA" | "READINESS_CLOSURE";

export type QuestionScore = {
  blocking_impact: number;
  product_behavior_impact: number;
  architecture_impact: number;
  security_privacy_risk: number;
  dependency_unlock_value: number;
  uncertainty_reduction: number;
  user_fatigue_cost: number;
  redundancy_penalty: number;
  premature_detail_penalty: number;
  total: number;
};

export type QuestionCandidate = {
  id: string;
  stage: InterviewStage;
  question: string;
  reason: string;
  score: QuestionScore;
  blocking: boolean;
  mode_relevance: DeliveryMode[];
};

export type ContradictionIssue = {
  id: string;
  confirmed_item_id: string;
  candidate_statement: string;
  confirmed_statement: string;
  reason: string;
  severity: "BLOCKING";
};

export type AnswerAnalysis = {
  candidates: Candidate[];
  contradictions: ContradictionIssue[];
  review_decisions: Candidate[];
  risk_hints: {reason_code: string; rationale: string; minimum_mode: DeliveryMode}[];
};

export type ModeGap = {
  target_mode: DeliveryMode;
  current_mode: DeliveryMode | null;
  missing_stage_ids: InterviewStage[];
  missing_questions: QuestionCandidate[];
  reusable_confirmed_item_ids: string[];
  requires_upgrade: boolean;
};

const modeRank: Record<DeliveryMode, number> = {FAST_VALIDATION: 0, FAST_DEVELOPMENT: 1, PRODUCT_GRADE: 2};
const allModes: DeliveryMode[] = ["FAST_VALIDATION", "FAST_DEVELOPMENT", "PRODUCT_GRADE"];

const stageRules: Array<{
  stage: InterviewStage;
  minMode: DeliveryMode;
  itemTypes: Candidate["type"][];
  tags?: string[];
  question: string;
  reason: string;
  weights: Omit<QuestionScore, "total">;
}> = [
  {stage: "INTAKE", minMode: "FAST_VALIDATION", itemTypes: ["vision", "goal"], question: "What problem should this product solve?", reason: "The product problem and desired outcome anchor every later requirement.", weights: w(5,5,1,0,5,5,1,0,0)},
  {stage: "USERS_ACTORS", minMode: "FAST_VALIDATION", itemTypes: ["actor"], question: "Who will use the first version?", reason: "Actors determine whose goals, permissions and failure cases must be specified.", weights: w(5,5,2,2,5,5,1,0,0)},
  {stage: "CORE_JOURNEY", minMode: "FAST_VALIDATION", itemTypes: ["flow"], tags: ["core"], question: "What main action must a user complete successfully?", reason: "A core journey turns the idea into observable product behavior.", weights: w(5,5,3,1,5,5,1,0,0)},
  {stage: "SCOPE_EXCLUSIONS", minMode: "FAST_VALIDATION", itemTypes: ["exclusion", "constraint"], tags: ["scope", "mvp"], question: "What must be included in the first version?", reason: "A visible MVP boundary prevents silent scope growth.", weights: w(5,5,3,0,4,5,1,0,0)},
  {stage: "STATE_DATA", minMode: "FAST_VALIDATION", itemTypes: ["data_entity", "decision"], tags: ["data", "persistence"], question: "What information must be saved after a session?", reason: "Persistence decisions affect behavior, privacy and implementation shape.", weights: w(4,4,5,4,4,5,1,0,0)},
  {stage: "ROLES_PERMISSIONS", minMode: "FAST_DEVELOPMENT", itemTypes: ["permission_rule"], question: "Will different types of users see different functions or private data?", reason: "Permission boundaries are required for a reviewed MVP when accounts or private data exist.", weights: w(5,5,4,5,5,5,1,0,0)},
  {stage: "FAILURE_EDGE", minMode: "FAST_DEVELOPMENT", itemTypes: ["functional_requirement", "acceptance_criterion"], tags: ["failure", "recovery"], question: "What should the user see or be able to do when the main action fails, times out or is rejected?", reason: "Major failure behavior is part of the core product contract for controlled use.", weights: w(5,5,3,3,4,5,1,0,0)},
  {stage: "INTEGRATIONS", minMode: "FAST_DEVELOPMENT", itemTypes: ["integration"], question: "Which external services, if any, does the first version need?", reason: "External dependencies need explicit fallback and data-sharing behavior.", weights: w(4,4,5,4,5,4,1,0,0)},
  {stage: "NON_FUNCTIONAL", minMode: "FAST_DEVELOPMENT", itemTypes: ["non_functional_requirement"], question: "What speed or performance target matters for the first version?", reason: "Core quality constraints can materially change the product and solution.", weights: w(4,3,5,5,4,4,2,0,0)},
  {stage: "SOLUTION_CONSTRAINTS", minMode: "FAST_DEVELOPMENT", itemTypes: ["solution_constraint"], question: "Is there an existing technology, system or provider the solution must preserve?", reason: "Known solution constraints bound later technical recommendations without deciding them silently.", weights: w(3,2,5,3,4,4,2,0,0)},
  {stage: "ACCEPTANCE_CRITERIA", minMode: "FAST_VALIDATION", itemTypes: ["acceptance_criterion"], question: "What observable result would prove the critical path works correctly?", reason: "Acceptance criteria make the product contract testable.", weights: w(5,5,3,2,5,5,1,0,1)},
  {stage: "READINESS_CLOSURE", minMode: "PRODUCT_GRADE", itemTypes: ["decision", "risk", "non_functional_requirement"], tags: ["operations", "lifecycle", "residual-risk"], question: "Before a long-lived public release, what operational, recovery, lifecycle or residual-risk decisions still need an explicit Owner choice?", reason: "Product-grade readiness requires complete material lifecycle, operations and residual-risk coverage.", weights: w(5,4,5,5,4,4,2,0,0)},
];

const gameQuestions: Partial<Record<InterviewStage, {question: string; reason: string; tags?: string[]}>> = {
  INTAKE: {question: "What experience should players have in this game?", reason: "The intended player experience anchors the game rules."},
  USERS_ACTORS: {question: "Who will play the first version of the game?", reason: "Player, user and protagonist may be different entities."},
  CORE_JOURNEY: {question: "What actions does a player repeat in the core play loop?", reason: "A core loop makes the game behavior observable.", tags: ["core-loop"]},
  SCOPE_EXCLUSIONS: {question: "Which mechanics and content belong in the first playable version?", reason: "The playable scope must be explicit.", tags: ["scope"]},
  STATE_DATA: {question: "What game progress or resources must be saved between sessions?", reason: "Game state, inventory and saves affect behavior."},
  ROLES_PERMISSIONS: {question: "Can players control different characters or access different shared game state?", reason: "Control and visibility must be explicit."},
  FAILURE_EDGE: {question: "What happens when a player attempts an invalid action?", reason: "Recovery and interruption are part of game rules."},
  INTEGRATIONS: {question: "Does play need servers, accounts, payments or other services; what happens when they fail?", reason: "External and online behavior changes the game contract."},
  NON_FUNCTIONAL: {question: "Which devices, controls, performance and accessibility requirements matter?", reason: "The intended platform constrains the experience."},
  ACCEPTANCE_CRITERIA: {question: "What observable play result proves the core loop works as intended?", reason: "Game mechanics need testable outcomes."},
};
const gameStageRules: typeof stageRules = stageRules.map((rule) => ({...rule, ...(gameQuestions[rule.stage] ?? {})}));


// A stage is one module. Peers inherit its priority; never fill a batch from another module.
const moduleFollowups: Record<InterviewStage, [string, string]> = {
  INTAKE: ["What do people do today without this product?", "What outcome would make the product useful to them?"],
  USERS_ACTORS: ["Who helps manage the product?", "What does each user role need to accomplish?"],
  CORE_JOURNEY: ["What starts that action, and what does the user provide?", "What result should the user receive when it succeeds?"],
  SCOPE_EXCLUSIONS: ["What should explicitly stay out of the first version?", "Which included behaviors cannot be postponed?"],
  STATE_DATA: ["Who may share or access that saved information?", "When should saved information be removed or expire?"],
  ROLES_PERMISSIONS: ["Which actions may each role change or approve?", "Which information must remain private to its owner?"],
  FAILURE_EDGE: ["What should happen to unfinished work after a failure?", "How should the user retry or recover?"],
  INTEGRATIONS: ["What data or actions may each external service receive?", "What should happen when a required service is unavailable?"],
  NON_FUNCTIONAL: ["Which privacy, security or accessibility expectations are essential?", "What availability and operating-cost limits matter?"],
  SOLUTION_CONSTRAINTS: ["Must it run locally, in the cloud, or both?", "What budget or maintenance-skill limits must the solution respect?"],
  ACCEPTANCE_CRITERIA: ["What observable result would mean this action failed?", "Which boundary case must work before this feature is accepted?"],
  READINESS_CLOSURE: ["Which risks still need an explicit Owner decision?", "Which lifecycle or recovery rules remain unresolved?"]
};
const gameModuleFollowups: Partial<Record<InterviewStage, [string, string]>> = {
  INTAKE: ["What makes this experience worth playing?", "What outcome should players want to pursue?"],
  USERS_ACTORS: ["Which character or role can each player control?", "Does any role manage shared play or content?"],
  CORE_JOURNEY: ["What starts a play loop?", "What result ends the loop, including winning or losing?"],
  SCOPE_EXCLUSIONS: ["Which mechanics or content stay out for now?", "Which mechanics are essential to the first playable loop?"],
  STATE_DATA: ["Which game state is owned locally or shared with other players?", "When should saves or temporary game state be removed or reset?"],
  FAILURE_EDGE: ["What happens to progress when a player quits or a session disconnects?", "How can the player retry or resume interrupted play?"]
};

function w(blocking_impact: number, product_behavior_impact: number, architecture_impact: number,
  security_privacy_risk: number, dependency_unlock_value: number, uncertainty_reduction: number,
  user_fatigue_cost: number, redundancy_penalty: number, premature_detail_penalty: number) {
  return {blocking_impact, product_behavior_impact, architecture_impact, security_privacy_risk,
    dependency_unlock_value, uncertainty_reduction, user_fatigue_cost, redundancy_penalty, premature_detail_penalty};
}

function score(weights: Omit<QuestionScore, "total">, redundancy = 0, premature = 0): QuestionScore {
  const v = {...weights, redundancy_penalty: redundancy, premature_detail_penalty: premature};
  return {...v, total: v.blocking_impact + v.product_behavior_impact + v.architecture_impact +
    v.security_privacy_risk + v.dependency_unlock_value + v.uncertainty_reduction - v.user_fatigue_cost -
    v.redundancy_penalty - v.premature_detail_penalty};
}

function normalized(text: string): string[] {
  return [...new Set(text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ").split(/\s+/).filter((t) => t.length > 1))];
}
function hasNegation(text: string): boolean {
  return /\b(no|not|never|without|disable|forbid|exclude|anonymous|guest)\b|不|无需|不要|禁止|匿名|游客/i.test(text);
}
function overlap(a: string, b: string): number {
  const aa = new Set(normalized(a)); const bb = new Set(normalized(b));
  if (!aa.size || !bb.size) return 0;
  const common = [...aa].filter((t) => bb.has(t)).length;
  return common / Math.min(aa.size, bb.size);
}
function slug(text: string): string {
  let hash = 2166136261;
  for (const ch of text) {hash ^= ch.charCodeAt(0); hash = Math.imul(hash, 16777619);}
  return (hash >>> 0).toString(36).toUpperCase();
}
function sentenceParts(answer: string): string[] {
  return answer.split(/(?:\r?\n+|(?<=[.!?。！？；;])\s*)/u).map((s) => s.trim()).filter(Boolean).slice(0, 8);
}
function classify(statement: string): Candidate["type"] {
  const s = statement.toLowerCase();
  if (/must not|out of scope|exclude|won't|will not|不做|排除|暂不/.test(s)) return "exclusion";
  if (/permission|role|access|only .* can|own private|limited to|权限|角色|只能|可见|仅.*自己/.test(s)) return "permission_rule";
  if (/flow|journey|then|after|before|步骤|流程|然后|之后/.test(s)) return "flow";
  if (/data|record|store|save|delete|retain|export|数据库|数据|保存|删除|保留|导出/.test(s)) return "data_entity";
  if (/admin|administrator|owner|customer|user|member|player|protagonist|访客|用户|管理员|客户|玩家|主角/.test(s) && statement.length < 220) return "actor";
  if (/stripe|payment|email|api|oauth|openai|map|notification|支付|邮件|接口|登录|地图|通知|ai/.test(s)) return "integration";
  if (/latency|performance|availability|security|privacy|accessibility|scale|cost|性能|安全|隐私|可用性|成本|并发/.test(s)) return "non_functional_requirement";
  if (/accept|given|when|then|should see|验收|当.*时|应显示/.test(s)) return "acceptance_criterion";
  if (/decide|choose|use .* instead|决定|选择|采用/.test(s)) return "decision";
  if (/risk|may fail|danger|风险|可能失败/.test(s)) return "risk";
  if (/budget|local only|must use|provider|vendor|本地|预算|供应商|必须使用/.test(s)) return "solution_constraint";
  if (/goal|outcome|success|目标|结果|成功/.test(s)) return "goal";
  return "functional_requirement";
}
function priorityFor(type: Candidate["type"]): Candidate["priority"] {
  return ["vision", "flow", "functional_requirement", "permission_rule"].includes(type) ? "P0" :
    ["acceptance_criterion", "data_entity", "integration", "non_functional_requirement"].includes(type) ? "P1" : "P2";
}

export class InterviewService {
  analyzeAnswer(project: Project, answer: string, sourceRef: SourceRef): AnswerAnalysis {
    const existingIds = new Set(project.items.map((i) => i.id));
    const candidates = sentenceParts(answer).map((statement, index) => {
      const type = classify(statement);
      let id = `${prefix(type)}-${slug(statement)}`;
      if (existingIds.has(id)) id += `-${index + 1}`;
      return {id, type, statement, status: "PROPOSED" as const, source_refs: [sourceRef], priority: priorityFor(type)};
    });
    const contradictions = candidates.flatMap((candidate) => project.items
      .filter((item) => item.status === "CONFIRMED" && compatible(candidate.type, item.type))
      .filter((item) => overlap(candidate.statement, item.statement) >= 0.38 && hasNegation(candidate.statement) !== hasNegation(item.statement))
      .map((item) => ({id: `CONTRADICTION-${slug(candidate.id + item.id)}`, confirmed_item_id: item.id,
        candidate_statement: candidate.statement, confirmed_statement: item.statement,
        reason: "The new answer overlaps a confirmed product fact but reverses its meaning. Preserve both until the Owner chooses which remains authoritative.", severity: "BLOCKING" as const})));
    const reviewDecisions = relationDecisions(project, candidates);
    for (let left = 0; left < candidates.length; left++) for (let right = left + 1; right < candidates.length; right++) {
      const first = candidates[left]!; const second = candidates[right]!;
      if (!compatible(first.type, second.type) || overlap(first.statement, second.statement) < 0.38 ||
        hasNegation(first.statement) === hasNegation(second.statement)) continue;
      reviewDecisions.push(reviewDecision("CONFLICT-" + slug(first.id + second.id),
        "These two answers appear inconsistent. Which product behavior is intended?",
        [first.statement, second.statement], [...first.source_refs, ...second.source_refs], "BATCH"));
    }
    for (const conflict of contradictions) {
      const candidate = candidates.find((item) => item.statement === conflict.candidate_statement);
      reviewDecisions.push(reviewDecision("CONFLICT-" + slug(conflict.id),
        "The new answer may contradict an already confirmed setting. Which should remain authoritative?",
        [conflict.confirmed_statement, conflict.candidate_statement],
        candidate?.source_refs ?? [], "CONFIRMED"));
    }
    return {candidates, contradictions, review_decisions: reviewDecisions.slice(0, 8), risk_hints: riskHints(answer)};
  }

  questions(project: Project, targetMode?: DeliveryMode, limit = 3): QuestionCandidate[] {
    const mode = targetMode ?? project.delivery_policy?.effective_mode ?? "FAST_VALIDATION";
    const confirmedCore = new Set(project.items.filter((i) => i.status === "CONFIRMED").map((i) => i.type));
    const existingQuestionIds = new Set(project.open_questions.filter((q) => q.status === "OPEN" || q.status === "BLOCKING").map((q) => q.id));
    const rules = project.profile === "digital-game-v0" ? gameStageRules : stageRules;
    const ranked = rules
      .filter((rule) => modeRank[mode] >= modeRank[rule.minMode])
      .filter((rule) => !covered(project, rule.itemTypes, rule.tags))
      .map((rule) => {
        const id = `Q-${rule.stage}`;
        const redundancy = existingQuestionIds.has(id) ? 100 : 0;
        const premature = (rule.stage === "NON_FUNCTIONAL" || rule.stage === "SOLUTION_CONSTRAINTS") && !confirmedCore.has("flow") ? 6 : 0;
        return {id, stage: rule.stage, question: rule.question, reason: rule.reason,
          score: score(rule.weights, redundancy, premature), blocking: rule.weights.blocking_impact >= 5,
          mode_relevance: allModes.filter((candidate) => modeRank[candidate] >= modeRank[rule.minMode])};
      })
      .filter((q) => q.score.total > 0)
      .sort((a, b) => b.score.total - a.score.total || a.id.localeCompare(b.id));
    const selected = ranked[0];
    if (!selected) return [];
    const followups = project.profile === "digital-game-v0"
      ? gameModuleFollowups[selected.stage] ?? moduleFollowups[selected.stage] : moduleFollowups[selected.stage];
    return [selected.question, ...followups].map((question, index) => ({...selected,
      id: index === 0 ? selected.id : selected.id + "-" + (index + 1), question}))
      .filter((question) => !existingQuestionIds.has(question.id))
      .slice(0, Math.max(1, Math.min(8, limit)));
  }

  modeGap(project: Project, targetMode: DeliveryMode): ModeGap {
    const rules = project.profile === "digital-game-v0" ? gameStageRules : stageRules;
    const missing = rules.filter((rule) => modeRank[targetMode] >= modeRank[rule.minMode] && !covered(project, rule.itemTypes, rule.tags));
    return {target_mode: targetMode, current_mode: project.delivery_policy?.effective_mode ?? null,
      missing_stage_ids: missing.map((r) => r.stage), missing_questions: this.questions(project, targetMode, 3),
      reusable_confirmed_item_ids: project.items.filter((i) => i.status === "CONFIRMED").map((i) => i.id).slice(0, 50),
      requires_upgrade: !!project.delivery_policy && modeRank[targetMode] > modeRank[project.delivery_policy.effective_mode]};
  }

  moduleReview(project: Project, requestedModule?: string, questionCount?: number) {
    const active = project.items.filter((item) => item.status !== "REJECTED" && item.status !== "SUPERSEDED");
    const recent = active.map((item, index) => ({item, index}))
      .sort((a, b) => b.item.updated_at.localeCompare(a.item.updated_at) || b.index - a.index);
    const modules = [...new Set(recent.flatMap(({item}) => (item.tags ?? [])
      .filter((tag) => tag.startsWith("module:") && tag.slice(7).trim().length > 0 && tag.slice(7).length <= 80)
      .map((tag) => tag.slice(7))))];
    const module = requestedModule?.trim() ?? modules[0];
    if (!module) return null;
    const matching = active.filter((item) => item.tags?.includes("module:" + module));
    const matchingIds = new Set(matching.map((item) => item.id));
    const pending = [
      ...matching.filter((item) => item.status === "OPEN" || item.status === "BLOCKING" ||
        (item.decision_detail && !item.decision_detail.owner_selection && item.status !== "CONFIRMED"))
        .map((item) => ({id: item.id, question: item.decision_detail?.question ?? item.statement,
          priority: item.priority ?? "P1", blocking: item.status === "BLOCKING" || !!item.tags?.includes("material"),
          options: item.decision_detail?.options.map((option) => ({id: option.id, label: option.label})) ?? []})),
      ...project.open_questions.filter((q) => (q.status === "OPEN" || q.status === "BLOCKING") &&
        q.affected_ids?.some((id) => matchingIds.has(id)) && !matchingIds.has(q.id))
        .map((q) => ({id: q.id, question: q.question, priority: q.priority, blocking: q.status === "BLOCKING", options: []})),
    ].sort((a, b) => Number(b.blocking) - Number(a.blocking) || a.priority.localeCompare(b.priority) || a.id.localeCompare(b.id));
    return {module, available_modules: modules.slice(0, 20), modules_truncated: modules.length > 20,
      review_brief: {format: "MODULE_REVIEW_BRIEF" as const,
        sections: ["CURRENT_DESIGN", "PENDING_DECISIONS_WITH_RECOMMENDATIONS", "EFFECTS_AND_CONFLICTS", "BATCH_REPLY"] as const,
        decision_limit: questionCount ?? 8, recommendations_status: "UNADOPTED" as const, confirmation_granted: false as const},
      pending_decisions: pending.slice(0, 8).map((decision) => ({...decision,
        question: decision.question.slice(0, 400), question_truncated: decision.question.length > 400,
        options: decision.options.slice(0, 8).map((option) => ({...option, label: option.label.slice(0, 400)}))})),
      total_pending_decisions: pending.length, pending_decisions_truncated: pending.length > 8,
      items: matching.slice(-12).map((item) => ({id: item.id, type: item.type, status: item.status,
        statement: item.statement.slice(0, 1200), statement_truncated: item.statement.length > 1200,
        item_version: item.version, source_refs: item.source_refs.slice(0, 3).map((source) => ({...source,
          ref: source.ref.slice(0, 500), ...(source.excerpt ? {excerpt: source.excerpt.slice(0, 240)} : {})})),
        sources_truncated: item.source_refs.length > 3 || item.source_refs.some((source) => source.ref.length > 500 || (source.excerpt?.length ?? 0) > 240),
        links: (item.links ?? []).slice(0, 20), links_truncated: (item.links?.length ?? 0) > 20,
        supersedes: item.supersedes ?? null})),
      total_items: matching.length, truncated: matching.length > 12,
      confirmation_pending: matching.some((item) => item.status !== "CONFIRMED"),
      completion: "NOT_EVALUATED" as const};
  }

  resumePacket(project: Project, requestedModule?: string, questionCount?: number) {
    const moduleReview = this.moduleReview(project, requestedModule, questionCount);
    const next = moduleReview ? [] : this.questions(project, undefined, questionCount);
    const blockers = project.open_questions.filter((q) => q.status === "BLOCKING").slice(0, 5);
    const recentConfirmed = project.items.filter((i) => i.status === "CONFIRMED").slice(-8).map((i) => ({id: i.id, type: i.type, statement: i.statement.slice(0, 240)}));
    return {project_id: project.project_id, model_version: project.model_version,
      mode: project.delivery_policy?.effective_mode ?? null,
      recent_confirmed: recentConfirmed, blockers: blockers.map((b) => ({id: b.id, question: b.question.slice(0, 240)})),
      next_questions: next, module_review: moduleReview, bounded: true};
  }
}

function covered(project: Project, itemTypes: Candidate["type"][], tags?: string[]): boolean {
  return project.items.some((item) => item.status !== "REJECTED" && itemTypes.includes(item.type) &&
    (!tags?.length || tags.some((tag) => item.tags?.includes(tag) || item.statement.toLowerCase().includes(tag.replace("-", " ")))));
}
function compatible(a: Candidate["type"], b: Candidate["type"]): boolean {
  if (a === b) return true;
  const groups = [["decision", "functional_requirement", "constraint", "exclusion"], ["permission_rule", "functional_requirement"], ["data_entity", "functional_requirement"]];
  return groups.some((group) => group.includes(a) && group.includes(b));
}
function prefix(type: Candidate["type"]): string {
  return ({vision: "VISION", actor: "ACTOR", goal: "GOAL", flow: "FLOW", functional_requirement: "REQ",
    acceptance_criterion: "AC", data_entity: "DATA", permission_rule: "PERM", integration: "INT",
    non_functional_requirement: "NFR", decision: "DEC", risk: "RISK", exclusion: "EXC", constraint: "CON",
    solution_constraint: "SOLCON", solution_blueprint: "BLUEPRINT"} as const)[type];
}
function reviewDecision(id: string, question: string, statements: string[], sourceRefs: SourceRef[],
  kind: "RELATION" | "BATCH" | "CONFIRMED"): Candidate {
  const choices = kind === "RELATION"
    ? [["SAME_ENTITY", "Same entity"], ["DIFFERENT_ENTITIES", "Different entities"], ["CONTROL_RELATION", "Control or role relationship"]]
    : kind === "CONFIRMED"
      ? [["KEEP_CONFIRMED", "Keep the confirmed setting"], ["REPLACE_CONFIRMED", "Replace it with the new answer"], ["REVISE_BOTH", "Revise both statements"]]
      : [["KEEP_FIRST", "Keep the first answer"], ["KEEP_SECOND", "Keep the second answer"], ["REVISE_BOTH", "Revise both answers"]];
  const options = choices.map(([optionId, label]) => ({
    id: optionId!, label: label!,
    impact: {user_experience: "Clarifies intended behavior.", cost: "Requires review.", complexity: "Changes the specification interpretation.",
      privacy: "Review if identity or access is affected.", xdev: "Do not implement until the Owner selects."},
  }));
  return {id: "DEC-" + id, type: "decision", statement: question + " " + statements.join(" | "),
    status: "PROPOSED", source_refs: sourceRefs.slice(0, 10), priority: "P0", tags: ["material", "ambiguity"],
    decision_detail: {question, why_it_matters: "An unresolved relationship can change product behavior.",
      options, recommendation: {option_id: kind === "RELATION" ? "CONTROL_RELATION" : "REVISE_BOTH",
        rationale: "Do not silently equate, separate or overwrite statements.", confidence: "LOW"},
      owner_selection: null, linked_requirements: [], linked_flows: [], supersession_history: []}};
}
function relationDecisions(project: Project, candidates: Candidate[]): Candidate[] {
  const groups = [
    {name: "user", pattern: /\buser\b|用户/i},
    {name: "player", pattern: /\bplayer\b|玩家/i},
    {name: "protagonist", pattern: /\bprotagonist\b|主角/i},
  ];
  const mentions = [...project.items.filter((item) => item.status !== "REJECTED"), ...candidates];
  const present = groups.filter((group) => mentions.some((item) => group.pattern.test(item.statement)));
  const decisions: Candidate[] = [];
  for (let left = 0; left < present.length; left++) for (let right = left + 1; right < present.length; right++) {
    const first = present[left]!; const second = present[right]!;
    const id = "RELATION-" + first.name.toUpperCase() + "-" + second.name.toUpperCase();
    if (project.items.some((item) => item.id === "DEC-" + id)) continue;
    const refs = mentions.filter((item) => first.pattern.test(item.statement) || second.pattern.test(item.statement))
      .flatMap((item) => item.source_refs);
    decisions.push(reviewDecision(id, "Do " + first.name + " and " + second.name + " mean the same entity, different entities, or another relationship?",
      [first.name, second.name], refs, "RELATION"));
  }
  return decisions;
}

function riskHints(answer: string) {
  const rules: Array<[RegExp, string, DeliveryMode, string]> = [
    [/auth|login|sign.?in|permission|tenant|private data|登录|认证|权限|租户|私有数据/i, "AUTH_OR_PRIVATE_DATA", "FAST_DEVELOPMENT", "Authentication, authorization or private-data scope needs at least reviewed treatment."],
    [/payment|billing|refund|stripe|charge|支付|账单|退款|收费/i, "PAYMENT_OR_FINANCIAL", "PRODUCT_GRADE", "Payment or financial behavior is a high-risk scope and cannot stay at prototype depth by convenience."],
    [/health|medical|biometric|government id|regulated|医疗|健康|生物识别|监管/i, "SENSITIVE_DATA", "PRODUCT_GRADE", "Sensitive or regulated data requires stronger product specification and audit."],
    [/delete permanently|irreversible|destructive|永久删除|不可逆|破坏性/i, "DESTRUCTIVE_ACTION", "PRODUCT_GRADE", "Irreversible behavior requires explicit recovery and confirmation policy."],
    [/send|publish|post|transfer|external action|自动发送|发布|转账|外部操作/i, "EXTERNAL_SIDE_EFFECT", "FAST_DEVELOPMENT", "External side effects require explicit permission, failure and retry behavior."],
  ];
  return rules.filter(([re]) => re.test(riskContext(answer))).map(([, reason_code, minimum_mode, rationale]) => ({reason_code, minimum_mode, rationale}));
}
