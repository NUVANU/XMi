import {createHash} from "node:crypto";
import {existsSync, readFileSync} from "node:fs";
import {dirname, isAbsolute, join} from "node:path";
import {z} from "zod";
import {DreamKidsDocumentSession} from "../dreamkids-prototype/document-session.ts";
import {designOptions} from "../dreamkids-prototype/design-options.ts";
import {numberedFlow} from "../dreamkids-prototype/flow-order.ts";
import {quotedReviewText} from "../mcp-server/blueprint-review.ts";
import {requireCondition} from "../../packages/core/errors.ts";
import {prototypePreview, prototypePreviewSchema} from "../../packages/core/prototype-preview.ts";
import type {PrototypePreview} from "../../packages/core/prototype-preview.ts";
import {fingerprint} from "../../packages/core/validation.ts";
import type {Project} from "../../packages/shared-types/domain.ts";
import {projectDirectory, projectPath} from "../../packages/storage/project-files.ts";
import {nativeInterruption, readPending, sessionPattern, withReviewLock, writeRecord} from "./adapter.ts";
import {checkReviewDisplay} from "./display-check.ts";
import {readSingle} from "./single.ts";

const heading = "## 第一版设计预览\n";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const recordSchema = z.strictObject({session_id: z.string().regex(sessionPattern), db_path: z.string().refine(isAbsolute),
  model_sha256: hash, preview: prototypePreviewSchema, review_heading: z.literal(heading), review_text_hash: hash,
  review_text_length: z.number().int().positive().max(24000), status: z.enum(["PENDING", "GRANTED", "APPLIED", "INVALIDATED"]),
  grant: z.strictObject({turn_id: z.string().regex(sessionPattern), reply_sha256: hash, native_epoch: z.string(), at: z.iso.datetime(), binding: hash}).optional()});
type Record = z.infer<typeof recordSchema>;
const name = (session: string) => session + ".prototype";

export function readPrototypeReview(directory: string, session: string): Record | null {
  requireCondition(sessionPattern.test(session), "CHAT_CONFIRMATION_SESSION_REQUIRED");
  const path = join(directory, name(session) + ".json");
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8");
  requireCondition(Buffer.byteLength(text) <= 64 * 1024, "INVALID_REVIEW_RECORD");
  return recordSchema.parse(JSON.parse(text));
}

function formalReviewActive(directory: string, session: string) {
  return [readPending(directory, session), readSingle(directory, session)]
    .some(record => record?.status === "PENDING" || record?.status === "GRANTED");
}

