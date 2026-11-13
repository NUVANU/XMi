import test from "node:test";
import assert from "node:assert/strict";
import {mkdirSync,mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {randomUUID} from "node:crypto";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js";
import {SqliteProjectStore} from "../packages/storage/sqlite.ts";
import {ProjectService} from "../packages/core/project-service.ts";
import {itemFingerprint} from "../packages/core/validation.ts";
import {reviewProjectService} from "./fixtures/spec-review-project.ts";

test("configured-home STDIO uses one home for native confirmation and independent review material",async()=>{
  const root=mkdtempSync(join(tmpdir(),"xmi-home-stdio-")),home=join(root,"codex-home"),session=randomUUID();
  const sessions=join(home,"sessions","2026","11","13"),log=join(sessions,`rollout-${session}.jsonl`),db=join(root,"fixture.sqlite");
  mkdirSync(sessions,{recursive:true});
  const seed=reviewProjectService(),store=new SqliteProjectStore(db),service=new ProjectService(store);
  store.transaction(tx=>{seed.service.history(seed.project.project_id).forEach(e=>tx.append(e));tx.save(seed.project);});seed.store.close();
  const before=service.get(seed.project.project_id),p=service.execute({project_id:before.project_id,expected_version:before.model_version,
    idempotency_key:"TEST_ONLY-one-item",command:{kind:"CANDIDATE_EXTRACTED",candidate:{id:"AC-HOME-ONLY",type:"acceptance_criterion",
      statement:"Synthetic: invalid input shows feedback and creates nothing.",status:"PROPOSED",links:["REQ-REVIEW"],
      source_refs:[{type:"conversation_turn",ref:"fixture:TEST_ONLY-configured-home"}]}}});
  const env={...process.env,CODEX_HOME:home},hook=(prompt:string)=>{
    const r=spawnSync(process.execPath,["--input-type=module","-e",`import {runHook} from ${JSON.stringify(new URL("../apps/local-module-review/hook.ts",import.meta.url).href)};await runHook();`],
      {env,input:JSON.stringify({hook_event_name:"UserPromptSubmit",session_id:session,turn_id:randomUUID(),prompt,transcript_path:log}),encoding:"utf8"});
    assert.equal(r.status,0,r.stderr);return r.stdout;
  };
  writeFileSync(log,JSON.stringify({type:"session_meta",payload:{id:session}})+"\n");hook("TEST_ONLY isolated home");
  const client=new Client({name:"TEST_ONLY-configured-home",version:"1"});
  try {
    await client.connect(new StdioClientTransport({command:process.execPath,args:[resolve("apps/mcp-server/main.ts"),"--db",db],env,stderr:"pipe"}));
    assert.equal(client.getServerVersion()!.version,"0.1.2");
    const call=async(name:string,args:Record<string,unknown>)=>{
      const r=await client.callTool({name,arguments:{schema_version:"0.1.0",project_id:p.project_id,...args}});
      const v=r.structuredContent as {ok:boolean;data:Record<string,unknown>};assert.equal(v.ok,true,JSON.stringify(v));return v.data;
    };
    const item=p.items.at(-1)!;
    const prepared=await call("xmi_item_review_prepare",{expected_version:p.model_version,session_id:session,validate_after_commit:true,
      requests:[{operation:"xmi_item_confirm",schema_version:"0.1.0",project_id:p.project_id,expected_version:p.model_version,
        idempotency_key:"TEST_ONLY-confirm",item_id:item.id,item_version:item.version,fingerprint:itemFingerprint(item),intent:"CONFIRM"}]});
    assert.match(String(prepared.review_text),/AC-HOME-ONLY/);
    writeFileSync(log,[{type:"session_meta",payload:{id:session}},{type:"response_item",payload:{type:"message",role:"assistant",phase:"final_answer",
      content:[{type:"output_text",text:prepared.review_text}]}}].map(row=>JSON.stringify(row)+"\n").join(""));
    assert.match(hook("确认"),/xmi_item_review_commit/);
    const committed=await call("xmi_item_review_commit",{expected_version:p.model_version,session_id:session,review_id:prepared.review_id});
    assert.equal(committed.model_version,p.model_version+1);
    const validation=committed.post_commit_validation as {ok:boolean};assert.equal(validation.ok,true);
    const started=await call("xmi_spec_review_start",{expected_version:p.model_version+1,session_id:session,idempotency_key:"TEST_ONLY-review"});
    assert.equal(started.state,"AWAITING_AGENT");assert.ok(started.host_job);
    assert.deepEqual(service.get(p.project_id).items.filter(i=>i.id!==item.id),p.items.filter(i=>i.id!==item.id));
  } finally {await client.close();store.close();rmSync(root,{recursive:true,force:true});}
});
