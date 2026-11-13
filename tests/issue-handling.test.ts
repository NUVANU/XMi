import test from "node:test";
import type {TestContext} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {randomUUID} from "node:crypto";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import {ElicitRequestSchema} from "@modelcontextprotocol/sdk/types.js";
import {ProjectService,replay} from "../packages/core/project-service.ts";
import {SqliteProjectStore} from "../packages/storage/sqlite.ts";
import {createSingleReviewRouter,readSingle} from "../apps/local-module-review/single.ts";
import {processUserPrompt} from "../apps/local-module-review/hook.ts";
import {readIssueDispositions} from "../apps/local-module-review/issue-dispositions.ts";
import {createXmiServer} from "../apps/mcp-server/server.ts";
import {inputs,outputs} from "../apps/mcp-server/contracts.ts";
import {itemFingerprint,fingerprint} from "../packages/core/validation.ts";
import {parseIssueReply,dispositionApplies} from "../packages/core/issue-handling.ts";
import type {IssueHandling} from "../packages/core/issue-handling.ts";
import {reviewProjectService} from "./fixtures/spec-review-project.ts";
import {InterviewService} from "../packages/core/interview-service.ts";
import {documentDelivery,unavailableDocumentReview} from "../packages/core/document-delivery.ts";
import {DatabaseSync} from "node:sqlite";
import {commandSchema} from "../packages/shared-types/domain.ts";

/** Synthetic native event/log replay only; never a live Owner grant. */
function fixture(t:TestContext){
  const root=mkdtempSync(join(tmpdir(),"xmi-issue-handling-")),db=join(root,"product.sqlite"),log=join(root,"session.jsonl"),session=randomUUID();
  const store=new SqliteProjectStore(db),service=new ProjectService(store),seed=reviewProjectService();
  const events=seed.service.history(seed.project.project_id);store.transaction(tx=>{events.forEach(e=>tx.append(e));tx.save(seed.project);});
  const id=seed.project.project_id;seed.store.close();
  const router=createSingleReviewRouter(root,db,undefined,service);
  const prompt=(text:string)=>processUserPrompt({hook_event_name:"UserPromptSubmit",session_id:session,turn_id:randomUUID(),prompt:text,transcript_path:log},root,root);
  prompt("SYNTHETIC TEST ONLY");
  const run=(command:unknown,actor:"agent"|"owner"="agent")=>{const p=service.get(id);return service.execute({project_id:id,expected_version:p.model_version,idempotency_key:randomUUID(),command},actor);};
  const add=(itemId:string)=>run({kind:"CANDIDATE_EXTRACTED",candidate:{id:itemId,type:"acceptance_criterion",statement:"SYNTHETIC pending outcome "+itemId,
    status:"PROPOSED",links:["REQ-REVIEW"],source_refs:[{type:"conversation_turn",ref:"fixture:TEST_ONLY-issue-handling"}]}});
  const args=(itemId:string)=>{const p=service.get(id),item=p.items.find(i=>i.id===itemId)!;return {schema_version:"0.1.0" as const,
    project_id:id,expected_version:p.model_version,idempotency_key:randomUUID(),operation:"xmi_item_confirm" as const,item_id:itemId,
    item_version:item.version,fingerprint:itemFingerprint(item),intent:"CONFIRM" as const};};
  const context=(ids:string[],replacement?:string):IssueHandling=>({source_run_id:randomUUID(),issues:ids.map((itemId,index)=>({id:"ISSUE-"+itemId,
    problem:"Synthetic issue for "+itemId,impact:"Synthetic impact",recommendation:"Use the displayed outcome",affected_ids:[itemId],
    ...(index===0&&replacement?{replacement_text:replacement}:{})}))});
  const display=(text:string)=>writeFileSync(log,JSON.stringify({type:"session_meta",payload:{id:session}})+"\n"+
    JSON.stringify({type:"response_item",payload:{type:"message",role:"assistant",phase:"final_answer",content:[{type:"output_text",text}]}})+"\n");
  const prepare=(ids:string[],replacement?:string)=>router.prepare(service.get(id),ids.map(args),session,undefined,context(ids,replacement));
  const commit=()=>{const r=readSingle(root,session)!;return router.commit(id,r.project_version,r.review_id,session);};
  t.after(()=>{store.close();rmSync(root,{recursive:true,force:true});});
  return {root,db,log,session,store,service,id,router,run,add,args,context,display,prompt,prepare,commit};
}

