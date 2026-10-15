import test from "node:test";
import type {TestContext} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync, rmSync, writeFileSync, readFileSync} from "node:fs";
import fs from "node:fs";
import {syncBuiltinESMExports} from "node:module";
import {tmpdir} from "node:os";
import {join, toNamespacedPath} from "node:path";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import {createXmiServer} from "../apps/mcp-server/server.ts";
import {inputs, outputs} from "../apps/mcp-server/contracts.ts";
import {createSingleReviewRouter, readSingle} from "../apps/local-module-review/single.ts";
import {createModuleReviewHost, readPending, writeRecord} from "../apps/local-module-review/adapter.ts";
import {processUserPrompt} from "../apps/local-module-review/hook.ts";
import {ProjectService} from "../packages/core/project-service.ts";
import {SolutionService} from "../packages/core/solution-service.ts";
import {InterviewService} from "../packages/core/interview-service.ts";
import {SqliteProjectStore} from "../packages/storage/sqlite.ts";
import {itemFingerprint, modeFingerprint} from "../packages/core/validation.ts";
import type {Candidate, Project} from "../packages/shared-types/domain.ts";
import {blueprintReview, quotedReviewText} from "../apps/mcp-server/blueprint-review.ts";
import {evaluateRisk} from "../packages/core/completeness-service.ts";

const session = "00000000-0000-0000-0000-000000000001", turn = "00000000-0000-0000-0000-000000000002";
const source = {type: "conversation_turn" as const, ref: "fixture:answer"};
const owner = {type: "owner_action" as const, ref: "fixture:owner"};

test("Windows receipt replacement retries transient denial and preserves prior data on lasting failure", {skip:process.platform!=="win32"}, t => {
  const directory=mkdtempSync(join(tmpdir(),"xmi-record-retry-"));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  writeRecord(directory,"receipt",{status:"PENDING"});
  const original=fs.renameSync;
  let calls=0;
  const mock=t.mock.method(fs,"renameSync",(...args:Parameters<typeof fs.renameSync>)=>{
    if(++calls<3) throw Object.assign(new Error("fixture denial"),{code:"EPERM"});
    return original(...args);
  });
  syncBuiltinESMExports();
  try {
    writeRecord(directory,"receipt",{status:"GRANTED"});
    assert.equal(calls,3);
    mock.mock.mockImplementation(()=>{throw Object.assign(new Error("fixture persistent denial"),{code:"EACCES"});});
    assert.throws(()=>writeRecord(directory,"receipt",{status:"APPLIED"}),/persistent denial/);
    assert.deepEqual(JSON.parse(readFileSync(join(directory,"receipt.json"),"utf8")),{status:"GRANTED"});
    assert.deepEqual(fs.readdirSync(directory),["receipt.json"]);
  } finally {mock.mock.restore();syncBuiltinESMExports();}
});

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "xmi-single-review-")), db = join(directory, "state.sqlite"), log = join(directory, "session.jsonl");
  const store = new SqliteProjectStore(db), service = new ProjectService(store);
  t.after(() => {store.close(); rmSync(directory, {recursive:true, force:true});});
  const p = service.create({title:"Fixture", idea:"Start a product", source_ref:source, idempotency_key:"create"});
  const router = createSingleReviewRouter(directory, db, undefined, service);
  const prompt = (text: string, id = session) => processUserPrompt({hook_event_name:"UserPromptSubmit", session_id:id, turn_id:turn,
    prompt:text, transcript_path:process.platform === "win32" ? toNamespacedPath(log) : log}, directory, directory);
  const display = (text: string) => writeFileSync(log, JSON.stringify({type:"session_meta", payload:{id:session}}) + "\n" +
    JSON.stringify({type:"response_item", payload:{type:"message", role:"assistant", phase:"final_answer", content:[{type:"output_text",text}]}}) + "\n" +
    JSON.stringify({type:"response_item", payload:{type:"message", role:"user", content:[{type:"input_text",text:"确认好了\n"}]}}) + "\n");
  prompt("继续");
  const args = (project = service.get(p.project_id), itemId = project.items[0]!.id) => {const item = project.items.find(item=>item.id===itemId)!;
    return {operation:"xmi_item_confirm" as const, schema_version:"0.1.0" as const, project_id:project.project_id,
      expected_version:project.model_version, idempotency_key:"fixture-review", item_id:item.id, item_version:item.version,
      fingerprint:itemFingerprint(item), intent:"CONFIRM" as const};};
  const commit = () => {const record = readSingle(directory,session)!; return router.commit(record.project_id,record.project_version,record.review_id,session);};
  return {directory,db,log,store,service,p,router,prompt,display,args,commit};
}

