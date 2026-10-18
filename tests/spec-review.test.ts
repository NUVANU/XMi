import test from "node:test";
import type {TestContext} from "node:test";
import assert from "node:assert/strict";
import fs, {mkdtempSync, rmSync} from "node:fs";
import {syncBuiltinESMExports} from "node:module";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {buildReviewBundle, validateReviewBundle, validateReviewResponse, relateDerivedArtifact, reviewPolicyFingerprint,
  reviewLimits, specReviewRunSchema} from "../packages/core/spec-review-service.ts";
import type {ReviewBundle, SpecReviewResponse} from "../packages/core/spec-review-service.ts";
import {assessPhaseOneIndependentReview} from "../packages/core/m11-assurance-mechanisms.ts";
import {SqliteSpecReviewStore} from "../packages/storage/spec-review-store.ts";
import {SqliteProjectStore} from "../packages/storage/sqlite.ts";
import {SpecReviewRunner} from "../apps/mcp-server/spec-review-runner.ts";
import {XSpecService} from "../packages/core/xspec-service.ts";
import {CompletenessService} from "../packages/core/completeness-service.ts";
import {canonical, fingerprint} from "../packages/core/validation.ts";
import {reviewProject} from "./fixtures/spec-review-project.ts";

function storeFixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "xmi-spec-review-")), path = join(directory, "reviews.sqlite");
  const store = new SqliteSpecReviewStore(path);
  t.after(() => {store.close(); rmSync(directory, {recursive: true, force: true});});
  return {store, directory, path};
}
function response(bundle: ReviewBundle): SpecReviewResponse {
  return {schema_version: "XMI-REVIEW-RESPONSE/1", bundle_sha256: bundle.bundle_sha256,
    covered_ids: [...bundle.required_ids], covered_files: bundle.candidate.files.map(f => f.path),
    scope_requirements: structuredClone(bundle.scope_requirements), findings: [], unresolved_ids: []};
}
const signal = () => new AbortController().signal;

test("review bundle freezes canonical facts, full 35-ID upgrade, candidate bytes and separately mapped material without mutation", () => {
  const p = reviewProject(35);
  p.items.forEach(i => {i.source_refs = [{type: "document", ref: "D:/private/material.docx", excerpt: "not sent as a raw source excerpt"}];});
  const before = canonical(p), b = buildReviewBundle(p);
  assert.equal(canonical(p), before); assert.equal(b.model_sha256, fingerprint(p));
  assert.equal(b.candidate.files.length, 16); assert.equal(b.scope_requirements[0]!.scope_ids.length, 35);
  assert.equal(b.scope_requirements[0]!.minimum_mode, "PRODUCT_GRADE");
  assert.equal(b.scope_requirements[0]!.resolution, "UPGRADE_SCOPE");
  assert.equal(b.material.includes("D:/private"), false); assert.equal(b.material.includes("raw source excerpt"), false);
  assert.ok(b.material.includes("SRC-")); assert.equal(b.egress_approved, false);
  const material = JSON.parse(b.material);
  assert.equal(material.candidate_files.length, 16);
  for (const f of b.candidate.files) if (f.path !== "xspec.json")
    assert.equal(material.candidate_files.find((m: {path: string}) => m.path === f.path).content, f.content);
  assert.deepEqual(validateReviewBundle(b, p), b);
});

test("every fact, source, status, scope, blueprint and same-version semantic change invalidates the frozen model", () => {
  const p = reviewProject(35), b = buildReviewBundle(p);
  for (const change of [
    (q: typeof p) => {q.items[0]!.statement += " changed";},
    (q: typeof p) => {q.items[0]!.source_refs[0]!.ref = "different-source";},
    (q: typeof p) => {q.items[0]!.status = "PROPOSED";},
    (q: typeof p) => {q.items.at(-1)!.blueprint_detail!.xdev_must_preserve[0] += " changed";},
    (q: typeof p) => {q.delivery_policy!.risk_overrides[0]!.scope_ids.pop();},
    (q: typeof p) => {q.model_version++;},
  ]) {const q = structuredClone(p); change(q); assert.throws(() => validateReviewBundle(b, q), /SPEC_REVIEW_STALE/);}
});

