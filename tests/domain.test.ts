import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { MemoryProjectStore } from "../packages/storage/memory.ts";
import { SqliteProjectStore } from "../packages/storage/sqlite.ts";
import type { ProjectStore, StoreTransaction } from "../packages/storage/store.ts";
import { ProjectService, replay } from "../packages/core/project-service.ts";
import { fingerprint, itemFingerprint, modeFingerprint, schemaValidators, validateProject } from "../packages/core/validation.ts";
import type { Actor, Command, Project, DeliveryMode } from "../packages/shared-types/domain.ts";

const at = "2026-09-15T08:00:00.000Z";
const source = { type: "conversation_turn", ref: "fixture:idea" } as const;
const owner = { intent: "CONFIRM", source_ref: { type: "owner_action", ref: "fixture:explicit-owner-action" } } as const;
const createInput = { title: "Local test", idea: "Track appointments", source_ref: source, idempotency_key: "create" };
function exec(service: ProjectService, p: Project, command: Command, actor: Actor = "agent", key = String(p.model_version)) {
  return service.execute({project_id: p.project_id, expected_version: p.model_version, idempotency_key: key, command}, actor);
}
function confirm(p: Project): Command {
  return {kind: "ITEM_CONFIRMED", item_id: p.items[0]!.id, fingerprint: itemFingerprint(p.items[0]!), owner_action: owner};
}
function mode(p: Project, value: DeliveryMode, upgrade = false): Command {
  return {kind: upgrade ? "DELIVERY_MODE_UPGRADED" : "DELIVERY_MODE_SELECTED", mode: value,
    reason: "Owner selected outcome", fingerprint: modeFingerprint(p, value, "Owner selected outcome"), owner_action: owner};
}
const candidate: Command = {kind: "CANDIDATE_EXTRACTED", candidate: {
  id: "REQ-001", type: "functional_requirement", statement: "List appointments",
  status: "INFERRED", source_refs: [source],
}};
function legacy(p: Project) {
  const value: Record<string, unknown> = {...p, schema_version: "0.1.0"};
  delete value.delivery_policy; delete value.xspec_id;
  return value;
}