function seedBlueprint(f: ReturnType<typeof fixture>): {project: Project; candidate: Candidate} {
  let p = f.service.get(f.p.project_id);
  const reason = "fixture controlled MVP";
  p = f.service.execute({project_id:p.project_id, expected_version:p.model_version, idempotency_key:"mode",
    command:{kind:"DELIVERY_MODE_SELECTED", mode:"FAST_DEVELOPMENT", reason, fingerprint:modeFingerprint(p,"FAST_DEVELOPMENT",reason),
      owner_action:{intent:"CONFIRM",source_ref:owner}}}, "owner");
  const rows = [
    ["actor","Independent shop owners are primary users","primary-user"],
    ["flow","A shop owner opens the web app, records an order and sees the saved result","core"],
    ["data_entity","Catalog records are public and contain no restricted records","data-sensitivity"],
    ["solution_constraint","Use a cloud-hosted web application boundary","deployment"],
    ["non_functional_requirement","Pilot scale is 100 active users with sub-second interactions","latency"],
    ["exclusion","No external integrations are used in V0","integrations-none"],
    ["non_functional_requirement","Prefer low operating cost and low maintenance burden","cost"],
    ["non_functional_requirement","Support modern desktop and mobile web browsers","platform"],
  ] as const;
  for (const [index, row] of rows.entries()) {
    const candidate = {id:"REQ-SEED-"+index,type:row[0],statement:row[1],status:"PROPOSED" as const,source_refs:[source],tags:[row[2]]};
    p = f.service.execute({project_id:p.project_id,expected_version:p.model_version,idempotency_key:"add"+index,command:{kind:"CANDIDATE_EXTRACTED",candidate}});
    const item = p.items.find(item=>item.id===candidate.id)!;
    p = f.service.execute({project_id:p.project_id,expected_version:p.model_version,idempotency_key:"confirm"+index,command:{kind:"ITEM_CONFIRMED",
      item_id:item.id,fingerprint:itemFingerprint(item),owner_action:{intent:"CONFIRM",source_ref:owner}}},"owner");
  }
  const candidate = new SolutionService().review(p, {type:"system_rule",ref:"fixture:solution"}).proposed_patch!.candidate;
  return {project:p,candidate};
}

test("single list prepares without adoption and native text confirms exactly one item with provenance", t => {
  const f = fixture(t), prepared = f.router.prepare(f.p, f.args(), session);
  assert.equal(f.service.get(f.p.project_id).model_version, 1);
  assert.match(prepared.review_text,/完整内容/);
  f.display(prepared.review_text);
  assert.match(f.prompt("确认好了"),/尚未正式写入/); f.commit();
  const p = f.service.get(f.p.project_id);
  assert.equal(p.model_version,2); assert.equal(p.items[0]!.status,"CONFIRMED");
  assert.match(p.items[0]!.source_refs.at(-1)!.ref,/^codex-user-prompt:/);
  assert.equal(f.router.status(p,session).status,"APPLIED");
  assert.equal(readSingle(f.directory,session)!.command,null);
  f.prompt("确认好了"); assert.equal(f.service.get(p.project_id).model_version,2);
});

test("native grant is nonmutating; commit requires that exact grant and is idempotent", t => {
  const f=fixture(t), prepared=f.router.prepare(f.p,f.args(),session);
  assert.throws(()=>f.commit(),/NATIVE_OWNER_REPLY_REQUIRED/);
  f.display(prepared.review_text); f.prompt("确认好了");
  assert.equal(f.router.status(f.p,session).status,"GRANTED");
  assert.equal(f.service.get(f.p.project_id).model_version,1);
  assert.throws(()=>f.router.commit(f.p.project_id,1,"00000000-0000-0000-0000-000000000009",session),/UNAVAILABLE/);
  assert.throws(()=>f.router.commit(f.p.project_id,2,prepared.review_id,session),/VERSION_CONFLICT/);
  assert.equal(f.commit().model_version,2);
  assert.equal(f.commit().model_version,2);
  assert.equal(f.service.history(f.p.project_id).length,2);
});

