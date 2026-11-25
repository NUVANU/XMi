import assert from "node:assert/strict";
import childProcess from "node:child_process";
import {EventEmitter} from "node:events";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {syncBuiltinESMExports} from "node:module";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {spawnFormalLauncher} from "../apps/mcp-server/windows-launcher.ts";
import {reviewCodexExecutable} from "../apps/local-module-review/codex-formal-executable.ts";

test("formal launcher retries pre-PID EPERM and starts exactly one worker", async t => {
  const original = childProcess.spawn;
  let calls = 0;
  childProcess.spawn = (() => {
    calls++;
    if (calls === 1) throw Object.assign(new Error("temporary rejection"), {code: "EPERM"});
    const child = Object.assign(new EventEmitter(), {pid: 10});
    queueMicrotask(() => {child.emit("spawn"); child.emit("close", 0);});
    return child;
  }) as unknown as typeof childProcess.spawn;
  syncBuiltinESMExports();
  t.after(() => {childProcess.spawn = original; syncBuiltinESMExports();});
  const states: string[] = [];
  const {exited} = await spawnFormalLauncher("launcher.exe", ".", new AbortController().signal, event => states.push(event.state));
  assert.deepEqual(await exited, [0]);
  assert.deepEqual(states, ["START_FAILED", "STARTED"]);
  assert.equal(calls, 2);
});

test("formal launcher refuses to retry after a PID or cancellation", async t => {
  const original = childProcess.spawn;
  let calls = 0;
  childProcess.spawn = (() => {
    calls++;
    const child = Object.assign(new EventEmitter(), {pid: 10});
    queueMicrotask(() => child.emit("error", Object.assign(new Error("child started"), {code: "EPERM"})));
    return child;
  }) as unknown as typeof childProcess.spawn;
  syncBuiltinESMExports();
  t.after(() => {childProcess.spawn = original; syncBuiltinESMExports();});
  const noop = () => {};
  await assert.rejects(spawnFormalLauncher("launcher.exe", ".", new AbortController().signal, noop), {code: "EPERM"});
  await assert.rejects(spawnFormalLauncher("launcher.exe", ".", AbortSignal.abort(), noop), {name: "AbortError"});
  assert.equal(calls, 1);
});

test("an updated Codex is selected only inside the verified release directory", t => {
  const root = mkdtempSync(join(tmpdir(), "xmi-release-test-"));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const installed = join(root, "trusted", "0101010101010101");
  const unrelated = join(root, "unrelated", "0202020202020202");
  const stale = join(root, "trusted", "0303030303030303", "codex.exe");
  for (const folder of [installed, unrelated]) {
    mkdirSync(folder, {recursive: true});
    writeFileSync(join(folder, "codex.exe"), "fixture");
  }
  assert.equal(basenameOf(reviewCodexExecutable(stale, unrelated)), "0101010101010101");
  const other = join(root, "trusted", "0404040404040404");
  mkdirSync(other);
  writeFileSync(join(other, "codex.exe"), "fixture");
  assert.equal(reviewCodexExecutable(stale, unrelated), undefined);
  assert.equal(basenameOf(reviewCodexExecutable(stale, other)), "0404040404040404");
});

function basenameOf(executable?: string) {
  return executable?.split(/[\\/]/u).at(-2);
}
