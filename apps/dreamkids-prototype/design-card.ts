import type {PrototypePreview} from "../../packages/core/prototype-preview.ts";
import {designOptions} from "./design-options.ts";
import {numberedFlow} from "./flow-order.ts";

type Actions = {
  answerChoices: (snapshotId: string, answers: Record<string, string>) => Promise<PrototypePreview>;
};

/** DreamKids passes authenticated host handlers. User text is always rendered as text. */
export function renderDesignCard(root: HTMLElement, preview: PrototypePreview, actions: Actions) {
  const doc = root.ownerDocument;
  function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) {
    const node = doc.createElement(tag);
    if (text) node.textContent = text;
    return node;
  }
  const button = (text: string) => {
    const control = el("button", text);
    control.type = "button";
    return control;
  };
  const card = el("section");
  card.className = "xmi-design-card";
  card.append(el("h2", preview.title + " · 第一版"), el("p", preview.goal));
  if (preview.original_idea && preview.original_idea !== preview.goal) {
    const idea = el("details");
    idea.append(el("summary", "我原来的想法"), el("p", preview.original_idea));
    card.append(idea);
  }
  if (preview.presentation) card.append(el("p", "画面方式：" + preview.presentation));
  if (preview.selected_choices.length) {
    const choices = el("ul");
    for (const choice of preview.selected_choices) choices.append(el("li", choice.question + " " + choice.answer));
    card.append(choices);
  }
  const features = el("ul");
  for (const feature of preview.first_version) {
    const item = el("li", feature.show);
    item.append(el("small", "怎样算做到了：" + feature.check));
    features.append(item);
  }
  card.append(features);
  const heading = el("h3", preview.flow_title);
  const graph = el("ol");
  graph.className = "xmi-flow";
  const steps = numberedFlow(preview.flow), nodes = new Map(steps.map(node => [node.id, node]));
  for (const node of steps) {
    const row = el("li");
    row.dataset.kind = node.kind;
    row.append(el("strong", node.label));
    for (const edge of preview.flow.edges.filter(edge => edge.from === node.id)) {
      const destination = nodes.get(edge.to)!;
      row.append(el("span", (edge.label ? edge.label + " " : "") + "→ " + destination.number + ". " + destination.label));
    }
    graph.append(row);
  }
  card.append(heading, graph);
  const defaults = el("details");
  defaults.open = true;
  const defaultsList = el("ul");
  for (const option of preview.defaults) defaultsList.append(el("li", option.label));
  defaults.append(el("summary", "第一版的范围"), defaultsList);
  card.append(defaults);
  for (const blocker of preview.blockers) card.append(el("p", blocker));
  const feedback = el("p");
  feedback.setAttribute("role", "status");
  if (preview.questions.length) {
    const form = el("form");
    for (const question of preview.questions) {
      const fieldset = el("fieldset");
      fieldset.append(el("legend", question.question));
      for (const option of question.options) {
        const input = el("input");
        input.name = question.id;
        input.type = "radio";
        input.required = true;
        input.value = option.id;
        const label = el("label");
        label.append(input, doc.createTextNode(option.label));
        fieldset.append(label);
      }
      form.append(fieldset);
    }
    const submit = button("更新设计预览");
    submit.type = "submit";
    form.append(submit);
    form.addEventListener("submit", async event => {
      event.preventDefault();
      submit.disabled = true;
      const answers = Object.fromEntries(preview.questions.map(question => [question.id,
        form.querySelector<HTMLInputElement>(`input[name="${question.id}"]:checked`)!.value]));
      try {renderDesignCard(root, await actions.answerChoices(preview.snapshot_id, answers), actions);}
      catch {feedback.textContent = "选择暂时未能更新，请重试。"; submit.disabled = false;}
    });
    card.append(form);
  }
  if (preview.export_enabled) {
    const options = el("ol");
    for (const option of designOptions) options.append(el("li", option));
    card.append(el("p", "在聊天中回复选项序号或名称。"), options);
  }
  card.append(feedback);
  root.replaceChildren(card);
}
