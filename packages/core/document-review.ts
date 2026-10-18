import {z} from "zod";
import type {Project} from "../shared-types/domain.ts";
import type {ReviewBundle} from "./spec-review-service.ts";
import {canonical} from "./validation.ts";
import {requireCondition} from "./errors.ts";

const text = (max: number) => z.string().min(1).max(max).refine(s => /\S/u.test(s));
const evidence = z.strictObject({file_path: text(200), quote: text(1000)});
export const documentFindingSchema = z.strictObject({id: text(100), severity: z.enum(["BLOCKING", "WARNING", "INFO"]),
  statement: text(2000), evidence: z.array(evidence).min(1).max(10), suggestion: text(2000), affected_ids: z.array(text(100)).max(100)});
export const documentReviewResponseSchema = z.strictObject({schema_version: z.literal("XMI-DOCUMENT-REVIEW-RESPONSE/1"),
  project_id: text(100), model_version: z.number().int().positive(), findings: z.array(documentFindingSchema).max(100),
  questions: z.array(text(1000)).max(20), follow_up_refs: z.array(text(100)).max(100), notes: z.array(text(300)).max(120)});
const rawFinding = documentFindingSchema.omit({id: true, evidence: true, affected_ids: true}).extend({id: text(100).optional(),
  severity: documentFindingSchema.shape.severity.optional(), affected_ids: z.array(text(100)).max(100).optional(),
  evidence: z.array(z.union([evidence, z.strictObject({item_id: text(100), quote: text(1000)})])).min(1).max(10)}).passthrough();
export const documentReviewInputSchema = z.object({schema_version: z.literal("XMI-DOCUMENT-REVIEW-RESPONSE/1"),
  project_id: text(100), model_version: z.number().int().positive(), findings: z.array(z.unknown()).max(100),
  questions: z.array(z.unknown()).max(20).optional()}).passthrough();
export const documentReviewPromptSchema = documentReviewInputSchema.extend({findings: z.array(rawFinding).max(100), questions: z.array(text(1000)).max(20).optional()});
export const documentReviewStatusSchema = z.strictObject({schema_version: z.literal("XMI-DOCUMENT-REVIEW/1"),
  project_id: text(100), model_version: z.number().int().positive(), run_id: z.string().uuid().nullable(),
  state: z.enum(["UNAVAILABLE", "AWAITING_AGENT", "RUNNING", "COMPLETED", "INCOMPLETE", "STALE", "UNVERIFIED"]),
  source_verified: z.boolean(), gate_eligible: z.literal(false), scope: text(1000),
  findings: z.array(documentFindingSchema).max(20), total_findings: z.number().int().nonnegative(), next_offset: z.number().int().nonnegative().nullable(),
  questions: documentReviewResponseSchema.shape.questions, follow_up_refs: documentReviewResponseSchema.shape.follow_up_refs,
  notes: documentReviewResponseSchema.shape.notes,
  host_job: z.strictObject({task_name: text(100), fork_turns: z.literal("none"), message: text(12000),
    material_bytes: z.number().int().nonnegative(), packet_sha256: z.string().regex(/^[a-f0-9]{64}$/u)}).nullable(), reason: text(1000)});
export type DocumentReviewStatus = z.infer<typeof documentReviewStatusSchema>;

export function documentReviewMaterial(bundle: ReviewBundle, interviewModule?: string) {
  const p = bundle.model as Project;
  const files = bundle.candidate.files.filter(f => f.path.endsWith(".md"));
  let documents: {path: string; content: string}[];
  if (interviewModule) {
    const tag = interviewModule.startsWith("module:") ? interviewModule : "module:" + interviewModule;
    const core = p.items.filter(i => i.tags?.includes(tag) && !["REJECTED", "SUPERSEDED"].includes(i.status));
    requireCondition(core.length > 0, "DOCUMENT_REVIEW_MODULE_NOT_FOUND");
    const linked = new Set(core.flatMap(i => i.links ?? [])), selected = new Set(core.map(i => i.id));
    const related = p.items.filter(i => !selected.has(i.id) && !["REJECTED", "SUPERSEDED"].includes(i.status) &&
      (linked.has(i.id) || i.links?.some(id => selected.has(id))));
    const render = (items: typeof core) => items.map(i => `## ${i.id} (${i.status}, v${i.version})\n\n${i.statement}`).join("\n\n");
    documents = [{path: "MODULE-REVIEW.md", content: `# ${interviewModule}\n\n${render(core)}\n\n# 直接关联设定\n\n${render(related)}`}];
    documents.push(...files.filter(f => ["PRODUCT-VISION.md", "TECHNICAL-SOLUTION-BLUEPRINT.md", "READINESS-REPORT.md"].includes(f.path)));
  } else documents = files.map(({path, content}) => ({path, content}));
  return {project_id: p.project_id, model_version: p.model_version,
    scope: interviewModule ? `模块 ${interviewModule} 的当前陈述、直接链接条目及所附公共文档；未核对其他设定或详情字段。` : "所附可读规格文档；不声称完整 Product Model 或正式独立审计通过。",
    documents, delivery_mode: p.delivery_policy?.effective_mode ?? null,
    scoped_dispositions: (p.delivery_policy?.risk_overrides ?? []).filter(r => r.status === "CONFIRMED")
      .map(({id, scope_ids, minimum_mode, resolution, rationale}) => ({id, scope_ids, minimum_mode, resolution, rationale}))};
}

