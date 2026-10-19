import {createHash} from "node:crypto";
import {canonical} from "../../packages/core/validation.ts";
import {requireCondition} from "../../packages/core/errors.ts";

// A transparent, reversible dictionary, not a summary or compressed binary.
// Every reference points backwards; field names and short text remain inline.
export const transportLimits = {page_bytes: 32 * 1024, pages: 64, packet_bytes: 3 * 1024 * 1024,
  nodes: 100000, depth: 100, child_log_bytes: 16 * 1024 * 1024} as const;
export const transportHash = (value: string) => createHash("sha256").update(value).digest("hex");
type Atom = null | boolean | number | string | {ref: number};
type Node = {type: "object"; value: [string, Atom][]} | {type: "array" | "text_parts"; value: Atom[]} |
  {type: "text"; value: string} | {type: "json"; format: "canonical" | "pretty"; value: Atom};
export type ReviewTransport = {schema_version: "XMI-REVIEW-TRANSPORT/1"; encoded_sha256: string; page_sha256: string[];
  encoding?: "DICTIONARY" | "JSON_TEXT"};
const rawMarker = "XMI-REVIEW-JSON-TEXT/1\n";

function encode(packet: string): string {
  const nodes: Node[] = [], ids = new Map<string, number>();
  const intern = (node: Node): Atom => {
    const key = canonical(node), existing = ids.get(key);
    if (existing !== undefined) return {ref: existing};
    const id = nodes.length; ids.set(key, id); nodes.push(node);
    requireCondition(nodes.length <= transportLimits.nodes, "HOST_REVIEW_TRANSPORT_CAPACITY");
    return {ref: id};
  };
  const text = (value: string): Atom => {
    if (value.length < 64) return value;
    if (value.length <= 4000) return intern({type: "text", value});
    const chunks: Atom[] = []; let part = "";
    for (const character of value) {
      if (part.length + character.length > 4000) {chunks.push(text(part)); part = "";}
      part += character;
    }
    if (part) chunks.push(text(part));
    return intern({type: "text_parts", value: chunks});
  };
  const visit = (value: unknown, depth = 0): Atom => {
    requireCondition(depth <= transportLimits.depth, "HOST_REVIEW_TRANSPORT_CAPACITY");
    if (value === null || typeof value === "boolean" || typeof value === "number") return value;
    if (typeof value === "string") {
      // Expand embedded JSON only when its original bytes can be recreated.
      // Otherwise retain the exact text, including whitespace and line endings.
      if (value.length > 512 && /^[\[{]/u.test(value)) {
        let parsed: unknown; try {parsed = JSON.parse(value);} catch {return text(value);}
        const format = canonical(parsed) === value ? "canonical" : JSON.stringify(parsed, null, 2) + "\n" === value ? "pretty" : null;
        if (format) return intern({type: "json", format, value: visit(parsed, depth + 1)});
      }
      return text(value);
    }
    if (Array.isArray(value)) return intern({type: "array", value: value.map(v => visit(v, depth + 1))});
    return intern({type: "object", value: Object.entries(value as object).map(([k, v]) => [k, visit(v, depth + 1)])});
  };
  const root = visit(JSON.parse(packet));
  return [...nodes.map((node, id) => canonical({id, ...node})), canonical({root})].join("\n");
}

export function decodeReviewTransport(encoded: string): string {
  requireCondition(Buffer.byteLength(encoded) <= transportLimits.page_bytes * transportLimits.pages,
    "HOST_REVIEW_TRANSPORT_CAPACITY");
  if (encoded.startsWith(rawMarker)) {
    const packet = encoded.slice(rawMarker.length);
    requireCondition(canonical(JSON.parse(packet)) === packet, "HOST_REVIEW_TRANSPORT_INVALID");
    return packet;
  }
  const lines = encoded.split("\n"), values: unknown[] = [];
  requireCondition(lines.length > 1 && lines.length <= transportLimits.nodes + 1, "HOST_REVIEW_TRANSPORT_INVALID");
  const atom = (value: Atom): unknown => {
    if (!value || typeof value !== "object") return value;
    requireCondition(Object.keys(value).length === 1 && Number.isInteger(value.ref) && value.ref >= 0 && value.ref < values.length,
      "HOST_REVIEW_TRANSPORT_INVALID");
    return values[value.ref];
  };
  for (const line of lines.slice(0, -1)) {
    const node = JSON.parse(line) as Node & {id: number};
    requireCondition(node.id === values.length, "HOST_REVIEW_TRANSPORT_INVALID");
    let value: unknown;
    if (node.type === "text") value = node.value;
    else if (node.type === "array") value = node.value.map(atom);
    else if (node.type === "object") value = Object.fromEntries(node.value.map(([k, v]) => [k, atom(v)]));
    else if (node.type === "text_parts") {
      const parts = node.value.map(atom);
      requireCondition(parts.every(p => typeof p === "string"), "HOST_REVIEW_TRANSPORT_INVALID"); value = parts.join("");
    } else if (node.type === "json") value = node.format === "canonical" ? canonical(atom(node.value)) : JSON.stringify(atom(node.value), null, 2) + "\n";
    else throw new Error("HOST_REVIEW_TRANSPORT_INVALID");
    // The decoder is used only on hash-bound frozen transport. Bound expansion
    // as well, so no malformed transport can allocate an unbounded graph.
    requireCondition(Buffer.byteLength(JSON.stringify(value)) <= transportLimits.packet_bytes, "HOST_REVIEW_TRANSPORT_CAPACITY");
    values.push(value);
  }
  const packet = canonical(atom(JSON.parse(lines.at(-1)!).root));
  requireCondition(Buffer.byteLength(packet) <= transportLimits.packet_bytes, "HOST_REVIEW_TRANSPORT_CAPACITY");
  return packet;
}

export function buildReviewTransport(packet: string): {binding: ReviewTransport; pages: string[]} {
  requireCondition(Buffer.byteLength(packet) <= transportLimits.packet_bytes, "HOST_REVIEW_TRANSPORT_CAPACITY");
  const dictionary = encode(packet), raw = rawMarker + packet;
  const encoding = Buffer.byteLength(raw) < Buffer.byteLength(dictionary) ? "JSON_TEXT" as const : "DICTIONARY" as const;
  const encoded = encoding === "JSON_TEXT" ? raw : dictionary, encodedHash = transportHash(encoded), packetHash = transportHash(packet);
  requireCondition(decodeReviewTransport(encoded) === packet, "HOST_REVIEW_TRANSPORT_ROUNDTRIP_FAILED");
  const chunks: string[] = []; let chunk = "";
  // Keep complete records on a page; reserve 512 bytes for the page header.
  if (encoding === "JSON_TEXT") {
    const bytes = Buffer.from(encoded);
    for (let start = 0; start < bytes.length;) {
      let end = Math.min(start + transportLimits.page_bytes - 512, bytes.length);
      while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
      chunks.push(bytes.subarray(start, end).toString("utf8")); start = end;
    }
  } else for (const line of encoded.split("\n")) {
    requireCondition(Buffer.byteLength(line) <= transportLimits.page_bytes - 512, "HOST_REVIEW_TRANSPORT_CAPACITY");
    if (chunk && Buffer.byteLength(chunk + "\n" + line) > transportLimits.page_bytes - 512) {chunks.push(chunk); chunk = "";}
    chunk += (chunk ? "\n" : "") + line;
  }
  if (chunk) chunks.push(chunk);
  requireCondition(chunks.length > 0 && chunks.length <= transportLimits.pages, "HOST_REVIEW_TRANSPORT_CAPACITY");
  const pages = chunks.map((payload, index) => canonical({schema_version: "XMI-REVIEW-PAGE/1", encoding, index, count: chunks.length,
    packet_sha256: packetHash, transport_sha256: encodedHash, payload_sha256: transportHash(payload)}) + "\n" + payload);
  requireCondition(pages.every(p => Buffer.byteLength(p) <= transportLimits.page_bytes), "HOST_REVIEW_TRANSPORT_CAPACITY");
  return {binding: {schema_version: "XMI-REVIEW-TRANSPORT/1", encoding, encoded_sha256: encodedHash, page_sha256: pages.map(transportHash)}, pages};
}

export function verifyReviewPages(pages: string[], binding: ReviewTransport, packet: string): void {
  requireCondition(pages.length > 0 && pages.length <= transportLimits.pages && pages.length === binding.page_sha256.length,
    "HOST_REVIEW_DELIVERY_INCOMPLETE");
  const payloads = pages.map((page, index) => {
    requireCondition(Buffer.byteLength(page) <= transportLimits.page_bytes && transportHash(page) === binding.page_sha256[index],
      "HOST_REVIEW_DELIVERY_INCOMPLETE");
    const end = page.indexOf("\n"), header = JSON.parse(page.slice(0, end)), payload = page.slice(end + 1);
    requireCondition(header.schema_version === "XMI-REVIEW-PAGE/1" && header.index === index && header.count === pages.length &&
      header.packet_sha256 === transportHash(packet) && header.transport_sha256 === binding.encoded_sha256 &&
      header.payload_sha256 === transportHash(payload), "HOST_REVIEW_DELIVERY_INCOMPLETE");
    return payload;
  });
  const encoded = payloads.join(binding.encoding === "JSON_TEXT" ? "" : "\n");
  requireCondition(transportHash(encoded) === binding.encoded_sha256 && decodeReviewTransport(encoded) === packet,
    "HOST_REVIEW_DELIVERY_INCOMPLETE");
}

export function reviewPagePath(materialPath: string, index: number): string {return `${materialPath}.pages/${index + 1}.txt`;}