for (const adapter of ["memory", "sqlite"] as const) {
  function fixture(t: TestContext) {
    const dir = mkdtempSync(join(tmpdir(), "xmi-m1-"));
    const store = adapter === "memory" ? new MemoryProjectStore() : new SqliteProjectStore(join(dir, "state.sqlite"));
    t.after(() => { store.close(); rmSync(dir, {recursive: true, force: true}); });
    return {store, service: new ProjectService(store, () => at)};
  }

  test(adapter + ": create/get/resume use canonical state, never implicit confirmation", (t) => {
    const {service} = fixture(t);
    const p = service.create(createInput);
    validateProject(p);
    assert.equal(p.items[0]!.status, "PROPOSED");
    assert.equal(p.delivery_policy, null);
    assert.match(p.xspec_id!, /^XSPEC-/);
    assert.deepEqual(service.get(p.project_id), p);
    const resumed = new ProjectService((fixture(t)).store); // independent empty store has no transcript fallback
    assert.throws(() => resumed.get(p.project_id), /PROJECT_NOT_FOUND/);
    assert.deepEqual(service.resume(p.project_id).project, p);
    assert.equal(service.resume(p.project_id).mode_selection_required, true);
    assert.equal(service.history(p.project_id).length, 1);
    assert.throws(() => service.create({...createInput, status: "CONFIRMED"}), /INVALID_COMMAND/);
    assert.throws(() => exec(service, p, {...candidate, candidate: {...candidate.candidate, status: "CONFIRMED"}} as unknown as Command), /INVALID_COMMAND/);
    assert.throws(() => exec(service, p, {...candidate, candidate: {...candidate.candidate, source_refs: []}}), /INVALID_COMMAND/);
    assert.equal(service.get(p.project_id).model_version, 1);
  });

  test(adapter + ": exact Owner action, fingerprint and current version required", (t) => {
    const {service} = fixture(t);
    const p = service.create(createInput);
    const command = confirm(p);
    assert.throws(() => exec(service, p, command), /OWNER_ACTION_REQUIRED/);
    assert.throws(() => exec(service, p, {...command, owner_action: undefined} as unknown as Command, "owner"), /INVALID_COMMAND/);
    assert.throws(() => exec(service, p, {...command, fingerprint: "0".repeat(64)} as Command, "owner"), /FINGERPRINT_MISMATCH/);
    const confirmed = exec(service, p, command, "owner");
    assert.equal(confirmed.items[0]!.status, "CONFIRMED");
    assert.equal(confirmed.items[0]!.confirmed_by, "owner");
    assert.deepEqual(confirmed.items[0]!.source_refs, [source, owner.source_ref]);
    assert.equal(service.history(p.project_id)[1]!.command.kind, "ITEM_CONFIRMED");
    assert.throws(() => exec(service, p, candidate, "agent", "stale"), (e: unknown) =>
      e instanceof Error && "current_version" in e && e.current_version === 2 && e.message === "VERSION_CONFLICT");
    assert.throws(() => exec(service, confirmed, confirm(p), "owner"), /FINGERPRINT_MISMATCH/);
    const rejected = exec(service, confirmed, {kind: "ITEM_REJECTED", item_id: confirmed.items[0]!.id,
      fingerprint: itemFingerprint(confirmed.items[0]!), owner_action: {...owner, intent: "REJECT"}}, "owner");
    assert.equal(rejected.items[0]!.status, "REJECTED");
    assert.equal(rejected.items[0]!.confirmed_by, undefined);
    assert.equal(service.history(p.project_id)[1]!.command.kind, "ITEM_CONFIRMED");
  });

  test(adapter + ": idempotency returns original version; key reuse cannot change a decision", (t) => {
    const {service} = fixture(t);
    const p = service.create(createInput);
    assert.deepEqual(service.create(createInput), p);
    const selected = exec(service, p, mode(p, "FAST_VALIDATION"), "owner", "select");
    exec(service, selected, candidate);
    assert.deepEqual(exec(service, p, mode(p, "FAST_VALIDATION"), "owner", "select"), selected);
    assert.throws(() => exec(service, p, mode(p, "PRODUCT_GRADE"), "owner", "select"), /IDEMPOTENCY_KEY_REUSED/);
    assert.throws(() => service.create({...createInput, title: "different"}), /IDEMPOTENCY_KEY_REUSED/);
    assert.equal(service.history(p.project_id).length, 3);
  });

  test(adapter + ": all modes retain confirmation and immutable checkpoints through upgrade", (t) => {
    const {service} = fixture(t);
    for (const [i, value] of (["FAST_VALIDATION", "FAST_DEVELOPMENT", "PRODUCT_GRADE"] as const).entries()) {
      let p = service.create({...createInput, idempotency_key: "mode-" + i});
      assert.throws(() => exec(service, p, mode(p, value)), /OWNER_ACTION_REQUIRED/);
      p = exec(service, p, confirm(p), "owner");
      p = exec(service, p, mode(p, value), "owner");
      assert.equal(p.delivery_policy!.readiness_target, ["PROTOTYPE_READY", "BUILD_READY", "PRODUCT_SPEC_READY"][i]);
      assert.notEqual(p.lifecycle_state, "READY_FOR_XDEV");
      service.checkpoint(p.project_id);
      service.checkpoint(p.project_id);
      const before = structuredClone(service.checkpoints(p.project_id));
      if (value !== "PRODUCT_GRADE") {
        assert.throws(() => exec(service, p, mode(p, "PRODUCT_GRADE"), "owner"), /MODE_EVENT_MISMATCH/);
        const next = exec(service, p, mode(p, "PRODUCT_GRADE", true), "owner");
        assert.deepEqual(next.items, p.items);
        assert.equal(next.xspec_id, p.xspec_id);
        assert.equal(next.delivery_policy!.history.length, 2);
        assert.equal(service.history(p.project_id).at(-1)!.command.kind, "DELIVERY_MODE_UPGRADED");
      }
      assert.deepEqual(service.checkpoints(p.project_id), before);
      assert.throws(() => validateProject({...p, delivery_policy: null, lifecycle_state: "READY_FOR_XDEV"}), /INVALID_PROJECT_SCHEMA/);
    }
  });

  test(adapter + ": failed transaction rolls back event, snapshot, receipt and checkpoint", (t) => {
    const {store, service} = fixture(t);
    const p = service.create(createInput);
    let fail = true;
    const failing: ProjectStore = {
      close() {},
      transaction<T>(work: (tx: StoreTransaction) => T) {
        return store.transaction((tx) => work({...tx, save: (next) => {
          tx.save(next); if (fail) throw new Error("injected");
        }}));
      },
    };
    const writer = new ProjectService(failing, () => at);
    assert.throws(() => exec(writer, p, candidate));
    assert.deepEqual(service.get(p.project_id), p);
    assert.equal(service.history(p.project_id).length, 1);
    fail = false;
    assert.equal(exec(writer, p, candidate).model_version, 2);
    const snapshot = legacy({...p, project_id: "XMI-LEGACY"});
    const request = {project_id: "XMI-LEGACY", expected_version: 0, idempotency_key: "import",
      command: {kind: "SCHEMA_MIGRATED", legacy_snapshot: snapshot, confirmation_events: [],
        source_ref: {type: "import", ref: "fixture:legacy"}}};
    fail = true;
    assert.throws(() => writer.execute(request, "owner"));
    assert.deepEqual(service.checkpoints("XMI-LEGACY"), []);
    assert.throws(() => service.get("XMI-LEGACY"), /PROJECT_NOT_FOUND/);
    fail = false;
    assert.equal(writer.execute(request, "owner").schema_version, "0.2.0");
  });

  test(adapter + ": legacy migration preserves source and refuses unsupported or fabricated confirmations", (t) => {
    const {service} = fixture(t);
    let p = service.create(createInput);
    p = exec(service, p, confirm(p), "owner");
    const snapshot = legacy({...p, project_id: "XMI-IMPORTED"});
    const receipt = {event_id: "legacy-owner-event", item_id: p.items[0]!.id, item_version: p.items[0]!.version,
      fingerprint: itemFingerprint(p.items[0]!), actor: "owner", confirmed_at: at, source_ref: owner.source_ref};
    const request = {project_id: "XMI-IMPORTED", expected_version: 0, idempotency_key: "migration",
      command: {kind: "SCHEMA_MIGRATED", legacy_snapshot: snapshot, confirmation_events: [receipt],
        source_ref: {type: "import", ref: "fixture:legacy"}}};
    assert.throws(() => service.execute(request), /OWNER_MIGRATION_REQUIRED/);
    assert.throws(() => service.execute({...request, command: {...request.command, confirmation_events: []}}, "owner"), /LEGACY_CONFIRMATION_MISMATCH/);
    assert.throws(() => service.execute({...request, command: {...request.command, confirmation_events: [{...receipt, fingerprint: "0".repeat(64)}]}}, "owner"), /LEGACY_CONFIRMATION_REQUIRED/);
    assert.throws(() => service.execute({...request, command: {...request.command, legacy_snapshot: {...snapshot, schema_version: "9.0"}}}, "owner"), /UNSUPPORTED_SCHEMA_VERSION/);
    const migrated = service.execute(request, "owner");
    assert.equal(migrated.model_version, p.model_version + 1);
    assert.equal(migrated.delivery_policy, null);
    assert.equal(migrated.lifecycle_state, "AMENDMENT_REQUIRED");
    assert.deepEqual(migrated.items, p.items);
    assert.deepEqual(service.checkpoints(migrated.project_id)[0]!.content, snapshot);
    assert.deepEqual(service.execute(request, "owner"), migrated);
    assert.deepEqual(service.resume(migrated.project_id).project, migrated);
  });

  test(adapter + ": corrupt snapshot is detected and recovered only from validated history", (t) => {
    const {service, store} = fixture(t);
    const p = service.create(createInput);
    store.transaction((tx) => tx.save({...p, title: "corrupt cache"}));
    assert.throws(() => service.get(p.project_id), /CORRUPT_SNAPSHOT/);
    assert.throws(() => exec(service, p, candidate), /CORRUPT_SNAPSHOT/);
    assert.equal(service.resume(p.project_id).snapshot_consistent, false);
    assert.deepEqual(service.resume(p.project_id).project, p);
    assert.deepEqual(service.recoverSnapshot(p.project_id), p);
    assert.equal(service.history(p.project_id).length, 1);
    const history = service.history(p.project_id);
    history[0]!.command = {...history[0]!.command, title: "tampered"} as Command;
    assert.throws(() => replay(history), /CORRUPT_EVENT_CHAIN/);
    assert.deepEqual(service.get(p.project_id), p);
  });

  test(adapter + ": provenance, duplicate IDs and likely secrets fail without storage", (t) => {
    const {service} = fixture(t);
    const p = service.create(createInput);
    const next = exec(service, p, candidate);
    assert.throws(() => exec(service, next, candidate), /DUPLICATE_ITEM_ID/);
    assert.throws(() => service.create({...createInput, idempotency_key: "secret", idea: "api_key=not-a-real-secret"}), /POSSIBLE_SECRET_REMOVE_BEFORE_SAVING/);
    assert.equal(service.history(p.project_id).length, 2);
    assert.equal(next.items[1]!.status, "INFERRED");
  });
}

