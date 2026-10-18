import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {buildReviewBundle, withoutSources} from "../packages/core/spec-review-service.ts";
import {buildReviewPreflight, buildPilotPacket, buildFocusedPilotPacket, focusedPilotLedger, validatePilotResponse, pilotLimits} from "../packages/core/spec-review-preflight.ts";
import type {PilotPacket} from "../packages/core/spec-review-preflight.ts";
import {canonical, fingerprint} from "../packages/core/validation.ts";
import {reviewProject} from "./fixtures/spec-review-project.ts";

function fixture(financial = 0) {
  const p = reviewProject(financial);
  p.items[0]!.tags = ["module:alpha", "module:beta"];
  p.items.find(i => i.id === "REQ-REVIEW")!.tags = ["module:alpha"];
  p.items.find(i => i.id === "AC-REVIEW")!.tags = ["module:beta"];
  p.items.push({...p.items[1]!, id: "HIST-UNREFERENCED", statement: "Historical unreferenced actor, never current intent.", status: "REJECTED"});
  const bundle = buildReviewBundle(p), plan = buildReviewPreflight(bundle);
  return {p, bundle, plan};
}
function response(job: PilotPacket) {
  return {schema_version: "XMI-REVIEW-PILOT-RESPONSE/1", root_bundle_sha256: job.body.root_bundle_sha256,
    packet_sha256: job.packet_sha256, phase: job.body.phase, covered_ids: job.body.record_ids,
    covered_range_ids: job.body.documents.map(d => d.id), covered_edge_ids: job.body.edges.map(e => e.id),
    covered_scope_member_ids: job.body.covered_scope_member_ids, findings: [], unresolved_ids: [], claim_scope: "PILOT_ONLY", gate_eligible: false};
}

test("preflight preserves all records including unreferenced history, every module membership and the full 35-ID financial scope", () => {
  const {p, bundle, plan} = fixture(35), before = canonical(p);
  assert.deepEqual(plan.records.map(r => r.id).sort(), p.items.map(i => i.id).sort());
  assert.equal(plan.records.find(r => r.id === "HIST-UNREFERENCED")!.status, "REJECTED");
  assert.deepEqual(plan.records.find(r => r.id === p.items[0]!.id)!.groups, ["module:alpha", "module:beta"]);
  assert.ok(plan.groups.find(g => g.name === "UNASSIGNED_SHARED_CONTEXT")!.core_ids.includes("HIST-UNREFERENCED"));
  assert.deepEqual(plan.scope_requirements, bundle.scope_requirements); assert.equal(plan.scope_requirements[0]!.scope_ids.length, 35);
  assert.equal(plan.scope_requirements[0]!.resolution, "UPGRADE_SCOPE");
  assert.equal(plan.coverage_state, "PLANNED_NOT_REVIEWED");
  for (const r of plan.records) assert.equal(r.material_sha256, fingerprint(withoutSources(p.items.find(i => i.id === r.id))));
  assert.equal(canonical(p), before); assert.deepEqual(buildReviewPreflight(bundle), plan);
});

test("every byte of all sixteen frozen material files has an ordered, hash-checked UTF-8 range", () => {
  const {bundle, plan} = fixture();
  const files = JSON.parse(bundle.material).candidate_files as {path: string; content: string; material_sha256: string}[];
  assert.equal(plan.files.length, 16);
  for (const file of files) {
    const input = Buffer.from(file.content), parts: Buffer[] = []; let next = 0;
    for (const r of plan.file_ranges.filter(r => r.path === file.path)) {
      assert.equal(r.start, next); assert.ok(r.end > r.start && r.end - r.start <= pilotLimits.file_slice_bytes);
      const part = input.subarray(r.start, r.end);
      assert.equal(createHash("sha256").update(part).digest("hex"), r.sha256);
      assert.deepEqual(Buffer.from(part.toString("utf8")), part); parts.push(part); next = r.end;
    }
    assert.equal(next, input.length); assert.deepEqual(Buffer.concat(parts), input);
    assert.equal(createHash("sha256").update(Buffer.concat(parts)).digest("hex"), file.material_sha256);
  }
});

test("outgoing transitive references, incoming cross-module endpoints, literal mentions and history are retained", () => {
  const {p} = fixture();
  p.items.find(i => i.id === "REQ-REVIEW")!.links!.push("HIST-UNREFERENCED");
  p.items.find(i => i.id === "AC-REVIEW")!.statement += " Related decision: HIST-UNREFERENCED.";
  const bundle = buildReviewBundle(p), plan = buildReviewPreflight(bundle);
  const moduleJob = buildPilotPacket(bundle, plan, "module:alpha", "MODULE");
  assert.ok(moduleJob.body.record_ids.includes("FLOW-REVIEW")); assert.ok(moduleJob.body.record_ids.includes("HIST-UNREFERENCED"));
  const cross = buildPilotPacket(bundle, plan, "module:alpha", "CROSS_MODULE");
  assert.ok(cross.body.edges.some(e => e.source === "AC-REVIEW" && e.target === "REQ-REVIEW"));
  assert.ok(cross.body.record_ids.includes("AC-REVIEW"));
  assert.ok(plan.edges.some(e => e.source === "AC-REVIEW" && e.target === "HIST-UNREFERENCED" && e.kind === "MENTION"));
  for (const edge of cross.body.edges) for (const id of [edge.source, edge.target]) assert.ok(cross.body.records.some(r => r.id === id));
});

