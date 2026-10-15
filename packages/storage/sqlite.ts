import { DatabaseSync } from "node:sqlite";
import type { Checkpoint, DomainEvent, Project, Receipt } from "../shared-types/domain.ts";
import type { ProjectStore, StoreTransaction } from "./store.ts";
import { DomainError, requireCondition } from "../core/errors.ts";

export class SqliteProjectStore implements ProjectStore {
  private db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path, { timeout: 5000, enableForeignKeyConstraints: true });
    try {
      const version = Number(this.db.prepare("PRAGMA user_version").get()!.user_version);
      requireCondition(version === 0 || version === 1, "UNSUPPORTED_STORE_VERSION");
      if (version === 0) {
        const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
        requireCondition(tables.length === 0, "UNRECOGNIZED_DATABASE");
        this.db.exec(`BEGIN IMMEDIATE;
          CREATE TABLE snapshots (project_id TEXT PRIMARY KEY, body TEXT NOT NULL);
          CREATE TABLE events (project_id TEXT NOT NULL, version INTEGER NOT NULL, event_id TEXT UNIQUE NOT NULL,
            body TEXT NOT NULL, PRIMARY KEY(project_id, version));
          CREATE TABLE receipts (key TEXT PRIMARY KEY, body TEXT NOT NULL);
          CREATE TABLE checkpoints (project_id TEXT NOT NULL, version INTEGER NOT NULL, kind TEXT NOT NULL,
            body TEXT NOT NULL, PRIMARY KEY(project_id, version, kind));
          CREATE TRIGGER events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'IMMUTABLE_EVENT'); END;
          CREATE TRIGGER events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'IMMUTABLE_EVENT'); END;
          CREATE TRIGGER checkpoints_no_update BEFORE UPDATE ON checkpoints BEGIN SELECT RAISE(ABORT,'IMMUTABLE_CHECKPOINT'); END;
          CREATE TRIGGER checkpoints_no_delete BEFORE DELETE ON checkpoints BEGIN SELECT RAISE(ABORT,'IMMUTABLE_CHECKPOINT'); END;
          CREATE TRIGGER receipts_no_update BEFORE UPDATE ON receipts BEGIN SELECT RAISE(ABORT,'IMMUTABLE_RECEIPT'); END;
          CREATE TRIGGER receipts_no_delete BEFORE DELETE ON receipts BEGIN SELECT RAISE(ABORT,'IMMUTABLE_RECEIPT'); END;
          PRAGMA user_version=1;
          COMMIT;`);
      }
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  transaction<T>(work: (tx: StoreTransaction) => T): T {
    try {
      this.db.exec("BEGIN IMMEDIATE");
      const one = (sql: string, key: string): unknown | undefined => {
        const row = this.db.prepare(sql).get(key);
        return row ? JSON.parse(String(row.body)) : undefined;
      };
      const tx: StoreTransaction = {
        snapshot: (id) => one("SELECT body FROM snapshots WHERE project_id=?", id),
        save: (p: Project) => {
          this.db.prepare("INSERT INTO snapshots VALUES (?,?) ON CONFLICT(project_id) DO UPDATE SET body=excluded.body")
            .run(p.project_id, JSON.stringify(p));
        },
        events: (id) => this.db.prepare("SELECT body FROM events WHERE project_id=? ORDER BY version").all(id)
          .map((row) => JSON.parse(String(row.body)) as DomainEvent),
        append: (e) => {
          this.db.prepare("INSERT INTO events VALUES (?,?,?,?)").run(e.project_id, e.version, e.event_id, JSON.stringify(e));
        },
        receipt: (key) => one("SELECT body FROM receipts WHERE key=?", key) as Receipt | undefined,
        saveReceipt: (key, r) => { this.db.prepare("INSERT INTO receipts VALUES (?,?)").run(key, JSON.stringify(r)); },
        checkpoint: (c) => {
          const prior = this.db.prepare("SELECT body FROM checkpoints WHERE project_id=? AND version=? AND kind=?")
            .get(c.project_id, c.version, c.kind);
          if (prior) {
            requireCondition((JSON.parse(String(prior.body)) as Checkpoint).hash === c.hash, "CHECKPOINT_CONFLICT");
          } else {
            this.db.prepare("INSERT INTO checkpoints VALUES (?,?,?,?)").run(c.project_id, c.version, c.kind, JSON.stringify(c));
          }
        },
        checkpoints: (id) => this.db.prepare("SELECT body FROM checkpoints WHERE project_id=? ORDER BY version, kind").all(id)
          .map((row) => JSON.parse(String(row.body)) as Checkpoint),
      };
      const result = work(tx);
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      if (error instanceof DomainError) throw error;
      // Never include SQL, raw content or underlying SQLite messages in service errors.
      throw new DomainError("STORAGE_FAILURE");
    }
  }
  close(): void { this.db.close(); }
}
