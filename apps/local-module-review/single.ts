import {readFileSync, existsSync} from "node:fs";
import {join, isAbsolute} from "node:path";
import {randomUUID, createHash} from "node:crypto";
import {z} from "zod";
import {commandSchema} from "../../packages/shared-types/domain.ts";
import {sourceSchema} from "../../packages/shared-types/domain.ts";
import type {ProjectService} from "../../packages/core/project-service.ts";
import type {Project, Command} from "../../packages/shared-types/domain.ts";
import {requireCondition} from "../../packages/core/errors.ts";
import {itemFingerprint, fingerprint, rejectSecrets} from "../../packages/core/validation.ts";
import {singleReviewRequest, policyReviewRequest} from "../mcp-server/contracts.ts";
import {policyReview} from "../mcp-server/policy-review.ts";
import {blueprintReview, quotedReviewText as quote} from "../mcp-server/blueprint-review.ts";
import {readPending, writeRecord, sessionPattern, withReviewLock, nativeInterruption} from "./adapter.ts";

export const singlePendingSchema = z.strictObject({session_id: z.string().regex(sessionPattern), db_path: z.string(),
  project_id: z.string(), project_version: z.number().int().positive(), review_id: z.string().uuid(),
  review_heading: z.literal("## 单条确认清单\n"), review_text_hash: z.string().regex(/^[a-f0-9]{64}$/),
  review_text_length: z.number().int().positive().max(1024 * 1024), request_hash: z.string(), command_hash: z.string().regex(/^[a-f0-9]{64}$/),
  action: z.enum(["PROPOSE", "APPROVE", "DELEGATE", "REJECT"]), actor: z.enum(["agent", "owner"]),
  item_id: z.string(), item_version: z.number().int().nonnegative(), command: commandSchema.refine(command =>
    ["CANDIDATE_EXTRACTED", "ITEM_CONFIRMED", "ITEM_REJECTED", "DECISION_APPROVED", "SOLUTION_BLUEPRINT_APPROVED", "SOLUTION_BLUEPRINT_DELEGATED",
      "DELIVERY_MODE_SELECTED", "DELIVERY_MODE_UPGRADED", "MODE_OVERRIDE_RESOLVED", "MODE_OVERRIDE_RETRACTED"].includes(command.kind)).nullable(),
  status: z.enum(["PENDING", "GRANTED", "APPLIED", "INVALIDATED", "FAILED"]), turn_id: z.string().optional(),
  grant_source_ref: sourceSchema.optional(),
  native_epoch: z.string().optional(), policy_review: z.boolean().optional(), applied_policy_hash: z.string().optional(),
  applied_version: z.number().int().positive().optional()});
