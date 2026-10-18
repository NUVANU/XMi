import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {z} from "zod";
import {ProjectService, replay} from "../../packages/core/project-service.ts";
import {requireCondition} from "../../packages/core/errors.ts";
import {fingerprint, validateProject} from "../../packages/core/validation.ts";
import {SqliteProjectStore} from "../../packages/storage/sqlite.ts";
import {atomicProjectText, boundedProjectJson, ensureProjectDirectory, projectDirectory, projectPath} from "../../packages/storage/project-files.ts";
import {contextCurrent, markContextUpdating, projectGuide, writeProjectContext} from "../../packages/storage/project-context.ts";

const manifestSchema = z.strictObject({schema_version: z.literal("XMI-LOCAL-PROJECT/1"),
  project_id: z.string().regex(/^XMI-[A-Z0-9-]+$/u).nullable(), create_hash: z.string().regex(/^[a-f0-9]{64}$/u),
  database: z.literal("xmi-state.sqlite")});
export type LocalProject = {root: string; id: string; database: string; store: SqliteProjectStore; service: ProjectService; close: () => void};
export type ProjectStorageStatus = {project_directory: string; database_relative_path: ".xmi/xmi-state.sqlite";
  context_status: "CURRENT" | "STALE"; canonical_version: number; reason: string};

