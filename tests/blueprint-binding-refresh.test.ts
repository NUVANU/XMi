import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";
import {ProjectService} from "../packages/core/project-service.ts";
import {assessFeasibility} from "../packages/core/solution-feasibility.ts";
import {systemArchitecture} from "../packages/core/system-architecture.ts";
import {itemFingerprint} from "../packages/core/validation.ts";
import {XSpecService} from "../packages/core/xspec-service.ts";
import type {Command, Project} from "../packages/shared-types/domain.ts";
import {reviewProjectService, reviewSource} from "./fixtures/spec-review-project.ts";

function revision(project: Project, id: string, statement: string): Command {
  return {kind: "ITEM_TEXT_REVISED", item_id: id, fingerprint: itemFingerprint(project.items.find(item => item.id === id)!),
    statement, owner_action: {intent: "REVISE_TEXT", source_ref: reviewSource}};
}

function amend(service: ProjectService, project: Project, commands: Command[]) {
  const request = {review_id: randomUUID(), project_id: project.project_id, project_version: project.model_version, commands,
    preserve_blueprint_choices: true};
  const result = service.confirmActions(request, reviewSource, () => {});
  assert.deepEqual(service.confirmActions(request, reviewSource, () => {}), result);
  return result;
}

test("one confirmed addition refreshes and replays the existing blueprint without a second owner event", () => {
  const {service, project} = reviewProjectService();
  const base = project.items.at(-1)!;
  const statement = project.items.find(item => item.id === "REQ-REVIEW")!.statement + " The existing saved result also shows when it was saved.";
  const next = amend(service, project, [revision(project, "REQ-REVIEW", statement)]);
  assert.equal(next.model_version, project.model_version + 2);
  const refreshed = next.items.at(-1)!;
  assert.equal(refreshed.id, base.id);
  assert.equal(refreshed.confirmed_at, base.confirmed_at);
  assert.equal(refreshed.blueprint_detail!.feasibility_fingerprint, assessFeasibility(next).fingerprint);
  assert.deepEqual({...refreshed.blueprint_detail, feasibility_fingerprint: base.blueprint_detail!.feasibility_fingerprint}, base.blueprint_detail);
  assert.equal(service.history(project.project_id).at(-1)?.actor, "agent");
  assert.match(systemArchitecture(next).content, /existing saved result also shows/);
  const xspec = new XSpecService();
  assert.equal(xspec.validate(next, xspec.compile(next)).valid, true);
});

test("a replacement or new deployment choice retains the stale blueprint and rejects direct refresh commands", () => {
  const {service, project} = reviewProjectService();
  const base = project.items.at(-1)!;
  const next = amend(service, project, [revision(project, "DEPLOY-REVIEW", "Use a native Windows desktop client.")]);
  assert.deepEqual(next.items.at(-1), base);
  assert.notEqual(base.blueprint_detail!.feasibility_fingerprint, assessFeasibility(next).fingerprint);
  assert.throws(() => service.execute({project_id: next.project_id, expected_version: next.model_version, idempotency_key: "direct",
    command: {kind: "SOLUTION_BLUEPRINT_BINDING_REFRESHED", item_id: base.id, previous_binding: base.blueprint_detail!.feasibility_fingerprint,
      basis: [{id: "DEPLOY-REVIEW", version: 3}]}}, "owner"), /INTERNAL_COMMAND_REQUIRED/);
});

test("a scoped correction keeps the approved blueprint but a replacement of the implementation boundary does not", () => {
  const {service, project} = reviewProjectService();
  const first = amend(service, project, [revision(project, "REQ-REVIEW", "Save a note and reload it. Show the saved status.")]);
  const corrected = amend(service, first, [revision(first, "REQ-REVIEW", "Save a note and reload it. Show the last saved timestamp.")]);
  assert.equal(corrected.model_version, first.model_version + 2);
  assert.equal(service.history(project.project_id).at(-1)?.command.kind, "SOLUTION_BLUEPRINT_BINDING_REFRESHED");
  const change = amend(service, corrected, [revision(corrected, "REQ-REVIEW", "Save a note and reload it. Switch to the new storage provider.")]);
  assert.equal(change.model_version, corrected.model_version + 1);
  assert.notEqual(change.items.at(-1)?.blueprint_detail?.feasibility_fingerprint, assessFeasibility(change).fingerprint);
});

test("appending a provider change, or granting additional data access, still leaves the blueprint for review", () => {
  for (const addition of ["The approved data path will switch to a different backend.",
    "生产流程改由另一网关处理。", "New customers receive access to every saved record."]) {
    const {service, project} = reviewProjectService();
    const initial = project.items.find(item => item.id === "REQ-REVIEW")!.statement;
    const after = amend(service, project, [revision(project, "REQ-REVIEW", initial + " " + addition)]);
    assert.equal(after.model_version, project.model_version + 1);
    assert.notEqual(after.items.at(-1)?.blueprint_detail?.feasibility_fingerprint, assessFeasibility(after).fingerprint);
  }
});

test("replacing a local processing boundary with cloud processing cannot carry forward", () => {
  const {service, project} = reviewProjectService();
  const anchored = amend(service, project, [revision(project, "REQ-REVIEW",
    "Save a note and reload it. Keep all note processing on this device.")]);
  const next = amend(service, anchored, [revision(anchored, "REQ-REVIEW",
    "Save a note and reload it. AWS runs all note processing.")]);
  assert.equal(next.model_version, anchored.model_version + 1);
  assert.notEqual(next.items.at(-1)?.blueprint_detail?.feasibility_fingerprint, assessFeasibility(next).fingerprint);
});
