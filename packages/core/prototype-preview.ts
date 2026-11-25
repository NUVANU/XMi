import {z} from "zod";
import type {Project} from "../shared-types/domain.ts";
import {evaluateRisk} from "./completeness-service.ts";
import {requireCondition} from "./errors.ts";
import {fingerprint, rejectSecrets} from "./validation.ts";
import {hasOnlineGameScope} from "./scope-exclusions.ts";

const key = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/u);
const label = z.string().trim().min(1).max(120);
const note = z.string().trim().min(1).max(360);
const option = z.strictObject({id: key, label});
const choice = z.strictObject({id: key, question: label, options: z.array(option).min(2).max(4)});
const step = z.strictObject({id: key, label, kind: z.enum(["START", "ACTION", "CHOICE", "OUTCOME"])});
const edge = z.strictObject({from: key, to: key, label: label.optional()});
const flow = z.strictObject({steps: z.array(step).min(2).max(12), edges: z.array(edge).min(1).max(24)});
const behavior = z.strictObject({show: note, check: note});
const presentation = z.enum(["2D", "3D", "纯文字"]);
const selectedChoice = z.strictObject({id: key, question: label, answer: label});
export const prototypeDraftSchema = z.strictObject({
  goal: note, first_version: z.array(behavior).min(1).max(6), presentation: presentation.optional(),
  flow, questions: z.array(choice).max(6),
});
export const prototypePreviewSchema = z.strictObject({
  format: z.literal("XMI-PROTOTYPE-PREVIEW/1"), project_id: z.string(), model_version: z.number().int().positive(),
  title: z.string(), original_idea: z.string(), goal: note, first_version: z.array(behavior), presentation: presentation.optional(),
  flow_title: z.enum(["游戏流程图", "使用流程图"]), flow,
  questions: z.array(choice), selected_choices: z.array(selectedChoice), blockers: z.array(z.string()),
  defaults: z.array(z.strictObject({id: key, label})), export_enabled: z.boolean(), snapshot_id: z.string().regex(/^[a-f0-9]{64}$/u),
});
export type PrototypePreview = z.infer<typeof prototypePreviewSchema>;

function reachable(start: string, edges: {from: string; to: string}[]): Set<string> {
  const visited = new Set([start]), pending = [start];
  for (const from of pending) {
    for (const edge of edges) if (edge.from === from && !visited.has(edge.to)) {
      pending.push(edge.to);
      visited.add(edge.to);
    }
  }
  return visited;
}

function visibleFlow(draft: z.infer<typeof prototypeDraftSchema>) {
  const {steps} = draft.flow;
  const edges = [...new Map(draft.flow.edges.map(edge => [fingerprint(edge), edge])).values()];
  const byId = new Map(steps.map(step => [step.id, step]));
  const starts = steps.filter(step => step.kind === "START"), outcomes = steps.filter(step => step.kind === "OUTCOME");
  requireCondition(byId.size === steps.length && starts.length === 1 && outcomes.length > 0 &&
    edges.every(edge => byId.has(edge.from) && byId.has(edge.to) && byId.get(edge.from)?.kind !== "OUTCOME" &&
      byId.get(edge.to)?.kind !== "START"), "PROTOTYPE_INVALID_FLOW");
  for (const node of steps.filter(step => step.kind !== "OUTCOME")) {
    const outgoing = edges.filter(edge => edge.from === node.id);
    requireCondition(node.kind === "CHOICE" ? outgoing.length >= 2 && outgoing.every(edge => edge.label) &&
      new Set(outgoing.map(edge => edge.label)).size === outgoing.length : outgoing.length === 1, "PROTOTYPE_INVALID_FLOW");
  }
  requireCondition(reachable(starts[0]!.id, edges).size === steps.length, "PROTOTYPE_INVALID_FLOW");
  const reversed = edges.map(edge => ({from: edge.to, to: edge.from}));
  const canFinish = new Set(outcomes.flatMap(step => [...reachable(step.id, reversed)]));
  requireCondition(canFinish.size === steps.length, "PROTOTYPE_INVALID_FLOW");
  return {steps, edges};
}

const material = (project: Project) => project.items.filter(item =>
  item.type === "decision" && item.tags?.includes("material") &&
  !["CONFIRMED", "REJECTED", "SUPERSEDED"].includes(item.status));
const hasFormalDesign = (project: Project) => !!(project.delivery_policy && project.delivery_policy.effective_mode !== "FAST_VALIDATION") ||
  project.items.some(item => item.status === "CONFIRMED" && item.type !== "vision");

export function defaultPrototypeDesignFlow(project: Project) {
  return hasFormalDesign(project) || prototypeProjectBlockers(project).length ? "STANDARD" as const : "LIGHTWEIGHT" as const;
}

