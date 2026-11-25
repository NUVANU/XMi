import { randomUUID } from "node:crypto";
import { z } from "zod";
import { commandSchema, eventSchema, productProfileSchema } from "../shared-types/domain.ts";
import type { Actor, Command, DomainEvent, Item, Project, DeliveryMode } from "../shared-types/domain.ts";
import type { ProjectStore, StoreTransaction } from "../storage/store.ts";
import { DomainError, requireCondition } from "./errors.ts";
import { fingerprint, itemFingerprint, modeFingerprint, validateProject, rejectSecrets } from "./validation.ts";
import { evaluateRisk, evaluateRiskLegacy, exclusionScopeIssues, riskResolutionRevision, invalidRiskOverrides } from "./completeness-service.ts";
import { assessFeasibility, confirmedSolutionInputs } from "./solution-feasibility.ts";
import { recommendSolutions, solutionBlockingInputs } from "./solution-options.ts";
import { moduleConfirmationSchema } from "./module-confirmation.ts";
import {actionConfirmationSchema, ownerReviewCommandSchema} from "./action-confirmation.ts";

const targets = { FAST_VALIDATION: "PROTOTYPE_READY", FAST_DEVELOPMENT: "BUILD_READY",
  PRODUCT_GRADE: "PRODUCT_SPEC_READY" } as const;
const ranks: Record<DeliveryMode, number> = { FAST_VALIDATION: 0, FAST_DEVELOPMENT: 1, PRODUCT_GRADE: 2 };
const newId = (prefix: string) => prefix + randomUUID().toUpperCase();
const requestSchema = z.strictObject({
  project_id: z.string().regex(/^XMI-[A-Z0-9-]+$/), expected_version: z.number().int().nonnegative(),
  idempotency_key: z.string().min(1).max(200), command: commandSchema,
});
export type ClosingLinkRepair = Pick<Extract<Command, {kind: "ACCEPTANCE_LINKS_DERIVED"}>, "item_id" | "fingerprint" | "basis">;

function currentBlueprint(project: Project) {
  return project.items.findLast(item => item.type === "solution_blueprint" &&
    item.status !== "REJECTED" && item.status !== "SUPERSEDED");
}

const clauses = (statement: string) => statement.split(/[。；;\n]+|(?<=[.!?])\s+/u)
  .map(text => text.trim().replace(/[.!?]+$/u, "")).filter(Boolean);
const reversal = /\b(?:never|instead|replace|remove|no longer|must not|cannot)\b|改用|改为|不再|取消原|替换原|移除原/u;
const solutionChange = /(?:改由|替换|更换|迁移|移交|转由|改接|绕过).{0,24}(?:网关|前端|后端|接口|平台|供应商|服务商|支付商|部署|数据归属|存储)|\b(?:switch|migrate|replace|bypass|move)\b.{0,35}\b(?:provider|gateway|backend|frontend|database|platform|deployment|storage)\b/iu;
const expandedAccess = /\b(?:new|all|other|external)\s+(?:customers?|users?|actors?)\b.{0,36}\baccess\b.{0,32}\b(?:records?|data)\b|(?:外部|其他|全部|所有)(?:组织|租户|用户|成员).{0,12}(?:可|能|可以|允许).{0,12}(?:读取|访问|修改|导出|下载).{0,14}(?:记录|数据|账单|附件)/iu;
const architectureTerms = (text: string) => [...new Set(text.toLowerCase().match(
  /本地|离线|本机|端侧|云端|自托管|跨境|\b(?:local(?:-only|-first)?|offline|cloud|on-device|on this device|on-premises|self-hosted|aws|gcp|azure|postgres(?:ql)?|sqlite|mysql|indexeddb|godot|unity|unreal)\b/gu,
) ?? [])].sort();

const changesSolution = (text: string) => reversal.test(text.toLowerCase()) || solutionChange.test(text) || expandedAccess.test(text);

// Refresh source bindings only, including bounded corrections of existing
// requirements explicitly approved together with unchanged technical choices.
export function planBlueprintRefresh(before: Project, next: Project, commands: Command[]): Command | undefined {
  const blueprint = currentBlueprint(before), detail = blueprint?.blueprint_detail;
  if (blueprint?.status !== "CONFIRMED" || !detail?.owner_disposition ||
    detail.feasibility_fingerprint !== assessFeasibility(before).fingerprint) return;
  const acceptanceAmendment = commands.some(command => command.kind === "ACCEPTANCE_LINKS_ADDED");
  let rewrote = false;
  const basis = commands.map(command => {
    if (command.kind !== "ITEM_TEXT_REVISED" && command.kind !== "ACCEPTANCE_LINKS_ADDED" &&
      command.kind !== "ITEM_CONFIRMED") return;
    const old = before.items.find(item => item.id === command.item_id);
    const updated = next.items.find(item => item.id === command.item_id);
    if (acceptanceAmendment) {
      if (old?.type !== "acceptance_criterion" || updated?.status !== "CONFIRMED") return;
      if (command.kind === "ACCEPTANCE_LINKS_ADDED" && old.status === "CONFIRMED") {
        return {id: updated.id, version: updated.version};
      }
      if (command.kind === "ITEM_CONFIRMED" && old.status === "PROPOSED" && !old.supersedes && old.links?.length &&
        old.links.every(id => before.items.some(requirement => requirement.id === id &&
          requirement.type === "functional_requirement" && requirement.status === "CONFIRMED" &&
          requirement.statement === old.statement))) return {id: updated.id, version: updated.version};
      return;
    }
    if (command.kind !== "ITEM_TEXT_REVISED") return;
    if (old?.status !== "CONFIRMED" || !updated || ![
      "functional_requirement", "acceptance_criterion", "non_functional_requirement", "integration", "solution_constraint", "constraint",
    ].includes(old.type)) return;
    const appended = updated.statement.startsWith(old.statement + " ");
    if (appended) {
      const addition = updated.statement.slice(old.statement.length);
      if (old.type === "constraint" || changesSolution(addition)) return;
    } else {
      const prior = new Set(clauses(old.statement)), current = clauses(updated.statement);
      const added = current.filter(clause => !prior.has(clause));
      const currentSet = new Set(current);
      const removed = [...prior].filter(clause => !currentSet.has(clause));
      const inheritedConstraint = old.type === "constraint" && added.length === 1 && removed.length === 1 &&
        before.items.some(item => item.type === "functional_requirement" && item.status === "CONFIRMED" &&
          item.source_refs.some(source => source.type === "owner_action" && source.ref === command.owner_action.source_ref.ref) &&
          clauses(item.statement).includes(added[0]!));
      // Do not carry forward a wholesale replacement or a change to a technical
      // constraint. The anchored text and explicit change checks serve different purposes.
      if ((!["functional_requirement", "acceptance_criterion", "integration"].includes(old.type) && !inheritedConstraint) ||
        !current.some(clause => prior.has(clause)) || !added.length || added.some(changesSolution) ||
        fingerprint(architectureTerms(removed.join("\n"))) !== fingerprint(architectureTerms(added.join("\n")))) return;
      rewrote = true;
    }
    return {id: updated.id, version: updated.version};
  });
  if (basis.some(item => !item) || new Set(basis.map(item => item?.id)).size !== basis.length ||
    fingerprint(recommendSolutions(before)) !== fingerprint(recommendSolutions(next))) return;
  const assessment = assessFeasibility(next);
  const risk = evaluateRisk(next);
  if ((rewrote || acceptanceAmendment) && fingerprint(risk.findings) !== fingerprint(evaluateRisk(before).findings)) return;
  if (!assessment.ready || assessment.fingerprint === detail.feasibility_fingerprint ||
    solutionBlockingInputs(next).length || risk.unresolved_blocker_count ||
    invalidRiskOverrides(next).length || refreshedLinks(blueprint, assessment).length > 160) return;
  return {kind: "SOLUTION_BLUEPRINT_BINDING_REFRESHED", item_id: blueprint.id,
    previous_binding: detail.feasibility_fingerprint, basis: basis.filter(item => item !== undefined)};
}

