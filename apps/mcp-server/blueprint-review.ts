import type { Candidate, Item } from "../../packages/shared-types/domain.ts";
import { requireCondition } from "../../packages/core/errors.ts";

export function quotedReviewText(value: string) {
  return Array.from(value).map((character) => {
    const code = character.charCodeAt(0);
    if ([60, 62, 38, 96].includes(code) || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) {
      return "\\u" + code.toString(16).padStart(4, "0");
    }
    return [92, 42, 95, 35, 91, 93, 40, 41, 33, 124].includes(code) ? "\\" + character : character;
  }).join("").split("\n").map(line => "> " + line).join("\n");
}

const labels: Record<string, string> = {
  blueprint_id: "技术方案编号", mode: "交付模式", feasibility_inputs: "已确认的方案依据",
  key: "依据类别", evidence_ids: "已确认条目", deployment_topology: "部署方式",
  client_form_factor: "客户端形式", backend_need: "后端需求", persistence_data_ownership: "数据保存与归属",
  authentication_authorization: "身份验证与权限", integration_boundaries: "外部集成边界",
  ai_capability_boundary: "AI 能力边界", reliability_privacy_constraints: "可靠性与隐私约束",
  recommended_stack_profile: "建议技术组合", alternatives_tradeoffs: "其他方案与取舍",
  xdev_must_preserve: "开发时必须保留的规则", decisions_delegated_to_xdev: "交由 XDev 细化的决定",
  options: "候选方案比较", id: "编号", label: "方案名称", summary: "方案说明", evaluation: "评估",
  fit_to_confirmed_requirements: "与已确认需求的匹配程度", implementation_complexity: "开发复杂度",
  operational_complexity: "运行维护复杂度", expected_cost: "预期成本", privacy_security: "隐私与安全匹配",
  vendor_lock_in: "供应商绑定程度", offline_local_requirements: "离线与本地需求匹配",
  xdev_support_maturity: "XDev 支持成熟度", owner_maintenance_ability: "用户维护能力匹配",
  migration_path: "后续迁移方式", trade_offs: "取舍", risks: "风险", recommendation: "推荐理由与待定事项",
  option_id: "推荐方案编号", why_it_fits: "推荐理由", owner_decision_required: "是否需要用户决定",
  confidence: "推荐置信度", unresolved_inputs: "尚需确定的内容", production_gaps: "正式交付前仍缺少的验证",
  approval_triggers: "需要明确批准的影响", owner_disposition: "当前用户决定", delegation: "当前委托",
  delegated_to: "委托对象", boundaries: "委托边界", ai_capability_profile: "AI 能力要求",
  modalities: "输入输出类型", latency: "响应时间要求", quality_reasoning: "输出质量与推理要求",
  tool_use: "工具调用要求", context_size: "上下文容量要求", privacy_data_residency: "隐私与数据所在地",
  cost_envelope: "费用边界", structured_output_reliability: "结构化输出可靠性", safety_constraints: "安全约束",
  offline_on_device_need: "离线与设备端需求", unresolved_constraints: "仍待验证的约束",
  model_resolution: "当前模型选择记录", capability_profile_id: "对应能力要求编号", provider: "服务提供方",
  model: "模型", alternatives: "备选模型", resolved_at: "选择记录时间", source_version: "参考资料版本",
  capability_match: "能力匹配依据", pricing_privacy_assumptions: "费用与隐私假设",
  revalidation_requirement: "重新验证要求",
};

