import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {buildReviewTransport, decodeReviewTransport, transportHash, transportLimits, verifyReviewPages} from "../apps/mcp-server/review-transport.ts";
import {canonical} from "../packages/core/validation.ts";
import {hostReviewBindingSchema} from "../packages/core/spec-review-service.ts";

test("dictionary restores exact Unicode, embedded JSON, whitespace, all sixteen files, statuses and scoped IDs", () => {
  const source = {type: "document", ref: "SRC-" + "a".repeat(64)}, model = {items: [
    {id: "REQ-1", statement: "玩家不是用户\n保留原文和😀", status: "CONFIRMED", version: 7, source_refs: [source, source]},
    {id: "REQ-2", statement: "旧版本\r\n保持引用", status: "REJECTED", version: 3, source_refs: [source]}]};
  const files = Array.from({length: 16}, (_, i) => ({path: `${i}.txt`, content: i === 0 ? canonical(model) : i === 1
    ? JSON.stringify(model, null, 2) + "\n" : i === 2 ? ' {"unaltered":  1}\r\n' : model.items[0]!.statement.repeat(1000)}));
  const packet = canonical({model, files, scope_requirements: [{id: "risk", scope_ids: ["REQ-1", "REQ-2"], minimum_mode: "PRODUCT_GRADE",
    resolution: "UPGRADE_SCOPE"}], special: {ref: 1, __proto__: null}, long: "😀\\\"\n".repeat(8000)});
  const t = buildReviewTransport(packet); verifyReviewPages(t.pages, t.binding, packet);
  const restored = decodeReviewTransport(t.pages.map(p => p.slice(p.indexOf("\n") + 1)).join("\n"));
  assert.equal(restored, packet); assert.deepEqual(buildReviewTransport(packet), t, "deterministic transport");
  const output = JSON.parse(restored);
  assert.deepEqual(output.model, model); assert.deepEqual(output.scope_requirements, JSON.parse(packet).scope_requirements);
  assert.deepEqual(output.files.map((f: {content: string}) => transportHash(f.content)), files.map(f => transportHash(f.content)));
  assert.ok(t.pages.every(p => Buffer.byteLength(p) <= transportLimits.page_bytes));
});

for (const bytes of [65534, 65535, 65536]) test(`packet around native ${bytes}-byte persistence boundary uses safe pages`, () => {
  const packet = canonical({text: randomBytes(bytes).toString("base64").slice(0, bytes - 11)});
  assert.equal(Buffer.byteLength(packet), bytes);
  const t = buildReviewTransport(packet); verifyReviewPages(t.pages, t.binding, packet);
  assert.ok(t.pages.length > 1); assert.ok(t.pages.every(p => Buffer.byteLength(p) <= 32768));
});

test("missing, duplicate, reordered, altered and outer/inner truncated page text is never accepted", () => {
  const packet = canonical({text: randomBytes(80000).toString("base64")}), t = buildReviewTransport(packet);
  for (const pages of [t.pages.slice(1), [...t.pages, t.pages[0]!], [...t.pages].reverse(),
    t.pages.map((p, i) => i ? p : p + "x"), t.pages.map(p => p.slice(0, 500)),
    t.pages.map(p => "Warning: truncated output\n" + p)]) assert.throws(() => verifyReviewPages(pages, t.binding, packet));
});

test("more than 64 pages stops before starting an Agent; no summary fallback", () => {
  const packet = canonical({text: randomBytes(1700000).toString("base64")});
  assert.throws(() => buildReviewTransport(packet), /HOST_REVIEW_TRANSPORT_CAPACITY/);
});

test("old host binding remains readable without rewriting its evidence or adding transport", () => {
  const legacy = {session_id: "00000000-0000-4000-8000-000000000001", task_name: "xmi_review_" + "a".repeat(32), parent_log: "old.jsonl",
    parent_offset: 0, parent_anchor: "a".repeat(64), material_path: "D:/old.json", packet_sha256: "b".repeat(64)};
  assert.deepEqual(hostReviewBindingSchema.parse(legacy), legacy);
  assert.equal(hostReviewBindingSchema.safeParse({...legacy, transport: {schema_version: "XMI-REVIEW-TRANSPORT/1",
    encoded_sha256: "a".repeat(64), page_sha256: Array(65).fill("b".repeat(64))}}).success, false);
});

test("raw JSON fallback avoids dictionary expansion and preserves split text/Unicode exactly", () => {
  const packet = canonical({text: randomBytes(85000).toString("base64") + " 😀 原文 "});
  const t = buildReviewTransport(packet);
  assert.equal(t.binding.encoding, "JSON_TEXT"); assert.ok(t.pages.length <= 4);
  verifyReviewPages(t.pages, t.binding, packet);
  const encoded = t.pages.map(p => p.slice(p.indexOf("\n") + 1)).join("");
  assert.equal(decodeReviewTransport(encoded), packet);
  assert.throws(() => verifyReviewPages(t.pages.map(p => p + " "), t.binding, packet));
});
