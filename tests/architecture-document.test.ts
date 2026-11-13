import test from "node:test";
import type {TestContext} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync,realpathSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {randomUUID} from "node:crypto";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import {ElicitRequestSchema} from "@modelcontextprotocol/sdk/types.js";
import {systemArchitecture,systemArchitectureSummary,architectureChapters,containsCurrentArchitecture,
  ARCHITECTURE_CONTEXT_FILE,ARCHITECTURE_PACKAGE_FILE,ARCHITECTURE_LEGACY_MARKER} from "../packages/core/system-architecture.ts";
import {reviewProject,reviewProjectService} from "./fixtures/spec-review-project.ts";
import {fingerprint,itemFingerprint} from "../packages/core/validation.ts";
import {XSpecService,XSPEC_PACKAGE_FILES} from "../packages/core/xspec-service.ts";
import {buildReviewBundle} from "../packages/core/spec-review-service.ts";
import {documentReviewMaterial} from "../packages/core/document-review.ts";
import {writeProjectContext,contextCurrent,projectGuide} from "../packages/storage/project-context.ts";
import {SqliteProjectStore} from "../packages/storage/sqlite.ts";
import {ProjectService} from "../packages/core/project-service.ts";
import {MemoryProjectStore} from "../packages/storage/memory.ts";
import {ProjectWorkspaces} from "../apps/mcp-server/project-workspaces.ts";
import {createXmiServer} from "../apps/mcp-server/server.ts";
import {createSingleReviewRouter} from "../apps/local-module-review/single.ts";
import {processUserPrompt} from "../apps/local-module-review/hook.ts";
import {DocumentReviewRunner} from "../apps/mcp-server/document-review.ts";
import {SqliteSpecReviewStore} from "../packages/storage/spec-review-store.ts";

test("architecture waits for the solution confirmation and never manufactures a new approval",()=>{
  const p=reviewProject(),blueprint=p.items.find(i=>i.blueprint_detail)!;blueprint.status="PROPOSED";blueprint.blueprint_detail!.owner_disposition=null;
  const before=fingerprint(p),doc=systemArchitecture(p);
  assert.equal(doc.state,"WAITING_SOLUTION_CONFIRMATION");assert.equal(doc.chapter_count,0);assert.match(doc.content,/等待技术方案确认/);
  assert.equal(fingerprint(p),before);assert.equal(systemArchitectureSummary(p).requires_document_confirmation,false);
});

