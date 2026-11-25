import {requireCondition} from "./errors.ts";
import {canonical} from "./validation.ts";
import {createHash} from "node:crypto";

type ItemSource = {id: string; statement: string};
type FileSource = {path: string; content: string; original_sha256: string; material_sha256: string};
type ReviewMaterial = {
  model: {items: ItemSource[]; [key: string]: unknown};
  candidate_files: FileSource[];
  [field: string]: unknown;
};
export type CompactMaterial = {
  encoding: "XMI-FORMAL-SPANS/1";
  text_spans: string[];
  model: {items: (Omit<ItemSource, "statement"> & {statement_refs: number[]})[]; [key: string]: unknown};
  candidate_files: (Omit<FileSource, "content"> & {content_refs: number[]})[];
  [field: string]: unknown;
};

/** Verbatim pieces improve citation precision and keep deduplication useful in table rows and JSON. */
function exactPieces(text: string): string[] {
  const parts: string[] = [];
  const breaks = /[。！？；]|\r?\n|\\n|[ \t]*\|[ \t]*|","[a-z][a-z_]*":/gu;
  const push = (part: string) => {
    for (let start = 0; start < part.length;) {
      let end = Math.min(start + 360, part.length);
      if (end < part.length && /[\uD800-\uDBFF]/u.test(part[end - 1]!)) end--;
      parts.push(part.slice(start, end));
      start = end;
    }
  };
  let offset = 0;
  for (const match of text.matchAll(breaks)) {
    push(text.slice(offset, match.index));
    push(match[0]);
    offset = match.index + match[0].length;
  }
  push(text.slice(offset));
  return parts;
}

export function isCompactFormalMaterial(value: unknown): value is CompactMaterial {
  return !!value && typeof value === "object" && "encoding" in value && value.encoding === "XMI-FORMAL-SPANS/1";
}

export function compactFormalMaterial(material: ReviewMaterial): string {
  const text_spans: string[] = [], ids = new Map<string, number>();
  const refs = (text: string) => exactPieces(text).map(part => {
    const id = ids.get(part);
    if (id !== undefined) return id;
    text_spans.push(part);
    ids.set(part, text_spans.length);
    return text_spans.length;
  });
  const model = {...material.model, items: material.model.items.map(({statement, ...item}) => ({...item, statement_refs: refs(statement)}))};
  const candidate_files = material.candidate_files.map(({content, ...file}) => ({...file, content_refs: refs(content)}));
  const packed = {...material, encoding: "XMI-FORMAL-SPANS/1" as const, model, candidate_files, text_spans};
  requireCondition(canonical(expandFormalMaterial(packed)) === canonical(material), "FORMAL_REVIEW_MATERIAL_ROUNDTRIP");
  return canonical(packed);
}

export function expandFormalMaterial(parsed: unknown): ReviewMaterial {
  if (!isCompactFormalMaterial(parsed)) return parsed as ReviewMaterial;
  const {encoding, text_spans, ...header} = parsed;
  requireCondition(encoding === "XMI-FORMAL-SPANS/1" && Array.isArray(text_spans) &&
    text_spans.every(span => typeof span === "string" && span.length > 0 && span.length <= 360), "FORMAL_REVIEW_SPAN_INVALID");
  let decodedBytes = 0;
  const spanSizes = text_spans.map(span => Buffer.byteLength(span));
  const decode = (refs: number[]) => {
    requireCondition(Array.isArray(refs), "FORMAL_REVIEW_SPAN_INVALID");
    return refs.map(id => {
      requireCondition(Number.isSafeInteger(id) && id > 0 && id <= text_spans.length, "FORMAL_REVIEW_SPAN_INVALID");
      decodedBytes += spanSizes[id - 1]!;
      requireCondition(decodedBytes <= 16 * 1024 * 1024, "FORMAL_REVIEW_EXPANSION_TOO_LARGE");
      return text_spans[id - 1]!;
    }).join("");
  };
  const model = {...parsed.model, items: parsed.model.items.map(({statement_refs, ...item}) => ({...item,
    statement: decode(statement_refs)}))};
  const candidate_files = parsed.candidate_files.map(({content_refs, ...file}) => {
    const content = decode(content_refs);
    requireCondition(createHash("sha256").update(content).digest("hex") === file.material_sha256, "FORMAL_REVIEW_MATERIAL_ROUNDTRIP");
    return {...file, content};
  });
  return {...header, model, candidate_files};
}
