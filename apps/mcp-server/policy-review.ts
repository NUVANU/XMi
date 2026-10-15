import type {z} from "zod";
import type {Command, Project, SourceRef} from "../../packages/shared-types/domain.ts";
import {modeFingerprint} from "../../packages/core/validation.ts";
import {evaluateRisk, exclusionScopeIssues} from "../../packages/core/completeness-service.ts";
import {requireCondition} from "../../packages/core/errors.ts";
import {quotedReviewText as quote} from "./blueprint-review.ts";
import type {policyReviewRequest} from "./contracts.ts";

const modes = {FAST_VALIDATION: "快速验证（原型目标）", FAST_DEVELOPMENT: "快速开发", PRODUCT_GRADE: "产品级规格"};
const resolutions: Record<string, string> = {UPGRADE_SCOPE: "提升这些范围的规格深度", UPGRADE_PROJECT: "提升整个项目的交付模式",
  STUB_OR_SANDBOX: "仅保留桩或沙盒路径", DEFER_OR_EXCLUDE: "整条延期或排除"};
const reasons: Record<string, string> = {AUTH_OR_PRIVATE_DATA: "身份、权限与私有数据", PAYMENT_OR_FINANCIAL: "支付与财务",
  SENSITIVE_DATA: "敏感资料", DESTRUCTIVE_ACTION: "不可逆与破坏性操作", ADMIN_ACCESS: "高权限访问",
  EXTERNAL_SIDE_EFFECT: "外部操作", REGULATED_OR_HIGH_CONSEQUENCE: "受监管或高后果行为"};

export function policyReview(project: Project, request: z.infer<typeof policyReviewRequest>, source: SourceRef & {type: "owner_action"}) {
  requireCondition(project.project_id === request.project_id && project.model_version === request.expected_version, "VERSION_CONFLICT");
  const intro = ["项目：", quote(project.title), "当前交付模式：" + (project.delivery_policy ? modes[project.delivery_policy.effective_mode] : "尚未选择")];
  let command: Command, title: string, content: string[];
  if (request.operation === "xmi_delivery_mode_select") {
    requireCondition(modeFingerprint(project, request.mode, request.reason) === request.fingerprint, "FINGERPRINT_MISMATCH");
    const ranks = {FAST_VALIDATION: 0, FAST_DEVELOPMENT: 1, PRODUCT_GRADE: 2};
    const old = project.delivery_policy?.effective_mode;
    const upgrading = old !== undefined && ranks[request.mode] > ranks[old];
    requireCondition(old !== request.mode, "MODE_UNCHANGED");
    requireCondition((request.change === "UPGRADE") === upgrading, "MODE_EVENT_MISMATCH");
    requireCondition(!old || !project.current_xspec_version || ranks[request.mode] >= ranks[old], "EXPORTED_MODE_DOWNGRADE_REQUIRES_NEW_SCOPE");
    command = {kind: upgrading ? "DELIVERY_MODE_UPGRADED" : "DELIVERY_MODE_SELECTED", mode: request.mode,
      reason: request.reason, fingerprint: request.fingerprint, owner_action: {intent: "CONFIRM", source_ref: source}};
    title = "我确认选择以上交付模式";
    content = ["本次操作：选择交付模式", "选择：" + modes[request.mode], "选择理由：", quote(request.reason),
      "生效结果：更新项目的交付目标；已有设定和历史继续保留。风险处置、就绪评估和最终导出仍单独审核。"];
  } else {
    const retract = request.operation === "xmi_mode_override_retract";
    const recorded = project.delivery_policy?.risk_overrides.find(entry => entry.id === request.override_id);
    const finding = evaluateRisk(project).findings.find(entry => entry.override_id === request.override_id);
    requireCondition(project.delivery_policy, "MODE_SELECTION_REQUIRED");
    if (retract) requireCondition(recorded?.status === "CONFIRMED", "MODE_OVERRIDE_NOT_CONFIRMED");
    else {
      requireCondition(finding, "MODE_OVERRIDE_NOT_FOUND");
      const ranks = {FAST_VALIDATION: 0, FAST_DEVELOPMENT: 1, PRODUCT_GRADE: 2};
      requireCondition(ranks[finding.minimum_mode] >= ranks[project.delivery_policy.effective_mode], "MODE_OVERRIDE_RISK_ALREADY_SATISFIED");
      if (request.resolution === "UPGRADE_PROJECT") requireCondition(ranks[project.delivery_policy.effective_mode] >= ranks[finding.minimum_mode], "MODE_UPGRADE_REQUIRED");
      requireCondition(finding.scope_ids.every(id => project.items.some(item => item.id === id && item.status === "CONFIRMED")), "MODE_OVERRIDE_SCOPE_NOT_CONFIRMED");
      if (request.resolution === "DEFER_OR_EXCLUDE") requireCondition(exclusionScopeIssues(project, finding.scope_ids, finding.reason_code).length === 0, "RISK_SCOPE_SPLIT_REQUIRED");
    }
    const scope = retract ? recorded! : finding!;
    content = ["本次操作：" + (retract ? "撤回旧风险处置" : "采用新的风险处置"), "风险类别：" + (reasons[scope.reason_code] ?? scope.reason_code),
      "处置编号：", quote(request.override_id), "最低规格深度：" + modes[scope.minimum_mode]];
    if (retract) {
      command = {kind: "MODE_OVERRIDE_RETRACTED", override_id: request.override_id, reason: request.reason,
        owner_action: {intent: "RETRACT_OVERRIDE", source_ref: source}};
      title = "我确认撤回以上旧风险处置";
      content.push("原处置：" + (resolutions[recorded!.resolution] ?? recorded!.resolution), "旧记录理由：", quote(recorded!.rationale),
        "本次撤回理由：", quote(request.reason), "生效结果：原处置保留在历史中并标记已撤回，风险返回待审；关联设计内容继续保留，后续导出移除这条旧处置。");
    } else {
      command = {kind: "MODE_OVERRIDE_RESOLVED", override_id: request.override_id, resolution: request.resolution,
        rationale: request.rationale, owner_action: {intent: "RESOLVE_OVERRIDE", source_ref: source}};
      title = "我确认采用以上风险处置";
      content.push("本次处置：" + resolutions[request.resolution], "本次处理理由：", quote(request.rationale),
        request.resolution === "DEFER_OR_EXCLUDE" ? "生效范围：下面列出的整条设计内容将从本期交付排除；需要保留其中一部分时，请先修改和拆分。" : "生效范围：仅采用下面列出的风险处理方式；普通设定确认和最终交付就绪仍按各自规则审核。");
    }
    content.push("关联设计（完整内容）：", ...scope.scope_ids.flatMap((id, index) => {
      const item = project.items.find(entry => entry.id === id);
      return [String(index + 1) + "．" + quote(id), item ? quote(item.statement) : quote("当前模型中已无此条目；历史关联保留。")];
    }));
  }
  return {command, title, message: [...intro, ...content, "来源与精确版本绑定由 XMi 保留。需要修改请在聊天中说明，再重新展示清单。"].join("\n")};
}
