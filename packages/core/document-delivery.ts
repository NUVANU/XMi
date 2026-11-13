import {z} from "zod";
import type {ReadinessEvaluation} from "./completeness-service.ts";
import {systemArchitectureSummarySchema} from "./system-architecture.ts";
import type {SystemArchitectureSummary} from "./system-architecture.ts";

export const documentReviewSummarySchema = z.strictObject({
  project_id: z.string().regex(/^XMI-[A-Z0-9-]+$/u), current_model_version: z.number().int().positive(),
  reviewed_model_version: z.number().int().positive().nullable(), run_id: z.string().uuid().nullable(),
  state: z.enum(["NOT_STARTED", "UNAVAILABLE", "AWAITING_AGENT", "RUNNING", "COMPLETED", "INCOMPLETE", "STALE", "UNVERIFIED"]),
  source_verified: z.boolean(), scope: z.literal("FULL_SPEC"),
  finding_count: z.number().int().nonnegative(), question_count: z.number().int().nonnegative(), note_count: z.number().int().nonnegative(),
  handled_finding_count:z.number().int().nonnegative().optional(),handled_question_count:z.number().int().nonnegative().optional(),
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
  system_architecture:systemArchitectureSummarySchema.optional(),
});
export type DeliveryWorkflow = z.infer<typeof deliveryWorkflowSchema>;

export function unavailableDocumentReview(project: {project_id: string; model_version: number}): DocumentReviewSummary {
  return {project_id: project.project_id, current_model_version: project.model_version, reviewed_model_version: null, run_id: null,
    state: "UNAVAILABLE", source_verified: false, scope: "FULL_SPEC", finding_count: 0, question_count: 0, note_count: 0,
    formal_isolation_verified: false, reason: "当前宿主未配置轻量独立文档复审；可以如实导出校验有效的候选规格，不要求另建评审服务。"};
}

/** Workflow guidance only: no formal gate, approval or product decision is created. */
export function documentDelivery(review: DocumentReviewSummary, packageValid?: boolean, readiness?: ReadinessEvaluation, architecture?:SystemArchitectureSummary): DeliveryWorkflow {
  documentReviewSummarySchema.parse(review);
  const contentGaps = readiness && [...readiness.hard_gates, ...readiness.mode_gates]
    .some(g => (g.gate <= 12 || g.gate === 101 || g.gate === 102) && g.status === "FAIL");
  const validationStep = packageValid === true ? "当前版本已通过校验，可请求精确导出授权。" : "校验当前版本，通过后请求精确导出授权。";
  let stage: DeliveryWorkflow["stage"], next: string;
  if (packageValid === false || contentGaps) {
    stage = "CHECK_SPEC";
    next = packageValid === true
      ? "规格包校验通过，仍有正式就绪缺口。说明缺口后，可请求精确导出授权以先交付候选包。为补齐缺口，只确认新增或有实质变化的决策。"
      : "先集中处理校验指出的缺口，校验过程和报告无需用户确认。需要用户决定的新增或实质修改，使用 requests 与 issue_handling 集中列出；明确处理回复本身就是确认，直接应用并自动审核，不追加确认清单。只补问未明确项，沿用未变化的已确认内容。正式就绪仍由对应门槛判定。";
  } else if (review.state === "NOT_STARTED") {
    stage = "OFFER_REVIEW"; next = "当前版本审核通过后，已确认方案自动生成同版24章项目顶层系统架构设计，与需求一起直接进入本流程已授权的轻量独立复审；无需用户再次确认架构整理、启动或审核完成。收取现有宿主的复审结果，不另建审核服务。";
  } else if (review.state === "AWAITING_AGENT" || review.state === "RUNNING") {
    stage = "WAIT_REVIEW"; next = "自动收取当前指定 Agent 的结果，不重复启动，也不要求用户确认审核过程或审核已完成。用原始键调用 xmi_spec_review_start 收取意见后，与其他待处理问题合并展示。";
  } else if (review.state === "STALE") {
    // Preserve the published stage and package report bytes; next_action directs delivery.
    stage = "REFRESH_REVIEW"; next = "用户处理后的修改已经确认；自动重建同版顶层系统架构文档并审核当前版本，通过后自动继续一次当前版本的轻量独立复审，需求与架构一起检查。只把新增关键取舍或变化的问题交回用户处理，不再要求确认旧清单、架构整理或开始复审。";
  } else if (review.state !== "COMPLETED" || !review.source_verified) {
    stage = "REVIEW_UNAVAILABLE"; next = "简要说明复审实际状态。无需用户确认这份状态，也不建立额外审核服务或隔离证明流程。普通交付继续。" + validationStep;
  } else if (review.finding_count || review.question_count) {
    stage = "REVIEW_FINDINGS"; next = "只展示尚未处理的问题，用 xmi_item_review_prepare 的 requests 与 issue_handling 一次准备问题处理清单，包含问题、影响、建议和明确可选的改动。用户按编号采纳、忽略、暂缓、选择已列选项或给出完整修改文本，本次处理回复即确认；直接应用并审核，不再追加确认清单。审核通过后自动独立复审；只追问未明确的项目，已处置且内容未变的意见直接沿用。";
  } else if (packageValid !== true) {
    stage = "VALIDATE_SPEC"; next = "当前版本文档复审已完成且无待展示意见；执行 xmi_xspec_validate，再请求批准精确导出版本。完成不代表穷尽检查或正式隔离认证。";
  } else {
    stage = "READY_TO_EXPORT"; next = "当前版本文档复审已完成，规格校验通过；可请求用户批准精确导出版本。保留正式隔离和其他未验证保证的说明，不要求另建正式审计系统。";
  }
  return {stage, document_review: review, package_valid: packageValid ?? null, review_optional: true,
    formal_assurance: "NOT_ESTABLISHED", next_action: next,...(architecture?{system_architecture:architecture}:{})};
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
