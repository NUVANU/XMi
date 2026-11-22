import {requireCondition} from "../../packages/core/errors.ts";
import {evaluateRisk} from "../../packages/core/completeness-service.ts";
import {fingerprint, itemFingerprint, modeFingerprint} from "../../packages/core/validation.ts";
import {ProjectService} from "../../packages/core/project-service.ts";
import {MemoryProjectStore} from "../../packages/storage/memory.ts";
import {prototypePreview, prototypePreviewSchema} from "../../packages/core/prototype-preview.ts";
import {SolutionService} from "../../packages/core/solution-service.ts";
import {XSpecService} from "../../packages/core/xspec-service.ts";
import type {PrototypePreview} from "../../packages/core/prototype-preview.ts";
import type {Command, Item, Project, SourceRef} from "../../packages/shared-types/domain.ts";
import {designOptions} from "./design-options.ts";
import {numberedFlow} from "./flow-order.ts";
import {openPrototypeConfirmationStore, publishPrototypeExport} from "./prototype-export.ts";

function projection(source: Project, preview: PrototypePreview, service: ProjectService): Project {
  const grant = {type: "owner_action" as const, ref: "dreamkids:confirmed-prototype-document:" + preview.snapshot_id};
  const policy: SourceRef = {type: "system_rule", ref: "xmi:dreamkids-private-prototype-v1"};
  const original = source.items.find(item => item.type === "vision")?.source_refs ?? [];
  const reason = "确认输出设计卡所示的本地私有原型文档。";
  let project = service.create({title: source.title, idea: preview.goal, profile: source.profile,
    source_ref: original[0] ?? policy, idempotency_key: preview.snapshot_id});
  const apply = (command: Command, actor: "owner" | "agent" = "owner") => {
    const expected_version = project.model_version;
    project = service.execute({project_id: project.project_id, expected_version,
      idempotency_key: "prototype:" + expected_version, command}, actor);
  };
  const add = (id: string, type: Item["type"], statement: string, refs: SourceRef[], links?: string[], tags?: string[]) => {
    apply({kind: "CANDIDATE_EXTRACTED", candidate: {id, type, statement,
      source_refs: refs.length ? refs : [policy], links, tags, status: "PROPOSED"}}, "agent");
    const item = project.items.at(-1)!;
    apply({kind: "ITEM_CONFIRMED", item_id: id, fingerprint: itemFingerprint(item),
      owner_action: {intent: "CONFIRM", source_ref: grant}});
  };
  const game = source.profile === "digital-game-v0";
  const scope = new Map(preview.defaults.map(({id, label}) => [id, label]));
  const displayedDefault = (id: string) => {
    const label = scope.get(id);
    requireCondition(label, "PROTOTYPE_PREVIEW_CHANGED");
    return label;
  };
  const kinds = {START: "开始", ACTION: "动作", CHOICE: "分支", OUTCOME: "结果"};
  const steps = numberedFlow(preview.flow);
  const labels = new Map(steps.map(node => [node.id, node.number + ". " + node.label]));
  const path = [...steps.map(node => labels.get(node.id) + " [" + kinds[node.kind] + "]"),
    ...preview.flow.edges.map(edge => labels.get(edge.from) + (edge.label ? " → " + edge.label : "") + " → " + labels.get(edge.to))].join("\n");
  // The display is accepted once at the trusted host boundary. Domain events bind
  // each projected subject to that exact display, so XDev can trace the package.
  apply({kind: "DELIVERY_MODE_SELECTED", mode: "FAST_VALIDATION", reason,
    fingerprint: modeFingerprint(project, "FAST_VALIDATION", reason), owner_action: {intent: "CONFIRM", source_ref: grant}});
  const vision = project.items[0]!;
  apply({kind: "ITEM_CONFIRMED", item_id: vision.id, fingerprint: itemFingerprint(vision),
    owner_action: {intent: "CONFIRM", source_ref: grant}});
  if (game) add("GOAL-PROTOTYPE", "goal", preview.goal, original, [vision.id], ["game-premise", "player-outcome"]);
  add("ACTOR-PROTOTYPE", "actor", "一人独立试玩或试用。", [policy], undefined, game ? ["player-actor"] : undefined);
  add("FLOW-PROTOTYPE", "flow", preview.flow_title + "\n" + path, [policy], ["ACTOR-PROTOTYPE"],
    game ? ["core-loop", "game-outcome"] : undefined);
  for (const [index, choice] of preview.selected_choices.entries())
    add("CHOICE-PROTOTYPE-" + (index + 1), "constraint", choice.question + " " + choice.answer, [policy], ["FLOW-PROTOTYPE"]);
  preview.first_version.forEach((feature, index) => {
    const id = "REQ-PROTOTYPE-" + (index + 1);
    add(id, "functional_requirement", feature.show, original, ["FLOW-PROTOTYPE"], game ? ["game-mechanics"] : undefined);
    add("AC-PROTOTYPE-" + (index + 1), "acceptance_criterion", feature.check, original, [id], ["manual"]);
  });
  add("SCOPE-PROTOTYPE", "constraint", "首版范围：" + displayedDefault("local-preview"), [policy],
    ["FLOW-PROTOTYPE", ...preview.first_version.map((_, index) => "REQ-PROTOTYPE-" + (index + 1))], ["scope", "mvp"]);
  add("PLATFORM-PROTOTYPE", "solution_constraint", displayedDefault("local-preview"), [policy], undefined, ["platform", "local-cloud"]);
  add("DATA-PROTOTYPE", "data_entity", displayedDefault("sample-data"), [policy], undefined, ["data-sensitivity"]);
  add("INTEGRATIONS-PROTOTYPE", "exclusion", displayedDefault("no-integration"), [policy], undefined, ["integrations-none"]);
  add("SCALE-PROTOTYPE", "non_functional_requirement", displayedDefault("scale"), [policy], undefined, ["scale"]);
  add("COST-PROTOTYPE", "non_functional_requirement", displayedDefault("cost"), [policy], undefined, ["cost"]);
  if (game) {
    add("ACCOUNTS-PROTOTYPE", "exclusion", displayedDefault("no-account"), [policy], undefined, ["profile-applicability:account_or_private:not-applicable"]);
    add("PAYMENTS-PROTOTYPE", "exclusion", displayedDefault("no-payment"), [policy], undefined, ["profile-applicability:commercial:not-applicable"]);
    add("ONLINE-PROTOTYPE", "exclusion", displayedDefault("no-online"), [policy], undefined, ["profile-applicability:game_online:not-applicable"]);
  }
  if (preview.presentation) add("VISUAL-PROTOTYPE", "constraint", "游戏画面采用 " + preview.presentation + "。", [policy]);
  requireCondition(evaluateRisk(project).findings.length === 0, "PROTOTYPE_RISK_REQUIRES_REVIEW");
  const blueprint = new SolutionService().propose(project, policy);
  const detail = blueprint.blueprint_detail!;
  detail.recommendation.why_it_fits = "实现选型为生成的候选建议。用户确认的后续选择范围见委托边界。";
  apply({kind: "CANDIDATE_EXTRACTED", candidate: blueprint}, "agent");
  const saved = project.items.at(-1)!;
  apply({kind: "SOLUTION_BLUEPRINT_DELEGATED", item_id: saved.id, fingerprint: itemFingerprint(saved),
    delegated_to: "XDEV", boundaries: [displayedDefault("implementation")],
    owner_action: {intent: "DELEGATE_BLUEPRINT", source_ref: grant}});
  return project;
}