test("runner, store, protocol and entrypoint revisions are finite policy inputs that invalidate old bundles", (t) => {
  const b = buildReviewBundle(reviewProject()), original = fs.readFileSync;
  for (const changed of ["spec-review-runner.ts", "spec-review-store.ts", "contracts.ts", "server.ts", "main.ts"]) {
    t.mock.method(fs, "readFileSync", (path: Parameters<typeof fs.readFileSync>[0], options?: Parameters<typeof fs.readFileSync>[1]) => {
      const value = original(path, options);
      return String(path).endsWith(changed) ? Buffer.concat([Buffer.from(value), Buffer.from(" altered")]) : value;
    });
    syncBuiltinESMExports();
    try {assert.notEqual(reviewPolicyFingerprint(), b.policy_sha256); assert.throws(() => validateReviewBundle(b), /SPEC_REVIEW_BUNDLE_INVALID/);}
    finally {t.mock.restoreAll(); syncBuiltinESMExports();}
  }
});

test("rehashed forged bundles cannot omit model IDs, a financial ID, scope level, material or actual candidate content", () => {
  const b = buildReviewBundle(reviewProject(35));
  for (const change of [
    (x: ReviewBundle) => {x.required_ids.pop();}, (x: ReviewBundle) => {x.scope_requirements[0]!.scope_ids.pop();},
    (x: ReviewBundle) => {x.scope_requirements[0]!.minimum_mode = "FAST_VALIDATION";},
    (x: ReviewBundle) => {x.material += " injected";},
    (x: ReviewBundle) => {x.candidate.files[2]!.content += " altered";},
    (x: ReviewBundle) => {x.policy_sha256 = "0".repeat(64);},
  ]) {const x = structuredClone(b); change(x); const body: Partial<ReviewBundle> = {...x}; delete body.bundle_sha256; x.bundle_sha256 = fingerprint(body);
    assert.throws(() => validateReviewBundle(x), /SPEC_REVIEW_BUNDLE_INVALID/);}
});

test("response requires exact total coverage and all financial IDs/levels/dispositions, not a bare PASS or claimed identity", () => {
  const b = buildReviewBundle(reviewProject(35));
  assert.deepEqual(validateReviewResponse(b, response(b)), response(b));
  for (const change of [
    (r: SpecReviewResponse) => {r.covered_ids.pop();}, (r: SpecReviewResponse) => {r.covered_ids.push(r.covered_ids[0]!);},
    (r: SpecReviewResponse) => {r.scope_requirements[0]!.scope_ids.pop();},
    (r: SpecReviewResponse) => {r.scope_requirements[0]!.minimum_mode = "FAST_VALIDATION";},
    (r: SpecReviewResponse) => {r.scope_requirements[0]!.resolution = "DEFER_OR_EXCLUDE";},
    (r: SpecReviewResponse) => {r.covered_files[0] = r.covered_files[1]!;},
  ]) {const r = response(b); change(r); assert.throws(() => validateReviewResponse(b, r), /COVERAGE_INCOMPLETE/);}
  for (const extra of [{result: "PASS"}, {reviewer: "external"}, {isolation_verified: true}, {tool_calls: ["write product"]}])
    assert.throws(() => validateReviewResponse(b, {...response(b), ...extra}), /RESPONSE_INVALID/);
});