function refreshedLinks(blueprint: Item, assessment: ReturnType<typeof assessFeasibility>) {
  return [...new Set([...(blueprint.links ?? []), ...assessment.inputs.flatMap(input => input.evidence_ids)])];
}

function approvedScopeExpansions(before: Project, next: Project, events: DomainEvent[]): boolean {
  if (!before.delivery_policy || !next.delivery_policy) return false;
  const {risk_overrides: oldRows, ...previousMode} = before.delivery_policy;
  const {risk_overrides: rows, ...mode} = next.delivery_policy;
  if (fingerprint(previousMode) !== fingerprint(mode)) return false;
  const ownerEvents = events.filter(event => event.actor === "owner").map(event => event.command);
  const active = rows.filter(row => row.status === "CONFIRMED");
  const oldById = new Map(oldRows.map(row => [row.id, row]));
  const added = active.filter(row => !oldById.has(row.id));
  if (!added.length || added.some(row => row.resolution !== "UPGRADE_SCOPE" ||
    !ownerEvents.some(command => command.kind === "MODE_OVERRIDE_RESOLVED" && command.override_id === row.id &&
      command.resolution === row.resolution && command.rationale === row.rationale))) return false;
  return oldRows.every(prior => {
    const current = rows.find(row => row.id === prior.id);
    if (fingerprint(current ?? null) === fingerprint(prior)) return true;
    if (prior.status !== "CONFIRMED" || prior.resolution !== "UPGRADE_SCOPE" || current?.status !== "RETRACTED") return false;
    return ownerEvents.some(command => command.kind === "MODE_OVERRIDE_RETRACTED" && command.override_id === prior.id) &&
      added.some(row => row.reason_code === prior.reason_code && row.minimum_mode === prior.minimum_mode &&
        prior.scope_ids.every(id => row.scope_ids.includes(id)));
  });
}

/** Closing owns documentation rebindings using the originally approved technical choice. */
function planClosingBlueprintRefresh(next: Project, events: DomainEvent[]): Command | undefined {
  const blueprint = currentBlueprint(next);
  const detail = blueprint?.blueprint_detail;
  if (blueprint?.status !== "CONFIRMED" || !detail?.owner_disposition) return;
  const assessment = assessFeasibility(next), risk = evaluateRisk(next);
  if (!assessment.ready || assessment.fingerprint === detail.feasibility_fingerprint ||
    risk.unresolved_blocker_count || invalidRiskOverrides(next).length || solutionBlockingInputs(next).length ||
    refreshedLinks(blueprint, assessment).length > 160) return;
  const start = events.findLastIndex(({command}) => (command.kind === "SOLUTION_BLUEPRINT_APPROVED" ||
    command.kind === "SOLUTION_BLUEPRINT_DELEGATED" || command.kind === "SOLUTION_BLUEPRINT_BINDING_REFRESHED") && command.item_id === blueprint.id);
  if (start < 0) return;
  const before = replay(events.slice(0, start + 1));
  if (fingerprint(currentBlueprint(before) ?? null) !== fingerprint(blueprint) ||
    assessFeasibility(before).fingerprint !== detail.feasibility_fingerprint || before.profile !== next.profile) return;
  const followup = events.slice(start + 1);
  const policyChanged = fingerprint(before.delivery_policy ?? null) !== fingerprint(next.delivery_policy ?? null);
  const approvedExpansion = policyChanged && approvedScopeExpansions(before, next, followup);
  if (policyChanged && !approvedExpansion) return;
  const unchangedRisk = (p: Project) => evaluateRisk(p).findings.map(finding =>
    finding.status === "SATISFIED_BY_PROJECT_MODE"
      ? {reason_code: finding.reason_code, minimum_mode: finding.minimum_mode, status: finding.status}
      : finding);
  if (!approvedExpansion && fingerprint(unchangedRisk(before)) !== fingerprint(unchangedRisk(next))) return;
  const technicalOptions = (p: Project) => {
    const {options, recommended, local, browserOnly, browserMemory, game, mobile, desktop} = recommendSolutions(p);
    return {options, recommended, local, browserOnly, browserMemory, game, mobile, desktop};
  };
  if (fingerprint(technicalOptions(before)) !== fingerprint(technicalOptions(next))) return;
  const authority = new Set(followup.flatMap(event => {
    const command = event.command;
    if (command.kind === "ACCEPTANCE_LINKS_DERIVED" || command.kind === "ACCEPTANCE_WORDING_REUSED" ||
      event.actor === "owner" && (command.kind === "ITEM_TEXT_REVISED" || command.kind === "ITEM_CONFIRMED" || command.kind === "ACCEPTANCE_LINKS_ADDED")) {
      return [command.item_id];
    }
    return [];
  }));
  const old = new Map(confirmedSolutionInputs(before).map(item => [item.id, item]));
  const current = new Map(confirmedSolutionInputs(next).map(item => [item.id, item]));
  if ([...old.keys()].some(id => !current.has(id))) return;
  const updates = [...current.values()].filter(item => item.version !== old.get(item.id)?.version);
  const types = ["functional_requirement", "non_functional_requirement", "acceptance_criterion", "data_entity",
    ...(approvedExpansion ? ["vision", "actor", "constraint"] : [])];
  if (!updates.length || updates.length > 50 || updates.some(item => {
    const previous = old.get(item.id);
    if (!authority.has(item.id) || !types.includes(item.type) ||
      item.supersedes !== previous?.supersedes) return true;
    const priorClauses = new Set(clauses(previous?.statement ?? ""));
    return item.type !== "acceptance_criterion" && clauses(item.statement).some(clause => !priorClauses.has(clause) &&
      (solutionChange.test(clause) || expandedAccess.test(clause)));
  })) return;
  return {kind: "SOLUTION_BLUEPRINT_BINDING_REFRESHED", item_id: blueprint.id, previous_binding: detail.feasibility_fingerprint,
    basis: updates.map(({id, version}) => ({id, version}))};
}

type RiskResolution = Extract<Command, {kind: "MODE_OVERRIDE_RESOLVED"}>;
export function supersededSandboxes(project: Project, overrideId: string, resolution: RiskResolution["resolution"]): string[] {
  if (resolution !== "STUB_OR_SANDBOX") return [];
  const findings = evaluateRisk(project).findings;
  const finding = findings.find(row => row.override_id === overrideId);
  if (!finding) return [];
  const current = new Set(findings.map(row => row.override_id));
  return (project.delivery_policy?.risk_overrides ?? []).filter(row =>
    row.status === "CONFIRMED" && row.resolution === resolution && !current.has(row.id) &&
    row.reason_code === finding.reason_code && row.minimum_mode === finding.minimum_mode &&
    row.scope_ids.length < finding.scope_ids.length && row.scope_ids.every(id => finding.scope_ids.includes(id))
  ).map(row => row.id).sort();
}

