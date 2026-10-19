import {closeSync, existsSync, fstatSync, globSync, openSync, readSync, realpathSync} from "node:fs";
import {dirname, isAbsolute, join, relative, resolve} from "node:path";
import {createHash} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {requireCondition} from "../../packages/core/errors.ts";
import type {HostReviewBinding} from "../../packages/core/spec-review-service.ts";
import {buildReviewTransport, reviewPagePath, transportLimits, verifyReviewPages} from "./review-transport.ts";

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const digest = (text: string | Uint8Array) => createHash("sha256").update(text).digest("hex");
const limit = 8 * 1024 * 1024;
type Row = {type: string; payload: Record<string, unknown>};
function read(path: string, offset = 0, bytes = limit): Buffer {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    requireCondition(offset <= size && size - offset <= bytes, "HOST_REVIEW_LOG_LIMIT");
    const buffer = Buffer.alloc(size - offset);
    requireCondition(readSync(fd, buffer, 0, buffer.length, offset) === buffer.length, "HOST_REVIEW_LOG_READ_FAILED");
    return buffer;
  } finally {closeSync(fd);}
}
function below(root: string, path: string): string {
  const actual = realpathSync.native(path), scope = relative(realpathSync.native(root), actual);
  requireCondition(!!scope && !scope.startsWith("..") && !isAbsolute(scope), "HOST_REVIEW_PATH_OUTSIDE_SESSIONS");
  return actual;
}
function header(path: string): Record<string, unknown> {
  const fd = openSync(path, "r");
  try {
    const b = Buffer.alloc(Math.min(fstatSync(fd).size, 512 * 1024)); readSync(fd, b, 0, b.length, 0);
    const end = b.indexOf(10); requireCondition(end >= 0, "HOST_REVIEW_LOG_HEADER_INVALID");
    const row = JSON.parse(b.subarray(0, end).toString("utf8"));
    requireCondition(row.type === "session_meta" && row.payload, "HOST_REVIEW_LOG_HEADER_INVALID");
    return row.payload;
  } finally {closeSync(fd);}
}
export function nativeSessionLog(root: string, session: string): string {
  requireCondition(uuid.test(session), "HOST_REVIEW_SESSION_REQUIRED");
  const paths = [...globSync(`*/*/*/*${session}*.jsonl`, {cwd: root})]
    .map(path => below(root, resolve(root, path))).filter(path => header(path).id === session);
  if (paths.length === 1) return paths[0]!;
  requireCondition(paths.length > 1, "HOST_REVIEW_NATIVE_LOG_UNAVAILABLE");
  // A resumed thread can have several logs with the same session header. Only
  // the host's own exact thread -> rollout route may disambiguate them. This is
  // the observed state_5 format, not a claim that the private schema is stable.
  // Never create/migrate the native index or guess from filename/mtime.
  const indexPath = join(dirname(root), "state_5.sqlite");
  requireCondition(existsSync(indexPath), "HOST_REVIEW_NATIVE_LOG_UNAVAILABLE");
  let db: DatabaseSync | undefined;
  let routed: unknown;
  try {
    db = new DatabaseSync(indexPath, {readOnly: true});
    const routes = db.prepare("SELECT id, rollout_path FROM threads WHERE id=? LIMIT 2").all(session);
    if (routes.length === 1 && routes[0]!.id === session) routed = routes[0]!.rollout_path;
  } catch { /* Missing/unsupported/locked index remains unavailable, never a guess. */ }
  finally {db?.close();}
  requireCondition(typeof routed === "string" && routed.length > 0 && routed.length <= 4000,
    "HOST_REVIEW_NATIVE_LOG_UNAVAILABLE");
  const actual = below(root, routed);
  requireCondition(paths.some(path => relative(path, actual) === "") && header(actual).id === session,
    "HOST_REVIEW_NATIVE_LOG_UNAVAILABLE");
  return actual;
}
function anchor(path: string, offset: number): string {
  const fd = openSync(path, "r");
  try {
    requireCondition(fstatSync(fd).size >= offset, "HOST_REVIEW_LOG_REPLACED");
    const b = Buffer.alloc(Math.min(offset, 4096)); readSync(fd, b, 0, b.length, offset - b.length);
    return digest(b);
  } finally {closeSync(fd);}
}
export function freezeNativePosition(root: string, session: string) {
  const path = nativeSessionLog(root, session), fd = openSync(path, "r");
  let size: number;
  try {size = fstatSync(fd).size;} finally {closeSync(fd);}
  // A partially appended line is not an eligible launch boundary.
  const tailFd = openSync(path, "r"); let tail: Buffer;
  try {tail = Buffer.alloc(Math.min(size, 4096)); readSync(tailFd, tail, 0, tail.length, size - tail.length);}
  finally {closeSync(tailFd);}
  const end = tail.lastIndexOf(10); requireCondition(end >= 0, "HOST_REVIEW_LOG_PARTIAL");
  const offset = size - tail.length + end + 1;
  return {parent_log: relative(root, path), parent_offset: offset, parent_anchor: anchor(path, offset)};
}
function rows(text: string): Row[] {
  requireCondition(!text || text.endsWith("\n"), "HOST_REVIEW_LOG_PARTIAL");
  return text.split("\n").filter(line => line.trim()).map(line => JSON.parse(line));
}
function parseArguments(value: unknown): Record<string, unknown> {
  requireCondition(typeof value === "string", "HOST_REVIEW_SPAWN_INVALID");
  return JSON.parse(value);
}
function agentFinal(text: unknown, agentPath: string): string {
  requireCondition(typeof text === "string", "HOST_REVIEW_RESULT_UNAVAILABLE");
  const prefix = `Message Type: FINAL_ANSWER\nTask name: ${agentPath.slice(0, agentPath.lastIndexOf("/"))}\nSender: ${agentPath}\nPayload:\n`;
  requireCondition(text.startsWith(prefix), "HOST_REVIEW_RESULT_SOURCE_MISMATCH");
  return text.slice(prefix.length).trim();
}
export function materialReadCommand(path: string): string {
  return `Get-Content -LiteralPath '${path.replaceAll("'", "''")}' -Raw`;
}
function exactPageOutput(value: unknown, page: string): boolean {
  return typeof value === "string" && (value === page || value === page + "\n" || value === page + "\r\n");
}
export function observeNativeReview(root: string, binding: HostReviewBinding, packet: string):
  {state: "AWAITING_AGENT" | "RUNNING"} | {state: "COMPLETED"; response: unknown; agent_id: string; response_sha256: string} {
  const parent = below(root, resolve(root, binding.parent_log));
  requireCondition(header(parent).id === binding.session_id && anchor(parent, binding.parent_offset) === binding.parent_anchor,
    "HOST_REVIEW_LOG_REPLACED");
  const appended = rows(read(parent, binding.parent_offset).toString("utf8"));
  const calls = appended.filter(r => r.type === "response_item" && r.payload.type === "function_call" &&
    r.payload.namespace === "collaboration" && r.payload.name === "spawn_agent")
    .filter(r => parseArguments(r.payload.arguments).task_name === binding.task_name);
  requireCondition(calls.length <= 1, "HOST_REVIEW_MULTIPLE_AGENTS");
  if (!calls.length) return {state: "AWAITING_AGENT"};
  const call = calls[0]!, args = parseArguments(call.payload.arguments);
  requireCondition(args.fork_turns === "none", "HOST_REVIEW_FRESH_CONTEXT_REQUIRED");
  const activities = appended.filter(r => r.type === "event_msg" && r.payload.type === "item_completed")
    .map(r => r.payload.item as Record<string, unknown>).filter(item => item?.type === "SubAgentActivity");
  const started = activities.find(item => item.id === call.payload.call_id && item.kind === "started");
  if (!started) return {state: "RUNNING"};
  const agentId = started.agent_thread_id, agentPath = started.agent_path;
  requireCondition(typeof agentId === "string" && uuid.test(agentId) && typeof agentPath === "string" &&
    agentPath.endsWith("/" + binding.task_name), "HOST_REVIEW_SPAWN_INVALID");
  for (const r of appended) if (r.type === "response_item" && r.payload.type === "function_call" &&
    r.payload.namespace === "collaboration" && ["send_message", "followup_task", "interrupt_agent"].includes(String(r.payload.name))) {
    const a = parseArguments(r.payload.arguments);
    requireCondition(![agentPath, binding.task_name, agentId].includes(String(a.target)), "HOST_REVIEW_AGENT_STEERED");
  }
  if (!activities.some(item => item.kind === "completed" && item.agent_thread_id === agentId && item.agent_path === agentPath))
    return {state: "RUNNING"};
  const messages = appended.filter(r => r.type === "response_item" && r.payload.type === "agent_message" &&
    r.payload.author === agentPath && r.payload.recipient === agentPath.slice(0, agentPath.lastIndexOf("/")));
  const results = messages.flatMap(r => (r.payload.content as {type: string; text?: string}[] ?? [])
    .filter(c => c.type === "input_text" && c.text?.startsWith("Message Type: FINAL_ANSWER\n")).map(c => agentFinal(c.text, agentPath)));
  requireCondition(results.length <= 1, "HOST_REVIEW_MULTIPLE_RESULTS");
  if (!results.length) return {state: "RUNNING"};
  const child = nativeSessionLog(root, agentId), meta = header(child);
  const source = meta.source as {subagent?: {thread_spawn?: {parent_thread_id?: string; agent_path?: string}}};
  requireCondition(meta.parent_thread_id === binding.session_id && meta.thread_source === "subagent" &&
    source?.subagent?.thread_spawn?.parent_thread_id === binding.session_id &&
    source.subagent.thread_spawn.agent_path === agentPath, "HOST_REVIEW_CHILD_SOURCE_MISMATCH");
  const childRows = rows(read(child, 0, binding.transport ? transportLimits.child_log_bytes : limit).toString("utf8"));
  requireCondition(binding.purpose === "DOCUMENT_REVIEW" || !childRows.some(r => r.type === "compacted" || ["context_compacted", "compaction"].includes(String(r.payload?.type))),
    "HOST_REVIEW_CONTEXT_INCOMPLETE");
  const outputs = childRows.filter(r => r.type === "response_item" && r.payload.type === "message" &&
    r.payload.role === "assistant" && ["final", "final_answer"].includes(String(r.payload.phase)))
    .map(r => (r.payload.content as {type: string; text?: string}[]).map(c => {
      requireCondition(c.type === "output_text" && typeof c.text === "string", "HOST_REVIEW_FINAL_INVALID"); return c.text;
    }).join("\n").trim());
  requireCondition(outputs.length === 1 && outputs[0] === results[0] && Buffer.byteLength(outputs[0]!) <= 256 * 1024,
    "HOST_REVIEW_RESULT_SOURCE_MISMATCH");
  const commands = childRows.filter(r => r.type === "event_msg" && r.payload.type === "item_completed")
    .map(r => r.payload.item as Record<string, unknown>);
  const reads = commands.filter(item => item?.type === "CommandExecution");
  const pages = binding.transport ? buildReviewTransport(packet).pages : [packet];
  requireCondition(reads.every((item, i) => Array.isArray(item.command) &&
    item.command.at(-1) === materialReadCommand(binding.transport ? reviewPagePath(binding.material_path, i) : binding.material_path)),
    "HOST_REVIEW_UNEXPECTED_TOOL");
  requireCondition(reads.length === pages.length && reads.every((item, i) => item.status === "completed" &&
    exactPageOutput(item.aggregated_output, pages[i]!)),
    binding.transport ? "HOST_REVIEW_DELIVERY_INCOMPLETE" : "HOST_REVIEW_FULL_MATERIAL_NOT_OBSERVED");
  if (binding.transport) verifyReviewPages(pages, binding.transport, packet);
  const toolCalls = childRows.filter(r => r.type === "response_item" &&
    ["function_call", "custom_tool_call"].includes(String(r.payload.type)));
  requireCondition(toolCalls.length === pages.length && toolCalls.every(r => r.payload.type === "custom_tool_call" &&
    r.payload.name === "exec" && [undefined, "functions"].includes(r.payload.namespace as string | undefined)),
    "HOST_REVIEW_UNEXPECTED_TOOL");
  if (binding.transport) {
    // Native command persistence and the outer tool delivery have separate
    // truncation budgets. Both must contain the same complete page.
    const deliveries = childRows.filter(r => r.type === "response_item" && r.payload.type === "custom_tool_call_output");
    requireCondition(new Set(toolCalls.map(r => r.payload.call_id)).size === pages.length &&
      deliveries.length === pages.length && deliveries.every((r, i) => {
      const output = r.payload.output as {type: string; text: string}[];
      return r.payload.call_id === toolCalls[i]!.payload.call_id && Array.isArray(output) && output.length === 2 &&
        output.every(b => b.type === "input_text" && typeof b.text === "string") &&
        /^Script completed\nWall time [\d.]+ seconds\nOutput:\n$/u.test(output[0]!.text) && exactPageOutput(output[1]!.text, pages[i]!);
    }), "HOST_REVIEW_TOOL_DELIVERY_INCOMPLETE");
    const counts = childRows.filter(r => r.type === "event_msg" && r.payload.type === "token_count");
    requireCondition(binding.purpose === "DOCUMENT_REVIEW" || counts.length > 0 && counts.every(r => {
      const info = r.payload.info as {model_context_window?: number; last_token_usage?: {total_tokens?: number}} | null;
      return !!info && typeof info.model_context_window === "number" && typeof info.last_token_usage?.total_tokens === "number" &&
        info.last_token_usage.total_tokens <= info.model_context_window - 32768;
    }), "HOST_REVIEW_CONTEXT_CAPACITY_UNVERIFIED");
  }
  requireCondition(commands.every(item => !item?.type || ["CommandExecution", "Reasoning", "AgentMessage"].includes(String(item.type))),
    "HOST_REVIEW_UNEXPECTED_ACTIVITY");
  return {state: "COMPLETED", response: JSON.parse(outputs[0]!), agent_id: agentId, response_sha256: digest(outputs[0]!)};
}