test("findings need a real nonblank reason/suggestion/quote and known affected IDs with matching evidence", () => {
  const b = buildReviewBundle(reviewProject()), p = b.model as ReturnType<typeof reviewProject>, r = response(b);
  const finding = {id: "FIND-1", severity: "WARNING" as const, affected_ids: [p.items[0]!.id], statement: "Clarify the saved outcome.",
    evidence: [{item_id: p.items[0]!.id, quote: "Record"}], suggestion: "Specify an observable result."};
  r.findings = [finding]; assert.equal(validateReviewResponse(b, r).findings.length, 1);
  const fileEvidence = {...finding, evidence: [{file_path: "PRODUCT-VISION.md" as const, quote: "Record"}]};
  assert.equal(validateReviewResponse(b, {...r, findings: [fileEvidence]}).findings.length, 1);
  assert.throws(() => validateReviewResponse(b, {...r, covered_files: []}), /RESPONSE_INVALID/);
  for (const change of [
    (x: typeof finding) => {x.statement = " \n";}, (x: typeof finding) => {x.suggestion = "\t";},
    (x: typeof finding) => {x.evidence[0]!.quote = " ";}, (x: typeof finding) => {x.evidence[0]!.quote = "not in the document";},
    (x: typeof finding) => {x.affected_ids = ["UNKNOWN"];}]) {
    const x = structuredClone(finding); change(x); assert.throws(() => validateReviewResponse(b, {...r, findings: [x]}));
  }
  r.findings = Array.from({length: 101}, (_, n) => ({...finding, id: `FIND-${n}`}));
  assert.throws(() => validateReviewResponse(b, r), /RESPONSE_INVALID/);
  assert.throws(() => validateReviewResponse(b, {text: "x".repeat(reviewLimits.output_bytes + 1)}), /OUTPUT_TOO_LARGE/);
});

test("input overflow stops without summary/truncation, splitting or any execution", () => {
  const p = reviewProject();
  p.items[0]!.statement = "x".repeat(reviewLimits.input_bytes + 1);
  assert.throws(() => buildReviewBundle(p), /SPEC_REVIEW_INPUT_TOO_LARGE/);
});

test("C0 to F accepts exact compiler-derived metadata only and never certifies approval, review or final delivery", () => {
  const p = reviewProject(), b = buildReviewBundle(p), service = new XSpecService();
  const evidence = {xui_compatible: true, xdev_compatible: true, owner_confirmed_export: true, immutable_export_exists: true};
  const final = service.compile(p, evidence), relation = relateDerivedArtifact(p, b, final, evidence);
  assert.notEqual(final.canonical_sha256, b.candidate_sha256);
  assert.equal(relation.gate_eligible, false); assert.equal(relation.owner_approval_verified, false);
  assert.equal(relation.projection_sha256, b.projection_sha256);
  for (const path of ["PRODUCT-VISION.md", "TECHNICAL-SOLUTION-BLUEPRINT.md", "CHANGELOG.md", "manifest.json", "READINESS-REPORT.md", "xspec.json"] as const) {
    const changed = structuredClone(final); changed.files.find(f => f.path === path)!.content += " altered";
    assert.throws(() => relateDerivedArtifact(p, b, changed, evidence));
  }
  assert.throws(() => relateDerivedArtifact(p, b, final), /DERIVATION_INVALID/, "even metadata must match the exact supplied compiler inputs");
});