test("SQLite persists across processes and prevents history/checkpoint mutation", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "xmi-m1-persist-"));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const path = join(dir, "store.sqlite");
  const store = new SqliteProjectStore(path);
  const service = new ProjectService(store, () => at);
  const p = service.create(createInput);
  service.checkpoint(p.project_id);
  store.close();
  const script = `import {SqliteProjectStore} from "./packages/storage/sqlite.ts";
    import {ProjectService} from "./packages/core/project-service.ts";
    const s=new SqliteProjectStore(process.argv[1]);
    console.log(JSON.stringify(new ProjectService(s).resume(process.argv[2])));s.close();`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script, path, p.project_id], {encoding: "utf8"});
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).project, p);
  const db = new DatabaseSync(path);
  try {
    assert.throws(() => db.exec("UPDATE events SET body='{}'"), /IMMUTABLE_EVENT/);
    assert.throws(() => db.exec("DELETE FROM events"), /IMMUTABLE_EVENT/);
    assert.throws(() => db.exec("DELETE FROM checkpoints"), /IMMUTABLE_CHECKPOINT/);
    assert.throws(() => db.exec("DELETE FROM receipts"), /IMMUTABLE_RECEIPT/);
    db.exec("DELETE FROM snapshots");
  } finally { db.close(); }
  const reopened = new SqliteProjectStore(path);
  try {
    const resumed = new ProjectService(reopened);
    assert.equal(resumed.resume(p.project_id).snapshot_consistent, false);
    assert.throws(() => resumed.get(p.project_id), /CORRUPT_SNAPSHOT/);
    assert.deepEqual(resumed.recoverSnapshot(p.project_id), p);
  } finally { reopened.close(); }
});