test("a newer user change expires an uncommitted grant without adopting old content", t => {
  const f=fixture(t), prepared=f.router.prepare(f.p,f.args(),session);
  f.display(prepared.review_text); f.prompt("确认好了");
  assert.match(f.prompt("先不采用，改一下内容"),/旧清单失效/);
  assert.throws(()=>f.commit(),/NATIVE_OWNER_REPLY_REQUIRED/);
  assert.equal(readSingle(f.directory,session)!.command,null);
  assert.equal(f.service.get(f.p.project_id).model_version,1);
});

test("a structured decision shows alternatives and adopts only the explicitly selected option", t => {
  const f=fixture(t);
  const candidate=new InterviewService().analyzeAnswer(f.p,"用户进入游戏。玩家控制主角。",source).review_decisions.find(item=>item.id==="DEC-RELATION-USER-PLAYER")!;
  assert.ok(candidate.decision_detail);
  const p=f.service.execute({project_id:f.p.project_id,expected_version:1,idempotency_key:"decision",command:{kind:"CANDIDATE_EXTRACTED",candidate}});
  assert.throws(()=>f.router.prepare(p,f.args(p,candidate.id),session),/DECISION_SELECTION_REQUIRED/);
  const prepared=f.router.prepare(p,{...f.args(p,candidate.id),selected_option_id:"SAME_ENTITY"},session);
  for(const option of candidate.decision_detail.options) {
    assert.ok(prepared.review_text.includes(quotedReviewText(option.impact.privacy)));
    assert.ok(prepared.review_text.includes(quotedReviewText(option.impact.xdev)));
  }
  assert.match(prepared.review_text,/本次批准的选项/);
  f.display(prepared.review_text); f.prompt("确认好了"); f.commit();
  const item=f.service.get(p.project_id).items.find(item=>item.id===candidate.id)!;
  assert.equal(item.status,"CONFIRMED"); assert.equal(item.decision_detail!.owner_selection,"SAME_ENTITY");
});

test("changes, generic assent, modified display and wrong native session never grant adoption", t => {
  const f = fixture(t);
  for (const reply of ["好的","确认好了，但修改第一条"]) {
    const prepared=f.router.prepare(f.p,f.args(),session); f.display(prepared.review_text);
    assert.match(f.prompt(reply),/没有批准/); assert.equal(readSingle(f.directory,session)!.command,null);
  }
  const prepared=f.router.prepare(f.p,f.args(),session); f.display(prepared.review_text.replace("Start a product","Changed product"));
  assert.match(f.prompt("确认好了"),/没有写入/);
  f.router.prepare(f.p,f.args(),session); f.display(prepared.review_text);
  assert.match(f.prompt("确认好了","00000000-0000-0000-0000-000000000099"),/routing only/);
  assert.equal(f.service.get(f.p.project_id).model_version,1);
});

test("stale canonical state and modified staged commands fail without transferring consent", t => {
  const f = fixture(t), prepared=f.router.prepare(f.p,f.args(),session); f.display(prepared.review_text);
  const record=readSingle(f.directory,session)!;
  assert.equal(record.command!.kind,"ITEM_CONFIRMED");
  writeRecord(f.directory,session+".single",{...record,command:{...record.command,item_id:"OTHER"}});
  assert.match(f.prompt("确认好了"),/绑定不一致/);
  const fresh=f.router.prepare(f.p,f.args(),session); f.display(fresh.review_text);
  f.service.execute({project_id:f.p.project_id,expected_version:1,idempotency_key:"change",command:{kind:"CANDIDATE_EXTRACTED",candidate:{
    id:"REQ-NEW",type:"constraint",statement:"new draft",status:"PROPOSED",source_refs:[source]}}});
  assert.match(f.prompt("确认好了"),/尚未正式写入/);
  assert.throws(()=>f.commit(),/VERSION_CONFLICT/);
  assert.equal(f.service.get(f.p.project_id).items[0]!.status,"PROPOSED");
});

