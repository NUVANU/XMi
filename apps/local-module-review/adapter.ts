import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { z } from "zod";
import { randomUUID, createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { Project } from "../../packages/shared-types/domain.ts";
import type { ProjectService } from "../../packages/core/project-service.ts";
import { sourceSchema } from "../../packages/shared-types/domain.ts";
import { fingerprint } from "../../packages/core/validation.ts";
import { moduleConfirmationSchema, prepareModuleConfirmation } from "../../packages/core/module-confirmation.ts";
import { requireCondition } from "../../packages/core/errors.ts";

export const sessionPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
// OS-managed SQLite lock releases on process exit. No grant or product data is
// stored here, and a crashed process cannot leave a stale PID lock to bypass.
export function withReviewLock<T>(directory: string, session: string, work: () => T): T {
  requireCondition(sessionPattern.test(session), "CHAT_CONFIRMATION_UNAVAILABLE");
  mkdirSync(directory, {recursive: true});
  const lock = new DatabaseSync(join(directory, session + ".lock.sqlite"), {timeout: 0});
  try {
    try { lock.exec("BEGIN IMMEDIATE"); } catch { requireCondition(false, "CHAT_REVIEW_BUSY"); }
    return work();
  } finally { if (lock.isTransaction) lock.exec("ROLLBACK"); lock.close(); }
}
export function nativeInterruption(directory: string, session: string): string {
  requireCondition(sessionPattern.test(session), "CHAT_CONFIRMATION_UNAVAILABLE");
  const path = join(directory, session + ".interrupted.json");
  if (!existsSync(path)) return "";
  return z.strictObject({nonce: z.string().uuid()}).parse(JSON.parse(readFileSync(path, "utf8"))).nonce;
}
export const pendingSchema = z.strictObject({session_id: z.string().regex(sessionPattern),
  db_path: z.string().refine(path => isAbsolute(path) && !path.startsWith("\\\\") && !path.startsWith("//")), review: moduleConfirmationSchema,
  review_text_hash: z.string().regex(/^[a-f0-9]{64}$/), review_text_length: z.number().int().positive().max(1024 * 1024),
  status: z.enum(["PENDING", "GRANTED", "CONFIRMED", "INVALIDATED", "FAILED"]), turn_id: z.string().optional(),
  grant_source_ref: sourceSchema.optional(), grant_binding_hash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  native_epoch: z.string().optional(),
  applied_version: z.number().int().positive().optional()});
export function moduleGrantBinding(record: z.infer<typeof pendingSchema>) {
  return fingerprint({session_id: record.session_id, db_path: record.db_path, review: record.review,
    review_text_hash: record.review_text_hash, review_text_length: record.review_text_length,
    turn_id: record.turn_id, grant_source_ref: record.grant_source_ref, native_epoch: record.native_epoch});
}
export function readPending(directory: string, session: string) {
  requireCondition(sessionPattern.test(session), "CHAT_CONFIRMATION_UNAVAILABLE");
  const path = join(directory, session + ".json");
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8");
  requireCondition(Buffer.byteLength(text, "utf8") <= 1024 * 1024, "INVALID_REVIEW_RECORD");
  return pendingSchema.parse(JSON.parse(text));
}
export function writeRecord(directory: string, name: string, value: unknown) {
  mkdirSync(directory, {recursive: true});
  const temporary = join(directory, name + "." + randomUUID() + ".tmp");
  writeFileSync(temporary, JSON.stringify(value) + "\n", {encoding: "utf8", mode: 0o600});
  // Windows can briefly deny replacement while another process scans the file.
  // Keep atomic replacement; never delete the previous record to force a write.
  const delays = [10, 25, 50, 100];
  try {
    for (let attempt = 0; ; attempt++) {
      try {renameSync(temporary, join(directory, name + ".json")); break;}
      catch (error) {
        if (process.platform !== "win32" || !["EPERM", "EACCES", "EBUSY"].includes((error as NodeJS.ErrnoException).code ?? "") || attempt >= delays.length) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delays[attempt]);
      }
    }
  } finally {
    // This task-owned temporary file can contain the pending product command.
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}
export function createModuleReviewHost(directory: string, session: string, dbPath: string, service?: ProjectService) {
  requireCondition(sessionPattern.test(session) && isAbsolute(dbPath) &&
    !dbPath.startsWith("\\\\") && !dbPath.startsWith("//"), "CHAT_CONFIRMATION_UNAVAILABLE");
  const ready = () => {
    try {
      const marker = JSON.parse(readFileSync(join(directory, session + ".host.json"), "utf8"));
      return marker.session_id === session && marker.event === "UserPromptSubmit";
    } catch { return false; }
  };
  return {
    prepare(project: Project, module: string) {
      return withReviewLock(directory, session, () => {
      requireCondition(ready(), "CHAT_CONFIRMATION_UNAVAILABLE");
      const result = prepareModuleConfirmation(project, module);
      const singlePath = join(directory, session + ".single.json");
      if (existsSync(singlePath)) {
        const text = readFileSync(singlePath, "utf8");
        requireCondition(Buffer.byteLength(text, "utf8") <= 1024 * 1024, "INVALID_REVIEW_RECORD");
        const single = JSON.parse(text);
        requireCondition(single.session_id === session, "INVALID_REVIEW_RECORD");
        if (["PENDING", "GRANTED"].includes(single.status)) writeRecord(directory, session + ".single", {...single, command: null, ...(single.action === "BATCH" ? {commands: null} : {}), status: "INVALIDATED"});
      }
      writeRecord(directory, session, {session_id: session, db_path: dbPath, review: result.review,
        review_text_hash: createHash("sha256").update(result.review_text).digest("hex"),
        review_text_length: result.review_text.length, status: "PENDING"});
      return {...result, host_ready: true};
      });
    },
    status(project: Project) {
      const pending = readPending(directory, session);
      const matching = pending?.db_path === dbPath && pending.review.project_id === project.project_id;
      const confirmedStillCurrent = pending?.review.items.every(member => project.items.some(item =>
        item.id === member.id && item.status === "CONFIRMED" && item.version === member.version + 1));
      const status = matching ? (pending.status === "PENDING" && pending.review.project_version !== project.model_version) ||
        (pending.status === "CONFIRMED" && !confirmedStillCurrent) ? "STALE" : pending.status : "NONE";
      return {project_id: project.project_id, model_version: project.model_version, host_ready: ready(),
        review_id: matching ? pending.review.review_id : null, status};
    },
    commit(projectId: string, expectedVersion: number, reviewId: string) {
      return withReviewLock(directory, session, () => {
      const record = readPending(directory, session);
      requireCondition(service && ready() && record?.session_id === session && record.db_path === dbPath &&
        record.review.project_id === projectId && record.review.review_id === reviewId, "CHAT_CONFIRMATION_UNAVAILABLE");
      requireCondition(record.review.project_version === expectedVersion, "VERSION_CONFLICT");
      requireCondition(["GRANTED", "CONFIRMED"].includes(record.status) && record.grant_source_ref?.type === "owner_action" &&
        record.turn_id && sessionPattern.test(record.turn_id) &&
        new RegExp("^codex-user-prompt:" + session + ":" + record.turn_id + ":[a-f0-9]{64}$").test(record.grant_source_ref.ref), "NATIVE_OWNER_REPLY_REQUIRED");
      requireCondition(record.grant_binding_hash === moduleGrantBinding(record), "FINGERPRINT_MISMATCH");
      const unchanged = () => requireCondition(record.native_epoch === nativeInterruption(directory, session), "NATIVE_OWNER_REPLY_EXPIRED");
      unchanged();
      // Preserve GRANTED on errors. Existing atomic domain receipts distinguish a
      // failed transaction from a committed batch whose sidecar write failed.
      const project = service.confirmModule(record.review, {type: "owner_action", ref: record.grant_source_ref.ref}, unchanged);
      writeRecord(directory, session, {...record, status: "CONFIRMED", applied_version: project.model_version});
      return {project_id: projectId, model_version: project.model_version,
        next_action: "Read canonical state to verify the displayed batch. A retry creates no additional events."};
      });
    },
  };
}

// A session selector routes a review; it is never Owner authority. Only the native
// hook's original next prompt and exact displayed-list check can adopt the review.
export function createModuleReviewRouter(directory: string, dbPath: string, launchSession?: string, service?: ProjectService) {
  const resolve = (session?: string) => {
    const selected = session ?? launchSession;
    requireCondition(selected && sessionPattern.test(selected), "CHAT_CONFIRMATION_SESSION_REQUIRED");
    return createModuleReviewHost(directory, selected, dbPath, service);
  };
  return {
    prepare(project: Project, module: string, session?: string) { return resolve(session).prepare(project, module); },
    status(project: Project, session?: string) { return resolve(session).status(project); },
    commit(projectId: string, expectedVersion: number, reviewId: string, session?: string) {
      return resolve(session).commit(projectId, expectedVersion, reviewId);
    },
  };
}
