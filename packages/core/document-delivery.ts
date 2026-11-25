import {z} from "zod";
import type {ReadinessEvaluation} from "./completeness-service.ts";
import {deliveryTriageSchema} from "./document-review.ts";
import {systemArchitectureSummarySchema} from "./system-architecture.ts";
import type {SystemArchitectureSummary} from "./system-architecture.ts";

export const documentReviewSummarySchema = z.strictObject({
  project_id: z.string().regex(/^XMI-[A-Z0-9-]+$/u), current_model_version: z.number().int().positive(),
  reviewed_model_version: z.number().int().positive().nullable(), run_id: z.string().uuid().nullable(),
  state: z.enum(["NOT_STARTED", "UNAVAILABLE", "AWAITING_AGENT", "RUNNING", "COMPLETED", "INCOMPLETE", "STALE", "UNVERIFIED"]),
  source_verified: z.boolean(), scope: z.literal("FULL_SPEC"),
  finding_count: z.number().int().nonnegative(), question_count: z.number().int().nonnegative(), note_count: z.number().int().nonnegative(),
  delivery_triage: deliveryTriageSchema.optional(),
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
  stage: z.enum(["CHECK_SPEC", "OFFER_REVIEW", "WAIT_REVIEW", "REFRESH_REVIEW", "REVIEW_FINDINGS", "VERIFY_INCREMENT", "REVIEW_UNAVAILABLE", "VALIDATE_SPEC", "READY_TO_EXPORT", "EXPORTED"]),
  document_review: documentReviewSummarySchema, package_valid: z.boolean().nullable(), review_optional: z.literal(true),
  formal_assurance: z.enum(["NOT_ESTABLISHED", "SPEC_REVIEW_VERIFIED"]), next_action: z.string().min(1).max(1500),
  system_architecture:systemArchitectureSummarySchema.optional(),
});
export type DeliveryWorkflow = z.infer<typeof deliveryWorkflowSchema>;

export function unavailableDocumentReview(project: {project_id: string; model_version: number}): DocumentReviewSummary {
  return {project_id: project.project_id, current_model_version: project.model_version, reviewed_model_version: null, run_id: null,
    state: "UNAVAILABLE", source_verified: false, scope: "FULL_SPEC", finding_count: 0, question_count: 0, note_count: 0,
    formal_isolation_verified: false, reason: "当前宿主未配置轻量独立文档复审；可以如实导出校验有效的候选规格，不要求另建评审服务。"};
}

/** Workflow guidance only: no formal gate, approval or product decision is created. */
export function documentDelivery(review: DocumentReviewSummary, packageValid?: boolean, readiness?: ReadinessEvaluation,
  architecture?: SystemArchitectureSummary, verifiedSpecReview = false): DeliveryWorkflow {
  documentReviewSummarySchema.parse(review);
  const contentGaps = readiness && [...readiness.hard_gates, ...readiness.mode_gates]
    .some(g => (g.gate <= 12 || g.gate === 101 || g.gate === 102) && g.status === "FAIL");
  const validationStep = packageValid === true ? "当前版本已通过校验，可请求精确导出授权。" : "校验当前版本，通过后请求精确导出授权。";
  const triage = review.delivery_triage;
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
    stage = "REFRESH_REVIEW"; next = "自动重建同版顶层系统架构文档并审核当前版本，通过后自动继续一次当前版本的轻量独立复审。以已复审规格为参照，只聚焦改动、关联验收和直接影响；同版需求与架构供核对。只把影响本轮验收且需要新取舍的事项交回用户，不再要求确认旧清单、架构整理或开始复审。";
  } else if (review.state !== "COMPLETED" || !review.source_verified) {
    stage = "REVIEW_UNAVAILABLE"; next = "简要说明复审实际状态。无需用户确认这份状态，也不建立额外审核服务或隔离证明流程。普通交付继续。" + validationStep;
  } else if (triage ? triage.owner_choices > 0 : review.finding_count || review.question_count) {
    stage = "REVIEW_FINDINGS"; next = "只把影响本轮验收且确需用户决定的取舍合成一份清单，说明对应验收、用户可感知的影响和推荐选项。用 xmi_item_review_prepare 的 requests 与 issue_handling；明确处理回复即确认，直接应用并校验。复用已确认的规则，把核验事项与后续建议留在清单之外。";
  } else if (triage?.verification) {
    stage = "VERIFY_INCREMENT"; next = "由 XMi 按对应验收核对已确认的规则和现有证据。缺实测时列出具体场景与仍待验证的结果，保留原风险与就绪状态；无需用户批准证据或报告。未确定范围的阻塞先查关联和职责。若确需改变本轮行为、成本或权限，才合并询问一次。规格包已通过校验时，仍可按明确授权导出带限制的候选包。";
  } else if (packageValid !== true) {
    stage = "VALIDATE_SPEC"; next = "本轮复审无需产品取舍或待核验处置；执行 xmi_xspec_validate，再请求批准精确导出版本。后续建议留存，无需用户确认。";
  } else {
    stage = "READY_TO_EXPORT"; next = "当前版本规格校验通过，本轮没有需要用户决定或继续核验的复审事项。可请求精确导出授权，保留后续建议及正式保证限制。DreamKids 轻量预览按「确认输出开发文档」选项交付。输出校验过的 XSpec 后停止。";
  }
  const formallyReviewed = verifiedSpecReview || readiness?.mode_gates.some(g => g.gate === 103 && g.status === "PASS");
  return {stage, document_review: review, package_valid: packageValid ?? null, review_optional: true,
    formal_assurance: formallyReviewed ? "SPEC_REVIEW_VERIFIED" : "NOT_ESTABLISHED",
    next_action: next,...(architecture?{system_architecture:architecture}:{})};
}

export function documentDeliveryMarkdown(workflow: DeliveryWorkflow): string {
  const w = deliveryWorkflowSchema.parse(workflow), r = w.document_review;
  const triage = r.delivery_triage;
  return `\n## Independent document review and specification delivery\n\n` +
    `- Delivery workflow: ${w.stage}\n- Document review: ${r.state}\n- Review run: ${r.run_id ?? "None"}\n` +
    `- Reviewed/current Product Model version: ${r.reviewed_model_version ?? "None"}/${r.current_model_version}\n` +
    `- Native result source verified: ${r.source_verified}\n- Findings/questions/verification notes: ${r.finding_count}/${r.question_count}/${r.note_count}\n` +
    (triage ? `- Owner choices / verification / follow-up / confirmed rule reused: ${triage.owner_choices}/${triage.verification}/${triage.follow_up}/${triage.reused}\n` : "") +
    (w.formal_assurance === "SPEC_REVIEW_VERIFIED"
      ? "- Formal specification review: VERIFIED for the current snapshot.\n"
      : "- Formal permission isolation: NOT VERIFIED. This document review is not formal audit certification.\n") +
    `- Review is optional; export approval remains separate. Findings are advice, not confirmed product decisions.\n` +
    `- The review covers its frozen readable design documents, not this subsequently generated delivery-status section.\n`;
}
