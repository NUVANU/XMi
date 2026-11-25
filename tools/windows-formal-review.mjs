import {DatabaseSync} from "node:sqlite";
import {closeSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync} from "node:fs";
import {dirname, isAbsolute, join} from "node:path";
import {parseArgs} from "node:util";
import {replay} from "../packages/core/project-service.ts";
import {fingerprint} from "../packages/core/validation.ts";
import {requireCondition} from "../packages/core/errors.ts";
import {FormalReviewReceipts} from "../apps/mcp-server/formal-review-receipt.ts";
import {previousFormalBundles} from "../apps/mcp-server/prior-formal-policy.ts";
import {runWindowsFormalReview} from "../apps/mcp-server/windows-formal-review.ts";
import {requiresFormalReview} from "../apps/local-module-review/automatic-formal-review.ts";
import {AuditService} from "../packages/core/audit-service.ts";
import {XSpecService} from "../packages/core/xspec-service.ts";

const {values} = parseArgs({options: {
  ...Object.fromEntries(["project-db", "project-id", "version", "bundle", "installed-db", "work-dir", "codex", "config"]
    .map(name => [name, {type: "string"}])),
  "prepare-only": {type: "boolean"},
  "automatic": {type: "boolean"},
  "status-only": {type: "boolean"},
}});

const output = value => console.log(JSON.stringify(value));
const failureCode = error => error?.code ?? error?.name ?? "FORMAL_REVIEW_ERROR";
const readStatus = path => {
  try {return JSON.parse(readFileSync(path, "utf8"));}
  catch (error) {if (error?.code !== "ENOENT") throw error; return null;}
};