test("one handling reply applies, revises, ignores and defers without a second confirmation",t=>{
  const f=fixture(t);for(const id of ["AC-ONE","AC-TWO","AC-THREE","AC-FOUR"])f.add(id);
  const before=f.service.get(f.id),history=f.service.history(f.id),prepared=f.prepare(["AC-ONE","AC-TWO","AC-THREE","AC-FOUR"]);
  assert.ok(prepared.action==="BATCH"&&prepared.issue_handling);assert.match(prepared.review_text,/处理回复本身就是确认/);
  assert.throws(f.commit,/NATIVE_OWNER_REPLY_REQUIRED/);f.display(prepared.review_text);
  assert.match(f.prompt("采纳1；2忽略；3暂缓；第4项改为：SYNTHETIC exact final outcome"),/不要再要求确认清单/);
  const applied=f.commit(),after=f.service.get(f.id);
  assert.deepEqual(applied.handling_summary,{applied:1,revised:1,ignored:1,deferred:1,unresolved:0});
  assert.equal(after.model_version,before.model_version+2);
  assert.equal(after.items.find(i=>i.id==="AC-ONE")?.status,"CONFIRMED");
  assert.equal(after.items.find(i=>i.id==="AC-TWO")?.status,"PROPOSED");
  assert.equal(after.items.find(i=>i.id==="AC-THREE")?.status,"PROPOSED");
  assert.equal(after.items.find(i=>i.id==="AC-FOUR")?.statement,"SYNTHETIC exact final outcome");
  assert.deepEqual(after.items.filter(i=>!i.id.startsWith("AC-")),before.items.filter(i=>!i.id.startsWith("AC-")));
  const written=f.service.history(f.id).slice(history.length);assert.equal(written.length,2);
  assert.ok(written.every(e=>e.actor==="owner"&&"owner_action" in e.command&&e.command.owner_action.source_ref.ref.startsWith("codex-user-prompt:")));
  assert.equal(readIssueDispositions(f.root,f.id).length,4);assert.deepEqual(replay(f.service.history(f.id)),after);
  assert.equal(f.commit().model_version,after.model_version);assert.equal(f.service.history(f.id).length,history.length+2);
});

test("issue handling uses confirmation as its default whole-list reply and preserves legacy synonyms",t=>{
  for(const reply of ["确认","确认。","确认好了","全部采纳"]){const f=fixture(t);f.add("AC-UNIFIED");const prepared=f.prepare(["AC-UNIFIED"]);
    assert.equal(prepared.reply,"确认");assert.match(prepared.review_text,/全部同意以上处理请回复“确认”/);
    assert.doesNotMatch(prepared.review_text,/确认好了|回复“全部采纳”/);f.display(prepared.review_text);f.prompt(reply);f.commit();
    assert.equal(f.service.get(f.id).items.find(i=>i.id==="AC-UNIFIED")?.status,"CONFIRMED");}
  assert.equal(parseIssueReply("确认，但第1项修改",1),null);
});

