import {randomUUID} from "node:crypto";
import {existsSync, readFileSync, statSync} from "node:fs";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {z} from "zod";
import {boundedProjectJson, localProjectManifestSchema, projectDirectory, projectPath} from "../../packages/storage/project-files.ts";
import {readPending, sessionPattern, withReviewLock, writeRecord} from "./adapter.ts";
import {designScopeActive} from "./design-scope.ts";
import {codexReviewPaths} from "./host-paths.ts";
import {readSingle} from "./single.ts";
import {localXmemCompaction, xmemCheckpointSchema} from "./xmem-compaction.ts";
import type {CompactionCheckpoint, CompactionMemory} from "./xmem-compaction.ts";

const session = z.string().regex(sessionPattern);
const version = z.number().int().positive();
const projectId = z.string().regex(/^XMI-[A-Z0-9-]+$/u).max(100);
const reviewPhase = z.enum(["NONE", "PENDING", "GRANTED"]);
const eventSchema = z.object({
  hook_event_name: z.enum(["PreCompact", "PostCompact"]),
  session_id: session, turn_id: session, cwd: z.string().min(1).max(1000),
  trigger: z.enum(["manual", "auto"]),
});
const checkpointSchema = z.strictObject({
  record_id: z.string().uuid(), session_id: session, turn_id: session, trigger: eventSchema.shape.trigger,
  project_root: z.string().min(1).max(1000), project_id: projectId, model_version: version, pending_review: reviewPhase,
  phase: z.enum(["PREPARED", "READY", "CONSUMED"]),
  xmem: xmemCheckpointSchema.nullable(), xmem_restored: z.boolean(),
});
type Checkpoint = z.infer<typeof checkpointSchema>;

function projectHead(cwd: string) {
  const root = projectDirectory(cwd);
  const manifestPath = projectPath(root, ".xmi", "project.json");
  if (!existsSync(manifestPath)) return null;
  const manifest = localProjectManifestSchema.parse(boundedProjectJson(manifestPath));
  if (!manifest.project_id) return null;
  const db = new DatabaseSync(projectPath(root, ".xmi", manifest.database), {readOnly: true, timeout: 50});
  try {
    // A locator for recovery, not an approval or validation. XMi verifies the
    // full canonical event chain when the model performs the first resume read.
    const row = db.prepare(`SELECT json_extract(body, '$.project_id') AS project_id,
      json_extract(body, '$.model_version') AS model_version,
      (SELECT max(version) FROM events WHERE project_id=?) AS event_version
      FROM snapshots WHERE project_id=?`).get(manifest.project_id, manifest.project_id);
    const snapshot = z.object({project_id: projectId, model_version: version, event_version: version}).safeParse(row);
    if (!snapshot.success || snapshot.data.project_id !== manifest.project_id || snapshot.data.model_version !== snapshot.data.event_version) return null;
    return {project_root: root, project_id: manifest.project_id, model_version: snapshot.data.model_version};
  } finally {db.close();}
}

function reviewStatus(directory: string, sessionId: string, id: string): CompactionCheckpoint["pending_review"] {
  const one = readSingle(directory, sessionId), module = readPending(directory, sessionId);
  const states = [
    one?.project_id === id && one.session_id === sessionId ? one.status : null,
    module?.review.project_id === id && module.session_id === sessionId ? module.status : null,
  ];
  return states.includes("GRANTED") ? "GRANTED" : states.includes("PENDING") ? "PENDING" : "NONE";
}

function readCheckpoint(directory: string, sessionId: string) {
  const path = join(directory, sessionId + ".compaction.json");
  if (!existsSync(path) || statSync(path).size > 4096) return null;
  const result = checkpointSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  return result.success && result.data.session_id === sessionId ? result.data : null;
}

function saveCheckpoint(directory: string, record: Checkpoint) {
  writeRecord(directory, record.session_id + ".compaction", record);
}

