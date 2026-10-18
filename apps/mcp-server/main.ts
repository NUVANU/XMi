import { dirname, isAbsolute, join, resolve } from "node:path";
import {homedir} from "node:os";
import { pathToFileURL } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SqliteProjectStore } from "../../packages/storage/sqlite.ts";
import { ProjectService } from "../../packages/core/project-service.ts";
import { createXmiServer } from "./server.ts";
import { createModuleReviewRouter } from "../local-module-review/adapter.ts";
import { moduleReviewDirectory } from "../local-module-review/hook.ts";
import { createSingleReviewRouter } from "../local-module-review/single.ts";
import {DocumentReviewRunner} from "./document-review.ts";
import {ProjectWorkspaces} from "./project-workspaces.ts";
import {projectPath} from "../../packages/storage/project-files.ts";

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
  // Local Codex delegates execution to its own fresh-context Agent. Generic hosts
  // retain the core 26-tool workflow; no external provider or CLI is launched here.
  const hostSpecReview = nativeReview ? new DocumentReviewRunner({directory: join(dirname(path), "xmi-spec-reviews"),
    sessions: join(homedir(), ".codex", "sessions"), native: moduleReviewDirectory()}) : undefined;
  const workspaces = new ProjectWorkspaces(join(dirname(path), "xmi-project-locations.sqlite"));
  const server = createXmiServer(service, {storagePath: path, moduleReview, singleReview, hostSpecReview, workspaces,
    workspaceOptions: binding => {
      const reviewer = nativeReview ? new DocumentReviewRunner({directory: projectPath(binding.root, ".xmi", "reviews"),
        sessions: join(homedir(), ".codex", "sessions"), native: moduleReviewDirectory()}) : undefined;
      return {options: {storagePath: binding.database, projectDirectory: binding.root, hostSpecReview: reviewer,
        moduleReview: nativeReview ? createModuleReviewRouter(moduleReviewDirectory(), binding.database, process.env.CODEX_THREAD_ID, binding.service) : undefined,
        singleReview: nativeReview ? createSingleReviewRouter(moduleReviewDirectory(), binding.database, process.env.CODEX_THREAD_ID, binding.service) : undefined},
        close: () => reviewer?.close()};
    }});
  let closed = false;
  const closeStore = () => { if (!closed) { closed = true; hostSpecReview?.close(); store.close(); } };
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
