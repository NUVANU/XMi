import {homedir} from "node:os";
import {isAbsolute, join, resolve} from "node:path";

export function codexReviewPaths() {
  const configured = process.env.CODEX_HOME;
  if (configured && !isAbsolute(configured)) throw new Error("XMI_CODEX_HOME_MUST_BE_ABSOLUTE");
  const home = configured ? resolve(configured) : join(homedir(), ".codex");
  return {sessions: join(home, "sessions"), reviews: join(home, "xmi-module-reviews")};
}
