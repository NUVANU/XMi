import {createHash} from "node:crypto";
import {z} from "zod";
import {readPending,sessionPattern} from "./adapter.ts";
import {readSingle} from "./single.ts";
import {checkReviewDisplay} from "./display-check.ts";
import {codexReviewPaths} from "./host-paths.ts";
import {readPrototypeReview} from "./prototype.ts";

const stopEventSchema=z.object({hook_event_name:z.literal("Stop"),session_id:z.string().regex(sessionPattern),
  stop_hook_active:z.boolean().optional(),last_assistant_message:z.string().max(1024*1024).nullable().optional(),
  transcript_path:z.string().nullable().optional()});

/** Read-only preflight. A match never grants, confirms or commits a review. */
export function processStopPreflight(input:unknown,directory:string,sessionDirectory:string):Record<string,unknown>{
  const event=stopEventSchema.parse(input),single=readSingle(directory,event.session_id),module=readPending(directory,event.session_id);
  const prototype=readPrototypeReview(directory,event.session_id);
  const pending=single?.status==="PENDING"?single:module?.status==="PENDING"?module:prototype?.status==="PENDING"?prototype:undefined;
  if(!pending)return {};
  const heading="review_heading" in pending?pending.review_heading:"## "+pending.review.module+"：模块确认清单\n";
  let reason:string;
  if(typeof event.last_assistant_message==="string"){
    const text=event.last_assistant_message.replaceAll("\r\n","\n"),start=text.indexOf(heading);
    const shown = pending === prototype ? text.trimEnd() : text.slice(start,start+pending.review_text_length);
    reason=start<0?"REVIEW_NOT_IN_FINAL":createHash("sha256").update(shown).digest("hex")===pending.review_text_hash?
      "MATCH":"REVIEW_DIGEST_MISMATCH";
  }else reason=checkReviewDisplay(event.transcript_path,sessionDirectory,pending === prototype ? {...pending, entire_final: true} : pending,"").reason;
  if(reason==="MATCH")return {};
  const diagnostic="XMi清单结束前预检未通过："+reason+"。这不产生批准、提交或新的用户确认。";
  if(event.stop_hook_active)return {continue:false,stopReason:diagnostic,
    systemMessage:diagnostic+"自动修正仍未交付原样清单；请勿要求用户确认错误文本，保留草案并报告。"};
  if (pending === prototype) return {decision:"block", reason: diagnostic +
    "原样输出本轮 xmi_prototype_preview 返回的 native_review.review_text，在用户选择之前自动修正预览显示。"};
  return {decision:"block",reason:diagnostic+
    "请在本轮先修正清单交付：回读同一会话的原生清单，完整原样输出review_text，不改字词、标点或重复字。"+
    "若清单仍PENDING，保持同一绑定；仅当续行已使其失效时才用原请求重备。不得补造GRANTED、修改日志、放宽摘要校验或回退弹窗。"+
    "未原样交付前不要再次要求用户确认；仅输出已核对的完整原生清单。"};
}

export async function runStopHook(){
  try{
    let text="";
    for await(const chunk of process.stdin){text+=String(chunk);if(Buffer.byteLength(text,"utf8")>2*1024*1024)throw new Error("INPUT_TOO_LARGE");}
    const paths=codexReviewPaths();
    process.stdout.write(JSON.stringify(processStopPreflight(JSON.parse(text),paths.reviews,paths.sessions))+"\n");
  }catch{
    process.stdout.write(JSON.stringify({systemMessage:"XMi清单结束前预检不可用；未发生确认或提交，原用户回复校验仍适用。"})+"\n");
  }
}