test("partial clarification preserves the other handling choices and asks only for the unresolved row",t=>{
  const f=fixture(t);["AC-A","AC-B","AC-C"].forEach(f.add);
  f.display(f.prepare(["AC-A","AC-B","AC-C"]).review_text);f.prompt("第2项修改，其他同意");
  const result=f.commit();assert.equal(result.handling_summary?.applied,2);assert.equal(result.handling_summary?.unresolved,1);
  const next=f.prepare(["AC-B"]);assert.ok(!next.review_text.includes("条目：AC-A"));assert.ok(!next.review_text.includes("条目：AC-C"));
  f.display(next.review_text);f.prompt("第1项改为：SYNTHETIC now fully specified");f.commit();
  const p=f.service.get(f.id);assert.equal(p.items.find(i=>i.id==="AC-B")?.status,"CONFIRMED");
  assert.equal(p.items.find(i=>i.id==="AC-B")?.statement,"SYNTHETIC now fully specified");
});

test("a known existing confirmed ordinary statement can be corrected directly from the handling reply",t=>{
  const f=fixture(t),before=f.service.get(f.id),prior=before.items.find(i=>i.id==="AC-REVIEW")!;
  const next=f.prepare([prior.id],"SYNTHETIC recommended replacement");f.display(next.review_text);
  f.prompt("第1项改为：SYNTHETIC Owner final replacement");f.commit();
  const item=f.service.get(f.id).items.find(i=>i.id===prior.id)!;
  assert.equal(item.statement,"SYNTHETIC Owner final replacement");assert.equal(item.version,prior.version+1);
  assert.equal(item.status,"CONFIRMED");assert.equal(f.service.history(f.id).at(-1)!.command.kind,"ITEM_TEXT_REVISED");
  assert.deepEqual(item.links,prior.links);assert.deepEqual(item.source_refs.slice(0,-1),prior.source_refs);
});

test("all ignored/deferred choices are recorded once with no product event and survive a new router",t=>{
  const f=fixture(t);f.add("AC-IGNORE");f.add("AC-DEFER");const before=fingerprint(f.service.get(f.id)),events=f.service.history(f.id).length;
  f.display(f.prepare(["AC-IGNORE","AC-DEFER"]).review_text);f.prompt("1忽略；2暂缓");
  const result=f.commit();assert.equal(result.handling_summary?.ignored,1);assert.equal(result.handling_summary?.deferred,1);
  assert.equal(fingerprint(f.service.get(f.id)),before);assert.equal(f.service.history(f.id).length,events);
  const router=createSingleReviewRouter(f.root,f.db,f.session,f.service);assert.equal(router.status(f.service.get(f.id)).status,"APPLIED");
  const ledger=readIssueDispositions(f.root,f.id);assert.equal(ledger.length,2);
  assert.ok(dispositionApplies(f.service.get(f.id),ledger[0]!,ledger[0]!.problem,["AC-IGNORE"]));
  const changed=structuredClone(f.service.get(f.id));changed.items.find(i=>i.id==="AC-IGNORE")!.statement+=" changed";
  assert.equal(dispositionApplies(changed,ledger[0]!,ledger[0]!.problem,["AC-IGNORE"]),false);
});

test("an issue on confirmed ordinary text accepts the direct edit without a prewritten replacement",t=>{
  const f=fixture(t),before=f.service.get(f.id);
  const prepared=f.prepare(["AC-REVIEW"]);f.display(prepared.review_text);
  f.prompt("第1项改为：SYNTHETIC direct fix from Owner");f.commit();
  assert.equal(f.service.get(f.id).model_version,before.model_version+1);
  assert.equal(f.service.get(f.id).items.find(i=>i.id==="AC-REVIEW")?.statement,"SYNTHETIC direct fix from Owner");
});

test("keeping already confirmed text never creates a no-op event or makes its review stale",t=>{
  const f=fixture(t),before=fingerprint(f.service.get(f.id)),version=f.service.get(f.id).model_version;
  f.display(f.prepare(["AC-REVIEW"]).review_text);f.prompt("全部采纳");const receipt=f.commit();
  assert.equal(receipt.model_version,version);assert.equal(fingerprint(f.service.get(f.id)),before);
  assert.equal(readIssueDispositions(f.root,f.id).length,1);
});