test("separate store never migrates a Product DB; append-only history detects tampering and cannot assert eligibility", (t) => {
  const {store, path, directory} = storeFixture(t), p = reviewProject(), b = buildReviewBundle(p), start = store.prepare(b, "first");
  assert.equal(store.prepare(b, "first").run.run_id, start.run.run_id);
  assert.equal(store.get("XMI-OTHER", start.run.run_id), null);
  const running = store.append(start, {state: "RUNNING", response: null, reason: "fixture"});
  assert.throws(() => store.append(start, {state: "RUNNING", response: null, reason: "duplicate"}), /CONCURRENT_CHANGE/);
  const completed = store.append(running, {state: "COMPLETED", response: response(b), reason: "fixture"});
  assert.equal(completed.sequence, 3);
  assert.deepEqual(assessPhaseOneIndependentReview(p, completed.run), {eligible: false, reason: "SPEC_REVIEW_TEST_ONLY_NOT_ELIGIBLE"});
  assert.equal(assessPhaseOneIndependentReview(p, {...completed.run, gate_eligible: true}).eligible, false);
  assert.equal(assessPhaseOneIndependentReview(p, {schema_version: "M11-INDEPENDENT-REVIEW/1", result: "PASS", isolation_verification: "VERIFIED_EFFECTIVE_ISOLATION"}).eligible, false);
  const other = new SqliteSpecReviewStore(path); assert.deepEqual(other.get(p.project_id, start.run.run_id), completed); other.close();
  const productPath = join(directory, "product.sqlite"), product = new SqliteProjectStore(productPath); product.close();
  assert.throws(() => new SqliteSpecReviewStore(productPath), /STORE_FORMAT_INVALID/);
  const raw = new DatabaseSync(path);
  try {
    assert.throws(() => raw.exec("UPDATE review_events SET body='{}'"), /IMMUTABLE_REVIEW/);
    raw.exec("DROP TRIGGER review_no_update; UPDATE review_events SET body='{}' WHERE seq=3;");
    assert.throws(() => store.get(p.project_id, start.run.run_id), /STORE_CORRUPT/);
    const status = new SpecReviewRunner(store).status(p, start.run.run_id);
    assert.equal(status.state, "UNVERIFIED"); assert.equal(status.gate_eligible, false);
  } finally {raw.close();}
});

test("unconfigured runtime stays unavailable and does not execute, consent, persist, or alter canonical readiness", async () => {
  const p = reviewProject(), before = canonical(p), runner = new SpecReviewRunner(); let calls = 0;
  const r = await runner.start(p, "first", signal(), () => p, async () => {calls++;});
  assert.equal(r.state, "UNAVAILABLE"); assert.equal(r.gate_eligible, false); assert.equal(calls, 0);
  assert.deepEqual(runner.status(p), r); assert.equal(canonical(p), before);
  assert.equal(new CompletenessService().evaluate(p).mode_gates.find(g => g.gate === 103)!.status, "FAIL");
});

test("synthetic execution is once-only, consent-bound, paginated and explicitly not authority", async (t) => {
  const {store} = storeFixture(t), p = reviewProject(35), before = canonical(p); let calls = 0, approvals = 0;
  const b = buildReviewBundle(p), r = response(b);
  r.findings = Array.from({length: 25}, (_, index) => ({id: `F-${index}`, severity: "WARNING", affected_ids: ["VISION-REVIEW"],
    statement: "Clarify", evidence: [{item_id: "VISION-REVIEW", quote: "Record"}], suggestion: "Specify outcome"}));
  const runner = new SpecReviewRunner(store, {execution_kind: "TEST_ONLY", execute: async input => {
    calls++; assert.deepEqual(Object.keys(input).sort(), ["bundle_sha256", "material", "signal"]); return r;
  }});
  const approve = async () => {approvals++;};
  const [a, duplicate] = await Promise.all([runner.start(p, "one", signal(), () => p, approve), runner.start(p, "one", signal(), () => p, approve)]);
  assert.deepEqual(a, duplicate); assert.equal(calls, 1); assert.equal(approvals, 1);
  assert.equal(a.state, "COMPLETED"); assert.equal(a.availability, "TEST_ONLY"); assert.equal(a.gate_eligible, false);
  assert.equal(a.coverage.complete, true); assert.equal(a.coverage.scopes[0]!.required_items, 35);
  assert.equal(a.findings.length, 20); assert.equal(a.total_findings, 25); assert.equal(a.next_offset, 20);
  const page = runner.status(p, a.run_id!, 20, 20); assert.equal(page.findings.length, 5); assert.equal(page.total_findings, 25);
  const empty = runner.status(p, a.run_id!, 100); assert.equal(empty.findings.length, 0); assert.equal(empty.total_findings, 25);
  await runner.start(p, "one", signal(), () => p, approve); assert.equal(calls, 1); assert.equal(approvals, 1);
  p.items[0]!.source_refs[0]!.ref = "changed";
  assert.equal(runner.status(p, a.run_id!).state, "STALE");
  assert.notEqual(canonical(p), before); // The test itself changed it; the runner never did.
});