// After a same-policy sandbox expansion, reuse the last approved binding only for
// unchanged technical inputs plus additive, confirmed integration constraints.
function planSandboxBlueprintRefresh(next: Project, events: DomainEvent[]): Command | undefined {
  const blueprint = currentBlueprint(next), detail = blueprint?.blueprint_detail;
  if (blueprint?.status !== "CONFIRMED" || !detail?.owner_disposition) return;
  const assessment = assessFeasibility(next);
  if (!assessment.ready || assessment.fingerprint === detail.feasibility_fingerprint ||
    evaluateRisk(next).unresolved_blocker_count || invalidRiskOverrides(next).length ||
    solutionBlockingInputs(next).length || refreshedLinks(blueprint, assessment).length > 160) return;
  const index = events.findLastIndex(({command}) =>
    (command.kind === "SOLUTION_BLUEPRINT_APPROVED" || command.kind === "SOLUTION_BLUEPRINT_DELEGATED" ||
      command.kind === "SOLUTION_BLUEPRINT_BINDING_REFRESHED") && command.item_id === blueprint.id);
  if (index < 0) return;
  const previous = replay(events.slice(0, index + 1)), base = currentBlueprint(previous);
  if (fingerprint(base ?? null) !== fingerprint(blueprint) || assessFeasibility(previous).fingerprint !== detail.feasibility_fingerprint ||
    previous.delivery_policy?.effective_mode !== next.delivery_policy?.effective_mode ||
    fingerprint(recommendSolutions(previous)) !== fingerprint(recommendSolutions(next))) return;
  const old = previous.delivery_policy?.risk_overrides.filter(row => row.status === "CONFIRMED") ?? [];
  const active = next.delivery_policy?.risk_overrides.filter(row => row.status === "CONFIRMED") ?? [];
  const activeIds = new Set(active.map(row => row.id));
  const nextRisk = next.delivery_policy?.risk_overrides ?? [];
  const replaced = old.filter(row => !activeIds.has(row.id));
  const added = active.filter(row => !old.some(prior => prior.id === row.id));
  const covers = (candidate: typeof active[number], prior: typeof old[number]) =>
    candidate.resolution === "STUB_OR_SANDBOX" && prior.resolution === candidate.resolution &&
    candidate.reason_code === prior.reason_code && candidate.minimum_mode === prior.minimum_mode &&
    candidate.scope_ids.length > prior.scope_ids.length && prior.scope_ids.every(id => candidate.scope_ids.includes(id));
  if (!replaced.length || !added.length ||
    !old.filter(row => activeIds.has(row.id)).every(row => fingerprint(row) === fingerprint(active.find(v => v.id === row.id))) ||
    replaced.some(row => !nextRisk.some(v => v.id === row.id && v.status === "RETRACTED") || !added.some(v => covers(v, row))) ||
    added.some(row => !replaced.some(v => covers(row, v)))) return;
  const confirmed = next.items.filter(item => item.status === "CONFIRMED");
  const priorConfirmed = previous.items.filter(item => item.status === "CONFIRMED");
  if (priorConfirmed.some(item => !confirmed.some(current => current.id === item.id && itemFingerprint(current) === itemFingerprint(item)))) return;
  const priorIds = new Set(priorConfirmed.map(item => item.id));
  if (confirmed.some(item => !priorIds.has(item.id) && (item.supersedes ||
    !["functional_requirement", "acceptance_criterion", "integration"].includes(item.type) || changesSolution(item.statement)))) return;
  const inputs = new Map(detail.feasibility_inputs.map(input => [input.key, input.evidence_ids]));
  const basis = assessment.inputs.flatMap(input => input.evidence_ids.filter(id => !inputs.get(input.key)?.includes(id)).map(id => ({key: input.key, id})));
  if (!basis.length || basis.length > 50 || assessment.inputs.some(input => inputs.get(input.key)?.some(id => !input.evidence_ids.includes(id))) ||
    basis.some(({key, id}) => key !== "INTEGRATION_CONSTRAINTS" || !confirmed.some(item =>
      item.id === id && item.type === "integration" && !item.supersedes && !changesSolution(item.statement)))) return;
  return {kind: "SOLUTION_BLUEPRINT_BINDING_REFRESHED", item_id: blueprint.id,
    previous_binding: detail.feasibility_fingerprint, basis: basis.map(({id}) => ({id, version: confirmed.find(item => item.id === id)!.version}))};
}

function migrate(command: Extract<Command, {kind: "SCHEMA_MIGRATED"}>, id: string): Project {
  const legacy = structuredClone(command.legacy_snapshot);
  requireCondition(legacy.schema_version === "0.1.0", "UNSUPPORTED_SCHEMA_VERSION");
  requireCondition(legacy.project_id === id && !("delivery_policy" in legacy), "INVALID_LEGACY_SNAPSHOT");
  const migrated = { ...legacy, schema_version: "0.2.0", delivery_policy: null,
    xspec_id: "XSPEC-" + id.slice(4), lifecycle_state: "AMENDMENT_REQUIRED" };
  validateProject(migrated);
  const confirmations = command.confirmation_events;
  requireCondition(new Set(confirmations.map((e) => e.event_id)).size === confirmations.length, "DUPLICATE_CONFIRMATION_EVENT");
  requireCondition(confirmations.length === migrated.items.filter((i) => i.status === "CONFIRMED").length,
    "LEGACY_CONFIRMATION_MISMATCH");
  for (const item of migrated.items.filter((i) => i.status === "CONFIRMED")) {
    const matching = confirmations.filter((e) => e.item_id === item.id && e.item_version === item.version &&
      e.fingerprint === itemFingerprint(item) && e.confirmed_at === item.confirmed_at);
    requireCondition(matching.length === 1, "LEGACY_CONFIRMATION_REQUIRED");
  }
  return migrated;
}

