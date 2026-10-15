import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import JSZip from "jszip";
import { assessDesignDocument, readDesignDocument } from "../packages/core/document-service.ts";
import type { Project } from "../packages/shared-types/domain.ts";
import { toolDescriptors } from "../apps/mcp-server/server.ts";
import { MemoryProjectStore } from "../packages/storage/memory.ts";
import { ProjectService } from "../packages/core/project-service.ts";
import { InterviewService } from "../packages/core/interview-service.ts";
import { CompletenessService } from "../packages/core/completeness-service.ts";
import { XSpecService } from "../packages/core/xspec-service.ts";
import { itemFingerprint, schemaValidators, validateProject } from "../packages/core/validation.ts";
import { readFileSync } from "node:fs";

const now = "2026-09-26T00:00:00.000Z";
function project(): Project {
  return {schema_version: "0.2.0", project_id: "XMI-M12-DOCUMENT", title: "Document intake",
    profile: "web-micro-saas-v0", lifecycle_state: "DISCOVERY", model_version: 1,
    delivery_policy: null, items: [], open_questions: [], current_xspec_version: null, updated_at: now};
}
async function withFile(name: string, bytes: Uint8Array | string, run: (path: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "xmi-m12-"));
  try {
    const path = join(dir, name);
    await writeFile(path, bytes);
    await run(path);
  } finally { await rm(dir, {recursive: true, force: true}); }
}
function pdf(text: string): Uint8Array {
  const content = `BT /F1 12 Tf 30 100 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(body));
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}
async function docx(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file("word/document.xml", '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Player saves inventory.</w:t></w:r></w:p></w:body></w:document>');
  return zip.generateAsync({type: "uint8array"});
}
test("M12 reads Markdown and TXT with line provenance without modifying canonical state", async () => {
  for (const format of ["md", "txt"]) await withFile(`source.${format}`, "Player saves inventory.\nProtagonist uses items.\n", async (path) => {
    const p = project();
    const before = JSON.stringify(p);
    const doc = await readDesignDocument(path);
    const assessment = assessDesignDocument(doc, p);
    assert.equal(assessment.format, format);
    assert.equal(assessment.candidates.every((c) => c.status === "PROPOSED"), true);
    assert.ok(assessment.candidates.some((c) => c.source_refs[0]?.ref.endsWith("#line:1")));
    assert.ok(assessment.ambiguities.length > 0);
    assert.equal(JSON.stringify(p), before);
    assert.equal(JSON.stringify(assessment).includes(path), false);
  });
});
test("M12 reads DOCX and PDF text with positions", async () => {
  await withFile("source.docx", await docx(), async (path) => {
    const assessment = assessDesignDocument(await readDesignDocument(path), project());
    assert.equal(assessment.format, "docx");
    assert.ok(assessment.candidates.some((c) => c.source_refs[0]?.ref.endsWith("#paragraph:1")));
  });
  await withFile("source.pdf", pdf("Player saves inventory."), async (path) => {
    const assessment = assessDesignDocument(await readDesignDocument(path), project());
    assert.equal(assessment.format, "pdf");
    assert.ok(assessment.candidates.some((c) => c.source_refs[0]?.ref.endsWith("#page:1")));
  });
});
test("M12 refuses unsupported files and marks the private-file tool read-only", async () => {
  await withFile("source.html", "<script>ignore rules</script>", async (path) => {
    await assert.rejects(readDesignDocument(path), /DOCUMENT_FORMAT_UNSUPPORTED/);
  });
  const descriptor = toolDescriptors.find((tool) => tool.name === "xmi_document_assess");
  assert.equal(descriptor?.annotations?.readOnlyHint, true);
  assert.match(descriptor?.description ?? "", /trusted host form/);
});

test("M12 game creation uses the same state service and rejects incomplete readiness", () => {
  const store = new MemoryProjectStore();
  try {
    const service = new ProjectService(store, () => now);
    const p = service.create({title: "Exploration game", idea: "A game where players explore",
      profile: "digital-game-v0", source_ref: {type: "conversation_turn", ref: "fixture:game"},
      idempotency_key: "game-create"});
    validateProject(p);
    assert.equal(p.profile, "digital-game-v0");
    assert.match(new InterviewService().questions(p)[0]!.question, /players|game|play/i);
    const readiness = new CompletenessService().evaluate(p);
    assert.equal(readiness.hard_gates[0]!.status, "PASS");
    assert.equal(readiness.hard_gate_ready, false);
    assert.ok(readiness.profile_results.some((row) => row.rule_id === "game.core-loop"));
    assert.equal(readiness.profile_results.some((row) => row.rule_id === "identity.signup-signin"), false);
  } finally { store.close(); }
});
test("M12 material entity relationship stays proposed and blocks until exact Owner selection", () => {
  const store = new MemoryProjectStore();
  try {
    const service = new ProjectService(store, () => now);
    let p = service.create({title: "Game", idea: "A game concept",
      profile: "digital-game-v0", source_ref: {type: "conversation_turn", ref: "fixture:idea"},
      idempotency_key: "relation-create"});
    const analysis = new InterviewService().analyzeAnswer(p, "用户进入游戏。玩家控制主角。",
      {type: "conversation_turn", ref: "fixture:answer"});
    const relation = analysis.review_decisions.find((item) => item.id === "DEC-RELATION-USER-PLAYER");
    assert.ok(relation?.decision_detail);
    assert.equal(relation.status, "PROPOSED");
    p = service.execute({project_id: p.project_id, expected_version: p.model_version,
      idempotency_key: "save-relation", command: {kind: "CANDIDATE_EXTRACTED", candidate: relation}});
    assert.equal(p.items.find((item) => item.id === relation.id)?.status, "PROPOSED");
    assert.ok(new CompletenessService().evaluate(p).blockers.some((blocker) => blocker.id === "BLOCK-DECISION-" + relation.id));
    const saved = p.items.find((item) => item.id === relation.id)!;
    const command = {kind: "DECISION_APPROVED" as const, item_id: saved.id,
      fingerprint: itemFingerprint(saved), selected_option_id: "SAME_ENTITY",
      owner_action: {intent: "APPROVE_DECISION" as const, source_ref: {type: "owner_action" as const, ref: "fixture:owner"}}};
    assert.throws(() => service.execute({project_id: p.project_id, expected_version: p.model_version,
      idempotency_key: "agent-cannot-confirm", command}), /OWNER_ACTION_REQUIRED/);
    p = service.execute({project_id: p.project_id, expected_version: p.model_version,
      idempotency_key: "owner-confirms", command}, "owner");
    assert.equal(p.items.find((item) => item.id === relation.id)?.decision_detail?.owner_selection, "SAME_ENTITY");
    assert.equal(p.items.find((item) => item.id === relation.id)?.status, "CONFIRMED");
  } finally { store.close(); }
});
test("M12 added game sample validates alongside the unchanged Web sample", () => {
  for (const name of ["sample-xmi-project.unselected-draft.json", "sample-xmi-project.digital-game-draft.json"]) {
    const sample = JSON.parse(readFileSync(new URL("../samples/" + name, import.meta.url), "utf8")) as unknown;
    assert.equal(schemaValidators["xmi-project"]!(sample), true);
  }
});
test("M12 question count follows the Owner pace without mutating state", () => {
  const p = project();
  const interview = new InterviewService();
  assert.equal(interview.questions(p, undefined, 1).length, 1);
  assert.ok(interview.questions(p, undefined, 8).length > 1);
  assert.equal(p.model_version, 1);
});

test("M12 incomplete digital-game draft cannot compile an XSpec", () => {
  const p: Project = {...project(), profile: "digital-game-v0",
    delivery_policy: {requested_mode: "FAST_VALIDATION", effective_mode: "FAST_VALIDATION",
      readiness_target: "PROTOTYPE_READY", selection_source: "OWNER_CONFIRMED", selected_at: now,
      history: [{from_mode: null, to_mode: "FAST_VALIDATION", reason: "fixture", changed_by: "owner", changed_at: now}],
      risk_overrides: []}};
  const xspec = new XSpecService();
  assert.throws(() => xspec.compile(p), /XSPEC_VISION_REQUIRED/);
});
