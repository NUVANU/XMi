import type { Candidate, DeliveryMode } from "../shared-types/domain.ts";

export type ProfileArea = "PRODUCT_USERS" | "IDENTITY_ACCESS" | "DATA" | "FUNCTIONAL_STATES" |
  "COMMERCIAL" | "NOTIFICATIONS_INTEGRATIONS" | "SECURITY_PRIVACY" | "NON_FUNCTIONAL";
export type ApplicabilityKey = "ALWAYS" | "ACCOUNT_OR_PRIVATE" | "COMMERCIAL" | "INTEGRATION" | "GAME_ONLINE";

export type ProfileRule = {
  id: string;
  area: ProfileArea;
  label: string;
  minimum_mode: DeliveryMode;
  applicability: ApplicabilityKey;
  evidence_types: Candidate["type"][];
  evidence_tags: string[];
  evidence_keywords: string[];
};

const r = (id: string, area: ProfileArea, label: string, minimum_mode: DeliveryMode,
  applicability: ApplicabilityKey, evidence_types: Candidate["type"][], evidence_tags: string[],
  evidence_keywords: string[]): ProfileRule => ({
  id, area, label, minimum_mode, applicability, evidence_types, evidence_tags, evidence_keywords,
});

// Data, not branching logic: the engine below this table treats each row identically.
// V0 is intentionally limited to the Web App / Micro-SaaS profile defined in docs/08.
export const WEB_MICRO_SAAS_V0_RULES: readonly ProfileRule[] = [
  r("product.problem-outcome", "PRODUCT_USERS", "problem and desired outcome", "FAST_VALIDATION", "ALWAYS",
    ["vision", "goal"], ["problem", "outcome"], ["problem", "outcome", "goal", "结果", "目标", "问题"]),
  r("product.primary-user", "PRODUCT_USERS", "primary user", "FAST_VALIDATION", "ALWAYS",
    ["actor"], ["primary-user"], ["primary user", "main user", "主要用户", "目标用户"]),
  r("product.admin-support", "PRODUCT_USERS", "administrator/support actor", "FAST_DEVELOPMENT", "ALWAYS",
    ["actor", "decision", "exclusion"], ["admin", "support"], ["admin", "administrator", "support", "管理员", "支持"]),
  r("product.core-journey", "PRODUCT_USERS", "core user journey", "FAST_VALIDATION", "ALWAYS",
    ["flow"], ["core"], ["journey", "flow", "流程", "路径"]),
  r("product.mvp-boundary", "PRODUCT_USERS", "MVP boundary", "FAST_VALIDATION", "ALWAYS",
    ["exclusion", "constraint", "decision"], ["scope", "mvp"], ["mvp", "out of scope", "first version", "首版", "范围", "不做"]),

  r("identity.usage-model", "IDENTITY_ACCESS", "anonymous versus account-based usage", "FAST_VALIDATION", "ALWAYS",
    ["decision", "constraint", "functional_requirement", "exclusion"], ["identity", "account"],
    ["anonymous", "guest", "account", "sign in", "login", "匿名", "游客", "账号", "登录"]),
  r("identity.signup-signin", "IDENTITY_ACCESS", "sign-up/sign-in", "FAST_DEVELOPMENT", "ACCOUNT_OR_PRIVATE",
    ["functional_requirement", "flow", "integration"], ["auth", "sign-in"], ["sign up", "sign in", "login", "register", "注册", "登录"]),
  r("identity.recovery", "IDENTITY_ACCESS", "account recovery", "FAST_DEVELOPMENT", "ACCOUNT_OR_PRIVATE",
    ["functional_requirement", "flow", "solution_constraint"], ["recovery", "auth"], ["account recovery", "password reset", "recover account", "找回", "重置密码", "忘记密码"]),
  r("identity.roles-permissions", "IDENTITY_ACCESS", "roles and permissions", "FAST_DEVELOPMENT", "ACCOUNT_OR_PRIVATE",
    ["permission_rule", "decision"], ["role", "permission"], ["role", "permission", "access", "角色", "权限", "访问"]),
  r("identity.data-isolation", "IDENTITY_ACCESS", "data isolation", "FAST_DEVELOPMENT", "ACCOUNT_OR_PRIVATE",
    ["permission_rule", "functional_requirement", "decision"], ["isolation", "private-data"],
    ["own data", "private data", "tenant", "isolation", "自己的数据", "私有数据", "租户", "隔离"]),
  r("identity.account-deletion", "IDENTITY_ACCESS", "account deletion", "FAST_DEVELOPMENT", "ACCOUNT_OR_PRIVATE",
    ["functional_requirement", "flow", "decision"], ["account-deletion"], ["delete account", "close account", "注销", "删除账号", "关闭账号", "关闭账户", "停用账号", "停用账户", "禁用账号", "禁用账户"]),

  r("data.entities-ownership", "DATA", "entities and ownership", "FAST_DEVELOPMENT", "ALWAYS",
    ["data_entity", "permission_rule"], ["ownership"], ["entity", "owner", "record", "数据实体", "所有权", "记录"]),
  r("data.persistence", "DATA", "persistence versus ephemeral data", "FAST_VALIDATION", "ALWAYS",
    ["data_entity", "decision", "constraint"], ["persistence", "ephemeral"], ["persist", "save", "ephemeral", "session", "保存", "持久", "会话"]),
  r("data.import-export", "DATA", "import/export", "PRODUCT_GRADE", "ALWAYS",
    ["functional_requirement", "flow", "decision", "exclusion"], ["import", "export"], ["import", "export", "导入", "导出"]),
  r("data.retention-deletion", "DATA", "retention/deletion", "FAST_DEVELOPMENT", "ALWAYS",
    ["data_entity", "decision", "functional_requirement"], ["retention", "deletion"], ["retain", "retention", "delete", "保留", "删除"]),
  r("data.audit-logging", "DATA", "audit/logging needs", "PRODUCT_GRADE", "ALWAYS",
    ["non_functional_requirement", "decision"], ["audit", "logging"], ["audit", "log", "logging", "审计", "日志"]),
  r("data.backup-recovery", "DATA", "backup/recovery expectations", "PRODUCT_GRADE", "ALWAYS",
    ["non_functional_requirement", "decision"], ["backup", "recovery"], ["backup", "restore", "recovery", "备份", "恢复"]),

  r("state.empty", "FUNCTIONAL_STATES", "empty state", "FAST_DEVELOPMENT", "ALWAYS",
    ["functional_requirement", "acceptance_criterion"], ["empty-state"], ["empty state", "no results", "空状态", "无数据"]),
  r("state.invalid-input", "FUNCTIONAL_STATES", "invalid input", "FAST_DEVELOPMENT", "ALWAYS",
    ["functional_requirement", "acceptance_criterion"], ["invalid-input"], ["invalid input", "validation error", "无效输入", "校验错误"]),
  r("state.loading-timeout", "FUNCTIONAL_STATES", "loading/timeout", "FAST_DEVELOPMENT", "ALWAYS",
    ["functional_requirement", "acceptance_criterion", "non_functional_requirement"], ["timeout", "loading"],
    ["loading", "timeout", "加载", "超时"]),
  r("state.integration-unavailable", "FUNCTIONAL_STATES", "unavailable integration", "FAST_DEVELOPMENT", "INTEGRATION",
    ["functional_requirement", "acceptance_criterion", "integration"], ["integration-failure", "fallback"],
    ["unavailable", "fallback", "service down", "不可用", "降级", "备用"]),
  r("state.permission-denied", "FUNCTIONAL_STATES", "permission denied", "FAST_DEVELOPMENT", "ACCOUNT_OR_PRIVATE",
    ["functional_requirement", "acceptance_criterion", "permission_rule"], ["permission-denied"],
    ["permission denied", "access denied", "无权限", "拒绝访问"]),
  r("state.duplicate-operation", "FUNCTIONAL_STATES", "duplicate operation", "FAST_DEVELOPMENT", "ALWAYS",
    ["functional_requirement", "acceptance_criterion"], ["duplicate-operation"], ["duplicate", "idempotent", "重复操作", "幂等"]),
  r("state.cancel-retry", "FUNCTIONAL_STATES", "cancellation/retry", "FAST_DEVELOPMENT", "ALWAYS",
    ["functional_requirement", "acceptance_criterion"], ["cancel", "retry"], ["cancel", "retry", "取消", "重试"]),
  r("state.partial-failure", "FUNCTIONAL_STATES", "partial failure", "FAST_DEVELOPMENT", "ALWAYS",
    ["functional_requirement", "acceptance_criterion"], ["partial-failure"], ["partial failure", "partially", "部分失败"]),

  r("commercial.free-paid", "COMMERCIAL", "free/paid boundary", "FAST_VALIDATION", "COMMERCIAL",
    ["decision", "functional_requirement", "constraint"], ["pricing", "commercial"], ["free", "paid", "price", "收费", "免费", "付费", "价格"]),
  r("commercial.subscription", "COMMERCIAL", "subscription start/change/cancel", "FAST_DEVELOPMENT", "COMMERCIAL",
    ["functional_requirement", "flow", "decision"], ["subscription"], ["subscription", "plan", "cancel", "订阅", "套餐", "取消"]),
  r("commercial.payment-failure", "COMMERCIAL", "payment failure", "FAST_DEVELOPMENT", "COMMERCIAL",
    ["functional_requirement", "acceptance_criterion"], ["payment-failure"], ["payment fail", "card declined", "支付失败", "扣款失败"]),
  r("commercial.refund-support", "COMMERCIAL", "refund/support policy as product behavior", "PRODUCT_GRADE", "COMMERCIAL",
    ["decision", "functional_requirement"], ["refund"], ["refund", "chargeback", "退款", "退费"]),
  r("commercial.usage-limits", "COMMERCIAL", "usage limits", "FAST_DEVELOPMENT", "COMMERCIAL",
    ["constraint", "functional_requirement", "decision"], ["usage-limit"], ["usage limit", "quota", "rate limit", "额度", "配额", "限制"]),

  r("integration.provider-fallback", "NOTIFICATIONS_INTEGRATIONS", "provider and fallback", "FAST_DEVELOPMENT", "INTEGRATION",
    ["integration", "decision", "constraint"], ["provider", "fallback"], ["provider", "fallback", "供应商", "降级", "备用"]),
  r("integration.permission-consent", "NOTIFICATIONS_INTEGRATIONS", "permission/consent", "FAST_DEVELOPMENT", "INTEGRATION",
    ["permission_rule", "functional_requirement", "decision"], ["consent"], ["consent", "permission", "授权", "同意", "权限"]),
  r("integration.delivery-failure", "NOTIFICATIONS_INTEGRATIONS", "delivery failure", "FAST_DEVELOPMENT", "INTEGRATION",
    ["functional_requirement", "acceptance_criterion", "integration"], ["delivery-failure"], ["delivery fail", "failed delivery", "发送失败", "投递失败"]),
  r("integration.external-data", "NOTIFICATIONS_INTEGRATIONS", "data shared externally", "FAST_DEVELOPMENT", "INTEGRATION",
    ["data_entity", "decision", "integration"], ["external-data"], ["shared externally", "send data", "third party", "外部共享", "第三方", "发送数据"]),
  r("integration.manual-alternative", "NOTIFICATIONS_INTEGRATIONS", "manual alternative", "PRODUCT_GRADE", "INTEGRATION",
    ["functional_requirement", "flow", "decision"], ["manual-fallback"], ["manual alternative", "manual fallback", "人工替代", "手动备用"]),

  r("security.data-sensitivity", "SECURITY_PRIVACY", "data sensitivity", "FAST_VALIDATION", "ALWAYS",
    ["decision", "risk", "data_entity", "constraint"], ["data-sensitivity"], ["sensitive", "personal data", "pii", "敏感", "个人数据", "隐私"]),
  r("security.user-isolation", "SECURITY_PRIVACY", "user isolation", "FAST_DEVELOPMENT", "ACCOUNT_OR_PRIVATE",
    ["permission_rule", "functional_requirement"], ["isolation"], ["isolation", "tenant", "own data", "隔离", "租户", "自己的数据"]),
  r("security.admin-access", "SECURITY_PRIVACY", "administrator access", "PRODUCT_GRADE", "ACCOUNT_OR_PRIVATE",
    ["permission_rule", "decision"], ["admin-access"], ["administrator access", "admin access", "管理员访问", "后台访问"]),
  r("security.secret-handling", "SECURITY_PRIVACY", "secret handling", "FAST_DEVELOPMENT", "INTEGRATION",
    ["non_functional_requirement", "constraint", "decision"], ["secret-handling"], ["secret", "credential", "token", "密钥", "凭证", "令牌"]),
  r("security.deletion-export", "SECURITY_PRIVACY", "deletion/export", "FAST_DEVELOPMENT", "ALWAYS",
    ["functional_requirement", "decision", "data_entity"], ["deletion", "export"], ["delete", "export", "删除", "导出"]),
  r("security.regulated-risk", "SECURITY_PRIVACY", "regulated/high-risk data flags", "FAST_VALIDATION", "ALWAYS",
    ["risk", "decision", "constraint"], ["regulated", "high-risk"], ["regulated", "medical", "health", "biometric", "监管", "医疗", "健康", "生物识别"]),

  r("nfr.devices-browsers", "NON_FUNCTIONAL", "supported devices/browsers", "FAST_DEVELOPMENT", "ALWAYS",
    ["non_functional_requirement", "constraint"], ["device", "browser"], ["browser", "mobile", "desktop", "device", "浏览器", "移动端", "桌面"]),
  r("nfr.scale", "NON_FUNCTIONAL", "expected scale", "FAST_DEVELOPMENT", "ALWAYS",
    ["non_functional_requirement", "constraint"], ["scale"], ["scale", "concurrent", "users", "并发", "规模", "用户量"]),
  r("nfr.response-time", "NON_FUNCTIONAL", "response time expectations", "FAST_DEVELOPMENT", "ALWAYS",
    ["non_functional_requirement"], ["performance", "latency"], ["response time", "latency", "performance", "响应时间", "延迟", "性能"]),
  r("nfr.availability-recovery", "NON_FUNCTIONAL", "availability/recovery", "FAST_DEVELOPMENT", "ALWAYS",
    ["non_functional_requirement", "solution_constraint"], ["availability", "recovery"], ["availability", "recovery", "uptime", "可用性", "恢复"]),
  r("nfr.operating-cost", "NON_FUNCTIONAL", "operating cost boundary", "FAST_DEVELOPMENT", "ALWAYS",
    ["non_functional_requirement", "constraint", "solution_constraint"], ["cost"], ["operating cost", "budget", "cost", "运行成本", "预算", "成本"]),
  r("nfr.accessibility-localization", "NON_FUNCTIONAL", "accessibility/localization", "PRODUCT_GRADE", "ALWAYS",
    ["non_functional_requirement", "decision"], ["accessibility", "localization"], ["accessibility", "localization", "a11y", "无障碍", "本地化", "多语言"]),
];

