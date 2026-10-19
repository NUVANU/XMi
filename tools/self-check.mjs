import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {ElicitRequestSchema} from '@modelcontextprotocol/sdk/types.js';

assert.equal(process.versions.node,'24.20.0','Use the pinned Node runtime.');
const root=dirname(dirname(fileURLToPath(import.meta.url))),temp=mkdtempSync(join(tmpdir(),'xmi-public-selfcheck-'));
const clients=[],args=[join(root,'apps/mcp-server/generic.ts'),'--db',join(temp,'fixture.sqlite')];
const call=async(client,name,arguments_)=>{const r=await client.callTool({name,arguments:arguments_});return r.structuredContent??JSON.parse(r.content.find(c=>c.type==='text').text);};
async function connect(form=false) {
  const client=new Client({name:'isolated-public-package-fixture',version:'1'},{capabilities:form?{elicitation:{form:{}}}:{}});
  if(form)client.setRequestHandler(ElicitRequestSchema,async req=>({action:'accept',content:Object.fromEntries(Object.keys(req.params.requestedSchema.properties).map(key=>[key,true]))}));
  clients.push(client);await client.connect(new StdioClientTransport({command:process.execPath,args,stderr:'pipe'}));return client;
}
try {
  const fixture={schema_version:'0.1.0',project_directory:join(temp,'project'),title:'Synthetic self-check',initial_idea:'A local synthetic notes tool for package verification.',source_ref:{type:'conversation_turn',ref:'fixture:public-package'},idempotency_key:'fixture-create'};
  const plain=await connect();assert.equal((await plain.listTools()).tools.length,26);
  assert.equal((await call(plain,'xmi_project_create',fixture)).error.code,'CONSENT_UNAVAILABLE');await plain.close();
  const client=await connect(true),created=await call(client,'xmi_project_create',fixture);assert.equal(created.ok,true);
  const route={schema_version:'0.1.0',project_id:created.data.project_id},p=await call(client,'xmi_project_get',route),item=p.data.items[0];
  const adopted=await call(client,'xmi_item_confirm',{...route,expected_version:p.data.model_version,idempotency_key:'fixture-adopt',item_id:item.id,item_version:item.version,fingerprint:item.fingerprint,intent:'CONFIRM'});assert.equal(adopted.ok,true);
  const after=await call(client,'xmi_project_get',route);assert.equal(after.data.items[0].status,'CONFIRMED');
  assert.equal((await call(client,'xmi_module_review_status',route)).error.code,'CHAT_CONFIRMATION_UNAVAILABLE');
  const ready=await call(client,'xmi_readiness_evaluate',{...route,expected_version:after.data.model_version});assert.equal(ready.ok,true);assert.equal(ready.data.readiness.hard_gate_ready,false);
  await client.close();const restored=await connect(true);assert.equal((await call(restored,'xmi_project_get',route)).data.model_version,after.data.model_version);
  console.log(JSON.stringify({status:'PASS',checks:['26 default tools; independent-review prototype deferred','no-form refusal','synthetic form create/adopt/readback','native bridge unavailable in generic host','readiness blockers preserved','restart continuity'],scope:'Isolated temporary fixture only; does not prove any host UI or human acceptance.'}));
} finally {await Promise.allSettled(clients.map(client=>client.close()));rmSync(temp,{recursive:true,force:true});}
