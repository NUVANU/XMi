import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {SolutionService} from "../packages/core/solution-service.ts";
import {recommendSolutions} from "../packages/core/solution-options.ts";
import {assessFeasibility} from "../packages/core/solution-feasibility.ts";
import {candidateSchema} from "../packages/shared-types/domain.ts";
import type {Item, Project} from "../packages/shared-types/domain.ts";
const source = {type: "conversation_turn" as const, ref: "fixture:m13"};
const now = "2026-10-01T00:00:00.000Z";
function item(id: string, statement: string, type: Item["type"] = "solution_constraint", tags: string[] = []): Item {
  return {id, type, statement, tags, status: "CONFIRMED", source_refs: [source], priority: "P1", version: 1,
    created_at: now, updated_at: now, confirmed_by: "owner", confirmed_at: now};
}
function project(platform = "Support web browsers."): Project {
  return {schema_version: "0.2.0", project_id: "XMI-M13", title: "M13", profile: "web-micro-saas-v0",
    lifecycle_state: "SOLUTION_REVIEW", model_version: 10, current_xspec_version: null, open_questions: [], updated_at: now,
    delivery_policy: {requested_mode: "PRODUCT_GRADE", effective_mode: "PRODUCT_GRADE", readiness_target: "PRODUCT_SPEC_READY",
      selection_source: "OWNER_CONFIRMED", selected_at: now,
      history: [{from_mode: null, to_mode: "PRODUCT_GRADE", reason: "fixture", changed_by: "owner", changed_at: now}], risk_overrides: []},
    items: [item("ACTOR-M13", "Owners use the product.", "actor"), item("FLOW-M13", "Owner uses the core flow.", "flow"),
      item("DATA-M13", "Public data.", "data_entity", ["data-sensitivity"]),
      item("DEPLOY-M13", "Cloud-hosted boundary.", "solution_constraint", ["deployment"]),
      item("SCALE-M13", "100 users, latency target 1 second.", "non_functional_requirement", ["scale"]),
      item("EXC-M13", "No external integrations.", "exclusion", ["integrations-none"]),
      item("COST-M13", "Low cost and maintenance burden.", "non_functional_requirement", ["maintenance"]),
      item("PLATFORM-M13", platform, "non_functional_requirement", ["platform"])]};
}

test("M13 confirmed explicit public synthetic data scopes supply sensitivity evidence without tags", () => {
  for (const statement of [
    "首期评测资料仅使用公开合成案例，首次验证使用公开D0合成案例。",
    "测试数据仅采用公开合成数据。",
    "演示资料限定为公开的合成资料。",
    "测试案例范围：仅限公开合成案例。",
  ]) {
    const p = project();
    p.items[2] = item("DATA-SYNTHETIC", statement, "constraint");
    const result = assessFeasibility(p);
    assert.equal(result.satisfied_count, 8, statement);
    assert.equal(result.total_count, 8);
    assert.deepEqual(result.inputs.find(entry => entry.key === "DATA_SENSITIVITY")!.evidence_ids, ["DATA-SYNTHETIC"]);
    const review = new SolutionService().review(p, source);
    assert.equal(review.status, "PROPOSAL_AVAILABLE", statement);
    assert.equal(review.proposed_patch!.candidate.status, "PROPOSED");
    assert.equal(review.proposed_patch!.candidate.blueprint_detail!.owner_disposition, null);
  }
});

test("M13 public synthetic scope never promotes unconfirmed or rejected evidence", () => {
  for (const status of ["PROPOSED", "REJECTED", "SUPERSEDED", "INFERRED", "ASSUMED", "OPEN", "BLOCKING"] as const) {
    const p = project();
    p.items[2] = {...item("DATA-SYNTHETIC", "首期评测资料仅使用公开合成案例。", "constraint"), status};
    const result = assessFeasibility(p);
    assert.equal(result.satisfied_count, 7, status);
    assert.deepEqual(result.inputs.find(entry => entry.key === "DATA_SENSITIVITY")!.evidence_ids, []);
    assert.equal(new SolutionService().review(p, source).status, "BLOCKED_PREREQUISITES");
  }
});

test("M13 vague synthetic mentions, non-scope text and undecided scope stay blocking", () => {
  for (const statement of ["使用合成案例。", "演示资料仅使用合成资料。", "公开合成案例。",
    "界面展示公开合成案例这几个字。", "评测资料是否仅使用公开合成案例？", "评测资料不只使用公开合成案例。",
    "首期资料仅使用公开合成案例吗？"]) {
    const p = project();
    p.items[2] = item("DATA-SYNTHETIC", statement, "constraint");
    assert.equal(assessFeasibility(p).satisfied_count, 7, statement);
    assert.equal(new SolutionService().review(p, source).status, "BLOCKED_PREREQUISITES", statement);
  }
  const p = project();
  p.items[2] = item("DATA-SYNTHETIC", "首期评测资料仅使用公开合成案例。", "functional_requirement");
  assert.equal(assessFeasibility(p).satisfied_count, 7, "The existing allowed evidence types still apply.");
});

