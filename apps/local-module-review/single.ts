import {readFileSync, existsSync} from "node:fs";
import {join, isAbsolute} from "node:path";
import {randomUUID, createHash} from "node:crypto";
import {z} from "zod";
import {commandSchema} from "../../packages/shared-types/domain.ts";
import {sourceSchema} from "../../packages/shared-types/domain.ts";
import type {ProjectService} from "../../packages/core/project-service.ts";
import {previewOwnerAction} from "../../packages/core/project-service.ts";
import {ownerReviewCommandSchema} from "../../packages/core/action-confirmation.ts";
import {assessFeasibility} from "../../packages/core/solution-feasibility.ts";
import type {Project, Command} from "../../packages/shared-types/domain.ts";
import {requireCondition} from "../../packages/core/errors.ts";
import {itemFingerprint, fingerprint, rejectSecrets} from "../../packages/core/validation.ts";
import {singleReviewRequest, policyReviewRequest} from "../mcp-server/contracts.ts";
import {policyReview} from "../mcp-server/policy-review.ts";
import {blueprintReview, quotedReviewText as quote} from "../mcp-server/blueprint-review.ts";
import {readPending, writeRecord, sessionPattern, withReviewLock, nativeInterruption} from "./adapter.ts";
import {issueHandlingSchema,handlingRecordSchema,issueHandlingSummary} from "../../packages/core/issue-handling.ts";
import type {IssueHandling,IssueChoice} from "../../packages/core/issue-handling.ts";
import {saveIssueDispositions} from "./issue-dispositions.ts";

export const singlePendingSchema = z.strictObject({session_id: z.string().regex(sessionPattern), db_path: z.string(),
  project_id: z.string(), project_version: z.number().int().positive(), review_id: z.string().uuid(),
  review_heading: z.enum(["## 单条确认清单\n", "## 收尾确认清单\n", "## 审核问题处理清单\n"]), review_text_hash: z.string().regex(/^[a-f0-9]{64}$/),
  review_text_length: z.number().int().positive().max(1024 * 1024), request_hash: z.string(), command_hash: z.string().regex(/^[a-f0-9]{64}$/),
  action: z.enum(["PROPOSE", "APPROVE", "DELEGATE", "REJECT", "BATCH"]), actor: z.enum(["agent", "owner"]),
  item_id: z.string(), item_version: z.number().int().nonnegative(), command: commandSchema.refine(command =>
    ["CANDIDATE_EXTRACTED", "ITEM_CONFIRMED", "ITEM_REJECTED", "DECISION_APPROVED", "SOLUTION_BLUEPRINT_APPROVED", "SOLUTION_BLUEPRINT_DELEGATED",
      "DELIVERY_MODE_SELECTED", "DELIVERY_MODE_UPGRADED", "MODE_OVERRIDE_RESOLVED", "MODE_OVERRIDE_RETRACTED"].includes(command.kind)).nullable(),
  status: z.enum(["PENDING", "GRANTED", "APPLIED", "INVALIDATED", "FAILED"]), turn_id: z.string().optional(),
  grant_source_ref: sourceSchema.optional(),
  native_epoch: z.string().optional(), policy_review: z.boolean().optional(), applied_policy_hash: z.string().optional(),
  applied_version: z.number().int().positive().optional(), validate_after_commit: z.literal(true).optional(),
  issue_handling:handlingRecordSchema.optional()});
export const reviewRecordSchema = singlePendingSchema.extend({commands: z.array(ownerReviewCommandSchema).max(50).nullable().optional(),
  applied_project_hash: z.string().regex(/^[a-f0-9]{64}$/u).optional()});
