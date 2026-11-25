import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const runtime = join(dirname(fileURLToPath(import.meta.url)), "runtime.json");
const root = JSON.parse(readFileSync(runtime, "utf8")).source_root;
const {runCompactionHook} = await import(pathToFileURL(join(root, "apps/local-module-review/compaction.ts")).href);
await runCompactionHook();
