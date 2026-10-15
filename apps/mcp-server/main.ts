import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SqliteProjectStore } from "../../packages/storage/sqlite.ts";
import { ProjectService } from "../../packages/core/project-service.ts";
import { createXmiServer } from "./server.ts";
import { createModuleReviewRouter } from "../local-module-review/adapter.ts";
import { moduleReviewDirectory } from "../local-module-review/hook.ts";
import { createSingleReviewRouter } from "../local-module-review/single.ts";

async function main(nativeReview: boolean) {
  const [flag, path, ...extra] = process.argv.slice(2);
  if (flag !== "--db" || !path || !isAbsolute(path) || path.startsWith("\\\\") || path.startsWith("//") || extra.length) {
    process.stderr.write("XMI_STARTUP_INVALID_ARGUMENTS: provide --db with an absolute local SQLite path.\n");
    process.exitCode = 1;
    return;
  }
  const store = new SqliteProjectStore(path);
  const service = new ProjectService(store);
  const moduleReview = nativeReview ? createModuleReviewRouter(moduleReviewDirectory(), path, process.env.CODEX_THREAD_ID, service) : undefined;
  const singleReview = nativeReview ? createSingleReviewRouter(moduleReviewDirectory(), path, process.env.CODEX_THREAD_ID, service) : undefined;
  const server = createXmiServer(service, {storagePath: path, moduleReview, singleReview});
  let closed = false;
  const closeStore = () => { if (!closed) { closed = true; store.close(); } };
  server.onclose = closeStore;
  server.onerror = () => { process.stderr.write("XMI_PROTOCOL_ERROR\n"); };
  process.once("SIGINT", () => { void server.close().finally(closeStore); });
  process.once("SIGTERM", () => { void server.close().finally(closeStore); });
  process.stdin.once("end", () => { void server.close().finally(closeStore); });
  try {
    await server.connect(new StdioServerTransport(process.stdin, process.stdout, {maxBufferSize: 131072}));
  } catch {
    closeStore(); throw new Error("STARTUP");
  }
}
export function startXmi(nativeReview: boolean) {
  return main(nativeReview).catch(() => {
    process.stderr.write("XMI_STARTUP_FAILED: inspect local path and database permissions; no raw payload logged.\n");
    process.exitCode = 1;
  });
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) void startXmi(true);
