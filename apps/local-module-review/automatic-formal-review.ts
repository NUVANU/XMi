import {spawn} from "node:child_process";
import {existsSync} from "node:fs";
import {dirname, isAbsolute, join} from "node:path";
import {fileURLToPath} from "node:url";
import type {Project} from "../../packages/shared-types/domain.ts";
import {codexReviewPaths} from "./host-paths.ts";
import {reviewCodexExecutable} from "./codex-formal-executable.ts";

const sourceRunner = fileURLToPath(new URL("../../tools/windows-formal-review.mjs", import.meta.url));
const runner = existsSync(sourceRunner) ? sourceRunner : fileURLToPath(new URL("../../../tools/windows-formal-review.mjs", import.meta.url));
const localPath = (path?: string): path is string =>
  !!path && isAbsolute(path) && !/^[\\/]{2}/u.test(path);

export function requiresFormalReview(project: Project): boolean {
  const policy = project.delivery_policy;
  return policy?.effective_mode === "FAST_DEVELOPMENT" || policy?.effective_mode === "PRODUCT_GRADE" ||
    policy?.effective_mode === "FAST_VALIDATION" && policy.risk_overrides.some(row =>
      row.status === "CONFIRMED" && row.resolution === "UPGRADE_SCOPE" && row.minimum_mode !== "FAST_VALIDATION");
}

/** Activated only by the local plugin's trusted configuration after a genuine finalization. */
export function queueConfirmedFormalReview(project: Project, database: string) {
  if (process.platform !== "win32" || !requiresFormalReview(project)) return;
  const installed = process.env.XMI_FORMAL_REVIEW_INSTALLED_DB;
  const configured = process.env.XMI_FORMAL_REVIEW_CODEX;
  if (!localPath(installed) || !localPath(configured) || !localPath(database)) return;
  const codex = reviewCodexExecutable(configured) ?? configured;
  const config = join(dirname(codexReviewPaths().sessions), "config.toml");
  const args = ["--automatic", "--project-db", database, "--project-id", project.project_id, "--version", String(project.model_version),
    "--installed-db", installed, "--work-dir", join(dirname(installed), "xmi-formal-review-runs"),
    "--codex", codex, "--config", config];
  const child = spawn(process.execPath, [runner, ...args], {stdio: "ignore", windowsHide: true, detached: true});
  child.once("error", () => process.stderr.write("XMI_FORMAL_REVIEW_LAUNCH_FAILED\n"));
  child.unref();
}