test("one native reply cannot approve both a module and a single-item list", t => {
  const f=fixture(t), host=createModuleReviewHost(f.directory,session,f.db);
  const p=f.service.execute({project_id:f.p.project_id,expected_version:1,idempotency_key:"module",command:{kind:"CANDIDATE_EXTRACTED",candidate:{
    id:"REQ-MODULE",type:"constraint",statement:"module rule",status:"PROPOSED",source_refs:[source],tags:["module:scope"]}}});
  host.prepare(p,"scope"); f.router.prepare(p,f.args(p),session);
  assert.equal(readPending(f.directory,session)!.status,"INVALIDATED");
  host.prepare(p,"scope"); assert.equal(readSingle(f.directory,session)!.status,"INVALIDATED");
  const module=readPending(f.directory,session)!;
  const single=f.router.prepare(p,f.args(p),session); f.display(single.review_text);
  writeRecord(f.directory,session,module);
  assert.match(f.prompt("确认好了"),/两份确认清单/);
  assert.equal(f.service.get(p.project_id).model_version,p.model_version);
});

test("technical proposal saving and adoption are distinct exact native actions, never popup forms", t => {
  const f=fixture(t), seeded=seedBlueprint(f);
  const request={operation:"xmi_patch_apply",schema_version:"0.1.0",project_id:seeded.project.project_id,expected_version:seeded.project.model_version,
    idempotency_key:"save-plan",patch:{kind:"ADD_CANDIDATE",candidate:seeded.candidate}};
  const prepared=f.router.prepare(seeded.project,request,session);
  assert.match(prepared.review_text,/这次不会批准采用/);
  assert.doesNotMatch(prepared.review_text,/"blueprint_detail"|"source_refs"|"owner_action"/);
  assert.ok(prepared.review_text.includes(seeded.candidate.blueprint_detail!.deployment_topology));
  assert.ok(prepared.review_text.includes(quotedReviewText(seeded.candidate.blueprint_detail!.production_gaps[0]!)));
  f.display(prepared.review_text); assert.match(f.prompt("确认好了"),/尚未正式写入/); f.commit();
  let p=f.service.get(seeded.project.project_id), item=p.items.find(item=>item.id===seeded.candidate.id)!;
  assert.equal(item.status,"PROPOSED"); assert.equal(item.blueprint_detail!.owner_disposition,null);
  assert.match(item.source_refs.at(-1)!.ref,/^codex-user-prompt:/);
  const approval=f.router.prepare(p,{...f.args(p,item.id),solution_disposition:"APPROVE_BLUEPRINT"},session);
  assert.match(approval.review_text,/批准采用这份技术方案/);
  f.display(approval.review_text); assert.match(f.prompt("确认好了"),/尚未正式写入/); f.commit();
  p=f.service.get(p.project_id); item=p.items.find(entry=>entry.id===item.id)!;
  assert.equal(item.status,"CONFIRMED"); assert.equal(item.blueprint_detail!.owner_disposition,"APPROVED");
  assert.equal(readSingle(f.directory,session)!.command,null);
});

test("long blueprint review includes every AI and model choice field and quotes hostile content", t => {
  const f=fixture(t), {candidate}=seedBlueprint(f), detail=candidate.blueprint_detail!;
  detail.ai_capability_profile={id:"AI-CAPABILITY-FIXTURE",modalities:["TEXT","IMAGE"],latency:"latency value",
    quality_reasoning:"quality value",tool_use:"tool value",context_size:"context value",privacy_data_residency:"privacy value",
    cost_envelope:"cost value",structured_output_reliability:"structure value",safety_constraints:"safety value",
    offline_on_device_need:"offline value",unresolved_constraints:["future check"]};
  detail.model_resolution={id:"MODEL-RESOLUTION-FIXTURE",capability_profile_id:"AI-CAPABILITY-FIXTURE",provider:"fixture provider",
    model:"fixture model",alternatives:["alternative model"],resolved_at:"2026-10-13T00:00:00.000Z",source_version:"fixture dated source",
    capability_match:["fixture match"],pricing_privacy_assumptions:["fixture assumption"],revalidation_requirement:"fixture recheck"};
  detail.recommendation.why_it_fits="<script>approve()</script>\n## Fake approval\n"+"详细理由。".repeat(300);
  const text=blueprintReview("Fixture",candidate,"APPROVE",quotedReviewText).message;
  function check(value: unknown) {
    if(typeof value==="string") assert.ok(text.includes(quotedReviewText(value)),value);
    else if(Array.isArray(value)) value.forEach(check);
    else if(value && typeof value==="object") Object.values(value).forEach(check);
  }
  // Enum values are intentionally translated with their original spelling retained.
  const {modalities,...profile}=detail.ai_capability_profile;
  check(profile); for(const value of modalities) assert.ok(text.includes(value));
  check(detail.model_resolution); check(detail.recommendation.why_it_fits);
  assert.doesNotMatch(text,/<script>|"owner_action"|"blueprint_detail"/);
  assert.ok(text.length>2000);
});