test("changed plan, same-version changed model, scope omissions and version changes cannot reuse a pilot binding", () => {
  const {p, bundle, plan} = fixture(35);
  const altered = structuredClone(plan); altered.scope_requirements[0]!.scope_ids.pop();
  assert.throws(() => buildPilotPacket(bundle, altered, "module:alpha", "MODULE"), /PREFLIGHT_CHANGED/);
  for (const mutate of [(q: typeof p) => {q.items[0]!.statement += " revised";}, (q: typeof p) => {q.model_version++;}]) {
    const next = structuredClone(p); mutate(next);
    assert.throws(() => buildPilotPacket(buildReviewBundle(next), plan, "module:alpha", "MODULE"), /PREFLIGHT_CHANGED/);
  }
  assert.throws(() => buildPilotPacket(bundle, plan, "invented-module", "MODULE"), /MODULE_UNKNOWN/);
});

test("pilot result requires exact ID/range/edge/scope-member coverage, own binding and grounded original evidence", () => {
  const {bundle, plan} = fixture(), job = buildPilotPacket(bundle, plan, "module:alpha", "MODULE"), value = response(job);
  assert.deepEqual(validatePilotResponse(job, value), value);
  for (const bad of [{...value, covered_ids: value.covered_ids.slice(1)}, {...value, covered_ids: [...value.covered_ids, value.covered_ids[0]]},
    {...value, covered_range_ids: value.covered_range_ids.slice(1)}, {...value, packet_sha256: "0".repeat(64)},
    {...value, claim_scope: "ALL_EAMI"}, {...value, gate_eligible: true}]) assert.throws(() => validatePilotResponse(job, bad));
  const item = job.body.records[0]!;
  const finding = {id: "FIND-ONE", severity: "WARNING", affected_ids: [item.id], statement: "Clarify this original rule.",
    evidence: [{item_id: item.id, quote: item.statement}], suggestion: "Ask Owner to specify an observable result.", edge_ids: []};
  assert.equal(validatePilotResponse(job, {...value, findings: [finding]}).findings.length, 1);
  assert.throws(() => validatePilotResponse(job, {...value, findings: [{...finding, evidence: [{item_id: item.id, quote: "Fabricated evidence"}]}]}), /UNGROUNDED/);
});

test("cross-module findings must cite both original endpoints of an actual covered edge", () => {
  const {bundle, plan} = fixture(), job = buildPilotPacket(bundle, plan, "module:alpha", "CROSS_MODULE"), value = response(job);
  const e = job.body.edges[0]!, a = job.body.records.find(i => i.id === e.source)!, b = job.body.records.find(i => i.id === e.target)!;
  const finding = {id: "FIND-CROSS", severity: "WARNING", affected_ids: [a.id, b.id], statement: "Synthetic cross-module question.",
    evidence: [{item_id: a.id, quote: a.statement}, {item_id: b.id, quote: b.statement}], suggestion: "Owner should reconcile both ends.", edge_ids: [e.id]};
  assert.equal(validatePilotResponse(job, {...value, findings: [finding]}).findings.length, 1);
  assert.throws(() => validatePilotResponse(job, {...value, findings: [{...finding, evidence: finding.evidence.slice(0, 1)}]}), /BOTH_ENDPOINTS_REQUIRED/);
});

test("CLI capacity failure prepares only a planning report, zero executable jobs and no source changes", t => {
  const {p} = fixture(35);
  for (const item of p.items.filter(i => i.id.startsWith("BILL-"))) item.tags = ["module:alpha"];
  for (const item of p.items) item.statement += " 原文必须完整保留。".repeat(180);
  const bundle = buildReviewBundle(p), dir = mkdtempSync(join(tmpdir(), "xmi-pilot-preflight-"));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const input = join(dir, "bundle.json"), output = join(dir, "new-output"); writeFileSync(input, canonical(bundle));
  const before = readFileSync(input);
  const result = JSON.parse(execFileSync(process.execPath, [resolve("tools/spec-review-preflight.mjs"), "--bundle-file", input,
    "--module", "module:alpha", "--out", output], {encoding: "utf8", maxBuffer: 1024 * 1024}));
  assert.equal(result.state, "BLOCKED_CAPACITY"); assert.equal(result.actual_agents, 0); assert.equal(result.gate_eligible, false);
  assert.equal(existsSync(join(output, "MODULE.json")), false); assert.equal(existsSync(join(output, "CROSS_MODULE.json")), false);
  assert.deepEqual(readFileSync(input), before);
  assert.throws(() => execFileSync(process.execPath, [resolve("tools/spec-review-preflight.mjs"), "--bundle-file", input,
    "--module", "module:alpha", "--out", output], {stdio: "pipe"}), /OUTPUT_EXISTS/);
});