export function reviewCommandsHash(record: z.infer<typeof reviewRecordSchema>) {return fingerprint(record.action === "BATCH" ? record.commands : record.command);}
export function clearReviewCommands(record: z.infer<typeof reviewRecordSchema>) {
  return {...record, command: null, ...(record.action === "BATCH" ? {commands: null} : {})};
}
export function handledCommands(record:z.infer<typeof reviewRecordSchema>,choices:IssueChoice[]){
  requireCondition(record.action==="BATCH" && record.issue_handling && record.commands?.length===choices.length,"ISSUE_ROWS_MISMATCH");
  const commands:Command[]=[],finalChoices:IssueChoice[]=[];
  for(const choice of choices){const original=record.commands[choice.index-1];requireCondition(original,"INVALID_ISSUE_INDEX");
    let command:Command|undefined,final=choice;
    if(choice.action==="APPLY")command=original;
    if(choice.action==="REVISE"){
      if(record.issue_handling.editable_rows.includes(choice.index) && ["ITEM_CONFIRMED","ITEM_TEXT_REVISED"].includes(original.kind) && "item_id" in original && "fingerprint" in original && choice.value){
        command={kind:"ITEM_TEXT_REVISED",item_id:original.item_id,fingerprint:original.fingerprint,statement:choice.value,
          owner_action:{intent:"REVISE_TEXT",source_ref:{type:"owner_action",ref:"native-review-pending"}}};
      }else final={...choice,action:"UNRESOLVED"};
    }
    if(choice.action==="OPTION"){
      if(original.kind==="DECISION_APPROVED" && choice.value && record.issue_handling.option_rows.find(r=>r.index===choice.index)?.options.includes(choice.value))
        command={...original,selected_option_id:choice.value};
      else final={...choice,action:"UNRESOLVED"};
    }
    if(command){rejectSecrets(command);
      const unchanged=command.kind==="ITEM_TEXT_REVISED" && record.issue_handling.confirmed_text_rows?.some(row=>row.index===choice.index&&row.statement===command.statement);
      if(!unchanged)commands.push(ownerReviewCommandSchema.parse(command));
    }finalChoices.push(final);
  }
  return {commands,choices:finalChoices};
}
export function readSingle(directory: string, session: string) {
  requireCondition(sessionPattern.test(session), "CHAT_CONFIRMATION_UNAVAILABLE");
  const path = join(directory, session + ".single.json");
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8");
  requireCondition(Buffer.byteLength(text, "utf8") <= 1024 * 1024, "INVALID_REVIEW_RECORD");
  const record = reviewRecordSchema.parse(JSON.parse(text));
  requireCondition(record.action === "BATCH" ? record.command === null && record.actor === "owner" &&
    (!["PENDING", "GRANTED"].includes(record.status) || !!record.commands?.length ||
      record.status==="GRANTED" && !!record.issue_handling?.choices?.length && Array.isArray(record.commands)) :
    !record.commands && !record.validate_after_commit &&
      (!["PENDING", "GRANTED"].includes(record.status) || record.command !== null), "INVALID_REVIEW_RECORD");
  if (["PENDING", "GRANTED"].includes(record.status) && record.command) {
    requireCondition(record.actor === (record.command.kind === "CANDIDATE_EXTRACTED" ? "agent" : "owner"), "INVALID_REVIEW_RECORD");
    const policy = ["DELIVERY_MODE_SELECTED", "DELIVERY_MODE_UPGRADED", "MODE_OVERRIDE_RESOLVED", "MODE_OVERRIDE_RETRACTED"].includes(record.command.kind);
    requireCondition(Boolean(record.policy_review) === policy, "INVALID_REVIEW_RECORD");
  }
  requireCondition(isAbsolute(record.db_path) && !record.db_path.startsWith("\\\\") && !record.db_path.startsWith("//"), "INVALID_REVIEW_RECORD");
  return record;
}
function buildAction(project: Project, raw: unknown):{request:z.infer<typeof singleReviewRequest>;command:Command;
  action:"PROPOSE"|"APPROVE"|"DELEGATE"|"REJECT";itemVersion:number;content:string;policyReview:boolean} {
      const request = singleReviewRequest.parse(raw);
      requireCondition(project.project_id === request.project_id && project.model_version === request.expected_version, "VERSION_CONFLICT");
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

      return {request, command, action, itemVersion, content, policyReview: policy.success};
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
  function prepareBatch(project: Project, rows: unknown[], session: string, validateAfterCommit?: true, handling?:IssueHandling) {
    requireCondition(rows.length > 0 && rows.length <= 50, "BATCH_REVIEW_SIZE_INVALID");
    if(handling){handling=issueHandlingSchema.parse(handling);requireCondition(handling.issues.length===rows.length,"ISSUE_ROWS_MISMATCH");
      requireCondition(new Set(handling.issues.map(i=>i.id)).size===rows.length,"DUPLICATE_ISSUE_ID");validateAfterCommit=true;}
    const editableRows:number[]=[],optionRows:{index:number;options:string[]}[]=[],confirmedTextRows:{index:number;statement:string}[]=[];
    let preview = project; const commands: Command[] = [], sections: string[] = [], targets = new Set<string>();
    for (const [index, raw] of rows.entries()) {
      const original = singleReviewRequest.parse(raw);
      requireCondition(original.project_id === project.project_id && original.expected_version === project.model_version, "VERSION_CONFLICT");
      requireCondition(!original.project_directory, "BATCH_DIRECTORY_AT_TOP");
      requireCondition(original.operation !== "xmi_patch_apply", "BATCH_ACTION_NOT_SUPPORTED");
      const target = "item_id" in original ? "item:" + original.item_id : "override_id" in original ? "risk:" + original.override_id : "mode";
      requireCondition(!targets.has(target), "BATCH_DUPLICATE_TARGET"); targets.add(target);
      requireCondition(original.operation !== "xmi_delivery_mode_select" || index === 0, "BATCH_MODE_MUST_BE_FIRST");
      const action = buildAction(preview, {...original, expected_version: preview.model_version});
      const issue=handling?.issues[index];
      const item="item_id" in original?preview.items.find(i=>i.id===original.item_id):undefined;
      if(handling && item && !item.decision_detail && !item.blueprint_detail && !["decision","solution_blueprint"].includes(item.type) && original.operation==="xmi_item_confirm"){
        editableRows.push(index+1);
        if(item.status==="CONFIRMED")confirmedTextRows.push({index:index+1,statement:item.statement});
        if(issue?.replacement_text || item.status==="CONFIRMED")action.command={kind:"ITEM_TEXT_REVISED",item_id:item.id,fingerprint:itemFingerprint(item),statement:issue?.replacement_text??item.statement,
          owner_action:{intent:"REVISE_TEXT",source_ref:{type:"owner_action",ref:"native-review-pending"}}};
      }else requireCondition(!issue?.replacement_text,"ISSUE_TEXT_REVISION_NOT_APPLICABLE");
      if(handling && item?.decision_detail && original.operation==="xmi_item_confirm")optionRows.push({index:index+1,options:item.decision_detail.options.map(o=>o.id)});
      if(issue){if(!issue.affected_ids && item)issue.affected_ids=[item.id];
        requireCondition((issue.affected_ids??[]).every(id=>project.items.some(i=>i.id===id)),"UNKNOWN_ISSUE_SUBJECT");
        action.content=["问题："+quote(issue.problem),...(issue.impact?["影响："+quote(issue.impact)]:[]),
          ...(issue.recommendation?["建议："+quote(issue.recommendation)]:[]),action.content,
          ...(item?.status==="CONFIRMED"&&!issue.replacement_text?["原文已确认。直接给出修改文本即可应用；采纳原文会沿用原决定，不重复写入。"]:[]),
          ...(issue.replacement_text?["原文：",quote(item!.statement),"采纳后完整文本：",quote(issue.replacement_text)]:[])].join("\n");}
      ownerReviewCommandSchema.parse(action.command);
      if(!(action.command.kind==="ITEM_TEXT_REVISED"&&item?.status==="CONFIRMED"&&action.command.statement===item.statement))
        preview = previewOwnerAction(preview, action.command);
      commands.push(action.command);
      sections.push(`### ${index + 1}. ${"item_id" in original ? original.item_id : "override_id" in original ? original.override_id : "交付模式"}\n\n` +
        action.content.replace("风险处置、就绪评估和最终导出仍单独审核。", "本清单列出的风险处置一并审核；就绪校验及最终导出仍按原流程办理。"));
    }
    for (const command of commands) if (command.kind === "SOLUTION_BLUEPRINT_APPROVED" || command.kind === "SOLUTION_BLUEPRINT_DELEGATED") {
      requireCondition(preview.items.find(i => i.id === command.item_id)?.blueprint_detail?.feasibility_fingerprint === assessFeasibility(preview).fingerprint,
        "BATCH_BLUEPRINT_DEPENDENCY_CHANGED");
    }
    const continuation = validateAfterCommit ? {validate_after_commit: true as const} : {};
    const requestHash = fingerprint({project_id: project.project_id, project_version: project.model_version, requests: rows, ...continuation,
      ...(handling?{issue_handling:handling}:{})});
    const old = readSingle(directory, session), reviewId = old?.status === "PENDING" && old.request_hash === requestHash ? old.review_id : randomUUID();
    const heading = handling?"## 审核问题处理清单\n" as const:"## 收尾确认清单\n" as const;
    const text = heading + `清单编号：${reviewId}\n项目版本：${project.model_version}；本次 ${rows.length} 项，按以下顺序一次应用。\n\n` +
      sections.join("\n\n---\n\n") + "\n\n以上只包含本次明确列出的操作，不代表其他未决事项已经解决。各项仍分别保留确认事件和来源；任一项失败则整批不写入。" +
      (validateAfterCommit ? "\n本批成功写入后，XMi 会在同一轮自动校验写入后的版本。校验结果单独报告。" : "") +
      (handling?"\n全部同意以上处理请回复“确认”。需要调整可按编号回复：采纳1、3；2忽略；4暂缓。修改普通文本请写：第2项改为：最终完整文本。选择已列选项可写：第3项选OPTION_ID。某项尚不明确可写：第2项修改；其他同意。本次处理回复本身就是确认，不再追加确认清单；未明确的项目不执行，只补问对应项。处理后自动审核，审核通过后继续独立复审；最终导出另行授权。"
        :"\n全部同意请回复“确认”；需要修改请回复编号和修改内容，修改后重新展示整份清单。不要逐条回复或重复点批准。最终文件导出另行授权。");
    rejectSecrets(text); requireCondition(Buffer.byteLength(text, "utf8") <= 1024 * 1024, "REVIEW_TOO_LARGE");
    const modulePending = readPending(directory, session);
    if (modulePending && ["PENDING", "GRANTED"].includes(modulePending.status)) writeRecord(directory, session, {...modulePending, status: "INVALIDATED"});
    writeRecord(directory, session + ".single", {session_id: session, db_path: dbPath, project_id: project.project_id,
      project_version: project.model_version, review_id: reviewId, review_heading: heading,
      review_text_hash: createHash("sha256").update(text).digest("hex"), review_text_length: text.length,
      request_hash: requestHash, command_hash: fingerprint(commands), command: null, commands, action: "BATCH", actor: "owner",
      item_id: "closing-review", item_version: 0, status: "PENDING", ...continuation,
      ...(handling?{issue_handling:{context:handling,editable_rows:editableRows,option_rows:optionRows,confirmed_text_rows:confirmedTextRows,original_command_hash:fingerprint(commands)}}:{})});
    return {project_id: project.project_id, model_version: project.model_version, review_id: reviewId, review_text: text,
      reply: "确认" as const, host_ready: true as const, action: "BATCH" as const,...(handling?{issue_handling:true as const}:{})};
  }
  return {
    prepare(project: Project, raw: unknown, selected?: string, validateAfterCommit?: true, handling?:IssueHandling) {
      const session = resolve(selected);
      return withReviewLock(directory, session, () => {
      requireCondition(ready(session), "CHAT_CONFIRMATION_UNAVAILABLE");
      requireCondition(isAbsolute(dbPath) && !dbPath.startsWith("\\\\") && !dbPath.startsWith("//"), "CHAT_CONFIRMATION_UNAVAILABLE");
      if (Array.isArray(raw)) return prepareBatch(project, raw, session, validateAfterCommit,handling);
      requireCondition(!handling,"ISSUE_HANDLING_REQUIRES_BATCH");
      const {request, command, action, itemVersion, content, policyReview} = buildAction(project, raw);
      const requestHash = fingerprint(request);
      const old = readSingle(directory, session);
      const reviewId = old?.status === "PENDING" && old.request_hash === requestHash ? old.review_id : randomUUID();
      const text = "## 单条确认清单\n" + "清单编号：" + reviewId + "\n" + content +
        "\n以上仅适用于这一条及列出的操作。未定项仍待确定，不代表模块完成或产品已就绪。" +
        "\n同意全部内容请回复“确认”；需要修改请直接说明，修改后重新展示清单。";
      requireCondition(Buffer.byteLength(text, "utf8") <= 1024 * 1024, "REVIEW_TOO_LARGE");
      const modulePending = readPending(directory, session);
      if (modulePending && ["PENDING", "GRANTED"].includes(modulePending.status)) writeRecord(directory, session, {...modulePending, status: "INVALIDATED"});
      writeRecord(directory, session + ".single", {session_id: session, db_path: dbPath, project_id: project.project_id,
        project_version: project.model_version, review_id: reviewId, review_heading: "## 单条确认清单\n",
        review_text_hash: createHash("sha256").update(text).digest("hex"), review_text_length: text.length, request_hash: requestHash, command_hash: fingerprint(command),
        action, actor: action === "PROPOSE" ? "agent" : "owner", policy_review: policyReview,
        item_id: command.kind === "CANDIDATE_EXTRACTED" ? command.candidate.id : "item_id" in request ? request.item_id : "override_id" in request ? request.override_id : "delivery-policy",
        item_version: itemVersion, command, status: "PENDING"});
      return {project_id: project.project_id, model_version: project.model_version, review_id: reviewId, review_text: text,
        reply: "确认" as const, host_ready: true as const, action};
      });
    },
    status(project: Project, selected?: string) {
      const session = resolve(selected), record = readSingle(directory, session);
      const matching = record?.db_path === dbPath && record.project_id === project.project_id;
      const item = matching ? project.items.find(item => item.id === record.item_id) : undefined;
      const stale = matching && ((["PENDING", "GRANTED"].includes(record.status) && record.project_version !== project.model_version) ||
        (record.status === "APPLIED" && (record.action === "BATCH" ? record.applied_project_hash !== fingerprint(project) :
          record.policy_review ? record.applied_policy_hash !== fingerprint(project.delivery_policy) : !item || item.version !== record.item_version + 1)));
      return {project_id: project.project_id, model_version: project.model_version, host_ready: ready(session),
        review_id: matching ? record.review_id : null, status: matching ? stale ? "STALE" : record.status : "NONE",
        applied_version: matching ? record.applied_version ?? null : null,
        ...(matching && record.issue_handling?.choices?{handling_summary:issueHandlingSummary(record.issue_handling.choices)}:{})};
    },
    commit(projectId: string, expectedVersion: number, reviewId: string, selected?: string) {
      const session = resolve(selected);
      return withReviewLock(directory, session, () => {
      const record = readSingle(directory, session);
      requireCondition(service && ready(session) && record?.db_path === dbPath && record.project_id === projectId && record.review_id === reviewId, "CHAT_CONFIRMATION_UNAVAILABLE");
      requireCondition(record.project_version === expectedVersion, "VERSION_CONFLICT");
      const continuation = record.validate_after_commit ? {validate_after_commit: true as const} : {};
      if (record.status === "APPLIED") {
        const project = service.get(projectId);
        requireCondition(record.applied_version && record.applied_version <= project.model_version, "INVALID_REVIEW_RECORD");
        return {project_id:projectId,model_version:record.applied_version,next_action:"Already applied. Read canonical state; no new authority or write.",
          ...continuation,...(record.issue_handling?.choices?{handling_summary:issueHandlingSummary(record.issue_handling.choices)}:{})};
      }
      requireCondition(record.status === "GRANTED" && (record.action === "BATCH" ? record.commands?.length || record.issue_handling?.choices?.length : record.command) && record.grant_source_ref?.type === "owner_action" && record.turn_id &&
        record.grant_source_ref.ref.startsWith("codex-user-prompt:" + session + ":" + record.turn_id + ":"), "NATIVE_OWNER_REPLY_REQUIRED");
      requireCondition(reviewCommandsHash(record) === record.command_hash, "FINGERPRINT_MISMATCH");
      const unchanged = () => requireCondition(record.native_epoch !== undefined &&
        record.native_epoch === nativeInterruption(directory, session), "NATIVE_OWNER_REPLY_EXPIRED");
      unchanged();
      const source = {type: "owner_action" as const, ref: record.grant_source_ref.ref}, command = record.command;
      const authorized = command && "owner_action" in command ? {...command,owner_action:{...command.owner_action,source_ref:source}}
        : command?.kind === "CANDIDATE_EXTRACTED" ? {...command,candidate:{...command.candidate,source_refs:[...command.candidate.source_refs,source]}} : command;
      let project: Project;
      try {
        project = record.action === "BATCH" ? record.commands?.length?service.confirmActions({project_id: projectId, project_version: expectedVersion,
          review_id: reviewId, commands: record.commands}, source, unchanged):service.get(projectId) :
          service.execute({project_id:projectId,expected_version:expectedVersion,idempotency_key:"chat-item-review:"+reviewId,command:authorized},record.actor,unchanged);
        if(record.action==="BATCH" && !record.commands?.length){requireCondition(project.model_version===expectedVersion,"VERSION_CONFLICT");unchanged();}
      } catch (error) {
        if (record.action !== "BATCH") writeRecord(directory,session+".single",{...record,command:null,status:"FAILED"}); throw error;
      }
      // A sidecar failure after domain commit retains the existing GRANTED receipt.
      // Retrying the same binding recovers the domain receipt without another write.
      if(record.issue_handling?.choices)saveIssueDispositions(directory,projectId,record.issue_handling.choices.map(choice=>{
        const issue=record.issue_handling!.context.issues[choice.index-1]!;
        const ids=issue.affected_ids??[];
        return {review_id:reviewId,project_id:projectId,...(record.issue_handling!.context.source_run_id?{source_run_id:record.issue_handling!.context.source_run_id}:{}),
          issue_id:issue.id,problem:issue.problem,action:choice.action,subject:ids.map(id=>({item_id:id,fingerprint:itemFingerprint(project.items.find(i=>i.id===id)!)})),
          source_ref:source.ref,handled_at_version:project.model_version};
      }));
      writeRecord(directory,session+".single",{...clearReviewCommands(record),status:"APPLIED",applied_version:project.model_version,
        ...(record.action === "BATCH" ? {applied_project_hash: fingerprint(project)} : {}),
        ...(record.policy_review ? {applied_policy_hash:fingerprint(project.delivery_policy)} : {})});
      return {project_id:projectId,model_version:project.model_version,next_action:"Read canonical state to verify the exact operation. Saving a proposal remains PROPOSED; no readiness is granted.",
        ...continuation,...(record.issue_handling?.choices?{handling_summary:issueHandlingSummary(record.issue_handling.choices)}:{})};
      });
    },
  };
}
