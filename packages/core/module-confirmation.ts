import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Project } from "../shared-types/domain.ts";
import { itemFingerprint, rejectSecrets } from "./validation.ts";
import { requireCondition } from "./errors.ts";

export const moduleConfirmationSchema = z.strictObject({
  review_id: z.string().uuid(), project_id: z.string().regex(/^XMI-[A-Z0-9-]+$/),
  project_version: z.number().int().positive(), module: z.string().min(1).max(100),
  items: z.array(z.strictObject({id: z.string().min(1), version: z.number().int().positive(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/)})).min(1).max(100),
});
export type ModuleConfirmation = z.infer<typeof moduleConfirmationSchema>;

export function prepareModuleConfirmation(project: Project, module: string) {
  requireCondition(module.length > 0 && module.length <= 100 && !/[\r\n]/.test(module), "INVALID_ARGUMENTS");
  const pending = project.items.filter(item => item.tags?.includes("module:" + module) &&
    ["PROPOSED", "INFERRED", "ASSUMED"].includes(item.status) && !item.decision_detail &&
    !item.blueprint_detail && item.type !== "decision" && item.type !== "solution_blueprint");
  requireCondition(pending.length > 0, "MODULE_REVIEW_EMPTY_OR_TOO_LARGE");
  const members = pending.slice(0, 50);
  const review = moduleConfirmationSchema.parse({review_id: randomUUID(), project_id: project.project_id,
    project_version: project.model_version, module,
    items: members.map(item => ({id: item.id, version: item.version, fingerprint: itemFingerprint(item)}))});
  const quote = (text: string) => text.split(/\r?\n/).map(line => "> " + line).join("\n");
  const list = members.map((item, index) => `${index + 1}. ${item.id}（${item.status}；${item.priority ?? "未定优先级"}；${item.type}）\n\n${quote(item.statement)}\n\n` +
    `   关联：${(item.links ?? []).join("、") || "无"}；替代：${item.supersedes ?? "无"}；标签：${(item.tags ?? []).join("、") || "无"}`).join("\n\n");
  const review_text = `## ${module}：模块确认清单\n\n项目版本：${review.project_version}；清单编号：${review.review_id}\n\n本批 ${members.length} 条；本模块当前待确认共 ${pending.length} 条；本批之后尚有 ${pending.length - members.length} 条待确认。\n\n${list}\n\n` +
    "以上仅为待确认内容，不包含未采纳建议。本批全部同意可回复「确认好了」；需要修改请回复编号和修改内容，修改后重新展示清单。本次回复仅确认本批清单；其余条目需要另行展示和确认。技术方案、交付模式和风险处置仍单独审核。";
  rejectSecrets(review_text);
  requireCondition(Buffer.byteLength(review_text, "utf8") <= 1024 * 1024, "REVIEW_TOO_LARGE");
  return {review, review_text};
}
