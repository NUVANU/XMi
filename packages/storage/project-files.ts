import {existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync} from "node:fs";
import {dirname, isAbsolute, join, parse, relative, resolve} from "node:path";
import {randomUUID} from "node:crypto";
import {requireCondition} from "../core/errors.ts";

/** Normalize the chosen local directory without creating anything before consent. */
export function projectDirectory(path: string) {
  requireCondition(isAbsolute(path) && !path.startsWith("\\\\") && !path.startsWith("//") && path.length <= 1000,
    "PROJECT_DIRECTORY_INVALID");
  const target = resolve(path); requireCondition(target !== parse(target).root, "PROJECT_DIRECTORY_INVALID");
  let parent = target; const tail: string[] = [];
  while (!existsSync(parent)) {tail.unshift(relative(dirname(parent), parent)); parent = dirname(parent);}
  requireCondition(lstatSync(parent).isDirectory() || lstatSync(parent).isSymbolicLink(), "PROJECT_DIRECTORY_INVALID");
  return join(realpathSync.native(parent), ...tail);
}

/** All managed children stay inside the selected real root; do not follow junctions. */
export function projectPath(root: string, ...parts: string[]) {
  requireCondition(existsSync(root) && realpathSync.native(root) === root, "PROJECT_DIRECTORY_CHANGED");
  let path = root;
  for (const part of parts) {
    requireCondition(part !== "" && !/[\\/]/u.test(part) && ![".", ".."].includes(part), "PROJECT_DIRECTORY_INVALID");
    path = join(path, part);
    if (existsSync(path)) requireCondition(!lstatSync(path).isSymbolicLink(), "PROJECT_PATH_LINK_REFUSED");
  }
  return path;
}

export function atomicProjectText(path: string, text: string) {
  const temporary = join(dirname(path), ".xmi-write-" + randomUUID() + ".tmp");
  writeFileSync(temporary, text, {flag: "wx", mode: 0o600});
  try {
    const delays = [10, 25, 50, 100];
    for (let attempt = 0; ; attempt++) {
      try {renameSync(temporary, path); break;}
      catch (error) {
        if (process.platform !== "win32" || !["EPERM", "EACCES", "EBUSY"].includes((error as NodeJS.ErrnoException).code ?? "") || attempt >= delays.length) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delays[attempt]);
      }
    }
  } finally {if (existsSync(temporary)) unlinkSync(temporary);}
}

export function boundedProjectJson(path: string) {
  const raw = readFileSync(path, "utf8"); requireCondition(Buffer.byteLength(raw) <= 8 * 1024 * 1024, "PROJECT_FILE_TOO_LARGE");
  return JSON.parse(raw) as unknown;
}

export function ensureProjectDirectory(path: string) {
  mkdirSync(path, {recursive: true}); const root = projectDirectory(path);
  requireCondition(root === path, "PROJECT_DIRECTORY_CHANGED"); return root;
}