function transition(previous: Project | undefined, event: Omit<DomainEvent, "hash">): Project {
  const { command, occurred_at: at, project_id: id, actor, version } = event;
  let project: Project;
  if (command.kind === "PROJECT_CREATED") {
    requireCondition(!previous && version === 1, "PROJECT_ALREADY_EXISTS");
    project = { schema_version: "0.2.0", project_id: id, xspec_id: "XSPEC-" + id.slice(4),
      title: command.title, profile: command.profile ?? "web-micro-saas-v0", delivery_policy: null,
      lifecycle_state: "DRAFT", model_version: version,
      items: [{ id: "VISION-" + id.slice(4), type: "vision", statement: command.idea,
        status: "PROPOSED", source_refs: [command.source_ref], version: 1, created_at: at, updated_at: at }],
      open_questions: [], current_xspec_version: null, created_at: at, updated_at: at };
  } else if (command.kind === "SCHEMA_MIGRATED") {
    requireCondition(actor === "owner" && !previous, "OWNER_MIGRATION_REQUIRED");
    project = migrate(command, id);
    requireCondition(version === Number(command.legacy_snapshot.model_version) + 1, "INVALID_MIGRATION_VERSION");
  } else {
    requireCondition(previous && previous.model_version + 1 === version, "INVALID_EVENT_VERSION");
    project = structuredClone(previous);
    requireCondition(project.lifecycle_state !== "ARCHIVED", "PROJECT_ARCHIVED");
    if (command.kind === "CANDIDATE_EXTRACTED") {
      requireCondition(!project.items.some((i) => i.id === command.candidate.id), "DUPLICATE_ITEM_ID");
      project.items.push({ ...command.candidate, version: 1, created_at: at, updated_at: at });
    } else if (command.kind === "ITEM_CONFIRMED" || command.kind === "ITEM_REJECTED") {
      requireCondition(actor === "owner", "OWNER_ACTION_REQUIRED");
      const item = project.items.find((i) => i.id === command.item_id);
      requireCondition(item, "ITEM_NOT_FOUND");
      requireCondition(itemFingerprint(item) === command.fingerprint, "FINGERPRINT_MISMATCH");
      if (command.kind === "ITEM_CONFIRMED") {
        requireCondition(!(item.type === "decision" && item.decision_detail), "USE_DECISION_APPROVAL");
        requireCondition(!(item.type === "solution_blueprint" && item.blueprint_detail), "USE_SOLUTION_BLUEPRINT_APPROVAL");
      }
      requireCondition(item.status !== "CONFIRMED" || command.kind === "ITEM_REJECTED", "ALREADY_CONFIRMED");
      item.status = command.kind === "ITEM_CONFIRMED" ? "CONFIRMED" : "REJECTED";
      item.version += 1;
      item.updated_at = at;
      item.source_refs.push(command.owner_action.source_ref);
      if (item.status === "CONFIRMED") {
        item.confirmed_by = "owner"; item.confirmed_at = at;
      } else {
        delete item.confirmed_by; delete item.confirmed_at;
        if (item.blueprint_detail) {
          item.blueprint_detail.owner_disposition = null;
          item.blueprint_detail.delegation = null;
        }
      }
    } else if (command.kind === "ITEM_TEXT_REVISED") {
      requireCondition(actor === "owner", "OWNER_ACTION_REQUIRED");
      const item=project.items.find(i=>i.id===command.item_id);
      requireCondition(item && !["REJECTED","SUPERSEDED"].includes(item.status),"ITEM_NOT_REVISABLE");
      requireCondition(!item.decision_detail && !item.blueprint_detail && !["decision","solution_blueprint"].includes(item.type),"STRUCTURED_ITEM_REQUIRES_DECISION");
      requireCondition(itemFingerprint(item)===command.fingerprint,"FINGERPRINT_MISMATCH");
      item.statement=command.statement;item.status="CONFIRMED";item.version++;
      item.updated_at=at;item.confirmed_at=at;item.confirmed_by="owner";item.source_refs.push(command.owner_action.source_ref);
    } else if (command.kind === "ACCEPTANCE_LINKS_ADDED" || command.kind === "ACCEPTANCE_LINKS_DERIVED") {
      requireCondition(actor === (command.kind === "ACCEPTANCE_LINKS_ADDED" ? "owner" : "agent"), "ACCEPTANCE_LINK_AUTHORITY");
      const item = project.items.find(entry => entry.id === command.item_id);
      requireCondition(item?.type === "acceptance_criterion" && item.status === "CONFIRMED", "CONFIRMED_ACCEPTANCE_REQUIRED");
      requireCondition(itemFingerprint(item) === command.fingerprint, "FINGERPRINT_MISMATCH");
      const currentLinks = item.links ?? [];
      const ids = command.kind === "ACCEPTANCE_LINKS_ADDED" ? command.requirement_ids : command.basis.map(row => row.requirement_id);
      requireCondition(new Set(ids).size === ids.length && ids.every(id => !currentLinks.includes(id)), "ACCEPTANCE_LINK_ALREADY_PRESENT");
      requireCondition(ids.every(id => project.items.some(requirement => requirement.id === id &&
        requirement.type === "functional_requirement" && requirement.status === "CONFIRMED")), "CONFIRMED_FUNCTIONAL_REQUIREMENT_REQUIRED");
      requireCondition(currentLinks.length + ids.length <= 20, "ACCEPTANCE_LINK_LIMIT_EXCEEDED");
      if (command.kind === "ACCEPTANCE_LINKS_DERIVED") {
        for (const row of command.basis) {
          const requirement = project.items.find(entry => entry.id === row.requirement_id)!;
          requireCondition(item.statement.includes(row.criterion_quote) && requirement.statement.includes(row.requirement_quote) &&
            row.requirement_fingerprint === itemFingerprint(requirement), "ACCEPTANCE_LINK_SOURCE_MISMATCH");
        }
        item.source_refs.push({type: "system_rule", ref: "xmi:acceptance-trace:" + fingerprint(command.basis)});
      }
      item.links = [...currentLinks, ...ids];
      item.version++;
      item.updated_at = at;
    } else if (command.kind === "ACCEPTANCE_WORDING_REUSED") {
      const item = project.items.find(entry => entry.id === command.item_id);
      const requirement = project.items.find(entry => entry.id === command.requirement_id);
      requireCondition(actor === "agent" && item?.type === "acceptance_criterion" && item.status === "PROPOSED" &&
        !item.supersedes && requirement?.type === "functional_requirement" && requirement.status === "CONFIRMED" &&
        item.links?.length === 1 && item.links[0] === requirement.id &&
        item.statement === requirement.statement && itemFingerprint(item) === command.fingerprint &&
        itemFingerprint(requirement) === command.requirement_fingerprint, "ACCEPTANCE_WORDING_NOT_IDENTICAL");
      const original = requirement.source_refs.findLast(ref => ref.type === "owner_action");
      requireCondition(original && requirement.confirmed_at && requirement.confirmed_by === "owner", "CONFIRMED_REQUIREMENT_SOURCE_REQUIRED");
      item.status = "CONFIRMED";
      item.confirmed_at = requirement.confirmed_at;
      item.confirmed_by = requirement.confirmed_by;
      item.source_refs.push(original, {type: "system_rule", ref: "xmi:acceptance-wording:" + requirement.id});
      item.version++;
      item.updated_at = at;
    } else if (command.kind === "DECISION_APPROVED") {
      requireCondition(actor === "owner", "OWNER_ACTION_REQUIRED");
      const item = project.items.find((i) => i.id === command.item_id);
      requireCondition(item?.type === "decision" && item.decision_detail, "DECISION_DETAIL_REQUIRED");
      requireCondition(itemFingerprint(item) === command.fingerprint, "FINGERPRINT_MISMATCH");
      requireCondition(item.status !== "SUPERSEDED" && item.status !== "REJECTED", "DECISION_NOT_APPROVABLE");
      requireCondition(item.decision_detail.options.some((option) => option.id === command.selected_option_id), "INVALID_DECISION_SELECTION");
      item.decision_detail.owner_selection = command.selected_option_id;
      item.status = "CONFIRMED";
      item.version += 1;
      item.updated_at = at;
      item.confirmed_by = "owner";
      item.confirmed_at = at;
      item.source_refs.push(command.owner_action.source_ref);
    } else if (command.kind === "SOLUTION_BLUEPRINT_APPROVED" || command.kind === "SOLUTION_BLUEPRINT_DELEGATED") {
      requireCondition(actor === "owner", "OWNER_ACTION_REQUIRED");
      const item = project.items.find((entry) => entry.id === command.item_id);
      requireCondition(item?.type === "solution_blueprint" && item.blueprint_detail, "BLUEPRINT_DETAIL_REQUIRED");
      requireCondition(itemFingerprint(item) === command.fingerprint, "FINGERPRINT_MISMATCH");
      requireCondition(item.status !== "CONFIRMED" && item.status !== "REJECTED" && item.status !== "SUPERSEDED", "BLUEPRINT_NOT_APPROVABLE");
      const feasibility = assessFeasibility(project);
      requireCondition(feasibility.ready, "SOLUTION_PREREQUISITES_INCOMPLETE");
      requireCondition(item.blueprint_detail.feasibility_fingerprint === feasibility.fingerprint, "STALE_SOLUTION_BLUEPRINT");
      requireCondition(solutionBlockingInputs(project).length === 0, "SOLUTION_INPUTS_UNRESOLVED");
      requireCondition((command.risk_revision === 2 ? evaluateRisk : evaluateRiskLegacy)(project).unresolved_blocker_count === 0, "SOLUTION_RISK_BLOCKED");
      if (command.risk_revision === 2) requireCondition(invalidRiskOverrides(project).length === 0, "SOLUTION_RISK_REVIEW_REQUIRED");
      item.status = "CONFIRMED";
      item.blueprint_detail.owner_disposition = command.kind === "SOLUTION_BLUEPRINT_APPROVED" ? "APPROVED" : "DELEGATED_TO_XDEV";
      item.blueprint_detail.delegation = command.kind === "SOLUTION_BLUEPRINT_DELEGATED"
        ? {delegated_to: command.delegated_to, boundaries: [...command.boundaries]} : null;
      item.version += 1;
      item.updated_at = at;
      item.confirmed_by = "owner";
      item.confirmed_at = at;
      item.source_refs.push(command.owner_action.source_ref);
    } else if (command.kind === "SOLUTION_BLUEPRINT_BINDING_REFRESHED") {
      const blueprint = currentBlueprint(project), detail = blueprint?.blueprint_detail;
      requireCondition(actor === "agent" && blueprint?.id === command.item_id && blueprint.status === "CONFIRMED" &&
        detail?.owner_disposition && detail.feasibility_fingerprint === command.previous_binding, "BLUEPRINT_REFRESH_NOT_ALLOWED");
      requireCondition(command.basis.every(({id, version}) => project.items.some(item => item.id === id &&
        item.status === "CONFIRMED" && item.version === version)), "BLUEPRINT_REFRESH_BASIS_STALE");
      const assessment = assessFeasibility(project);
      const links = refreshedLinks(blueprint, assessment);
      requireCondition(assessment.ready && links.length <= 160, "BLUEPRINT_REFRESH_NOT_ALLOWED");
      detail.feasibility_inputs = assessment.inputs.map(({key, evidence_ids}) => ({key, evidence_ids}));
      detail.feasibility_fingerprint = assessment.fingerprint;
      blueprint.links = links;
      blueprint.version++;
      blueprint.updated_at = at;
      blueprint.source_refs.push({type: "system_rule", ref: "xmi:confirmed-blueprint-binding:" +
        fingerprint(command.basis)});
    } else if (command.kind === "ITEM_SUPERSEDED") {
      requireCondition(actor === "owner", "OWNER_ACTION_REQUIRED");
      const item = project.items.find((i) => i.id === command.item_id);
      const replacement = project.items.find((i) => i.id === command.replacement_item_id);
      requireCondition(item?.type === "decision" && item.decision_detail, "DECISION_DETAIL_REQUIRED");
      requireCondition(replacement?.type === "decision" && replacement.decision_detail, "DECISION_DETAIL_REQUIRED");
      requireCondition(item.status === "CONFIRMED" && replacement.status === "CONFIRMED", "CONFIRMED_DECISIONS_REQUIRED");
      requireCondition(itemFingerprint(item) === command.fingerprint, "FINGERPRINT_MISMATCH");
      requireCondition(itemFingerprint(replacement) === command.replacement_fingerprint, "FINGERPRINT_MISMATCH");
      requireCondition(item.id !== replacement.id, "INVALID_SUPERSESSION");
      item.status = "SUPERSEDED";
      item.version += 1;
      item.updated_at = at;
      item.source_refs.push(command.owner_action.source_ref);
      replacement.supersedes = item.id;
      if (!replacement.decision_detail.supersession_history.includes(item.id)) replacement.decision_detail.supersession_history.push(item.id);
      replacement.version += 1;
      replacement.updated_at = at;
      replacement.source_refs.push(command.owner_action.source_ref);
    } else if (command.kind === "DELIVERY_MODE_SELECTED" || command.kind === "DELIVERY_MODE_UPGRADED") {
      requireCondition(actor === "owner", "OWNER_ACTION_REQUIRED");
      requireCondition(modeFingerprint(previous, command.mode, command.reason) === command.fingerprint, "FINGERPRINT_MISMATCH");
      const old = previous.delivery_policy;
      const upgrading = !!old && ranks[command.mode] > ranks[old.effective_mode];
      requireCondition((command.kind === "DELIVERY_MODE_UPGRADED") === upgrading, "MODE_EVENT_MISMATCH");
      // Same mode is not a new selection; idempotency is handled before transition.
      requireCondition(old?.effective_mode !== command.mode, "MODE_UNCHANGED");
      // Future release scoping is not implemented in M1; never reinterpret an existing export.
      requireCondition(!old || !project.current_xspec_version ||
        ranks[command.mode] >= ranks[old.effective_mode], "EXPORTED_MODE_DOWNGRADE_REQUIRES_NEW_SCOPE");
      project.delivery_policy = {
        requested_mode: command.mode, effective_mode: command.mode, readiness_target: targets[command.mode],
        selection_source: "OWNER_CONFIRMED", selected_at: at,
        history: [...(old?.history ?? []), { from_mode: old?.effective_mode ?? null, to_mode: command.mode,
          reason: command.reason, changed_by: "owner", changed_at: at }],
        risk_overrides: old?.risk_overrides ?? [],
      };
    } else if (command.kind === "MODE_OVERRIDE_RESOLVED") {
      requireCondition(actor === "owner", "OWNER_ACTION_REQUIRED");
      requireCondition(project.delivery_policy, "MODE_SELECTION_REQUIRED");
      const finding = (command.risk_revision === 2 ? evaluateRisk : evaluateRiskLegacy)(project).findings.find((entry) => entry.override_id === command.override_id);
      requireCondition(finding, "MODE_OVERRIDE_NOT_FOUND");
      const replaces = command.replaces_override_ids ?? [];
      if (replaces.length) {
        const eligible = supersededSandboxes(project, finding.override_id, command.resolution);
        requireCondition(command.risk_revision === 2 && new Set(replaces).size === replaces.length &&
          replaces.every(id => eligible.includes(id)), "MODE_OVERRIDE_REPLACEMENT_INVALID");
      }
      // F-4: the frozen handoff contract declares an override whose minimum_mode ranks below the
      // effective project mode invalid, and a conforming consumer must reject the whole package when
      // it sees one. Such an override is also vacuous, because the project mode already meets that
      // risk's floor. Refuse to create it, so XMi cannot emit a package its own contract disallows.
      requireCondition(ranks[finding.minimum_mode] >= ranks[project.delivery_policy.effective_mode],
        "MODE_OVERRIDE_RISK_ALREADY_SATISFIED");
      if (command.resolution === "UPGRADE_PROJECT") {
        requireCondition(ranks[project.delivery_policy.effective_mode] >= ranks[finding.minimum_mode], "MODE_UPGRADE_REQUIRED");
      }
      // F-12: an override is a delivery-scope contract. Recording it for a PROPOSED/ASSUMED scope
      // would project ids that are intentionally absent from the authoritative XSpec and create a
      // package that fails reference validation. Refuse at the Owner-gated write boundary instead.
      const scopeItems = finding.scope_ids.map((scopeId) => project.items.find((item) => item.id === scopeId));
      requireCondition(scopeItems.length === finding.scope_ids.length && scopeItems.every((item) => item?.status === "CONFIRMED"),
        "MODE_OVERRIDE_SCOPE_NOT_CONFIRMED");
      if (command.risk_revision === 2 && command.resolution === "DEFER_OR_EXCLUDE") {
        requireCondition(exclusionScopeIssues(project, finding.scope_ids, finding.reason_code).length === 0, "RISK_SCOPE_SPLIT_REQUIRED");
      }
      const next = {
        id: finding.override_id,
        scope_ids: finding.scope_ids,
        minimum_mode: finding.minimum_mode,
        reason_code: finding.reason_code,
        rationale: command.risk_revision === 2 ? command.rationale : finding.rationale,
        status: "CONFIRMED" as const,
        resolution: command.resolution,
        source_refs: [...project.items.filter((item) => finding.scope_ids.includes(item.id)).flatMap((item) => item.source_refs),
          command.owner_action.source_ref, ...(command.risk_revision === 2 ? [riskResolutionRevision] : [])],
      };
      const index = project.delivery_policy.risk_overrides.findIndex((entry) => entry.id === finding.override_id);
      if (index >= 0) project.delivery_policy.risk_overrides[index] = next;
      else project.delivery_policy.risk_overrides.push(next);
      for (const old of project.delivery_policy.risk_overrides) if (replaces.includes(old.id)) {
        old.status = "RETRACTED";
        old.source_refs.push(command.owner_action.source_ref);
      }
    } else if (command.kind === "MODE_OVERRIDE_RETRACTED") {
      requireCondition(actor === "owner", "OWNER_ACTION_REQUIRED");
      requireCondition(project.delivery_policy, "MODE_SELECTION_REQUIRED");
      const overrides = project.delivery_policy.risk_overrides;
      const index = overrides.findIndex((entry) => entry.id === command.override_id);
      requireCondition(index >= 0, "MODE_OVERRIDE_NOT_FOUND");
      const recorded = overrides[index]!;
      requireCondition(recorded.status === "CONFIRMED", "MODE_OVERRIDE_NOT_CONFIRMED");
      // Withdrawal is deliberately checked against the recorded override and NOT against a current
      // risk finding. An override must remain withdrawable after its scope changed or its items were
      // rejected, which is exactly the case where the finding no longer exists. The record is kept,
      // not deleted, so the resolution that was once made stays auditable; only its status changes,
      // and every reader already treats a non-CONFIRMED entry as inert, which returns the underlying
      // risk to unresolved.
      overrides[index] = {...recorded, status: "RETRACTED",
        source_refs: [...recorded.source_refs, command.owner_action.source_ref]};
    }
    const solutionEvent = command.kind === "SOLUTION_BLUEPRINT_APPROVED" || command.kind === "SOLUTION_BLUEPRINT_DELEGATED" ||
      command.kind === "SOLUTION_BLUEPRINT_BINDING_REFRESHED" ||
      (command.kind === "CANDIDATE_EXTRACTED" && command.candidate.type === "solution_blueprint");
    project.lifecycle_state = project.current_xspec_version ? "AMENDMENT_REQUIRED" : solutionEvent ? "SOLUTION_REVIEW" : "CLARIFICATION";
  }
  project.model_version = version;
  project.updated_at = at;
  validateProject(project);
  return project;
}