test("M13 public synthetic scope preserves the other prerequisites and risk gate", () => {
  const p = project();
  p.items[2] = item("DATA-SYNTHETIC", "首期评测资料仅使用公开合成案例。", "constraint");
  p.items = p.items.filter(entry => entry.type !== "actor");
  assert.equal(new SolutionService().review(p, source).status, "BLOCKED_PREREQUISITES");
  p.items.push(item("ACTOR-M13", "Owners use the product.", "actor"));
  p.delivery_policy!.requested_mode = "FAST_VALIDATION";
  p.delivery_policy!.effective_mode = "FAST_VALIDATION";
  p.delivery_policy!.readiness_target = "PROTOTYPE_READY";
  p.items.push(item("PAYMENT-M13", "Users pay subscriptions through real payment processing.", "integration"));
  const review = new SolutionService().review(p, source);
  assert.equal(review.feasibility.satisfied_count, 8);
  assert.equal(review.status, "BLOCKED_RISK");
  assert.ok(review.risk_blocker_ids.length > 0);
});

test("M13 whole solutions differ by confirmed platform and retain unconfirmed status", () => {
  for (const [platform, expected] of [["Support web browsers.", "React"], ["Native Android mobile app.", "Kotlin"],
    ["Windows desktop only.", "Tauri"]]) {
    const p = project(platform);
    const proposal = new SolutionService().propose(p, source);
    assert.equal(proposal.status, "PROPOSED");
    assert.equal(proposal.blueprint_detail?.owner_disposition, null);
    assert.match(proposal.blueprint_detail!.recommended_stack_profile, new RegExp(expected));
    assert.equal(candidateSchema.safeParse(proposal).success, true);
    assert.match(proposal.blueprint_detail!.recommended_stack_profile, /后端|backend/i);
  }
});

test("M13 offline-only tools do not recommend cloud stacks", () => {
  const p = project();
  p.items[3]!.statement = "Offline-only, 仅本地运行。";
  const selection = recommendSolutions(p);
  assert.equal(selection.recommended.id, "SOLUTION-OPTION-LOCAL-FIRST");
  assert.equal(selection.options.some((entry) => /WEB-TYPESCRIPT|WEB-PYTHON/.test(entry.id)), false);
});

test("M13 game options are engines, not managed web; missing visual goals stay unresolved", () => {
  const p = project("PC platform."); p.profile = "digital-game-v0";
  const proposal = new SolutionService().propose(p, source);
  assert.equal(candidateSchema.safeParse(proposal).success, true);
  assert.ok(proposal.blueprint_detail!.options.some((entry) => entry.id === "SOLUTION-OPTION-GODOT"));
  assert.equal(proposal.blueprint_detail!.options.some((entry) => /WEB/.test(entry.id)), false);
  assert.ok(proposal.blueprint_detail!.recommendation.unresolved_inputs.join(" ").includes("2D/3D"));
  assert.doesNotMatch(proposal.blueprint_detail!.deployment_topology, /Web client/);
});

test("M13 confirmed specified technologies win and proposed mentions do not", () => {
  const p = project();
  const preference = item("STACK-M13", "Use Vue with Java Spring Boot.", "solution_constraint", ["technology-choice"]);
  preference.status = "PROPOSED"; p.items.push(preference);
  assert.notEqual(recommendSolutions(p).recommended.id, "SOLUTION-OPTION-OWNER-CONSTRAINTS");
  preference.status = "CONFIRMED";
  const proposal = new SolutionService().propose(p, source);
  assert.equal(proposal.blueprint_detail!.recommendation.option_id, "SOLUTION-OPTION-OWNER-CONSTRAINTS");
  assert.ok(proposal.blueprint_detail!.xdev_must_preserve.includes(preference.statement));
});

test("M13 rejected technologies never become a selected preference or compatible alternative", () => {
  const p = project();
  p.items.push(item("STACK-NO", "Do not use React or Python.", "solution_constraint", ["technology-choice"]));
  const result = recommendSolutions(p);
  assert.notEqual(result.recommended.id, "SOLUTION-OPTION-OWNER-CONSTRAINTS");
  assert.equal(result.options.some((entry) => /React|Python/.test(entry.label + entry.summary)), false);
  assert.ok(result.options.length >= 2);
});

