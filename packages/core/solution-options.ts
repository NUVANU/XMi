import type {Project, SolutionOption} from "../shared-types/domain.ts";
import {confirmedSolutionInputs} from "./solution-feasibility.ts";

const constraintTypes = ["solution_constraint", "constraint", "non_functional_requirement", "exclusion"];
const negatedChoice = /do not|must not|not use|不使用|不用|禁止|不要/i;
const localWords = /offline|本地运行|离线|local.first|local.only|on[- ]device|端侧/i;
// Split independent assertions so a negated requirement cannot reverse a positive one in another clause.
const clauses = (statement: string) => statement.split(/[;；。\n,，]|\bbut\b|但是|但/u);
const negatedLocal = /(?:no|not|without|unnecessary|不需要|无需|不用|不要|禁止|非).{0,28}(?:offline|local|离线|本地|端侧)|(?:offline|local|离线|本地|端侧).{0,28}(?:not required|not needed|unnecessary|不需要|无需|不用)/i;

export function solutionBlockingInputs(project: Project): string[] {
  if (project.profile !== "digital-game-v0") return [];
  const visualKnown = confirmedSolutionInputs(project).filter((item) => item.type !== "exclusion")
    .some((item) => clauses(item.statement).some((clause) =>
      /\b2(?:\.5)?D\b|\b3D\b|二维|三维|text[- ]only|纯文字|文字游戏|无图形/i.test(clause) &&
      !/undecided|unknown|not decided|not specified|尚未|未确定|未明确|待定|待确认|\bnot\b|\bno\b|不使用|不用|禁止|不要|比较|备选|alternative|compare|\bor\b|或者|还是/i.test(clause)));
  return visualKnown ? [] : ["游戏的 2D/3D 与画面目标尚未明确，先补问再确认引擎。"];
}

const recheck = "版本、平台兼容、授权、费用和性能须在正式选型及开发前查证；当前比较是可撤回的方案建议，未验证 XDev 对该技术的支持。";
function option(id: string, label: string, summary: string, tradeoff: string): SolutionOption {
  return {id: `SOLUTION-OPTION-${id}`, label, summary,
    evaluation: {fit_to_confirmed_requirements: "MEDIUM", implementation_complexity: "MEDIUM",
      operational_complexity: "MEDIUM", expected_cost: "MEDIUM", privacy_security: "MEDIUM",
      vendor_lock_in: "MEDIUM", offline_local_requirements: "MEDIUM", xdev_support_maturity: "MEDIUM",
      owner_maintenance_ability: "MEDIUM", migration_path: "保留已确认的产品行为与数据边界；更换材料性技术约束前由 Owner 批准。"},
    trade_offs: [tradeoff], risks: [recheck]};
}

