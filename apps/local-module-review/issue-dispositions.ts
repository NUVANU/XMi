import {existsSync,readFileSync} from "node:fs";
import {join} from "node:path";
import {z} from "zod";
import {issueDispositionSchema} from "../../packages/core/issue-handling.ts";
import type {IssueDisposition} from "../../packages/core/issue-handling.ts";
import {requireCondition} from "../../packages/core/errors.ts";
import {writeRecord,withReviewLock} from "./adapter.ts";
import {fingerprint} from "../../packages/core/validation.ts";
const schema=z.strictObject({project_id:z.string(),entries:z.array(issueDispositionSchema).max(5000)});
function name(projectId:string){requireCondition(/^XMI-[A-Z0-9-]+$/u.test(projectId),"INVALID_PROJECT_ID");return projectId+".issue-dispositions";}
/** Workflow dispositions only. Never supplies a product-state grant. */
export function readIssueDispositions(directory:string,projectId:string):IssueDisposition[]{
  const path=join(directory,name(projectId)+".json");if(!existsSync(path))return [];
  const text=readFileSync(path,"utf8");requireCondition(Buffer.byteLength(text)<=8*1024*1024,"ISSUE_DISPOSITIONS_TOO_LARGE");
  const record=schema.parse(JSON.parse(text));requireCondition(record.project_id===projectId,"PROJECT_IDENTITY_MISMATCH");return record.entries;
}
export function saveIssueDispositions(directory:string,projectId:string,entries:IssueDisposition[]){
  const hash=fingerprint(projectId),lock=hash.slice(0,8)+"-"+hash.slice(8,12)+"-"+hash.slice(12,16)+"-"+hash.slice(16,20)+"-"+hash.slice(20,32);
  return withReviewLock(directory,lock,()=>{
  const prior=readIssueDispositions(directory,projectId), ids=new Set(entries.map(e=>e.review_id+":"+e.issue_id));
  const next=[...prior.filter(e=>!ids.has(e.review_id+":"+e.issue_id)),...entries];
  requireCondition(Buffer.byteLength(JSON.stringify(next))<=8*1024*1024,"ISSUE_DISPOSITIONS_TOO_LARGE");
  writeRecord(directory,name(projectId),schema.parse({project_id:projectId,entries:next}));
  });
}
