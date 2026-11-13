import {z} from "zod";
import type {Project} from "../shared-types/domain.ts";
import {fingerprint, itemFingerprint} from "./validation.ts";

const text = (max: number) => z.string().trim().min(1).max(max);
export const issueHandlingSchema = z.strictObject({source_run_id: z.string().uuid().optional(),
  issues: z.array(z.strictObject({id: text(100), problem: text(2000), impact: text(2000).optional(),
    recommendation: text(2000).optional(), replacement_text: text(8000).optional(),
    affected_ids: z.array(text(100)).max(100).optional()})).min(1).max(50)});
export type IssueHandling = z.infer<typeof issueHandlingSchema>;
export const issueChoiceSchema = z.strictObject({index: z.number().int().min(1).max(50),
  action: z.enum(["APPLY", "REVISE", "OPTION", "IGNORE", "DEFER", "UNRESOLVED"]), value: text(8000).optional()});
export type IssueChoice = z.infer<typeof issueChoiceSchema>;
export const handlingRecordSchema = z.strictObject({context: issueHandlingSchema,
  editable_rows: z.array(z.number().int().positive()).max(50),
  option_rows: z.array(z.strictObject({index: z.number().int().positive(), options: z.array(text(100)).min(1).max(100)})).max(50),
  confirmed_text_rows:z.array(z.strictObject({index:z.number().int().positive(),statement:text(8000)})).max(50).optional(),
  original_command_hash: z.string().regex(/^[a-f0-9]{64}$/), choices: z.array(issueChoiceSchema).max(50).optional()});
export const issueDispositionSchema = z.strictObject({review_id: z.string().uuid(), project_id: text(100),
  source_run_id: z.string().uuid().optional(), issue_id: text(100), problem: text(2000), action: issueChoiceSchema.shape.action,
  subject: z.array(z.strictObject({item_id: text(100), fingerprint: z.string().regex(/^[a-f0-9]{64}$/)})).max(100),
  source_ref: text(500), handled_at_version: z.number().int().positive()});
export type IssueDisposition = z.infer<typeof issueDispositionSchema>;

/** Deliberately bounded handling syntax, not a model's interpretation of consent. */
export function parseIssueReply(reply: string, count: number): IssueChoice[] | null {
  if (!reply.trim() || reply.length > 65536 || count < 1 || count > 50) return null;
  const choices = new Map<number, IssueChoice>(); let fallback: IssueChoice["action"] | undefined;
  const action = (value: string): IssueChoice["action"] | undefined => ({采纳:"APPLY",采用:"APPLY",同意:"APPLY",确认:"APPLY",
    忽略:"IGNORE",不改:"IGNORE",不采纳:"IGNORE",保留原文:"IGNORE",不要:"IGNORE",暂缓:"DEFER",待定:"DEFER",稍后处理:"DEFER",
    修改:"UNRESOLVED"} as Record<string, IssueChoice["action"]>)[value];
  const set = (choice: IssueChoice) => {
    if (choice.index < 1 || choice.index > count || choices.has(choice.index)) return false;
    choices.set(choice.index, choice); return true;
  };
  const normalized=reply.trim().replace(/((?:第)?\d+(?:项)?修改)[，,]\s*((?:其他|其余)(?:同意|采纳|采用|忽略|暂缓))/gu,"$1；$2");
  for (const original of normalized.split(/[;；\n]+/u)) {
    let clause = original.trim(); if (!clause) continue;
    if(!/^(?:第)?\d+(?:项)?(?:改为|修改为|改成|修改成)[:：]/u.test(clause))clause=clause.replace(/[。.]$/u, "");
    if (["确认", "确认好了", "全部采纳", "全部同意", "全部采用"].includes(clause)) {if (fallback) return null; fallback = "APPLY"; continue;}
    const rest = clause.match(/^(?:其他|其余|全部)(采纳|采用|同意|确认|忽略|不改|不采纳|暂缓|待定|稍后处理)$/u);
    if (rest) {if (fallback) return null; fallback = action(rest[1]!); continue;}
    const revised = clause.match(/^(?:第)?(\d+)(?:项)?(?:改为|修改为|改成|修改成)[:：]([\s\S]+)$/u);
    if (revised) {
      if (!revised[2]!.trim() || revised[2]!.trim().length > 8000 || !set({index:Number(revised[1]),action:"REVISE",value:revised[2]!.trim()})) return null;
      continue;
    }
    const option = clause.match(/^(?:第)?(\d+)(?:项)?(?:选择|选|选项)[:：]?\s*([A-Za-z0-9_-]{1,100})$/u);
    if (option) {if (!set({index:Number(option[1]),action:"OPTION",value:option[2]!})) return null; continue;}
    const compact = clause.replace(/第|项|\s/gu, "");
    const match = compact.match(/^(采纳|采用|同意|确认|忽略|不改|不采纳|保留原文|不要|暂缓|待定|稍后处理|修改)(\d+(?:[、,，和及]\d+)*)$/u)
      ?? compact.match(/^(\d+(?:[、,，和及]\d+)*)(采纳|采用|同意|确认|忽略|不改|不采纳|保留原文|不要|暂缓|待定|稍后处理|修改)$/u);
    if (!match) return null;
    const prefix = action(match[1]!), selectedAction = prefix ?? action(match[2]!), ids = prefix ? match[2]! : match[1]!;
    if (!selectedAction) return null;
    for (const index of ids.split(/[、,，和及]/u).map(Number)) if (!set({index,action:selectedAction})) return null;
  }
  if (!choices.size && !fallback) return null;
  return Array.from({length:count},(_,i)=>choices.get(i+1) ?? {index:i+1,action:fallback ?? "UNRESOLVED"});
}

export function issueHandlingSummary(choices: IssueChoice[]) {
  return {applied:choices.filter(c=>c.action==="APPLY"||c.action==="OPTION").length,
    revised:choices.filter(c=>c.action==="REVISE").length, ignored:choices.filter(c=>c.action==="IGNORE").length,
    deferred:choices.filter(c=>c.action==="DEFER").length, unresolved:choices.filter(c=>c.action==="UNRESOLVED").length};
}
export const issueHandlingSummarySchema = z.strictObject({applied:z.number().int().nonnegative(),revised:z.number().int().nonnegative(),
  ignored:z.number().int().nonnegative(),deferred:z.number().int().nonnegative(),unresolved:z.number().int().nonnegative()});

export function dispositionApplies(p: Project, value: IssueDisposition, problem: string, affected: string[],runId?:string,issueId?:string) {
  return ["IGNORE","DEFER"].includes(value.action) && value.project_id===p.project_id && value.problem===problem &&
    (value.source_run_id===runId && value.issue_id===issueId && value.handled_at_version===p.model_version &&
      value.subject.every(s=>{const item=p.items.find(i=>i.id===s.item_id);return item&&itemFingerprint(item)===s.fingerprint;}) ||
      value.subject.length>0 && fingerprint(value.subject.map(s=>s.item_id).sort())===fingerprint([...new Set(affected)].sort()) &&
      value.subject.every(s=>{const item=p.items.find(i=>i.id===s.item_id);return item && itemFingerprint(item)===s.fingerprint;})
    );
}
