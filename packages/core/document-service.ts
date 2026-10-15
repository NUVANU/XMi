import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, join } from "node:path";
import { createRequire } from "node:module";
import { extractDocxText } from "./docx-parser.ts";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { Project, SourceRef } from "../shared-types/domain.ts";
import { InterviewService } from "./interview-service.ts";
import { DomainError, requireCondition } from "./errors.ts";
import { rejectSecrets } from "./validation.ts";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_SECTIONS = 80;
const MAX_CANDIDATES = 40;
const allowed = new Set([".md", ".txt", ".docx", ".pdf"]);

export type DocumentSection = { location: string; text: string };
export type DocumentAssessment = {
  sha256: string;
  format: "md" | "txt" | "docx" | "pdf";
  sections_scanned: number;
  truncated: boolean;
  candidates: ReturnType<InterviewService["analyzeAnswer"]>["candidates"];
  contradictions: ReturnType<InterviewService["analyzeAnswer"]>["contradictions"];
  review_decisions: ReturnType<InterviewService["analyzeAnswer"]>["review_decisions"];
  ambiguities: {terms: string[]; question: string; source_refs: SourceRef[]}[];
  next_questions: ReturnType<InterviewService["questions"]>;
  warning: string;
};

function sectionsFromLines(text: string): DocumentSection[] {
  return text.split(/\r?\n/).map((line, index) => ({location: `line:${index + 1}`, text: line.trim()}))
    .filter((line) => line.text.length > 0);
}
function sectionsFromParagraphs(text: string): DocumentSection[] {
  return text.split(/\n\s*\n/).map((part, index) => ({location: `paragraph:${index + 1}`, text: part.trim()}))
    .filter((part) => part.text.length > 0);
}

export async function readDesignDocument(filePath: string): Promise<{
  sha256: string; format: DocumentAssessment["format"]; sections: DocumentSection[]; truncated: boolean;
}> {
  requireCondition(isAbsolute(filePath) && !filePath.startsWith("\\\\") && !filePath.startsWith("//"),
    "DOCUMENT_PATH_INVALID");
  const path = await realpath(filePath);
  requireCondition(!path.startsWith("\\\\") && !path.startsWith("//"), "DOCUMENT_PATH_INVALID");
  const ext = extname(path).toLowerCase();
  requireCondition(allowed.has(ext), "DOCUMENT_FORMAT_UNSUPPORTED");
  const info = await stat(path);
  requireCondition(info.isFile() && info.size > 0 && info.size <= MAX_BYTES, "DOCUMENT_SIZE_INVALID");
  const bytes = await readFile(path);
  requireCondition(bytes.length <= MAX_BYTES, "DOCUMENT_SIZE_INVALID");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const format = ext.slice(1) as DocumentAssessment["format"];
  let sections: DocumentSection[];
  if (ext === ".md" || ext === ".txt") {
    let decoded: string;
    try { decoded = new TextDecoder("utf-8", {fatal: true}).decode(bytes); }
    catch { throw new DomainError("DOCUMENT_ENCODING_UNSUPPORTED"); }
    sections = sectionsFromLines(decoded);
  } else if (ext === ".docx") {
    sections = sectionsFromParagraphs(await extractDocxText(bytes));
  } else {
    const pdfBuild = createRequire(import.meta.url).resolve("pdfjs-dist/legacy/build/pdf.mjs");
    const standardFontDataUrl = join(dirname(pdfBuild), "..", "..", "standard_fonts").replaceAll("\\", "/") + "/";
    const task = getDocument({data: new Uint8Array(bytes), standardFontDataUrl});
    const pdf = await task.promise;
    const pages: DocumentSection[] = [];
    try {
      requireCondition(pdf.numPages <= 80, "DOCUMENT_PAGE_LIMIT");
      for (let number = 1; number <= pdf.numPages; number++) {
        const page = await pdf.getPage(number);
        const content = await page.getTextContent();
        const text = content.items.map((item) => "str" in item ? item.str : "").join(" ").trim();
        if (text) pages.push({location: `page:${number}`, text});
      }
    } finally { await task.destroy(); }
    sections = pages;
  }
  requireCondition(sections.length > 0, "DOCUMENT_TEXT_UNAVAILABLE");
  return {sha256, format, sections: sections.slice(0, MAX_SECTIONS), truncated: sections.length > MAX_SECTIONS};
}

export function assessDesignDocument(
  document: Awaited<ReturnType<typeof readDesignDocument>>, project: Project,
): DocumentAssessment {
  const interview = new InterviewService();
  const candidates: DocumentAssessment["candidates"] = [];
  const contradictions: DocumentAssessment["contradictions"] = [];
  const reviewDecisions: DocumentAssessment["review_decisions"] = [];
  const seen = new Set(project.items.map((item) => item.id));
  let truncated = document.truncated;
  for (const section of document.sections) {
    if (candidates.length >= MAX_CANDIDATES) { truncated = true; break; }
    const sourceRef: SourceRef = {type: "document", ref: `sha256:${document.sha256}#${section.location}`};
    rejectSecrets(section.text);
    const analysis = interview.analyzeAnswer(project, section.text.slice(0, 8000), sourceRef);
    for (const candidate of analysis.candidates) {
      if (candidates.length >= MAX_CANDIDATES) { truncated = true; break; }
      let id = candidate.id;
      let suffix = 1;
      while (seen.has(id)) id = `${candidate.id}-${++suffix}`;
      seen.add(id);
      candidates.push({...candidate, id});
    }
    contradictions.push(...analysis.contradictions);
    for (const decision of analysis.review_decisions) {
      if (reviewDecisions.length >= 8) break;
      if (!reviewDecisions.some((item) => item.id === decision.id)) reviewDecisions.push(decision);
    }
  }
  const terms = ["用户", "玩家", "主角", "user", "player", "protagonist"];
  const mentions = terms.filter((term) => candidates.some((item) => item.statement.toLowerCase().includes(term)));
  const ambiguities = mentions.length > 1 ? [{
    terms: mentions, question: "Do these names identify the same person, different people, or a control/role relationship?",
    source_refs: candidates.filter((item) => mentions.some((term) => item.statement.toLowerCase().includes(term)))
      .flatMap((item) => item.source_refs).slice(0, 10),
  }] : [];
  return {sha256: document.sha256, format: document.format, sections_scanned: document.sections.length,
    truncated, candidates, contradictions: contradictions.slice(0, 40), review_decisions: reviewDecisions, ambiguities,
    next_questions: interview.questions(project), warning:
      "Document claims are untrusted PROPOSED data. Review each source and resolve material gaps, relationships and conflicts before confirmation or readiness."};
}
