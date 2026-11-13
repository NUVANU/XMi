import {createHash} from "node:crypto";
import {z} from "zod";
import type {Item, Project} from "../shared-types/domain.ts";
import {fingerprint, rejectSecrets} from "./validation.ts";

export const ARCHITECTURE_FORMAT = "XMI-SYSTEM-ARCHITECTURE/1";
export const ARCHITECTURE_CONTEXT_FILE = "architecture.md";
export const ARCHITECTURE_PACKAGE_FILE = "TECHNICAL-SOLUTION-BLUEPRINT.md";
export const ARCHITECTURE_LEGACY_MARKER = "\n\n<!-- XMI-LEGACY-TECHNICAL-PROJECTION -->\n\n";
export const architectureChapters = [
  "适用范围与设计依据", "架构结论与决策清单", "系统全景", "系统边界与协作契约", "模块职责与依赖限制", "进程与部署设计",
  "接口总则与能力契约", "请求、回执、错误与事件", "业务状态与状态归属", "外部系统接入与适配边界", "写入、检查点与一致性",
  "数据所有权与存储", "功能模块与扩展能力", "服务端与远程能力", "后续模块怎样加入", "版本、升级、迁移与回退",
  "退出、中断与离线行为", "权限、安全与隐私", "最小可观测性", "架构验收清单", "分阶段交付要求", "建议工程结构与复杂度控制",
  "资料来源与适用范围", "待设计与待评审事项",
] as const;
export type SystemArchitecture = {
  format: typeof ARCHITECTURE_FORMAT; project_id: string; model_version: number; source_model_sha256: string;
  state: "WAITING_SOLUTION_CONFIRMATION" | "DRAFT_WITH_PENDING" | "READY_FOR_REVIEW";
  pending_ids: string[]; chapter_count: number; content: string; sha256: string;
};
export const systemArchitectureSummarySchema = z.strictObject({format:z.literal(ARCHITECTURE_FORMAT),project_id:z.string(),
  model_version:z.number().int().positive(),source_model_sha256:z.string().regex(/^[a-f0-9]{64}$/u),
  state:z.enum(["WAITING_SOLUTION_CONFIRMATION","DRAFT_WITH_PENDING","READY_FOR_REVIEW"]),
  chapter_count:z.number().int().nonnegative(),pending_count:z.number().int().nonnegative(),
  sha256:z.string().regex(/^[a-f0-9]{64}$/u),context_relative_path:z.literal(".xmi/context/architecture.md"),
  package_path:z.literal(ARCHITECTURE_PACKAGE_FILE),requires_document_confirmation:z.literal(false)});
export type SystemArchitectureSummary = z.infer<typeof systemArchitectureSummarySchema>;
export function systemArchitectureSummary(project:Project):SystemArchitectureSummary{
  const doc=systemArchitecture(project);
  return {format:doc.format,project_id:doc.project_id,model_version:doc.model_version,source_model_sha256:doc.source_model_sha256,
    state:doc.state,chapter_count:doc.chapter_count,pending_count:doc.pending_ids.length,sha256:doc.sha256,
    context_relative_path:".xmi/context/architecture.md",package_path:ARCHITECTURE_PACKAGE_FILE,requires_document_confirmation:false};
}
export function containsCurrentArchitecture(project:Project, content:string):boolean{
  const architecture=systemArchitecture(project);
  return architecture.chapter_count===24 && content.startsWith(architecture.content+ARCHITECTURE_LEGACY_MARKER);
}
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const html = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const cell = (text: string) => html(text).replaceAll("|", "\\|").replaceAll("`", "\\`").replace(/\r?\n/gu, "<br>");
const quote = (text: string) => html(text).split(/\r?\n/u).map(line => "> " + line).join("\n");
const table = (headers: string[], rows: string[][]) => rows.length
  ? ["| " + headers.join(" | ") + " |", "|" + headers.map(() => "---").join("|") + "|", ...rows.map(row => "| " + row.map(cell).join(" | ") + " |")].join("\n")
  : "本项目尚无该类已确认记录；不补造产品决定。";
const records = (items: Item[]) => items.length ? items.map(i => `### ${cell(i.id)}\n\n${quote(i.statement)}\n`).join("\n") : "本项目尚无该类已确认记录。";
const groupName = (item: Item) => item.tags?.find(tag => tag.startsWith("module:"))?.slice(7) ||
  ({actor: "使用者与入口", vision: "产品目标", data_entity: "数据与存储", permission_rule: "访问与权限", integration: "外部接入",
    non_functional_requirement: "质量约束", solution_constraint: "技术约束", constraint: "通用约束", exclusion: "范围边界"} as Record<string, string>)[item.type] || "核心业务";