test("missing coverage, forged tool/PASS output and unresolved issues never become successful independent reviews", async (t) => {
  const {store} = storeFixture(t), p = reviewProject(), b = buildReviewBundle(p);
  for (const [key, output] of [
    ["missing", {...response(b), covered_ids: []}], ["forge", {...response(b), result: "PASS", tools: ["write"]}],
    ["unresolved", {...response(b), unresolved_ids: [b.required_ids[0]!]}],
  ] as const) {
    const runner = new SpecReviewRunner(store, {execution_kind: "TEST_ONLY", execute: async () => output});
    const result = await runner.start(p, key, signal(), () => p, async () => {});
    assert.equal(result.state, key === "unresolved" ? "BLOCKING" : "INCOMPLETE");
    assert.equal(result.gate_eligible, false); assert.equal(result.independent_review_status, "UNAVAILABLE");
  }
});

test("interruption/unknown results and durable RUNNING recovery never automatically resubmit; declined approval saves nothing", async (t) => {
  const {store} = storeFixture(t), p = reviewProject(), b = buildReviewBundle(p); let calls = 0;
  const runner = new SpecReviewRunner(store, {execution_kind: "TEST_ONLY", execute: async () => {calls++; throw new Error("private failure must not leak");}});
  const unknown = await runner.start(p, "unknown", signal(), () => p, async () => {}); assert.equal(unknown.state, "UNKNOWN");
  await runner.start(p, "unknown", signal(), () => p, async () => {assert.fail();}); assert.equal(calls, 1);
  const pending = store.prepare(b, "crashed"), running = store.append(pending, {state: "RUNNING", response: null, reason: "crashed"});
  const restored = new SpecReviewRunner(store, {execution_kind: "TEST_ONLY", execute: async () => {assert.fail();}});
  assert.equal(restored.status(p, running.run.run_id).state, "UNKNOWN");
  assert.equal((await restored.start(p, "crashed", signal(), () => p, async () => {assert.fail();})).state, "UNKNOWN");
  await assert.rejects(runner.start(p, "declined", signal(), () => p, async () => {throw new Error("Owner declined");}));
  assert.equal(store.find(p.project_id, "declined"), null);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runner.start(p, "cancelled", controller.signal, () => p, async () => {assert.fail();}), /REQUEST_CANCELLED/);
  assert.equal(store.find(p.project_id, "cancelled"), null);
  assert.equal(specReviewRunSchema.safeParse({...running.run, execution_kind: "LIVE", gate_eligible: true}).success, false);
});

test("cancellation during execution records interruption promptly; a late synthetic result cannot overwrite it or cause a retry", async t => {
  const {store} = storeFixture(t), p = reviewProject(), controller = new AbortController();
  let finish!: (value: unknown) => void, entered!: () => void, calls = 0;
  const started = new Promise<void>(resolve => {entered = resolve;});
  const runner = new SpecReviewRunner(store, {execution_kind: "TEST_ONLY", execute: async () => {
    calls++; entered(); return new Promise(resolve => {finish = resolve;});
  }});
  const pending = runner.start(p, "cancel-running", controller.signal, () => p, async () => {});
  await started; controller.abort();
  const result = await pending; assert.equal(result.state, "INTERRUPTED"); assert.equal(result.gate_eligible, false);
  const before = store.get(p.project_id, result.run_id!)!;
  finish(response(before.bundle)); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(store.get(p.project_id, result.run_id!), before);
  await runner.start(p, "cancel-running", signal(), () => p, async () => {assert.fail();});
  assert.equal(calls, 1);
});