test("M13 technical constraints invalidate persisted blueprints without proposed-state influence", () => {
  const p = project(); const service = new SolutionService();
  const original = service.propose(p, source);
  p.items.push({...original, version: 1, created_at: now, updated_at: now});
  assert.equal(service.review(p, source).status, "PERSISTED");
  const constraint = item("STACK-M13", "Use Vue.", "solution_constraint", ["technology-choice"]);
  constraint.status = "PROPOSED"; p.items.push(constraint);
  assert.equal(service.review(p, source).status, "PERSISTED");
  constraint.status = "CONFIRMED";
  assert.equal(service.review(p, source).status, "PROPOSAL_AVAILABLE");
  const before = assessFeasibility(p).fingerprint;
  constraint.statement = "Use Angular."; constraint.version++;
  assert.notEqual(assessFeasibility(p).fingerprint, before);
});

test("M13 interview preserves approval and asks for current official evidence", () => {
  const skill = readFileSync("plugins/xmi/skills/xmi-discovery/SKILL.md", "utf8");
  const reference = readFileSync("plugins/xmi/skills/xmi-discovery/references/technical-solutions.md", "utf8");
  assert.ok(skill.includes("references/technical-solutions.md"));
  assert.match(reference, /official primary sources/);
  assert.match(reference, /PROPOSED preference must not/);
  assert.match(reference, /APPROVE_BLUEPRINT/);
});


test("M13 a confirmed supported engine chooses its concrete composition", () => {
  const p = project("PC platform."); p.profile = "digital-game-v0";
  p.items.push(item("STACK-M13", "Use Unity.", "solution_constraint", ["engine"]));
  const detail = new SolutionService().propose(p, source).blueprint_detail!;
  assert.equal(detail.recommendation.option_id, "SOLUTION-OPTION-UNITY");
  assert.match(detail.recommended_stack_profile, /C#/);
  assert.equal(detail.owner_disposition, null);
});


test("M13 canonical exclusions filter options and survive in the blueprint", () => {
  const p = project();
  p.items.push(item("EXC-REACT", "Do not use React.", "exclusion"));
  const detail = new SolutionService().propose(p, source).blueprint_detail!;
  assert.equal(detail.options.some((entry) => /React/.test(entry.label + entry.summary)), false);
  assert.ok(detail.xdev_must_preserve.includes("Do not use React."));
});

test("M13 negated local needs do not select local topology", () => {
  for (const statement of ["No offline requirement; cloud only.", "Offline is not required; cloud only.", "不需要离线，只使用云端。", "无需本地运行，使用云端。"] ) {
    const p = project(); p.items[3]!.statement = statement;
    const detail = new SolutionService().propose(p, source).blueprint_detail!;
    assert.notEqual(detail.recommendation.option_id, "SOLUTION-OPTION-LOCAL-FIRST", statement);
    assert.doesNotMatch(detail.deployment_topology, /Local-first/, statement);
  }
  const p = project(); p.items[3]!.statement = "Do not use cloud; use offline-only local storage.";
  assert.equal(recommendSolutions(p).recommended.id, "SOLUTION-OPTION-LOCAL-FIRST");
});

test("M13 freshness binds ordinary constraints, exclusions, NFRs and game profile", () => {
  for (const [type, statement] of [["constraint", "Use Vue."], ["exclusion", "Do not use React."], ["non_functional_requirement", "Support offline mode."]] as const) {
    const p = project(); const service = new SolutionService();
    const original = service.propose(p, source);
    p.items.push({...original, version: 1, created_at: now, updated_at: now});
    const extra = item("EXTRA-M13", statement, type); extra.status = "PROPOSED"; p.items.push(extra);
    assert.equal(service.review(p, source).status, "PERSISTED");
    extra.status = "CONFIRMED";
    assert.equal(service.review(p, source).status, "PROPOSAL_AVAILABLE", type);
    const before = assessFeasibility(p).fingerprint;
    extra.source_refs.push({type: "conversation_turn", ref: "fixture:amended-source"});
    assert.notEqual(assessFeasibility(p).fingerprint, before);
  }
  const p = project(); const before = assessFeasibility(p).fingerprint;
  p.profile = "digital-game-v0";
  assert.notEqual(assessFeasibility(p).fingerprint, before);
});


test("M13 visual clarification needs a confirmed choice, including explicit text-only games", () => {
  const p = project("PC platform."); p.profile = "digital-game-v0";
  p.items.push(item("EXC-2D", "Do not use 2D visuals.", "exclusion"));
  const choice = item("NFR-VISUAL", "Use 3D visuals.", "non_functional_requirement");
  choice.status = "PROPOSED"; p.items.push(choice);
  const unresolved = () => new SolutionService().propose(p, source).blueprint_detail!.recommendation.unresolved_inputs
    .some((value) => value.includes("2D/3D"));
  assert.equal(unresolved(), true);
  choice.status = "CONFIRMED"; choice.statement = "2D/3D 尚未确定。";
  assert.equal(unresolved(), true);
  choice.statement = "Use 3D visuals.";
  assert.equal(unresolved(), false);
  choice.statement = "A text-only game.";
  assert.equal(unresolved(), false);
});