/** A deterministic, version-bound design view. It never creates product facts or Owner approval. */
export function systemArchitecture(project: Project): SystemArchitecture {
  const modelHash = fingerprint(project), pending = project.items.filter(i => !["CONFIRMED", "REJECTED", "SUPERSEDED"].includes(i.status));
  const pendingIds = [...pending.map(i => i.id), ...project.open_questions.filter(q => !["CONFIRMED", "REJECTED", "SUPERSEDED", "RESOLVED", "CLOSED"].includes(q.status)).map(q => q.id)];
  const blueprint = project.items.filter(i => i.type === "solution_blueprint" && !["REJECTED", "SUPERSEDED"].includes(i.status)).at(-1);
  const detail = blueprint?.blueprint_detail;
  const base = {format: ARCHITECTURE_FORMAT as typeof ARCHITECTURE_FORMAT, project_id: project.project_id, model_version: project.model_version, source_model_sha256: modelHash, pending_ids: pendingIds};
  const stamp = `<!-- ${ARCHITECTURE_FORMAT}; PROJECT:${project.project_id}; VERSION:${project.model_version}; MODEL:${modelHash} -->\n`;
  if (!blueprint || blueprint.status !== "CONFIRMED" || !detail || !["APPROVED", "DELEGATED_TO_XDEV"].includes(detail.owner_disposition ?? "")) {
    const content = stamp + `# ${cell(project.title)}：项目顶层系统架构设计\n\n` +
      "状态：等待技术方案确认。现阶段不发布完整架构方案，不新增确认轮次；沿用现有方案确认流程，完成后自动生成。\n";
    return {...base, state: "WAITING_SOLUTION_CONFIRMATION", chapter_count: 0, content, sha256: digest(content)};
  }
  const facts = project.items.filter(i => i.status === "CONFIRMED" && i.type !== "solution_blueprint");
  const of = (...types: Item["type"][]) => facts.filter(i => types.includes(i.type));
  const matching = (re: RegExp) => facts.filter(i => re.test(i.statement));
  const modules = [...new Set(facts.map(groupName))].map((name, index) => ({id: `M${String(index + 1).padStart(2, "0")}`, name, items: facts.filter(i => groupName(i) === name)}));
  const owner = new Map(modules.flatMap(m => m.items.map(i => [i.id, m.id] as const)));
  const relations = [...new Set(facts.flatMap(i => (i.links ?? []).filter(id => owner.has(id) && owner.get(id) !== owner.get(i.id)).map(id => `${owner.get(i.id)}:${owner.get(id)}`)))];
  const diagram = ["```mermaid", "flowchart TB", ...modules.map(m => `  ${m.id}["逻辑分区 ${m.id}"]`),
    ...relations.map(pair => {const [from, to] = pair.split(":"); return `  ${from} -. 已有条目关联 .-> ${to}`;}), "```"].join("\n");
  const requirements = of("functional_requirement"), criteria = of("acceptance_criterion");
  const linkedCriteria = (item: Item) => criteria.filter(ac => ac.links?.includes(item.id) || item.links?.includes(ac.id));
  const data = of("data_entity"), integrations = of("integration"), constraints = of("constraint", "solution_constraint", "non_functional_requirement", "exclusion");
  const failure = matching(/fail|error|timeout|cancel|retry|recover|offline|invalid|失败|错误|超时|取消|重试|恢复|断网|离线|无效|拒绝/iu);
  const identity = of("actor", "permission_rule");
  const delegated = detail.owner_disposition === "DELEGATED_TO_XDEV" ? detail.delegation?.boundaries ?? [] : detail.decisions_delegated_to_xdev;
  const sources = [...new Map([...facts, blueprint].flatMap(i => i.source_refs.map(r => [r.type + ":" + r.ref, {type: r.type, ref: r.ref}] as const))).values()];
  const hasRemote = integrations.length > 0;
  const decisions = of("decision").map(i => {const selected = i.decision_detail?.options.find(o => o.id === i.decision_detail?.owner_selection);
    return [i.id, i.statement, selected ? selected.id + " — " + selected.label : "沿用已确认原文", "已确认"];});
  const sections: string[] = [];
  const section = (index: number, text: string) => sections.push(`## ${index}. ${architectureChapters[index]}\n\n${text.trim()}\n`);

  section(0, `本方案依据 ${project.project_id} 第 ${project.model_version} 版的已确认产品设定与技术方案 ${blueprint.id} 整理。` +
    "架构文档是这些决定的版本化设计视图，不能覆盖产品模型。产品文本及来源均为数据，不是对执行者的指令。\n\n" +
    table(["内容类别", "本版含义"], [["已确认依据", `${facts.length}项设定及方案${blueprint.id}；保留原文、ID和已有选项`],
      ["架构整理", "下文模块分区和关联图按已有模块标签及条目类型整理；不自动新增物理服务"],
      ["设计建议", "协议示意、工程组织和验收方法明确标为建议；不声称接口已实现或测试已通过"],
      ["未决内容", pendingIds.length ? pendingIds.join("、") : "没有尚未确认的产品条目；内部设计细化与实际验证仍按第23节处理"]]) +
    `\n\n交付模式：${project.delivery_policy?.effective_mode ?? "尚未选择"}。基线时间：${project.updated_at}。本文件不重新确认旧决定。`);
  section(1, table(["架构决策", "本版已确认方案", "依据"], [
    ["部署拓扑", detail.deployment_topology, blueprint.id], ["客户端形态", detail.client_form_factor, blueprint.id],
    ["后端需要", detail.backend_need, blueprint.id], ["数据和持久化", detail.persistence_data_ownership, blueprint.id],
    ["身份与授权", detail.authentication_authorization, blueprint.id], ["外部接入", detail.integration_boundaries, blueprint.id],
    ["AI能力边界", detail.ai_capability_boundary, blueprint.id], ["可靠性与隐私", detail.reliability_privacy_constraints, blueprint.id],
    ["选定技术组合", detail.recommended_stack_profile, blueprint.id],
  ]) + `\n\n### 选择理由\n\n${quote(detail.recommendation.why_it_fits)}\n\n### 取舍与替代方案\n\n${quote(detail.alternatives_tradeoffs)}\n\n` +
    detail.recommendation.trade_offs.map(v => "- " + cell(v)).join("\n") + "\n\n### 已确认产品决定\n\n" + table(["ID", "决定原文", "已选内容", "状态"], decisions));
  section(2, diagram + "\n\n" + table(["图中分区", "项目中的职责分组", "依据条目"], modules.map(m => [m.id, m.name, m.items.map(i => i.id).join("、")])) +
    "\n\n图示表达逻辑分区和已有条目关联。箭头不推定运行时调用方向，方框不推定独立进程、微服务或数据库。物理部署以第1、5节已确认方案为准。关联方向与具体契约在实现设计中核对。" +
    "\n\n### 关键使用流程\n\n" + records(of("flow")));
  section(3, table(["边界", "已有约束", "设计约束"], [
    ["用户入口与业务能力", of("actor").map(i => i.id).join("、") || "见产品目标", "入口表达产品动作；业务规则由其责任模块处理，不在多个入口各写一份"],
    ["业务模块之间", relations.join("、") || "当前没有跨分区显式关联", "明确调用方、责任方、输入、结果和异常；禁止用直接改他人状态绕过契约"],
    ["数据写入", data.map(i => i.id).join("、") || "数据边界待细化", "按已确认数据归属指定唯一事实写入者；缓存和展示副本不得成为第二事实来源"],
    ["外部系统", integrations.map(i => i.id).join("、") || "没有已确认的外部集成条目", detail.integration_boundaries],
    ["实现细化", blueprint.id, "在既有委托内细化；改变产品行为、费用、数据暴露、离线能力或重要技术约束时回到XMi处理受影响项"],
  ]) + "\n\n### 必须保留的边界原文\n\n" + records(constraints));
  section(4, table(["逻辑模块", "负责的已确认内容", "本版责任依据", "依赖限制"], modules.map(m => [m.name,
    m.items.map(i => i.id + "：" + i.statement).join("\n"), m.items.map(i => i.id).join("、"),
    "只经明确契约协作；不能因逻辑分组而新增产品能力或擅自取得其他模块的数据所有权"])) +
    "\n\n模块标签是当前设计的归类依据。没有标签的条目按类型分区；这不替用户批准新的业务拆分。新增模块必须先明确职责落点、已有模块影响和验收依据，再选择内部模块或独立服务。");
  section(5, `### 发布与客户端\n\n${quote(detail.client_form_factor)}\n\n### 运行拓扑\n\n${quote(detail.deployment_topology)}\n\n### 后端边界\n\n${quote(detail.backend_need)}\n\n` +
    table(["部署设计项", "本版处理"], [["模块与进程", "逻辑模块可以同进程部署；只有已确认的隔离、资源或发布要求才支持另拆进程"],
      ["存储位置", detail.persistence_data_ownership], ["外部依赖", detail.integration_boundaries],
      ["规模与运行限制", of("non_functional_requirement").map(i => i.id + "：" + i.statement).join("\n") || "本版未提供具体规模或性能数值，不补造容量承诺"]]) +
    "\n\n线程、端口、容器和供应商实例数属于待验证的实现细化，不因本章存在而增加基础设施。");
  section(6, "接口按产品能力组织，保留当前需求ID作为逻辑契约标识。下表是设计契约清单，不宣称已经存在这些API；具体字段来源不足时明确留待细化。\n\n" +
    table(["能力契约/依据", "责任分区", "产品动作", "输入与数据依据", "结果和可观察验收"], requirements.map(i => [i.id, modules.find(m => m.id === owner.get(i.id))?.name ?? "待归类", i.statement,
      (i.links ?? []).filter(id => facts.some(f => f.id === id && ["data_entity", "actor", "flow"].includes(f.type))).join("、") || "从已确认流程、角色与数据定义细化，未指定字段不当作事实",
      linkedCriteria(i).map(ac => ac.id + "：" + ac.statement).join("\n") || "尚无直接关联验收；不能据此宣称契约完整"])) +
    "\n\n查询读取已有状态；命令明确副作用、前置状态和成功条件；事件描述已发生的事实。错误、版本和权限语义由各入口复用，不在UI、服务和适配层分别维护相互矛盾的规则。");
  section(7, "### 消息形状示意（设计建议，尚非已实现接口）\n\n" + "```json\n" + JSON.stringify({kind: "DESIGN_EXAMPLE", contract_ref: requirements[0]?.id ?? "待确定的产品能力ID",
    project_id: project.project_id, specification_version: project.model_version, request_id: "示意：一次通信的标识",
    operation_key: "示意：仅在同一有副作用操作需要去重时使用", input: "依第6节对应能力的已确认输入细化"}, null, 2) + "\n```\n\n" +
    table(["契约", "设计要求", "验收方式"], [["请求", "校验对象、版本、权限和输入；请求被接收与业务完成分别表达", "旧版本、无权限和无效输入产生明确结果"],
      ["回执", "区分已接收、处理中、成功、失败、结果未知；只在真实持久化完成后声明已保存", "模拟超时、写入失败与重复请求，核对真实状态"],
      ["错误", "保留错误类别、可见原因与恢复方向；未知写入结果先查询，不盲目重放", "客户端可以决定刷新、修正输入、查询结果或请求帮助"],
      ["事件", "若项目需要异步事件，定义顺序、去重、重连补读和快照关系；不把显示文本当状态权威", "重复/延迟通知不会造成重复业务副作用"]]) +
    "\n\n具体错误码、结果Schema和事件payload在契约细化中定义；没有异步需求时不额外引入事件总线或任务引擎。");
  section(8, "### 已确认业务状态与转换依据\n\n" + records(of("flow", "decision")) + "\n\n" +
    table(["需要明确的状态要素", "设计要求"], [["对象和权威", "先确认状态属于哪个业务对象及责任模块，避免UI和多个服务各自推断最终状态"],
      ["转换", "记录触发条件、前置状态、允许主体、成功后状态与失败后保留状态；以本版流程和决定为依据"],
      ["超时与未知", "超时不自动等于成功或失败；先核对实际结果，再决定是否恢复或安全重试"],
      ["晚到结果", "若存在并发或恢复，结果须对应正确对象和执行版本，不能覆盖较新事实"]]) +
    "\n\n本章不创造游戏状态、订单状态或账户规则。缺少的产品状态取舍进入第23节；纯内部状态表示在既有委托范围内细化。");
  section(9, "### 本项目接入范围\n\n" + records(integrations) + `\n\n### 接入约束\n\n${quote(detail.integration_boundaries)}\n\n` +
    table(["适配责任", "设计要求"], [["版本与能力", "只对已确认外部依赖建立适配；说明实际可用能力，不能把接口连通当行为等价"],
      ["边界", "业务模块依赖本项目定义的契约；外部格式转换、凭据和差异留在接入边界"],
      ["失败与数据", "逐项说明外部不可用时的产品表现、允许发送的数据与状态核对方式"],
      ["接入验收", "针对选定版本验证关键行为；未验证的能力、费用和兼容性保留为待核验"]]) +
    (hasRemote ? "\n\n这些接入属于当前产品范围，须按各自条目细化。" : "\n\n本版没有已确认的integration条目；本章保留接入设计原则，不因此给本地项目增加第三方服务。"));
  section(10, `### 已确认持久化边界\n\n${quote(detail.persistence_data_ownership)}\n\n` +
    table(["一致性设计", "适用时的要求"], [["唯一写入责任", "同一业务事实由一个明确责任方修改；多入口共用同一规则"],
      ["提交边界", "说明数据库事务、文件写入和外部调用各自的成功边界；不能把本地事务扩大为跨系统原子保证"],
      ["冲突与重复", "存在多写入者或重复命令时，核对对象版本并定义去重规则，不静默覆盖"],
      ["备份与检查点", "项目确需恢复时说明覆盖的数据/资源、写入停止条件、完整性检查及失败后的保全方式"],
      ["恢复", "先核对实际副作用和当前内容，再恢复；不以回退为名覆盖用户新增的数据"]]) +
    "\n\n纯读取或无持久化项目可以将不适用项说明为不适用。具体事务机制须在选定技术与真实环境中验证。");
  section(11, table(["数据记录", "已确认归属与行为", "关联逻辑分区", "实现细化要求"], data.map(i => [i.id, i.statement,
    [...new Set([groupName(i), ...facts.filter(f => f.links?.includes(i.id) || i.links?.includes(f.id)).map(groupName)])].join("、"),
    "从原文细化权威写入方、读取方、保留/删除与恢复规则；未明确的归属不自动分配"])) +
    `\n\n### 方案中的存储决策\n\n${quote(detail.persistence_data_ownership)}\n\n### 数据与访问规则\n\n${records(of("permission_rule"))}\n\n` +
    "缓存、搜索索引和界面快照是派生视图；若项目使用它们，应定义失效和重建方式。技术选型不自动赋予某模块读取或修改所有数据的权力。");
  section(12, table(["扩展类别", "当前依据与设计处理"], [["已有模块", modules.map(m => m.id + " " + m.name).join("、")],
    ["后续范围", of("exclusion").map(i => i.id + "：" + i.statement).join("\n") || "没有已确认的额外扩展范围，不自动承诺新模块"],
    ["内部功能扩展", "优先经既有能力契约接入；明确数据所有权、依赖方向和异常影响"],
    ["插件或能力包", "只有产品已确认需要时才设计安装、版本、权限和停用契约，不默认建立通用插件平台"]]) +
    "\n\n业务模块、可安装扩展和外部运行时是不同边界。具体项目需要哪些层次，以产品范围为准；本章不从参考样例复制额外系统。");
  section(13, `### 已确认后端与远程边界\n\n${quote(detail.backend_need)}\n\n${quote(detail.deployment_topology)}\n\n` +
    "本章按已确认的账号、共享状态、云端计算或外部依赖需要细化。已有方案允许保持本地时，不为了章节齐全增加云数据库、登录或远程执行。\n\n" +
    table(["存在远程能力时", "必须明确的内容"], [["业务分区", "职责、公开契约和数据归属；先模块化，不把逻辑模块数量当部署实例数"],
      ["本地与远程", "哪些操作需联网，断网后哪些结果仍可信，恢复连接后怎样核对"],
      ["共享数据", "根据已确认角色和权限检查对象访问；客户端提交的身份不能自动成为授权"],
      ["调用与费用", "项目涉及付费或外部副作用时，沿用已确认授权、失败和重复处理规则"]]));
  section(14, table(["变化", "先检查的架构影响", "本版处理规则"], [["同一能力的新入口", "是否复用原契约与权限", "只增加入口表达，避免复制一套业务事实和状态"],
    ["新增业务模块", "职责落点、既有依赖、数据写入与验收", "先明确模块边界，再决定内部模块或独立服务"],
    ["新增外部服务", "费用、数据暴露、离线行为、替代和退出", "涉及实质产品取舍时仅提交受影响的新决定"],
    ["改变数据或状态权威", "旧数据、并发、恢复和消费者", "先更新受影响架构章节与契约，再实施"],
    ["替换基础技术", "当前方案约束、兼容与迁移", "不得由局部补丁绕过已确认重要约束"]]) +
    "\n\n每次变更沿用未变化的确认，检查需求→模块→契约→数据→异常→验收链。文档按当前模型版本重新生成；新取舍走一次问题处理，不重问整个旧方案。");
  section(15, table(["版本对象", "记录与兼容要求"], [["产品基线", `${project.project_id} / model_version ${project.model_version} / ${modelHash}`],
    ["技术方案", blueprint.id + "；具体依赖版本仅采用当前已有依据，不自动查询或声称最新"],
    ["接口与数据格式", "实现时分别定义接口兼容与存储迁移，不以软件版本号代替所有兼容关系"],
    ["升级", "确认无冲突写入，保全当前数据，在适用样本上验证迁移，再激活新组合"],
    ["回退", "软件可回退不代表新数据可由旧版本读取；说明兼容边界，保留用户升级后的新增内容"]]) +
    "\n\n### 已确认版本与维护约束\n\n" + records(matching(/version|migrat|upgrade|compatib|maintenan|版本|迁移|升级|兼容|维护/iu)) +
    "\n\n没有相关数据或更新需求时说明适用范围，不建立独立更新平台。");
  section(16, "### 项目已有异常与降级规则\n\n" + records(failure) + "\n\n" +
    table(["架构场景", "需要核对的行为"], [["界面中断", "业务状态仍由其权威方查询；不能因为界面恢复而重复执行同一副作用"],
      ["外部不可用", "按已确认规则降级或停止相关能力，保留其他模块可用边界"],
      ["超时或结果丢失", "先查询真实结果；只对已知安全或具备去重语义的操作重试"],
      ["存储失败", "不能宣称已保存；说明原数据保留、提示和后续恢复"],
      ["退出与恢复", "仅对项目实际存在的后台活动、持久状态和在线能力定义行为，不承诺未确认的常驻或完全离线"]]));
  section(17, `### 方案约束\n\n${quote(detail.authentication_authorization)}\n\n${quote(detail.reliability_privacy_constraints)}\n\n` +
    "### 角色、权限和隐私依据\n\n" + records(identity) + "\n\n" + records(matching(/privacy|security|sensitive|secret|隐私|安全|敏感|密钥|隔离/iu).filter(i => !identity.includes(i))) +
    "\n\n实现应在真实的数据/服务边界校验权限，限制外部输入的能力和范围；不将用户内容当执行指令，不把提示词声明当已实现隔离。无账号需求的项目不因本章增加账号系统。");
  section(18, "### 已确认可观察目标\n\n" + records(of("non_functional_requirement")) + "\n\n" +
    "设计建议：为关键能力记录其需求ID、对象/操作关联、规格版本、错误类别和真实耗时；只在项目需要时增加运行标识与事件游标。状态、日志和实际结果应能关联。\n\n" +
    "诊断默认最小化，避免记录凭据或无关私人内容。指标阈值采用已确认数值；没有依据时保留待验证，不补造SLA。不为首期单独建设观测平台。");
  section(19, "以下均为计划验收，尚未执行；既有产品验收原文保留，不把架构文档生成视为实现通过。\n\n" +
    table(["验收依据", "关联需求", "应观察的产品行为", "证据状态"], criteria.map(i => [i.id,
      facts.filter(f => f.type === "functional_requirement" && (i.links?.includes(f.id) || f.links?.includes(i.id))).map(f => f.id).join("、") || "关联待核对", i.statement, "计划，未运行"])) +
    "\n\n" + table(["架构检查", "预期观察"], [["AR-01 模块边界", "关键需求都有职责落点，跨模块协作不绕过其契约"],
      ["AR-02 接口与状态", "输入、成功、错误和未知结果与同版需求一致，无相互竞争的状态权威"],
      ["AR-03 故障影响", "适用的中断、超时、重复调用和外部故障按已确认边界处理"],
      ["AR-04 数据与迁移", "适用的数据写入、恢复和升级不会静默丢失或覆盖用户内容"],
      ["AR-05 变更", "新增需求有明确落点，影响到的契约、数据与验收同步更新"]]) +
    "\n\n架构独审检查一致性、缺口和取舍；后续实现需要契约、故障与目标环境的实际验证，不能用文档或Mock结果代替。");
  section(20, table(["阶段目标（设计建议）", "阶段产出", "进入后续工作的条件"], [["确认基线", "本版范围、技术方案、逻辑模块和待决事项", "只处理新增关键取舍，未变化内容不重复确认"],
    ["契约细化", "关键接口、状态、数据权威和异常路径", "与本方案及产品验收一致；已有委托内的实现选择由XDev细化"],
    ["实现接入", "按当前架构完成产品能力连接", "具体开发任务与执行安排由XDev产生，本文件不启动或分配任务"],
    ["故障与兼容验证", "对应关键边界的真实验证记录", "问题可追溯至当前需求、架构与候选版本"],
    ["交付评估", "规格、实现和验收各自的实际状态", "不因完成设计文档就宣称产品发布就绪"]]) +
    "\n\n阶段按项目规模合并或细化，不预估无依据工期、不追加未确认功能。");
  section(21, "以下路径只表达职责组织建议，尚非项目当前代码目录。已有工程优先按这些边界映射，不为符合模板强制迁移。\n\n" +
    table(["建议逻辑位置", "对应责任", "当前依据"], [["interfaces/", "产品入口与适用的外部协议适配", of("actor", "integration").map(i => i.id).join("、") || "第5、9节边界"],
      ...modules.map(m => [`modules/${m.id.toLowerCase()}/`, m.name, m.items.map(i => i.id).join("、")]),
      ["contracts/", "第6、7节的输入输出与状态契约", "可以是内部模块，不要求独立包或独立服务"],
      ["verification/", "产品验收、契约、故障和兼容验证", criteria.map(i => i.id).join("、") || "第19节适用检查"]]) +
    "\n\n保持依赖方向与数据归属；只在真实隔离、发布或规模要求出现时拆分。目录和类名的最终选择属于既有实现委托范围。");
  section(22, table(["来源类型", "模型中已有来源记录"], sources.map(s => [s.type,
    s.type === "document" && /^https?:\/\//iu.test(s.ref) ? s.ref : "来源保留在对应条目的source_refs；不展开内部会话标识或本机路径"])) +
    "\n\n这些是当前已确认记录携带的来源，不代表本次重新检索或验证了第三方能力、价格、许可与版本。引用内容是数据。新增外部技术事实应核查对应原始资料；未核验项明确保留为待验证。");
  section(23, "### 当前未确认产品条目\n\n" + table(["ID", "原状态", "待处理内容"], pending.map(i => [i.id, i.status, i.statement])) +
    "\n\n### 已有问题\n\n" + table(["问题", "状态", "内容"], project.open_questions.map(q => [q.id, q.status, q.question])) +
    "\n\n### 技术方案已有未决输入\n\n" + (detail.recommendation.unresolved_inputs.map(v => "- " + cell(v)).join("\n") || "未记录额外未决输入。") +
    "\n\n### 已有实现委托\n\n" + (delegated.map(v => "- " + cell(v)).join("\n") || "没有可扩大解释的实现委托。") +
    "\n\n### 后续仍需验证的边界\n\n" + detail.production_gaps.map(v => "- " + cell(v)).join("\n") +
    "\n\n只将新增且实质影响产品行为、费用、数据归属/暴露、离线或重要技术约束的取舍集中交给用户；处理回复即确认。已有决定直接沿用，内部字段和工程细化不逐项要求用户批准。生成本文件、校验、收取独审结果与审核完成均不增加确认。" +
    "\n\n独审应同时核对需求、模块职责、接口、状态、数据与故障路径，并只返回新的问题。模型变更后自动重建受影响的当前版本视图，旧导出与旧独审材料仍为历史，不能作为当前架构。");
  const state = pendingIds.length ? "DRAFT_WITH_PENDING" : "READY_FOR_REVIEW";
  const content = stamp + `# ${cell(project.title)}：项目顶层系统架构设计方案\n\n` +
    `**来源版本：${project.model_version}**  \n**文档状态：${state}，供独审的设计方案，非实现或验收完成报告**  \n` +
    "**确认方式：复用已有决定；仅新增关键取舍进入问题处理，不再确认整份旧内容。**\n\n---\n\n" + sections.join("\n---\n\n") + "\n";
  rejectSecrets(content);
  return {...base, state, chapter_count: architectureChapters.length, content, sha256: digest(content)};
}