export async function processCompaction(value: unknown, directory: string, memory: CompactionMemory) {
  const event = eventSchema.parse(value);
  const id = event.session_id;
  if (!designScopeActive(directory, id)) return;
  const checkpoint = withReviewLock(directory, id, () => {
    if (!designScopeActive(directory, id)) return null;
    const head = projectHead(event.cwd);
    if (!head) return null;
    if (event.hook_event_name === "PreCompact") {
      const record: Checkpoint = {...head, record_id: randomUUID(), session_id: id, turn_id: event.turn_id, trigger: event.trigger,
        phase: "PREPARED", xmem: null, xmem_restored: false, pending_review: reviewStatus(directory, id, head.project_id)};
      saveCheckpoint(directory, record);
      return record;
    }
    const prior = readCheckpoint(directory, id);
    // Repeated PostCompact delivery must not rewind an already consumed record.
    if (!prior || prior.phase !== "PREPARED" || prior.turn_id !== event.turn_id || prior.trigger !== event.trigger ||
      prior.project_root !== head.project_root || prior.project_id !== head.project_id) return null;
    const ready: Checkpoint = {...prior, phase: "READY", xmem: prior.model_version === head.model_version ? prior.xmem : null};
    saveCheckpoint(directory, ready);
    return ready;
  });
  if (!checkpoint) return;
  try {
    const saved = checkpoint.phase === "PREPARED" ? await memory.save(checkpoint) : null;
    const restored = !!checkpoint.xmem && await memory.restore(checkpoint, checkpoint.xmem);
    if (!saved && !restored) return;
    withReviewLock(directory, id, () => {
      const current = readCheckpoint(directory, id);
      if (current?.record_id === checkpoint.record_id && current.phase === checkpoint.phase && designScopeActive(directory, id))
        saveCheckpoint(directory, {...current, xmem: saved ?? current.xmem, xmem_restored: restored});
    });
  } catch { /* The local locator already exists; XMem is optional. */ }
}

// Called under the existing native user-prompt lock. It consumes a completed
// compaction locator without modifying a product or the native approval record.
export function consumeCompactionContext(directory: string, id: string, cwd?: string, exit = false) {
  try {
    const saved = readCheckpoint(directory, id);
    if (!saved) return "";
    if (exit && saved.phase !== "CONSUMED") {
      saveCheckpoint(directory, {...saved, phase: "CONSUMED"});
      return "";
    }
    if (!cwd || saved.phase !== "READY") return "";
    const head = projectHead(cwd);
    if (!head || head.project_id !== saved.project_id || head.project_root !== saved.project_root) return "";
    saveCheckpoint(directory, {...saved, phase: "CONSUMED"});
    const lookup = {schema_version: "0.1.0", project_id: head.project_id, project_directory: head.project_root,
      detail: "incremental", ...(saved.model_version <= head.model_version ? {since_version: saved.model_version} : {})};
    const source = saved.xmem_restored && saved.model_version === head.model_version ? "XMem 已校验恢复检查点。" : "使用 XMi 的本地续跑记录。";
    const pending = saved.pending_review === "NONE" ? "" : " 压缩前有确认清单，按本轮原生确认回执和当前状态处理。";
    return `XMi 已收到 Codex 原会话压缩完成事件。${source} 先用 xmi_project_resume 读取当前版本 ${JSON.stringify(lookup)}。复审与就绪按当前 XMi 回执。${pending}`;
  } catch {return "";}
}

export async function runCompactionHook() {
  try {
    let input = "";
    for await (const chunk of process.stdin) {
      input += String(chunk);
      if (Buffer.byteLength(input) > 64 * 1024) throw new Error("COMPACTION_EVENT_TOO_LARGE");
    }
    await processCompaction(JSON.parse(input), codexReviewPaths().reviews, localXmemCompaction);
  } catch {
    process.stdout.write(JSON.stringify({systemMessage: "XMi 压缩检查点未能核验。继续时从当前项目读取规格和确认状态。"}) + "\n");
  }
}
