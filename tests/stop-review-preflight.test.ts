import test from "node:test";
import type {TestContext} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {randomUUID} from "node:crypto";
import {createSingleReviewRouter,readSingle} from "../apps/local-module-review/single.ts";
import {createModuleReviewRouter,readPending} from "../apps/local-module-review/adapter.ts";
import {processStopPreflight} from "../apps/local-module-review/stop-check.ts";
import {itemFingerprint} from "../packages/core/validation.ts";
import {reviewProjectService} from "./fixtures/spec-review-project.ts";

/** Synthetic private fixtures only. No real transcript, product store or Owner grant. */
function fixture(t:TestContext){
  const root=mkdtempSync(join(tmpdir(),"xmi-stop-preflight-")),session=randomUUID(),seed=reviewProjectService(),project=seed.project;
  seed.store.close();writeFileSync(join(root,session+".host.json"),JSON.stringify({session_id:session,event:"UserPromptSubmit"}));
  const router=createSingleReviewRouter(root,join(root,"UNUSED-TEST-ONLY.sqlite"));
  const prior=project.items.find(i=>i.id==="AC-REVIEW")!;
  const prepared=router.prepare(project,[{operation:"xmi_item_confirm",schema_version:"0.1.0",project_id:project.project_id,
    expected_version:project.model_version,item_id:prior.id,item_version:prior.version,fingerprint:itemFingerprint(prior),
    intent:"CONFIRM",idempotency_key:randomUUID()}],session,true,{issues:[{id:"TEST-ONLY",problem:"Synthetic correction",
      affected_ids:[prior.id],replacement_text:"透明人物贴底，保留23缩略图。"}]});
  const event=(text:string,active=false)=>({hook_event_name:"Stop",session_id:session,last_assistant_message:text,stop_hook_active:active});
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  return {root,session,router,project,prepared,event};
}
test("Stop accepts an exact final and never grants, writes or commits",t=>{
 const f=fixture(t),path=join(f.root,f.session+".single.json"),before=readFileSync(path,"utf8");
 assert.deepEqual(processStopPreflight(f.event("说明\n"+f.prepared.review_text),f.root,f.root),{});
 assert.equal(readFileSync(path,"utf8"),before);assert.equal(readSingle(f.root,f.session)!.status,"PENDING");
});
test("Stop catches duplicate characters, punctuation drift, missing and truncated lists before confirmation",t=>{
 const f=fixture(t),path=join(f.root,f.session+".single.json"),before=readFileSync(path,"utf8");
 for(const text of [f.prepared.review_text.replace("23缩略图","23缩略略图"),f.prepared.review_text.replace("23缩略图","(23缩略图)"),
   f.prepared.review_text.slice(0,-20),"请确认"]){
  const result=processStopPreflight(f.event(text),f.root,f.root);
  assert.equal(result.decision,"block");assert.match(String(result.reason),/预检未通过/u);
  assert.equal(readFileSync(path,"utf8"),before);
 }
});
test("Stop bounds automatic correction without changing pending authority",t=>{
 const f=fixture(t),before=JSON.stringify(readSingle(f.root,f.session));
 const result=processStopPreflight(f.event(f.prepared.review_text.replace("23缩略图","23缩略略图"),true),f.root,f.root);
 assert.equal(result.continue,false);assert.equal(result.decision,undefined);
 assert.match(String(result.systemMessage),/请勿要求用户确认错误文本/u);
 assert.equal(JSON.stringify(readSingle(f.root,f.session)),before);
});
test("Stop is inactive without a pending review",t=>{
 const f=fixture(t);
 assert.deepEqual(processStopPreflight({...f.event("ordinary final"),session_id:randomUUID()},f.root,f.root),{});
});
test("Stop can verify a scoped transcript when the host omits last_assistant_message",t=>{
 const f=fixture(t),log=join(f.root,"TEST-ONLY.jsonl");
 writeFileSync(log,JSON.stringify({type:"session_meta",payload:{id:f.session}})+"\n"+
  JSON.stringify({type:"response_item",payload:{type:"message",role:"assistant",phase:"final_answer",content:[{type:"output_text",text:f.prepared.review_text}]}})+"\n");
 assert.deepEqual(processStopPreflight({hook_event_name:"Stop",session_id:f.session,transcript_path:log},f.root,f.root),{});
});
test("Stop also checks module lists without granting a module",t=>{
 const f=fixture(t),moduleSession=randomUUID(),prior=f.project.items.find(i=>i.id==="AC-REVIEW")!;
 const project=structuredClone(f.project),item=project.items.find(i=>i.id===prior.id)!;item.status="PROPOSED";item.tags=["module:TEST-ONLY"];
 writeFileSync(join(f.root,moduleSession+".host.json"),JSON.stringify({session_id:moduleSession,event:"UserPromptSubmit"}));
 const router=createModuleReviewRouter(f.root,join(f.root,"UNUSED-MODULE.sqlite"));
 const prepared=router.prepare(project,"TEST-ONLY",moduleSession);
 const before=JSON.stringify(readPending(f.root,moduleSession));
 assert.deepEqual(processStopPreflight({hook_event_name:"Stop",session_id:moduleSession,last_assistant_message:prepared.review_text},f.root,f.root),{});
 assert.equal(processStopPreflight({hook_event_name:"Stop",session_id:moduleSession,last_assistant_message:"partial"},f.root,f.root).decision,"block");
 assert.equal(JSON.stringify(readPending(f.root,moduleSession)),before);
});
