import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Ajv2020 } from "ajv/dist/2020.js";
import { createRequire } from "node:module";
import type { Project, Item, DeliveryMode } from "../shared-types/domain.ts";
import { requireCondition } from "./errors.ts";

const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as typeof import("ajv-formats").default;
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
// Both source execution and emitted dist execution resolve the checked-in contract.
const base = import.meta.url.includes("/dist/packages/")
  ? new URL("../../../schemas/", import.meta.url)
  : new URL("../../schemas/", import.meta.url);
function compileXSpecValidator() {
  const legacy = JSON.parse(readFileSync(new URL("xspec-v0.2.schema.json", base), "utf8"));
  const current = JSON.parse(readFileSync(new URL("xspec.schema.json", base), "utf8"));
  ajv.addSchema(legacy);
  ajv.addSchema(current);
  return ajv.compile({oneOf: [{$ref: legacy.$id}, {$ref: current.$id}]});
}
export const schemaValidators = Object.fromEntries(
  ["xmi-project", "xspec", "readiness-report"].map((name) => [
    name, name === "xspec" ? compileXSpecValidator() : ajv.compile(JSON.parse(readFileSync(new URL(name + ".schema.json", base), "utf8"))),
  ]),
);
export function canonical(value: unknown): string {
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object") {
    return "{" + Object.entries(value).filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v)).join(",") + "}";
  }
  return JSON.stringify(value);
}
export const fingerprint = (value: unknown): string =>
  createHash("sha256").update(canonical(value)).digest("hex");
export function itemFingerprint(item: Item): string {
  const content: Partial<Item> = { ...item };
  delete content.status;
  delete content.confirmed_by;
  delete content.confirmed_at;
  delete content.updated_at;
  return fingerprint(content);
}
export function modeFingerprint(project: Project, mode: DeliveryMode, reason: string): string {
  return fingerprint({ project_id: project.project_id, version: project.model_version,
    policy: project.delivery_policy, mode, reason });
}
export function validateProject(value: unknown): asserts value is Project {
  requireCondition(schemaValidators["xmi-project"]!(value), "INVALID_PROJECT_SCHEMA");
  const project = value as Project;
  const ids = project.items.map((item) => item.id);
  requireCondition(new Set(ids).size === ids.length, "DUPLICATE_ITEM_ID");
  for (const item of project.items) {
    if (item.supersedes) requireCondition(ids.includes(item.supersedes) && item.supersedes !== item.id, "INVALID_SUPERSEDES");
    if (item.decision_detail) {
      requireCondition(item.type === "decision", "DECISION_DETAIL_TYPE_MISMATCH");
      const optionIds = item.decision_detail.options.map((option) => option.id);
      requireCondition(new Set(optionIds).size === optionIds.length, "DUPLICATE_DECISION_OPTION");
      requireCondition(optionIds.includes(item.decision_detail.recommendation.option_id), "INVALID_DECISION_RECOMMENDATION");
      if (item.decision_detail.owner_selection) {
        requireCondition(optionIds.includes(item.decision_detail.owner_selection), "INVALID_DECISION_SELECTION");
      }
      if (item.status === "CONFIRMED") requireCondition(!!item.decision_detail.owner_selection, "DECISION_SELECTION_REQUIRED");
    }
    if (item.type === "solution_blueprint") requireCondition(!!item.blueprint_detail, "BLUEPRINT_DETAIL_REQUIRED");
    if (item.blueprint_detail) {
      requireCondition(item.type === "solution_blueprint", "BLUEPRINT_DETAIL_TYPE_MISMATCH");
      requireCondition(item.id === item.blueprint_detail.blueprint_id, "BLUEPRINT_ID_MISMATCH");
      const optionIds = item.blueprint_detail.options.map((option) => option.id);
      requireCondition(new Set(optionIds).size === optionIds.length, "DUPLICATE_SOLUTION_OPTION");
      requireCondition(optionIds.includes(item.blueprint_detail.recommendation.option_id), "INVALID_SOLUTION_RECOMMENDATION");
      const inputKeys = item.blueprint_detail.feasibility_inputs.map((entry) => entry.key);
      requireCondition(new Set(inputKeys).size === 8, "INVALID_FEASIBILITY_INPUTS");
      if (item.blueprint_detail.model_resolution) {
        requireCondition(!!item.blueprint_detail.ai_capability_profile, "AI_CAPABILITY_PROFILE_REQUIRED");
        requireCondition(item.blueprint_detail.model_resolution.capability_profile_id === item.blueprint_detail.ai_capability_profile.id,
          "MODEL_CAPABILITY_PROFILE_MISMATCH");
      }
      if (item.status === "CONFIRMED") {
        requireCondition(item.blueprint_detail.owner_disposition !== null, "BLUEPRINT_DISPOSITION_REQUIRED");
        if (item.blueprint_detail.owner_disposition === "DELEGATED_TO_XDEV") {
          requireCondition(item.blueprint_detail.delegation?.delegated_to === "XDEV" && item.blueprint_detail.delegation.boundaries.length > 0,
            "BLUEPRINT_DELEGATION_REQUIRED");
        }
      } else {
        requireCondition(item.blueprint_detail.owner_disposition === null && item.blueprint_detail.delegation === null,
          "UNCONFIRMED_BLUEPRINT_HAS_AUTHORITY");
      }
    }
    if (item.status === "SUPERSEDED") requireCondition(item.type === "decision", "INVALID_SUPERSEDED_ITEM");
    if (item.status === "CONFIRMED") {
      requireCondition(item.confirmed_by === "owner" && item.confirmed_at, "MISSING_CONFIRMATION");
    }
  }
}
export function rejectSecrets(value: unknown): void {
  const text = canonical(value);
  requireCondition(!/(?:sk-[a-zA-Z0-9_-]{12,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:password|api[_-]?key|access[_-]?token)\s*[=:]\s*[^\s",}]{6,})/i.test(text),
    "POSSIBLE_SECRET_REMOVE_BEFORE_SAVING");
}
