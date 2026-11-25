import {readdirSync, realpathSync, statSync} from "node:fs";
import {basename, delimiter, dirname, isAbsolute, join} from "node:path";

const releaseDirectory = /^[a-f0-9]{16}$/iu;
const samePath = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

export function reviewCodexExecutable(configured: string, searchPath = process.env.PATH ?? ""): string | undefined {
  if (!isAbsolute(configured) || !samePath(basename(configured), "codex.exe")) return;
  const available = (path: string) => {
    try {return statSync(path).isFile() ? realpathSync.native(path) : undefined;}
    catch {return undefined;}
  };
  const pinned = available(configured);
  if (!releaseDirectory.test(basename(dirname(configured)))) return pinned;
  const root = dirname(dirname(configured));
  let canonicalRoot: string;
  try {canonicalRoot = realpathSync.native(root);}
  catch {return pinned;}
  const resolveRelease = (folder: string) => {
    if (!releaseDirectory.test(basename(folder))) return;
    const candidate = available(join(folder, "codex.exe"));
    if (candidate && samePath(dirname(dirname(candidate)), canonicalRoot) && releaseDirectory.test(basename(dirname(candidate)))) return candidate;
  };
  for (const path of searchPath.split(delimiter)) {
    const folder = path.replace(/^"|"$/gu, "");
    if (!isAbsolute(folder) || !samePath(dirname(folder), root)) continue;
    const current = resolveRelease(folder);
    if (current) return current;
  }
  if (pinned) return pinned;
  const releases = readdirSync(canonicalRoot, {withFileTypes: true}).flatMap(entry => {
    const candidate = entry.isDirectory() ? resolveRelease(join(canonicalRoot, entry.name)) : undefined;
    return candidate ? [candidate] : [];
  });
  return releases.length === 1 ? releases[0] : undefined;
}
