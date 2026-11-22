import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)),'runtime.json'),'utf8')).source_root;
const {runStopHook}=await import(pathToFileURL(join(root,'apps/local-module-review/stop-check.ts')).href);
await runStopHook();