export function readSingle(directory: string, session: string) {
  requireCondition(sessionPattern.test(session), "CHAT_CONFIRMATION_UNAVAILABLE");
  const path = join(directory, session + ".single.json");
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8");
  requireCondition(Buffer.byteLength(text, "utf8") <= 1024 * 1024, "INVALID_REVIEW_RECORD");
  const record = singlePendingSchema.parse(JSON.parse(text));
  requireCondition(!["PENDING", "GRANTED"].includes(record.status) || record.command !== null, "INVALID_REVIEW_RECORD");
  if (["PENDING", "GRANTED"].includes(record.status) && record.command) {
    requireCondition(record.actor === (record.command.kind === "CANDIDATE_EXTRACTED" ? "agent" : "owner"), "INVALID_REVIEW_RECORD");
    const policy = ["DELIVERY_MODE_SELECTED", "DELIVERY_MODE_UPGRADED", "MODE_OVERRIDE_RESOLVED", "MODE_OVERRIDE_RETRACTED"].includes(record.command.kind);
    requireCondition(Boolean(record.policy_review) === policy, "INVALID_REVIEW_RECORD");
  }
  requireCondition(isAbsolute(record.db_path) && !record.db_path.startsWith("\\\\") && !record.db_path.startsWith("//"), "INVALID_REVIEW_RECORD");
  return record;
}
export function createSingleReviewRouter(directory: string, dbPath: string, launchSession?: string, service?: ProjectService) {
  const resolve = (selected?: string) => {
    const session = selected ?? launchSession;
    requireCondition(session && sessionPattern.test(session), "CHAT_CONFIRMATION_SESSION_REQUIRED");
    return session;
  };
  const ready = (session: string) => {
    try {const marker = JSON.parse(readFileSync(join(directory, session + ".host.json"), "utf8"));
      return marker.session_id === session && marker.event === "UserPromptSubmit";} catch {return false;}
  };
  return {
    prepare(project: Project, raw: unknown, selected?: string) {
      const session = resolve(selected);
      return withReviewLock(directory, session, () => {
      requireCondition(ready(session), "CHAT_CONFIRMATION_UNAVAILABLE");
      const request = singleReviewRequest.parse(raw);
      requireCondition(project.project_id === request.project_id && project.model_version === request.expected_version, "VERSION_CONFLICT");
      requireCondition(isAbsolute(dbPath) && !dbPath.startsWith("\\\\") && !dbPath.startsWith("//"), "CHAT_CONFIRMATION_UNAVAILABLE");
      const source = {type: "owner_action" as const, ref: "native-review-pending"};
      let command: Command, action: "PROPOSE" | "APPROVE" | "DELEGATE" | "REJECT", itemVersion: number;
      let content: string;
      const policy = policyReviewRequest.safeParse(request);
      if (policy.success) {
        const review = policyReview(project, policy.data, source);
        command = review.command; action = "APPROVE"; itemVersion = 0; content = review.message;
      } else if (request.operation === "xmi_patch_apply") {
        const candidate = request.patch.candidate;
        requireCondition(candidate.type === "solution_blueprint" && candidate.status === "PROPOSED" && candidate.blueprint_detail, "SINGLE_REVIEW_PATCH_NOT_APPLICABLE");
        requireCondition(!project.items.some(item => item.id === candidate.id), "DUPLICATE_ITEM_ID");
        command = {kind: "CANDIDATE_EXTRACTED", candidate}; action = "PROPOSE"; itemVersion = 0;
        content = blueprintReview(project.title, candidate, action, quote).message;
      } else {
        requireCondition(request.operation === "xmi_item_confirm" || request.operation === "xmi_item_reject", "INVALID_COMMAND");
        const item = project.items.find(item => item.id === request.item_id);
        requireCondition(item && item.version === request.item_version, "ITEM_VERSION_MISMATCH");
        requireCondition(itemFingerprint(item) === request.fingerprint, "FINGERPRINT_MISMATCH");
        itemVersion = item.version;
        if (request.operation === "xmi_item_reject") {
          command = {kind: "ITEM_REJECTED", item_id: item.id, fingerprint: request.fingerprint, reason: request.reason,
            owner_action: {intent: "REJECT", source_ref: source}}; action = "REJECT";
        } else if (item.blueprint_detail) {
          requireCondition(request.solution_disposition, "SOLUTION_DISPOSITION_REQUIRED");
          requireCondition(!request.selected_option_id, "DECISION_SELECTION_NOT_APPLICABLE");
          action = request.solution_disposition === "APPROVE_BLUEPRINT" ? "APPROVE" : "DELEGATE";
          command = action === "APPROVE" ? {kind: "SOLUTION_BLUEPRINT_APPROVED", item_id: item.id, fingerprint: request.fingerprint,
            owner_action: {intent: "APPROVE_BLUEPRINT", source_ref: source}}
            : {kind: "SOLUTION_BLUEPRINT_DELEGATED", item_id: item.id, fingerprint: request.fingerprint, delegated_to: "XDEV",
              boundaries: [...item.blueprint_detail.decisions_delegated_to_xdev], owner_action: {intent: "DELEGATE_BLUEPRINT", source_ref: source}};
        } else {
          requireCondition(!request.solution_disposition, "SOLUTION_DISPOSITION_NOT_APPLICABLE"); action = "APPROVE";
          if (item.decision_detail) {
            const option = request.selected_option_id ?? item.decision_detail.owner_selection;
            requireCondition(option && item.decision_detail.options.some(entry => entry.id === option), "DECISION_SELECTION_REQUIRED");
            command = {kind: "DECISION_APPROVED", item_id: item.id, fingerprint: request.fingerprint, selected_option_id: option,
              owner_action: {intent: "APPROVE_DECISION", source_ref: source}};
          } else {
            requireCondition(!request.selected_option_id, "DECISION_SELECTION_NOT_APPLICABLE");
            command = {kind: "ITEM_CONFIRMED", item_id: item.id, fingerprint: request.fingerprint, owner_action: {intent: "CONFIRM", source_ref: source}};
          }
        }
        if (item.blueprint_detail) content = blueprintReview(project.title, item, action, quote,
          request.operation === "xmi_item_reject" ? request.reason : undefined).message;
        else {
          const impactLabels: Record<string, string> = {user_experience: "用户体验", cost: "成本", complexity: "复杂度", privacy: "隐私", xdev: "开发影响"};
          const detail = item.decision_detail;
          content = ["本次操作：" + (action === "REJECT" ? "拒绝这条内容" : detail ? "批准指定选项" : "采用这条设定"),
            "项目：" + quote(project.title), "条目：" + quote(item.id) + "；版本：" + item.version,
            "完整内容：", quote(item.statement), "类型：" + item.type + "；优先级：" + (item.priority ?? "未指定"),
            ...(item.links?.length ? ["关联条目：", quote(item.links.join("、"))] : []),
            ...(item.tags?.length ? ["范围标记：", quote(item.tags.join("、"))] : []),
            ...(item.supersedes ? ["替代关联（不会自动改变旧条目）：", quote(item.supersedes)] : []),
            ...(detail ? ["需要决定：", quote(detail.question), "原因：", quote(detail.why_it_matters),
              ...detail.options.flatMap(option => ["选项：" + quote(option.id + " — " + option.label),
                ...Object.entries(option.impact).flatMap(([key, value]) => [impactLabels[key] + "：", quote(value)])]),
              "建议选项：" + quote(detail.recommendation.option_id), quote(detail.recommendation.rationale), "建议置信度：" + detail.recommendation.confidence,
              "原有选择：" + quote(detail.owner_selection ?? "尚未选择"),
              "本次批准的选项：" + quote(command.kind === "DECISION_APPROVED" ? command.selected_option_id : "本次只拒绝，不批准选项"),
              "关联需求：" + quote(detail.linked_requirements.join("、")), "关联流程：" + quote(detail.linked_flows.join("、")),
              "替代历史：" + quote(detail.supersession_history.join("、"))] : []),
            ...(request.operation === "xmi_item_reject" ? ["拒绝原因：", quote(request.reason)] : [])].join("\n");
        }
      }
      rejectSecrets(command);
      const requestHash = fingerprint(request);
      const old = readSingle(directory, session);
      const reviewId = old?.status === "PENDING" && old.request_hash === requestHash ? old.review_id : randomUUID();
      const text = "## 单条确认清单\n" + "清单编号：" + reviewId + "\n" + content +
        "\n以上仅适用于这一条及列出的操作。未定项仍待确定，不代表模块完成或产品已就绪。" +
        "\n同意全部内容请回复“确认好了”；需要修改请直接说明，修改后重新展示清单。";
      requireCondition(Buffer.byteLength(text, "utf8") <= 1024 * 1024, "REVIEW_TOO_LARGE");
      const modulePending = readPending(directory, session);
      if (modulePending && ["PENDING", "GRANTED"].includes(modulePending.status)) writeRecord(directory, session, {...modulePending, status: "INVALIDATED"});
      writeRecord(directory, session + ".single", {session_id: session, db_path: dbPath, project_id: project.project_id,
        project_version: project.model_version, review_id: reviewId, review_heading: "## 单条确认清单\n",
        review_text_hash: createHash("sha256").update(text).digest("hex"), review_text_length: text.length, request_hash: requestHash, command_hash: fingerprint(command),
        action, actor: action === "PROPOSE" ? "agent" : "owner", policy_review: policy.success,
        item_id: command.kind === "CANDIDATE_EXTRACTED" ? command.candidate.id : "item_id" in request ? request.item_id : "override_id" in request ? request.override_id : "delivery-policy",
        item_version: itemVersion, command, status: "PENDING"});
      return {project_id: project.project_id, model_version: project.model_version, review_id: reviewId, review_text: text,
        reply: "确认好了" as const, host_ready: true as const, action};
      });
    },
    status(project: Project, selected?: string) {
      const session = resolve(selected), record = readSingle(directory, session);
      const matching = record?.db_path === dbPath && record.project_id === project.project_id;
      const item = matching ? project.items.find(item => item.id === record.item_id) : undefined;
      const stale = matching && ((["PENDING", "GRANTED"].includes(record.status) && record.project_version !== project.model_version) ||
        (record.status === "APPLIED" && (record.policy_review ? record.applied_policy_hash !== fingerprint(project.delivery_policy) : !item || item.version !== record.item_version + 1)));
      return {project_id: project.project_id, model_version: project.model_version, host_ready: ready(session),
        review_id: matching ? record.review_id : null, status: matching ? stale ? "STALE" : record.status : "NONE",
        applied_version: matching ? record.applied_version ?? null : null};
    },
    commit(projectId: string, expectedVersion: number, reviewId: string, selected?: string) {
      const session = resolve(selected);
      return withReviewLock(directory, session, () => {
      const record = readSingle(directory, session);
      requireCondition(service && ready(session) && record?.db_path === dbPath && record.project_id === projectId && record.review_id === reviewId, "CHAT_CONFIRMATION_UNAVAILABLE");
      requireCondition(record.project_version === expectedVersion, "VERSION_CONFLICT");
      if (record.status === "APPLIED") {
        const project = service.get(projectId);
        requireCondition(record.applied_version && record.applied_version <= project.model_version, "INVALID_REVIEW_RECORD");
        return {project_id:projectId,model_version:record.applied_version,next_action:"Already applied. Read canonical state; no new authority or write."};
      }
      requireCondition(record.status === "GRANTED" && record.command && record.grant_source_ref?.type === "owner_action" && record.turn_id &&
        record.grant_source_ref.ref.startsWith("codex-user-prompt:" + session + ":" + record.turn_id + ":"), "NATIVE_OWNER_REPLY_REQUIRED");
      requireCondition(fingerprint(record.command) === record.command_hash, "FINGERPRINT_MISMATCH");
      const unchanged = () => requireCondition(record.native_epoch !== undefined &&
        record.native_epoch === nativeInterruption(directory, session), "NATIVE_OWNER_REPLY_EXPIRED");
      unchanged();
      const source = record.grant_source_ref, command = record.command;
      const authorized = "owner_action" in command ? {...command,owner_action:{...command.owner_action,source_ref:source}}
        : command.kind === "CANDIDATE_EXTRACTED" ? {...command,candidate:{...command.candidate,source_refs:[...command.candidate.source_refs,source]}} : command;
      let project: Project;
      try {
        project = service.execute({project_id:projectId,expected_version:expectedVersion,idempotency_key:"chat-item-review:"+reviewId,command:authorized},record.actor,unchanged);
      } catch (error) {
        writeRecord(directory,session+".single",{...record,command:null,status:"FAILED"}); throw error;
      }
      // A sidecar failure after domain commit retains the existing GRANTED receipt.
      // Retrying the same binding recovers the domain receipt without another write.
      writeRecord(directory,session+".single",{...record,command:null,status:"APPLIED",applied_version:project.model_version,
        ...(record.policy_review ? {applied_policy_hash:fingerprint(project.delivery_policy)} : {})});
      return {project_id:projectId,model_version:project.model_version,next_action:"Read canonical state to verify the exact operation. Saving a proposal remains PROPOSED; no readiness is granted."};
      });
    },
  };
}