/** One instance per authenticated account/session/project, created by DreamKids.
 * Only the trusted chat handler supplies the user's actual reply and displayed snapshot.
 */
export class DreamKidsDocumentSession {
  private preview: PrototypePreview | undefined;
  private prepared: ReturnType<DreamKidsDocumentSession["compile"]> | undefined;
  private choices: PrototypePreview["selected_choices"] = [];
  private readonly projectId: string;
  private readonly currentProject: () => Project;
  private readonly clock: () => string;
  private readonly outputDirectory: string | undefined;
  constructor(projectId: string, currentProject: () => Project,
    options: {outputDirectory: string; clock?: () => string} | (() => string) = () => new Date().toISOString()) {
    this.projectId = projectId;
    this.currentProject = currentProject;
    this.clock = typeof options === "function" ? options : options.clock ?? (() => new Date().toISOString());
    this.outputDirectory = typeof options === "function" ? undefined : options.outputDirectory;
  }

  show(input: unknown): PrototypePreview {
    return this.remember(this.checkedPreview(input));
  }

  async answerChoices(displayedSnapshotId: string, answers: Record<string, string>,
    replan: (answers: Array<{question: string; answer: string}>) => Promise<unknown>): Promise<PrototypePreview> {
    const preview = this.displayed(displayedSnapshotId);
    requireCondition(preview.questions.length > 0 && Object.keys(answers).length === preview.questions.length,
      "PROTOTYPE_CHOICES_PENDING");
    const selected = preview.questions.map(question => {
      const option = question.options.find(option => option.id === answers[question.id]);
      requireCondition(option, "PROTOTYPE_CHOICES_PENDING");
      return {id: question.id, question: question.question, answer: option.label};
    });
    const incoming = await replan(selected);
    this.displayed(displayedSnapshotId);
    const reworked = this.checkedPreview(incoming);
    requireCondition(!reworked.questions.some(next => preview.questions.some(previous => previous.id === next.id)),
      "PROTOTYPE_CHOICE_NOT_APPLIED");
    const visual = {flat: "2D", solid: "3D", text: "纯文字"}[answers.presentation as "flat" | "solid" | "text"];
    if (visual) requireCondition(reworked.presentation === visual, "PROTOTYPE_CHOICE_NOT_APPLIED");
    const behavior = [reworked.goal, ...reworked.first_version.map(feature => feature.show),
      ...reworked.flow.steps.map(step => step.label)].join("\n");
    requireCondition(!preview.questions.some(question => question.options.some(option =>
      option.id !== answers[question.id] && option.label.length >= 3 && behavior.includes(option.label))),
    "PROTOTYPE_CHOICE_NOT_APPLIED");
    this.choices = [...this.choices.filter(choice => !selected.some(next => next.id === choice.id)), ...selected];
    return this.remember(reworked);
  }

