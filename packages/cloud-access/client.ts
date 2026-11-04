import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StreamableHTTPClientTransport} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {accessView, bindingView, hybridResponse, hybridError, hybridInputLimit} from "./contracts.ts";
import {DomainError} from "../core/errors.ts";

/** Client-side check for the hybrid connector; does not upload Product Model data. */
async function cloudCall(endpoint: string, projectKey: string, name: string, args: Record<string, unknown>, signal?: AbortSignal) {
  const url = new URL(endpoint);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password || url.search || url.hash) {
    throw new Error("XMI_CLOUD_ENDPOINT_INVALID");
  }
  if (!/^XMIK-[A-Za-z0-9_-]{43}$/.test(projectKey)) throw new Error("XMI_PROJECT_KEY_INVALID");
  if (Buffer.byteLength(JSON.stringify(args)) > hybridInputLimit) throw new DomainError("HYBRID_INPUT_TOO_LARGE");
  if (JSON.stringify(args).includes(projectKey)) throw new DomainError("POSSIBLE_SECRET_REMOVE_BEFORE_SAVING");
  const abort = AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]);
  const client = new Client({name: "xmi-hybrid-connector", version: "0.1.0"});
  const transport = new StreamableHTTPClientTransport(url, {requestInit: {headers: {authorization: "Bearer " + projectKey}}});
  try {
    await client.connect(transport, {signal: abort});
    const result = await client.callTool({name, arguments: args}, undefined, {signal: abort});
    if (result.isError) {
      const failure = hybridError.safeParse(result.structuredContent);
      throw new DomainError(failure.success ? failure.data.code : "HYBRID_CLOUD_UNAVAILABLE");
    }
    return result.structuredContent;
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError(signal?.aborted ? "REQUEST_CANCELLED" : "HYBRID_CLOUD_UNAVAILABLE");
  } finally {await client.close();}
}
export async function projectAccess(endpoint: string, projectKey: string, signal?: AbortSignal) {
  return accessView.parse(await cloudCall(endpoint, projectKey, "xmi_project_access_get", {}, signal));
}
export async function projectBinding(endpoint: string, projectKey: string, signal?: AbortSignal) {
  return bindingView.parse(await cloudCall(endpoint, projectKey, "xmi_project_binding_get", {}, signal));
}
export async function hybridEvaluate(endpoint: string, projectKey: string, args: Record<string, unknown>, signal?: AbortSignal) {
  return hybridResponse.parse(await cloudCall(endpoint, projectKey, "xmi_hybrid_evaluate", args, signal));
}