export const DIGITAL_GAME_V0_RULES: readonly ProfileRule[] = [
  r("game.purpose-outcome", "PRODUCT_USERS", "game premise and intended player experience", "FAST_VALIDATION", "ALWAYS",
    ["vision", "goal"], ["game-premise", "player-outcome"], ["game", "player", "玩法", "游戏", "玩家", "体验"]),
  r("game.player-actors", "PRODUCT_USERS", "players, controlled characters and other actors", "FAST_VALIDATION", "ALWAYS",
    ["actor", "decision"], ["player-actor"], ["player", "protagonist", "character", "玩家", "主角", "角色"]),
  r("game.core-loop", "PRODUCT_USERS", "repeatable core play loop", "FAST_VALIDATION", "ALWAYS",
    ["flow"], ["core-loop"], ["loop", "play", "turn", "match", "关卡", "回合", "对局", "循环", "玩法"]),
  r("game.scope", "PRODUCT_USERS", "first playable scope and exclusions", "FAST_VALIDATION", "ALWAYS",
    ["decision", "constraint", "exclusion"], ["scope", "mvp"], ["first version", "scope", "prototype", "首版", "范围", "原型"]),
  r("game.mechanics", "FUNCTIONAL_STATES", "player actions and game rules", "FAST_VALIDATION", "ALWAYS",
    ["functional_requirement", "flow", "decision"], ["game-mechanics"], ["mechanic", "action", "rule", "操作", "规则", "机制"]),
  r("game.outcomes", "FUNCTIONAL_STATES", "success, failure and end conditions", "FAST_VALIDATION", "ALWAYS",
    ["decision", "functional_requirement", "flow"], ["game-outcome"], ["win", "lose", "end", "score", "胜利", "失败", "结束", "得分"]),
  r("game.systems-inventory", "FUNCTIONAL_STATES", "included game systems and their boundaries", "FAST_DEVELOPMENT", "ALWAYS",
    ["decision", "constraint"], ["game-systems"], ["systems", "inventory", "progression", "系统", "道具", "成长", "资源"]),
  r("game.progression", "FUNCTIONAL_STATES", "progression, reset and replay behavior", "FAST_DEVELOPMENT", "ALWAYS",
    ["decision", "functional_requirement", "flow", "exclusion"], ["progression"], ["progress", "level", "reset", "replay", "成长", "升级", "重置", "重玩"]),
  r("game.resources", "DATA", "items, resources, ownership and state changes", "FAST_DEVELOPMENT", "ALWAYS",
    ["data_entity", "decision", "functional_requirement", "exclusion"], ["game-resources"], ["item", "resource", "inventory", "道具", "资源", "背包"]),
  r("game.save", "DATA", "save, resume and deletion behavior", "FAST_DEVELOPMENT", "ALWAYS",
    ["data_entity", "decision", "functional_requirement"], ["save-state"], ["save", "load", "resume", "存档", "读档", "继续"]),
  r("game.platform-controls", "NON_FUNCTIONAL", "target platform and player controls", "FAST_DEVELOPMENT", "ALWAYS",
    ["constraint", "non_functional_requirement", "decision"], ["platform", "controls"], ["platform", "control", "mobile", "desktop", "web", "平台", "操作", "移动端", "桌面"]),
  r("game.fault-states", "FUNCTIONAL_STATES", "interruption, invalid action and recovery", "FAST_DEVELOPMENT", "ALWAYS",
    ["functional_requirement", "acceptance_criterion", "decision"], ["game-failure"], ["invalid", "interrupt", "recover", "retry", "无效", "中断", "恢复", "重试"]),
  r("game.online-model", "FUNCTIONAL_STATES", "session, synchronization and disconnect behavior", "FAST_DEVELOPMENT", "GAME_ONLINE",
    ["flow", "functional_requirement", "decision"], ["online-session"], ["multiplayer", "sync", "disconnect", "联机", "同步", "掉线", "匹配"]),
  r("game.online-roles", "IDENTITY_ACCESS", "online identity and player permissions", "FAST_DEVELOPMENT", "GAME_ONLINE",
    ["permission_rule", "decision"], ["online-role"], ["account", "identity", "role", "账号", "身份", "权限"]),
  r("game.monetization", "COMMERCIAL", "purchases, entitlements and failure behavior", "FAST_DEVELOPMENT", "COMMERCIAL",
    ["functional_requirement", "decision", "flow"], ["game-commerce"], ["purchase", "payment", "entitlement", "付费", "购买", "充值", "权益"]),
  r("game.external-services", "NOTIFICATIONS_INTEGRATIONS", "external provider, data sharing and fallback", "FAST_DEVELOPMENT", "INTEGRATION",
    ["integration", "decision", "functional_requirement"], ["game-integration"], ["provider", "fallback", "service", "供应商", "降级", "外部服务"]),
  r("game.privacy", "SECURITY_PRIVACY", "player data, moderation and safety scope", "FAST_DEVELOPMENT", "ALWAYS",
    ["decision", "risk", "permission_rule", "constraint"], ["game-safety"], ["privacy", "moderation", "safety", "隐私", "审核", "安全"]),
  r("game.operations", "NON_FUNCTIONAL", "performance, compatibility and recovery expectations", "PRODUCT_GRADE", "ALWAYS",
    ["non_functional_requirement", "decision"], ["game-operations"], ["performance", "compatibility", "recovery", "性能", "兼容", "恢复"]),
];
