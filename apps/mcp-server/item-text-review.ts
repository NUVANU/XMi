import type {Candidate, Item} from "../../packages/shared-types/domain.ts";
import {quotedReviewText as quote} from "./blueprint-review.ts";

export function itemTextReview(project: string, item: Candidate | Item, action: "PROPOSE" | "APPROVE" | "REJECT", selected?: string, reason?: string) {
  const detail = item.decision_detail;
  const labels: Record<string, string> = {user_experience: "用户体验", cost: "成本", complexity: "复杂度", privacy: "隐私", xdev: "开发影响"};
  const title = action === "PROPOSE" ? "我同意保存以上未确认提案" : action === "REJECT" ? "我确认拒绝以上设定" : "我确认采用以上完整设定";
  return {title, message: ["本次操作：" + title.replace(/^我/, ""), "项目：", quote(project), "条目：", quote(item.id),
    "完整内容：", quote(item.statement), "状态：" + item.status + "；类型：" + item.type + "；优先级：" + (item.priority ?? "未指定"),
    ...(item.links?.length ? ["关联条目：", quote(item.links.join("、"))] : []),
    ...(item.tags?.length ? ["范围标记：", quote(item.tags.join("、"))] : []),
    ...(item.supersedes ? ["替代提案关联：", quote(item.supersedes)] : []),
    ...(detail ? ["需要决定：", quote(detail.question), "原因：", quote(detail.why_it_matters),
      ...detail.options.flatMap(option => ["选项：", quote(option.id + " — " + option.label),
        ...Object.entries(option.impact).flatMap(([key, value]) => [labels[key] + "：", quote(value)])]),
      "建议选项：", quote(detail.recommendation.option_id), "建议理由：", quote(detail.recommendation.rationale),
      "建议置信度：" + detail.recommendation.confidence, "原有选择：", quote(detail.owner_selection ?? "尚未选择"),
      "本次选择：", quote(selected ?? "本次只保存或拒绝，未批准任何选项"),
      "关联需求：", quote(detail.linked_requirements.join("、")), "关联流程：", quote(detail.linked_flows.join("、")),
      "替代历史：", quote(detail.supersession_history.join("、"))] : []),
    ...(reason ? ["拒绝理由：", quote(reason)] : []),
    "来源与精确版本绑定保留；保存提案仍待确认。需要修改请取消并在聊天中说明。"].join("\n")};
}