  private remember(raw: PrototypePreview): PrototypePreview {
    const project = this.requireCurrent(raw);
    this.preview = prototypePreview(project, {goal: raw.goal, first_version: raw.first_version, flow: raw.flow,
      questions: raw.questions, presentation: raw.presentation}, this.choices);
    return structuredClone(this.preview);
  }

  private checkedPreview(input: unknown): PrototypePreview {
    const incoming = prototypePreviewSchema.parse(input);
    const project = this.requireCurrent(incoming);
    const preview = prototypePreview(project, {goal: incoming.goal, first_version: incoming.first_version,
      flow: incoming.flow, questions: incoming.questions, presentation: incoming.presentation});
    requireCondition(fingerprint(incoming) === fingerprint(preview), "PROTOTYPE_PREVIEW_CHANGED");
    return preview;
  }

  selectOption(displayedSnapshotId: string, userReply: string) {
    const preview = this.displayed(displayedSnapshotId);
    const project = this.requireCurrent(preview);
    const choice = userReply.trim();
    if (choice === "1" || choice === designOptions[0]) {
      this.preview = undefined;
      return {action: "REVISE_DESIGN" as const};
    }
    requireCondition(choice === "2" || choice === designOptions[1], "PROTOTYPE_OPTION_REQUIRED");
    requireCondition(preview.export_enabled && !preview.questions.length && !preview.blockers.length, "PROTOTYPE_CHOICES_PENDING");
    if (this.prepared?.snapshot_id !== displayedSnapshotId) this.prepared = this.compile(project, preview);
    // Release the final readiness only after the complete package has been published
    // and byte-checked. A retry uses the same prepared bytes, including their history.
    const package_directory = this.outputDirectory ? publishPrototypeExport(this.outputDirectory, this.prepared.artifact) : null;
    return {action: "DOCUMENT_READY" as const, ...structuredClone(this.prepared), package_directory};
  }

  private displayed(id: string) {
    const preview = this.preview;
    requireCondition(preview?.snapshot_id === id, "PROTOTYPE_PREVIEW_CHANGED");
    this.requireCurrent(preview);
    return preview;
  }

  private compile(source: Project, preview: PrototypePreview) {
    const at = this.clock();
    const store = this.outputDirectory ? openPrototypeConfirmationStore(this.outputDirectory) : new MemoryProjectStore();
    const records = new ProjectService(store, () => at);
    try {
      const project = projection(source, preview, records);
      const service = new XSpecService(undefined, records);
      const result = this.outputDirectory ? service.finalizeForExport(project) : undefined;
      const artifact = result?.artifact ?? service.compile(project);
      const validation = result?.validation ?? service.validate(project, artifact);
      requireCondition(validation.package_valid, "XSPEC_PACKAGE_INVALID");
      if (this.outputDirectory) requireCondition(validation.readiness_evaluation.hard_gate_ready, "XSPEC_PROTOTYPE_NOT_READY");
      return {snapshot_id: preview.snapshot_id, source_project_id: source.project_id, source_model_version: source.model_version,
        artifact, validation};
    } finally {store.close();}
  }

  private requireCurrent(preview: PrototypePreview) {
    const project = this.currentProject();
    requireCondition(project.project_id === this.projectId && preview.project_id === this.projectId &&
      project.model_version === preview.model_version, "PROTOTYPE_PREVIEW_CHANGED");
    return project;
  }
}
