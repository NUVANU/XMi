import {existsSync, readFileSync, statSync} from "node:fs";
import {join} from "node:path";
import {z} from "zod";
import {sessionPattern, writeRecord} from "./adapter.ts";

const scopeSchema = z.strictObject({session_id: z.string().regex(sessionPattern),
  active: z.boolean(), source: z.enum(["USER_ACTIVATION", "EXISTING_REVIEW", "USER_EXIT"])});

export const designScopeReminder = "XMi 设计会话范围：当前目标是完成经用户确认、校验的 XSpec。每轮继续当前模块的设计澄清、关联影响和待确认清单。引擎/前后端选型、美术风格与资产规格、原型验收标准可以写入规格；不要主动转去编写产品代码、开发可玩原型、生成美术资产或布置开发任务。FAST_VALIDATION / PROTOTYPE_READY 表示规格的交付目标，不是立即开发原型的指令。XSpec 导出后总结交付并停止，不自动进入开发。用户提出实际开发或资产制作需求时，建议另开对话并提供简短交接背景；不要自行创建或发消息到其他对话，也不要把未完成的 XSpec 当作已完成。如用户明确要在本对话切换任务，可回复“退出 XMi 设计模式”；此范围提醒只约束 XMi 设计流程，不约束修改 XMi 本身的工程工作。";

export const isDesignScopeExit = (prompt: string) => /^(?:退出\s*XMi\s*设计模式|停用\s*XMi)[。.!！]?$/i.test(prompt.trim());

// Guidance only, never an approval or a host-tool permission boundary. Only a
// genuine native user event (or a prior review in that session) activates it.
// Keep a boolean per session; never retain the user prompt or design contents.
export function designScopeContext(event: {session_id: string; prompt: string}, directory: string, existingReview: boolean) {
  const session = z.string().regex(sessionPattern).parse(event.session_id);
  const path = join(directory, session + ".scope.json");
  let scope: z.infer<typeof scopeSchema> | null = null;
  if (existsSync(path)) {
    if (statSync(path).size > 1024) throw new Error("INVALID_DESIGN_SCOPE");
    scope = scopeSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    if (scope.session_id !== session) throw new Error("INVALID_DESIGN_SCOPE");
  }
  const prompt = event.prompt.trim();
  // Deliberately anchored: quoted material, code, imported documents and casual
  // mentions of XMi must not switch an engineering or unrelated conversation.
  const exit = isDesignScopeExit(prompt);
  const activate = /^(?:启用|启动|使用|继续使用)\s*XMi(?=$|[，,。.!！：:\n])/i.test(prompt);
  if (exit) scope = {session_id: session, active: false, source: "USER_EXIT"};
  else if (activate) scope = {session_id: session, active: true, source: "USER_ACTIVATION"};
  else if (!scope && existingReview) scope = {session_id: session, active: true, source: "EXISTING_REVIEW"};
  if (exit || activate || (scope?.source === "EXISTING_REVIEW" && !existsSync(path))) {
    writeRecord(directory, session + ".scope", scope);
  }
  if (exit) return "XMi 设计模式已退出，后续按用户当前任务处理；这不确认任何设计条目，不改变项目数据。";
  return scope?.active ? designScopeReminder : "";
}