test("SQLite rejects foreign and future databases without migration", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "xmi-m1-version-"));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  for (const [name, sql, error] of [
    ["foreign", "CREATE TABLE unrelated(value TEXT)", /UNRECOGNIZED_DATABASE/],
    ["future", "PRAGMA user_version=99", /UNSUPPORTED_STORE_VERSION/],
  ] as const) {
    const path = join(dir, name + ".sqlite");
    const db = new DatabaseSync(path); db.exec(sql); db.close();
    assert.throws(() => new SqliteProjectStore(path), error);
  }
});

test("independent SQLite clients reject stale writes and preserve idempotent receipt", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "xmi-m1-clients-"));
  const path = join(dir, "state.sqlite");
  const a = new SqliteProjectStore(path);
  const b = new SqliteProjectStore(path);
  t.after(() => { b.close(); a.close(); rmSync(dir, {recursive: true, force: true}); });
  const first = new ProjectService(a, () => at);
  const second = new ProjectService(b, () => at);
  const p = first.create(createInput);
  const stale = second.get(p.project_id);
  const next = exec(first, p, candidate, "agent", "shared-key");
  assert.throws(() => exec(second, stale, confirm(stale), "owner", "other-key"), /VERSION_CONFLICT/);
  assert.deepEqual(exec(second, stale, candidate, "agent", "shared-key"), next);
  assert.equal(second.history(p.project_id).length, 2);
});

test("all checked-in JSON samples validate using draft 2020-12 and formats", () => {
  for (const name of readdirSync("samples").filter((name) => name.endsWith(".json"))) {
    const schema = name.includes("xmi-project") ? "xmi-project" : name.includes("xspec") ? "xspec" : "readiness-report";
    const sample = JSON.parse(readFileSync(join("samples", name), "utf8"));
    assert.equal(schemaValidators[schema]!(sample), true, name + ": " + JSON.stringify(schemaValidators[schema]!.errors));
    assert.equal(schemaValidators[schema]!({...sample, schema_version: "unsupported"}), false, name);
  }
});

test("event replay rejects a forged CONFIRMED candidate even with a recomputed hash", () => {
  const store = new MemoryProjectStore();
  const service = new ProjectService(store, () => at);
  const p = service.create(createInput);
  exec(service, p, candidate);
  const events = service.history(p.project_id);
  const event = events[1]!;
  (event.command as Extract<Command, {kind: "CANDIDATE_EXTRACTED"}>).candidate.status = "CONFIRMED" as never;
  const body = {...event}; delete (body as Partial<typeof body>).hash;
  event.hash = fingerprint(body);
  assert.throws(() => replay(events), /INVALID_EVENT_SCHEMA/);
});
