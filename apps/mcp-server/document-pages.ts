import {canonical} from "../../packages/core/validation.ts";
import {requireCondition} from "../../packages/core/errors.ts";
import type {documentReviewFocus} from "../../packages/core/document-review.ts";
import type {ReviewBundle} from "../../packages/core/spec-review-service.ts";
import type {Project} from "../../packages/shared-types/domain.ts";

type Document = {path: string; content: string};
type Section = {key: string; title: string; content: string};
type SourcePage = Document & {title: string; required: boolean};
const pageBytes = 24 * 1024;
const optionalGenerated = new Set(["CHANGELOG.md", "READINESS-REPORT.md"]);
export const numberedDocumentMaxBytes = 6 * 1024 * 1024;
export const numberedDocumentMaxPages = 320;

function sections(text: string): Section[] {
  const occurrences = new Map<string, number>();
  return text.split(/(?=^#{1,4} .+$)/gmu).filter(Boolean).map(content => {
    const heading = content.split("\n", 1)[0]!;
    const title = heading.startsWith("#") ? heading.slice(0, 160) : "";
    const count = (occurrences.get(title) ?? 0) + 1;
    occurrences.set(title, count);
    return {key: canonical([title, count]), title, content};
  });
}

function addPage(pages: SourcePage[], document: Document, section: Section, required: boolean, separator: string) {
  const last = pages.at(-1);
  if (last?.path === document.path && last.required === required && Buffer.byteLength(last.content + separator + section.content) <= pageBytes) {
    last.content += separator + section.content;
    return;
  }
  const bytes = Buffer.from(section.content);
  for (let start = 0; start < bytes.length;) {
    let end = Math.min(start + pageBytes, bytes.length);
    while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
    pages.push({path: document.path, title: section.title, content: bytes.subarray(start, end).toString("utf8"), required});
    start = end;
  }
}

function containsId(content: string, id: string) {
  const first = content.indexOf(id);
  if (first < 0) return false;
  for (let i = first; i >= 0; i = content.indexOf(id, i + id.length)) {
    if (!/[A-Za-z0-9_-]/u.test(content[i - 1] ?? "") && !/[A-Za-z0-9_-]/u.test(content[i + id.length] ?? "")) return true;
  }
  return false;
}

function addedLines(before: string | undefined, after: string) {
  const remaining = new Map<string, number>();
  for (const line of before?.split("\n") ?? []) remaining.set(line, (remaining.get(line) ?? 0) + 1);
  return after.split("\n").filter(line => {
    const prior = remaining.get(line) ?? 0;
    if (prior) remaining.set(line, prior - 1);
    return !prior && line.trim().length > 0;
  });
}

export function indexDocumentPages(documents: Document[], bundle: ReviewBundle, previous?: ReviewBundle,
  focus?: ReturnType<typeof documentReviewFocus>) {
  const project = bundle.model as Project;
  const prior = new Map(previous?.candidate.files.map(file => [file.path as string,
    new Map(sections(file.content).map(section => [section.key, section.content]))]));
  const selected = documents.map(document => {
    const original = prior.get(document.path);
    const remaining = new Map(original);
    const current = sections(document.content).map(section => {
      const before = remaining.get(section.key);
      const changed = before !== section.content;
      remaining.delete(section.key);
      return {...section, changed, additions: changed ? addedLines(before, section.content) : []};
    });
    return {document, current, removed: [...remaining.keys()].map(key => JSON.parse(key)[0] as string)};
  });
  const newReferences = selected.filter(d => !optionalGenerated.has(d.document.path)).flatMap(d => d.current.flatMap(s => s.additions));
  const anchorIds = new Set(focus?.mode === "INCREMENT" ? [...focus.context_ids, ...focus.changed_ids] : []);
  if (previous) for (const item of project.items) {
    if (item.type !== "solution_blueprint" && item.status === "CONFIRMED" && newReferences.some(line => containsId(line, item.id))) anchorIds.add(item.id);
  }
  const linked = new Set(anchorIds);
  for (const item of project.items) {
    if (item.type === "solution_blueprint" || item.status !== "CONFIRMED") continue;
    if (anchorIds.has(item.id)) for (const id of item.links ?? []) linked.add(id);
    if (item.links?.some(id => anchorIds.has(id))) linked.add(item.id);
  }
  const acceptanceIds = project.items.filter(item => item.type === "acceptance_criterion" && linked.has(item.id)).map(item => item.id);
  const required: SourcePage[] = [], optional: SourcePage[] = [];
  for (const {document, current} of selected) for (const section of current) {
    // A repeated ID in a generated architecture overview is background. The
    // direct source for a linked requirement or criterion has its own heading.
    const mandatory = !previous || !optionalGenerated.has(document.path) &&
      (section.changed || [...linked].some(id => containsId(section.title, id)));
    addPage(mandatory ? required : optional, document, section, mandatory, previous ? "\n\n" : "");
  }
  const pages = [...required, ...optional];
  requireCondition(pages.length < numberedDocumentMaxPages &&
    pages.reduce((bytes, page) => bytes + Buffer.byteLength(page.content), 0) <= numberedDocumentMaxBytes,
  "DOCUMENT_REVIEW_MATERIAL_CAPACITY");
  const removed_sections = selected.filter(d => d.removed.length && !optionalGenerated.has(d.document.path))
    .map(({document, removed}) => ({path: document.path, titles: removed}));
  return {pages, acceptanceIds, removed_sections};
}

export function documentPageCommand(page: number): string {
  return `[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); if ([IO.File]::Exists((Join-Path $PWD '${page}.txt'))) { Get-Content -LiteralPath '${page}.txt' -Raw -Encoding utf8 -ErrorAction Stop } else { 'XMI_REVIEW_PAGE_NOT_FOUND ${page}' }`;
}

export function missingDocumentPage(page: number): string {return `XMI_REVIEW_PAGE_NOT_FOUND ${page}`;}

export type NumberedDocumentPacket = {pages: SourcePage[]; introduction: string};
export function numberedDocumentPages(packet: NumberedDocumentPacket): string[] {
  return [packet.introduction, ...packet.pages.map(({path, content}, i) => `XMI source ${i + 2} | ${path}\n${content}`)];
}
