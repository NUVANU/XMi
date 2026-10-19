# ADR-022 — 宿主原生 Agent 规格内容评审

2026-10-17 Owner-approved amendment: new default runs use lightweight readable-document advice (LIGHT-DOCUMENT-REVIEW-20261017.md), not the exhaustive model/coverage protocol described historically below. XMI-DOCUMENT-REVIEW/1 has no formal gate authority. Old runs keep their original contract; no history is rewritten.

Date: 2026-10-16
Status: Accepted — Owner 明确要求补上真实独立评审，选择复用本机 Codex 登录，并要求先实现宿主新建 Agent 的方式。

## 范围

在 ADR-021 的范围收敛基础上，仅补一条可选的规格内容评审路径：冻结规格 → 宿主新建独立上下文 Agent → 读取完整材料 → 返回问题、依据和建议 → XMi 核对原生来源并保存结果 → 用户按模块决定如何修改。

不建设新的模型服务、多供应商路由或 Agent 平台，不生成 XDev 实现任务，不改变采访和产品确认权。普通规格生成及有效 NOT_READY 候选包导出不强制执行此路径。

## 官方能力与实际边界

官方文档确认宿主支持子 Agent；子 Agent 继承父会话的权限与沙箱，单靠开发者指令不会创建独立只读沙箱。自定义 Agent 可以减少部分工具能力，但不能假设所有宿主暴露相同的创建、身份或证据接口。

来源：[OpenAI Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)，2026-10-16 核对；本机另以真实创建和返回记录验证当前原生日志形状。

当前只接入本机 Codex 已观察到的 `collaboration.spawn_agent` 与原生 session 日志格式。XMi MCP 服务不伪造创建 Agent 的通用 API，也不自行调用另一家模型服务。宿主按返回的固定 host_job 创建 Agent；通用 MCP/WorkBuddy/云端缺少这个适配器时明确不可用，不宣称同样可执行。

同会话恢复可能保留多个具有相同 session_meta.id 的日志。唯一候选保持原有路径；候选超过一份时，只读查询同一 Codex 数据目录下已观察到的 `state_5.sqlite` / `threads(id, rollout_path)` 原生路由，再核对候选归属、目录边界和头部身份。该索引不创建、不迁移、不修改，不根据文件日期或 mtime 选择。索引缺失、格式变化、路由歧义或目标不匹配时继续拒绝。已冻结的 parent_log 与 anchor 不会因索引更新而被悄悄替换。见 HOST-AGENT-MULTILOG-FIX-20261016.md。

## 数据与调用

- 原本的 `xmi_spec_review_start` / `status` 保留旧合成兼容输出，新宿主输出使用独立版本 `XMI-HOST-SPEC-REVIEW/1`。
- 原生本地入口展示 28 项工具，通用入口维持 26 项；不新增第三个通用执行工具。
- start 仅接收项目、版本、幂等键和真实会话路由。首次冻结材料并返回随机 task_name、`fork_turns=none` 与固定任务；同一请求在 Agent 完成后再次 start 收取结果。status 只读，不追加记录。
- 不接受主助手传入的评审 JSON、PASS、Agent 身份、日志路径、批准或隔离声明。评审不会生成产品确认事件，也不批准导出。
- 复用既有完整模型/16 文件/作用域三元组/编译规则哈希绑定、引用与覆盖校验。所有相关 ID 都必须覆盖；空发现不等于理解正确或专业认证。
- 完整评审材料写入现有数据库相邻的私有 `xmi-spec-reviews/materials/`，使用摘要文件名和有限读取。只包含已映射来源的冻结 Product Model 与候选包，非原始设计文件、完整访谈或凭据。
- 原生来源核对限定到当前父会话新增的有限日志和指定子会话。检查唯一创建、fresh context、父子关系、完成消息、子会话最终回复、唯一指定读取命令及完整实际输出；继承上下文、额外工具、被引导的 Agent、来源不符、材料截断或版本变化均拒绝。
- 既有证据 SQLite 独立格式从 109 升至 110，以允许 HOST_AGENT 记录；旧 TEST_ONLY 字节保留，产品数据库和 XSpec schema 不迁移。

## 真实内容评审与正式保证

来源核对成功的 HOST_AGENT 结果是真实内容评审，不再称为 TEST_ONLY。它记录的是观察到的原生执行与材料读取，不是密码学身份认证、受控操作系统隔离或第三方专业审计。

因此新输出明确 `source_verified=true`、`isolation_status=HOST_INHERITED_PERMISSIONS`、`gate_eligible=false`。缺少有效权限隔离的既有正式保证门槛仍不能自动通过；不得为了消除 private-test-project 提示而伪造 M11 记录。XMi 宿主应分别说明“内容评审已完成”和“正式隔离保证未验证”，不能把两者都描述成尚无真实评审。

## 失败与恢复

同一幂等键只对应一份冻结材料与指定 Agent。处理中只查看同一 Agent，不自动创建替代品、不自动分批、不自动重试模型、不发送跟进指令。用户暂停时按宿主能力停止，保留未完成状态。材料过大或上下文不足时报告不完整，不能截断后宣称完整覆盖。

原生日志格式变更、压缩、归档、缺失或超过有限读取窗口时，返回 UNVERIFIED/STALE/UNKNOWN 及诊断，不直接回写产品或绕过原生信任。即使是已保存结果，查询仍核对当前材料及原生来源；当前实现不承诺脱离日志的永久认证。

## 验证要求

原生来源的正反例、旧证据迁移、MCP 严格输入输出、产品状态不变、全量回归，以及至少一次真实宿主 Agent 对完整合成规格的创建、读取、返回与收取。真实 private-test-project 首次使用及其他宿主兼容单独记录，不以工程合成项目代替。

## 2026-10-17：获批的无损有限分页修正

真实 private-test-project 大包试用证明单次工具输出和原生持久化分别可能截断。Owner 批准仅一个新 Agent、无损去重、最多 64 页、零重试的验证。新任务使用透明字典保留原包和全部 16 文件字节，每页不超过 32 KiB，逐页独立读取；收集器同时核对命令持久化及外层工具交付、原包恢复、上下文余量与无压缩。旧冻结包/绑定/失败记录保留；不恢复旧 Agent，不增加模块调度。字节预检不是 tokenizer 适配保证；容量不足停止。详见 HOST-AGENT-PAGED-TRANSPORT-20261017.md。本段替代“唯一单次读取”的当前执行方式，其余来源、确认与正式保证限制不变。