export function replay(rawEvents: DomainEvent[]): Project {
  requireCondition(rawEvents.length, "PROJECT_NOT_FOUND");
  let project: Project | undefined;
  let previousHash = "";
  const ids = new Set<string>();
  for (const raw of rawEvents) {
    const parsed = eventSchema.safeParse(raw);
    requireCondition(parsed.success, "INVALID_EVENT_SCHEMA");
    const { hash, ...event } = parsed.data;
    requireCondition(!ids.has(event.event_id), "DUPLICATE_EVENT");
    ids.add(event.event_id);
    requireCondition(event.previous_hash === previousHash && fingerprint(event) === hash, "CORRUPT_EVENT_CHAIN");
    if (project) requireCondition(event.project_id === project.project_id, "CROSS_PROJECT_EVENT");
    project = transition(project, event);
    previousHash = hash;
  }
  return project!;
}

/** Hypothetical validation only; no events, receipts or Owner authority are saved. */
export function previewOwnerAction(project: Project, input: unknown): Project {
  const command = ownerReviewCommandSchema.parse(input);
  const versioned = command.kind === "MODE_OVERRIDE_RESOLVED" || command.kind === "SOLUTION_BLUEPRINT_APPROVED" || command.kind === "SOLUTION_BLUEPRINT_DELEGATED"
    ? {...command, risk_revision: 2 as const} : command;
  return transition(project, {event_id: "EVENT-PREVIEW", project_id: project.project_id, version: project.model_version + 1,
    actor: "owner", occurred_at: project.updated_at, command: versioned, previous_hash: ""});
}

