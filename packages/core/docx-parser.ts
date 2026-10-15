import {execFile} from "node:child_process";
import {fileURLToPath} from "node:url";
import {DomainError, requireCondition} from "./errors.ts";

export function extractDocxText(bytes: Uint8Array): Promise<string> {
  requireCondition(bytes.length > 0 && bytes.length <= 5 * 1024 * 1024, "DOCUMENT_SIZE_INVALID");
  const worker = fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "./docx-worker.ts" : "./docx-worker.js", import.meta.url));
  // Retain only Windows runtime essentials; never pass API tokens or NODE_OPTIONS.
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["SystemRoot", "WINDIR", "TEMP", "TMP"]) if (process.env[key]) env[key] = process.env[key];
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, ["--max-old-space-size=128", worker], {
      env, windowsHide: true, timeout: 10000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024, encoding: "utf8",
    }, (error, stdout) => {
      if (error) reject(new DomainError(error.killed || String(error.code) === "2" || error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
        ? "DOCUMENT_PARSE_LIMIT" : "DOCUMENT_PARSE_FAILED"));
      else resolve(stdout);
    });
    child.stdin?.on("error", () => { /* The exit callback reports a sanitized failure. */ });
    child.stdin?.end(bytes);
  });
}
