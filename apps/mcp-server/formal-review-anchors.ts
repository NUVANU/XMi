import {z} from "zod";
import {canonical} from "../../packages/core/validation.ts";
import {requireCondition} from "../../packages/core/errors.ts";
import {reviewLimits, specReviewFindingSchema, specReviewResponseSchema, validateReviewResponse} from "../../packages/core/spec-review-service.ts";
import type {ReviewBundle} from "../../packages/core/spec-review-service.ts";
import {isCompactFormalMaterial} from "../../packages/core/formal-review-material.ts";
import type {CompactMaterial} from "../../packages/core/formal-review-material.ts";

type Reference = {item_id: string; quote: string} | {file_path: string; quote: string};
type SourceSpan = [id: number | null, text: string];

const finding = specReviewFindingSchema.omit({evidence: true}).extend({
  evidence_anchors: z.array(z.number().int().positive()).min(1).max(10),
});
const spanAnchor = z.strictObject({source: z.string().min(1).max(125), span: z.number().int().positive()});

function responseFields(bundle: ReviewBundle) {
  const unresolved = bundle.required_ids.length ? z.array(z.enum(bundle.required_ids)) : z.array(z.string()).length(0);
  return specReviewResponseSchema.omit({findings: true}).extend({unresolved_ids: unresolved});
}

function compactAnchors(bundle: ReviewBundle, material: CompactMaterial) {
  const sources = new Map<string, Set<number>>([
    ...material.model.items.map(item => [`item:${item.id}`, new Set(item.statement_refs)] as const),
    ...material.candidate_files.map(file => [`file:${file.path}`, new Set(file.content_refs)] as const),
  ]);
  const responseFinding = finding.extend({evidence_anchors: z.array(spanAnchor).min(1).max(10)});
  const answerSchema = z.strictObject({run_id: z.uuid(), response: responseFields(bundle)
    .extend({findings: z.array(responseFinding).max(reviewLimits.findings)})});
  return {
    text: canonical({...material, text_spans: material.text_spans.map((text, index) => [index + 1, text])}),
    outputSchema: z.toJSONSchema(answerSchema),
    citationInstructions: "The XMI-FORMAL-SPANS/1 dictionary is lossless: each statement_refs or content_refs array lists its exact text in order. A text_spans entry is [span id, literal text]. Review these ordered source views. Cite an exact {source, span} pair: source is item:<item id> or file:<file path>; the span id must occur in that source's reference list. Include cited item IDs in affected_ids.",
    collect(output: unknown, runId: string) {
      const answer = answerSchema.parse(output);
      requireCondition(answer.run_id === runId, "FORMAL_REVIEW_RESPONSE_BINDING");
      const findings = answer.response.findings.map(({evidence_anchors, ...entry}) => {
        const evidence: Reference[] = evidence_anchors.map(({source, span}) => {
          const quote = material.text_spans[span - 1]?.trim();
          requireCondition(quote && sources.get(source)?.has(span), "FORMAL_REVIEW_ANCHOR_INVALID");
          return source.startsWith("item:") ? {item_id: source.slice(5), quote} : {file_path: source.slice(5), quote};
        });
        return {...entry, affected_ids: [...new Set([...entry.affected_ids, ...evidence.flatMap(ref => "item_id" in ref ? [ref.item_id] : [])])],
          evidence};
      });
      return validateReviewResponse(bundle, {...answer.response, findings});
    },
  };
}

function splitExact(text: string) {
  const pieces: string[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + 360, text.length);
    if (end < text.length) {
      const paragraph = text.lastIndexOf("\n", end - 1);
      if (paragraph >= start + 120) end = paragraph + 1;
      else if (/[\uD800-\uDBFF]/u.test(text[end - 1]!)) end--;
    }
    pieces.push(text.slice(start, end));
    start = end;
  }
  return pieces;
}

/** All text survives in order. The reviewer selects an address and XMi copies the exact quotation. */
export function formalReviewAnchors(bundle: ReviewBundle) {
  const material = JSON.parse(bundle.material);
  if (isCompactFormalMaterial(material)) return compactAnchors(bundle, material);
  const anchors = new Map<number, Reference>();
  function spans(text: string, reference: (quote: string) => Reference): SourceSpan[] {
    return splitExact(text).map(part => {
      if (!part.trim()) return [null, part];
      const id = anchors.size + 1;
      anchors.set(id, reference(part.trim()));
      return [id, part];
    });
  }
  const model = {...material.model, items: material.model.items.map(({statement, ...item}: {id: string; statement: string}) =>
    ({...item, statement_spans: spans(statement, quote => ({item_id: item.id, quote}))}))};
  const candidateFiles = material.candidate_files.map(({content, ...file}: {path: string; content: string}) =>
    ({...file, content_spans: spans(content, quote => ({file_path: file.path, quote}))}));
  const knownIds: string[] = model.items.map((item: {id: string}) => item.id);
  const responseFinding = knownIds.length ? finding.extend({affected_ids: z.array(z.enum(knownIds)).min(1)}) : finding;
  const answerSchema = z.strictObject({run_id: z.uuid(), response: responseFields(bundle)
    .extend({findings: z.array(responseFinding).max(reviewLimits.findings)})});
  return {
    text: canonical({...material, model, candidate_files: candidateFiles}),
    outputSchema: z.toJSONSchema(answerSchema),
    citationInstructions: "For every finding, put the numeric address of each supporting span in evidence_anchors. Each statement_spans and content_spans entry is [address, exact source text]. The spans are contiguous and retain the complete source. For an item span, include that item's id in affected_ids. Use only addresses whose text directly supports the finding.",
    collect(output: unknown, runId: string) {
      const answer = answerSchema.parse(output);
      requireCondition(answer.run_id === runId, "FORMAL_REVIEW_RESPONSE_BINDING");
      const response = {...answer.response, findings: answer.response.findings.map(({evidence_anchors, ...entry}) => {
        const evidence = evidence_anchors.map(id => {
          const evidence = anchors.get(id);
          requireCondition(evidence, "FORMAL_REVIEW_ANCHOR_INVALID");
          return evidence;
        });
        const citedItems = evidence.flatMap(ref => "item_id" in ref ? [ref.item_id] : []);
        return {...entry, affected_ids: [...new Set([...entry.affected_ids, ...citedItems])], evidence};
      })};
      return validateReviewResponse(bundle, response);
    },
  };
}