test("CLI within-bound planning prepares at most two packet sets and still starts zero Agents", t => {
  const {bundle} = fixture(), dir = mkdtempSync(join(tmpdir(), "xmi-pilot-small-"));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const input = join(dir, "bundle.json"), output = join(dir, "new-output"); writeFileSync(input, canonical(bundle));
  const result = JSON.parse(execFileSync(process.execPath, [resolve("tools/spec-review-preflight.mjs"), "--bundle-file", input,
    "--module", "module:alpha", "--out", output], {encoding: "utf8", maxBuffer: 1024 * 1024}));
  assert.equal(result.state, "READY_FOR_TWO_AGENT_PILOT"); assert.equal(result.actual_agents, 0);
  assert.equal(result.jobs.length, 2); assert.ok(result.jobs.every((j: {encoded_pages: number}) => j.encoded_pages <= 4));
  assert.equal(existsSync(join(output, "MODULE.json")), true); assert.equal(existsSync(join(output, "CROSS_MODULE.json")), true);
  assert.equal(result.coverage_state, "PLANNED_NOT_REVIEWED");
});

test("V2 keeps original direct endpoints while exposing deferred dependencies instead of pretending transitive coverage", () => {
  const {p} = fixture();
  p.items.find(i => i.id === "FLOW-REVIEW")!.links = ["HIST-UNREFERENCED"];
  const bundle = buildReviewBundle(p), plan = buildReviewPreflight(bundle), job = buildFocusedPilotPacket(bundle, plan, "module:alpha", "MODULE");
  assert.ok(job.body.record_ids.includes("FLOW-REVIEW")); assert.ok(!job.body.record_ids.includes("HIST-UNREFERENCED"));
  assert.ok(job.body.dependencies.some(e => e.source === "FLOW-REVIEW" && e.target === "HIST-UNREFERENCED"));
  const value = {...response(job as unknown as PilotPacket), schema_version: "XMI-REVIEW-PILOT-RESPONSE/2",
    acknowledged_dependency_edge_ids: job.body.dependencies.map(e => e.id)};
  assert.equal(validatePilotResponse(job, value).claim_scope, "PILOT_ONLY");
  const unresolvedSchema = job.body.response_schema.properties!.unresolved_ids as {items: {enum: string[]}};
  assert.deepEqual(unresolvedSchema.items.enum, job.body.record_ids);
  assert.throws(() => validatePilotResponse(job, {...value, unresolved_ids: ["HIST-UNREFERENCED"]}), /RESPONSE_INVALID/);
  assert.throws(() => validatePilotResponse(job, {...value, acknowledged_dependency_edge_ids: []}), /DEPENDENCIES_INCOMPLETE/);
  const ledger = focusedPilotLedger(bundle, plan, [{job, response: value}]);
  assert.ok(ledger.missing_ids.includes("HIST-UNREFERENCED")); assert.equal(ledger.global_complete, false);
  assert.equal(ledger.gate_eligible, false); assert.equal(ledger.global_context_complete, false);
  assert.ok(ledger.missing_edge_ids.length > 0);
  assert.throws(() => focusedPilotLedger(bundle, plan, [{job, response: value}, {job, response: value}]), /BUDGET_INVALID/);
});

test("V2 original focused ranges preserve UTF-8 offsets and complete compiler entries without leaking other list entries", () => {
  const {p} = fixture();
  for (let n = 0; n < 20; n++) {
    p.items.push({...p.items.find(i => i.id === "REQ-REVIEW")!, id: `REQ-OTHER-${n}`,
      tags: ["module:other"], links: ["FLOW-REVIEW"], statement: `Unrelated original row ${n}. ` + "原文😀".repeat(60)});
    p.items.push({...p.items.find(i => i.id === "AC-REVIEW")!, id: `AC-OTHER-${n}`,
      tags: ["module:other"], links: [`REQ-OTHER-${n}`], statement: `Verify unrelated original row ${n}.`});
  }
  const bundle = buildReviewBundle(p), plan = buildReviewPreflight(bundle), job = buildFocusedPilotPacket(bundle, plan, "module:alpha", "MODULE");
  const files = JSON.parse(bundle.material).candidate_files as {path: string; content: string}[];
  for (const d of job.body.documents) {
    const bytes = Buffer.from(files.find(f => f.path === d.path)!.content);
    assert.deepEqual(Buffer.from(d.content), bytes.subarray(d.start, d.end));
    assert.equal(createHash("sha256").update(Buffer.from(d.content)).digest("hex"), d.sha256);
  }
  const functional = job.body.documents.filter(d => d.path === "FUNCTIONAL-REQUIREMENTS.md").map(d => d.content).join("");
  assert.ok(functional.includes("Save a note and reload it.")); assert.ok(!functional.includes("REQ-OTHER-"));
  assert.equal(plan.files.length, 16); assert.ok(plan.records.some(r => r.id === "REQ-OTHER-19"));
});