export class ProjectService {
  private store: ProjectStore;
  private clock: () => string;
  constructor(store: ProjectStore, clock: () => string = () => new Date().toISOString()) {
    this.store = store;
    this.clock = clock;
  }

  previewBlueprintCarryForward(before: Project, next: Project, commands: Command[]) {
    return planBlueprintRefresh(before, next, commands) ??
      (commands.some(command => command.kind === "MODE_OVERRIDE_RESOLVED") ?
        planSandboxBlueprintRefresh(next, this.history(before.project_id).filter(event => event.version <= before.model_version)) : undefined);
  }

  refreshApprovedBlueprint(projectId: string, version: number, key: string): Project {
    return this.store.transaction(tx => {
      const receiptKey = projectId + ":blueprint-binding:" + key;
      const requestHash = fingerprint({projectId, version, key});
      const saved = tx.receipt(receiptKey);
      if (saved) return this.retry(tx, saved, requestHash);
      const events = tx.events(projectId), project = replay(events);
      requireCondition(project.model_version === version, "VERSION_CONFLICT");
      requireCondition(fingerprint(tx.snapshot(projectId)) === fingerprint(project), "CORRUPT_SNAPSHOT");
      const blueprint = currentBlueprint(project);
      if (blueprint?.status === "CONFIRMED" && blueprint.blueprint_detail?.owner_disposition &&
        blueprint.blueprint_detail.feasibility_fingerprint === assessFeasibility(project).fingerprint) return project;
      const refresh = planSandboxBlueprintRefresh(project, events) ?? planClosingBlueprintRefresh(project, events);
      requireCondition(refresh, "BLUEPRINT_TECHNICAL_REVIEW_REQUIRED");
      return this.persist(tx, projectId, version, receiptKey, refresh, "agent", requestHash, {project, lastHash: events.at(-1)!.hash});
    });
  }

  reconcileForClosing(projectId: string, version: number, key: string, links: ClosingLinkRepair[]) {
    return this.store.transaction(tx => {
      const receiptKey = projectId + ":closing:" + key;
      const requestHash = fingerprint({projectId, version, links});
      const saved = tx.receipt(receiptKey);
      if (saved) return {project: this.retry(tx, saved, requestHash), repairs: []};
      const events = tx.events(projectId), project = replay(events);
      requireCondition(project.model_version === version, "VERSION_CONFLICT");
      requireCondition(fingerprint(tx.snapshot(projectId)) === fingerprint(project), "CORRUPT_SNAPSHOT");
      requireCondition(links.length <= 50 && new Set(links.map(row => row.item_id)).size === links.length, "INVALID_ACCEPTANCE_REPAIR_BATCH");
      const trace = new Map(links.map(link => [link.item_id, link]));
      const requirements = project.items.filter(item => item.type === "functional_requirement" && item.status === "CONFIRMED" && item.statement.trim().length >= 8);
      for (const criterion of project.items) {
        if (criterion.type !== "acceptance_criterion" || criterion.status !== "CONFIRMED" || criterion.statement.trim().length < 8 ||
          trace.has(criterion.id) || trace.size >= 50) continue;
        const remaining = 20 - (criterion.links?.length ?? 0);
        const missing = requirements.filter(requirement => !criterion.links?.includes(requirement.id) &&
          (requirement.links?.includes(criterion.id) || requirement.statement === criterion.statement)).slice(0, Math.max(0, remaining));
        if (missing.length) trace.set(criterion.id, {item_id: criterion.id, fingerprint: itemFingerprint(criterion),
          basis: missing.map(requirement => ({requirement_id: requirement.id, requirement_fingerprint: itemFingerprint(requirement),
            criterion_quote: criterion.statement.trim().slice(0, 100), requirement_quote: requirement.statement.trim().slice(0, 100)}))});
      }
      const planned = [...trace.values()];
      const commands: Command[] = planned.map(link => commandSchema.parse({kind: "ACCEPTANCE_LINKS_DERIVED", ...link}));
      const covered = new Set(project.items.filter(item => item.type === "acceptance_criterion" && item.status === "CONFIRMED")
        .flatMap(item => item.links ?? []).concat(planned.flatMap(link => link.basis.map(row => row.requirement_id))));
      for (const item of project.items) {
        if (item.type !== "acceptance_criterion" || item.status !== "PROPOSED" || item.supersedes || item.links?.length !== 1 || covered.has(item.links[0]!)) continue;
        const requirement = project.items.find(row => row.id === item.links![0] && row.type === "functional_requirement" && row.status === "CONFIRMED");
        const approval = requirement && events.findLast(event => event.actor === "owner" &&
          (event.command.kind === "ITEM_CONFIRMED" || event.command.kind === "ITEM_TEXT_REVISED") && event.command.item_id === requirement.id);
        if (requirement?.statement !== item.statement || !approval || commands.length >= 50) continue;
        commands.push({kind: "ACCEPTANCE_WORDING_REUSED", item_id: item.id, fingerprint: itemFingerprint(item),
          requirement_id: requirement.id, requirement_fingerprint: itemFingerprint(requirement)});
        covered.add(requirement.id);
      }
      requireCondition(commands.length <= 50, "INVALID_ACCEPTANCE_REPAIR_BATCH");
      const state = {project, lastHash: events.at(-1)!.hash};
      const repairs: string[] = [];
      for (const [index, command] of commands.entries()) {
        this.persist(tx, projectId, state.project.model_version, receiptKey + ":" + index, command,
          "agent", fingerprint({command, actor: "agent"}), state);
        if ("item_id" in command) repairs.push(command.item_id);
      }
      const refresh = planSandboxBlueprintRefresh(state.project, tx.events(projectId)) ?? planClosingBlueprintRefresh(state.project, tx.events(projectId));
      if (refresh) {
        this.persist(tx, projectId, state.project.model_version, receiptKey + ":blueprint", refresh,
          "agent", fingerprint({command: refresh, actor: "agent"}), state);
        if ("item_id" in refresh) repairs.push(refresh.item_id);
      }
      if (repairs.length) tx.saveReceipt(receiptKey, {project_id: projectId, version: state.project.model_version, request_hash: requestHash});
      return {project: structuredClone(state.project), repairs};
    });
  }