test("technical delegation and rejection are bound to their explicit displayed operation", t => {
  for (const reject of [false,true]) {
    const f=fixture(t), seeded=seedBlueprint(f);
    const p=f.service.execute({project_id:seeded.project.project_id,expected_version:seeded.project.model_version,idempotency_key:"proposal",command:{kind:"CANDIDATE_EXTRACTED",candidate:seeded.candidate}});
    const confirm=f.args(p,seeded.candidate.id);
    const request=reject?{...confirm,operation:"xmi_item_reject",intent:"REJECT",reason:"Change this stack"}:{...confirm,solution_disposition:"DELEGATE_WITHIN_BLUEPRINT"};
    const prepared=f.router.prepare(p,request,session); assert.match(prepared.review_text,reject?/拒绝这份技术方案/:/本次委托边界/);
    f.display(prepared.review_text); assert.match(f.prompt("确认好了"),/尚未正式写入/); f.commit();
    const item=f.service.get(p.project_id).items.find(item=>item.id===seeded.candidate.id)!;
    assert.equal(item.status,reject?"REJECTED":"CONFIRMED");
    if(!reject)assert.deepEqual(item.blueprint_detail!.delegation!.boundaries,seeded.candidate.blueprint_detail!.decisions_delegated_to_xdev);
  }
});

test("MCP native chat tools advertise strict requests and block old popup paths before elicitation", async t => {
  const f=fixture(t), server=createXmiServer(f.service,{singleReview:f.router});
  const client=new Client({name:"single-chat-fixture",version:"1"},{capabilities:{}});
  const [a,b]=InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
  t.after(async()=>{await client.close();await server.close();});
  const request=f.args();
  const result=await client.callTool({name:"xmi_item_review_prepare",arguments:{schema_version:"0.1.0",session_id:session,request}});
  assert.ok(outputs.xmi_item_review_prepare.safeParse(result.structuredContent).success);
  assert.equal((result.structuredContent as {ok:boolean}).ok,true);
  const old = {...request}; Reflect.deleteProperty(old,"operation");
  const blocked=await client.callTool({name:"xmi_item_confirm",arguments:old});
  assert.equal((blocked.structuredContent as {error:{code:string}}).error.code,"CHAT_REVIEW_REQUIRED");
  assert.equal(inputs.xmi_item_review_prepare.safeParse({schema_version:"0.1.0",session_id:session,request:{...request,approved:true}}).success,false);
  assert.throws(()=>f.router.prepare(f.p,request),/SESSION_REQUIRED/);
  assert.throws(()=>f.router.prepare(f.p,request,"00000000-0000-0000-0000-000000000098"),/UNAVAILABLE/);
  assert.equal(f.service.get(f.p.project_id).model_version,1);
  assert.ok(readFileSync(join(f.directory,session+".single.json"),"utf8").length<1024*1024);
});

function policyArgs(project: Project) {
  return {schema_version:"0.1.0" as const,project_id:project.project_id,expected_version:project.model_version,idempotency_key:"policy-"+project.model_version};
}
function seedRisk(f: ReturnType<typeof fixture>, statement = "Customers pay a recurring subscription with Stripe.") {
  let p=f.service.get(f.p.project_id);
  const domainArgs=(p:Project)=>({project_id:p.project_id,expected_version:p.model_version,idempotency_key:"policy-"+p.model_version});
  const reason="Prototype fixture";
  p=f.service.execute({...domainArgs(p),command:{kind:"DELIVERY_MODE_SELECTED",mode:"FAST_VALIDATION",reason,
    fingerprint:modeFingerprint(p,"FAST_VALIDATION",reason),owner_action:{intent:"CONFIRM",source_ref:owner}}},"owner");
  p=f.service.execute({...domainArgs(p),command:{kind:"CANDIDATE_EXTRACTED",candidate:{id:"REQ-PAYMENT",type:"functional_requirement",
    statement,status:"PROPOSED",source_refs:[source]}}});
  const item=p.items.find(item=>item.id==="REQ-PAYMENT")!;
  return f.service.execute({...domainArgs(p),command:{kind:"ITEM_CONFIRMED",item_id:item.id,fingerprint:itemFingerprint(item),
    owner_action:{intent:"CONFIRM",source_ref:owner}}},"owner");
}

