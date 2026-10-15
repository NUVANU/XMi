import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { readPending, writeRecord, sessionPattern, moduleGrantBinding, withReviewLock, nativeInterruption } from "./adapter.ts";
import { checkReviewDisplay } from "./display-check.ts";
import { readSingle } from "./single.ts";
import { fingerprint } from "../../packages/core/validation.ts";

const eventSchema = z.object({hook_event_name: z.literal("UserPromptSubmit"),
  session_id: z.string().regex(sessionPattern), turn_id: z.string().regex(sessionPattern),
  prompt: z.string().max(1024 * 1024), transcript_path: z.string().nullable().optional()});
export const moduleReviewDirectory = () => join(homedir(), ".codex", "xmi-module-reviews");

// Only the plugin's native UserPromptSubmit command invokes this against real data.
// Tests use a separate temporary directory/database, never a live session receipt.
export function processUserPrompt(input: unknown, directory: string, sessionDirectory = join(homedir(), ".codex", "sessions")) {
  const event = eventSchema.parse(input);
  try { return withReviewLock(directory, event.session_id, () => processLockedPrompt(event, directory, sessionDirectory)); }
  catch (error) {
    if (error instanceof Error && error.message === "CHAT_REVIEW_BUSY") {
      // Revocation only: a competing genuine native prompt must not leave an
      // uncommitted module grant usable. No prompt or approval is stored here.
      writeRecord(directory, event.session_id + ".interrupted", {nonce: randomUUID()});
    }
    throw error;
  }
}
function processLockedPrompt(event: z.infer<typeof eventSchema>, directory: string, sessionDirectory: string) {
  writeRecord(directory, event.session_id + ".host", {session_id: event.session_id, event: event.hook_event_name});
  const routing = `XMi native session_id=${event.session_id}. For xmi_module_review_prepare/status/commit, pass this session_id as routing only; it is not approval. Do not ask the user for this internal identifier.`;
  const pending = readPending(directory, event.session_id);
  const singleRouting = routing + " For xmi_item_review_prepare/status/commit use the same session_id as routing only. Display the complete single-item list in chat; do not use a popup to confirm it.";
  const single = readSingle(directory, event.session_id);
  if (single?.status === "PENDING") {
    if (pending && ["PENDING", "GRANTED"].includes(pending.status)) {
      writeRecord(directory, event.session_id, {...pending, status: "INVALIDATED"});
      writeRecord(directory, event.session_id + ".single", {...single, command: null, status: "INVALIDATED"});
      return singleRouting + "\nXMi 同时存在两份确认清单，均已失效；没有批准任何内容。重新展示唯一当前清单。";
    }
    const reply = event.prompt.trim();
    const finish = (status: "INVALIDATED" | "FAILED") => writeRecord(directory, event.session_id + ".single",
      {...single, command: null, status, turn_id: event.turn_id});
    if (single.session_id !== event.session_id || !["确认好了", "确认好了。", "确认这条 " + single.review_id].includes(reply)) {
      finish("INVALIDATED");
      return singleRouting + "\nXMi 上一份单条清单已失效；本次回复没有批准任何内容。按修改重新展示完整清单。";
    }
    if (fingerprint(single.command) !== single.command_hash) {
      finish("INVALIDATED");
      return singleRouting + "\nXMi 待执行内容与清单绑定不一致，没有写入。请重新核对当前完整内容。";
    }
    const display = checkReviewDisplay(event.transcript_path, sessionDirectory, single, event.prompt);
    writeRecord(directory, event.session_id + ".host", {session_id: event.session_id, event: event.hook_event_name,
      display_check: {turn_id: event.turn_id, review_id: single.review_id, ...display}});
    if (!display.ok) {
      finish("INVALIDATED");
      return singleRouting + "\nXMi 单条清单未能核验，没有写入。诊断码：" + display.reason + "; 保留原稿并检查实际日志交付，不要回退弹窗或反复要求确认。";
    }
    const source = {type: "owner_action" as const, ref: "codex-user-prompt:" + event.session_id + ":" + event.turn_id + ":" + createHash("sha256").update(reply).digest("hex")};
    writeRecord(directory, event.session_id + ".single", {...single, status: "GRANTED", turn_id: event.turn_id,
      native_epoch: nativeInterruption(directory, event.session_id), grant_source_ref: source});
    return singleRouting + `\nXMi 已核验真实用户确认，尚未正式写入。调用 xmi_item_review_commit：project_id=${single.project_id}, expected_version=${single.project_version}, review_id=${single.review_id}, session_id=${event.session_id}。成功后读取 canonical state 核实；保存提案仍为 PROPOSED。不要再次要求用户批准。`;
  }
  if (single?.status === "GRANTED") {
    writeRecord(directory, event.session_id + ".single", {...single, command: null, status: "INVALIDATED"});
    return singleRouting + "\nXMi 上次确认尚未写入，本次新回复已使旧清单失效。核对当前状态和最新要求后重新展示清单。";
  }
  if (pending?.status === "GRANTED") {
    writeRecord(directory, event.session_id, {...pending, status: "INVALIDATED"});
    return routing + "\nXMi 上次模块确认尚未取得提交回执，本次新回复已使旧清单失效。先核对项目状态；不要沿用旧批准或回退弹窗。";
  }
  if (!pending || pending.status !== "PENDING") return singleRouting;
  if (pending.session_id !== event.session_id) return "XMi 确认未执行：会话不匹配。";
  const reply = event.prompt.trim();
  const approved = ["确认好了", "确认好了。", "确认模块 " + pending.review.review_id].includes(reply);
  if (!approved) {
    writeRecord(directory, event.session_id, {...pending, status: "INVALIDATED", turn_id: event.turn_id});
    return routing + "\nXMi 上一份模块确认清单已失效；本次回复没有批准任何条目。按用户修改重新保存草稿并展示新清单。";
  }
  const started = performance.now();
  const display = checkReviewDisplay(event.transcript_path, sessionDirectory, pending, event.prompt);
  writeRecord(directory, event.session_id + ".host", {session_id: event.session_id, event: event.hook_event_name,
    display_check: {turn_id: event.turn_id, review_id: pending.review.review_id, ...display}, display_ms: Math.round(performance.now() - started)});
  if (!display.ok) {
    writeRecord(directory, event.session_id, {...pending, status: "INVALIDATED", turn_id: event.turn_id});
    return routing + `\nXMi 未能核验上一条聊天完整展示了当前确认清单；没有批准任何条目。诊断码：${display.reason}${display.read_error ? "/" + display.read_error : ""}。保留草稿，先检查原生钩子的实际日志交付；不要反复让用户重试确认或改用逐条表单。`;
  }
  const grant = {...pending, status: "GRANTED" as const, turn_id: event.turn_id, native_epoch: nativeInterruption(directory, event.session_id),
    grant_source_ref: {type: "owner_action" as const, ref: "codex-user-prompt:" + event.session_id + ":" + event.turn_id + ":" +
      createHash("sha256").update(reply).digest("hex")}};
  writeRecord(directory, event.session_id, {...grant, grant_binding_hash: moduleGrantBinding(grant)});
  return routing + `\nXMi 已保存真实模块批准凭据，尚未正式写入。调用 xmi_module_review_commit：project_id=${pending.review.project_id}, expected_version=${pending.review.project_version}, review_id=${pending.review.review_id}, session_id=${event.session_id}。成功后读取 canonical state；提交失败可用同一绑定重试，不要再次要求用户批准。`;
}

export async function runHook() {
  try {
    let text = "";
    for await (const chunk of process.stdin) {
      text += String(chunk);
      if (Buffer.byteLength(text, "utf8") > 2 * 1024 * 1024) throw new Error("INPUT_TOO_LARGE");
    }
    const context = processUserPrompt(JSON.parse(text), moduleReviewDirectory());
    if (context) process.stdout.write(JSON.stringify({hookSpecificOutput: {
      hookEventName: "UserPromptSubmit", additionalContext: context}}) + "\n");
  } catch {
    process.stdout.write(JSON.stringify({hookSpecificOutput: {hookEventName: "UserPromptSubmit",
      additionalContext: "XMi 用户回复确认桥未就绪；没有成功确认回执。保留草稿，检查连接，不要改用逐条确认弹窗。"}}) + "\n");
  }
}