  create(input: unknown, actor: Actor = "agent"): Project {
    const parsed = z.strictObject({
      idempotency_key: z.string().min(1).max(200), title: z.string().min(1).max(200),
      idea: z.string().min(1).max(20000), profile: productProfileSchema.optional(), source_ref: z.object({
        type: z.enum(["conversation_turn", "document", "owner_action", "system_rule", "import"]),
        ref: z.string().min(1), excerpt: z.string().max(1000).optional(),
      }).strict(),
    }).safeParse(input);
    requireCondition(parsed.success, "INVALID_COMMAND");
    const { idempotency_key, ...payload } = parsed.data;
    const command = commandSchema.parse({kind: "PROJECT_CREATED", ...payload});
    rejectSecrets(command);
    const requestHash = fingerprint({command, actor});
    return this.store.transaction((tx) => {
      const key = "create:" + idempotency_key;
      const old = tx.receipt(key);
      if (old) return this.retry(tx, old, requestHash);
      return this.persist(tx, newId("XMI-"), 0, key, command, actor, requestHash);
    });
  }

  execute(input: unknown, actor: Actor = "agent", beforeCommit?: () => void): Project {
    const parsed = requestSchema.safeParse(input);
    requireCondition(parsed.success, "INVALID_COMMAND");
    const request = parsed.data;
    requireCondition(request.command.kind !== "PROJECT_CREATED", "USE_CREATE");
    requireCondition(request.command.kind !== "SOLUTION_BLUEPRINT_BINDING_REFRESHED", "INTERNAL_COMMAND_REQUIRED");
    requireCondition(request.command.kind !== "ACCEPTANCE_LINKS_ADDED", "NATIVE_ACTION_BATCH_REQUIRED");
    requireCondition(request.command.kind !== "ACCEPTANCE_LINKS_DERIVED" && request.command.kind !== "ACCEPTANCE_WORDING_REUSED", "INTERNAL_COMMAND_REQUIRED");
    rejectSecrets(request.command);
    const hash = fingerprint({ ...request, actor });
    return this.store.transaction((tx) => {
      const key = request.project_id + ":" + request.idempotency_key;
      const old = tx.receipt(key);
      const command = request.command;
      const versioned = command.kind === "MODE_OVERRIDE_RESOLVED" || command.kind === "SOLUTION_BLUEPRINT_APPROVED" || command.kind === "SOLUTION_BLUEPRINT_DELEGATED"
        ? {...command, risk_revision: 2 as const} : command;
      const result = old ? this.retry(tx, old, hash) : this.persist(tx, request.project_id, request.expected_version, key, versioned, actor, hash);
      beforeCommit?.();
      return result;
    });
  }

  // Read-only retry lookup for host adapters: no new write or authorization grant.
  // Called only by the native user-prompt adapter, never from a model-facing tool.
  confirmModule(input: unknown, sourceRef: {type: "owner_action"; ref: string}, beforeCommit?: () => void): Project {
    const review = moduleConfirmationSchema.parse(input);
    requireCondition(new Set(review.items.map(item => item.id)).size === review.items.length, "DUPLICATE_ITEM_ID");
    return this.store.transaction(tx => {
      const commands = review.items.map(item => ({kind: "ITEM_CONFIRMED" as const, item_id: item.id,
        fingerprint: item.fingerprint, owner_action: {intent: "CONFIRM" as const, source_ref: sourceRef}}));
      const requests = commands.map((command, index) => ({project_id: review.project_id,
        expected_version: review.project_version + index,
        idempotency_key: "module-review:" + review.review_id + ":" + index, command}));
      const receipts = requests.map(request => tx.receipt(request.project_id + ":" + request.idempotency_key));
      if (receipts.some(Boolean)) {
        requireCondition(receipts.every(Boolean), "CORRUPT_RECEIPT");
        const retried = requests.map((request, index) => this.retry(tx, receipts[index]!, fingerprint({...request, actor: "owner"})));
        return retried.at(-1)!;
      }
      const events = tx.events(review.project_id);
      const project = replay(events);
      requireCondition(project.model_version === review.project_version, "VERSION_CONFLICT");
      for (const member of review.items) {
        const item = project.items.find(entry => entry.id === member.id);
        requireCondition(item && item.version === member.version && itemFingerprint(item) === member.fingerprint,
          "FINGERPRINT_MISMATCH");
        requireCondition(item.tags?.includes("module:" + review.module) &&
          ["PROPOSED", "INFERRED", "ASSUMED"].includes(item.status) && !item.decision_detail && !item.blueprint_detail &&
          item.type !== "decision" && item.type !== "solution_blueprint", "MODULE_ITEM_NOT_APPROVABLE");
      }
      let next = project;
      // The history is validated once in this transaction. Each following event
      // extends that checked state; repeated full replay exceeds native hook timeouts.
      const validated = {project, lastHash: events.at(-1)!.hash};
      for (const request of requests) {
        rejectSecrets(request.command);
        next = this.persist(tx, request.project_id, request.expected_version,
          request.project_id + ":" + request.idempotency_key, request.command, "owner", fingerprint({...request, actor: "owner"}), validated);
      }
      beforeCommit?.();
      return next;
    });
  }

