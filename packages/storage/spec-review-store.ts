import {DatabaseSync} from "node:sqlite";
import {randomUUID} from "node:crypto";
import {isAbsolute} from "node:path";
import {DomainError, requireCondition} from "../core/errors.ts";
import {canonical, fingerprint} from "../core/validation.ts";
import {reviewBundleSchema, specReviewRunSchema, validateReviewBundle, validateReviewResponse} from "../core/spec-review-service.ts";
import type {ReviewBundle, SpecReviewRun, HostReviewBinding} from "../core/spec-review-service.ts";
import {validateDocumentReview} from "../core/document-review.ts";

export type StoredSpecReview = {bundle: ReviewBundle; run: SpecReviewRun; sequence: number};
const transitions: Record<SpecReviewRun["state"], SpecReviewRun["state"][]> = {
  PREPARED: ["RUNNING"], RUNNING: ["COMPLETED", "BLOCKING", "INCOMPLETE", "INTERRUPTED", "UNKNOWN"],
  COMPLETED: [], BLOCKING: [], INCOMPLETE: [], INTERRUPTED: [], UNKNOWN: [],
};
/** Separate format/database. Checksums detect corruption, not trusted reviewer identity. */
export class SqliteSpecReviewStore {
  private db: DatabaseSync;
  constructor(path: string) {
    requireCondition(isAbsolute(path) && !path.startsWith("\\\\") && !path.startsWith("//"), "SPEC_REVIEW_STORE_PATH_INVALID");
    this.db = new DatabaseSync(path, {timeout: 5000});
    try {
      const version = this.db.prepare("PRAGMA user_version").get()!.user_version;
      const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
      requireCondition(version === 109 || version === 110 || version === 0 && tables.length === 0, "SPEC_REVIEW_STORE_FORMAT_INVALID");
      // Format 110 adds HOST_AGENT run bodies; old TEST_ONLY bytes stay immutable.
      if (version === 109) this.db.exec("PRAGMA user_version=110");
      if (version === 0) this.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE review_bundles (id TEXT PRIMARY KEY, body TEXT NOT NULL);
        CREATE TABLE review_requests (project_id TEXT NOT NULL, request_key TEXT NOT NULL, run_id TEXT UNIQUE NOT NULL,
          bundle_id TEXT NOT NULL, PRIMARY KEY(project_id,request_key));
        CREATE TABLE review_events (run_id TEXT NOT NULL, seq INTEGER NOT NULL, body TEXT NOT NULL, previous_hash TEXT NOT NULL,
          hash TEXT NOT NULL, PRIMARY KEY(run_id,seq));
        CREATE TRIGGER bundle_no_update BEFORE UPDATE ON review_bundles BEGIN SELECT RAISE(ABORT,'IMMUTABLE_REVIEW'); END;
        CREATE TRIGGER bundle_no_delete BEFORE DELETE ON review_bundles BEGIN SELECT RAISE(ABORT,'IMMUTABLE_REVIEW'); END;
        CREATE TRIGGER request_no_update BEFORE UPDATE ON review_requests BEGIN SELECT RAISE(ABORT,'IMMUTABLE_REVIEW'); END;
        CREATE TRIGGER request_no_delete BEFORE DELETE ON review_requests BEGIN SELECT RAISE(ABORT,'IMMUTABLE_REVIEW'); END;
        CREATE TRIGGER review_no_update BEFORE UPDATE ON review_events BEGIN SELECT RAISE(ABORT,'IMMUTABLE_REVIEW'); END;
        CREATE TRIGGER review_no_delete BEFORE DELETE ON review_events BEGIN SELECT RAISE(ABORT,'IMMUTABLE_REVIEW'); END;
        PRAGMA user_version=110; COMMIT;`);
    } catch (error) {this.db.close(); throw error instanceof DomainError ? error : new DomainError("SPEC_REVIEW_STORAGE_FAILURE");}
  }
  private transaction<T>(work: () => T): T {
    try {this.db.exec("BEGIN IMMEDIATE"); const result = work(); this.db.exec("COMMIT"); return result;}
    catch (error) {if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw error instanceof DomainError ? error : new DomainError("SPEC_REVIEW_STORAGE_FAILURE");}
  }
  private parse(body: unknown): unknown {
    requireCondition(typeof body === "string" && Buffer.byteLength(body) <= 8 * 1024 * 1024, "SPEC_REVIEW_STORE_CORRUPT");
    try {return JSON.parse(body);} catch {throw new DomainError("SPEC_REVIEW_STORE_CORRUPT");}
  }
  get(projectId: string, runId: string): StoredSpecReview | null {
    const request = this.db.prepare("SELECT * FROM review_requests WHERE project_id=? AND run_id=?").get(projectId, runId);
    if (!request) return null;
    const stored = this.db.prepare("SELECT body FROM review_bundles WHERE id=?").get(String(request.bundle_id));
    requireCondition(stored, "SPEC_REVIEW_STORE_CORRUPT");
    const parsed = reviewBundleSchema.safeParse(this.parse(stored.body));
    requireCondition(parsed.success, "SPEC_REVIEW_STORE_CORRUPT");
    const bundle = parsed.data, {bundle_sha256, ...body} = bundle;
    requireCondition(bundle_sha256 === request.bundle_id && fingerprint(body) === bundle_sha256 && bundle.project_id === projectId, "SPEC_REVIEW_STORE_CORRUPT");
    const events = this.db.prepare("SELECT * FROM review_events WHERE run_id=? ORDER BY seq").all(runId);
    requireCondition(events.length > 0 && events.length <= 3, "SPEC_REVIEW_STORE_CORRUPT");
    let previous = "0".repeat(64), last: SpecReviewRun | undefined;
    for (const [index, event] of events.entries()) {
      const check = specReviewRunSchema.safeParse(this.parse(event.body));
      requireCondition(check.success, "SPEC_REVIEW_STORE_CORRUPT"); const run = check.data;
      requireCondition(event.seq === index + 1 && event.previous_hash === previous && event.hash === fingerprint({run_id: runId, seq: event.seq, previous_hash: previous, run}), "SPEC_REVIEW_STORE_CORRUPT");
      requireCondition(run.run_id === runId && run.project_id === projectId && run.bundle_sha256 === bundle_sha256 &&
        run.product_model_version === bundle.product_model_version && run.policy_sha256 === bundle.policy_sha256 &&
        (last ? transitions[last.state].includes(run.state) && run.execution_kind === last.execution_kind &&
          canonical(run.host ?? null) === canonical(last.host ?? null) : run.state === "PREPARED"), "SPEC_REVIEW_STORE_CORRUPT");
      if (run.response) {
        const advisory = run.host?.purpose === "DOCUMENT_REVIEW";
        if (advisory) validateDocumentReview(bundle, run.host!.interview_module, run.response);
        else validateReviewResponse(bundle, run.response);
        const expected = advisory ? "COMPLETED" : run.response.schema_version === "XMI-REVIEW-RESPONSE/1" &&
          (run.response.unresolved_ids.length || run.response.findings.some(f => f.severity === "BLOCKING")) ? "BLOCKING" : "COMPLETED";
        requireCondition(run.state === expected, "SPEC_REVIEW_STORE_CORRUPT");
      } else requireCondition(run.state !== "COMPLETED" && run.state !== "BLOCKING", "SPEC_REVIEW_STORE_CORRUPT");
      previous = String(event.hash); last = run;
    }
    return {bundle, run: last!, sequence: events.length};
  }
  find(projectId: string, key: string): StoredSpecReview | null {
    const request = this.db.prepare("SELECT run_id FROM review_requests WHERE project_id=? AND request_key=?").get(projectId, key);
    return request ? this.get(projectId, String(request.run_id)) : null;
  }
  latestDocumentReview(projectId: string): StoredSpecReview | null {
    // Module advice and synthetic/legacy reviews cannot stand for the full spec.
    const row = this.db.prepare(`SELECT r.run_id FROM review_requests r JOIN review_events e ON e.run_id=r.run_id AND e.seq=1
      WHERE r.project_id=? AND json_extract(e.body,'$.host.purpose')='DOCUMENT_REVIEW'
      AND json_extract(e.body,'$.host.interview_module') IS NULL ORDER BY r.rowid DESC LIMIT 1`).get(projectId);
    return row ? this.get(projectId, String(row.run_id)) : null;
  }
  prepare(bundle: ReviewBundle, key: string, host?: HostReviewBinding): StoredSpecReview {
    validateReviewBundle(bundle);
    requireCondition(key.length > 0 && key.length <= 100, "SPEC_REVIEW_REQUEST_INVALID");
    requireCondition(Buffer.byteLength(canonical(bundle)) <= 8 * 1024 * 1024, "SPEC_REVIEW_INPUT_TOO_LARGE");
    return this.transaction(() => {
      const existing = this.find(bundle.project_id, key);
      if (existing) {requireCondition(existing.bundle.bundle_sha256 === bundle.bundle_sha256 &&
        existing.run.execution_kind === (host ? "HOST_AGENT" : "TEST_ONLY"), "IDEMPOTENCY_KEY_REUSED"); return existing;}
      this.db.prepare("INSERT OR IGNORE INTO review_bundles VALUES (?,?)").run(bundle.bundle_sha256, canonical(bundle));
      const run: SpecReviewRun = {schema_version: "XMI-REVIEW-RUN/1", run_id: randomUUID(), project_id: bundle.project_id,
        product_model_version: bundle.product_model_version, bundle_sha256: bundle.bundle_sha256, policy_sha256: bundle.policy_sha256,
        execution_kind: host ? "HOST_AGENT" : "TEST_ONLY", ...(host ? {host} : {}), gate_eligible: false,
        state: "PREPARED", response: null, reason: host ? "AWAITING_NATIVE_HOST_AGENT" : "SYNTHETIC_EXECUTION_ONLY", recorded_at: new Date().toISOString()};
      this.db.prepare("INSERT INTO review_requests VALUES (?,?,?,?)").run(bundle.project_id, key, run.run_id, bundle.bundle_sha256);
      this.insert(run, 1, "0".repeat(64));
      return this.get(bundle.project_id, run.run_id)!;
    });
  }
  private insert(run: SpecReviewRun, seq: number, previous_hash: string) {
    this.db.prepare("INSERT INTO review_events VALUES (?,?,?,?,?)").run(run.run_id, seq, canonical(run), previous_hash,
      fingerprint({run_id: run.run_id, seq, previous_hash, run}));
  }
  append(current: StoredSpecReview, next: Pick<SpecReviewRun, "state" | "response" | "reason">): StoredSpecReview {
    return this.transaction(() => {
      const actual = this.get(current.run.project_id, current.run.run_id);
      requireCondition(actual && actual.sequence === current.sequence && canonical(actual.run) === canonical(current.run), "SPEC_REVIEW_CONCURRENT_CHANGE");
      requireCondition(transitions[actual.run.state].includes(next.state), "SPEC_REVIEW_TRANSITION_INVALID");
      const run = specReviewRunSchema.parse({...actual.run, ...next, recorded_at: new Date().toISOString()});
      const previous = this.db.prepare("SELECT hash FROM review_events WHERE run_id=? AND seq=?").get(run.run_id, actual.sequence)!;
      this.insert(run, actual.sequence + 1, String(previous.hash));
      // Integrity/coverage/state checks occur before commit; failure rolls back.
      return this.get(run.project_id, run.run_id)!;
    });
  }
  close() {this.db.close();}
}