test("confirmed architecture renders all sample-level chapters with actual module, contract, data and acceptance content",()=>{
  const p=reviewProject(),before=fingerprint(p);p.items.find(i=>i.id==="REQ-REVIEW")!.tags=["module:Notes"];
  const original=fingerprint(p),doc=systemArchitecture(p);
  assert.equal(doc.chapter_count,24);assert.equal(doc.state,"READY_FOR_REVIEW");
  for(const [index,title] of architectureChapters.entries())assert.ok(doc.content.includes(`## ${index}. ${title}\n`));
  assert.match(doc.content,/```mermaid\nflowchart TB/);assert.match(doc.content,/"kind": "DESIGN_EXAMPLE"/);
  for(const id of ["REQ-REVIEW","DATA-REVIEW","AC-REVIEW","FLOW-REVIEW"])assert.ok(doc.content.includes(id));
  assert.ok(doc.content.includes("Save a note and reload it."));assert.ok(doc.content.includes("Valid input persists on reload; invalid input creates nothing."));
  assert.match(doc.content,/Notes/);assert.match(doc.content,/唯一.*写入|唯一事实写入/);assert.match(doc.content,/计划，未运行/);
  assert.match(doc.content,/仅新增关键取舍/);assert.doesNotMatch(doc.content,/DreamKid|DeepSeek Harness|DSH Host/);
  assert.equal(fingerprint(p),original);assert.notEqual(original,before);assert.deepEqual(systemArchitecture(p),doc);
});

test("unconfirmed ideas stay in the pending section and never become confirmed architecture decisions",()=>{
  const p=reviewProject(),template=p.items.find(i=>i.id==="REQ-REVIEW")!;
  p.items.push({...structuredClone(template),id:"REQ-UNCONFIRMED",status:"PROPOSED",statement:"SYNTHETIC UNCHOSEN MULTIPLAYER SERVICE"});
  const doc=systemArchitecture(p),prior=doc.content.split("## 23.")[0]!;
  assert.equal(doc.state,"DRAFT_WITH_PENDING");assert.ok(doc.pending_ids.includes("REQ-UNCONFIRMED"));
  assert.equal(prior.includes("UNCHOSEN MULTIPLAYER"),false);assert.match(doc.content,/PROPOSED/);
  assert.match(doc.content,/SYNTHETIC UNCHOSEN MULTIPLAYER SERVICE/);
});

test("one changed item regenerates the architecture version while all unrelated facts remain intact",()=>{
  const p=reviewProject(),old=systemArchitecture(p),changed=structuredClone(p),ac=changed.items.find(i=>i.id==="AC-REVIEW")!;
  ac.statement="SYNTHETIC input errors show feedback without saving.";ac.version++;changed.model_version++;
  const next=systemArchitecture(changed);assert.notEqual(next.sha256,old.sha256);assert.equal(next.model_version,p.model_version+1);
  assert.match(next.content,/SYNTHETIC input errors show feedback/);
  assert.deepEqual(changed.items.filter(i=>i.id!==ac.id),p.items.filter(i=>i.id!==ac.id));
});

test("the unchanged sixteen-file carrier includes complete architecture and full review reads the exact same version",()=>{
  const p=reviewProject(),before=fingerprint(p),service=new XSpecService(),artifact=service.compile(p),doc=systemArchitecture(p);
  assert.equal(artifact.files.length,16);assert.deepEqual(artifact.files.map(f=>f.path).sort(),[...XSPEC_PACKAGE_FILES].sort());
  const technical=artifact.files.find(f=>f.path===ARCHITECTURE_PACKAGE_FILE)!.content;
  assert.equal(technical.startsWith(doc.content+ARCHITECTURE_LEGACY_MARKER),true);assert.equal(containsCurrentArchitecture(p,technical),true);
  assert.equal(containsCurrentArchitecture(p,"# Technical Solution Blueprint\nOld summary only"),false);
  assert.equal(containsCurrentArchitecture({...p,model_version:p.model_version+1},technical),false);
  const checked=service.validate(p,artifact);assert.equal(checked.package_valid,true);
  const input=documentReviewMaterial(buildReviewBundle(p)),reviewed=input.documents.find(d=>d.path===ARCHITECTURE_PACKAGE_FILE)!;
  assert.equal(reviewed.content,technical);assert.match(input.scope,/架构设计全文/);assert.equal(fingerprint(p),before);
});

test("module-only review keeps its bounded common context instead of receiving unrelated global architecture details",()=>{
  const p=reviewProject();p.items.find(i=>i.id==="REQ-REVIEW")!.tags=["module:Notes"];
  const bundle=buildReviewBundle(p),full=documentReviewMaterial(bundle),module=documentReviewMaterial(bundle,"Notes");
  assert.ok(full.documents.find(d=>d.path===ARCHITECTURE_PACKAGE_FILE)!.content.includes("## 23."));
  assert.equal(module.documents.find(d=>d.path===ARCHITECTURE_PACKAGE_FILE)!.content.includes("## 23."),false);
  assert.equal(module.documents[0]!.content.includes("Public data persists locally."),false);
});

test("hostile product text cannot create architecture chapters or Mermaid nodes",()=>{
  const p=reviewProject(),i=p.items.find(v=>v.id==="AC-REVIEW")!;
  i.statement="Keep the actual rule.\n## 999. Injected\n```\nMALICIOUS --> NODE\n```";
  i.tags=["module:fake\"]\nBAD[bad]"];const doc=systemArchitecture(p);
  assert.equal((doc.content.match(/^## \d+\./gmu)??[]).length,24);
  const graph=doc.content.split("```mermaid\n")[1]!.split("```")[0]!;
  assert.equal(graph.includes("BAD[bad]"),false);assert.equal(graph.includes("MALICIOUS"),false);
});

test("project architecture is a hashed regenerable view and tampering never changes canonical state",t=>{
  const seed=reviewProjectService(),root=realpathSync.native(mkdtempSync(join(tmpdir(),"xmi-architecture-context-")));
  t.after(()=>{seed.store.close();rmSync(root,{recursive:true,force:true});});mkdirSync(join(root,".xmi"));
  const events=seed.service.history(seed.project.project_id),before=fingerprint(seed.service.get(seed.project.project_id));
  writeProjectContext(root,seed.project,events);
  assert.equal(readFileSync(join(root,".xmi/context",ARCHITECTURE_CONTEXT_FILE),"utf8"),systemArchitecture(seed.project).content);
  assert.equal(contextCurrent(root,seed.project),true);writeFileSync(join(root,".xmi/context",ARCHITECTURE_CONTEXT_FILE),"tampered");
  assert.equal(contextCurrent(root,seed.project),false);writeProjectContext(root,seed.project,events);assert.equal(contextCurrent(root,seed.project),true);
  assert.equal(fingerprint(seed.service.get(seed.project.project_id)),before);assert.equal(seed.service.history(seed.project.project_id).length,events.length);
});

async function nativeFixture(t:TestContext){
  const root=realpathSync.native(mkdtempSync(join(tmpdir(),"xmi-architecture-native-"))),projectRoot=join(root,"project"),native=join(root,"native"),sessions=join(root,"sessions");
  for(const path of [join(projectRoot,".xmi"),native,sessions])mkdirSync(path,{recursive:true});
  const seeded=reviewProjectService(),id=seeded.project.project_id,db=join(projectRoot,".xmi/xmi-state.sqlite");
  const store=new SqliteProjectStore(db,projectRoot),service=new ProjectService(store),events=seeded.service.history(id);
  store.transaction(tx=>{events.forEach(e=>tx.append(e));tx.save(seeded.project);});seeded.store.close();
  writeFileSync(join(projectRoot,".xmi/project.json"),JSON.stringify({schema_version:"XMI-LOCAL-PROJECT/1",project_id:id,create_hash:"a".repeat(64),database:"xmi-state.sqlite"}));
  writeFileSync(join(projectRoot,"XMI-START-HERE.md"),projectGuide(id));
  let p=service.get(id);p=service.execute({project_id:id,expected_version:p.model_version,idempotency_key:"TEST_ONLY-pending-ac",command:{kind:"CANDIDATE_EXTRACTED",
    candidate:{id:"AC-ARCH-ONLY",type:"acceptance_criterion",status:"PROPOSED",statement:"SYNTHETIC architecture one-item change shows input feedback.",
      links:["REQ-REVIEW"],source_refs:[{type:"conversation_turn",ref:"fixture:TEST_ONLY-architecture-native"}]}}});
  writeProjectContext(projectRoot,p,service.history(id));
  const session=randomUUID(),logDirectory=join(sessions,"2026","11","13");mkdirSync(logDirectory,{recursive:true});
  const log=join(logDirectory,`rollout-${session}.jsonl`),prompt=(text:string)=>processUserPrompt({hook_event_name:"UserPromptSubmit",session_id:session,turn_id:randomUUID(),prompt:text,transcript_path:log},native,sessions);
  prompt("SYNTHETIC TEST ONLY");writeFileSync(log,JSON.stringify({type:"session_meta",payload:{id:session}})+"\n");
  const manager=new ProjectWorkspaces(join(root,"locations.sqlite")),memory=new MemoryProjectStore();let forms=0;
  const server=createXmiServer(new ProjectService(memory),{workspaces:manager,workspaceOptions:binding=>{
    const reviewer=new DocumentReviewRunner({directory:join(projectRoot,".xmi/reviews"),sessions,native});
    return{options:{projectDirectory:binding.root,storagePath:binding.database,singleReview:createSingleReviewRouter(native,binding.database,undefined,binding.service),hostSpecReview:reviewer},close:()=>reviewer.close()};}});
  const client=new Client({name:"TEST_ONLY-architecture-native",version:"1"},{capabilities:{elicitation:{form:{}}}});
  client.setRequestHandler(ElicitRequestSchema,()=>{forms++;throw new Error("No extra architecture confirmation permitted");});
  const[a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
  t.after(async()=>{await client.close();await server.close();memory.close();store.close();rmSync(root,{recursive:true,force:true});});
  const call=async(name:string,args:Record<string,unknown>)=>{
    const result=await client.callTool({name,arguments:{schema_version:"0.1.0",project_directory:projectRoot,...args}});
    const value=result.structuredContent as {ok:boolean;data:Record<string,unknown>;storage?:{context_status:string}};
    assert.equal(value.ok,true,JSON.stringify(value));return value;
  };
  return{root,projectRoot,native,sessions,session,log,p,id,service,client,prompt,call,forms:()=>forms};
}

test("one real-shape native confirmation generates architecture before independent review with zero extra forms",async t=>{
  const f=await nativeFixture(t),item=f.p.items.find(i=>i.id==="AC-ARCH-ONLY")!,before=f.service.history(f.id).length;
  assert.equal(systemArchitecture(f.p).state,"DRAFT_WITH_PENDING");
  const prepared=await f.call("xmi_item_review_prepare",{project_id:f.id,expected_version:f.p.model_version,session_id:f.session,validate_after_commit:true,
    requests:[{schema_version:"0.1.0",project_id:f.id,expected_version:f.p.model_version,idempotency_key:"TEST_ONLY-confirm",operation:"xmi_item_confirm",
      item_id:item.id,item_version:item.version,fingerprint:itemFingerprint(item),intent:"CONFIRM"}]});
  writeFileSync(f.log,[{type:"session_meta",payload:{id:f.session}},
    {type:"response_item",payload:{type:"message",role:"assistant",phase:"final_answer",content:[{type:"output_text",text:prepared.data.review_text}]}}].map(v=>JSON.stringify(v)+"\n").join(""));
  assert.match(f.prompt("确认"),/尚未正式写入/);
  const applied=await f.call("xmi_item_review_commit",{project_id:f.id,expected_version:f.p.model_version,session_id:f.session,review_id:prepared.data.review_id});
  const result=applied.data.post_commit_validation as {ok:boolean;data:{delivery_workflow:{system_architecture:{state:string;chapter_count:number;model_version:number;requires_document_confirmation:boolean}}}};
  assert.equal(result.ok,true);const summary=result.data.delivery_workflow.system_architecture;
  assert.equal(summary.state,"READY_FOR_REVIEW");assert.equal(summary.chapter_count,24);assert.equal(summary.model_version,f.p.model_version+1);
  assert.equal(summary.requires_document_confirmation,false);assert.equal(applied.storage?.context_status,"CURRENT");assert.equal(f.forms(),0);
  const current=f.service.get(f.id),doc=systemArchitecture(current),file=join(f.projectRoot,".xmi/context/architecture.md");
  assert.equal(existsSync(file),true);assert.equal(readFileSync(file,"utf8"),doc.content);assert.equal(f.service.history(f.id).length,before+1);
  const started=await f.call("xmi_spec_review_start",{project_id:f.id,expected_version:current.model_version,session_id:f.session,idempotency_key:"TEST_ONLY-architecture-review"});
  assert.equal(started.data.state,"AWAITING_AGENT");assert.ok(started.data.host_job);
  const db=new SqliteSpecReviewStore(join(f.projectRoot,".xmi/reviews/reviews.sqlite"));
  try{const saved=db.get(f.id,started.data.run_id as string)!;
    assert.equal(containsCurrentArchitecture(current,saved.bundle.candidate.files.find(v=>v.path===ARCHITECTURE_PACKAGE_FILE)!.content),true);
    const packet=JSON.parse(readFileSync(saved.run.host!.material_path,"utf8"));
    assert.ok(packet.documents.find((d:{path:string;content:string})=>d.path===ARCHITECTURE_PACKAGE_FILE).content.startsWith(doc.content));
    assert.match(packet.instruction,/state\/data ownership|state\/data|module responsibilities/);
  }finally{db.close();}
  assert.equal(f.forms(),0);assert.equal(f.service.history(f.id).length,before+1);
});