  confirmActions(input: unknown, sourceRef: {type: "owner_action"; ref: string}, beforeCommit: () => void): Project {
    const review = actionConfirmationSchema.parse(input);
    return this.store.transaction(tx => {
      const requests = review.commands.map((command, index) => {
        requireCondition("owner_action" in command, "OWNER_ACTION_REQUIRED");
        const authorized = commandSchema.parse({...command, owner_action: {...command.owner_action, source_ref: sourceRef}});
        const versioned = authorized.kind === "MODE_OVERRIDE_RESOLVED" || authorized.kind === "SOLUTION_BLUEPRINT_APPROVED" || authorized.kind === "SOLUTION_BLUEPRINT_DELEGATED"
          ? {...authorized, risk_revision: 2 as const} : authorized;
        return {project_id: review.project_id, expected_version: review.project_version + index,
          idempotency_key: "chat-action-review:" + review.review_id + ":" + index, command: versioned};
      });
      const receipts = requests.map(request => tx.receipt(request.project_id + ":" + request.idempotency_key));
      const refreshKey = review.project_id + ":chat-action-review:" + review.review_id + ":blueprint-binding";
      if (receipts.some(Boolean)) {
        requireCondition(receipts.every(Boolean), "CORRUPT_RECEIPT");
        const events = tx.events(review.project_id), byVersion = new Map(events.map(event => [event.version, event]));
        for (const [index, request] of requests.entries()) {
          const receipt = receipts[index]!, event = byVersion.get(request.expected_version + 1);
          requireCondition(receipt.request_hash === fingerprint({...request, actor: "owner"}) && receipt.project_id === review.project_id &&
            receipt.version === request.expected_version + 1 && event?.actor === "owner" &&
            fingerprint(event.command) === fingerprint(request.command), "CORRUPT_RECEIPT");
        }
        // Validate the frozen result once, rather than replaying a long history
        // for every row after a sidecar failure. Later state is checked separately.
        const last = receipts.at(-1)!;
        const refresh = tx.receipt(refreshKey);
        const derived = byVersion.get(last.version + 1);
        if (refresh) requireCondition(refresh.project_id === review.project_id && refresh.version === last.version + 1 &&
          derived?.command.kind === "SOLUTION_BLUEPRINT_BINDING_REFRESHED" && derived.actor === "agent", "CORRUPT_RECEIPT");
        const result = refresh && derived
          ? this.retry(tx, refresh, fingerprint({command: derived.command, actor: derived.actor}))
          : this.retry(tx, last, fingerprint({...requests.at(-1)!, actor: "owner"}));
        const current = events.at(-1)!.version === result.model_version ? result : replay(events);
        requireCondition(fingerprint(tx.snapshot(review.project_id)) === fingerprint(current), "CORRUPT_SNAPSHOT");
        beforeCommit(); return result;
      }
      const events = tx.events(review.project_id), project = replay(events);
      requireCondition(project.model_version === review.project_version, "VERSION_CONFLICT");
      requireCondition(fingerprint(tx.snapshot(review.project_id)) === fingerprint(project), "CORRUPT_SNAPSHOT");
      const validated = {project, lastHash: events.at(-1)!.hash};
      for (const request of requests) {
        rejectSecrets(request.command);
        this.persist(tx, request.project_id, request.expected_version, request.project_id + ":" + request.idempotency_key,
          request.command, "owner", fingerprint({...request, actor: "owner"}), validated);
      }
      const commands = requests.map(request => request.command);
      const refresh = review.preserve_blueprint_choices && (planBlueprintRefresh(project, validated.project, commands) ??
        (commands.some(command => command.kind === "MODE_OVERRIDE_RESOLVED") ? planSandboxBlueprintRefresh(validated.project, events) : undefined));
      if (refresh) this.persist(tx, review.project_id, validated.project.model_version, refreshKey, refresh, "agent",
        fingerprint({command: refresh, actor: "agent"}), validated);
      beforeCommit(); return structuredClone(validated.project);
    });
  }

  findResult(input: unknown, actor: Actor = "agent"): Project | undefined {
    const parsed = requestSchema.safeParse(input);
    requireCondition(parsed.success, "INVALID_COMMAND");
    const request = parsed.data;
    return this.store.transaction((tx) => {
      const receipt = tx.receipt(request.project_id + ":" + request.idempotency_key);
      return receipt ? this.retry(tx, receipt, fingerprint({...request, actor})) : undefined;
    });
  }
  /** Read-only creation retry lookup; create() still verifies the exact request fingerprint. */
  createdProjectId(idempotencyKey: string): string | undefined {
    return this.store.transaction(tx => tx.receipt("create:" + idempotencyKey)?.project_id);
  }

  private retry(tx: StoreTransaction, receipt: {request_hash: string; project_id: string; version: number},
    hash: string): Project {
    requireCondition(receipt.request_hash === hash, "IDEMPOTENCY_KEY_REUSED");
    const events = tx.events(receipt.project_id).filter((e) => e.version <= receipt.version);
    const project = replay(events);
    requireCondition(project.model_version === receipt.version, "CORRUPT_RECEIPT");
    return project;
  }

  private persist(tx: StoreTransaction, id: string, expected: number, key: string, command: Command,
    actor: Actor, requestHash: string, validated?: {project: Project; lastHash: string}): Project {
    requireCondition(actor === "owner" || actor === "agent", "INVALID_ACTOR");
    const events = validated ? undefined : tx.events(id);
    const prior = validated?.project ?? (events?.length ? replay(events) : undefined);
    const snapshot = tx.snapshot(id);
    requireCondition(prior ? fingerprint(snapshot) === fingerprint(prior) : snapshot === undefined, "CORRUPT_SNAPSHOT");
    const actual = prior?.model_version ?? 0;
    if (actual !== expected) throw new DomainError("VERSION_CONFLICT", actual);
    const at = this.clock();
    const version = command.kind === "SCHEMA_MIGRATED"
      ? Number(command.legacy_snapshot.model_version) + 1 : actual + 1;
    const event = { event_id: newId("EVENT-"), project_id: id, version, actor, occurred_at: at,
      command, previous_hash: validated?.lastHash ?? events?.at(-1)?.hash ?? "" };
    requireCondition(eventSchema.omit({hash: true}).safeParse(event).success, "INVALID_EVENT_SCHEMA");
    const next = transition(prior, event);
    if (command.kind === "SCHEMA_MIGRATED") {
      tx.checkpoint({ project_id: id, version: Number(command.legacy_snapshot.model_version),
        kind: "PRE_MIGRATION", content: command.legacy_snapshot, hash: fingerprint(command.legacy_snapshot) });
    }
    const hash = fingerprint(event);
    tx.append({ ...event, hash });
    tx.save(next);
    tx.saveReceipt(key, { request_hash: requestHash, project_id: id, version: next.model_version });
    if (validated) { validated.project = next; validated.lastHash = hash; }
    return structuredClone(next);
  }

  get(projectId: string): Project {
    return this.store.transaction((tx) => {
      const project = replay(tx.events(projectId));
      requireCondition(fingerprint(tx.snapshot(projectId)) === fingerprint(project), "CORRUPT_SNAPSHOT");
      return project;
    });
  }

  resume(projectId: string, sinceVersion?: number) {
    return this.store.transaction((tx) => {
      const events = tx.events(projectId);
      const project = replay(events);
      // Resolve both versions under one storage transaction. A pre-migration
      // version without a replayable event is an unavailable baseline.
      const baselineIndex = sinceVersion === undefined || sinceVersion >= project.model_version
        ? -1 : events.findIndex(event => event.version === sinceVersion);
      return { project, snapshot_consistent: fingerprint(tx.snapshot(projectId)) === fingerprint(project),
        recent_event_ids: events.slice(-10).map((e) => e.event_id),
        blockers: project.open_questions.filter((q) => q.status === "BLOCKING"),
        mode_selection_required: project.delivery_policy === null,
        ...(baselineIndex >= 0 ? {baseline: replay(events.slice(0, baselineIndex + 1))} : {}) };
    });
  }

  history(projectId: string): DomainEvent[] {
    return this.store.transaction((tx) => {
      const events = tx.events(projectId); replay(events); return events;
    });
  }

  checkpoint(projectId: string): void {
    this.store.transaction((tx) => {
      const project = replay(tx.events(projectId));
      requireCondition(fingerprint(tx.snapshot(projectId)) === fingerprint(project), "CORRUPT_SNAPSHOT");
      tx.checkpoint({ project_id: projectId, version: project.model_version, kind: "SNAPSHOT",
        content: project, hash: fingerprint(project) });
    });
  }

  recoverSnapshot(projectId: string): Project {
    return this.store.transaction((tx) => {
      const project = replay(tx.events(projectId));
      tx.save(project);
      return project;
    });
  }

  checkpoints(projectId: string) {
    return this.store.transaction((tx) => {
      const checkpoints = tx.checkpoints(projectId);
      for (const checkpoint of checkpoints) {
        requireCondition(checkpoint.project_id === projectId &&
          checkpoint.hash === fingerprint(checkpoint.content), "CORRUPT_CHECKPOINT");
      }
      return checkpoints;
    });
  }
}
