import {execFile} from "node:child_process";
import {readFileSync, realpathSync} from "node:fs";
import {basename, dirname, isAbsolute, join} from "node:path";
import {promisify} from "node:util";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js";
import {z} from "zod";
import {projectDirectory} from "../../packages/storage/project-files.ts";

export type CompactionCheckpoint = {
  project_root: string; project_id: string; model_version: number; session_id: string;
  pending_review: "NONE" | "PENDING" | "GRANTED";
};

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
export const xmemCheckpointSchema = z.strictObject({
  project_id: z.string().min(1).max(200), policy_hash: digest, package_id: z.string().min(1).max(200),
});
type XMemCheckpoint = z.infer<typeof xmemCheckpointSchema>;
export type CompactionMemory = {
  save(checkpoint: CompactionCheckpoint): Promise<XMemCheckpoint | null>;
  restore(checkpoint: CompactionCheckpoint, saved: XMemCheckpoint): Promise<boolean>;
};

const configuredServer = z.object({
  name: z.literal("xmem"), enabled: z.literal(true),
  enabled_tools: z.array(z.string()).nullish(), disabled_tools: z.array(z.string()).nullish(),
  transport: z.object({type: z.literal("stdio"), command: z.string(), args: z.tuple([z.string()]),
    cwd: z.string().nullish(), env: z.record(z.string(), z.string()).nullish(), env_vars: z.array(z.string()).nullish()}),
});
const tools = ["xmem_standalone_status", "xmem_session_checkpoint", "xmem_session_start"] as const;
const scoped = z.object({project_root: z.string(), project_id: xmemCheckpointSchema.shape.project_id, policy_hash: digest});
const toolResult = z.object({ok: z.literal(true), value: z.unknown()});
const textResult = z.object({content: z.array(z.object({type: z.literal("text"), text: z.string()})).length(1)});
const exec = promisify(execFile);

// Use the installed Codex configuration. An absent, disabled, remote or
// restricted companion is optional. No policy or storage location is set here.
export function parseLocalXmemConfig(value: unknown) {
  const parsed = configuredServer.safeParse(value);
  if (!parsed.success) return null;
  const {transport: t, enabled_tools, disabled_tools} = parsed.data;
  if (tools.some(tool => (enabled_tools && !enabled_tools.includes(tool)) || disabled_tools?.includes(tool))) return null;
  if (!/^node(?:\.exe)?$/iu.test(basename(t.command)) || (!isAbsolute(t.command) && basename(t.command) !== t.command)) return null;
  const [path] = t.args;
  if (!isAbsolute(path) || !/^engineering-companion\.(?:js|ts)$/u.test(basename(path))) return null;
  try {
    const entry = realpathSync.native(path);
    const source = dirname(entry);
    const packageRoot = basename(dirname(source)) === "dist" ? dirname(dirname(source)) : dirname(source);
    if (basename(source) !== "src" || JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")).name !== "xmem") return null;
    const inherited: Record<string, string> = {};
    for (const key of t.env_vars ?? []) {
      const value = process.env[key];
      if (value !== undefined) inherited[key] = value;
    }
    return {command: t.command, args: [entry], cwd: t.cwd ?? undefined, env: {...inherited, ...t.env}};
  } catch {return null;}
}

async function withLocalXmem<T>(work: (client: Client) => Promise<T>): Promise<T | null> {
  let client: Client | undefined;
  let transport: StdioClientTransport | undefined;
  try {
    const cli = process.env.CODEX_APP_RUNTIME_CLI_PATH ?? (process.platform === "win32" ? "codex.exe" : "codex");
    const {stdout} = await exec(cli, ["mcp", "get", "xmem", "--json"], {timeout: 2000, maxBuffer: 32768, windowsHide: true});
    const config = parseLocalXmemConfig(JSON.parse(stdout));
    if (!config) return null;
    client = new Client({name: "xmi-compaction", version: "1"});
    transport = new StdioClientTransport({...config, stderr: "pipe"});
    transport.stderr?.on("data", () => {});
    await client.connect(transport, {timeout: 2000});
    if (client.getServerVersion()?.name !== "xmem-engineering") return null;
    const names = (await client.listTools({}, {timeout: 1500})).tools.map(tool => tool.name);
    if (!tools.every(tool => names.includes(tool))) return null;
    return await work(client);
  } catch {return null;}
  finally {
    try {if (client) await client.close(); else await transport?.close();} catch { /* Optional companion cleanup. */ }
  }
}

async function call(client: Client, name: typeof tools[number], args: Record<string, unknown>) {
  const result = await client.callTool({name, arguments: args}, undefined, {timeout: 2500});
  if (result.isError) throw new Error("XMEM_TOOL_ERROR");
  if (result.structuredContent !== undefined) return toolResult.parse(result.structuredContent).value;
  const text = textResult.parse(result).content[0]!.text;
  if (Buffer.byteLength(text) > 32768) throw new Error("XMEM_TOOL_RESULT_INVALID");
  return toolResult.parse(JSON.parse(text)).value;
}
function input(checkpoint: CompactionCheckpoint) {
  return {task_ref: "xmi-compaction:" + checkpoint.session_id, task_version: String(checkpoint.model_version),
    payload_budget_bytes: 4000, allowed_source_ids: []};
}
function sameRoot(actual: string, expected: string) {
  return projectDirectory(actual) === expected;
}
export const localXmemCompaction: CompactionMemory = {
  async save(checkpoint) {
    return await withLocalXmem(async client => {
      const project = {project_root: checkpoint.project_root};
      const status = scoped.extend({configured: z.literal(true), policy: z.object({enabled: z.literal(true)})})
        .parse(await call(client, "xmem_standalone_status", project));
      if (!sameRoot(status.project_root, checkpoint.project_root)) return null;
      const saved = scoped.extend({package_id: xmemCheckpointSchema.shape.package_id, selected_for_resume: z.literal(true),
        resume_package_id: xmemCheckpointSchema.shape.package_id}).parse(await call(client, "xmem_session_checkpoint", {
        ...project, input: {...input(checkpoint), completed: [`XMi project ${checkpoint.project_id} at version ${checkpoint.model_version}`],
          pending: checkpoint.pending_review === "NONE" ? [] : ["Read the current XMi review status before acting."],
          blocked: [], next_steps: ["Resume the current Product Model through XMi incremental read."]},
      }));
      if (!sameRoot(saved.project_root, checkpoint.project_root) || saved.project_id !== status.project_id ||
        saved.policy_hash !== status.policy_hash || saved.package_id !== saved.resume_package_id) return null;
      return {project_id: saved.project_id, policy_hash: saved.policy_hash, package_id: saved.package_id};
    });
  },
  async restore(checkpoint, saved) {
    return await withLocalXmem(async client => {
      const restored = scoped.extend({session: z.object({task_ref: z.string(), task_version: z.string()}),
        handoff: z.object({package_id: z.string(), validation: z.object({status: z.literal("VALID")})})})
        .parse(await call(client, "xmem_session_start", {project_root: checkpoint.project_root, input: input(checkpoint)}));
      const expected = input(checkpoint);
      return sameRoot(restored.project_root, checkpoint.project_root) &&
        restored.project_id === saved.project_id && restored.policy_hash === saved.policy_hash &&
        restored.session.task_ref === expected.task_ref && restored.session.task_version === expected.task_version &&
        restored.handoff.package_id === saved.package_id;
    }) ?? false;
  },
};
