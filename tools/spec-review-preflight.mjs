import {existsSync,mkdirSync,readFileSync,statSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {buildReviewPreflight,buildFocusedPilotPacket,pilotLimits} from '../packages/core/spec-review-preflight.ts';
import {buildReviewTransport,reviewPagePath} from '../apps/mcp-server/review-transport.ts';

// Read-only planning of an explicitly supplied frozen bundle, never a scheduler.
export function preparePilotFiles(bundle,group,directory) {
  if(existsSync(directory))throw Error('SPEC_REVIEW_PREFLIGHT_OUTPUT_EXISTS');
  const plan=buildReviewPreflight(bundle);
  const jobs=['MODULE','CROSS_MODULE'].map(phase=>{
    const job=buildFocusedPilotPacket(bundle,plan,group,phase),transport=buildReviewTransport(job.packet);
    return {job,transport,within:job.preliminary_capacity==='WITHIN_BYTE_BOUND'&&transport.pages.length<=pilotLimits.pages_per_agent};
  });
  const ready=jobs.every(j=>j.within);
  mkdirSync(directory,{recursive:true,mode:0o700});
  const save=(path,value)=>writeFileSync(path,JSON.stringify(value,null,2),{flag:'wx',mode:0o600});
  save(join(directory,'preflight.json'),plan);
  const report={schema_version:'XMI-PILOT-PREFLIGHT-REPORT/2',context_strategy:'DIRECT_ENDPOINTS_WITH_PENDING_EDGE_LEDGER',root_bundle_sha256:plan.root_bundle_sha256,
    preflight_sha256:plan.preflight_sha256,project_id:plan.project_id,model_version:plan.model_version,group,
    state:ready?'READY_FOR_TWO_AGENT_PILOT':'BLOCKED_CAPACITY',coverage_state:'PLANNED_NOT_REVIEWED',
    limits:pilotLimits,actual_agents:0,gate_eligible:false,
    inventory:{records:plan.records.length,groups:plan.groups.length,files:plan.files.length,file_ranges:plan.file_ranges.length,
      scope_member_ids:plan.scope_requirements.map(s=>({id:s.id,scope_ids:s.scope_ids,minimum_mode:s.minimum_mode,resolution:s.resolution}))},
    jobs:jobs.map(({job,transport,within})=>({phase:job.body.phase,packet_sha256:job.packet_sha256,input_bytes:job.input_bytes,
      encoded_pages:transport.pages.length,transport_bytes:transport.pages.reduce((n,p)=>n+Buffer.byteLength(p),0),
      records:job.body.record_ids.length,ranges:job.body.documents.length,edges:job.body.edges.length,
      unreviewed_dependency_edges:job.body.dependencies.length,within_limits:within})),
    reason:ready?'Byte/page preflight only; tokenizer fit and real source/response checks still required.':'STOP: no Agent may start; preserve closure and documents, do not truncate, replace the module or increase limits automatically.'};
  save(join(directory,'report.json'),report);
  // If either phase is too large, do not prepare executable read jobs for either.
  if(ready)for(const {job,transport} of jobs){
    const path=join(directory,job.body.phase+'.json');writeFileSync(path,job.packet,{flag:'wx',mode:0o600});
    mkdirSync(path+'.pages',{mode:0o700});transport.pages.forEach((page,i)=>writeFileSync(reviewPagePath(path,i),page,{flag:'wx',mode:0o600}));
  }
  return report;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const args=process.argv.slice(2), flags=new Map();
  if(args.length!==6)throw Error('Usage: node tools/spec-review-preflight.mjs --bundle-file <frozen.json> --module <module:tag> --out <new-directory>');
  for(let i=0;i<args.length;i+=2){if(!['--bundle-file','--module','--out'].includes(args[i])||flags.has(args[i]))throw Error('Invalid arguments');flags.set(args[i],args[i+1]);}
  const input=resolve(flags.get('--bundle-file'));
  if(statSync(input).size>8*1024*1024)throw Error('SPEC_REVIEW_INPUT_TOO_LARGE');
  const report=preparePilotFiles(JSON.parse(readFileSync(input,'utf8')),flags.get('--module'),resolve(flags.get('--out')));
  console.log(JSON.stringify(report));
}