export function collectDocumentReview(bundle: ReviewBundle, interviewModule: string | undefined, value: unknown) {
  requireCondition(Buffer.byteLength(canonical(value)) <= 256 * 1024, "DOCUMENT_REVIEW_OUTPUT_TOO_LARGE");
  const parsed = documentReviewInputSchema.safeParse(value);
  requireCondition(parsed.success, "DOCUMENT_REVIEW_RESPONSE_INVALID");
  const r = parsed.data, material = documentReviewMaterial(bundle, interviewModule);
  requireCondition(r.project_id === bundle.project_id && r.model_version === bundle.product_model_version, "DOCUMENT_REVIEW_VERSION_MISMATCH");
  const known = new Map((bundle.model as Project).items.map(i => [i.id, i])), notes: string[] = [], findings = [], seen = new Set<string>();
  for (const [index, value] of r.findings.entries()) {
    const result = rawFinding.safeParse(value);
    if (!result.success) {notes.push(`第${index + 1}条意见内容或引用格式不完整，未列入可核对意见。`); continue;}
    const f = result.data;
    const citations = f.evidence.map(e => {
      if ("file_path" in e) return material.documents.some(d => d.path === e.file_path && d.content.includes(e.quote)) ? e : null;
      const item = known.get(e.item_id), doc = material.documents.find(d => d.content.includes(e.quote));
      return item?.statement.includes(e.quote) && doc ? {file_path: doc.path, quote: e.quote} : null;
    });
    if (citations.some(e => e === null)) {notes.push(`第${index + 1}条意见的引用未能在所给材料核对，需补充材料；其余意见保留。`); continue;}
    let id = f.id ?? `DOC-FINDING-${index + 1}`;
    if (seen.has(id)) {id = `DOC-FINDING-${index + 1}`; while (seen.has(id)) id += "-"; notes.push(`第${index + 1}条意见编号重复，已分配显示编号。`);}
    seen.add(id);
    const affected = (f.affected_ids ?? []).filter(id => known.has(id));
    if (affected.length !== (f.affected_ids ?? []).length) notes.push(`第${index + 1}条意见包含无法匹配的条目引用，已单独忽略。`);
    findings.push({id, severity: f.severity ?? "WARNING" as const, statement: f.statement,
      evidence: citations as z.infer<typeof evidence>[], suggestion: f.suggestion, affected_ids: affected});
  }
  const follow = Array.isArray(r.unresolved_ids) ? [...new Set(r.unresolved_ids.filter((id): id is string => typeof id === "string" && known.has(id)))].slice(0, 100) : [];
  if (Array.isArray(r.unresolved_ids) && r.unresolved_ids.length) notes.push(`另有${r.unresolved_ids.length}个补充核查引用，未当作本轮已读或已确认内容，不影响可核对意见。`);
  const questions = (r.questions ?? []).flatMap(q => {const parsed = text(1000).safeParse(q); if (parsed.success) return [parsed.data];
    notes.push("一条补充问题格式不完整，已单独忽略。"); return [];});
  return documentReviewResponseSchema.parse({schema_version: "XMI-DOCUMENT-REVIEW-RESPONSE/1", project_id: r.project_id,
    model_version: r.model_version, findings, questions, follow_up_refs: follow,
    notes: notes.length > 120 ? [...notes.slice(0, 119), `另有${notes.length - 119}条格式或引用提示。`] : notes});
}

export function validateDocumentReview(bundle: ReviewBundle, interviewModule: string | undefined, value: unknown) {
  const r = documentReviewResponseSchema.parse(value), material = documentReviewMaterial(bundle, interviewModule);
  requireCondition(r.project_id === bundle.project_id && r.model_version === bundle.product_model_version &&
    r.findings.every(f => f.evidence.every(e => material.documents.some(d => d.path === e.file_path && d.content.includes(e.quote)))),
    "DOCUMENT_REVIEW_RESULT_INVALID");
  return r;
}
