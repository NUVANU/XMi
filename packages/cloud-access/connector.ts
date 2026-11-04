import {isAbsolute} from "node:path";
import {readFileSync, statSync} from "node:fs";
import {z} from "zod";
import type {ProjectService} from "../core/project-service.ts";
import {replay} from "../core/project-service.ts";
import {DomainError, requireCondition} from "../core/errors.ts";
import {fingerprint} from "../core/validation.ts";
import {outputs} from "../../apps/mcp-server/contracts.ts";
import {hybridEvaluate, projectBinding} from "./client.ts";
import {remoteOperations} from "./contracts.ts";

const connection = z.strictObject({schema_version: z.literal("XMI-HYBRID-CONNECTION/1"),
  endpoint: z.string().url(), project_key: z.string().regex(/^XMIK-[A-Za-z0-9_-]{43}$/)});
export class HybridConnector {
  private endpoint: string;
  private key: string;
  constructor(input: unknown) {
    const parsed = connection.parse(input); this.endpoint = parsed.endpoint; this.key = parsed.project_key;
  }
  binding(signal?: AbortSignal) {return projectBinding(this.endpoint, this.key, signal);}
  private async invoke(service: ProjectService, id: string, operation: string, args: Record<string, unknown>, signal?: AbortSignal) {
    const history = service.history(id), project = replay(history), sha = fingerprint(project);
    requireCondition(fingerprint(service.get(id)) === sha, "PROJECT_VERSION_CONFLICT");
    if (args.expected_version !== undefined) requireCondition(args.expected_version === project.model_version, "PROJECT_VERSION_CONFLICT");
    const result = await hybridEvaluate(this.endpoint, this.key, {operation, project_id: id,
      expected_version: project.model_version, history, arguments: args}, signal);
    requireCondition(!signal?.aborted, "REQUEST_CANCELLED");
    requireCondition(result.project_id === id && result.model_version === project.model_version && result.state_sha256 === sha,
      "HYBRID_RESPONSE_MISMATCH");
    requireCondition(fingerprint(service.get(id)) === sha, "PROJECT_VERSION_CONFLICT");
    return result.result;
  }
  async check(service: ProjectService, id: string, delivery = false, signal?: AbortSignal, candidateHash?: string) {
    const result = await this.invoke(service, id, delivery ? "CHECK_DELIVERY" : "CHECK_LOCAL_WRITE",
      candidateHash && !delivery ? {candidate_hash: candidateHash} : {}, signal);
    requireCondition(result.allowed === true, "HYBRID_RESPONSE_MISMATCH");
  }
  async evaluate(service: ProjectService, id: string, operation: typeof remoteOperations[number], args: Record<string, unknown>, signal?: AbortSignal) {
    // Local directory routing is never sent as an instruction/path to the server.
    const remote = {...args}; delete remote.project_directory;
    const result = await this.invoke(service, id, operation, remote, signal);
    const envelope = outputs[operation].safeParse(result);
    requireCondition(envelope.success, "INVALID_TOOL_OUTPUT");
    const data = envelope.data as {ok: true; data: Record<string, unknown>} | {ok: false; error: {code: string}};
    if (!data.ok) throw new DomainError(data.error.code);
    return data.data;
  }
}

/** Explicit private connection file, outside Product Model/derived process files. No host configuration is changed. */
export function loadHybridConnector(path: string | undefined) {
  requireCondition(path && isAbsolute(path) && !path.startsWith("\\\\") && !path.startsWith("//"), "HYBRID_CONFIG_REQUIRED");
  requireCondition(statSync(path).isFile() && statSync(path).size <= 4096, "HYBRID_CONFIG_INVALID");
  try {return new HybridConnector(JSON.parse(readFileSync(path, "utf8")));}
  catch {throw new DomainError("HYBRID_CONFIG_INVALID");}
}
