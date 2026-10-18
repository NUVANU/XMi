import {z} from "zod";
import type {ReadinessEvaluation} from "./completeness-service.ts";

export const documentReviewSummarySchema = z.strictObject({
  project_id: z.string().regex(/^XMI-[A-Z0-9-]+$/u), current_model_version: z.number().int().positive(),
  reviewed_model_version: z.number().int().positive().nullable(), run_id: z.string().uuid().nullable(),
  state: z.enum(["NOT_STARTED", "UNAVAILABLE", "AWAITING_AGENT", "RUNNING", "COMPLETED", "INCOMPLETE", "STALE", "UNVERIFIED"]),
  source_verified: z.boolean(), scope: z.literal("FULL_SPEC"),
  finding_count: z.number().int().nonnegative(), question_count: z.number().int().nonnegative(), note_count: z.number().int().nonnegative(),
  formal_isolation_verified: z.literal(false), reason: z.string().min(1).max(1200),
}).superRefine((value, context) => {
  if (value.state === "COMPLETED" && (!value.source_verified || !value.run_id ||
    value.reviewed_model_version !== value.current_model_version)) {
    context.addIssue({code: "custom", message: "Completed review requires a verified run for the current version."});
  }
});
export type DocumentReviewSummary = z.infer<typeof documentReviewSummarySchema>;
export const deliveryWorkflowSchema = z.strictObject({
  stage: z.enum(["CHECK_SPEC", "OFFER_REVIEW", "WAIT_REVIEW", "REFRESH_REVIEW", "REVIEW_FINDINGS", "REVIEW_UNAVAILABLE", "VALIDATE_SPEC", "READY_TO_EXPORT", "EXPORTED"]),
  document_review: documentReviewSummarySchema, package_valid: z.boolean().nullable(), review_optional: z.literal(true),
  formal_assurance: z.literal("NOT_ESTABLISHED"), next_action: z.string().min(1).max(1500),
});
export type DeliveryWorkflow = z.infer<typeof deliveryWorkflowSchema>;

export function unavailableDocumentReview(project: {project_id: string; model_version: number}): DocumentReviewSummary {
  return {project_id: project.project_id, current_model_version: project.model_version, reviewed_model_version: null, run_id: null,
    state: "UNAVAILABLE", source_verified: false, scope: "FULL_SPEC", finding_count: 0, question_count: 0, note_count: 0,
    formal_isolation_verified: false, reason: "当前宿主未配置轻量独立文档复审；可以如实导出校验有效的候选规格，不要求另建评审服务。"};
}

/** Workflow guidance only: no formal gate, approval or product decision is created. */
export function documentDelivery(review: DocumentReviewSummary, packageValid?: boolean, readiness?: ReadinessEvaluation): DeliveryWorkflow {
  documentReviewSummarySchema.parse(review);
  const contentGaps = readiness && [...readiness.hard_gates, ...readiness.mode_gates]
    .some(g => (g.gate <= 12 || g.gate === 101 || g.gate === 102) && g.status === "FAIL");
  let stage: DeliveryWorkflow["stage"], next: string;
  if (packageValid === false || contentGaps) {
    stage = "CHECK_SPEC"; next = "先处理校验指出的规格缺口或未确认内容，再继续文档复审和导出。不要修改正式审核门槛来消除产品问题。";
  } else if (review.state === "NOT_STARTED") {
    stage = "OFFER_REVIEW"; next = "轻量独立文档复审尚未开始。用户要求评审时调用 xmi_spec_review_start，并按 host_job 创建一次独立上下文 Agent；不要求正式权限隔离认证。未要求复审时仍可校验并经用户批准导出候选包。";
  } else if (review.state === "AWAITING_AGENT" || review.state === "RUNNING") {
    stage = "WAIT_REVIEW"; next = "收取当前指定 Agent 的结果，不重复启动。完成后用原始键调用 xmi_spec_review_start 持久化结果，再查看意见。";
  } else if (review.state === "STALE") {
    stage = "REFRESH_REVIEW"; next = "项目已改版，旧评审不能代表当前规格。保留旧报告，用新版本和新键发起一次复审。";
  } else if (review.state !== "COMPLETED" || !review.source_verified) {
    stage = "REVIEW_UNAVAILABLE"; next = "本次文档复审尚不可核验，检查该运行的状态和原因；不要声称评审通过或反复创建 Agent。候选导出仍须披露限制。";
  } else if (review.finding_count || review.question_count || review.note_count) {
    stage = "REVIEW_FINDINGS"; next = "文档复审已完成。调用 xmi_spec_review_status 分页展示意见、问题和核验提示，由用户决定修订；修改仍走原有草稿/确认流程。改版后重新复审，不自动采纳意见或将空有效意见当作通过。";
  } else if (packageValid !== true) {
    stage = "VALIDATE_SPEC"; next = "当前版本文档复审已完成且无待展示意见；执行 xmi_xspec_validate，再请求批准精确导出版本。完成不代表穷尽检查或正式隔离认证。";
  } else {
    stage = "READY_TO_EXPORT"; next = "当前版本文档复审已完成，规格校验通过；可请求用户批准精确导出版本。保留正式隔离和其他未验证保证的说明，不要求另建正式审计系统。";
  }
  return {stage, document_review: review, package_valid: packageValid ?? null, review_optional: true,
    formal_assurance: "NOT_ESTABLISHED", next_action: next};
}

export function documentDeliveryMarkdown(workflow: DeliveryWorkflow): string {
  const w = deliveryWorkflowSchema.parse(workflow), r = w.document_review;
  return `\n## Independent document review and specification delivery\n\n` +
    `- Delivery workflow: ${w.stage}\n- Document review: ${r.state}\n- Review run: ${r.run_id ?? "None"}\n` +
    `- Reviewed/current Product Model version: ${r.reviewed_model_version ?? "None"}/${r.current_model_version}\n` +
    `- Native result source verified: ${r.source_verified}\n- Findings/questions/verification notes: ${r.finding_count}/${r.question_count}/${r.note_count}\n` +
    `- Formal permission isolation: NOT VERIFIED. This document review is not formal audit certification.\n` +
    `- Review is optional; export approval remains separate. Findings are advice, not confirmed product decisions.\n` +
    `- The review covers its frozen readable design documents, not this subsequently generated delivery-status section.\n`;
}