function reviewText(preview: PrototypePreview) {
  const chartLabel = (label: string) => label.replace(/[\r\n\t]/gu, " ").replace(/["<>#&\\`%\[\]{}|]/gu, character => `#${character.charCodeAt(0)};`);
  const nodes = numberedFlow(preview.flow);
  const ids = new Map(nodes.map(node => [node.id, `step${node.number}`]));
  const chart = ["```mermaid", "flowchart TB", ...nodes.map(node => {
    const label = `"${chartLabel(node.label)}"`;
    return `  ${ids.get(node.id)}${node.kind === "CHOICE" ? `{${label}}` : `[${label}]`}`;
  }), ...preview.flow.edges.map(edge => `  ${ids.get(edge.from)} -->${edge.label ? `|"${chartLabel(edge.label)}"|` : ""} ${ids.get(edge.to)}`), "```"].join("\n");
  return [heading + quotedReviewText(preview.title + " · " + preview.goal),
    ...(preview.presentation ? ["画面方式 " + preview.presentation] : []),
    "### " + preview.flow_title + "\n\n" + chart,
    "### 第一版和验收\n\n" + preview.first_version.map(({show, check}) => quotedReviewText(show + "\n怎样算做到了？" + check)).join("\n\n"),
    "### 第一版范围\n\n" + preview.defaults.map(({label}) => "- " + label).join("\n"),
    "**聊天选项**\n\n" + designOptions.map(option => "- " + option).join("\n")].join("\n\n");
}

function grantBinding(record: Record, grant: Omit<NonNullable<Record["grant"]>, "binding">) {
  return fingerprint({session_id: record.session_id, db_path: record.db_path, model_sha256: record.model_sha256,
    snapshot_id: record.preview.snapshot_id, review_text_hash: record.review_text_hash, ...grant});
}

/** Called by the genuine UserPromptSubmit hook while its per-session lock is held. */
export function processPrototypePrompt(directory: string, sessions: string, event: {session_id: string; turn_id: string;
  prompt: string; transcript_path?: string | null;}) {
  const record = readPrototypeReview(directory, event.session_id);
  if (!record || !["PENDING", "GRANTED"].includes(record.status)) return "";
  const key = name(event.session_id), reply = event.prompt.trim();
  if (record.status !== "PENDING" || record.session_id !== event.session_id || reply !== designOptions[1] || formalReviewActive(directory, event.session_id)) {
    writeRecord(directory, key, {...record, status: "INVALIDATED", grant: undefined});
    return "";
  }
  const display = checkReviewDisplay(event.transcript_path, sessions, {...record, entire_final: true}, event.prompt);
  if (!display.ok) {
    writeRecord(directory, key, {...record, status: "INVALIDATED"});
    return `XMi 未核验到完整的第一版设计预览（${display.reason}）。保留草稿，先检查显示回执。`;
  }
  const grant = {turn_id: event.turn_id, reply_sha256: sha(reply), native_epoch: nativeInterruption(directory, event.session_id), at: new Date().toISOString()};
  writeRecord(directory, key, {...record, status: "GRANTED", grant: {...grant, binding: grantBinding(record, grant)}});
  return `XMi 已核验用户选择「确认输出开发文档」。现在调用 xmi_prototype_export，project_id=${record.preview.project_id}，expected_version=${record.preview.model_version}，snapshot_id=${record.preview.snapshot_id}，session_id=${event.session_id}。直接返回 XSpec 结果，停止在规格阶段。`;
}

export function createNativePrototypeRouter(directory: string, dbPath: string) {
  return {
    prepare(project: Project, input: unknown, session: string) {
      return withReviewLock(directory, session, () => {
        const marker = join(directory, session + ".host.json");
        const host = existsSync(marker) ? JSON.parse(readFileSync(marker, "utf8")) : null;
        requireCondition(host?.session_id === session && host.event === "UserPromptSubmit", "CHAT_CONFIRMATION_UNAVAILABLE");
        const preview = prototypePreview(project, input);
        requireCondition(!formalReviewActive(directory, session), "CHAT_REVIEW_BUSY");
        const prior = readPrototypeReview(directory, session);
        if (!preview.export_enabled) {
          if (prior?.status === "PENDING") writeRecord(directory, name(session), {...prior, status: "INVALIDATED"});
          return preview;
        }
        const review_text = reviewText(preview);
        const record = recordSchema.parse({session_id: session, db_path: dbPath, preview, model_sha256: fingerprint(project),
          review_heading: heading, review_text_hash: sha(review_text), review_text_length: review_text.length, status: "PENDING"});
        if (prior?.status === "GRANTED" || prior?.status === "APPLIED" && prior.preview.snapshot_id === preview.snapshot_id && prior.model_sha256 === record.model_sha256) {
          requireCondition(prior.preview.snapshot_id === preview.snapshot_id && prior.model_sha256 === record.model_sha256 && prior.db_path === dbPath,
            "CHAT_REVIEW_BUSY");
          return {...preview, native_review: {review_text, state: prior.status}};
        }
        writeRecord(directory, name(session), record);
        return {...preview, native_review: {review_text, state: "PENDING" as const}};
      });
    },
    export(current: () => Project, session: string, snapshotId: string) {
      return withReviewLock(directory, session, () => {
        const record = readPrototypeReview(directory, session), project = current();
        requireCondition(record?.session_id === session && record.preview.snapshot_id === snapshotId && record.db_path === dbPath &&
          record.model_sha256 === fingerprint(project) && record.preview.project_id === project.project_id &&
          ["GRANTED", "APPLIED"].includes(record.status) && record.grant, "NATIVE_OWNER_REPLY_REQUIRED");
        const {binding, ...grant} = record.grant;
        requireCondition(binding === grantBinding(record, grant) && grant.reply_sha256 === sha(designOptions[1]), "FINGERPRINT_MISMATCH");
        requireCondition(record.status === "APPLIED" || grant.native_epoch === nativeInterruption(directory, session), "NATIVE_OWNER_REPLY_EXPIRED");
        const outputDirectory = projectPath(projectDirectory(dirname(dbPath)), "prototype-exports");
        const ownerSourceRef = `codex-user-prompt:${session}:${grant.turn_id}:${grant.reply_sha256}:prototype:${snapshotId}`;
        const prepared = new DreamKidsDocumentSession(project.project_id, current, {outputDirectory, clock: () => grant.at, ownerSourceRef});
        prepared.show(record.preview);
        const result = prepared.selectOption(snapshotId, designOptions[1]);
        requireCondition(result.action === "DOCUMENT_READY" && result.package_directory, "XSPEC_PROTOTYPE_NOT_READY");
        if (record.status !== "APPLIED") writeRecord(directory, name(session), {...record, status: "APPLIED"});
        return {project_id: project.project_id, model_version: project.model_version, snapshot_id: snapshotId,
          spec_version: result.artifact.spec_version, package_directory: result.package_directory, file_count: result.artifact.files.length,
          package_valid: true as const, achieved_level: "PROTOTYPE_READY" as const, readiness: "READY_FOR_XDEV" as const};
      });
    },
  };
}