test("a displayed structured alternative is selected by the handling reply itself",t=>{
  const f=fixture(t),d=new InterviewService().analyzeAnswer(f.service.get(f.id),"用户进入游戏。玩家控制主角。",{type:"conversation_turn",ref:"fixture:TEST_ONLY"}).review_decisions
    .find(i=>i.id==="DEC-RELATION-USER-PLAYER")!;f.run({kind:"CANDIDATE_EXTRACTED",candidate:d});
  const first=d.decision_detail!.options[0]!.id,second=d.decision_detail!.options[1]!.id;
  const prepared=f.router.prepare(f.service.get(f.id),[{...f.args(d.id),selected_option_id:first}],f.session,undefined,f.context([d.id]));
  f.display(prepared.review_text);f.prompt("第1项选"+second);f.commit();
  assert.equal(f.service.get(f.id).items.find(i=>i.id===d.id)!.decision_detail!.owner_selection,second);
});

test("invalid or ambiguous choices never approve extra rows",t=>{
  const f=fixture(t);f.add("AC-PARSE");f.display(f.prepare(["AC-PARSE"]).review_text);
  assert.match(f.prompt("采纳1；先别执行"),/没有自动采用/);assert.throws(f.commit,/NATIVE_OWNER_REPLY_REQUIRED/);
  for(const reply of ["采纳0","采纳2","采纳1；1忽略","按你想的处理","第1项改为："])
    assert.equal(parseIssueReply(reply,1),null,reply);
});

test("structured free text is left unresolved while other clear choices apply",t=>{
  const f=fixture(t);f.add("AC-VALID");const d=new InterviewService().analyzeAnswer(f.service.get(f.id),"用户进入游戏。玩家控制主角。",{type:"conversation_turn",ref:"fixture:TEST_ONLY"}).review_decisions
    .find(i=>i.id==="DEC-RELATION-USER-PLAYER")!;f.run({kind:"CANDIDATE_EXTRACTED",candidate:d});
  const prepared=f.router.prepare(f.service.get(f.id),[f.args("AC-VALID"),{...f.args(d.id),selected_option_id:d.decision_detail!.options[0]!.id}],f.session,undefined,f.context(["AC-VALID",d.id]));
  f.display(prepared.review_text);f.prompt("1采纳；第2项改为：SYNTHETIC unstructured decision text");const result=f.commit();
  assert.equal(result.handling_summary?.unresolved,1);assert.equal(f.service.get(f.id).items.find(i=>i.id===d.id)!.status,"PROPOSED");
  assert.equal(f.service.get(f.id).items.find(i=>i.id==="AC-VALID")!.status,"CONFIRMED");
});

test("stale project, altered displayed list and a later prompt cannot use a handling grant",t=>{
  for(const kind of ["stale","display","interrupt"]){const f=fixture(t);f.add("AC-GUARD");const prepared=f.prepare(["AC-GUARD"]);
    f.display(prepared.review_text);
    if(kind==="display")f.display(prepared.review_text.replace("Synthetic issue","Changed issue"));
    f.prompt("全部采纳");if(kind==="stale")f.add("AC-LATER");if(kind==="interrupt")f.prompt("稍等，暂停处理");
    assert.throws(f.commit,kind==="display"||kind==="interrupt"?/NATIVE_OWNER_REPLY_REQUIRED/:/VERSION_CONFLICT/);
    assert.equal(f.service.get(f.id).items.find(i=>i.id==="AC-GUARD")!.status,"PROPOSED");}
});

test("ordinary legacy confirmation remains separate from issue handling",t=>{
  const f=fixture(t);f.add("AC-LEGACY");const prepared=f.router.prepare(f.service.get(f.id),[f.args("AC-LEGACY")],f.session);
  f.display(prepared.review_text);f.prompt("第1项改为：This is not an issue-handling list");assert.throws(f.commit,/NATIVE_OWNER_REPLY_REQUIRED/);
});