test("native mode selection and upgrade use exact readable chat lists and durable policy receipts", t => {
  const f=fixture(t);
  for (const mode of ["FAST_VALIDATION","PRODUCT_GRADE"] as const) {
    const p=f.service.get(f.p.project_id),reason="Owner selected "+mode;
    const prepared=f.router.prepare(p,{...policyArgs(p),operation:"xmi_delivery_mode_select",mode,reason,
      fingerprint:modeFingerprint(p,mode,reason),intent:"SELECT_MODE",change:p.delivery_policy?"UPGRADE":"SELECT"},session);
    assert.match(prepared.review_text,/本次操作：选择交付模式/);
    assert.ok(prepared.review_text.includes(quotedReviewText(reason)));
    assert.doesNotMatch(prepared.review_text,/"source_refs"|"owner_action"|"command"/);
    assert.throws(()=>f.commit(),/NATIVE_OWNER_REPLY_REQUIRED/);
    f.display(prepared.review_text);f.prompt("确认好了");
    assert.equal(f.service.get(p.project_id).model_version,p.model_version);
    assert.equal(f.commit().model_version,p.model_version+1);
    const after=f.service.get(p.project_id);
    assert.equal(after.delivery_policy!.effective_mode,mode);
    assert.equal(f.router.status(after,session).status,"APPLIED");
    assert.equal(f.commit().model_version,after.model_version);
    assert.equal(f.service.history(p.project_id).length,after.model_version);
  }
});

test("native risk resolve and retract show exact scope, retain provenance and never include historical JSON", t => {
  const f=fixture(t);let p=seedRisk(f);
  const finding=evaluateRisk(p).findings.find(finding=>finding.reason_code==="PAYMENT_OR_FINANCIAL")!;
  const rationale="Payments are deferred from this prototype";
  const prepared=f.router.prepare(p,{...policyArgs(p),operation:"xmi_mode_override_resolve",override_id:finding.override_id,
    resolution:"DEFER_OR_EXCLUDE",rationale,intent:"RESOLVE_OVERRIDE"},session);
  assert.ok(prepared.review_text.includes(p.items.find(item=>item.id==="REQ-PAYMENT")!.statement));
  assert.match(prepared.review_text,/整条设计内容/);
  f.display(prepared.review_text);f.prompt("确认好了");f.commit();p=f.service.get(p.project_id);
  const recorded=p.delivery_policy!.risk_overrides[0]!;
  assert.equal(recorded.rationale,rationale);
  assert.equal(recorded.status,"CONFIRMED");
  assert.ok(recorded.source_refs.some(source=>source.ref.startsWith("codex-user-prompt:")));
  assert.equal(f.router.status(p,session).status,"APPLIED");
  const reason="撤回旧处置；保留历史和设计，再审核新范围。";
  const withdrawn=f.router.prepare(p,{...policyArgs(p),operation:"xmi_mode_override_retract",override_id:recorded.id,reason,intent:"RETRACT_OVERRIDE"},session);
  for (const value of [rationale,reason,"REQ-PAYMENT","风险返回待审"]) assert.ok(withdrawn.review_text.includes(value));
  assert.doesNotMatch(withdrawn.review_text,/"source_refs"|"owner_action"|"fingerprint"|mcp-elicitation:/);
  f.display(withdrawn.review_text);f.prompt("确认好了");f.commit();
  const after=f.service.get(p.project_id);
  assert.equal(after.delivery_policy!.risk_overrides[0]!.status,"RETRACTED");
  assert.deepEqual(after.items,p.items);
  assert.equal(f.router.status(after,session).status,"APPLIED");
  assert.equal(f.commit().model_version,after.model_version);
  assert.equal(evaluateRisk(after).findings.find(finding=>finding.override_id===recorded.id)!.status,"BLOCKING");
});

test("native mixed scope exclusion and stale mode fingerprints fail before staging consent", t => {
  const f=fixture(t),p=seedRisk(f,"本期用量统计，支付后置");
  const finding=evaluateRisk(p).findings.find(finding=>finding.reason_code==="PAYMENT_OR_FINANCIAL")!;
  assert.throws(()=>f.router.prepare(p,{...policyArgs(p),operation:"xmi_mode_override_resolve",override_id:finding.override_id,
    resolution:"DEFER_OR_EXCLUDE",rationale:"Only future payment",intent:"RESOLVE_OVERRIDE"},session),/RISK_SCOPE_SPLIT_REQUIRED/);
  assert.throws(()=>f.router.prepare(p,{...policyArgs(p),operation:"xmi_delivery_mode_select",mode:"PRODUCT_GRADE",reason:"Upgrade",
    fingerprint:"0".repeat(64),intent:"SELECT_MODE",change:"UPGRADE"},session),/FINGERPRINT_MISMATCH/);
  assert.equal(readSingle(f.directory,session),null);
  assert.deepEqual(f.service.get(p.project_id),p);
});

