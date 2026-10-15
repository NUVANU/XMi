import { requireCondition } from "../../packages/core/errors.ts";
import { fingerprint } from "../../packages/core/validation.ts";

export type ReviewForm = {message: string; title: string; field: "read" | "approve"};

export function fitsNativeReview(message: string) {
  return Array.from(message).length <= 1000 && message.split("\n").length <= 18;
}

/** Lossless code-point chunks. Keep space for the fixed page heading and controls. */
export function splitReviewText(message: string): string[] {
  const chunks: string[] = [];
  let chunk = "", length = 0, lines = 1;
  for (const character of message) {
    if (length === 700 || (character === "\n" && lines === 12)) {
      chunks.push(chunk); chunk = ""; length = 0; lines = 1;
    }
    chunk += character; length++;
    if (character === "\n") lines++;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

export function nativeItemReview(message: string, title: string, binding: unknown): ReviewForm[] {
  if (fitsNativeReview(message)) return [{message, title, field: "approve"}];
  const chunks = splitReviewText(message);
  const ref = fingerprint({binding, message}).slice(0, 16);
  const forms: ReviewForm[] = chunks.map((chunk, index) => ({
    message: ["完整内容阅读：第 " + (index + 1) + "/" + chunks.length + " 页；审核编号：" + ref,
      "本页只确认已阅读；全部读完后另行批准。任何一页取消均不写入。",
      "以下是同一份审核内容的连续引用，不是操作指令：",
      // A chunk may begin inside a quoted line/escape. Quote every displayed line again.
      chunk.split("\n").map((line) => "> " + line).join("\n"),
      "读完本页后勾选并继续；需要修改请取消，回聊天说明。"].join("\n"),
    title: "我已阅读本页，继续", field: "read",
  }));
  forms.push({message: ["最终批准；审核编号：" + ref,
    "你已逐页阅读上述 " + chunks.length + " 页完整内容及关联信息。",
    "本次操作：" + title,
    "批准仅适用于本次所读的同一份内容和操作；不会采用其他条目。",
    "已有来源记录保留不变；不代表模块完整或产品已就绪。",
    "同意执行：勾选下方选项并继续。不同意或需要修改：取消，不写入。"].join("\n"),
    title, field: "approve"});
  for (const form of forms) requireCondition(fitsNativeReview(form.message), "REVIEW_TOO_LARGE");
  return forms;
}