test("new text revision validates ordinary item boundaries and replays older events",t=>{
  const f=fixture(t),p=f.service.get(f.id),original=f.service.history(f.id);assert.deepEqual(replay(original),p);
  const item=p.items.find(i=>i.id==="AC-REVIEW")!;
  const command={kind:"ITEM_TEXT_REVISED",item_id:item.id,fingerprint:itemFingerprint(item),statement:"SYNTHETIC exact revised acceptance",
    owner_action:{intent:"REVISE_TEXT",source_ref:{type:"owner_action",ref:"fixture:TEST_ONLY"}}};
  assert.throws(()=>f.service.execute({project_id:f.id,expected_version:p.model_version,idempotency_key:"agent-edit",command}),/OWNER_ACTION_REQUIRED/);
  f.run(command,"owner");assert.deepEqual(replay(f.service.history(f.id)),f.service.get(f.id));
  assert.throws(()=>f.run(command,"owner"),/FINGERPRINT_MISMATCH/);
  const blueprint=f.service.get(f.id).items.find(i=>i.blueprint_detail)!;
  assert.throws(()=>f.run({...command,item_id:blueprint.id,fingerprint:itemFingerprint(blueprint)},"owner"),/STRUCTURED_ITEM_REQUIRES_DECISION/);
  const revised=f.service.get(f.id).items.find(i=>i.id===item.id)!;
  f.run({kind:"ITEM_REJECTED",item_id:item.id,fingerprint:itemFingerprint(revised),owner_action:{intent:"REJECT",source_ref:{type:"owner_action",ref:"fixture:TEST_ONLY"}}},"owner");
  const rejected=f.service.get(f.id).items.find(i=>i.id===item.id)!;
  assert.throws(()=>f.run({...command,fingerprint:itemFingerprint(rejected)},"owner"),/ITEM_NOT_REVISABLE/);
});

test("MCP issue handling uses one reply and returns same-call validation with zero forms",async t=>{
  const f=fixture(t);f.add("AC-MCP-HANDLE");const p=f.service.get(f.id);
  const server=createXmiServer(f.service,{singleReview:f.router}),client=new Client({name:"TEST_ONLY-issue-client",version:"1"},{capabilities:{elicitation:{form:{}}}});
  let forms=0;client.setRequestHandler(ElicitRequestSchema,()=>{forms++;throw new Error("Unexpected form");});
  const[a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);t.after(async()=>{await client.close();await server.close();});
  const request={schema_version:"0.1.0",project_id:f.id,expected_version:p.model_version,session_id:f.session,requests:[f.args("AC-MCP-HANDLE")],issue_handling:f.context(["AC-MCP-HANDLE"])};
  assert.equal(inputs.xmi_item_review_prepare.safeParse(request).success,true);
  const prepared=(await client.callTool({name:"xmi_item_review_prepare",arguments:request})).structuredContent as {ok:boolean;data:{review_id:string;review_text:string}};
  assert.ok(prepared.ok);f.display(prepared.data.review_text);f.prompt("第1项改为：SYNTHETIC empty input produces feedback");
  const result=(await client.callTool({name:"xmi_item_review_commit",arguments:{schema_version:"0.1.0",project_id:f.id,expected_version:p.model_version,
    review_id:prepared.data.review_id,session_id:f.session}})).structuredContent as {ok:boolean;data:{handling_summary:{revised:number};post_commit_validation:unknown}};
  assert.equal(outputs.xmi_item_review_commit.safeParse(result).success,true);assert.ok(result.ok);
  assert.equal(result.data.handling_summary.revised,1);assert.ok(result.data.post_commit_validation);assert.equal(forms,0);
  assert.equal(readSingle(f.root,f.session)?.status,"APPLIED");
});

