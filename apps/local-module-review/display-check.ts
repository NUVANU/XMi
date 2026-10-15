import { openSync, closeSync, fstatSync, readSync, realpathSync } from "node:fs";
import { relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
type DisplayBinding = {session_id: string; review_text_hash: string; review_text_length: number;
  review?: {module: string}; review_heading?: string};

// Transcript format is not a platform contract. Only these observed final phases are accepted;
// an unsupported/partial log fails closed instead of guessing what the Owner saw.
type DisplayCheckReason = "MATCH" | "NO_TRANSCRIPT_PATH" | "PATH_OUTSIDE_SESSIONS" | "SESSION_MISMATCH" |
  "INVALID_LOG" | "UNSUPPORTED_FINAL_CONTENT" | "NO_CURRENT_FINAL" | "REVIEW_NOT_IN_FINAL" |
  "REVIEW_DIGEST_MISMATCH" | "READ_FAILED";
export type DisplayCheck = {ok: boolean; reason: DisplayCheckReason; transcript_path_hash?: string;
  bytes?: number; last_final_phase?: string; read_error?: string};

export function checkReviewDisplay(path: string | null | undefined, sessionDirectory: string,
  pending: DisplayBinding, currentPrompt: string): DisplayCheck {
  const diagnostic: Omit<DisplayCheck, "ok" | "reason"> = {};
  const result = (reason: DisplayCheckReason): DisplayCheck => ({ok: reason === "MATCH", reason, ...diagnostic});
  if (!path) return result("NO_TRANSCRIPT_PATH");
  diagnostic.transcript_path_hash = createHash("sha256").update(path).digest("hex");
  // Native prompt eligibility already trims edges. Apply the same rule to its
  // transcript copy, where Codex may append a newline; never normalize the review.
  const reply = currentPrompt.trim();
  let fd: number | undefined;
  try {
    // Windows hooks may deliver a \\?\ path. The JS realpath implementation
    // misreports those files as EISDIR; native resolves them with the same scope check.
    const actual = realpathSync.native(path);
    const scope = relative(realpathSync.native(sessionDirectory), actual);
    if (!scope || scope.startsWith("..") || isAbsolute(scope)) return result("PATH_OUTSIDE_SESSIONS");
    fd = openSync(actual, "r");
    const size = fstatSync(fd).size;
    diagnostic.bytes = size;
    const head = Buffer.alloc(Math.min(size, 256 * 1024));
    readSync(fd, head, 0, head.length, 0);
    let header;
    try { header = JSON.parse(head.toString("utf8").split("\n")[0]!); }
    catch { return result("INVALID_LOG"); }
    if (header.type !== "session_meta" || header.payload?.id !== pending.session_id) return result("SESSION_MISMATCH");
    const offset = Math.max(0, size - 4 * 1024 * 1024);
    const tail = Buffer.alloc(size - offset);
    readSync(fd, tail, 0, tail.length, offset);
    const lines = tail.toString("utf8").split("\n");
    if (offset > 0) lines.shift();
    let lastFinal: string | undefined;
    for (const line of lines) {
      if (!line.trim()) continue;
      let row;
      try { row = JSON.parse(line); }
      catch { return result("INVALID_LOG"); }
      if (row.type !== "response_item" || row.payload?.type !== "message") continue;
      const message = row.payload;
      if (message.role === "user" && lastFinal) {
        // Codex records injected project, environment and open-page context as user messages.
        // Skip only explicit host metadata; unknown or mixed kinds still expire the list.
        const kinds: unknown = message.internal_chat_message_metadata_passthrough?.content_item_kinds;
        if (Array.isArray(kinds) && kinds.length > 0 && kinds.every(kind =>
          kind === "agents_md.instructions" || kind === "environments.environment_context" ||
          kind === "additional_content.codex_apps_open_page")) continue;
        const text = message.content?.map((part: {text?: string}) => part.text ?? "").join("\n");
        if (text?.trim() !== reply) lastFinal = undefined;
      }
      if (message.role === "assistant" && (message.phase === "final" || message.phase === "final_answer")) {
        diagnostic.last_final_phase = message.phase;
        if (!Array.isArray(message.content) || message.content.some((part: {type?: string; text?: string}) =>
          part.type !== "output_text" || typeof part.text !== "string")) return result("UNSUPPORTED_FINAL_CONTENT");
        lastFinal = message.content.map((part: {text: string}) => part.text).join("\n").replaceAll("\r\n", "\n");
      }
    }
    if (!lastFinal) return result("NO_CURRENT_FINAL");
    const heading = pending.review_heading ?? (pending.review ? "## " + pending.review.module + "：模块确认清单\n" : undefined);
    if (!heading) return result("REVIEW_NOT_IN_FINAL");
    const start = lastFinal.indexOf(heading);
    if (start < 0) return result("REVIEW_NOT_IN_FINAL");
    const shown = lastFinal.slice(start, start + pending.review_text_length);
    return result(createHash("sha256").update(shown).digest("hex") === pending.review_text_hash ? "MATCH" : "REVIEW_DIGEST_MISMATCH");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (typeof code === "string" && /^[A-Z_]+$/.test(code)) diagnostic.read_error = code;
    return result("READ_FAILED");
  }
  finally { if (fd !== undefined) closeSync(fd); }
}

export function wasReviewDisplayed(path: string | null | undefined, sessionDirectory: string,
  pending: DisplayBinding, currentPrompt: string): boolean {
  return checkReviewDisplay(path, sessionDirectory, pending, currentPrompt).ok;
}