function prototypeProjectBlockers(project: Project, riskProjection = project): string[] {
  const blockers: string[] = [];
  if (project.lifecycle_state === "ARCHIVED" || project.profile === "unsupported" ||
    (project.delivery_policy && project.delivery_policy.effective_mode !== "FAST_VALIDATION"))
    blockers.push("这个项目需要沿用原有的规格流程。");
  if (project.items.some(item => item.type === "risk" && !["REJECTED", "SUPERSEDED"].includes(item.status)) ||
    evaluateRisk(riskProjection).findings.length) blockers.push("这个版本还有需要核实的项目风险。");
  if (project.profile === "digital-game-v0" && project.items.some(item => !["REJECTED", "SUPERSEDED"].includes(item.status) && hasOnlineGameScope(item.statement)))
    blockers.push("联机或多人玩法需要走对应的规格流程。");
  if (project.items.some(item => item.status === "CONFIRMED" && item.type !== "vision"))
    blockers.push("已有正式规格的项目继续使用原有的规格流程。");
  if (project.open_questions.some(question => question.status === "BLOCKING")) blockers.push("还有已记录的关键选择需要回答。");
  return blockers;
}
const privatePrototype = [
  {id: "local-preview", label: "第一版仅在本地浏览器供一人试玩或试用。"},
  {id: "sample-data", label: "只使用公开合成案例。"},
  {id: "no-integration", label: "不接入外部服务或 API，不公开分享。"},
  {id: "scale", label: "只验证一人独立走通流程。"},
  {id: "cost", label: "选用无额外费用、维护简单的原型方案。"},
  {id: "implementation", label: "后续开发可在以上范围内决定内部做法，保留这张卡上的体验、数据范围和费用边界。"},
];
const privateGame = [
  {id: "no-account", label: "无账号，仅使用公开合成案例。"},
  {id: "no-payment", label: "原型全程免费。"},
  {id: "no-online", label: "原型全程离线，单人游玩。"},
];
const privateTool = [
  ...privateGame.filter(item => item.id !== "no-online"),
  {id: "tool-persistence", label: "需要保存的示例留在当前设备，其余输入只在当前会话使用。"},
  {id: "tool-data-safety", label: "首版只处理公开合成示例，示例不含身份信息。"},
];
const visualQuestion = {id: "presentation", question: "你想要哪种游戏画面？",
  options: [{id: "flat", label: "2D 平面"}, {id: "solid", label: "3D 立体"}, {id: "text", label: "纯文字"}]};

/** Draft projection only. The design text never grants capability or changes an Owner decision. */
export function prototypePreview(project: Project, input: unknown, selectedChoices: PrototypePreview["selected_choices"] = []): PrototypePreview {
  const draft = prototypeDraftSchema.parse(input);
  rejectSecrets(draft);
  const game = project.profile === "digital-game-v0";
  const questions = draft.questions.filter(question => question.id !== visualQuestion.id);
  if (game && !draft.presentation) questions.push(visualQuestion);
  requireCondition(questions.length <= 6 && new Set(questions.map(question => question.id)).size === questions.length &&
    questions.every(question => new Set(question.options.map(option => option.id)).size === question.options.length &&
      new Set(question.options.map(option => option.label)).size === question.options.length), "PROTOTYPE_INVALID_QUESTIONS");
  const source = project.items[0];
  const statements = [draft.goal, ...draft.first_version.flatMap(feature => [feature.show, feature.check]),
    ...draft.flow.steps.map(step => step.label), ...draft.flow.edges.flatMap(edge => edge.label ?? [])];
  const riskProjection = source ? {...project, items: [...project.items, ...statements
    .map((statement, i) => ({...source, id: "PROTOTYPE-DRAFT-" + i, type: "flow" as const, statement}))]} : project;
  const blockers = prototypeProjectBlockers(project, riskProjection);
  if (game && statements.some(hasOnlineGameScope))
    blockers.push("联机或多人玩法需要走对应的规格流程。");
  if (material(project).length)
    blockers.push("还有已记录的关键选择需要回答。");
  const snapshot = {format: "XMI-PROTOTYPE-PREVIEW/1" as const, project_id: project.project_id,
    model_version: project.model_version, title: project.title,
    original_idea: project.items.find(item => item.type === "vision" && item.status !== "REJECTED")?.statement ?? "",
    goal: draft.goal, first_version: [...new Map(draft.first_version.map(item => [fingerprint(item), item])).values()],
    ...(game && draft.presentation ? {presentation: draft.presentation} : {}),
    flow_title: game ? "游戏流程图" as const : "使用流程图" as const,
    flow: visibleFlow(draft), questions, selected_choices: selectedChoices, blockers: [...new Set(blockers)],
    defaults: [...privatePrototype, ...(game ? privateGame : privateTool)],
    export_enabled: questions.length === 0 && blockers.length === 0};
  return prototypePreviewSchema.parse({...snapshot, snapshot_id: fingerprint(snapshot)});
}
