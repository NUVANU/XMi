import { randomUUID } from "node:crypto";
import { z } from "zod";
import { commandSchema, eventSchema, productProfileSchema } from "../shared-types/domain.ts";
import type { Actor, Command, DomainEvent, Project, DeliveryMode } from "../shared-types/domain.ts";
import type { ProjectStore, StoreTransaction } from "../storage/store.ts";
import { DomainError, requireCondition } from "./errors.ts";
import { fingerprint, itemFingerprint, modeFingerprint, validateProject, rejectSecrets } from "./validation.ts";
import { evaluateRisk, evaluateRiskLegacy, exclusionScopeIssues, riskResolutionRevision, invalidRiskOverrides } from "./completeness-service.ts";
import { assessFeasibility } from "./solution-feasibility.ts";
import { solutionBlockingInputs } from "./solution-options.ts";
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
      }
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
        const result = this.retry(tx, receipts.at(-1)!, fingerprint({...requests.at(-1)!, actor: "owner"}));
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

  resume(projectId: string) {
    return this.store.transaction((tx) => {
      const events = tx.events(projectId);
      const project = replay(events);
      return { project, snapshot_consistent: fingerprint(tx.snapshot(projectId)) === fingerprint(project),
        recent_event_ids: events.slice(-10).map((e) => e.event_id),
        blockers: project.open_questions.filter((q) => q.status === "BLOCKING"),
        mode_selection_required: project.delivery_policy === null };
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