test("workflow advances through audit and independent review without extra confirmation stages",()=>{
  const base=unavailableDocumentReview({project_id:"XMI-FLOW",model_version:1});
  assert.match(documentDelivery({...base,state:"NOT_STARTED"},true).next_action,/直接进入.*独立复审/);
  assert.match(documentDelivery({...base,state:"STALE"},true).next_action,/自动继续一次/);
  const clean={...base,state:"COMPLETED" as const,source_verified:true,run_id:randomUUID(),reviewed_model_version:1};
  assert.equal(documentDelivery(clean,true).stage,"READY_TO_EXPORT");
  assert.equal(documentDelivery({...clean,note_count:2},true).stage,"READY_TO_EXPORT");
  assert.match(documentDelivery({...clean,finding_count:1},true).next_action,/处理回复即确认/);
  assert.match(documentDelivery(clean,false).next_action,/校验过程和报告无需用户确认/);
});

test("a multi-action handling failure rolls back all product writes and leaves no disposition record",t=>{
  const f=fixture(t);f.add("AC-ATOMIC-A");f.add("AC-ATOMIC-B");
  const before=fingerprint(f.service.get(f.id)),version=f.service.get(f.id).model_version;
  f.display(f.prepare(["AC-ATOMIC-A","AC-ATOMIC-B"]).review_text);f.prompt("全部采纳");
  const control=new DatabaseSync(f.db);control.exec(`CREATE TRIGGER fail_issue_test BEFORE INSERT ON events WHEN NEW.version=${version+2} BEGIN SELECT RAISE(ABORT,'SYNTHETIC_FAILURE'); END;`);
  assert.throws(f.commit,/STORAGE_FAILURE/);assert.equal(fingerprint(f.service.get(f.id)),before);
  assert.equal(readIssueDispositions(f.root,f.id).length,0);assert.equal(readSingle(f.root,f.session)?.status,"GRANTED");
  control.exec("DROP TRIGGER fail_issue_test");control.close();f.commit();
  assert.equal(f.service.get(f.id).model_version,version+2);assert.equal(readIssueDispositions(f.root,f.id).length,2);
});

test("exact text handling preserves final punctuation and never treats ordinary prose as approval",()=>{
  assert.equal(parseIssueReply("第1项改为：End with a period.",1)?.[0]?.value,"End with a period.");
  assert.equal(parseIssueReply("第1项改为：原文保留句号。",1)?.[0]?.value,"原文保留句号。");
  assert.equal(parseIssueReply("审核报告看过了",1),null);
});

test("bundled skills route audit issues to direct handling while preserving the initial confirmation path",()=>{
  for(const name of ["xmi-discovery","xmi-audit-export"]){
    const skill=readFileSync(new URL(`../plugins/xmi/skills/${name}/SKILL.md`,import.meta.url),"utf8");
    assert.match(skill,/requests plus issue_handling/);assert.match(skill,/handling reply itself confirms/);
    assert.match(skill,/ask only about unresolved rows/);assert.match(skill,/automatically review the current version once/);
    assert.doesNotMatch(skill,/Numbered edits or qualified replies require a complete revised list/);
  }
  assert.equal(commandSchema.parse(JSON.parse(readFileSync(new URL("../samples/issue-handling-event.json",import.meta.url),"utf8"))).kind,"ITEM_TEXT_REVISED");
});

test("unified confirmation output schema and skill hints retain old response compatibility",()=>{
  const sample=JSON.parse(readFileSync(new URL("../samples/confirmation-reply.json",import.meta.url),"utf8"));
  assert.equal(outputs.xmi_item_review_prepare.safeParse(sample).success,true);
  assert.equal(outputs.xmi_item_review_prepare.safeParse({...sample,data:{...sample.data,reply:"确认好了"}}).success,true);
  assert.equal(outputs.xmi_item_review_prepare.safeParse({...sample,data:{...sample.data,reply:"好的"}}).success,false);
  for(const name of ["xmi-discovery","xmi-audit-export"]){const skill=readFileSync(new URL(`../plugins/xmi/skills/${name}/SKILL.md`,import.meta.url),"utf8");
    assert.match(skill,/recommend only “确认”/);assert.doesNotMatch(skill,/确认好了/);}
});