test("native policy endpoints refuse old forms without elicitation capability or canonical writes", async t => {
  const f=fixture(t),p=seedRisk(f),finding=evaluateRisk(p).findings[0]!;
  const server=createXmiServer(f.service,{singleReview:f.router});
  const client=new Client({name:"policy-chat-fixture",version:"1"},{capabilities:{}});
  const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
  t.after(async()=>{await client.close();await server.close();});
  const reason="Upgrade";
  for (const [name,args] of [
    ["xmi_delivery_mode_select",{...policyArgs(p),mode:"PRODUCT_GRADE",reason,fingerprint:modeFingerprint(p,"PRODUCT_GRADE",reason),intent:"SELECT_MODE",change:"UPGRADE"}],
    ["xmi_mode_override_resolve",{...policyArgs(p),override_id:finding.override_id,resolution:"UPGRADE_SCOPE",rationale:"Full scope",intent:"RESOLVE_OVERRIDE"}],
    ["xmi_mode_override_retract",{...policyArgs(p),override_id:finding.override_id,reason:"Withdraw",intent:"RETRACT_OVERRIDE"}],
  ] as const) {
    const result=await client.callTool({name,arguments:args});
    assert.equal((result.structuredContent as {error:{code:string}}).error.code,"CHAT_REVIEW_REQUIRED");
  }
  const request={...policyArgs(p),operation:"xmi_mode_override_resolve",override_id:finding.override_id,
    resolution:"UPGRADE_SCOPE",rationale:"Full scope",intent:"RESOLVE_OVERRIDE"};
  const prepared=await client.callTool({name:"xmi_item_review_prepare",arguments:{schema_version:"0.1.0",session_id:session,request}});
  assert.equal((prepared.structuredContent as {ok:boolean}).ok,true);
  assert.deepEqual(f.service.get(p.project_id),p);
});

test("native single commit recovers a sidecar write failure without duplicate domain events", t => {
  const f=fixture(t),prepared=f.router.prepare(f.p,f.args(),session);
  f.display(prepared.review_text);f.prompt("确认好了");
  const original=fs.renameSync;
  const mock=t.mock.method(fs,"renameSync",(...args:Parameters<typeof fs.renameSync>)=>{
    if(String(args[1]).endsWith(session+".single.json")) throw Object.assign(new Error("fixture receipt denied"),{code:"EPERM"});
    return original(...args);
  });syncBuiltinESMExports();
  try {assert.throws(()=>f.commit(),/receipt denied/);} finally {mock.mock.restore();syncBuiltinESMExports();}
  assert.equal(f.service.get(f.p.project_id).model_version,2);
  assert.equal(readSingle(f.directory,session)!.status,"GRANTED");
  assert.equal(f.commit().model_version,2);
  assert.equal(f.service.history(f.p.project_id).length,2);
  assert.equal(readSingle(f.directory,session)!.status,"APPLIED");
});

test("a native reply arriving during single commit rolls back its canonical write", t => {
  const f=fixture(t),prepared=f.router.prepare(f.p,f.args(),session);
  f.display(prepared.review_text);f.prompt("确认好了");let interrupted=false;
  const racingService=new ProjectService({close(){},transaction:work=>f.store.transaction(tx=>work({...tx,
    saveReceipt(key,receipt){tx.saveReceipt(key,receipt);
      if(!interrupted){interrupted=true;assert.throws(()=>f.prompt("先修改"),/CHAT_REVIEW_BUSY/);}
    },
  }))});
  const router=createSingleReviewRouter(f.directory,f.db,undefined,racingService);
  assert.throws(()=>router.commit(f.p.project_id,1,prepared.review_id,session),/NATIVE_OWNER_REPLY_EXPIRED/);
  assert.equal(f.service.get(f.p.project_id).model_version,1);
  assert.equal(f.service.get(f.p.project_id).items[0]!.status,"PROPOSED");
});