export function recommendSolutions(project: Project) {
  const confirmed = confirmedSolutionInputs(project);
  const constraints = confirmed.filter((item) => constraintTypes.includes(item.type));
  const text = constraints.map((item) => item.statement).join("\n");
  const platform = constraints.filter((item) => item.tags?.includes("platform") || item.tags?.includes("device") ||
    /目标平台|运行在|target platform|support.*browser/i.test(item.statement)).map((item) => item.statement).join("\n");
  const game = project.profile === "digital-game-v0";
  const native = /原生|native/i.test(platform);
  const mobile = /ios|android|移动端|手机/i.test(platform) && !/web|browser|网页|浏览器/i.test(platform);
  const desktop = /desktop|桌面|\bPC\b|windows|macos|linux/i.test(platform) && !/web|browser|网页|浏览器/i.test(platform);
  // A mention in a flow/document is not a chosen technology. Only explicit confirmed constraints count.
  const chosen = constraints.filter((item) => item.type !== "exclusion").filter((item) => (item.tags?.some((tag) => ["technology-choice", "stack", "engine"].includes(tag)) ||
    (/use|existing|使用|采用|选用|现有/i.test(item.statement) && /react|vue|angular|node\.js|python|django|fastapi|java|spring|\.net|godot|unity|unreal|flutter|tauri|electron|postgres|mysql|sqlite/i.test(item.statement))) &&
    !/do not|must not|not use|不使用|不用|禁止|不要|比较|备选|alternative|compare/i.test(item.statement));
  const localClauses = constraints.filter((item) => item.type !== "exclusion").flatMap((item) => clauses(item.statement))
    .filter((clause) => localWords.test(clause) && !negatedLocal.test(clause));
  const local = localClauses.length > 0;
  const offlineOnly = localClauses.some((clause) => /local.only|offline.only|仅本地|只在本地|纯离线/i.test(clause));
  const unresolved = [...solutionBlockingInputs(project), recheck];
  let options: SolutionOption[];
  let recommendedIndex = 0;
  if (game) {
    options = [
      option("GODOT", "Godot 游戏方案", "客户端：Godot，脚本语言待确认；数据：按确认的存档规则使用本地文件或服务端持久化；后端：仅按联机、账户或共享数据需求配置；部署：按目标平台验证导出。", "可作为 2D/常规 3D 游戏的候选；特殊渲染、目标设备及第三方集成需原型验证。"),
      option("UNITY", "Unity 游戏方案", "客户端：Unity + C#；数据：按确认的状态权威与存档要求设计；后端：按实际联网需求决定；部署：逐个平台核查构建、授权与发布条件。", "适合考虑 C# 工作流与已有资产的项目；资产依赖、授权和升级成本需要比较。"),
      option("UNREAL", "Unreal Engine 游戏方案", "客户端：Unreal Engine + Blueprint/C++；数据与后端：由确认的单机/联机边界决定；部署：验证目标硬件、构建和发布要求。", "可比较复杂 3D 与已有 Unreal 工作流；硬件、构建及维护负担需实测。"),
    ];
    if (/复杂3D|高保真|high.fidelity/i.test(text)) recommendedIndex = 2;
    if (/web|browser|网页|浏览器/i.test(platform)) unresolved.push("网页游戏需验证候选引擎的导出限制；必要时比较专用 Web 游戏框架。" );
  } else if (mobile) {
    options = [
      option("FLUTTER", "Flutter 移动应用方案", "前端：Flutter + Dart；后端：有共享数据或服务端规则时考虑 Node.js/TypeScript；数据库：服务端 PostgreSQL 或按需求选本地存储；部署：移动应用商店与必要的服务端。", "共用客户端代码；原生能力、插件、无障碍与商店限制需验证。"),
      option("NATIVE-MOBILE", "原生移动应用方案", "前端：按确认的平台选择 Swift/iOS 或 Kotlin/Android；后端与数据库：仅按共享数据需求配置；部署：各平台构建和发布。", "便于对接平台特定能力；多平台实现与维护成本需要单独评估。"),
    ];
    if (native) recommendedIndex = 1;
  } else if (desktop) {
    options = [
      option("TAURI", "Tauri 桌面工具方案", "前端：TypeScript 网页界面；桌面宿主：Tauri/Rust；数据：需要持久化时考虑 SQLite；后端：仅按已确认的云同步需求引入；部署：桌面安装包。", "网页界面结合本机能力；系统 WebView、权限与 Rust 维护能力需验证。"),
      option("ELECTRON", "Electron 桌面工具方案", "前端：TypeScript 网页界面；桌面宿主：Electron/Node.js；数据：需要持久化时考虑 SQLite；后端：仅按共享或同步需求引入；部署：桌面安装包。", "JavaScript 工作流较统一；安装体积、内存及本机权限边界需验证。"),
    ];
  } else {
    options = [
      option("WEB-TYPESCRIPT", "React + Node.js 系统方案", "前端：React + TypeScript；后端：Node.js + TypeScript API；数据：需要服务端关系数据时考虑 PostgreSQL；部署：网页客户端与应用服务，供应商待确认。", "前后端语言一致；需承担服务端运行、鉴权、备份与数据库维护。"),
      option("WEB-PYTHON", "React + Python 系统方案", "前端：React + TypeScript；后端：Python + FastAPI；数据：需要服务端关系数据时考虑 PostgreSQL；部署：网页客户端与 Python 应用服务。", "适合比较 Python 数据处理或已有 Python 技术条件；需维护两种语言环境。"),
      option("LOCAL-FIRST", "浏览器本地工具方案", "前端：TypeScript 浏览器界面；后端：没有已确认需求则不引入；数据：需要本地保存时考虑 IndexedDB；部署：静态网页，无默认云存储。", "减少服务端运维；多用户共享、跨设备同步与本地数据恢复需要额外方案。"),
    ];
    if (local) recommendedIndex = 2;
    else if (/python|数据处理|data.processing/i.test(text)) recommendedIndex = 1;
    if (offlineOnly) options = [options[2]!, option("LOCAL-DESKTOP", "离线桌面工具备选", "前端与桌面宿主：比较 Tauri 或 Electron；数据：按确认的持久化需求使用本地文件或 SQLite；后端：无云服务；部署：离线桌面安装包。", "本机能力更强；需额外维护安装包和系统兼容性。")];
    if (offlineOnly) recommendedIndex = 0;
  }
  let recommended = options[recommendedIndex]!;
  if (chosen.length) {
    const names = chosen.flatMap((entry) => entry.statement.match(/react|vue|angular|node\.js|python|django|fastapi|java|spring|\.net|godot|unity|unreal|flutter|tauri|electron|postgres|mysql|sqlite/gi) ?? []);
    const matching = names.length ? options.find((entry) => names.every((name) => (entry.label + entry.summary).toLowerCase().includes(name.toLowerCase()))) : undefined;
    const ownerOption = option("OWNER-CONSTRAINTS", "用户指定技术方案", `按已确认技术约束 ${chosen.map((item) => item.id).join(", ")} 实现；具体选型原文保留在蓝图约束中。其余前端、后端、数据与部署组成仍须比较并确认。`, "保留现有技术投资；不自动假定指定技术满足平台、规模、隐私或维护要求。" );
    if (matching) recommended = matching;
    else { options = [ownerOption, ...options]; recommended = ownerOption; }
    unresolved.push("用户指定技术与其余方案组成的兼容性需要核对；冲突必须回访，不能自动替换。" );
  }
  const exclusions = constraints.flatMap((item) => clauses(item.statement)
    .filter((clause) => item.type === "exclusion" || negatedChoice.test(clause)));
  const forbidden = (entry: SolutionOption) => exclusions.some((clause) =>
    ["Godot", "Unity", "Unreal", "React", "Vue", "Angular", "Node.js", "Python", "Django", "FastAPI", "Java", "Spring", ".NET", "Flutter", "Tauri", "Electron", "PostgreSQL", "SQLite", "IndexedDB"]
      .some((name) => clause.toLowerCase().includes(name.toLowerCase()) &&
        (entry.label + entry.summary).toLowerCase().includes(name.toLowerCase())));
  options = options.filter((entry) => !forbidden(entry));
  if (options.length < 2) {
    options.push(option("CONSTRAINED-CUSTOM", "满足现有约束的定制方案", "前端、后端、数据与部署均以已确认约束为边界；没有足够兼容候选时先补问或做技术验证。", "需要补充选型证据，不能凭默认方案确认。"));
    if (options.length < 2) options.push(option("CONSTRAINED-DELEGATION", "在约束内委托选型", "Owner 可明确委托 XDev 在现有约束内验证并提出具体技术；材料性约束变更仍须批准。", "具体技术尚未确定，先记录委托范围和验证要求。"));
    unresolved.push("候选受明确排除条件限制，需补充兼容技术方案。");
  }
  if (!options.some((entry) => entry.id === recommended.id)) recommended = options[0]!;
  return {options, recommended, unresolved, local, game, mobile, desktop,
    why: chosen.length ? "优先保留用户明确确认的技术约束；适配性仍须核对。" :
      `根据已确认的平台与部署约束，建议先比较此方案；这是候选推荐，不代表已经验证性能、成本或开发支持。参考需求：${constraints.map((item) => item.id).slice(0, 12).join(", ")}。`};
}
