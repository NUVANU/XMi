import {existsSync, readFileSync, statSync} from "node:fs";
import {join} from "node:path";
import {z} from "zod";
import {sessionPattern, writeRecord} from "./adapter.ts";

const scopeSchema = z.strictObject({session_id: z.string().regex(sessionPattern),
  active: z.boolean(), source: z.enum(["USER_ACTIVATION", "EXISTING_REVIEW", "USER_EXIT"])});

export const designScopeReminder = "XMi 设计会话范围：当前目标是完成经用户确认、校验的 XSpec。增量项目复用已核对的基座和已确认决定，用游戏或使用流程图呈现本轮变化和验收。如果当前工具支持增量读取，续跑用 xmi_project_resume 的 detail=incremental，按同一版本查必要原文，校验用摘要回执。基线、范围或证据不完整时展开原文或完整审核。聊天中展示的流程图默认自上而下，Mermaid 使用 flowchart TB。节点用短句，细节放在图下，较长的流程按阶段拆图，并保留关键分支和回退。复审只把影响本轮验收的新取舍合并交给用户，技术细节、核验场景和后续建议无需用户逐项批准。引擎/前后端选型、美术风格与资产规格、原型验收标准可以写入规格；不要主动转去编写产品代码、开发可玩原型、生成美术资产或布置开发任务。FAST_VALIDATION / PROTOTYPE_READY 表示规格的交付目标，不是立即开发原型的指令。XSpec 导出后总结交付并停止，不自动进入开发。用户提出实际开发或资产制作需求时，建议另开对话并提供简短交接背景；不要自行创建或发消息到其他对话，也不要把未完成的 XSpec 当作已完成。如用户明确要在本对话切换任务，可回复“退出 XMi 设计模式”；此范围提醒只约束 XMi 设计流程，不约束修改 XMi 本身的工程工作。";

export const isDesignScopeExit = (prompt: string) => /^(?:退出\s*XMi\s*设计模式|停用\s*XMi)[。.!！]?$/i.test(prompt.trim());

function readScope(directory: string, session: string) {
  const path = join(directory, session + ".scope.json");
  if (!existsSync(path)) return null;
  if (statSync(path).size > 1024) throw new Error("INVALID_DESIGN_SCOPE");
  const scope = scopeSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  if (scope.session_id !== session) throw new Error("INVALID_DESIGN_SCOPE");
  return scope;
}

export function designScopeActive(directory: string, session: string) {
  return readScope(directory, z.string().regex(sessionPattern).parse(session))?.active === true;
}

// Guidance only, never an approval or a host-tool permission boundary. Only a
// genuine native user event (or a prior review in that session) activates it.
// Keep a boolean per session; never retain the user prompt or design contents.
export function designScopeContext(event: {session_id: string; prompt: string}, directory: string, existingReview: boolean) {
  const session = z.string().regex(sessionPattern).parse(event.session_id);
  const prior = readScope(directory, session);
  let scope = prior;
  const prompt = event.prompt.trim();
  // Deliberately anchored: quoted material, code, imported documents and casual
  // mentions of XMi must not switch an engineering or unrelated conversation.
  const exit = isDesignScopeExit(prompt);
  const activate = /^(?:启用|启动|使用|继续使用)\s*XMi(?=$|[，,。.!！：:\n])/i.test(prompt);
  if (exit) scope = {session_id: session, active: false, source: "USER_EXIT"};
  else if (activate) scope = {session_id: session, active: true, source: "USER_ACTIVATION"};
  else if (!scope && existingReview) scope = {session_id: session, active: true, source: "EXISTING_REVIEW"};
  if (scope && scope !== prior) {
    writeRecord(directory, session + ".scope", scope);
  }
  if (exit) return "XMi 设计模式已退出，后续按用户当前任务处理；这不确认任何设计条目，不改变项目数据。";
  return scope?.active ? designScopeReminder : "";
}