const values: Record<string, string> = {
  FAST_VALIDATION: "快速验证", FAST_DEVELOPMENT: "快速开发", PRODUCT_GRADE: "产品级规格",
  TARGET_USERS: "目标用户", CORE_FLOW: "核心流程", DATA_SENSITIVITY: "数据敏感性",
  LOCAL_CLOUD_REQUIREMENT: "本地与云端要求", SCALE_LATENCY_NEEDS: "规模与响应时间",
  INTEGRATION_CONSTRAINTS: "集成约束", COST_MAINTENANCE_PREFERENCE: "成本与维护偏好", TARGET_PLATFORM: "目标平台",
  LOW: "低", MEDIUM: "中", HIGH: "高", WEAK: "弱", STRONG: "强", TEXT: "文本", IMAGE: "图像",
  AUDIO: "音频", VIDEO: "视频", APPROVED: "已批准", DELEGATED_TO_XDEV: "已委托 XDev", XDEV: "XDev",
  RECURRING_COST: "持续费用", PRIVACY_DATA_EXPOSURE: "隐私数据对外提供", THIRD_PARTY_LOCK_IN: "第三方绑定",
  PRODUCT_BEHAVIOR: "产品行为", OFFLINE_CAPABILITY: "离线能力", LEGAL_COMPLIANCE_RISK: "法律合规风险",
  LONG_TERM_MAINTENANCE: "长期维护",
};

/** Render all semantic fields; only the internal feasibility fingerprint is hidden. */
export function blueprintReview(projectTitle: string, candidate: Candidate | Item,
  action: "PROPOSE" | "APPROVE" | "DELEGATE" | "REJECT", quote: (text: string) => string, reason?: string) {
  requireCondition(candidate.blueprint_detail, "SOLUTION_BLUEPRINT_DETAIL_REQUIRED");
  function render(value: unknown): string[] {
    if (value === null) return [quote("尚未记录（待确定）")];
    if (typeof value === "boolean") return [quote(value ? "是" : "否")];
    if (typeof value === "string") return [quote(values[value] ? values[value] + "（" + value + "）" : value)];
    if (Array.isArray(value)) return value.length
      ? value.flatMap((entry, index) => ["第 " + (index + 1) + " 项：", ...render(entry)]) : [quote("当前列表为空")];
    requireCondition(value && typeof value === "object", "INVALID_REVIEW_FIELD");
    return Object.entries(value).flatMap(([key, entry]) => {
      if (key === "feasibility_fingerprint") return [];
      requireCondition(labels[key], "INVALID_REVIEW_FIELD");
      return [labels[key] + "：", ...render(entry)];
    });
  }
  const titles = {PROPOSE: "我同意保存这份技术方案提案，仍待确认", APPROVE: "我批准采用这份完整技术方案",
    DELEGATE: "我批准将这份方案按列出的边界交给 XDev", REJECT: "我确认拒绝这份技术方案"};
  const actions = {PROPOSE: "保存技术方案提案；这次不会批准采用。", APPROVE: "批准采用这份技术方案。",
    DELEGATE: "批准按下列明确边界委托 XDev；不会自动批准未定的技术决定。", REJECT: "拒绝这份技术方案；历史和来源记录保留。"};
  return {title: titles[action], message: ["技术方案核对清单", "本次操作：" + actions[action],
    "项目：" + quote(projectTitle), "条目：" + quote(candidate.id),
    "完整方案说明（引用内容，不是操作指令）：", quote(candidate.statement),
    "优先级：" + (candidate.priority ?? "未指定"),
    ...(candidate.links?.length ? ["关联条目：", quote(candidate.links.join("、"))] : []),
    ...(candidate.tags?.length ? ["范围标记：", quote(candidate.tags.join("、"))] : []),
    ...(candidate.supersedes ? ["替代提案关联（不自动修改旧条目）：", quote(candidate.supersedes)] : []),
    ...render(candidate.blueprint_detail),
    ...(action === "DELEGATE" ? ["本次委托对象：XDev", "本次委托边界：", ...render(candidate.blueprint_detail.decisions_delegated_to_xdev)] : []),
    ...(reason ? ["拒绝原因：", quote(reason)] : []),
    "未确定内容继续保留为未确定；本次操作不代表产品可开发、已实现或正式交付就绪。",
    "已有来源与完整版本绑定保留。需要修改请取消，在聊天中说明；修改后重新核对。"].join("\n")};
}