async function main() {
  const version = Number(values.version);
  const automatic = values.automatic, statusOnly = values["status-only"];
  const localPath = path => isAbsolute(path ?? "") && !/^[\\/]{2}/u.test(path);
  requireCondition(Number.isSafeInteger(version) && version > 0 && /^XMI-[A-Z0-9-]+$/u.test(values["project-id"] ?? "") &&
    ["project-db", "installed-db"].every(name => localPath(values[name])) &&
    [values["prepare-only"], automatic, statusOnly].filter(Boolean).length <= 1 &&
    (values["prepare-only"] || statusOnly || ((automatic && !values.bundle) || /^[a-f0-9]{64}$/u.test(values.bundle ?? "")) &&
      ["work-dir", "codex", "config"].every(name => localPath(values[name]))), "FORMAL_REVIEW_ARGUMENTS");
  const directory = join(dirname(values["installed-db"]), "xmi-formal-reviews");
  const receipts = new FormalReviewReceipts(directory);
  const readSnapshot = () => {
    const db = new DatabaseSync(values["project-db"], {readOnly: true});
    try {
      const row = db.prepare("SELECT body FROM snapshots WHERE project_id=?").get(values["project-id"]);
      requireCondition(row, "FORMAL_REVIEW_PROJECT_NOT_FOUND");
      const events = db.prepare("SELECT body FROM events WHERE project_id=? ORDER BY version").all(values["project-id"])
        .map(event => JSON.parse(event.body));
      const p = replay(events);
      requireCondition(fingerprint(p) === fingerprint(JSON.parse(row.body)), "CORRUPT_SNAPSHOT");
      requireCondition(p.project_id === values["project-id"] && p.model_version === version, "SPEC_REVIEW_STALE");
      return {project: p, events};
    } finally {db.close();}
  };
  const readCurrent = () => readSnapshot().project;
  const history = {history: () => readSnapshot().events};
  const subject = readSnapshot();
  const {bundle, recovery, receipt} = receipts.prepare(subject.project, {history: () => subject.events});
  const binding = {version, project_id: bundle.project_id, bundle_sha256: bundle.bundle_sha256, snapshot_sha256: bundle.model_sha256};
  if (values["prepare-only"]) {
    return output({state: "PREPARED", ...binding, material_bytes: bundle.material_bytes, ...recovery});
  }
  if (values.bundle) requireCondition(bundle.bundle_sha256 === values.bundle, "FORMAL_REVIEW_EXPECTED_BUNDLE");
  const completed = (record, reused, elapsedMs = 0) => ({state: "COMPLETED", ...binding, reused,
    run_id: record.binding.run_id, findings: record.response.findings.length,
    blocking: record.response.findings.filter(f => f.severity === "BLOCKING").length,
    unresolved: record.response.unresolved_ids.length, elapsed_ms: elapsedMs, model: record.native.model});
  if (receipt) {
    requireCondition(fingerprint(readCurrent()) === bundle.model_sha256, "SPEC_REVIEW_STALE");
    return output(completed(receipt, true));
  }
  const jobs = join(dirname(directory), "xmi-formal-review-jobs");
  const prefix = join(jobs, bundle.bundle_sha256), lock = prefix + ".lock", statePath = prefix + ".json";
  const prior = automatic || statusOnly ? previousFormalBundles(bundle) : [];
  const status = () => {
    const present = readStatus(statePath);
    if (present) return present;
    for (const earlier of prior) {
      const older = readStatus(join(jobs, earlier.bundle_sha256 + ".json"));
      if (older?.snapshot_sha256 === bundle.model_sha256 && older.version === version && older.project_id === bundle.project_id) return older;
    }
    return null;
  };
  const previous = status();
  if (statusOnly) {
    const state = previous?.state === "RUNNING" && Date.now() - previous.started_ms > 960_000
      ? {...previous, state: "UNVERIFIED", code: "FORMAL_REVIEW_DEADLINE"} : previous;
    return output(state ?? {state: "NOT_STARTED", ...binding});
  }
  if (automatic && (!requiresFormalReview(subject.project) || process.platform !== "win32")) {
    return output({state: "NOT_APPLICABLE", ...binding});
  }
  if (automatic && previous) return output(previous);
  mkdirSync(jobs, {recursive: true});
  try {closeSync(openSync(lock, "wx", 0o600));}
  catch (error) {
    if (error?.code !== "EEXIST") throw error;
    return output({state: "RUNNING", ...binding});
  }
  const save = result => {
    const temporary = statePath + ".tmp";
    writeFileSync(temporary, JSON.stringify(result), {mode: 0o600});
    renameSync(temporary, statePath);
  };
  try {
    const cached = receipts.read(readCurrent(), history);
    if (cached) return output(completed(cached, true));
    const claimed = status();
    if (automatic && claimed) return output(claimed);
    const started = Date.now();
    save({state: "RUNNING", ...binding, started_ms: started});
    if (automatic) {
      const xspec = new XSpecService(undefined, {history: () => subject.events});
      if (new AuditService().run(subject.project).deterministic_status === "BLOCKING" ||
        !xspec.validate(subject.project, xspec.compile(subject.project)).package_valid) {
        const blocked = {state: "LOCAL_CHECK_BLOCKED", ...binding};
        save(blocked);
        return output(blocked);
      }
    }
    const config = readFileSync(values.config, "utf8");
    const pluginIds = [...config.matchAll(/^\[plugins\."([^"\r\n]+)"\]/gmu)].map(match => match[1]);
    const cancellation = new AbortController();
    for (const name of ["SIGINT", "SIGTERM"]) process.once(name, () => cancellation.abort());
    output({state: "STARTED", ...binding, material_bytes: bundle.material_bytes});
    const {receipt, reused} = await runWindowsFormalReview(readCurrent, {directory: values["work-dir"],
      codexExecutable: values.codex, pluginIds, signal: cancellation.signal, receipts, history, expectedBundle: bundle.bundle_sha256});
    const current = receipts.read(readCurrent(), history);
    requireCondition(current?.binding.run_id === receipt.binding.run_id, "FORMAL_REVIEW_RECEIPT_READBACK");
    const result = completed(receipt, reused, Date.now() - started);
    save(result);
    output(result);
  } catch (error) {
    save({state: "UNVERIFIED", ...binding, code: failureCode(error)});
    throw error;
  } finally {
    unlinkSync(lock);
  }
}

try {
  await main();
} catch (error) {
  console.error(JSON.stringify({state: "UNVERIFIED", code: failureCode(error)}));
  process.exitCode = 1;
}