/** An index of locations only. Legacy canonical databases are never moved here. */
export class ProjectWorkspaces {
  private indexPath: string;
  private locations = new Map<string, string>();
  constructor(indexPath: string) {this.indexPath = indexPath;}
  private index(create = false) {
    if (!create && !existsSync(this.indexPath)) return undefined;
    mkdirSync(dirname(this.indexPath), {recursive: true}); const db = new DatabaseSync(this.indexPath, {timeout: 5000});
    try {
      const version = db.prepare("PRAGMA user_version").get()!.user_version;
      if (version === 0) {
        requireCondition(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().length === 0,
          "PROJECT_REGISTRY_INVALID");
        db.exec("BEGIN IMMEDIATE; CREATE TABLE locations (project_id TEXT PRIMARY KEY, root TEXT NOT NULL); PRAGMA user_version=201; COMMIT;");
      } else requireCondition(version === 201, "PROJECT_REGISTRY_INVALID");
      return db;
    } catch (error) {db.close(); throw error;}
  }
  private previous(id: string) {
    const db = this.index();
    try {return (db?.prepare("SELECT root FROM locations WHERE project_id=?").get(id)?.root as string | undefined) ?? this.locations.get(id);}
    finally {db?.close();}
  }
  private checkLocation(id: string, root: string) {
    const old = this.previous(id);
    requireCondition(!old || old === root || !existsSync(old), "PROJECT_COPY_CONFLICT");
  }
  plan(path?: string) {
    requireCondition(path, "PROJECT_DIRECTORY_REQUIRED"); const root = projectDirectory(path);
    if (existsSync(root)) {
      const directory = projectPath(root, ".xmi"), guide = projectPath(root, "XMI-START-HERE.md");
      if (existsSync(directory)) requireCondition(existsSync(projectPath(root, ".xmi", "project.json")), "PROJECT_FILE_CONFLICT");
      else requireCondition(!existsSync(guide), "PROJECT_FILE_CONFLICT");
    }
    return {root, database: join(root, ".xmi", "xmi-state.sqlite")};
  }
  create(path: string, input: unknown) {
    const plan = this.plan(path);
    requireCondition(plan.root === path, "PROJECT_DIRECTORY_CHANGED");
    const root = ensureProjectDirectory(plan.root), folder = projectPath(root, ".xmi");
    const pathToManifest = join(folder, "project.json"), hash = fingerprint({input, actor: "agent"});
    if (!existsSync(folder)) {
      mkdirSync(folder);
      writeFileSync(pathToManifest, JSON.stringify({schema_version: "XMI-LOCAL-PROJECT/1", project_id: null,
        create_hash: hash, database: "xmi-state.sqlite"}) + "\n", {flag: "wx", mode: 0o600});
    }
    const manifestPath = projectPath(root, ".xmi", "project.json"), manifest = manifestSchema.parse(boundedProjectJson(manifestPath));
    requireCondition(manifest.create_hash === hash, "PROJECT_DIRECTORY_OCCUPIED");
    const guide = projectPath(root, "XMI-START-HERE.md");
    requireCondition(!existsSync(guide) || manifest.project_id !== null && readFileSync(guide, "utf8") === projectGuide(manifest.project_id), "PROJECT_FILE_CONFLICT");
    const dbPath = projectPath(root, ".xmi", manifest.database), store = new SqliteProjectStore(dbPath, root), service = new ProjectService(store);
    try {
      requireCondition(store.projectIds().length <= 1 && (!manifest.project_id || store.projectIds()[0] === manifest.project_id), "PROJECT_IDENTITY_MISMATCH");
      // The initial UPDATING marker precedes the first canonical write.
      markContextUpdating(root, manifest.project_id ?? "INITIALIZING");
      const p = service.create(input, "agent"); requireCondition(!manifest.project_id || manifest.project_id === p.project_id, "PROJECT_IDENTITY_MISMATCH");
      atomicProjectText(manifestPath, JSON.stringify({...manifest, project_id: p.project_id}) + "\n");
      if (!existsSync(guide)) writeFileSync(guide, projectGuide(p.project_id), {flag: "wx", mode: 0o600});
      this.remember(p.project_id, root); return p;
    } finally {store.close();}
  }
  remember(id: string, root: string) {
    this.checkLocation(id, root); const db = this.index(true)!;
    try {
      db.exec("BEGIN IMMEDIATE"); const prior = db.prepare("SELECT root FROM locations WHERE project_id=?").get(id)?.root as string | undefined;
      requireCondition(!prior || prior === root || !existsSync(prior), "PROJECT_COPY_CONFLICT");
      db.prepare("INSERT INTO locations VALUES (?,?) ON CONFLICT(project_id) DO UPDATE SET root=excluded.root").run(id, root); db.exec("COMMIT");
      this.locations.set(id, root);
    } finally {if (db.isTransaction) db.exec("ROLLBACK"); db.close();}
  }
  resolve(id: string, path?: string): LocalProject | undefined {
    const selected = path ? projectDirectory(path) : this.previous(id); if (!selected) return undefined;
    requireCondition(existsSync(selected), "PROJECT_DIRECTORY_NOT_FOUND"); const root = projectDirectory(selected);
    this.checkLocation(id, root);
    const manifest = manifestSchema.parse(boundedProjectJson(projectPath(root, ".xmi", "project.json")));
    requireCondition(manifest.project_id === id, "PROJECT_IDENTITY_MISMATCH");
    const database = projectPath(root, ".xmi", manifest.database); requireCondition(existsSync(database), "PROJECT_DATABASE_MISSING");
    const store = new SqliteProjectStore(database, root), service = new ProjectService(store);
    try {
      requireCondition(store.projectIds().length === 1 && store.projectIds()[0] === id, "PROJECT_IDENTITY_MISMATCH");
      const p = service.get(id); requireCondition(p.project_id === id, "PROJECT_IDENTITY_MISMATCH");
      store.transaction(tx => requireCondition(tx.events(id)[0]?.command.kind === "PROJECT_CREATED", "PROJECT_IDENTITY_MISMATCH"));
      this.locations.set(id, root); return {root, id, database, store, service, close: () => store.close()};
    } catch (error) {store.close(); throw error;}
  }
  sync(binding: LocalProject, remember = true): ProjectStorageStatus {
    try {
      if (remember) this.remember(binding.id, binding.root);
      binding.store.transaction(tx => {
        const events = tx.events(binding.id), p = replay(events);
        requireCondition(fingerprint(tx.snapshot(binding.id)) === fingerprint(p), "CORRUPT_SNAPSHOT");
        markContextUpdating(binding.root, binding.id);
        writeProjectContext(binding.root, p, events);
      });
    } catch {return this.status(binding, true);}
    return this.status(binding);
  }
  status(binding: LocalProject, failed = false): ProjectStorageStatus {
    return binding.store.transaction(tx => {
      const p = tx.snapshot(binding.id); validateProject(p);
      const current = !failed && contextCurrent(binding.root, p);
      return {project_directory: binding.root, database_relative_path: ".xmi/xmi-state.sqlite", context_status: current ? "CURRENT" : "STALE",
        canonical_version: p.model_version, reason: current ? "过程资料与当前权威版本一致；资料修改不代表产品确认。" :
          "权威数据可能已保存，但可读资料尚未完整同步。不要重建项目或更换重试键；使用 XMi 的过程资料重建命令恢复。"};
    });
  }
}
